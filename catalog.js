/* PCI Survey — distress catalogue (paraphrased from ASTM D6433-24 Appendices X1/X2).
   Severity text is a field reminder only; the licensed standard governs. */
'use strict';
const CATALOG = {
  AC: [
    {code:1,  name:'Alligator (fatigue) cracking', m:'area', sev:['L','M','H'], ref:'X1.5', helper:null,
     tip:'L: fine parallel hairline cracks, few/no interconnections, not spalled. M: pattern/network, may be lightly spalled. H: pieces well defined, spalled edges; some rock under traffic. Load-related (wheel paths). Record rutting in same area separately.'},
    {code:2,  name:'Bleeding', m:'area', sev:['L','M','H'], ref:'X1.6',
     tip:'L: very slight, a few days/yr, not sticky. M: sticks to shoes/vehicles a few weeks/yr. H: considerable sticking several weeks/yr. If counted, do not count polished aggregate in same area.'},
    {code:3,  name:'Block cracking', m:'area', sev:['L','M','H'], ref:'X1.7',
     tip:'Rectangular blocks ~0.3×0.3 m (1×1 ft) to 3×3 m (10×10 ft); not load-related. Severity = severity of the defining cracks (use L&T crack criteria).'},
    {code:4,  name:'Bumps and sags', m:'length', sev:['L','M','H'], ref:'X1.8', ride:true,
     tip:'Severity by ride quality. Count only if traffic likely crosses. Record any associated crack too. Spaced <3 m (10 ft) perpendicular to traffic = corrugation.'},
    {code:5,  name:'Corrugation', m:'area', sev:['L','M','H'], ref:'X1.9', ride:true,
     tip:'Closely spaced ridges/valleys, usually <3 m (10 ft) apart, perpendicular to traffic. Severity by ride quality.'},
    {code:6,  name:'Depression', m:'area', sev:['L','M','H'], ref:'X1.10', helper:'depression',
     tip:'Max depth: L 13–25 mm (½–1 in.); M 25–50 mm (1–2 in.); H >50 mm (2 in.).'},
    {code:7,  name:'Edge cracking', m:'length', sev:['L','M','H'], ref:'X1.11',
     tip:'Within ~0.3–0.5 m (1–1.5 ft) of outer edge. L: no breakup/raveling. M: some breakup & raveling. H: considerable breakup or raveling.'},
    {code:8,  name:'Joint reflection cracking (from PCC)', m:'length', sev:['L','M','H'], ref:'X1.12', helper:'accrack',
     tip:'AC over PCC slabs only. L: unfilled <10 mm (3/8 in.) or filled OK. M: unfilled 10–75 mm; or ≤75 mm with light secondary cracking; or filled with light secondary. H: med/high secondary cracking; unfilled >75 mm (3 in.); or ~100 mm (4 in.) around crack severely broken. Record each crack length/severity separately.'},
    {code:9,  name:'Lane/shoulder drop-off', m:'length', sev:['L','M','H'], ref:'X1.13', helper:'dropoff',
     tip:'Elevation difference: L 25–50 mm (1–2 in.); M 50–100 mm (2–4 in.); H >100 mm (4 in.).'},
    {code:10, name:'Longitudinal & transverse cracking', m:'length', sev:['L','M','H'], ref:'X1.14', helper:'accrack',
     tip:'Not PCC-joint reflective. Same width criteria as 8, with light random cracking in place of secondary cracking. Record each portion of different severity separately.'},
    {code:11, name:'Patching & utility cut patching', m:'area', sev:['L','M','H'], ref:'X1.15',
     tip:'L: good, ride L or better. M: moderately deteriorated and/or ride M. H: badly deteriorated and/or ride H; replace soon. Do NOT record distress inside a patch — it sets patch severity.'},
    {code:12, name:'Polished aggregate', m:'area', sev:['N'], ref:'X1.16',
     tip:'No severity levels. Aggregate smooth to touch, negligible projection. Not counted where bleeding is counted.'},
    {code:13, name:'Potholes', m:'count', sev:['L','M','H'], ref:'X1.17', helper:'pothole',
     tip:'Count holes by severity (Table X1.1, diameter vs depth). >750 mm (30 in.) dia: area ÷ 0.5 m² (5.5 ft²) = equivalent holes; ≤25 mm deep M, deeper H.'},
    {code:14, name:'Railroad crossing', m:'area', sev:['L','M','H'], ref:'X1.18', ride:true,
     tip:'Severity by ride quality. Not counted if ride is unaffected. Large bump from tracks is part of the crossing.'},
    {code:15, name:'Rutting', m:'area', sev:['L','M','H'], ref:'X1.19', helper:'rut',
     tip:'Mean rut depth: L 6–13 mm (¼–½ in.); M >13–25 mm; H >25 mm (1 in.). Straightedge across rut; average depths along it.'},
    {code:16, name:'Shoving', m:'area', sev:['L','M','H'], ref:'X1.20', ride:true,
     tip:'Severity by ride quality. Shoves inside patches are rated with the patch.'},
    {code:17, name:'Slippage cracking', m:'area', sev:['L','M','H'], ref:'X1.21', helper:'slippage',
     tip:'Avg width: L <10 mm; M 10–40 mm, or moderately spalled / secondary cracks; H >40 mm (1½ in.) or easily removed pieces. Rate area at highest severity.'},
    {code:18, name:'Swell', m:'area', sev:['L','M','H'], ref:'X1.22', ride:true,
     tip:'Long gradual bulge >3 m (10 ft). Severity by ride quality.'},
    {code:19, name:'Raveling (dense mix)', m:'area', sev:['M','H'], ref:'X1.23', helper:'ravel',
     tip:'No L level. M: >20 missing coarse particles per m² (yd²) and/or missing clusters. H: very rough and pitted. If raveling present, do not record weathering.'},
    {code:20, name:'Weathering (surface wear)', m:'area', sev:['L','M','H'], ref:'X1.24',
     tip:'L: fines loss noticeable, coarse edges exposed <1 mm. M: edges exposed up to ¼ of longest side. H: exposed >¼; coarse aggregate loss possible. Not recorded where M/H raveling recorded.'}
  ],
  PCC: [
    {code:21, name:'Blowup / buckling', m:'slab', sev:['L','M','H'], ref:'X2.3', ride:true,
     tip:'Severity by ride quality. At a joint affecting two slabs, mark both slabs.'},
    {code:22, name:'Corner break', m:'slab', sev:['L','M','H'], ref:'X2.4', helper:'pcccrack',
     tip:'Crack meets both joints ≤ half the slab length from the corner, full depth. Severity per crack criteria. One slab at highest severity.'},
    {code:23, name:'Divided slab', m:'slab', sev:['L','M','H'], ref:'X2.5', helper:'divided',
     tip:'4+ pieces. Table X2.1 (majority crack severity × pieces). If M or H, NO other distress is counted in that slab (app enforces).'},
    {code:24, name:'Durability ("D") cracking', m:'slab', sev:['L','M','H'], ref:'X2.6',
     tip:'L: <15% of slab, mostly tight. M: <15% mostly loose/missing, or >15% mostly tight. H: >15% and most pieces out/removable.'},
    {code:25, name:'Faulting', m:'slab', sev:['L','M','H'], ref:'X2.7', helper:'fault',
     tip:'At joints only. L 3–10 mm (⅛–⅜ in.); M 10–20 mm (⅜–¾ in.); H >20 mm (¾ in.).'},
    {code:26, name:'Joint seal damage', m:'unit', sev:['L','M','H'], ref:'X2.8',
     tip:'Rated once for the whole sample unit (not per slab). Fixed deducts L=2, M=4, H=8.'},
    {code:27, name:'Lane/shoulder drop-off', m:'slab', sev:['L','M','H'], ref:'X2.9', helper:'dropoffpcc',
     tip:'Mean of max & min drop along slab: L 25–50 mm; M 50–100 mm; H >100 mm.'},
    {code:28, name:'Linear cracking', m:'slab', sev:['L','M','H'], ref:'X2.10', helper:'pcccrack',
     tip:'Divides slab into 2–3 pieces. Plain: L ≤13 mm; M 13–50 mm or fault <10 mm; H >50 mm or fault >10 mm. Two M cracks in one slab = H (app enforces).'},
    {code:29, name:'Patching, large (>0.5 m²) & utility cuts', m:'slab', sev:['L','M','H'], ref:'X2.11',
     tip:'L: functioning well. M: moderately deteriorated or moderate edge spalling. H: badly deteriorated; replace.'},
    {code:30, name:'Patching, small (<0.5 m²)', m:'slab', sev:['L','M','H'], ref:'X2.12',
     tip:'L: functioning well. M: moderately deteriorated. H: badly deteriorated; replace.'},
    {code:31, name:'Polished aggregate', m:'slab', sev:['N'], ref:'X2.13', tip:'No severity. Polishing must be significant.'},
    {code:32, name:'Popouts', m:'slab', sev:['N'], ref:'X2.14', tip:'No severity. Count only if average > ~3 popouts/m² over the slab (check three random 1 m² areas if in doubt).'},
    {code:33, name:'Pumping', m:'slab', sev:['N'], ref:'X2.15', tip:'No severity. A pumping joint between two slabs = 2 slabs; mark both. +1 slab per additional pumping joint (use the joint counter).'},
    {code:34, name:'Punchout', m:'slab', sev:['L','M','H'], ref:'X2.16', helper:'punchout',
     tip:'Table X2.3. More than one punchout, or punchout + crack, in a slab = divided (shattered) slab.'},
    {code:35, name:'Railroad crossing', m:'slab', sev:['L','M','H'], ref:'X2.17', ride:true, tip:'Severity by ride quality. Count slabs crossed by the tracks.'},
    {code:36, name:'Scaling / map cracking / crazing', m:'slab', sev:['L','M','H'], ref:'X2.18',
     tip:'L: crazing over most of slab, minor scaling (count only if scaling imminent). M: scaled <15% of slab. H: scaled >15%.'},
    {code:37, name:'Shrinkage cracks', m:'slab', sev:['N'], ref:'X2.19', tip:'No severity. Hairline, usually <2 m, not across slab.'},
    {code:38, name:'Spalling, corner', m:'slab', sev:['L','M','H'], ref:'X2.20', helper:'cornerspall',
     tip:'Within ~0.5 m (1.5 ft) of corner; Table X2.4 (depth × size). Not counted if <130 mm (5 in.) along both sides.'},
    {code:39, name:'Spalling, joint', m:'slab', sev:['L','M','H'], ref:'X2.21', helper:'jointspall',
     tip:'Within 0.5 m (1.5 ft) of joint; Table X2.5. Frayed joint = L. One slab (worst edge).'}
  ]
};

