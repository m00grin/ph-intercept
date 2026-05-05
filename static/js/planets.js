// ── Planets ─────────────────────────────────────────────────────────
const PLANET_VIS = {
  Mars:    { color: '210, 140, 120', radius: 1.8, glow: 3.5 },
  Jupiter: { color: '220, 210, 175', radius: 2.6, glow: 5.0 },
  Saturn:  { color: '218, 198, 148', radius: 2.2, glow: 4.0, ring: true },
  Moon:    { color: '230, 228, 215', radius: 3.5, glow: 10.0 },
};
const PLANET_ORBITS = [
  { name: 'Mars',    L0: 355.45332, Lr: 0.5240207766, peri: 336.04084,   e: 0.09341233, a: 1.52366231, note: 'The Red Planet' },
  { name: 'Jupiter', L0: 34.40438,  Lr: 0.08308529,   peri: 14.72847983, e: 0.04838624, a: 5.20336301, note: 'King of the planets' },
  { name: 'Saturn',  L0: 49.94432,  Lr: 0.03346064,   peri: 92.59887831, e: 0.05386179, a: 9.53707032, note: 'The ringed giant' },
];
const EARTH_ORB = { L0: 100.46457166, Lr: 0.9856473556, peri: 102.93768193, e: 0.01671123, a: 1.00000261 };
let planets = [];

function computePlanets() {
  const d = Date.now() / 86400000 + 2440587.5 - 2451545.0;
  const toR = a => a * Math.PI / 180, toD = a => a * 180 / Math.PI;
  const mod = a => ((a % 360) + 360) % 360;
  const eps = toR(23.4393);
  function helio(o) {
    const L = mod(o.L0 + o.Lr * d), M = toR(mod(L - o.peri));
    const nu = M + 2 * o.e * Math.sin(M) + 1.25 * o.e * o.e * Math.sin(2 * M);
    return { lon: toR(mod(toD(nu) + o.peri)), r: o.a * (1 - o.e * o.e) / (1 + o.e * Math.cos(nu)) };
  }
  const earth = helio(EARTH_ORB);
  planets = [];
  for (const b of PLANET_ORBITS) {
    const p = helio(b);
    const gl = Math.atan2(p.r * Math.sin(p.lon) - earth.r * Math.sin(earth.lon), p.r * Math.cos(p.lon) - earth.r * Math.cos(earth.lon));
    let ra = toD(Math.atan2(Math.sin(gl) * Math.cos(eps), Math.cos(gl))) / 15;
    planets.push({ name: b.name, ra: ((ra % 24) + 24) % 24, dec: toD(Math.asin(Math.sin(gl) * Math.sin(eps))), note: b.note, type: 'Planet', ...PLANET_VIS[b.name] });
  }
  const Lm = mod(218.3165 + 13.17639648 * d), Mm = mod(134.9634 + 13.06499295 * d);
  const F = mod(93.2721 + 13.22935024 * d), D = mod(297.8502 + 12.19074912 * d), Ms = mod(357.5291 + 0.98560028 * d);
  const mLon = toR(Lm + 6.2894*Math.sin(toR(Mm)) + 1.274*Math.sin(toR(2*D-Mm)) + 0.6583*Math.sin(toR(2*D)) + 0.2136*Math.sin(toR(2*Mm)) - 0.1856*Math.sin(toR(Ms)) - 0.1143*Math.sin(toR(2*F)));
  const mLat = toR(5.128*Math.sin(toR(F)) + 0.2806*Math.sin(toR(Mm+F)) + 0.2777*Math.sin(toR(Mm-F)) + 0.1732*Math.sin(toR(2*D-F)));
  let mRA = toD(Math.atan2(Math.sin(mLon)*Math.cos(eps)-Math.tan(mLat)*Math.sin(eps), Math.cos(mLon))) / 15;
  const moonElong = mod(toD(mLon) - mod(toD(earth.lon) + 180));
  planets.push({ name: 'Moon', ra: ((mRA%24)+24)%24, dec: toD(Math.asin(Math.sin(mLat)*Math.cos(eps)+Math.cos(mLat)*Math.sin(eps)*Math.sin(mLon))), elong: moonElong, note: "Earth's natural satellite", type: 'Natural satellite', ...PLANET_VIS.Moon });
}

function drawMoonPhase(ctx, cx, cy, r, glowR, elongDeg) {
  const elong = ((elongDeg % 360) + 360) % 360;
  const phi = elong * Math.PI / 180, cph = Math.cos(phi), PI2 = Math.PI / 2;
  const k = (1 - cph) / 2; // illuminated fraction: 0=new, 1=full
  if (k < 0.02) return; // near new moon — not visible
  const ga = Math.min(k * 0.44, 0.22); // glow fades proportionally for crescent phases
  const gr = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, glowR);
  gr.addColorStop(0, `rgba(230,228,215,${ga})`); gr.addColorStop(1, 'rgba(230,228,215,0)');
  ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fillStyle = gr; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  const LIT = 'rgba(230,228,215,0.9)', DARK = 'rgba(8,8,11,1)';
  ctx.fillStyle = LIT; ctx.fillRect(cx - r - 1, cy - r - 1, r * 2 + 2, r * 2 + 2);
  if (k < 0.98) { // not full moon — draw shadow
    const xr = Math.abs(r * cph);
    ctx.fillStyle = DARK;
    ctx.beginPath();
    if (elong < 180) {
      ctx.arc(cx, cy, r, -PI2, PI2, true);
      ctx.ellipse(cx, cy, xr, r, 0, PI2, -PI2, cph < 0);
    } else {
      ctx.arc(cx, cy, r, -PI2, PI2, false);
      ctx.ellipse(cx, cy, xr, r, 0, PI2, -PI2, cph > 0);
    }
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
