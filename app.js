/* PCI Survey — ASTM D6433 field app. Vanilla JS, offline-first (IndexedDB + service worker). */
'use strict';
const APP_VERSION = '1.4.0';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (v, d = 1) => (v == null || v === '' || isNaN(v)) ? '—' : Number(v).toFixed(d);
const today = () => new Date().toISOString().slice(0, 10);
const UNIT = {US: {len: 'ft', area: 'ft²', areaTxt: 'ft2'}, SI: {len: 'm', area: 'm²', areaTxt: 'm2'}};
const dist = (type, code) => CATALOG[type].find(d => d.code === Number(code));
const sevLabel = s => s === 'N' ? '—' : s;
function qtyUnit(section, d) { const u = UNIT[section.system || 'US']; return d.m === 'area' ? u.area : d.m === 'length' ? u.len : d.m === 'count' ? 'no.' : d.m === 'slab' ? 'slabs' : 'unit'; }

/* ============================ storage ============================ */
let DB = null;
const idb = {
  open() {
    return new Promise((res) => {
      if (!('indexedDB' in window)) return res(null);
      const rq = indexedDB.open('pci-survey', 1);
      rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('kv'); db.createObjectStore('photos'); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      if (!DB) return res(null);
      const t = DB.transaction(store, mode); const s = t.objectStore(store); const r = fn(s);
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  },
  get(store, k) { return this.tx(store, 'readonly', s => s.get(k)); },
  put(store, k, v) { return this.tx(store, 'readwrite', s => s.put(v, k)); },
  del(store, k) { return this.tx(store, 'readwrite', s => s.delete(k)); },
  keys(store) { return this.tx(store, 'readonly', s => s.getAllKeys()); },
  clear(store) { return this.tx(store, 'readwrite', s => s.clear()); }
};
let S = null; // application state
const blankState = () => ({version: 1, settings: {inspector: '', firm: 'EDI Consultants, Inc.', units: 'US', type: 'AC'}, curveLib: null, projects: []});
async function loadState() {
  DB = await idb.open();
  let st = null;
  try { st = DB ? await idb.get('kv', 'state') : JSON.parse(localStorage.getItem('pci-state') || 'null'); } catch (e) { st = null; }
  S = st || blankState();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
let saveT = null;
function save(now) {
  clearTimeout(saveT);
  const go = () => { if (DB) idb.put('kv', 'state', JSON.parse(JSON.stringify(S))); else localStorage.setItem('pci-state', JSON.stringify(S)); };
  if (now) go(); else saveT = setTimeout(go, 250);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(true); });

/* ============================ routing ============================ */
const UI = {tab: 'distress', acCode: null, acSev: null, slab: null, curveSel: {set: 'AC', code: 1, sev: 'L'}};
function route() { return (location.hash || '#/').slice(2).split('/').filter(Boolean); }
function go(h) { location.hash = h; }
const find = {
  p: id => S.projects.find(p => p.id === id),
  s: (p, id) => p && p.sections.find(s => s.id === id),
  u: (s, id) => s && s.units.find(u => u.id === id)
};
function ctx() {
  const r = route(); const c = {view: r[0] || 'home'};
  if (r[1]) c.p = find.p(r[1]); if (r[2]) c.s = find.s(c.p, r[2]); if (r[3]) c.u = find.u(c.s, r[3]);
  return c;
}
window.addEventListener('hashchange', () => { UI.slab = null; render(); window.scrollTo(0, 0); });

/* ============================ rendering ============================ */
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
function crumbs(c) {
  const a = ['<a href="#/">Projects</a>'];
  if (c.p) a.push(`<a href="#/p/${c.p.id}">${esc(c.p.name || 'Project')}</a>`);
  if (c.s) a.push(`<a href="#/s/${c.p.id}/${c.s.id}">${esc((c.s.branch || '') + ' ' + (c.s.name || ''))}</a>`);
  if (c.u) a.push(`Unit ${esc(c.u.no)}`);
  return a.join(' › ');
}
function ratingChip(pci) {
  const b = PCI.rating(pci); if (!b) return '<span class="chip" style="background:#eee">—</span>';
  return `<span class="chip" style="background:${b.color};color:${b.text}">${fmt(pci, 0)} ${b.label}</span>`;
}
function render() {
  const c = ctx(); const m = $('#main');
  $('#crumbs').innerHTML = crumbs(c);
  let html = '';
  try {
    if (c.view === 'home') html = vHome();
    else if (c.view === 'p' && c.p) html = vProject(c.p);
    else if (c.view === 's' && c.s) html = vSection(c.p, c.s);
    else if (c.view === 'u' && c.u) html = vUnit(c.p, c.s, c.u);
    else if (c.view === 'r' && c.p) html = vReport(c.p);
    else if (c.view === 'curves') html = vCurves();
    else if (c.view === 'settings') html = vSettings();
    else if (c.view === 'help') html = vHelp();
    else html = vHome();
  } catch (e) { console.error(e); html = `<div class="err">Display error: ${esc(e.message)}</div>`; }
  m.innerHTML = html;
  if (c.view === 'r') hydratePhotos();
  if (c.view === 'u' && UI.tab === 'photos') hydratePhotos();
  if (c.view === 'curves') drawCurvePreview();
}

/* ---------- Home ---------- */
const blankDraft = p => p.draft && !p.sections.length && (!p.name || p.name === 'New project') && !p.number && !p.client && !p.location && !p.notes && !p.record;
function vHome() {
  const nb = S.projects.length; S.projects = S.projects.filter(p => !blankDraft(p)); if (S.projects.length !== nb) save(true);
  const ps = S.projects.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const lib = libStatus();
  return `<h1>Projects</h1>
  <div class="row"><button class="btn" data-act="newProject">+ New project</button>
  <label class="btn sec" style="margin:0">New from Project Record<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-act-change="newFromRecord" style="display:none"></label>
  <label class="btn sec" style="margin:0">Import project<input type="file" accept=".json,.zip,.html,.htm,application/json,application/zip,text/html" data-act-change="importAny" style="display:none"></label>
  <a class="btn sec" href="#/curves">Deduct curves ${lib.badge}</a><a class="btn sec" href="#/settings">Settings &amp; backup</a><a class="btn sec" href="#/help">Help</a></div>
  ${!S.curveLib ? `<div class="note">No deduct-curve library is loaded. The app still records everything and calculates densities, <i>m</i>, TDV, <i>q</i> and PCI, but you must type in deduct values (DV) and corrected deduct values (CDV) read from the licensed standard. Load or build a library under <b>Deduct curves</b> to automate this.</div>` : ''}
  <div class="list">${ps.length ? ps.map(p => {
    const nS = p.sections.length, nU = p.sections.reduce((a, s) => a + s.units.length, 0);
    return `<a class="item" href="#/p/${p.id}"><div class="grow"><b>${esc(p.name || 'Untitled project')}</b>${p.draft ? ' <span class="small muted">(not saved)</span>' : ''}<div class="meta">${esc(p.number || '')} ${esc(p.client || '')} · ${nS} section(s) · ${nU} unit(s) · ${esc(p.date || '')}</div></div><span>›</span></a>`;
  }).join('') : '<p class="muted">No projects yet. Create one, or load the demo project (ASTM D6433-24 worked examples) from Settings.</p>'}</div>
  <p class="muted small">PCI Survey v${APP_VERSION} · data are stored on this device only. To move a project to another device, use <b>Export project file</b> on the project page (or email the report package .zip) and <b>Import project</b> here.</p>`;
}

/* ---------- Project ---------- */
function vProject(p) {
  return `<h1>${esc(p.name || 'Project')}${p.draft ? ' <span class="small muted">(new, not saved)</span>' : ''}</h1>
  ${p.draft ? `<div class="card" style="background:var(--pale,#eef3f9)"><b>Start from the EDI Project Record?</b><p class="small" style="margin:4px 0 8px">Load the project's Project Record spreadsheet (.xlsx) from EDI Project Records to fill the details below and bring in the contacts, site access and other project data. Or type the details and tap Save project.</p><div class="row"><label class="btn" style="margin:0">Load Project Record (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-act-change="loadRecord" style="display:none"></label><button class="btn sec" data-act="saveDraft">Save project</button><button class="btn sec" data-act="cancelDraft">Cancel</button></div></div>` : ''}
  <div class="card"><div class="grid g2">
   ${field('project', 'name', 'Project name', p.name)}${field('project', 'number', 'Project no.', p.number)}
   ${field('project', 'client', 'Client', p.client)}${field('project', 'location', 'Site / address', p.location)}
   ${field('project', 'date', 'Survey date', p.date, 'date')}${field('project', 'inspectors', 'Inspector(s)', p.inspectors)}
  </div>${area('project', 'notes', 'Project notes / scope', p.notes)}</div>
  ${p.draft ? '' : recordCard(p)}
  <div class="row"><button class="btn" data-act="newSection">+ Add section</button><a class="btn sec" href="#/r/${p.id}">Report &amp; export</a><button class="btn sec" data-act="exportProject">Export project file</button><button class="btn sec warn" data-act="delProject">Delete project</button></div>
  <h2>Sections</h2><div class="list">${p.sections.map(s => {
    const R = sectionResult(s);
    return `<a class="item" href="#/s/${p.id}/${s.id}"><div class="grow"><b>${esc(s.branch || '')} — ${esc(s.name || 'Section')}</b>
    <div class="meta">${s.type} · ${s.system === 'SI' ? 'SI' : 'US'} · ${esc(s.use || '')} · ${R.done}/${s.units.length} units surveyed</div></div>${ratingChip(R.sec.pciS)}</a>`;
  }).join('') || '<p class="muted">No sections yet.</p>'}</div>`;
}
function field(obj, k, lab, v, type = 'text', extra = '') {
  return `<div><label>${lab}</label><input type="${type === 'number' ? 'text' : type}" data-obj="${obj}" data-k="${k}" value="${esc(v == null ? '' : v)}" ${extra}></div>`;
}
function area(obj, k, lab, v) { return `<div style="margin-top:8px"><label>${lab}</label><textarea data-obj="${obj}" data-k="${k}">${esc(v || '')}</textarea></div>`; }
function sel(obj, k, lab, v, opts) {
  return `<div><label>${lab}</label><select data-obj="${obj}" data-k="${k}">${opts.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
}

/* ---------- Section ---------- */
function sectionResult(s) {
  const res = s.units.map(u => { const r = PCI.unitPCI(s, u, S.curveLib); return {unit: u, pci: u.done ? r.pci : null, area: r.area, r}; });
  return {res, sec: PCI.sectionPCI(s, res), done: res.filter(x => x.pci != null).length};
}
function vSection(p, s) {
  const U = UNIT[s.system || 'US'];
  const mu = PCI.minUnits(s.N, s.sDev, s.e);
  const i = mu ? PCI.interval(s.N, mu.n) : null;
  const R = sectionResult(s);
  const sec = R.sec;
  return `<h1>${esc(s.branch || '')} — ${esc(s.name || 'Section')}</h1>
  <div class="card"><h3>Section definition (§7.1–7.3)</h3><div class="grid g3">
   ${field('section', 'branch', 'Branch', s.branch)}${field('section', 'name', 'Section ID', s.name)}
   ${sel('section', 'type', 'Pavement type', s.type, [['AC', 'AC — asphalt'], ['PCC', 'PCC — jointed concrete']])}
   ${sel('section', 'system', 'Unit system', s.system, [['US', 'US customary (ft, ft²)'], ['SI', 'SI (m, m²)']])}
   ${sel('section', 'use', 'Use', s.use, [['', '—'], ['Drive aisle', 'Drive aisle'], ['Parking stalls', 'Parking stalls'], ['Fire lane', 'Fire lane'], ['Loading / truck route', 'Loading / truck route'], ['Roadway', 'Roadway'], ['Dumpster pad', 'Dumpster pad'], ['Other', 'Other']])}
   ${field('section', 'area', `Section area, A (${U.area})`, s.area, 'number', 'inputmode="text" autocomplete="off"')}
   ${field('section', 'N', 'Total sample units, N', s.N, 'number', 'inputmode="numeric"')}
   ${s.type === 'AC' ? field('section', 'unitSize', `Nominal unit area (${U.area})`, s.unitSize, 'number', 'inputmode="text" autocomplete="off"')
     : field('section', 'slabLen', `Slab length (${U.len})`, s.slabLen, 'number', 'inputmode="decimal"') + field('section', 'slabWid', `Slab width (${U.len})`, s.slabWid, 'number', 'inputmode="decimal"')}
   ${field('section', 'constructed', 'Constructed / last M&R', s.constructed)}
  </div>
  <div class="help">AC sample unit: 225 ± 90 m² (2500 ± 1000 ft²). PCC: 20 ± 8 slabs; divide slabs longer than 8 m (25 ft) into imaginary slabs (§2.1.7, §7.3). ${s.type === 'PCC' && Number(s.slabLen) > (s.system === 'SI' ? 8 : 25) ? '<b style="color:#9B2C2C">Slab length exceeds 8 m (25 ft): use imaginary slabs.</b>' : ''}</div>
  ${area('section', 'notes', 'Section notes', s.notes)}</div>

  <div class="card"><h3>Sampling plan (§7.5, Eq. 1 &amp; 3)</h3>
   <div class="grid g3">${field('section', 'sDev', 'Std. dev. s (AC 10, PCC 15 first survey)', s.sDev, 'number', 'inputmode="decimal"')}${field('section', 'e', 'Allowable error e (PCI pts)', s.e, 'number', 'inputmode="decimal"')}</div>
   ${mu ? `<p>n = N s² / [(e²/4)(N−1) + s²] = ${s.N}·${s.sDev}² / [(${s.e}²/4)(${s.N}−1) + ${s.sDev}²] = <b>${fmt(mu.raw, 2)} → n = ${mu.n}</b> (rounded up). Interval i = N/n = ${s.N}/${mu.n} = ${fmt(s.N / mu.n, 2)} → <b>i = ${i}</b> (rounded down).</p>` : '<p class="muted">Enter N, s and e.</p>'}
   <div class="row"><button class="btn" data-act="genUnits" ${mu ? '' : 'disabled'}>Generate random units (systematic)</button>
   <button class="btn sec" data-act="genAll" ${s.N ? '' : 'disabled'}>Survey all N units</button>
   <button class="btn sec" data-act="addUnit" data-kind="R">+ Random unit</button><button class="btn sec" data-act="addUnit" data-kind="A">+ Additional unit</button></div>
   ${s.startUsed ? `<p class="muted small">Random start used: ${s.startUsed} (generated ${esc(s.genDate || '')}).</p>` : ''}</div>

  <h2>Sample units</h2>
  <div class="tw"><table><tr><th>Unit</th><th>Type</th><th>Status</th><th class="n">${s.type === 'AC' ? 'Area' : 'Slabs'}</th><th class="n">PCI</th><th></th></tr>
  ${s.units.slice().sort((a, b) => Number(a.no) - Number(b.no)).map(u => {
    const r = R.res.find(x => x.unit === u);
    const hasData = (u.entries || []).length || Object.keys(u.slabMarks || {}).length || (u.jointSeal && u.jointSeal !== 'none');
    const st = u.done ? (r.r.pci != null ? '✓ Surveyed' : (r.r.missingDV.length ? 'Surveyed — DV needed' : 'Surveyed — CDV needed')) : (hasData ? 'In progress' : 'Not started');
    return `<tr><td><a href="#/u/${p.id}/${s.id}/${u.id}"><b>${esc(u.no)}</b></a></td><td>${u.kind === 'A' ? 'Additional' : 'Random'}</td><td>${st}${u.inspector && (u.done || hasData) ? `<div class="small muted">${esc(u.inspector)}</div>` : ''}</td><td class="n">${s.type === 'AC' ? fmt(u.area, 0) : esc(u.slabs)}</td><td class="n">${ratingChip(r.pci)}</td><td><a class="btn sm" href="#/u/${p.id}/${s.id}/${u.id}">Survey</a></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No sample units. Generate or add units above.</td></tr>'}</table></div>

  <div class="card"><h3>Section PCI (§11, Eq. 5–7)</h3>
   ${sec.pciS != null ? `<div class="row"><div class="big">${fmt(sec.pciS, 0)}</div>${ratingChip(sec.pciS)}</div>` : '<p class="muted">Complete at least one unit.</p>'}
   <div class="kv"><b>Random units with PCI</b><span>${sec.nR} (area-weighted PCĪr = ${fmt(sec.pciR)})</span>
   <b>Additional units</b><span>${sec.nA} (PCĪa = ${fmt(sec.pciA)}, ΣAa = ${fmt(sec.sumAa, 0)} ${U.area})</span>
   <b>Method</b><span>${esc(sec.eq || '—')}</span>
   <b>Std. dev. of random PCIs, s (Eq. 2)</b><span>${fmt(sec.s)}</span>
   <b>n required with this s</b><span>${sec.nRequired == null ? '—' : sec.nRequired}${sec.nShort ? ` — <b style="color:#9B2C2C">${sec.nShort} more random unit(s) needed (§7.5.2.2)</b>` : ''}</span></div>
   ${ratingBar()}
  </div>
  <div class="row"><button class="btn sec warn" data-act="delSection">Delete section</button></div>`;
}
function ratingBar() { return `<div class="ratingbar">${RATINGS.slice().reverse().map(b => `<div style="background:${b.color}" title="${b.min}–${b.max} ${b.label}"></div>`).join('')}</div><div class="row small muted" style="justify-content:space-between"><span>0 Failed</span><span>Serious</span><span>Very Poor</span><span>Poor</span><span>Fair</span><span>Satisfactory</span><span>Good 100</span></div>`; }

/* ---------- Unit survey ---------- */
function vUnit(p, s, u) {
  if (UI.lastUnit !== u.id) { UI.lastUnit = u.id; UI.tab = 'distress'; }
  const U = UNIT[s.system || 'US'];
  const tabs = [['distress', 'Distress'], ['pci', 'PCI'], ['photos', `Photos (${(u.photos || []).length})`], ['checks', 'Observations'], ['repairs', 'Repairs']];
  let body = '';
  if (UI.tab === 'distress') body = s.type === 'AC' ? acPanel(s, u) : pccPanel(s, u);
  else if (UI.tab === 'pci') body = pciPanel(s, u);
  else if (UI.tab === 'photos') body = photoPanel(s, u);
  else if (UI.tab === 'checks') body = checksPanel(s, u);
  else body = repairPanel(s, u);
  return `<h1>Unit ${esc(u.no)} <span class="muted" style="font-size:14px">${s.type} · ${u.kind === 'A' ? 'Additional' : 'Random'}</span></h1>
  <div class="card"><div class="grid g3">
   ${field('unit', 'no', 'Unit no.', u.no)}${sel('unit', 'kind', 'Selection', u.kind, [['R', 'Random'], ['A', 'Additional (§2.1.1)']])}
   ${s.type === 'AC' ? field('unit', 'area', `Unit area (${U.area})`, u.area, 'number', 'inputmode="text" autocomplete="off"')
     : field('unit', 'slabs', 'No. of slabs', u.slabs, 'number', 'inputmode="numeric"') + field('unit', 'cols', 'Slabs across (lanes)', u.cols, 'number', 'inputmode="numeric"')}
   ${field('unit', 'date', 'Date', u.date, 'date')}${field('unit', 'inspector', 'Inspector', u.inspector)}
   <div><label>Location</label><button class="btn sec sm" data-act="gps">📍 ${u.gps ? `${u.gps.lat.toFixed(5)}, ${u.gps.lon.toFixed(5)} (±${Math.round(u.gps.acc)} m)` : 'Record GPS'}</button></div>
  </div>${s.type === 'AC' ? `<p class="muted small">Area helper: type an expression such as <code>25*100</code> in the area field.</p>` : ''}</div>
  <div class="tabs">${tabs.map(t => `<button class="${UI.tab === t[0] ? 'on' : ''}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div>
  ${body}
  <div class="row" style="margin-top:16px"><button class="btn ${u.done ? '' : 'sec'} sm" data-act="toggleDone">${u.done ? '✓ Surveyed' : 'Mark surveyed'}</button>${navUnits(p, s, u)}<button class="btn sec warn sm" data-act="delUnit">Delete unit</button></div>`;
}
function navUnits(p, s, u) {
  const L = s.units.slice().sort((a, b) => Number(a.no) - Number(b.no)); const k = L.indexOf(u);
  return `${k > 0 ? `<a class="btn sec sm" href="#/u/${p.id}/${s.id}/${L[k - 1].id}">‹ Unit ${esc(L[k - 1].no)}</a>` : ''}${k < L.length - 1 ? `<a class="btn sec sm" href="#/u/${p.id}/${s.id}/${L[k + 1].id}">Unit ${esc(L[k + 1].no)} ›</a>` : ''}`;
}

/* arithmetic keys for phone decimal keypads (no + or * on iOS) */
function keyBtns(id) { return ['+', '×'].map(k => `<button type="button" class="btn sec sm" style="min-width:40px;font-size:18px" data-act="key" data-target="${id}" data-k="${k}">${k}</button>`).join(''); }
/* AC distress panel */
function acPanel(s, u) {
  const d = UI.acCode ? dist('AC', UI.acCode) : null;
  const recent = (S.settings.recentAC || []).slice(0, 8);
  const entries = (u.entries || []);
  const warn = acWarnings(u);
  return `<div class="card"><h3>Add distress</h3>
   ${recent.length ? `<div class="row" style="margin-bottom:8px">${recent.map(c => `<button class="btn sec sm" data-act="pickAC" data-code="${c}">${c} ${esc(dist('AC', c).name.split(' ')[0])}</button>`).join('')}</div>` : ''}
   <label>Distress type</label><select id="acCode" data-act-change="acCode"><option value="">— select —</option>${CATALOG.AC.map(x => `<option value="${x.code}" ${UI.acCode == x.code ? 'selected' : ''}>${x.code}. ${esc(x.name)}</option>`).join('')}</select>
   ${d ? `<div class="help"><b>${d.code}. ${esc(d.name)}</b> (${d.ref}) — measure in <b>${qtyUnit(s, d)}</b>. ${esc(d.tip)}</div>
   <div class="row"><div class="seg">${['L', 'M', 'H', 'N'].filter(x => d.sev.includes(x)).map(x => `<button data-act="acSev" data-sev="${x}" class="${UI.acSev === x ? 'on' : ''}">${x === 'N' ? 'Present' : x}</button>`).join('')}</div>
   ${d.helper ? `<button class="btn sec sm" data-act="helper" data-h="${d.helper}">Severity helper</button>` : ''}${d.ride ? `<button class="btn sec sm" data-act="helper" data-h="ride">Ride-quality guide</button>` : ''}</div>
   <div class="row" style="margin-top:8px"><div class="grow"><label>Quantity (${qtyUnit(s, d)}) — e.g. <code>5+4+4</code> or <code>12*3</code></label><div class="row" style="flex-wrap:nowrap"><input id="acQty" class="grow" inputmode="decimal" autocomplete="off" placeholder="0">${keyBtns('acQty')}</div></div>
   <div class="grow"><label>Note (optional)</label><input id="acNote" placeholder="location / remark"></div></div>
   <div class="row" style="margin-top:8px"><button class="btn" data-act="addAC">Add entry</button><span class="muted small">Entries of the same type and severity are summed (§9.1).</span></div>` : ''}
  </div>
  ${warn.map(w => `<div class="note">⚠ ${w}</div>`).join('')}
  <h3>Recorded entries (${entries.length})</h3>
  <div class="tw"><table><tr><th>Distress</th><th>Sev</th><th class="n">Qty</th><th>Input</th><th>Note</th><th></th></tr>
  ${entries.map(e => { const dd = dist('AC', e.code); return `<tr><td>${e.code}. ${esc(dd.name)}</td><td>${sevLabel(e.sev)}</td><td class="n">${fmt(e.qty, 2)} ${qtyUnit(s, dd)}</td><td class="small muted">${esc(e.expr || '')}</td><td class="small">${esc(e.note || '')}</td><td><button class="btn sec sm" data-act="delEntry" data-id="${e.id}">✕</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">None yet. A unit with no distress has PCI 100 — mark it complete on the PCI tab.</td></tr>'}</table></div>
  ${area('unit', 'notes', 'Unit field notes', u.notes)}`;
}
function acWarnings(u) {
  const has = (c, sevs) => (u.entries || []).some(e => e.code === c && (!sevs || sevs.includes(e.sev)));
  const w = [];
  if (has(2) && has(12)) w.push('Bleeding and polished aggregate both recorded: polished aggregate is not counted where bleeding is counted (X1.1.2, X1.16.2). Confirm they are in different areas.');
  if (has(19, ['M', 'H']) && has(20)) w.push('Raveling (M/H) and weathering both recorded: weathering is not recorded where raveling is recorded (X1.23.2, X1.24.2). Confirm they are in different areas.');
  if (has(11)) w.push('Patching recorded: make sure no distress inside the patch was entered separately (X1.15.2).');
  return w;
}

/* PCC slab panel */
function pccPanel(s, u) {
  const n = Number(u.slabs) || 20, cols = Math.max(1, Number(u.cols) || 2), rows = Math.ceil(n / cols);
  const marks = u.slabMarks || {};
  let cells = '';
  for (let r = rows; r >= 1; r--) for (let c = 1; c <= cols; c++) {
    const idx = (r - 1) * cols + c; if (idx > n) { cells += '<div></div>'; continue; }
    const key = `${r}-${c}`, m = marks[key] || {}, codes = Object.keys(m);
    const div = m[23] === 'M' || m[23] === 'H';
    cells += `<button class="slab ${codes.length ? 'has' : ''} ${div ? 'div' : ''}" data-act="slab" data-key="${key}"><span class="no">${key}</span><div class="tags">${codes.map(cd => `${cd}${m[cd] === 'N' ? '' : m[cd] === 'M2' ? 'M×2' : m[cd]}`).join(' ')}</div></button>`;
  }
  const {counts, notes} = PCI.pccSlabCounts(u);
  return `<div class="card"><h3>Unit-level items</h3><div class="grid g3">
   <div><label>26 Joint seal damage (whole unit)</label><select data-obj="unit" data-k="jointSeal">${[['none', 'None'], ['L', 'L — generally good'], ['M', 'M — generally fair'], ['H', 'H — generally poor']].map(o => `<option value="${o[0]}" ${(u.jointSeal || 'none') === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
   ${field('unit', 'pumpExtra', '33 Pumping: extra pumping joints (+1 slab each)', u.pumpExtra || 0, 'number', 'inputmode="numeric" min="0"')}
  </div><div class="help">Tap a slab to record its distresses. Rows are numbered from the start of the unit; slab key = row-lane. Joint seal is rated once for the unit (X2.8.3).</div></div>
  <div class="slabgrid" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>
  ${notes.map(x => `<div class="note">${esc(x)}</div>`).join('')}
  <h3>Slab counts by distress and severity</h3>
  <div class="tw"><table><tr><th>Distress</th><th>Sev</th><th class="n">Slabs</th><th class="n">Density %</th></tr>
  ${Object.keys(counts).sort((a, b) => parseInt(a) - parseInt(b)).map(k => { const [c, sv] = k.split('|'); return `<tr><td>${c}. ${esc(dist('PCC', c).name)}</td><td>${sevLabel(sv)}</td><td class="n">${counts[k]}</td><td class="n">${fmt(counts[k] / n * 100, 1)}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">No slab distress recorded.</td></tr>'}</table></div>
  ${area('unit', 'notes', 'Unit field notes', u.notes)}`;
}
function slabModal(s, u, key) {
  const m = (u.slabMarks || {})[key] || {};
  return `<h2 style="margin-top:0">Slab ${key}</h2><p class="muted small">Tap a severity to record; tap again to clear. One severity per distress per slab (highest governs).</p>
  ${CATALOG.PCC.filter(d => d.code !== 26).map(d => {
    const opts = d.sev.includes('N') ? ['N'] : d.code === 28 ? ['L', 'M', 'M2', 'H'] : d.sev;
    return `<div class="dl"><div class="nm"><b>${d.code}</b> ${esc(d.name)} <a href="#" data-act="tip" data-type="PCC" data-code="${d.code}" class="small">ⓘ</a>${d.helper ? ` <a href="#" data-act="helper" data-h="${d.helper}" class="small">helper</a>` : ''}</div>
    <div class="seg">${opts.map(o => `<button data-act="slabSev" data-key="${key}" data-code="${d.code}" data-sev="${o}" class="${m[d.code] === o ? 'on' : ''}">${o === 'N' ? '✓' : o === 'M2' ? 'M×2' : o}</button>`).join('')}</div></div>`;
  }).join('')}
  <div class="row" style="margin-top:12px"><button class="btn" data-act="closeModal">Done</button><button class="btn sec" data-act="clearSlab" data-key="${key}">Clear slab</button><button class="btn sec" data-act="copyPrev" data-key="${key}">Copy previous slab</button></div>`;
}

/* PCI panel */
function pciPanel(s, u) {
  const R = PCI.unitPCI(s, u, S.curveLib);
  const c = R.calc;
  const totalTxt = s.type === 'AC' ? `Unit area = ${fmt(R.area, 1)} ${UNIT[s.system || 'US'].area}` : `Slabs in unit = ${u.slabs || '—'}`;
  return `<div class="card"><h3>Distress, density and deduct values (§9.1–9.3 / §10.1–10.3)</h3><p class="muted small">${totalTxt}. Blank DV = no curve in library: read the DV from the licensed curve and type it in. A typed value overrides the curve.</p>
  <div class="tw"><table><tr><th>Distress</th><th>Sev</th><th class="n">Qty</th><th class="n">Density %</th><th class="n">DV</th><th>Source</th></tr>
  ${R.rows.map(x => { const d = dist(s.type, x.code); return `<tr><td>${x.code}. ${esc(d.name)}</td><td>${sevLabel(x.sev)}</td><td class="n">${x.qty == null ? '—' : fmt(x.qty, s.type === 'AC' ? 2 : 0)}</td><td class="n">${x.density == null ? (x.code === 26 ? 'unit' : '—') : fmt(x.density, 2)}</td>
   <td class="n" style="width:90px"><input style="padding:4px 6px;text-align:right" inputmode="decimal" data-act-change="dvOv" data-key="${x.key}" value="${(u.dvOverride || {})[x.key] ?? ''}" placeholder="${x.src === 'curve' || x.src === 'fixed' || x.src.startsWith('curve') ? fmt(x.dv) : '?'}"></td><td class="small ${x.src === 'missing' ? 'err' : ''}">${x.src}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No distress recorded.</td></tr>'}</table></div>
  ${R.notes.map(n => `<div class="note">${esc(n)}</div>`).join('')}</div>
  <div class="card"><h3>Maximum CDV (§9.5)</h3>
  ${c.sorted.length ? `<p>Deducts (descending): ${c.sorted.map(v => fmt(v)).join(', ')}</p>` : ''}
  ${c.m != null ? `<p>m = 1 + (9/98)(100 − HDV) = 1 + (9/98)(100 − ${fmt(c.hdv)}) = <b>${fmt(c.m)}</b> → deducts used: ${c.used.map(v => fmt(v, 2)).join(', ')}</p>` : ''}
  <p class="muted small">${esc(c.rule || 'Iterate: TDV, q = number of deducts > 2.0, CDV from correction curve; reduce the smallest deduct > 2.0 to 2.0 until q = 1.')}</p>
  ${c.iterations.length ? `<div class="tw"><table><tr><th>#</th><th>Deducts</th><th class="n">TDV</th><th class="n">q</th><th class="n">CDV</th></tr>
   ${c.iterations.map((it, k) => `<tr><td>${k + 1}</td><td class="small">${it.dvs.map(v => fmt(v, v % 1 ? 2 : 1)).join(', ')}</td><td class="n">${fmt(it.tdv)}</td><td class="n">${it.q}</td>
   <td class="n" style="width:90px">${it.src === 'q=1' || it.src === 'TDV' ? fmt(it.cdv) : `<input style="padding:4px 6px;text-align:right" inputmode="decimal" data-act-change="cdvOv" data-it="${k}" value="${(u.cdvOverride || {})[k] ?? ''}" placeholder="${it.cdv == null ? '?' : fmt(it.cdv)}">`}</td></tr>`).join('')}</table></div>` : ''}
  ${R.missingDV.length ? `<div class="err">Deduct value needed for: ${R.missingDV.join(', ')}</div>` : (!c.complete ? '<div class="err">Enter the CDV for each iteration marked “?” (read from Fig. X3.27 AC / X4.20 PCC), or load correction curves.</div>' : '')}
  </div>
  <div class="card"><h3>Result</h3><div class="row" style="margin-bottom:8px"><button class="btn ${u.done ? '' : 'sec'}" data-act="toggleDone">${u.done ? '✓ Unit surveyed — included in section PCI' : 'Mark unit as surveyed'}</button></div>${!u.done ? '<div class="note">This unit is not yet marked as surveyed, so it is excluded from the section PCI. A surveyed unit with no distress has PCI = 100.</div>' : ''}${R.pci != null ? `<div class="row"><div class="big">${fmt(R.pci, 0)}</div>${ratingChip(R.pci)}</div><p>PCI = 100 − max CDV = 100 − ${fmt(c.maxCdv)} = <b>${fmt(R.pci)}</b></p>` : '<p class="muted">Incomplete.</p>'}${ratingBar()}</div>`;
}

/* photos, observations, repairs */
function photoPanel(s, u) {
  return `<div class="card"><div class="row"><label class="btn" style="margin:0">📷 Take / add photos<input type="file" accept="image/*" capture="environment" multiple data-act-change="addPhotos" style="display:none"></label>
  <span class="muted small">Photos are resized to 1600 px and stored on the device with time and GPS (if allowed).</span></div></div>
  <div class="photos">${(u.photos || []).map(ph => `<figure><img data-photo="${ph.id}" alt=""><figcaption>
   <select data-act-change="phCode" data-id="${ph.id}" style="font-size:12px;padding:3px"><option value="">General</option>${CATALOG[s.type].map(d => `<option value="${d.code}" ${ph.code == d.code ? 'selected' : ''}>${d.code}. ${esc(d.name)}</option>`).join('')}</select>
   <select data-act-change="phSev" data-id="${ph.id}" style="font-size:12px;padding:3px;margin-top:3px">${['', 'L', 'M', 'H'].map(v => `<option ${ph.sev === v ? 'selected' : ''} value="${v}">${v || 'Severity —'}</option>`).join('')}</select>
   <input data-act-change="phCap" data-id="${ph.id}" value="${esc(ph.caption || '')}" placeholder="Caption" style="font-size:12px;padding:4px;margin-top:3px">
   <button class="btn sec sm" data-act="delPhoto" data-id="${ph.id}" style="margin-top:3px">Delete</button></figcaption></figure>`).join('') || '<p class="muted">No photos.</p>'}</div>`;
}
function checksPanel(s, u) {
  const sup = u.supp || {};
  return `<div class="card"><h3>Supplementary observations (not part of PCI)</h3><p class="muted small">These are reported separately: PCI does not measure drainage, structural capacity, friction or roughness (§1.2, §4.1).</p>
  ${SUPPLEMENTAL.map((t, k) => `<label style="text-transform:none;font-size:15px;color:var(--ink);font-weight:500;padding:6px 0"><input type="checkbox" data-act-change="supp" data-k="${k}" ${sup[k] ? 'checked' : ''}>${esc(t)}</label>`).join('')}
  ${area('unit', 'suppNotes', 'Observation notes', u.suppNotes)}</div>
  <div class="card"><h3>Ride check</h3><div class="grid g3">${sel('unit', 'ride', 'Overall ride quality', u.ride || '', [['', '—'], ['L', 'L — vibrations noticeable'], ['M', 'M — some speed reduction'], ['H', 'H — considerable speed reduction']])}${sel('unit', 'drainage', 'Drainage', u.drainage || '', [['', '—'], ['Good', 'Good'], ['Fair', 'Fair'], ['Poor', 'Poor']])}</div></div>`;
}
function repairPanel(s, u) {
  const rp = u.repairs || [];
  return `<div class="card"><h3>Repair quantity log</h3><p class="muted small">Measured repair quantities for the report and cost opinion. PCI densities are not repair quantities.</p>
  <div class="grid g3"><div><label>Item</label><select id="rpItem">${REPAIR_ITEMS.map((r, k) => `<option value="${k}">${esc(r.item)} (${r.unit || '—'})</option>`).join('')}</select></div>
  <div><label>Quantity (e.g. 4*6+3*3)</label><div class="row" style="flex-wrap:nowrap"><input id="rpQty" class="grow" inputmode="decimal" autocomplete="off">${keyBtns('rpQty')}</div></div><div><label>Note / location</label><input id="rpNote"></div></div>
  <div class="row" style="margin-top:8px"><button class="btn" data-act="addRepair">Add</button></div></div>
  <div class="tw"><table><tr><th>Item</th><th class="n">Qty</th><th>Unit</th><th>Note</th><th></th></tr>
  ${rp.map(r => `<tr><td>${esc(r.item)}</td><td class="n">${fmt(r.qty, 1)}</td><td>${esc(r.unit)}</td><td class="small">${esc(r.note || '')}</td><td><button class="btn sec sm" data-act="delRepair" data-id="${r.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">None.</td></tr>'}</table></div>`;
}

/* ============================ severity helpers ============================ */
const HELPERS = {
  ride: {title: 'Ride-quality severity (X1.4.6 / X2.2.2)', html: `<div class="help">Drive at the normal operating (posted) speed in a typical sedan; near stop signs use deceleration speed.<br><b>L</b>: vibrations noticeable, no speed reduction needed; bumps cause slight bounce, little discomfort.<br><b>M</b>: significant vibrations, some speed reduction for safety/comfort; significant bounce, some discomfort.<br><b>H</b>: excessive vibrations, speed reduced considerably; excessive bounce, substantial discomfort, safety hazard or vehicle damage potential.</div>`, calc: null},
  depression: {title: 'Depression — maximum depth', inputs: [['d', 'Max depth (mm)']], calc: v => v.d < 13 ? 'not counted (<13 mm)' : v.d <= 25 ? 'L' : v.d <= 50 ? 'M' : 'H'},
  dropoff: {title: 'AC lane/shoulder drop-off', inputs: [['d', 'Elevation difference (mm)']], calc: v => v.d <= 25 ? 'not counted (≤25 mm)' : v.d < 50 ? 'L' : v.d < 100 ? 'M' : 'H'},
  dropoffpcc: {title: 'PCC lane/shoulder drop-off (mean of max & min)', inputs: [['a', 'Max drop (mm)'], ['b', 'Min drop (mm)']], calc: v => { const d = (v.a + v.b) / 2; return `mean ${d.toFixed(0)} mm → ` + (d <= 25 ? 'not counted' : d <= 50 ? 'L' : d <= 100 ? 'M' : 'H'); }},
  rut: {title: 'Rutting — mean depth', inputs: [['list', 'Depths along rut (mm), comma-separated', 'text']], calc: v => { const a = String(v.listRaw).split(/[ ,;]+/).map(Number).filter(x => !isNaN(x) && x > 0); if (!a.length) return '—'; const m = a.reduce((x, y) => x + y, 0) / a.length; return `mean ${m.toFixed(1)} mm → ` + (m < 6 ? 'not counted' : m <= 13 ? 'L' : m <= 25 ? 'M' : 'H'); }},
  slippage: {title: 'Slippage cracking', inputs: [['w', 'Average crack width (mm)']], checks: [['sp', 'Moderately spalled or secondary cracks'], ['br', 'Broken into easily removed pieces']], calc: v => (v.w > 40 || v.br) ? 'H' : (v.w >= 10 || v.sp) ? 'M' : 'L'},
  accrack: {title: 'AC crack severity (X1.12 / X1.14)', inputs: [['w', 'Unfilled crack width (mm) — 0 if filled']], checks: [['filled', 'Filled, filler satisfactory'], ['light', 'Light secondary / random cracking'], ['heavy', 'Medium or high secondary / random cracking'], ['broken', '~100 mm (4 in.) around crack severely raveled/broken']],
    calc: v => { if (v.heavy || v.broken || (!v.filled && v.w > 75)) return 'H'; if (v.light || (!v.filled && v.w >= 10)) return 'M'; return 'L'; }},
  pothole: {title: 'Pothole severity (Table X1.1)', inputs: [['dia', 'Average diameter (mm)'], ['dep', 'Maximum depth (mm)']],
    calc: v => { if (v.dia > 750) return `>750 mm: count area ÷ 0.5 m² as equivalent holes, severity ${v.dep <= 25 ? 'M' : 'H'}`; if (v.dia < 100 || v.dep < 13) return 'not counted (below Table X1.1 limits)';
      const col = v.dia <= 200 ? 0 : v.dia <= 450 ? 1 : 2, row = v.dep <= 25 ? 0 : v.dep <= 50 ? 1 : 2; return [['L', 'L', 'M'], ['L', 'M', 'H'], ['M', 'M', 'H']][row][col]; }},
  ravel: {title: 'Raveling (dense mix)', inputs: [['c', 'Missing particles per m² (avg of 3 areas)']], checks: [['cl', 'Clusters of coarse aggregate missing'], ['pit', 'Very rough and pitted / surface removed in places']], calc: v => v.pit ? 'H' : (v.c > 20 || v.cl) ? 'M' : 'not counted (no L level)'},
  fault: {title: 'Faulting (Table X2.2)', inputs: [['d', 'Elevation difference across joint (mm)']], calc: v => v.d <= 3 ? 'not counted (≤3 mm)' : v.d < 10 ? 'L' : v.d < 20 ? 'M' : 'H'},
  pcccrack: {title: 'PCC crack severity (X2.4.1 / X2.10)', inputs: [['w', 'Unfilled width (mm) — 0 if filled'], ['f', 'Faulting across crack (mm)']], checks: [['reinf', 'Reinforced slab'], ['filled', 'Filled, filler satisfactory']],
    calc: v => { if (v.reinf) { if (v.f > 10 || (!v.filled && v.w > 75)) return 'H'; if (v.f > 0 || (!v.filled && v.w >= 25)) return 'M'; return (!v.filled && v.w < 3) ? 'shrinkage crack (<3 mm)' : 'L'; }
      if (v.f > 10 || (!v.filled && v.w > 50)) return 'H'; if (v.f > 0 || (!v.filled && v.w > 13)) return 'M'; return 'L'; }},
  divided: {title: 'Divided slab (Table X2.1)', inputs: [['n', 'Number of pieces']], selects: [['s', 'Severity of majority of cracks', ['L', 'M', 'H']]],
    calc: v => { if (v.n < 4) return 'not divided (<4 pieces) — use linear cracking'; const c = v.n <= 5 ? 0 : v.n <= 8 ? 1 : 2; return {L: ['L', 'L', 'M'], M: ['L', 'M', 'H'], H: ['M', 'H', 'H']}[v.s][c]; }},
  punchout: {title: 'Punchout (Table X2.3)', inputs: [['n', 'Number of pieces']], selects: [['s', 'Severity of majority of cracks', ['L', 'M', 'H']]],
    calc: v => { const c = v.n <= 3 ? 0 : v.n <= 5 ? 1 : 2; return {L: ['L', 'L', 'M'], M: ['L', 'M', 'H'], H: ['M', 'H', 'H']}[v.s][c]; }},
  cornerspall: {title: 'Corner spalling (Table X2.4)', inputs: [['a', 'Side length 1 (mm)'], ['b', 'Side length 2 (mm)'], ['d', 'Depth (mm)']],
    calc: v => { if (v.a < 130 && v.b < 130) return 'not counted (<130 mm both sides)'; const big = v.a > 300 && v.b > 300 ? 1 : 0, row = v.d < 25 ? 0 : v.d <= 50 ? 1 : 2; return [['L', 'L'], ['L', 'M'], ['M', 'H']][row][big]; }},
  jointspall: {title: 'Joint spalling (Table X2.5)', inputs: [['w', 'Width of spall (mm)'], ['l', 'Length of spall (mm)']], selects: [['p', 'Spall pieces', ['Tight', 'Loose', 'Missing']]],
    calc: v => { const long = v.l > 500 ? 1 : 0, wide = v.w > 100 ? 1 : 0; const t = {Tight: [['L', 'L'], ['L', 'L']], Loose: [['L', 'M'], ['L', 'M']], Missing: [['L', 'M'], ['M', 'H']]}; return t[v.p][wide][long]; }}
};
function helperModal(id) {
  const h = HELPERS[id]; if (!h) return '';
  if (!h.calc) return `<h2 style="margin-top:0">${h.title}</h2>${h.html}<button class="btn" data-act="closeModal">Close</button>`;
  return `<h2 style="margin-top:0">${h.title}</h2><div class="grid g2" id="hlp" data-h="${id}">
   ${(h.inputs || []).map(i => `<div><label>${i[1]}</label><input data-hk="${i[0]}" inputmode="${i[2] === 'text' ? 'text' : 'decimal'}" data-act-input="hcalc"></div>`).join('')}
   ${(h.selects || []).map(i => `<div><label>${i[1]}</label><select data-hk="${i[0]}" data-act-change="hcalc">${i[2].map(o => `<option>${o}</option>`).join('')}</select></div>`).join('')}
   ${(h.checks || []).map(i => `<label style="text-transform:none;font-size:14px;color:var(--ink)"><input type="checkbox" data-hk="${i[0]}" data-act-change="hcalc">${i[1]}</label>`).join('')}
  </div><div class="okb" id="hres">Enter values…</div><p class="muted small">Inch values: 1 in. = 25.4 mm. Helper applies the paraphrased criteria; the standard governs.</p>
  <div class="row"><button class="btn" data-act="useHelper">Use this severity</button><button class="btn sec" data-act="closeModal">Close</button></div>`;
}
function helperCompute() {
  const box = $('#hlp'); if (!box) return null; const h = HELPERS[box.dataset.h]; const v = {};
  box.querySelectorAll('[data-hk]').forEach(el => { const k = el.dataset.hk; if (el.type === 'checkbox') v[k] = el.checked; else if (el.tagName === 'SELECT') v[k] = el.value; else { v[k] = Number(el.value) || 0; v[k + 'Raw'] = el.value; } });
  let r; try { r = h.calc(v); } catch (e) { r = '—'; }
  $('#hres').textContent = 'Severity: ' + r; return r;
}

/* ============================ curve library ============================ */
function libStatus() {
  const L = S.curveLib; if (!L) return {n: 0, badge: '<span class="chip" style="background:#FBEDED;color:#9B2C2C">none</span>'};
  let n = 0; ['AC', 'AC_SI', 'PCC', 'CDV_AC', 'CDV_PCC'].forEach(k => { const o = L[k] || {}; Object.values(o).forEach(v => { n += Array.isArray(v) ? 1 : Object.keys(v).length; }); });
  return {n, badge: `<span class="chip" style="background:#EDF6F1;color:#1E7B3A">${n} curves</span>`};
}
function curveTemplate() {
  const t = {name: 'My curve library', source: 'Digitised by the licensee from ASTM D6433-24 Appendices X3/X4 (licensed copy). Points are [density %, deduct]; CDV curves are [TDV, CDV].', created: today(),
    AC: {}, AC_SI: {}, PCC: {}, CDV_AC: {}, CDV_PCC: {}};
  CATALOG.AC.forEach(d => { t.AC[d.code] = {}; d.sev.forEach(s => t.AC[d.code][s] = []); });
  AC_UNIT_SENSITIVE.forEach(c => { t.AC_SI[c] = {}; dist('AC', c).sev.forEach(s => t.AC_SI[c][s] = []); });
  CATALOG.PCC.filter(d => d.code !== 26).forEach(d => { t.PCC[d.code] = {}; d.sev.forEach(s => t.PCC[d.code][s] = []); });
  for (let q = 2; q <= 7; q++) t.CDV_AC[q] = []; for (let q = 2; q <= 9; q++) t.CDV_PCC[q] = [];
  return t;
}
function vCurves() {
  const cs = UI.curveSel; const L = S.curveLib || {};
  const isCDV = cs.set.startsWith('CDV');
  const codes = cs.set === 'AC' ? CATALOG.AC : cs.set === 'AC_SI' ? CATALOG.AC.filter(d => AC_UNIT_SENSITIVE.includes(d.code)) : cs.set === 'PCC' ? CATALOG.PCC.filter(d => d.code !== 26) : [];
  const d = !isCDV ? (codes.find(x => x.code == cs.code) || codes[0]) : null;
  if (d && !d.sev.includes(cs.sev)) cs.sev = d.sev[0];
  if (d) cs.code = d.code;
  const qs = cs.set === 'CDV_AC' ? [2, 3, 4, 5, 6, 7] : [2, 3, 4, 5, 6, 7, 8, 9];
  if (isCDV && !qs.includes(Number(cs.q))) cs.q = 2;
  const pts = isCDV ? ((L[cs.set] || {})[cs.q] || []) : (((L[cs.set] || {})[cs.code] || {})[cs.sev] || []);
  return `<h1>Deduct-value curve library</h1>
  <div class="note">ASTM D6433 deduct-value and correction curves are copyrighted figures and are <b>not</b> shipped with this app. Build your library once from your licensed copy (digitise each curve into a few [x, y] points), or import a library file. With no library, enter DV/CDV manually on each unit's PCI tab.</div>
  <div class="card"><div class="row"><span>Status: ${libStatus().badge}</span>${S.curveLib ? `<span class="muted small">${esc(S.curveLib.name || '')}</span>` : ''}</div>
  <div class="row" style="margin-top:8px"><label class="btn sec" style="margin:0">Import library (.json)<input type="file" accept=".json,application/json" data-act-change="importLib" style="display:none"></label>
  <button class="btn sec" data-act="exportLib" ${S.curveLib ? '' : 'disabled'}>Export library</button><button class="btn sec" data-act="templateLib">Download blank template</button>
  <button class="btn sec" data-act="newLib" ${S.curveLib ? 'disabled' : ''}>Start empty library</button><button class="btn sec warn" data-act="clearLib" ${S.curveLib ? '' : 'disabled'}>Remove library</button></div></div>
  ${S.curveLib ? `<div class="card"><h3>Edit a curve</h3><div class="grid g3">
   <div><label>Set</label><select data-act-change="cvSet">${[['AC', 'AC deduct curves (US / all area & count)'], ['AC_SI', 'AC metric curves (linear distresses, potholes)'], ['PCC', 'PCC deduct curves'], ['CDV_AC', 'AC correction curves (Fig. X3.27)'], ['CDV_PCC', 'PCC correction curves (Fig. X4.20)']].map(o => `<option value="${o[0]}" ${cs.set === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
   ${isCDV ? `<div><label>q</label><select data-act-change="cvQ">${qs.map(q => `<option ${cs.q == q ? 'selected' : ''}>${q}</option>`).join('')}</select></div>`
     : `<div><label>Distress</label><select data-act-change="cvCode">${codes.map(x => `<option value="${x.code}" ${cs.code == x.code ? 'selected' : ''}>${x.code}. ${esc(x.name)}</option>`).join('')}</select></div>
        <div><label>Severity</label><select data-act-change="cvSev">${d.sev.map(s => `<option value="${s}" ${cs.sev === s ? 'selected' : ''}>${s === 'N' ? 'single curve' : s}</option>`).join('')}</select></div>`}
  </div>
  <label style="margin-top:8px">Points — one per line: ${isCDV ? 'TDV, CDV' : 'density %, deduct value'} ${cs.set.startsWith('AC') ? '(AC curves interpolate on a log-density axis)' : ''}</label>
  <textarea id="cvPts" style="min-height:150px;font-family:ui-monospace,monospace">${pts.map(p => p.join(', ')).join('\n')}</textarea>
  <div class="row" style="margin-top:8px"><button class="btn" data-act="saveCurve">Save curve</button><span class="muted small">${pts.length} point(s)</span></div>
  <svg class="curve" id="cvSvg" viewBox="0 0 400 180"></svg></div>` : ''}`;
}
function drawCurvePreview() {
  const svg = $('#cvSvg'); if (!svg) return;
  const cs = UI.curveSel, L = S.curveLib || {}, isCDV = cs.set.startsWith('CDV');
  const pts = isCDV ? ((L[cs.set] || {})[cs.q] || []) : (((L[cs.set] || {})[cs.code] || {})[cs.sev] || []);
  const logx = cs.set === 'AC' || cs.set === 'AC_SI';
  const xmin = logx ? -1 : 0, xmax = logx ? 2 : (isCDV ? 200 : 100);
  const X = v => 30 + 360 * (((logx ? Math.log10(Math.max(v, 0.1)) : v) - xmin) / (xmax - xmin)), Y = v => 165 - 150 * v / 100;
  let s = `<line x1="30" y1="165" x2="390" y2="165" stroke="#999"/><line x1="30" y1="15" x2="30" y2="165" stroke="#999"/>`;
  [0, 25, 50, 75, 100].forEach(v => s += `<text x="4" y="${Y(v) + 4}" font-size="9" fill="#777">${v}</text><line x1="30" x2="390" y1="${Y(v)}" y2="${Y(v)}" stroke="#eee"/>`);
  (logx ? [0.1, 1, 10, 100] : isCDV ? [0, 50, 100, 150, 200] : [0, 25, 50, 75, 100]).forEach(v => s += `<text x="${X(v) - 6}" y="177" font-size="9" fill="#777">${v}</text>`);
  if (pts.length) {
    const sp = pts.slice().sort((a, b) => a[0] - b[0]);
    s += `<polyline fill="none" stroke="#1F3A5F" stroke-width="2" points="${sp.map(p => X(p[0]) + ',' + Y(p[1])).join(' ')}"/>`;
    sp.forEach(p => s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3" fill="#B7791F"/>`);
  }
  svg.innerHTML = s;
}

/* ============================ settings / help ============================ */
function vSettings() {
  return `<h1>Settings &amp; backup</h1>
  <div class="card"><div class="grid g2">${field('settings', 'inspector', 'Default inspector', S.settings.inspector)}${field('settings', 'firm', 'Firm (report header)', S.settings.firm)}
  ${sel('settings', 'units', 'Default unit system', S.settings.units, [['US', 'US customary'], ['SI', 'SI']])}${sel('settings', 'type', 'Default pavement type', S.settings.type, [['AC', 'AC'], ['PCC', 'PCC']])}</div></div>
  <div class="card"><h3>Backup &amp; restore</h3><p class="muted small">Data live only in this browser on this device. A backup file contains all projects, photos and the curve library. Restore merges projects by ID. To move <i>one</i> project between devices (iPhone ↔ desktop), use Export project file on the project page and Import project on the Home screen; a report package .zip also imports.</p>
  <div class="row"><button class="btn" data-act="backup">Download full backup (.json)</button><label class="btn sec" style="margin:0">Restore from backup<input type="file" accept=".json,application/json" data-act-change="restore" style="display:none"></label></div>
  <p class="muted small" id="usage"></p></div>
  <div class="card"><h3>Demo &amp; validation</h3><p class="muted small">Loads a project that reproduces the ASTM D6433-24 worked examples (Figs. 4–8) with the standard's deduct and corrected deduct values entered as manual values. Expected result: PCI 49 for both units.</p>
  <button class="btn sec" data-act="demo">Load demo project</button></div>
  <div class="card"><h3>Install</h3><p class="small">iPhone/iPad: open in Safari → Share → <b>Add to Home Screen</b>. Android: Chrome menu → <b>Install app</b>. Windows/Mac: Chrome/Edge address bar install icon, or menu → <b>Install PCI Survey</b>.</p>
  <button class="btn sec" data-act="install" id="installBtn" ${window.__deferredPrompt ? '' : 'disabled'}>Install now</button></div>
  <div class="card"><h3>Danger zone</h3><button class="btn warn" data-act="wipe">Delete all data on this device</button></div>`;
}
function vHelp() {
  return `<h1>Quick help</h1><div class="card small">
  <p><b>Workflow:</b> Project → Section (type, units, area, N) → Sampling plan (Eq. 1, generate units) → Unit survey (Distress, Photos, Observations, Repairs) → PCI tab (DV/CDV) → Section PCI → Report &amp; export.</p>
  <p><b>AC:</b> pick the distress, tap a severity, type the quantity (expressions like <code>5+4+4</code> are summed), Add. Use <b>Severity helper</b> for measured thresholds.</p>
  <p><b>PCC:</b> tap a slab, tap severities; the app counts slabs, promotes two M linear cracks to H and suppresses other distress in M/H divided slabs.</p>
  <p><b>Deduct values:</b> load a curve library (Deduct curves) or type DV and CDV on the PCI tab.</p>
  <p><b>Rating scale (Fig. 1):</b> 85–100 Good · 70–85 Satisfactory · 55–70 Fair · 40–55 Poor · 25–40 Very Poor · 10–25 Serious · 0–10 Failed.</p>
  <p>See the PCI Survey User Manual (PDF) for full instructions. The licensed ASTM D6433-24 governs all definitions.</p></div>`;
}

/* ============================ report ============================ */
function projectData(p) {
  return p.sections.map(s => {
    const R = sectionResult(s);
    const rand = R.res.filter(x => x.unit.kind !== 'A' && x.pci != null);
    const sumAr = rand.reduce((a, x) => a + x.area, 0);
    const agg = {}; // distress totals over random units, extrapolated
    rand.forEach(x => x.r.rows.forEach(row => { if (row.qty == null) return; const k = row.code + '|' + row.sev; agg[k] = (agg[k] || 0) + row.qty; }));
    const factor = sumAr > 0 && Number(s.area) > 0 ? Number(s.area) / sumAr : null;
    const dvTot = {}; R.res.forEach(x => x.r.rows.forEach(row => { if (row.dv != null) dvTot[row.code] = (dvTot[row.code] || 0) + row.dv; }));
    const top = Object.keys(dvTot).sort((a, b) => dvTot[b] - dvTot[a]).slice(0, 3).map(c => dist(s.type, c).name.toLowerCase());
    const supp = {}; s.units.forEach(u => Object.keys(u.supp || {}).forEach(k => { if (u.supp[k]) supp[k] = (supp[k] || 0) + 1; }));
    const rep = {}; s.units.forEach(u => (u.repairs || []).forEach(r => { const k = r.item + '|' + r.unit; rep[k] = (rep[k] || 0) + Number(r.qty || 0); }));
    return {s, R, agg, factor, top, supp, rep};
  });
}
function narrative(p, D) {
  const done = D.filter(x => x.R.sec.pciS != null);
  if (!done.length) return 'No sections have a computed PCI yet.';
  const parts = done.map(x => { const b = PCI.rating(x.R.sec.pciS); return `${x.s.branch || ''} ${x.s.name} (${x.s.type}) has a section PCI of ${fmt(x.R.sec.pciS, 0)}, rated ${b.label}${x.top.length ? `; the largest deducts come from ${x.top.join(', ')}` : ''}.`; });
  const totA = done.reduce((a, x) => a + (Number(x.s.area) || 0), 0);
  const wtd = totA > 0 ? done.reduce((a, x) => a + x.R.sec.pciS * (Number(x.s.area) || 0), 0) / totA : null;
  return `${S.settings.firm || 'The surveyor'} surveyed ${done.length} pavement section(s) at ${p.location || 'the site'} in general accordance with ASTM D6433-24. ${parts.join(' ')} ${wtd != null ? `The area-weighted PCI of the surveyed sections is ${fmt(wtd, 0)} (${PCI.rating(wtd).label}).` : ''} The PCI indicates surface condition and does not directly measure structural capacity, skid resistance or roughness (ASTM D6433 §1.2).`;
}
function vReport(p) {
  const D = projectData(p);
  const U = s => UNIT[s.system || 'US'];
  return `<div class="row noprint"><button class="btn" data-act="print">Print / save PDF</button><button class="btn sec" data-act="zip">Export report package (.zip)</button><button class="btn sec" data-act="csv">Distress data (.csv)</button><button class="btn sec" data-act="tex">LaTeX report (.tex)</button><button class="btn sec" data-act="exportProject">Export project file (.pcis.json)</button></div>
  <p class="muted small noprint">On iPhone/iPad, <b>Print / save PDF</b> creates a report file and opens the share sheet: choose Print, or save it to Files and print from there. The report file, the report package (.zip) and the project file can all be imported on another device (Home → Import project).</p>
  <div class="report"><h1>Pavement Condition Index Survey — ${esc(p.name || '')}</h1>
  <div class="kv"><b>Client</b><span>${esc(p.client || '')}</span><b>Project no.</b><span>${esc(p.number || '')}</span><b>Site</b><span>${esc(p.location || '')}</span>${tok(p, 'Owner.LegalName') ? `<b>Owner</b><span>${esc(tok(p, 'Owner.LegalName'))}</span>` : ''}${tok(p, 'Client.Contact') ? `<b>Attention</b><span>${esc(tok(p, 'Client.Contact'))}${tok(p, 'Client.Title') ? ', ' + esc(tok(p, 'Client.Title')) : ''}</span>` : ''}${tok(p, 'Project.ClientRef') ? `<b>Client ref.</b><span>${esc(tok(p, 'Project.ClientRef'))}</span>` : ''}<b>Survey date</b><span>${esc(p.date || '')}</span><b>Inspector(s)</b><span>${esc(p.inspectors || S.settings.inspector || '')}</span><b>Method</b><span>ASTM D6433-24 visual PCI survey</span></div>
  <h2>Summary</h2><p>${esc(narrative(p, D))}</p>
  <table><tr><th>Branch / section</th><th>Type</th><th>Use</th><th class="n">Area</th><th class="n">N</th><th class="n">Inspected (R+A)</th><th>Unit PCIs</th><th class="n">Section PCI</th><th>Rating</th></tr>
  ${D.map(x => `<tr><td>${esc(x.s.branch || '')} ${esc(x.s.name)}</td><td>${x.s.type}</td><td>${esc(x.s.use || '')}</td><td class="n">${fmt(x.s.area, 0)} ${U(x.s).area}</td><td class="n">${esc(x.s.N || '')}</td><td class="n">${x.R.sec.nR}+${x.R.sec.nA}</td><td class="small">${x.R.res.filter(r => r.pci != null).map(r => `${esc(r.unit.no)}${r.unit.kind === 'A' ? '(A)' : ''}: ${fmt(r.pci, 0)}`).join('; ')}</td><td class="n"><b>${fmt(x.R.sec.pciS, 0)}</b></td><td>${ratingChip(x.R.sec.pciS)}</td></tr>`).join('')}</table>
  <p class="small muted">Rating scale (ASTM D6433-24 Fig. 1): 85–100 Good; 70–85 Satisfactory; 55–70 Fair; 40–55 Poor; 25–40 Very Poor; 10–25 Serious; 0–10 Failed.</p>
  ${D.map(x => sectionReport(x)).join('')}
  <h2 class="pb">Photographs</h2>${p.sections.map(s => s.units.map(u => (u.photos || []).length ? `<h3>${esc(s.branch || '')} ${esc(s.name)} — Unit ${esc(u.no)}</h3><div class="ph">${u.photos.map(ph => `<figure style="margin:0"><img data-photo="${ph.id}"><figcaption class="small">${ph.code ? esc(ph.code + '. ' + dist(s.type, ph.code).name) + (ph.sev ? ' ' + ph.sev : '') + ' — ' : ''}${esc(ph.caption || '')}</figcaption></figure>`).join('')}</div>` : '').join('')).join('') || '<p class="muted">No photographs.</p>'}
  <h2>Limitations</h2><p class="small">This survey follows the visual procedure of ASTM D6433-24. The PCI is an indirect indicator of structural integrity and surface operational condition; it does not measure structural capacity, skid resistance or roughness. Quantities extrapolated from random sample units are estimates for planning. Deduct values were ${S.curveLib ? `interpolated from the curve library “${esc(S.curveLib.name || '')}” or entered manually` : 'read manually from the licensed standard'}.</p></div>`;
}
function sectionReport(x) {
  const s = x.s, U = UNIT[s.system || 'US'];
  return `<h2 class="pb">${esc(s.branch || '')} — ${esc(s.name)} (${s.type})</h2>
  <div class="kv"><b>Section PCI</b><span>${fmt(x.R.sec.pciS, 0)} ${PCI.rating(x.R.sec.pciS) ? PCI.rating(x.R.sec.pciS).label : ''} (${esc(x.R.sec.eq || '')})</span><b>Std. dev. s</b><span>${fmt(x.R.sec.s)}${x.R.sec.nShort ? ` — ${x.R.sec.nShort} more unit(s) needed for 95% confidence` : ''}</span><b>Section area</b><span>${fmt(s.area, 0)} ${U.area}</span><b>Units planned / surveyed</b><span>${s.units.length} / ${s.units.filter(u => u.done).length}</span><b>Notes</b><span>${esc(s.notes || '')}</span></div>
  <h3>Sample-unit results</h3><table><tr><th>Unit</th><th>Type</th><th class="n">${s.type === 'AC' ? 'Area' : 'Slabs'}</th><th>Distress (sev: qty → density%, DV)</th><th class="n">Max CDV</th><th class="n">PCI</th></tr>
  ${x.R.res.map(r => `<tr><td>${esc(r.unit.no)}</td><td>${r.unit.kind === 'A' ? 'Add.' : 'Rand.'}</td><td class="n">${s.type === 'AC' ? fmt(r.area, 0) : esc(r.unit.slabs)}</td><td class="small">${!r.unit.done ? '<i>not surveyed</i>' : r.r.rows.map(w => `${w.code}${sevLabel(w.sev) === '—' ? '' : w.sev}: ${w.qty == null ? (w.code === 26 ? 'unit' : '—') : fmt(w.qty, s.type === 'AC' ? 1 : 0)} → ${w.density == null ? '—' : fmt(w.density, 2)}%, ${fmt(w.dv)}`).join('; ') || 'none'}</td><td class="n">${r.unit.done ? fmt(r.r.calc.maxCdv) : '—'}</td><td class="n"><b>${fmt(r.pci, 0)}</b></td></tr>`).join('')}</table>
  ${Object.keys(x.agg).length ? `<h3>Distress quantities</h3><table><tr><th>Distress</th><th>Sev</th><th class="n">Measured in random units</th><th class="n">Extrapolated to section${x.factor ? ` (×${fmt(x.factor, 2)})` : ''}</th></tr>
  ${Object.keys(x.agg).sort((a, b) => parseInt(a) - parseInt(b)).map(k => { const [c, sv] = k.split('|'); const d = dist(s.type, c); return `<tr><td>${c}. ${esc(d.name)}</td><td>${sevLabel(sv)}</td><td class="n">${fmt(x.agg[k], 1)} ${qtyUnit(s, d)}</td><td class="n">${x.factor ? fmt(x.agg[k] * x.factor, 0) + ' ' + qtyUnit(s, d) : '—'}</td></tr>`; }).join('')}</table>` : ''}
  ${Object.keys(x.supp).length ? `<h3>Supplementary observations (units noted)</h3><ul class="small">${Object.keys(x.supp).map(k => `<li>${esc(SUPPLEMENTAL[k])}: ${x.supp[k]} unit(s)</li>`).join('')}</ul>` : ''}
  ${Object.keys(x.rep).length ? `<h3>Repair quantity log</h3><table><tr><th>Item</th><th class="n">Total measured</th><th>Unit</th></tr>${Object.keys(x.rep).map(k => { const [it, un] = k.split('|'); return `<tr><td>${esc(it)}</td><td class="n">${fmt(x.rep[k], 1)}</td><td>${esc(un)}</td></tr>`; }).join('')}</table>` : ''}`;
}

/* ============================ exports ============================ */
function download(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], {type: mime || 'application/octet-stream'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const isIOS = () => window.PCI_FORCE_IOS === true || /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.PCI_FORCE_IOS === true || navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
/* deliver a file: on iPhone/iPad use the share sheet (Mail, Files, AirDrop); elsewhere, or if sharing is refused, download it */
async function deliver(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], {type: mime || 'application/octet-stream'});
  if (isIOS() && navigator.canShare) {
    try { const f = new File([blob], name, {type: blob.type || mime || 'application/octet-stream'}); if (navigator.canShare({files: [f]})) { await navigator.share({files: [f], title: name}); return 'shared'; } }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  download(name, blob); return 'downloaded';
}
const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function photosOf(projects) { const out = {}; for (const p of projects) for (const s of p.sections) for (const u of s.units) for (const ph of (u.photos || [])) { const b = await idb.get('photos', ph.id); if (b) out[ph.id] = await blobToDataURL(b); } return out; }

/* Print / PDF. iOS ignores window.print() in a Home Screen app, so there the report is
   written to a self-contained HTML file and handed to the share sheet; opened in Safari or
   Files it prints (or saves as PDF) from the Share button. */
async function printReport(p) {
  if (!(isIOS() && isStandalone())) { window.print(); return; }
  toast('Preparing report file…');
  const node = document.querySelector('.report'); if (!node) return;
  const clone = node.cloneNode(true);
  for (const img of clone.querySelectorAll('img[data-photo]')) { const b = await idb.get('photos', img.dataset.photo); if (b) img.setAttribute('src', await blobToDataURL(b)); }
  let css = ''; try { css = await (await fetch('./styles.css')).text(); } catch (e) {}
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.name || 'PCI report')}</title><style>${css}\nbody{background:#fff}main{max-width:900px;margin:0 auto;padding:16px}.printbar{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid #ddd;margin-bottom:12px}@media print{.printbar{display:none}}</style></head><body><main><div class="printbar"><button class="btn" onclick="window.print()">Print / Save as PDF</button> <span class="small muted">Or use Share \u2192 Print. To save a PDF from the print preview, pinch out on the page, then Share \u2192 Save to Files.</span></div>${clone.outerHTML}</main><script type="application/json" id="pci-survey-project">${JSON.stringify({app: 'PCI Survey', kind: 'project', appVersion: APP_VERSION, exported: new Date().toISOString(), project: p}).replace(/</g, '\\u003c')}</script></body></html>`;
  const r = await deliver(slug(p.name) + '_PCI_report.html', html, 'text/html');
  if (r === 'downloaded') toast('Report saved. Open it, then Share → Print.');
}

/* Project file: one project with its photos (no curve library). Moves a project between devices. */
async function exportProject(p) {
  toast('Building project file…');
  const j = {app: 'PCI Survey', kind: 'project', appVersion: APP_VERSION, exported: new Date().toISOString(), project: p, photos: await photosOf([p])};
  await deliver(slug(p.name) + '_' + today() + (S.settings.inspector ? '_' + slug(S.settings.inspector) : '') + '.pcis.json', JSON.stringify(j), 'application/json');
}
/* read a ZIP (stored or deflated) into {name: Uint8Array} */
async function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip file');
  const n = dv.getUint16(e + 10, true); let o = dv.getUint32(e + 16, true); const out = {}; const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(o, true) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = dv.getUint16(o + 10, true), csz = dv.getUint32(o + 20, true), nl = dv.getUint16(o + 28, true), xl = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true), lo = dv.getUint32(o + 42, true);
    const name = dec.decode(u8.subarray(o + 46, o + 46 + nl)); o += 46 + nl + xl + cl;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true); const raw = u8.subarray(start, start + csz);
    if (name.endsWith('/')) continue;
    if (method === 0) out[name] = raw;
    else if (method === 8 && 'DecompressionStream' in window) out[name] = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error('unsupported compression in ' + name);
  }
  return out;
}
function cloneWithNewIds(p) {
  const q = JSON.parse(JSON.stringify(p)); q.id = uid(); q.name = (q.name || 'Project') + ' (imported copy)';
  q.sections.forEach(s => { s.id = uid(); s.units.forEach(u => { u.id = uid(); }); });
  return q;
}

/* ============================ EDI Project Record (.xlsx) ============================
   Reads the Project Record spreadsheet exported by EDI Project Records (EPR-DOC-07 §1):
   sheet "Project Record", columns A ID, B Field, C [Token], E Value, F Status; each Value
   cell is a workbook defined name equal to its token. A name is a token only if column C
   of its row is "[name]". The hidden "_Record" sheet (if present) gives version and export
   identity. Formula cells kept by the exporter (PM "Same as Client?", Contract.Name) are
   evaluated here, since files written by the app carry no cached values. */
const RECORD_SHEET = 'Project Record';
const xmlDoc = u8 => new DOMParser().parseFromString(new TextDecoder().decode(u8), 'application/xml');
const kids = (el, tag) => Array.from(el.getElementsByTagName(tag));
function colRow(ref) { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref); return m ? [m[1], Number(m[2])] : null; }
function readSheetCells(u8, shared) {
  const out = {};
  for (const c of kids(xmlDoc(u8), 'c')) {
    const r = c.getAttribute('r'), t = c.getAttribute('t'); const v = kids(c, 'v')[0], f = kids(c, 'f')[0];
    let val = null;
    if (t === 's' && v) val = shared[Number(v.textContent)];
    else if (t === 'inlineStr') val = kids(c, 't').map(x => x.textContent).join('');
    else if (t === 'b' && v) val = v.textContent === '1';
    else if (v && v.textContent !== '') val = t === 'str' || t === 'e' ? v.textContent : Number(v.textContent);
    if (f && (val === '' || val == null)) val = null;
    out[r] = {v: val, f: f ? f.textContent : null};
  }
  return out;
}
/* tiny evaluator for the exporter's formulas: IF(cond, a, b), $E$n refs, "text", = and <> */
function evalFormula(src, get) {
  let i = 0; const s = src.replace(/^=/, '');
  const ws = () => { while (s[i] === ' ') i++; };
  function atom() {
    ws();
    if (s.startsWith('IF(', i)) { i += 3; const c = cmp(); ws(); i++; const a = cmp(); ws(); i++; const b = cmp(); ws(); i++; return c ? a : b; }
    if (s[i] === '"') { const j = s.indexOf('"', i + 1); const x = s.slice(i + 1, j); i = j + 1; return x; }
    const m = /^\$?[A-Z]+\$?\d+/.exec(s.slice(i)); if (m) { i += m[0].length; const x = get(m[0].replace(/\$/g, '')); return x == null ? '' : x; }
    throw new Error('formula not supported: ' + src);
  }
  function cmp() { const a = atom(); ws(); if (s.startsWith('<>', i)) { i += 2; return String(a) !== String(atom()); } if (s[i] === '=') { i++; return String(a) === String(atom()); } return a; }
  return cmp();
}
const excelDate = n => { const d = new Date(Math.round((n - 25569) * 86400000)); return d.toLocaleDateString('en-US', {timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric'}); };
async function readProjectRecord(u8) {
  const files = await unzip(u8);
  const wb = files['xl/workbook.xml']; if (!wb) throw new Error('not an Excel workbook');
  const shared = files['xl/sharedStrings.xml'] ? kids(xmlDoc(files['xl/sharedStrings.xml']), 'si').map(si => kids(si, 't').map(x => x.textContent).join('')) : [];
  const wbx = xmlDoc(wb), rels = xmlDoc(files['xl/_rels/workbook.xml.rels']);
  const relMap = {}; kids(rels, 'Relationship').forEach(r => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
  const sheetPath = {}; kids(wbx, 'sheet').forEach(sh => { const id = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'); let tg = relMap[id] || ''; tg = tg.replace(/^\/?xl\//, ''); sheetPath[sh.getAttribute('name')] = 'xl/' + tg; });
  if (!sheetPath[RECORD_SHEET] || !files[sheetPath[RECORD_SHEET]]) throw new Error('this workbook has no "Project Record" sheet');
  const cells = readSheetCells(files[sheetPath[RECORD_SHEET]], shared);
  const get = ref => { const c = cells[ref]; if (!c) return null; if (c.v != null && c.v !== '') return c.v; if (c.f) { try { return evalFormula(c.f, get); } catch (e) { return null; } } return c.v; };
  // section headings: rows where column A has text and column C is empty
  const maxRow = Math.max(...Object.keys(cells).map(k => Number(k.replace(/^[A-Z]+/, ''))).filter(n => !isNaN(n)));
  const sectionOf = {}; let sec = '';
  for (let r = 1; r <= maxRow; r++) { const a = get('A' + r), c = get('C' + r); if (a && !c && !/^ID/.test(String(a)) && String(a) !== 'ID') sec = String(a); sectionOf[r] = sec; }
  const tokens = {};
  for (const dn of kids(wbx, 'definedName')) {
    const name = dn.getAttribute('name'); const m = /^'?([^'!]+)'?!(\$[A-Z]+\$\d+)$/.exec(dn.textContent.trim());
    if (!m || m[1] !== RECORD_SHEET) continue;
    const [col, row] = colRow(m[2]); if (col !== 'E' || get('C' + row) !== `[${name}]`) continue;
    let v = get('E' + row);
    if (typeof v === 'number' && /Date|Completion|PreBid|Due/.test(name)) v = excelDate(v);
    if (typeof v === 'string') v = v.trim();
    tokens[name] = {v: v === '' ? null : v, s: get('F' + row) || '', label: get('B' + row) || name, section: sectionOf[row] || '', row};
  }
  if (!Object.keys(tokens).length) throw new Error('no Project Record tokens found in this workbook');
  const meta = {};
  if (sheetPath._Record && files[sheetPath._Record]) { const mc = readSheetCells(files[sheetPath._Record], shared); for (let r = 1; r < 40; r++) { const k = mc['A' + r], v = mc['B' + r]; if (k && k.v) meta[String(k.v)] = v ? v.v : ''; } delete meta.Signature; }
  let template = ''; if (sheetPath['Start Here'] && files[sheetPath['Start Here']]) { const sc = readSheetCells(files[sheetPath['Start Here']], shared); for (const r of [1, 2, 3, 4, 5]) { const x = sc['B' + r]; if (x && /Template/i.test(String(x.v || ''))) template = String(x.v); } }
  return {tokens, meta, template};
}
const tok = (p, name) => { const x = p && p.record && p.record.tokens[name]; return x && x.v != null && x.v !== '' && x.v !== 'Not yet assigned' ? String(x.v) : ''; };
/* header fields of the PCI project that come from the Project Record (the Records app is the master) */
function recordHeader(r) {
  const T = name => { const x = r.tokens[name]; return x && x.v != null && x.v !== 'Not yet assigned' ? String(x.v) : ''; };
  return {
    name: T('Project.ShortTitle') || [T('Site.BuildingName'), T('Project.Title')].filter(Boolean).join(' – '),
    number: T('Project.Number') || T('Proposal.Number'),
    client: T('Client.Name'),
    location: [T('Site.BuildingName'), T('Site.Street'), T('Site.CityStateZip')].filter(Boolean).join(', ')
  };
}
async function loadProjectRecord(file, target) {
  const rec = await readProjectRecord(new Uint8Array(await file.arrayBuffer()));
  rec.fileName = file.name; rec.loadedAt = Date.now();
  const H = recordHeader(rec);
  let p = target;
  if (!p) {
    const same = H.number && S.projects.find(x => x.number === H.number);
    if (same) {
      const pick = await choose('Project already on this device', `<p><b>${esc(same.name)}</b> (${esc(same.number)}) is already here.</p><p class="small">Refresh updates its Project Record data and header fields and keeps the survey. New creates a separate project.</p>`, [['refresh', 'Refresh this project', ''], ['new', 'Create new project', 'sec'], ['cancel', 'Cancel', 'sec']]);
      if (pick === 'cancel' || !pick) return; if (pick === 'refresh') p = same;
    }
  }
  const isNew = !p;
  if (isNew) { p = {id: uid(), name: '', number: '', client: '', location: '', date: today(), inspectors: S.settings.inspector || '', notes: '', sections: [], updated: Date.now()}; S.projects.push(p); }
  const changes = [];
  [['name', 'Project name'], ['number', 'Project no.'], ['client', 'Client'], ['location', 'Site / address']].forEach(([k, lab]) => { if (H[k] && H[k] !== p[k]) { if (!isNew) changes.push(`${lab}: “${p[k] || '—'}” → “${H[k]}”`); p[k] = H[k]; } });
  if (!p.notes && rec.tokens['Project.Description'] && rec.tokens['Project.Description'].v) p.notes = String(rec.tokens['Project.Description'].v);
  delete p.draft;
  const before = p.record; p.record = rec; p.updated = Date.now(); save(true); go(`#/p/${p.id}`); render();
  const env = String(rec.meta.Environment || '').toUpperCase();
  const ver = rec.meta.Version ? 'v' + rec.meta.Version : '(no version: not exported by Project Records)';
  await choose(isNew ? 'Project created from the Project Record' : 'Project Record refreshed', `${env === 'STAGING' ? '<div class="note" style="border-color:#9b2c2c;color:#9b2c2c"><b>TEST — STAGING SITE.</b> This file came from the staging Records app. Use it for testing only.</div>' : ''}
    <p class="small">${esc(rec.fileName)}<br>Project Record ${esc(ver)}${rec.meta['Exported at'] ? ', exported ' + esc(rec.meta['Exported at']) : ''}${rec.meta['Exported by'] ? ' by ' + esc(rec.meta['Exported by']) : ''}</p>
    <p class="small">${Object.keys(rec.tokens).length} tokens loaded${before ? ` (previously ${before.meta && before.meta.Version ? 'v' + esc(before.meta.Version) : 'an earlier file'})` : ''}.</p>
    ${changes.length ? `<p><b>Header fields updated</b></p><ul class="small">${changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <p class="small muted">The Records app is the master. Correct project data there, export a new version, and refresh here.</p>`, [['ok', 'OK', '']]);
}
const PRESURVEY = [
  ['Project', [['Project.Number', 'EDI project no.'], ['Proposal.Number', 'Proposal no.'], ['Project.Title', 'Title'], ['Project.Phase', 'Phase'], ['EDI.Engineer', 'EDI engineer'], ['Project.ClientRef', 'Client ref. / PO']]],
  ['Site', [['Site.BuildingName', 'Building / property'], ['Site.Street', 'Street'], ['Site.CityStateZip', 'City, state ZIP'], ['Site.County', 'County'], ['Terms.OperatingHours', 'Operating hours']]],
  ['Client', [['Client.Name', 'Company'], ['Client.Contact', 'Contact'], ['Client.Title', 'Title'], ['Client.Phone', 'Phone'], ['Client.Email', 'E-mail']]],
  ['Owner', [['Owner.LegalName', 'Legal name'], ['Owner.Street', 'Street'], ['Owner.CityStateZip', 'City, state ZIP']]],
  ['Property contact', [['PM.Company', 'Company'], ['PM.Contact', 'Contact'], ['PM.Title', 'Title'], ['PM.Phone', 'Office'], ['PM.Mobile', 'Mobile'], ['PM.Email', 'E-mail'], ['PM.Emergency', 'After-hours contact'], ['PM.EmergencyPhone', 'After-hours phone']]],
  ['Site access and rules', [['Resp.AccessOpen', 'Access / opening'], ['Resp.CheckIn', 'Check-in'], ['Resp.Parking', 'Parking'], ['Resp.SafetyOrientation', 'Safety orientation'], ['Resp.SiteRules', 'Site rules'], ['Resp.Photography', 'Photography'], ['Resp.AfterHoursWork', 'After-hours work'], ['Resp.NoiseRestrictions', 'Noise'], ['Resp.RoofAccess', 'Roof access'], ['Resp.Firearms', 'Firearms']]]
];
function recordCard(p) {
  const r = p.record;
  const loadBtn = `<label class="btn ${r ? 'sec' : ''}" style="margin:0">${r ? 'Refresh Project Record (.xlsx)' : 'Load Project Record (.xlsx)'}<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-act-change="loadRecord" style="display:none"></label>`;
  if (!r) return `<div class="card"><h3>EDI Project Record</h3><p class="small muted">Load the project's Project Record spreadsheet, exported from EDI Project Records, to fill the project details and carry the pre-survey information (contacts, access, site rules) into the survey and the report.</p>${loadBtn}</div>`;
  const env = String(r.meta.Environment || '').toUpperCase();
  const groups = PRESURVEY.map(([g, rows]) => { const have = rows.filter(([k]) => tok(p, k)); return have.length ? `<h4 style="margin:10px 0 4px">${esc(g)}</h4><div class="kv">${have.map(([k, lab]) => { const v = tok(p, k); const link = /Email$/.test(k) ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : /Phone$|Mobile$/.test(k) ? `<a href="tel:${esc(v.replace(/[^\d+]/g, ''))}">${esc(v)}</a>` : esc(v); return `<b>${esc(lab)}</b><span>${link}${r.tokens[k].s && r.tokens[k].s !== 'Confirmed' ? ` <span class="small muted">(${esc(r.tokens[k].s)})</span>` : ''}</span>`; }).join('')}</div>` : ''; }).join('');
  const folder = tok(p, 'Project.Folder');
  const all = Object.entries(r.tokens).sort((a, b) => a[1].row - b[1].row);
  let lastSec = null;
  const allRows = all.map(([k, x]) => { const head = x.section !== lastSec ? `<tr><th colspan="3">${esc(x.section)}</th></tr>` : ''; lastSec = x.section; return head + `<tr><td class="small">${esc(x.label)}<div class="muted">[${esc(k)}]</div></td><td>${esc(x.v == null ? '' : x.v)}</td><td class="small">${esc(x.s || '')}</td></tr>`; }).join('');
  return `<div class="card"><h3>EDI Project Record ${r.meta.Version ? 'v' + esc(r.meta.Version) : ''}</h3>
   ${env === 'STAGING' ? '<div class="note" style="border-color:#9b2c2c;color:#9b2c2c"><b>TEST — STAGING SITE.</b> Test data only.</div>' : ''}
   <p class="small muted">${esc(r.fileName || '')}${r.meta['Exported at'] ? ' · exported ' + esc(r.meta['Exported at']) : ''} · loaded ${esc(new Date(r.loadedAt).toLocaleString())}. Correct data in the Records app, then refresh.</p>
   ${groups}
   ${folder ? `<div class="note small">Save this survey's project files and report packages in <b>${esc(folder)}\\PCI Survey</b>.</div>` : ''}
   <details style="margin-top:8px"><summary class="small">All ${all.length} tokens</summary><div class="tw"><table><tr><th>Field / token</th><th>Value</th><th>Status</th></tr>${allRows}</table></div></details>
   <div class="row" style="margin-top:8px">${loadBtn}</div></div>`;
}

/* small promise-based dialog: buttons = [[value, label, extraClass]] */
function choose(title, html, buttons) {
  return new Promise(res => {
    closeModal(); const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal';
    bg.innerHTML = `<div class="modal"><h3>${esc(title)}</h3>${html}<div class="row" style="margin-top:12px">${buttons.map(([v, l, c]) => `<button class="btn ${c}" data-choice="${v}">${esc(l)}</button>`).join('')}</div></div>`;
    bg.addEventListener('click', ev => { const b = ev.target.closest('[data-choice]'); if (b) { ev.stopPropagation(); bg.remove(); res(b.dataset.choice); } });
    document.body.appendChild(bg);
  });
}
const unitHasData = u => !!(u.done || (u.entries || []).length || Object.keys(u.slabMarks || {}).length || (u.photos || []).length || (u.repairs || []).length || (u.jointSeal && u.jointSeal !== 'none') || Object.values(u.supp || {}).some(Boolean) || u.gps || (u.notes || '').trim());
const unitSig = u => JSON.stringify(Object.assign({}, u, {updated: 0, photos: (u.photos || []).map(x => x.id).sort()}));
/* Merge an imported copy of a project into the local one.
   Sections match by ID, then by branch + name + type. Units match by ID, then by unit number + kind.
   A unit on only one side is kept. Where both sides have the unit: if only one has data, that one is kept;
   if both have different data, the more recently changed one is kept and the merge reports it as a conflict.
   Photos from both copies are always kept. */
function mergeProject(local, inc, photoBlobs) {
  const sum = {added: [], updated: [], kept: [], conflicts: [], sections: [], same: 0};
  const lab = (s, u) => `${s.branch ? s.branch + ' ' : ''}${s.name} unit ${u.no}${u.kind === 'A' ? ' (A)' : ''}`;
  ['client', 'location', 'number', 'inspectors', 'notes'].forEach(f => { if (!local[f] && inc[f]) local[f] = inc[f]; });
  if (inc.record && (!local.record || (inc.record.loadedAt || 0) > (local.record.loadedAt || 0))) { local.record = inc.record; sum.record = 'Project Record taken from the imported file (newer)'; }
  const ins = new Set(String(local.inspectors || '').split(/\s*[,;&]\s*/).filter(Boolean));
  inc.sections.forEach(si => {
    let sl = local.sections.find(x => x.id === si.id) || local.sections.find(x => (x.branch || '') === (si.branch || '') && x.name === si.name && x.type === si.type);
    if (!sl) { local.sections.push(si); sum.sections.push(`${si.branch ? si.branch + ' ' : ''}${si.name}`); si.units.forEach(u => { if (u.inspector && unitHasData(u)) ins.add(u.inspector); }); return; }
    ['area', 'N', 'unitSize', 'slabLen', 'slabWid', 'use', 'notes'].forEach(f => { if ((sl[f] === '' || sl[f] == null) && si[f] !== '' && si[f] != null) sl[f] = si[f]; });
    si.units.forEach(ui => {
      if (ui.inspector && unitHasData(ui)) ins.add(ui.inspector);
      const ul = sl.units.find(x => x.id === ui.id) || sl.units.find(x => String(x.no) === String(ui.no) && (x.kind || 'R') === (ui.kind || 'R'));
      if (!ul) { sl.units.push(ui); sum.added.push(lab(sl, ui)); return; }
      if (unitSig(ul) === unitSig(ui)) { sum.same++; return; }
      const dl = unitHasData(ul), di = unitHasData(ui);
      const phUnion = () => { const ids = new Set((ul.photos || []).map(x => x.id)); return (ul.photos || []).concat((ui.photos || []).filter(x => !ids.has(x.id))); };
      const take = () => { const keepId = ul.id, ph = phUnion(); Object.keys(ul).forEach(k => delete ul[k]); Object.assign(ul, JSON.parse(JSON.stringify(ui)), {id: keepId, photos: ph}); };
      if (!di) { const n = (ui.photos || []).length; if (n) ul.photos = phUnion(); sum.kept.push(lab(sl, ul)); return; }
      if (!dl) { take(); sum.updated.push(lab(sl, ul)); return; }
      const tl = ul.updated || 0, ti = ui.updated || 0;
      if (ti > tl) { take(); sum.conflicts.push(`${lab(sl, ul)}: surveyed on both devices; kept the imported copy (changed later)`); sum.updated.push(lab(sl, ul)); }
      else { ul.photos = phUnion(); sum.conflicts.push(`${lab(sl, ul)}: surveyed on both devices; kept this device's copy (${tl ? 'changed later' : 'no change times in file'})`); }
    });
  });
  if (ins.size) local.inspectors = [...ins].join(', ');
  return sum;
}
function mergeReport(s) {
  const li = (h, a) => a.length ? `<p><b>${h} (${a.length})</b></p><ul class="small">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  return `${li('Units added', s.added)}${li('Units updated from the imported file', s.updated.filter(x => !s.conflicts.some(c => c.startsWith(x + ':'))))}${li('Sections added', s.sections)}${s.conflicts.length ? `<div class="note">${li('Check these units: both devices had survey data', s.conflicts)}<p class="small">Open each one and confirm the entries. The other copy is still in the imported file if you need it.</p></div>` : ''}${s.record ? `<p class="small">${esc(s.record)}.</p>` : ''}<p class="small muted">${s.same} unit(s) were identical on both devices.</p>`;
}
/* Import a project from: a project file (.pcis.json), a report package (.zip, from any version), or a full backup (.json) */
async function importAny(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  let project = null, photoBlobs = {};
  if (u8[0] === 0x50 && u8[1] === 0x4B) {
    const files = await unzip(u8);
    const pj = Object.keys(files).find(k => /(^|\/)project\.json$/.test(k)); if (!pj) throw new Error('this zip has no project.json');
    project = JSON.parse(new TextDecoder().decode(files[pj])); const base = pj.slice(0, pj.length - 'project.json'.length);
    project.sections.forEach(s => s.units.forEach(u => (u.photos || []).forEach((ph, k) => { const f = files[base + 'photos/' + photoName(s, u, ph, k)]; if (f) photoBlobs[ph.id] = new Blob([f], {type: 'image/jpeg'}); })));
  } else if (/^\s*</.test(new TextDecoder().decode(u8.subarray(0, 64)))) {
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(u8), 'text/html');
    const el = doc.getElementById('pci-survey-project');
    if (!el) throw new Error('this report file does not contain project data (it was made before version 1.3.1). On the original device use Export project file instead');
    project = JSON.parse(el.textContent).project;
    for (const img of doc.querySelectorAll('img[data-photo]')) { const src = img.getAttribute('src') || ''; if (src.startsWith('data:')) photoBlobs[img.dataset.photo] = await (await fetch(src)).blob(); }
  } else {
    const j = JSON.parse(new TextDecoder().decode(u8));
    if (j.kind === 'project' && j.project) { project = j.project; for (const id in (j.photos || {})) photoBlobs[id] = await (await fetch(j.photos[id])).blob(); }
    else if ((j.state || j).projects) { await restore(file); return; }
    else throw new Error('not a PCI Survey project, package or backup');
  }
  if (!project || !Array.isArray(project.sections)) throw new Error('project data missing');
  let k = S.projects.findIndex(x => x.id === project.id);
  if (k < 0) k = S.projects.findIndex(x => x.name && x.name === project.name && (x.number || '') === (project.number || ''));
  if (k >= 0) {
    const here = S.projects[k], when = t => t ? new Date(t).toLocaleString() : 'unknown';
    const pick = await choose('This project is already on this device', `<p><b>${esc(here.name)}</b></p>
      <table class="small"><tr><td>On this device</td><td>last changed ${esc(when(here.updated))}</td></tr><tr><td>Imported file</td><td>last changed ${esc(when(project.updated))}</td></tr></table>
      <p class="small"><b>Merge</b> adds the imported units and photos to this project and keeps your own work. Use it to combine units surveyed on different devices or by different inspectors.<br><b>Replace</b> discards this device's copy and uses the imported one.<br><b>Keep both</b> imports a separate copy.</p>`,
      [['merge', 'Merge (recommended)', ''], ['replace', 'Replace', 'sec'], ['copy', 'Keep both', 'sec'], ['cancel', 'Cancel', 'sec']]);
    if (pick === 'cancel' || !pick) return;
    if (pick === 'merge') {
      const sum = mergeProject(here, project, photoBlobs);
      for (const id in photoBlobs) if (photoBlobs[id]) await idb.put('photos', id, photoBlobs[id]);
      here.updated = Date.now(); save(true); go(`#/p/${here.id}`); render();
      await choose('Merge complete', mergeReport(sum), [['ok', 'OK', '']]);
      return;
    }
    if (pick === 'replace') { S.projects[k] = project; }
    else {
      const q = cloneWithNewIds(project); const map = {};
      q.sections.forEach(s => s.units.forEach(u => (u.photos || []).forEach(ph => { const nid = uid(); map[nid] = photoBlobs[ph.id]; ph.id = nid; })));
      photoBlobs = map; project = q; S.projects.push(project);
    }
  } else S.projects.push(project);
  for (const id in photoBlobs) if (photoBlobs[id]) await idb.put('photos', id, photoBlobs[id]);
  save(true); toast('Project imported'); go(`#/p/${project.id}`); render();
}
const slug = s => String(s || 'project').replace(/[^\w\-]+/g, '_').slice(0, 40);
function csvFor(p) {
  const L = [['project', 'branch', 'section', 'type', 'units', 'unit_no', 'unit_kind', 'unit_area_or_slabs', 'code', 'distress', 'severity', 'quantity', 'qty_unit', 'density_pct', 'deduct_value', 'dv_source', 'unit_pci', 'unit_rating', 'surveyed', 'lat', 'lon']];
  p.sections.forEach(s => s.units.forEach(u => {
    const r = PCI.unitPCI(s, u, S.curveLib); const b = PCI.rating(r.pci);
    const base = [p.name, s.branch, s.name, s.type, s.system, u.no, u.kind === 'A' ? 'additional' : 'random', s.type === 'AC' ? u.area : u.slabs];
    const tail = [r.pci == null ? '' : r.pci, b ? b.label : '', u.done ? 'yes' : 'no', u.gps ? u.gps.lat : '', u.gps ? u.gps.lon : ''];
    if (!r.rows.length) L.push(base.concat(['', '', '', '', '', '', '', '']).concat(tail));
    r.rows.forEach(w => { const d = dist(s.type, w.code); L.push(base.concat([w.code, d.name, w.sev, w.qty == null ? '' : w.qty, qtyUnit(s, d), w.density == null ? '' : w.density, w.dv == null ? '' : w.dv, w.src]).concat(tail)); });
  }));
  return L.map(r => r.map(v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
}
const tx = s => String(s == null ? '' : s).replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}').replace(/²/g, '$^2$').replace(/×/g, '$\\times$').replace(/—/g, '---').replace(/–/g, '--').replace(/[“”]/g, '"').replace(/’/g, "'");
function texFor(p, withPhotos) {
  const D = projectData(p);
  let t = `% PCI Survey report — generated by PCI Survey v${APP_VERSION} on ${today()}\n\\documentclass[10pt,letterpaper]{article}\n\\usepackage[margin=0.9in]{geometry}\n\\usepackage[T1]{fontenc}\\usepackage{lmodern}\\usepackage{booktabs,longtable,graphicx,xcolor,array}\n\\usepackage[hidelinks]{hyperref}\n\\setlength{\\parindent}{0pt}\\setlength{\\parskip}{5pt}\n\\begin{document}\n`;
  t += `{\\Large\\bfseries Pavement Condition Index Survey --- ${tx(p.name)}}\\\\[4pt]\n${tx(S.settings.firm)}\\\\[8pt]\n\\begin{tabular}{@{}ll@{}}Client & ${tx(p.client)}\\\\ Project no. & ${tx(p.number)}\\\\ Site & ${tx(p.location)}\\\\ ${tok(p, 'Owner.LegalName') ? `Owner & ${tx(tok(p, 'Owner.LegalName'))}\\\\ ` : ''}${tok(p, 'Client.Contact') ? `Attention & ${tx(tok(p, 'Client.Contact') + (tok(p, 'Client.Title') ? ', ' + tok(p, 'Client.Title') : ''))}\\\\ ` : ''}Survey date & ${tx(p.date)}\\\\ Inspector(s) & ${tx(p.inspectors || S.settings.inspector)}\\\\ Method & ASTM D6433-24 visual PCI survey\\end{tabular}\n\n`;
  t += `\\section*{Summary}\n${tx(narrative(p, D))}\n\n\\begin{longtable}{@{}llrrrl@{}}\\toprule Section & Type & Area & N & Inspected (R+A) & Section PCI / rating\\\\\\midrule\\endhead\n`;
  D.forEach(x => { const b = PCI.rating(x.R.sec.pciS); t += `${tx((x.s.branch || '') + ' ' + x.s.name)} & ${x.s.type} & ${fmt(x.s.area, 0)} ${UNIT[x.s.system || 'US'].areaTxt.replace('2', '$^2$')} & ${tx(x.s.N)} & ${x.R.sec.nR}+${x.R.sec.nA} & ${fmt(x.R.sec.pciS, 0)} ${b ? b.label : ''}\\\\\n`; });
  t += `\\bottomrule\\end{longtable}\nRating scale (ASTM D6433-24 Fig.~1): 85--100 Good; 70--85 Satisfactory; 55--70 Fair; 40--55 Poor; 25--40 Very Poor; 10--25 Serious; 0--10 Failed.\n\n`;
  D.forEach(x => {
    const s = x.s;
    t += `\\section*{${tx((s.branch || '') + ' --- ' + s.name)} (${s.type})}\nSection PCI ${fmt(x.R.sec.pciS, 0)} (${tx(x.R.sec.eq)}); standard deviation $s$ = ${fmt(x.R.sec.s)}. ${tx(s.notes || '')}\n\n`;
    t += `\\begin{longtable}{@{}lllrrr@{}}\\toprule Unit & Distress & Sev. & Qty & Density \\% & DV\\\\\\midrule\\endhead\n`;
    x.R.res.filter(r => r.unit.done).forEach(r => {
      r.r.rows.forEach((w, k) => { const d = dist(s.type, w.code); t += `${k === 0 ? tx(r.unit.no) + (r.unit.kind === 'A' ? ' (A)' : '') : ''} & ${w.code}. ${tx(d.name)} & ${tx(sevLabel(w.sev))} & ${w.qty == null ? (w.code === 26 ? 'unit' : '---') : fmt(w.qty, s.type === 'AC' ? 1 : 0)} & ${fmt(w.density, 2)} & ${fmt(w.dv)}\\\\\n`; });
      t += `\\multicolumn{6}{r}{\\itshape Unit ${tx(r.unit.no)}: max CDV ${fmt(r.r.calc.maxCdv)}, PCI = ${fmt(r.pci, 0)} ${PCI.rating(r.pci) ? PCI.rating(r.pci).label : ''}}\\\\\\midrule\n`;
    });
    t += `\\bottomrule\\end{longtable}\n`;
    if (Object.keys(x.rep).length) { t += `\\textbf{Repair quantity log}\\\\\n\\begin{tabular}{@{}lrl@{}}\\toprule Item & Qty & Unit\\\\\\midrule\n`; Object.keys(x.rep).forEach(k => { const [it, un] = k.split('|'); t += `${tx(it)} & ${fmt(x.rep[k], 1)} & ${tx(un)}\\\\\n`; }); t += `\\bottomrule\\end{tabular}\n\n`; }
    if (Object.keys(x.supp).length) { t += `\\textbf{Supplementary observations:} ${Object.keys(x.supp).map(k => tx(SUPPLEMENTAL[k]) + ' (' + x.supp[k] + ')').join('; ')}.\n\n`; }
  });
  if (withPhotos) {
    t += `\\clearpage\\section*{Photographs}\n`;
    p.sections.forEach(s => s.units.forEach(u => (u.photos || []).forEach((ph, k) => {
      t += `\\begin{minipage}[t]{0.48\\textwidth}\\centering\\includegraphics[width=\\linewidth,height=2.4in,keepaspectratio]{photos/${photoName(s, u, ph, k)}}\\\\\\small ${tx((s.branch || '') + ' ' + s.name)}, unit ${tx(u.no)}${ph.code ? ': ' + tx(ph.code + '. ' + dist(s.type, ph.code).name) + (ph.sev ? ' ' + ph.sev : '') : ''}. ${tx(ph.caption || '')}\\end{minipage}\\hfill\n`;
    })));
  }
  t += `\n\\section*{Limitations}\nThe PCI is an indirect indicator of structural integrity and surface operational condition; it does not measure structural capacity, skid resistance or roughness (ASTM D6433-24 \\S1.2). Extrapolated quantities are estimates.\n\\end{document}\n`;
  return t;
}
function photoName(s, u, ph, k) { return slug(`${s.branch || ''}_${s.name}_U${u.no}_${k + 1}`) + '.jpg'; }

/* minimal ZIP writer (store, no compression) */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) { // files: [{name, data:Uint8Array}]
  const enc = new TextEncoder(); const parts = [], central = []; let off = 0;
  files.forEach(f => {
    const nm = enc.encode(f.name), d = f.data, crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, d);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + d.length;
  });
  const csize = central.reduce((a, x) => a + x.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], {type: 'application/zip'});
}
async function blobToU8(b) { return new Uint8Array(await b.arrayBuffer()); }
async function zipPackage(p) {
  const enc = new TextEncoder(); const files = [];
  files.push({name: 'report.tex', data: enc.encode(texFor(p, true))});
  files.push({name: 'distress_data.csv', data: enc.encode(csvFor(p))});
  files.push({name: 'project.json', data: enc.encode(JSON.stringify(p, null, 1))});
  if (p.record) {
    const rows = Object.entries(p.record.tokens).sort((a, b) => a[1].row - b[1].row);
    const q = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    files.push({name: 'project_record_tokens.csv', data: enc.encode([['token', 'field', 'value', 'status', 'section'].join(',')].concat(rows.map(([k, x]) => [k, x.label, x.v, x.s, x.section].map(q).join(','))).join('\r\n'))});
    files.push({name: 'project_record_tokens.tex', data: enc.encode('% EDI Project Record tokens' + (p.record.meta.Version ? ' (v' + p.record.meta.Version + ')' : '') + '. Use \\PR{Project.Number} etc.\n\\providecommand{\\PR}[1]{\\csname PR@#1\\endcsname}\n' + rows.map(([k, x]) => `\\expandafter\\def\\csname PR@${k}\\endcsname{${tx(x.v == null ? '' : x.v)}}`).join('\n') + '\n')});
  }
  for (const s of p.sections) for (const u of s.units) for (let k = 0; k < (u.photos || []).length; k++) {
    const ph = u.photos[k]; const b = await idb.get('photos', ph.id); if (b) files.push({name: 'photos/' + photoName(s, u, ph, k), data: await blobToU8(b)});
  }
  files.push({name: 'README.txt', data: enc.encode('PCI Survey report package\r\nreport.tex  - compile with pdflatex (photos/ folder alongside)\r\ndistress_data.csv - one row per distress/severity per unit\r\nproject_record_tokens.csv/.tex - EDI Project Record tokens, if loaded (\\PR{Token} in LaTeX)\r\nproject.json - project data. To open this project on another device, import this whole .zip in PCI Survey: Home > Import project\r\n')});
  await deliver(slug(p.name) + '_PCI_report.zip', zip(files), 'application/zip');
}
async function fullBackup() {
  const photos = await photosOf(S.projects);
  await deliver(`PCI_backup_${today()}.json`, JSON.stringify({app: 'PCI Survey', appVersion: APP_VERSION, exported: new Date().toISOString(), state: S, photos}), 'application/json');
}
async function restore(file) {
  const j = JSON.parse(await file.text());
  const st = j.state || j; if (!st.projects) throw new Error('Not a PCI Survey backup');
  st.projects.forEach(p => { const k = S.projects.findIndex(x => x.id === p.id); if (k >= 0) S.projects[k] = p; else S.projects.push(p); });
  if (st.curveLib && (!S.curveLib || confirm('Backup contains a curve library. Replace the current library?'))) S.curveLib = st.curveLib;
  for (const id in (j.photos || {})) { const b = await (await fetch(j.photos[id])).blob(); await idb.put('photos', id, b); }
  save(true); toast('Backup restored'); render();
}

/* ============================ photos ============================ */
async function addPhotos(files, u) {
  const pos = await new Promise(r => { if (!navigator.geolocation) return r(null); navigator.geolocation.getCurrentPosition(p => r(p.coords), () => r(null), {timeout: 4000, maximumAge: 60000}); });
  for (const f of files) {
    const b = await resize(f, 1600); const id = uid(); await idb.put('photos', id, b);
    (u.photos = u.photos || []).push({id, caption: '', code: '', sev: '', ts: Date.now(), lat: pos ? pos.latitude : null, lon: pos ? pos.longitude : null});
  }
  touch(); render();
}
function resize(file, max) {
  return new Promise(res => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const sc = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => { URL.revokeObjectURL(url); res(b || file); }, 'image/jpeg', 0.82); };
    img.onerror = () => res(file); img.src = url;
  });
}
const urlCache = {};
async function hydratePhotos() {
  for (const img of document.querySelectorAll('img[data-photo]')) {
    const id = img.dataset.photo; if (!urlCache[id]) { const b = await idb.get('photos', id); if (b) urlCache[id] = URL.createObjectURL(b); }
    if (urlCache[id]) img.src = urlCache[id];
  }
}

