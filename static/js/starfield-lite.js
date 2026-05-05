// ── ph-intercept starfield — fixed view, no pan/zoom/tooltips ────────
// BG_MODE is injected by the server as window.BG_CONFIG (see index.html).

const _cfg     = window.BG_CONFIG || {};
const BG_MODE  = (_cfg.bg_mode  || 'starfield').toLowerCase();
const HOME_RA  = typeof _cfg.sky_ra  === 'number' ? _cfg.sky_ra  : 19.27;
const HOME_DEC = typeof _cfg.sky_dec === 'number' ? _cfg.sky_dec : 15.86;

const HOME_RA_SPAN  = 4.74;
const HOME_DEC_SPAN = 94.6;

// Fixed view — no pan. dso-render.js reads these from global scope.
let panRA = 0, panDec = 0;
let zoomLevel = 1;

const canvas = document.getElementById('starfield');
const ctx    = canvas.getContext('2d');
let w = 0, h = 0;

function resize() {
  w = canvas.width  = window.innerWidth;
  h = canvas.height = window.innerHeight;
  bgDirty = true;   // defined in dso-render.js
}
window.addEventListener('resize', resize);

// ── Projection (fixed — no pan, no zoom) ─────────────────────────────
function project(ra, dec, depth) {
  return [
    (1 - (ra  - (HOME_RA  - HOME_RA_SPAN  / 2)) / HOME_RA_SPAN)  * w,
    (1 - (dec - (HOME_DEC - HOME_DEC_SPAN / 2)) / HOME_DEC_SPAN) * h,
  ];
}

// ── Helpers used by dso-render.js's buildBg ───────────────────────────
function getDepth(mag) {
  if (mag < 1) return 1.06; if (mag < 2) return 1.05; if (mag < 3) return 1.04;
  if (mag < 4) return 1.03; if (mag < 5) return 1.02; if (mag < 6) return 1.01;
  return 1.0;
}

// In ph-intercept the game is always fullscreen — starfield is never dimmed.
window._startZenFade = function() {};
let zenAlpha = 0;

// ── Star cache (populated on data load) ──────────────────────────────
let STARS = [], STAR_INFO = {};
let starCache = [], phases = [];

// ── Main draw loop ────────────────────────────────────────────────────
nextSatDelay   = 45000 + Math.random() * 90000;
nextMeteorDelay = 20000 + Math.random() * 40000;

function draw(t) {
  if (BG_MODE !== 'starfield') { requestAnimationFrame(draw); return; }

  // buildBg and bgCanvas/bgDirty/lastBgUpdate are owned by dso-render.js
  if (bgDirty || t - lastBgUpdate > 80) {
    buildBg(t);
    lastBgUpdate = t;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bgCanvas, 0, 0);

  // Transients
  if (t - lastSatSpawn > nextSatDelay) {
    spawnSatellite(t); lastSatSpawn = t; nextSatDelay = 45000 + Math.random() * 90000;
  }
  if (t - lastMeteorSpawn > nextMeteorDelay) {
    spawnMeteor(t); lastMeteorSpawn = t; nextMeteorDelay = 20000 + Math.random() * 40000;
  }

  for (let i = transients.length - 1; i >= 0; i--) {
    const tr = transients[i], elapsed = t - tr.start;
    if (elapsed < 0) continue;
    if (elapsed > tr.dur) { transients.splice(i, 1); continue; }
    const prog = elapsed / tr.dur;
    if (tr.kind === 'satellite') {
      const ra  = tr.ra0  + (tr.ra1  - tr.ra0)  * prog;
      const dec = tr.dec0 + (tr.dec1 - tr.dec0) * prog;
      const [sx, sy] = project(ra, dec, 1.12);
      if (sx < -5 || sx > w + 5 || sy < -5 || sy > h + 5) continue;
      let br = tr.type === 'iss' ? 0.85 : magToBaseOpacity(tr.mag) * 2.0;
      if (prog < 0.06) br *= prog / 0.06;
      if (prog > 0.94) br *= (1 - prog) / 0.06;
      if (tr.flareAt >= 0) { const fd = Math.abs(prog - tr.flareAt); if (fd < 0.04) br += (1 - fd / 0.04) * 0.9; }
      br = Math.min(br, 1);
      const sr = tr.type === 'iss' ? 1.8 : 0.9;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${br})`; ctx.fill();
      if (tr.type === 'iss') {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 3);
        g.addColorStop(0, `rgba(255,255,255,${br * 0.3})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath(); ctx.arc(sx, sy, sr * 3, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      }
    } else if (tr.kind === 'meteor') {
      const ra  = tr.ra0  + (tr.ra1  - tr.ra0)  * prog;
      const dec = tr.dec0 + (tr.dec1 - tr.dec0) * prog;
      const [hx, hy] = project(ra, dec);
      const tp = Math.max(0, prog - 0.35);
      const [tx, ty] = project(tr.ra0 + (tr.ra1 - tr.ra0) * tp, tr.dec0 + (tr.dec1 - tr.dec0) * tp);
      const fade = prog < 0.4 ? 1 : Math.max(0, 1 - (prog - 0.4) / 0.6);
      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.7, `rgba(255,255,240,${0.3 * fade})`);
      g.addColorStop(1,   `rgba(255,255,240,${0.85 * fade})`);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy);
      ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,240,${0.9 * fade})`; ctx.fill();
    }
  }

  requestAnimationFrame(draw);
}

// ── Load & init ───────────────────────────────────────────────────────
if (BG_MODE === 'starfield') {
  fetch('/static/stars-lite.json').then(r => r.json()).then(d => {
    STARS       = d.stars;
    STAR_INFO   = d.info   || {};
    STAR_COLORS = d.colors || {};
    computePlanets();
    setInterval(computePlanets, 3600000);
    phases = STARS.map(s => {
      const mag = s[3];
      if (mag > 6.5) return {
        off: [Math.random() * 100], freq: [0.003 + Math.random() * 0.004],
        amp: [0.08 + Math.random() * 0.12], spike: 0, simple: true,
      };
      const ms = mag < 1 ? 0.4 : mag < 3 ? 0.7 : mag < 5 ? 1.0 : 1.3;
      return {
        off:   [Math.random()*100, Math.random()*100, Math.random()*100],
        freq:  [0.002+Math.random()*0.0025, 0.005+Math.random()*0.005, 0.009+Math.random()*0.008],
        amp:   [(0.06+Math.random()*0.12)*ms, (0.05+Math.random()*0.10)*ms, (0.04+Math.random()*0.08)*ms],
        spike: 0, simple: false,
      };
    });
    starCache = STARS.map((s, i) => {
      const mag = s[3], color = getStarColor(s[0], mag, s[4]);
      return {
        ra: s[1], dec: s[2], mag,
        cpfx: `rgba(${color}, `,
        r:    magToRadius(mag),
        bop:  magToBaseOpacity(mag),
        glow: mag < 2.0,
        rect: mag > 7,
        ph:   phases[i],
      };
    });
    bgDirty = true;
    resize();
    requestAnimationFrame(draw);
  });
} else {
  resize();
  requestAnimationFrame(draw);
}
