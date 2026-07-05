// ── ph-intercept starfield - fixed view, no pan/zoom/tooltips ────────
// BG_MODE is injected by the server as window.BG_CONFIG (see index.html).

const _cfg     = window.BG_CONFIG || {};
const BG_MODE  = (_cfg.bg_mode  || 'starfield').toLowerCase();
// Sky centre - mutable so the in-app sky-preset picker can re-aim the view live.
// project() and buildBg() read these every rebuild, so updating them + bgDirty repaints.
let HOME_RA  = typeof _cfg.sky_ra  === 'number' ? _cfg.sky_ra  : 19.27;
let HOME_DEC = typeof _cfg.sky_dec === 'number' ? _cfg.sky_dec : 15.86;

const HOME_RA_SPAN  = 4.74;
const HOME_DEC_SPAN = 94.6;

// Fixed view - no pan. dso-render.js reads these from global scope.
let panRA = 0, panDec = 0;
let zoomLevel = 1;

const canvas = document.getElementById('starfield');
const ctx    = canvas.getContext('2d');
let w = 0, h = 0;
let _dpr = 1;   // device pixel ratio the backing store is sized for (read by dso-render.js)

function resize() {
  // Match the game canvas: render at physical-pixel resolution so fractional OS/browser
  // scaling stays crisp. w/h stay in CSS pixels; the transform maps them to device pixels.
  // At devicePixelRatio 1 this is a no-op (transform = identity).
  _dpr = Math.min(window.devicePixelRatio || 1, 3);
  w = window.innerWidth; h = window.innerHeight;
  canvas.width = Math.round(w * _dpr); canvas.height = Math.round(h * _dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
  bgDirty = true;   // defined in dso-render.js
}
window.addEventListener('resize', resize);

// ── Projection (fixed - no pan, no zoom) ─────────────────────────────
function project(ra, dec, depth) {
  return [
    (1 - (ra  - (HOME_RA  - HOME_RA_SPAN  / 2)) / HOME_RA_SPAN)  * w,
    (1 - (dec - (HOME_DEC - HOME_DEC_SPAN / 2)) / HOME_DEC_SPAN) * h,
  ];
}

// In ph-intercept the game is always fullscreen - starfield is never dimmed.
window._startZenFade = function() {};

// ── Star cache (populated on data load) ──────────────────────────────
let STARS = [];
let starCache = [], phases = [];

// ── Main draw loop ────────────────────────────────────────────────────
nextSatDelay   = 45000 + Math.random() * 90000;
nextMeteorDelay = 20000 + Math.random() * 40000;

function draw(t) {
  // Gate on the live mode (window._bgMode), which the in-app picker flips at runtime.
  // 'dark' mode: paint the canvas true black (matches the starfield's own #000 space, and
  // is darker than the themed body bg that would otherwise show through). Done every frame
  // so it survives window resizes, which clear the backing store.
  if (window._bgMode === 'dark') {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    requestAnimationFrame(draw); return;
  }
  // Keep the rAF alive while idle so a switch back to starfield resumes instantly.
  if (window._bgMode !== 'starfield') { requestAnimationFrame(draw); return; }

  // buildBg and bgCanvas/bgDirty/lastBgUpdate are owned by dso-render.js
  if (bgDirty || t - lastBgUpdate > 80) {
    buildBg(t);
    lastBgUpdate = t;
  }
  // bgCanvas is sized to device pixels (see buildBg), so blit it 1:1 at identity,
  // then restore the DPR transform for the transients drawn below in CSS coords.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bgCanvas, 0, 0);
  ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);

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

// Runtime switches driven by the in-app background picker (see game.js settings menu).
window.applyBgMode = function (mode) {
  window._bgMode = mode;
  bgDirty = true;   // force a starfield bg rebuild at the current size when it reactivates
  if (mode === 'image') {
    // Reveal the #bg-image div: wipe any stale starfield/nebula frame so the shared canvas
    // is transparent. (Resizes re-clear it; the draw loop leaves 'image' untouched.)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  // 'dark' is painted black by the draw loop; 'starfield'/'nebula' redraw themselves.
};
window.applySkyPreset = function (ra, dec) {
  if (typeof ra === 'number')  HOME_RA  = ra;
  if (typeof dec === 'number') HOME_DEC = dec;
  bgDirty = true;
};

// ── Load & init ───────────────────────────────────────────────────────
// Always load the star data and start the loop (even if the page opened in nebula/image
// mode) so the user can switch to starfield in-app without a reload. The loop idles via
// the window._bgMode gate above until starfield is the active mode.
{
  fetch('/static/stars-lite.json').then(r => r.json()).then(d => {
    STARS       = d.stars;
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
  }).catch(() => {
    resize();
    requestAnimationFrame(draw);
  });
}