/* ============================ model mutations ============================ */
function touch() { const c = ctx(), now = Date.now(); if (c.p) c.p.updated = now; if (c.s) c.s.updated = now; if (c.u) c.u.updated = now; save(); }
function evalExpr(str) {
  const s = String(str || '').replace(/[x×]/gi, '*').replace(/,/g, '.').replace(/\s+/g, '');
  if (!s) return null; if (!/^[\d.+\-*/()]+$/.test(s)) return NaN;
  try { const v = Function('"use strict";return (' + s + ')')(); return typeof v === 'number' && isFinite(v) ? v : NaN; } catch (e) { return NaN; }
}
function newUnit(s, no, kind) {
  return {id: uid(), no: String(no), kind: kind || 'R', area: s.type === 'AC' ? (s.unitSize || '') : '', slabs: s.type === 'PCC' ? 20 : '', cols: 2,
    date: today(), inspector: S.settings.inspector || '', entries: [], slabMarks: {}, jointSeal: 'none', pumpExtra: 0, dvOverride: {}, cdvOverride: {}, photos: [], supp: {}, repairs: [], notes: ''};
}

/* ============================ events ============================ */
function objFor(name) { const c = ctx(); return name === 'project' ? c.p : name === 'section' ? c.s : name === 'unit' ? c.u : name === 'settings' ? S.settings : null; }
const NUMF = new Set(['area', 'N', 'unitSize', 'slabLen', 'slabWid', 'sDev', 'e', 'slabs', 'cols', 'pumpExtra']);
document.addEventListener('change', async e => {
  const el = e.target; const c = ctx();
  if (el.dataset.obj) {
    const o = objFor(el.dataset.obj); if (!o) return; const k = el.dataset.k; let v = el.value;
    if (NUMF.has(k)) { const ev = evalExpr(v); v = (ev == null || isNaN(ev)) ? '' : Math.round(ev * 1000) / 1000; }
    if (el.dataset.obj === 'section' && k === 'type' && o.type !== v) { o.sDev = v === 'AC' ? 10 : 15; }
    o[k] = v; touch(); if (['type', 'system', 'N', 'sDev', 'e', 'slabs', 'cols', 'jointSeal', 'pumpExtra', 'area', 'kind', 'slabLen', 'slabWid', 'no'].includes(k)) render(); return;
  }
  const a = el.dataset.actChange; if (!a) return;
  if (a === 'acCode') { UI.acCode = el.value ? Number(el.value) : null; UI.acSev = null; const d = UI.acCode && dist('AC', UI.acCode); if (d && d.sev.length === 1) UI.acSev = d.sev[0]; render(); }
  else if (a === 'dvOv') { c.u.dvOverride = c.u.dvOverride || {}; const v = el.value.trim(); if (v === '') delete c.u.dvOverride[el.dataset.key]; else c.u.dvOverride[el.dataset.key] = Number(v); touch(); render(); }
  else if (a === 'cdvOv') { c.u.cdvOverride = c.u.cdvOverride || {}; const v = el.value.trim(); if (v === '') delete c.u.cdvOverride[el.dataset.it]; else c.u.cdvOverride[el.dataset.it] = Number(v); touch(); render(); }
  else if (a === 'addPhotos') { if (el.files.length) { toast('Saving photos…'); await addPhotos([...el.files], c.u); } }
  else if (a === 'phCap' || a === 'phCode' || a === 'phSev') { const ph = c.u.photos.find(x => x.id === el.dataset.id); ph[{phCap: 'caption', phCode: 'code', phSev: 'sev'}[a]] = el.value; touch(); }
  else if (a === 'supp') { c.u.supp = c.u.supp || {}; c.u.supp[el.dataset.k] = el.checked; touch(); }
  else if (a === 'importLib') { try { const j = JSON.parse(await el.files[0].text()); if (!j.AC && !j.PCC) throw new Error('missing AC/PCC sets'); S.curveLib = j; save(true); toast('Curve library loaded'); render(); } catch (err) { alert('Could not read library: ' + err.message); } }
  else if (a === 'newFromRecord' || a === 'loadRecord') { try { await loadProjectRecord(el.files[0], a === 'loadRecord' ? c.p : null); } catch (err) { alert('Could not read the Project Record: ' + err.message); } el.value = ''; }
  else if (a === 'importAny') { try { await importAny(el.files[0]); } catch (err) { alert('Import failed: ' + err.message); } el.value = ''; }
  else if (a === 'restore') { try { await restore(el.files[0]); } catch (err) { alert('Restore failed: ' + err.message); } }
  else if (a === 'cvSet') { UI.curveSel.set = el.value; render(); }
  else if (a === 'cvCode') { UI.curveSel.code = Number(el.value); render(); }
  else if (a === 'cvSev') { UI.curveSel.sev = el.value; render(); }
  else if (a === 'cvQ') { UI.curveSel.q = Number(el.value); render(); }
  else if (a === 'hcalc') helperCompute();
});
document.addEventListener('input', e => { if (e.target.dataset.actInput === 'hcalc') helperCompute(); });
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act; const c = ctx();
  if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
  switch (a) {
    case 'saveDraft': delete c.p.draft; c.p.updated = Date.now(); save(true); render(); toast('Project saved'); break;
    case 'cancelDraft': { const pick = await choose('Discard this new project?', '<p>Nothing has been saved. The project and anything entered on it will be removed.</p>', [['discard', 'Discard', 'warn'], ['keep', 'Keep editing', 'sec']]); if (pick === 'discard') { S.projects = S.projects.filter(x => x !== c.p); save(true); go('#/'); render(); toast('New project discarded'); } break; }
    case 'newProject': { const p = {draft: true, id: uid(), name: 'New project', number: '', client: '', location: '', date: today(), inspectors: S.settings.inspector || '', notes: '', sections: [], updated: Date.now()}; S.projects.push(p); save(); go(`#/p/${p.id}`); break; }
    case 'delProject': if (confirm('Delete this project and its photos?')) { for (const s of c.p.sections) for (const u of s.units) for (const ph of (u.photos || [])) await idb.del('photos', ph.id); S.projects = S.projects.filter(x => x !== c.p); save(); go('#/'); } break;
    case 'newSection': { delete c.p.draft; }
    // falls through
    case 'newSectionGo': { const ty = S.settings.type || 'AC', sy = S.settings.units || 'US'; const s = {id: uid(), branch: '', name: 'S' + (c.p.sections.length + 1), type: ty, system: sy, area: '', N: '', unitSize: sy === 'US' ? 2500 : 225, slabLen: '', slabWid: '', sDev: ty === 'AC' ? 10 : 15, e: 5, use: '', notes: '', units: []}; c.p.sections.push(s); touch(); go(`#/s/${c.p.id}/${s.id}`); break; }
    case 'delSection': if (confirm('Delete this section?')) { c.p.sections = c.p.sections.filter(x => x !== c.s); touch(); go(`#/p/${c.p.id}`); } break;
    case 'genUnits': case 'genAll': {
      const s = c.s; const N = Number(s.N);
      if (s.units.length && !confirm('Add generated units to the existing list? (Existing units are kept; duplicates skipped.)')) break;
      let list;
      if (a === 'genAll') list = Array.from({length: N}, (_, k) => k + 1);
      else { const mu = PCI.minUnits(N, s.sDev, s.e); const i = PCI.interval(N, mu.n); const r = new Uint32Array(1); crypto.getRandomValues(r); const start = 1 + (r[0] % i); s.startUsed = start; s.genDate = today(); list = PCI.systematicUnits(N, mu.n, start).list; }
      list.forEach(no => { if (!s.units.some(u => String(u.no) === String(no))) s.units.push(newUnit(s, no, 'R')); });
      touch(); toast(`${list.length} unit(s) planned`); render(); break; }
    case 'addUnit': { const no = prompt('Sample unit number / ID:', String((c.s.units.length ? Math.max(...c.s.units.map(u => Number(u.no) || 0)) : 0) + 1)); if (no) { const u = newUnit(c.s, no, el.dataset.kind); c.s.units.push(u); touch(); go(`#/u/${c.p.id}/${c.s.id}/${u.id}`); } break; }
    case 'delUnit': if (confirm('Delete this sample unit?')) { for (const ph of (c.u.photos || [])) await idb.del('photos', ph.id); c.s.units = c.s.units.filter(x => x !== c.u); touch(); go(`#/s/${c.p.id}/${c.s.id}`); } break;
    case 'key': { const inp = document.getElementById(el.dataset.target); if (inp) { inp.value += el.dataset.k === '×' ? '*' : el.dataset.k; inp.focus(); } break; }
    case 'tab': UI.tab = el.dataset.tab; render(); break;
    case 'toggleDone': c.u.done = !c.u.done; if (c.u.done && S.settings.inspector) c.u.inspector = S.settings.inspector; touch(); render(); toast(c.u.done ? 'Unit marked surveyed' : 'Unit excluded from section PCI'); break;
    case 'pickAC': UI.acCode = Number(el.dataset.code); UI.acSev = dist('AC', UI.acCode).sev.length === 1 ? dist('AC', UI.acCode).sev[0] : null; render(); setTimeout(() => $('#acQty') && $('#acQty').focus(), 50); break;
    case 'acSev': UI.acSev = el.dataset.sev; document.querySelectorAll('[data-act="acSev"]').forEach(b => b.classList.toggle('on', b === el)); $('#acQty') && $('#acQty').focus(); break;
    case 'addAC': {
      if (!UI.acCode) return toast('Select a distress'); if (!UI.acSev) return toast('Select a severity');
      const expr = $('#acQty').value; const v = evalExpr(expr); if (v == null || isNaN(v) || v <= 0) return toast('Enter a valid quantity');
      c.u.entries.push({id: uid(), code: UI.acCode, sev: UI.acSev, qty: Math.round(v * 1000) / 1000, expr, note: $('#acNote').value});
      S.settings.recentAC = [UI.acCode].concat((S.settings.recentAC || []).filter(x => x !== UI.acCode)).slice(0, 8);
      touch(); toast(`Added ${UI.acCode}${UI.acSev === 'N' ? '' : UI.acSev}: ${fmt(v, 2)}`); render(); break; }
    case 'delEntry': c.u.entries = c.u.entries.filter(x => x.id !== el.dataset.id); touch(); render(); break;
    case 'slab': UI.slab = el.dataset.key; openModal(slabModal(c.s, c.u, UI.slab)); break;
    case 'slabSev': { const k = el.dataset.key, code = el.dataset.code, sv = el.dataset.sev; c.u.slabMarks = c.u.slabMarks || {}; const m = c.u.slabMarks[k] = c.u.slabMarks[k] || {};
      if (m[code] === sv) delete m[code]; else m[code] = sv; if (!Object.keys(m).length) delete c.u.slabMarks[k]; touch(); openModal(slabModal(c.s, c.u, k)); render(); break; }
    case 'clearSlab': delete c.u.slabMarks[el.dataset.key]; touch(); closeModal(); render(); break;
    case 'copyPrev': { const keys = Object.keys(c.u.slabMarks || {}).filter(k => k !== el.dataset.key); const last = keys[keys.length - 1]; if (!last) { toast('No other slab recorded'); break; } c.u.slabMarks[el.dataset.key] = Object.assign({}, c.u.slabMarks[last]); touch(); openModal(slabModal(c.s, c.u, el.dataset.key)); render(); break; }
    case 'tip': { const d = dist(el.dataset.type, el.dataset.code); alert(`${d.code}. ${d.name} (${d.ref})\n\n${d.tip}`); break; }
    case 'helper': UI.helperBack = UI.slab; openModal(helperModal(el.dataset.h)); break;
    case 'useHelper': { const r = helperCompute(); const sv = (r || '').match(/\b([LMH])\b$/) || (r || '').match(/^([LMH])$/);
      if (!sv) { toast('No countable severity'); break; }
      if (UI.helperBack && c.u && c.s.type === 'PCC') { closeModal(); openModal(slabModal(c.s, c.u, UI.helperBack)); toast('Severity ' + sv[1] + ' — tap it in the list'); }
      else { UI.acSev = sv[1]; closeModal(); render(); toast('Severity ' + sv[1] + ' selected'); }
      UI.helperBack = null; break; }
    case 'closeModal': closeModal(); if (UI.helperBack) { const k = UI.helperBack; UI.helperBack = null; openModal(slabModal(c.s, c.u, k)); } else { UI.slab = null; render(); } break;
    case 'gps': if (!navigator.geolocation) { toast('No GPS'); break; } toast('Locating…'); navigator.geolocation.getCurrentPosition(pp => { c.u.gps = {lat: pp.coords.latitude, lon: pp.coords.longitude, acc: pp.coords.accuracy, ts: Date.now()}; touch(); render(); }, err => toast('GPS unavailable: ' + err.message), {enableHighAccuracy: true, timeout: 15000}); break;
    case 'delPhoto': if (confirm('Delete photo?')) { await idb.del('photos', el.dataset.id); c.u.photos = c.u.photos.filter(x => x.id !== el.dataset.id); touch(); render(); } break;
    case 'addRepair': { const it = REPAIR_ITEMS[$('#rpItem').value]; const v = evalExpr($('#rpQty').value); if (v == null || isNaN(v)) return toast('Enter a quantity'); (c.u.repairs = c.u.repairs || []).push({id: uid(), item: it.item, unit: it.unit, qty: v, expr: $('#rpQty').value, note: $('#rpNote').value}); touch(); render(); break; }
    case 'delRepair': c.u.repairs = c.u.repairs.filter(x => x.id !== el.dataset.id); touch(); render(); break;
    case 'newLib': S.curveLib = curveTemplate(); save(); render(); break;
    case 'clearLib': if (confirm('Remove the curve library from this device? (Export it first if needed.)')) { S.curveLib = null; save(); render(); } break;
    case 'exportLib': download('pci_curve_library.json', JSON.stringify(S.curveLib, null, 1), 'application/json'); break;
    case 'templateLib': download('pci_curve_template.json', JSON.stringify(curveTemplate(), null, 1), 'application/json'); break;
    case 'saveCurve': { const cs = UI.curveSel; const L = S.curveLib; const pts = $('#cvPts').value.split(/\n+/).map(l => l.split(/[,;\s\t]+/).filter(Boolean).map(Number)).filter(a => a.length >= 2 && !isNaN(a[0]) && !isNaN(a[1])).map(a => [a[0], a[1]]).sort((x, y) => x[0] - y[0]);
      if (cs.set.startsWith('CDV')) { L[cs.set] = L[cs.set] || {}; L[cs.set][cs.q] = pts; } else { L[cs.set] = L[cs.set] || {}; L[cs.set][cs.code] = L[cs.set][cs.code] || {}; L[cs.set][cs.code][cs.sev] = pts; }
      save(); toast(`Saved ${pts.length} points`); render(); break; }
    case 'backup': toast('Preparing backup…'); await fullBackup(); break;
    case 'demo': loadDemo(); break;
    case 'wipe': if (confirm('Delete ALL projects, photos and the curve library on this device?') && confirm('Really delete everything? This cannot be undone.')) { S = blankState(); await idb.clear('photos'); save(true); go('#/'); render(); } break;
    case 'install': if (window.__deferredPrompt) { window.__deferredPrompt.prompt(); window.__deferredPrompt = null; } break;
    case 'print': await printReport(c.p); break;
    case 'exportProject': await exportProject(c.p); break;
    case 'csv': await deliver(slug(c.p.name) + '_distress.csv', csvFor(c.p), 'text/csv'); break;
    case 'tex': await deliver(slug(c.p.name) + '_report.tex', texFor(c.p, false), 'application/x-tex'); break;
    case 'zip': toast('Building package…'); await zipPackage(c.p); break;
  }
});
function openModal(html) { closeModal(true); const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal'; bg.innerHTML = `<div class="modal">${html}</div>`; bg.addEventListener('click', ev => { if (ev.target === bg) { closeModal(); UI.slab = null; render(); } }); document.body.appendChild(bg); }
function closeModal() { const m = $('#modal'); if (m) m.remove(); }


/* ============================ demo (ASTM D6433-24 Figs. 4-8) ============================ */
function loadDemo() {
  const p = {id: uid(), name: 'Demo — ASTM D6433-24 worked examples', number: 'DEMO', client: 'Validation', location: 'Figs. 4–8 of the standard', date: today(), inspectors: 'KAK (per standard)', notes: 'Deduct values and CDVs are the values printed in the standard, entered as manual overrides. Expected PCI = 49 for both units.', sections: [], updated: Date.now()};
  const ac = {id: uid(), branch: 'Springfield', name: '001', type: 'AC', system: 'US', area: 2500, N: 1, unitSize: 2500, sDev: 10, e: 5, use: 'Roadway', notes: 'Fig. 4 data'};
  const au = newUnit(ac, 1, 'R'); au.area = 2500;
  [[1, 'L', '5+4+4'], [1, 'H', '8+6'], [7, 'L', '32+15+18+24+41'], [8, 'M', '20+15+35+27+23+10+13'], [11, 'H', '3*4+2*5'], [13, 'L', '1'], [15, 'L', '4+9+8'], [20, 'L', '250']].forEach(([c, s, ex]) => au.entries.push({id: uid(), code: c, sev: s, qty: evalExpr(ex), expr: ex, note: ''}));
  au.dvOverride = {'1|L': 7.9, '1|H': 23.4, '7|L': 7.5, '8|M': 25.1, '11|H': 17.9, '13|L': 11.2, '15|L': 6.9, '20|L': 5.3};
  au.cdvOverride = {0: 51, 1: 50, 2: 46, 3: 47, 4: 48, 5: 48, 6: 44};
  au.done = true; au.notes = 'Standard lists item 19 (weathering/raveling, L, 250 ft²); entered here as 20 Weathering L.';
  ac.units = [au];
  const pc = {id: uid(), branch: 'Second', name: '001', type: 'PCC', system: 'US', area: 4800, N: 1, slabLen: 20, slabWid: 12, sDev: 15, e: 5, use: 'Roadway', notes: 'Fig. 7 data (slab layout arranged to give the standard\'s slab counts)'};
  const pu = newUnit(pc, 1, 'R'); pu.slabs = 20; pu.cols = 2; pu.jointSeal = 'H';
  const mk = (k, o) => pu.slabMarks[k] = Object.assign(pu.slabMarks[k] || {}, o);
  ['10-1', '2-1', '1-2'].forEach(k => mk(k, {23: 'M'}));
  ['8-1', '7-1', '7-2'].forEach(k => mk(k, {22: 'L'})); mk('8-2', {22: 'M'});
  ['9-1', '9-2', '3-1', '2-2'].forEach(k => mk(k, {30: 'M'}));
  ['5-1', '4-2'].forEach(k => mk(k, {34: 'M'}));
  ['9-1', '9-2', '8-2', '6-1', '1-1', '3-2'].forEach(k => mk(k, {38: 'L'}));
  mk('1-1', {39: 'H'});
  pu.dvOverride = {'26|H': 8.0, '22|L': 12.6, '22|M': 7.7, '23|M': 30.5, '30|M': 4.4, '34|M': 25.1, '38|L': 5.8, '39|H': 9.0};
  pu.cdvOverride = {0: 50, 1: 49.5, 2: 51, 3: 49, 4: 50, 5: 50};
  pu.done = true; pc.units = [pu];
  p.sections.push(ac, pc); S.projects.push(p); save(true); toast('Demo project loaded'); go(`#/p/${p.id}`);
}