/* Rating bands (D6433-24 Fig. 1) */
const RATINGS = [
  {min:85, max:100, label:'Good',         color:'#1E7B3A', text:'#fff'},
  {min:70, max:85,  label:'Satisfactory', color:'#7DC07F', text:'#000'},
  {min:55, max:70,  label:'Fair',         color:'#F2D64B', text:'#000'},
  {min:40, max:55,  label:'Poor',         color:'#F29C8F', text:'#000'},
  {min:25, max:40,  label:'Very Poor',    color:'#D9534F', text:'#fff'},
  {min:10, max:25,  label:'Serious',      color:'#8B1E1E', text:'#fff'},
  {min:0,  max:10,  label:'Failed',       color:'#4D4D4D', text:'#fff'}
];

/* Distresses whose density is length/area or count/area -> separate SI curves may apply */
const AC_UNIT_SENSITIVE = [4,7,8,9,10,13];

/* Supplementary (non-PCI) observation checklist */
const SUPPLEMENTAL = [
  'Ponding / birdbaths after rain', 'Clogged or damaged inlet / drain', 'Curb or gutter damage',
  'Vertical displacement on accessible route (> 1/4 in.)', 'Trip hazard', 'Evidence of settlement',
  'Evidence of heave / swelling soil', 'Pumping fines at inlets or edges', 'Oil / fuel staining',
  'Vegetation in cracks or joints', 'Faded or missing striping', 'Wheel stops damaged / displaced',
  'Utility covers out of level', 'Tree-root damage'
];

const REPAIR_ITEMS = [
  {item:'Crack sealing', unit:'LF'}, {item:'Joint resealing', unit:'LF'}, {item:'Partial-depth repair', unit:'SF'},
  {item:'Full-depth repair / patch', unit:'SF'}, {item:'Slab replacement', unit:'EA'}, {item:'Slab stabilization / undersealing', unit:'EA'},
  {item:'Slab lifting', unit:'EA'}, {item:'Mill and overlay', unit:'SF'}, {item:'Surface seal / slurry', unit:'SF'},
  {item:'Pothole repair', unit:'EA'}, {item:'Diamond grinding', unit:'SF'}, {item:'Cross-stitching', unit:'LF'},
  {item:'Dowel bar retrofit', unit:'EA'}, {item:'Reconstruction', unit:'SF'}, {item:'Other', unit:''}
];
