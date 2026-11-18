/* PCI Survey — calculation engine (ASTM D6433-24 §7, §9, §10, §11). Pure functions. */
'use strict';
(function (root) {

const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;

/* ---------- interpolation on a digitised curve: [[x,y],...] ---------- */
function interp(points, x, logx) {
  if (!points || points.length === 0 || x == null || isNaN(x)) return null;
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  const tx = v => (logx ? Math.log10(Math.max(v, 1e-9)) : v);
  const X = tx(x);
  if (pts.length === 1) return pts[0][1];
  if (X <= tx(pts[0][0])) {
    // below first point: for linear (PCC) curves through origin interpolate from (0,0); else clamp
    if (!logx && pts[0][0] > 0) return pts[0][1] * (x / pts[0][0]);
    return pts[0][1];
  }
  const last = pts[pts.length - 1];
  if (X >= tx(last[0])) return last[1];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const xa = tx(a[0]), xb = tx(b[0]);
    if (X >= xa && X <= xb) return a[1] + (b[1] - a[1]) * (X - xa) / (xb - xa);
  }
  return last[1];
}

/* ---------- deduct value from curve library ---------- */
function curveFor(lib, type, units, code, sev) {
  if (!lib) return null;
  if (type === 'AC') {
    if (units === 'SI' && lib.AC_SI && lib.AC_SI[code] && lib.AC_SI[code][sev]) return lib.AC_SI[code][sev];
    return lib.AC && lib.AC[code] && lib.AC[code][sev] ? lib.AC[code][sev] : null;
  }
  return lib.PCC && lib.PCC[code] && lib.PCC[code][sev] ? lib.PCC[code][sev] : null;
}
function dvFromCurve(lib, type, units, code, sev, density) {
  if (type === 'PCC' && code === 26) return ({L: 2, M: 4, H: 8})[sev] ?? null; // Fig. X4.6 fixed deducts
  const c = curveFor(lib, type, units, code, sev);
  if (!c) return null;
  const v = interp(c, density, type === 'AC');
  return v == null ? null : Math.max(0, v);
}
function cdvFromCurve(lib, type, tdv, q) {
  if (q <= 1) return tdv;                                // q = 1: CDV = TDV
  const set = lib && (type === 'AC' ? lib.CDV_AC : lib.CDV_PCC);
  if (!set) return null;
  const ks = Object.keys(set).map(Number).filter(k => set[k] && set[k].length).sort((a, b) => a - b);
  if (!ks.length) return null;
  const cv = k => (k === 1 ? tdv : interp(set[String(k)], tdv, false));
  if (set[String(q)] && set[String(q)].length) { const v0 = cv(q); return v0 == null ? null : Math.min(100, Math.max(0, v0)); }
  // q not drawn (e.g. PCC q = 5, 7, 8): interpolate linearly between the nearest drawn q lines (q = 1 is CDV = TDV)
  const lo = Math.max(1, ...ks.filter(k => k < q)), hiL = ks.filter(k => k > q);
  if (!hiL.length) { const v1 = cv(ks[ks.length - 1]); return v1 == null ? null : Math.min(100, Math.max(0, v1)); }
  const hi = hiL[0], a = cv(lo), b = cv(hi);
  if (a == null || b == null) return null;
  return Math.min(100, Math.max(0, a + (b - a) * (q - lo) / (hi - lo)));
  /* unreachable */
}

/* ---------- Eq. 4 and max CDV iteration (§9.5) ---------- */
function allowableDeducts(hdv) { return Math.min(10, 1 + (9 / 98) * (100 - hdv)); }

function maxCDV(dvList, opts) {
  // dvList: numbers; opts: {type, lib, cdvOverride:{iterIndex:value}}
  const o = opts || {};
  const dvs = dvList.filter(v => v != null && !isNaN(v)).map(Number).sort((a, b) => b - a);
  const res = {sorted: dvs.slice(), hdv: dvs[0] || 0, m: null, used: [], iterations: [], maxCdv: null, rule: '', complete: true};
  if (dvs.length === 0) { res.maxCdv = 0; res.rule = 'No distress recorded: PCI = 100.'; return res; }
  const over2 = dvs.filter(v => v > 2).length;
  if (over2 <= 1) {                                   // §9.5.1
    const tdv = dvs.reduce((a, b) => a + b, 0);
    res.maxCdv = r1(tdv); res.used = dvs.slice();
    res.rule = 'None or only one deduct > 2: total deduct value used in place of max CDV (§9.5.1).';
    res.iterations.push({dvs: dvs.slice(), tdv: r1(tdv), q: over2, cdv: r1(tdv), src: 'TDV'});
    return res;
  }
  const m = r1(allowableDeducts(dvs[0])); res.m = m;  // §9.5.3 (m to 0.1, as in the standard's examples)
  const whole = Math.floor(m), frac = m - whole;
  let used;
  if (dvs.length <= whole) used = dvs.slice();        // §9.5.4
  else {
    used = dvs.slice(0, whole);
    if (frac > 1e-9 && dvs.length > whole) used.push(r2(dvs[whole] * frac));
  }
  res.used = used.slice();
  let cur = used.slice(), it = 0;
  while (true) {
    const tdv = cur.reduce((a, b) => a + b, 0);
    const q = cur.filter(v => v > 2.0).length;        // §9.5.5.2
    let cdv = null, src = 'curve';
    if (o.cdvOverride && o.cdvOverride[it] != null && o.cdvOverride[it] !== '') { cdv = Number(o.cdvOverride[it]); src = 'manual'; }
    else cdv = cdvFromCurve(o.lib, o.type, tdv, q);
    if (q <= 1 && !(o.cdvOverride && o.cdvOverride[it] != null && o.cdvOverride[it] !== '')) { cdv = tdv; src = 'q=1'; }
    if (cdv == null) res.complete = false;
    res.iterations.push({dvs: cur.slice(), tdv: r1(tdv), q, cdv: cdv == null ? null : r1(cdv), src});
    if (q <= 1) break;
    // reduce the smallest individual deduct value greater than 2.0 to 2.0 (§9.5.5.4)
    let idx = -1, min = Infinity;
    cur.forEach((v, k) => { if (v > 2.0 && v <= min) { min = v; idx = k; } });
    cur[idx] = 2.0; it++;
    if (it > 20) break;
  }
  const c = res.iterations.map(x => x.cdv).filter(v => v != null);
  res.maxCdv = res.complete && c.length ? Math.max(...c) : (c.length ? Math.max(...c) : null);
  return res;
}

function rating(pci) {
  if (pci == null || isNaN(pci)) return null;
  const R = (typeof RATINGS !== 'undefined' ? RATINGS : (root.RATINGS || []));
  for (const b of R) if (pci >= b.min && (pci <= b.max)) return b;
  return R[R.length - 1] || null;
}

/* ---------- aggregate a sample unit into distress rows ---------- */
function slabArea(section) { return (Number(section.slabLen) || 0) * (Number(section.slabWid) || 0); }
function unitArea(section, unit) {
  if (section.type === 'AC') return Number(unit.area) || 0;
  if (Number(unit.area)) return Number(unit.area);
  return (Number(unit.slabs) || 0) * slabArea(section);
}
const SEVRANK = {N: 0, L: 1, M: 2, H: 3};

function pccSlabCounts(unit) {
  // returns {key:'code|sev' -> count}, notes[]
  const counts = {}, notes = [];
  const marks = unit.slabMarks || {};
  Object.keys(marks).forEach(slab => {
    let d = Object.assign({}, marks[slab]);          // code -> sev (sev may be 'M2' for two M linear cracks)
    if (d[28] === 'M2') { d[28] = 'H'; notes.push(`Slab ${slab}: two M linear cracks counted as one H (X2.10.3).`); }
    if (d[23] && (d[23] === 'M' || d[23] === 'H')) {
      const others = Object.keys(d).filter(c => Number(c) !== 23);
      if (others.length) notes.push(`Slab ${slab}: ${d[23]} divided slab — other distress (${others.join(', ')}) not counted (X2.5.2).`);
      d = {23: d[23]};
    }
    Object.keys(d).forEach(code => {
      if (Number(code) === 26) return;
      const k = code + '|' + d[code];
      counts[k] = (counts[k] || 0) + 1;
    });
  });
  const extra = Number(unit.pumpExtra) || 0;
  if (extra > 0) { counts['33|N'] = (counts['33|N'] || 0) + extra; notes.push(`Pumping: +${extra} slab(s) for additional pumping joints (X2.15.2).`); }
  return {counts, notes};
}

function unitRows(section, unit, lib) {
  const rows = [], type = section.type, units = section.system || 'US';
  const ov = unit.dvOverride || {};
  if (type === 'AC') {
    const area = unitArea(section, unit);
    const agg = {};
    (unit.entries || []).forEach(e => {
      const k = e.code + '|' + e.sev;
      agg[k] = (agg[k] || 0) + (Number(e.qty) || 0);
    });
    Object.keys(agg).forEach(k => {
      const [code, sev] = k.split('|'); const qty = agg[k];
      if (qty <= 0) return;
      const density = area > 0 ? qty / area * 100 : null;
      let dv = null, src = 'curve';
      if (ov[k] != null && ov[k] !== '') { dv = Number(ov[k]); src = 'manual'; }
      else if (density != null) dv = dvFromCurve(lib, type, units, Number(code), sev, density);
      if (dv == null) src = 'missing';
      rows.push({key: k, code: Number(code), sev, qty: r2(qty), density: density == null ? null : r2(density), dv: dv == null ? null : r1(dv), src});
    });
    return {rows: rows.sort((a, b) => a.code - b.code || SEVRANK[a.sev] - SEVRANK[b.sev]), notes: [], area};
  }
  // PCC
  const total = Number(unit.slabs) || 0;
  const {counts, notes} = pccSlabCounts(unit);
  if (unit.jointSeal && unit.jointSeal !== 'none') {
    const k = '26|' + unit.jointSeal;
    rows.push({key: k, code: 26, sev: unit.jointSeal, qty: null, density: null, dv: ov[k] != null && ov[k] !== '' ? Number(ov[k]) : dvFromCurve(lib, 'PCC', units, 26, unit.jointSeal, 0), src: ov[k] != null && ov[k] !== '' ? 'manual' : 'fixed'});
  }
  Object.keys(counts).forEach(k => {
    const [code, sev] = k.split('|'); const n = counts[k];
    const density = total > 0 ? n / total * 100 : null;
    let dv = null, src = 'curve';
    if (ov[k] != null && ov[k] !== '') { dv = Number(ov[k]); src = 'manual'; }
    else if (density != null) dv = dvFromCurve(lib, 'PCC', units, Number(code), sev, density);
    if (dv == null) src = 'missing';
    rows.push({key: k, code: Number(code), sev, qty: n, density: density == null ? null : r2(density), dv: dv == null ? null : r1(dv), src});
  });
  return {rows: rows.sort((a, b) => a.code - b.code || SEVRANK[a.sev] - SEVRANK[b.sev]), notes, area: unitArea(section, unit)};
}

/* ---------- multiple-severity check (§9.6.2) — only when every DV comes from curves ---------- */
function pciFromRows(rows, type, lib) {
  const r = maxCDV(rows.map(x => x.dv), {type, lib});
  return r.maxCdv == null || !r.complete ? null : 100 - r.maxCdv;
}
function multiSeverityCheck(section, rows, lib) {
  const type = section.type, units = section.system || 'US';
  const out = {applied: false, notes: [], rows};
  const byCode = {};
  rows.forEach(x => { if (x.sev !== 'N' && x.code !== 26) (byCode[x.code] = byCode[x.code] || []).push(x); });
  const multi = Object.keys(byCode).filter(c => byCode[c].length > 1);
  if (!multi.length) return out;
  if (rows.some(x => x.src === 'manual' || x.src === 'missing')) {
    out.notes.push(`Distress ${multi.join(', ')} recorded at more than one severity: run the §9.6.2 check manually (manual deduct values in use).`);
    return out;
  }
  let best = rows, bestPci = pciFromRows(rows, type, lib);
  if (bestPci == null) return out;
  multi.forEach(code => {
    const grp = {}; byCode[code].forEach(x => grp[x.sev] = x.density || 0);
    const l = grp.L || 0, m = grp.M || 0, h = grp.H || 0;
    const combos = [];
    if (Object.keys(grp).length === 2) {
      const sevs = Object.keys(grp).sort((a, b) => SEVRANK[a] - SEVRANK[b]);
      combos.push({[sevs[1]]: grp[sevs[0]] + grp[sevs[1]]});
    } else {
      combos.push({M: l + m, H: h}, {L: l, H: m + h}, {M: m, H: l + h}, {H: l + m + h});
    }
    combos.forEach(cmb => {
      const alt = best.filter(x => x.code !== Number(code));
      let ok = true;
      Object.keys(cmb).forEach(sev => {
        if (cmb[sev] <= 0) return;
        const dv = dvFromCurve(lib, type, units, Number(code), sev, cmb[sev]);
        if (dv == null) ok = false;
        alt.push({key: code + '|' + sev, code: Number(code), sev, qty: null, density: r2(cmb[sev]), dv: dv == null ? null : r1(dv), src: 'curve (§9.6.2)'});
      });
      if (!ok) return;
      const p = pciFromRows(alt, type, lib);
      if (p != null && p > bestPci + 1e-9) {
        out.notes.push(`§9.6.2: distress ${code} recombined (${Object.entries(cmb).map(([s, d]) => s + ' ' + r2(d) + '%').join(', ')}) gives higher PCI ${r1(p)} > ${r1(bestPci)}; adopted.`);
        bestPci = p; best = alt; out.applied = true;
      }
    });
  });
  if (!out.applied) out.notes.push(`§9.6.2 check run for distress ${multi.join(', ')}: no correction needed.`);
  out.rows = best;
  return out;
}

function unitPCI(section, unit, lib) {
  const agg = unitRows(section, unit, lib);
  let rows = agg.rows, notes = agg.notes.slice();
  const ms = multiSeverityCheck(section, rows, lib);
  rows = ms.rows; notes = notes.concat(ms.notes);
  const missing = rows.filter(x => x.dv == null);
  const calc = maxCDV(rows.map(x => x.dv), {type: section.type, lib, cdvOverride: unit.cdvOverride || {}});
  let pci = null;
  if (!missing.length && calc.complete && calc.maxCdv != null) pci = r1(Math.max(0, 100 - calc.maxCdv));
  return {rows, notes, calc, pci, area: agg.area, missingDV: missing.map(x => x.key), complete: pci != null};
}

/* ---------- sampling (§7.5) ---------- */
function minUnits(N, s, e) {
  N = Number(N); s = Number(s); e = Number(e);
  if (!(N > 0) || !(s > 0) || !(e > 0)) return null;
  const raw = N * s * s / ((e * e / 4) * (N - 1) + s * s);
  return {raw, n: Math.min(N, Math.ceil(raw - 1e-9))};
}
function interval(N, n) { return n > 0 ? Math.max(1, Math.floor(N / n)) : null; }
function systematicUnits(N, n, start) {
  const i = interval(N, n); const list = [];
  for (let u = start; u <= N && list.length < n; u += i) list.push(u);
  return {i, list};
}
function stdev(pcis) {
  if (pcis.length < 2) return null;
  const mean = pcis.reduce((a, b) => a + b, 0) / pcis.length;
  return Math.sqrt(pcis.reduce((a, p) => a + (p - mean) * (p - mean), 0) / (pcis.length - 1));
}

/* ---------- section PCI (§11, Eq. 5-7) ---------- */
function sectionPCI(section, results) {
  // results: [{unit, pci, area}]
  const R = results.filter(x => x.pci != null && x.unit.kind !== 'A' && x.area > 0);
  const Aa = results.filter(x => x.pci != null && x.unit.kind === 'A' && x.area > 0);
  const out = {pciR: null, pciA: null, pciS: null, nR: R.length, nA: Aa.length, sumAa: 0, A: Number(section.area) || 0, eq: ''};
  if (R.length) out.pciR = R.reduce((a, x) => a + x.pci * x.area, 0) / R.reduce((a, x) => a + x.area, 0);
  if (Aa.length) { out.sumAa = Aa.reduce((a, x) => a + x.area, 0); out.pciA = Aa.reduce((a, x) => a + x.pci * x.area, 0) / out.sumAa; }
  if (out.pciR != null && out.pciA == null) { out.pciS = out.pciR; out.eq = 'Eq. 5'; }
  else if (out.pciR != null && out.pciA != null && out.A > out.sumAa) {
    out.pciS = (out.pciR * (out.A - out.sumAa) + out.pciA * out.sumAa) / out.A; out.eq = 'Eq. 5–7';
  } else if (out.pciR == null && out.pciA != null) { out.pciS = out.pciA; out.eq = 'additional units only'; }
  else if (out.pciR != null && out.pciA != null) { out.pciS = out.pciR; out.eq = 'Eq. 5 (section area not set; additional units excluded)'; }
  if (out.pciS != null) out.pciS = r1(out.pciS);
  if (out.pciR != null) out.pciR = r1(out.pciR);
  if (out.pciA != null) out.pciA = r1(out.pciA);
  const s = stdev(R.map(x => x.pci));
  out.s = s == null ? null : r1(s);
  if (s != null && section.N) {
    const mu = minUnits(section.N, s, section.e || 5);
    out.nRequired = mu ? mu.n : null;
    out.nShort = mu ? Math.max(0, mu.n - R.length) : null;
  }
  return out;
}

const API = {interp, dvFromCurve, cdvFromCurve, allowableDeducts, maxCDV, rating, unitRows, unitPCI, multiSeverityCheck,
  minUnits, interval, systematicUnits, stdev, sectionPCI, unitArea, slabArea, pccSlabCounts, r1, r2};
root.PCI = API;
if (typeof module !== 'undefined') module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
