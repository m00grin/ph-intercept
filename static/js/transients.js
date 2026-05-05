// ── Transients (satellites & meteors) ───────────────────────────────
const transients = [];
let lastSatSpawn = 0, lastMeteorSpawn = 0;
let nextSatDelay = 3000, nextMeteorDelay = 6000;

const SAT_TEMPLATES = [
  { ra0: 17.1, dec0: -15, ra1: 21.5, dec1: 50,  dur: 105000, mag: -2.0, type: 'iss' },
  { ra0: 17.3, dec0:  -5, ra1: 21.2, dec1: 45,  dur: 100000, mag: -1.5, type: 'iss' },
  { ra0: 19.2, dec0: -38, ra1: 20.3, dec1: 55,  dur: 80000,  mag: 3.2, type: 'sat' },
  { ra0: 18.5, dec0: -35, ra1: 19.8, dec1: 52,  dur: 85000,  mag: 3.8, type: 'sat' },
  { ra0: 20.2, dec0:  55, ra1: 18.8, dec1: -30, dur: 82000,  mag: 3.5, type: 'sat' },
  { ra0: 17.5, dec0:   0, ra1: 21.0, dec1: 48,  dur: 95000,  mag: 4.2, type: 'starlink' },
  { ra0: 17.8, dec0:  10, ra1: 21.3, dec1: 52,  dur: 92000,  mag: 4.5, type: 'starlink' },
  { ra0: 17.8, dec0: -20, ra1: 21.4, dec1: 40,  dur: 110000, mag: 2.8, type: 'sat' },
  { ra0: 21.6, dec0:   5, ra1: 17.2, dec1: 42,  dur: 95000,  mag: 3.0, type: 'sat' },
  { ra0: 17.0, dec0:  12, ra1: 20.8, dec1: 55,  dur: 88000,  mag: 3.6, type: 'sat' },
  { ra0: 21.0, dec0: -18, ra1: 17.5, dec1: 48,  dur: 100000, mag: 3.4, type: 'sat' },
  { ra0: 18.2, dec0:  55, ra1: 20.5, dec1: -25, dur: 78000,  mag: 4.0, type: 'sat' },
];

function spawnSatellite(t) {
  const issActive = transients.some(tr => tr.type === 'iss' && t >= tr.start && t < tr.start + tr.dur);
  const pool = issActive ? SAT_TEMPLATES.filter(s => s.type !== 'iss') : SAT_TEMPLATES;
  const tmpl = pool[Math.floor(Math.random() * pool.length)];
  const sat = { kind: 'satellite', ra0: tmpl.ra0, dec0: tmpl.dec0, ra1: tmpl.ra1, dec1: tmpl.dec1,
    start: t, dur: tmpl.dur * (0.85 + Math.random() * 0.3), mag: tmpl.mag + (Math.random() - 0.5) * 0.4,
    type: tmpl.type, flareAt: tmpl.type === 'sat' && Math.random() < 0.15 ? 0.25 + Math.random() * 0.5 : -1 };
  if (tmpl.type === 'starlink' && Math.random() < 0.4) {
    const n = 2 + Math.floor(Math.random() * 4);
    for (let j = 0; j < n; j++)
      transients.push({ ...sat, start: t + j * (2000 + Math.random() * 1500), mag: tmpl.mag + Math.random() * 1.2, flareAt: -1 });
  } else transients.push(sat);
}

function spawnMeteor(t) {
  const sra = HOME_RA_SPAN / zoomLevel, sdec = HOME_DEC_SPAN / zoomLevel;
  const cra = HOME_RA + panRA, cdec = HOME_DEC + panDec;
  const ra = (cra - sra / 2) + 0.2 + Math.random() * (sra - 0.4);
  const dec = (cdec - sdec / 2) + 5 + Math.random() * (sdec - 10);
  const ang = Math.random() * Math.PI * 2;
  transients.push({ kind: 'meteor', ra0: ra, dec0: dec,
    ra1: ra + Math.cos(ang) * (0.15 + Math.random() * 0.25),
    dec1: dec + Math.sin(ang) * (4 + Math.random() * 8),
    start: t, dur: 150 + Math.random() * 350 });
}
