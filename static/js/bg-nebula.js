// ── Procedural nebula background ─────────────────────────────────────
// Activated when BG_MODE === 'nebula'.  Renders to the #starfield canvas
// using a seeded simplex-noise-like approach (no external deps).
// Three overlapping nebula lobes + a sparse synthetic star layer.
// Built once into an offscreen canvas, then blitted each frame.

(function () {
  if ((window.BG_CONFIG || {}).bg_mode !== 'nebula') return;

  const canvas = document.getElementById('starfield');
  const ctx    = canvas.getContext('2d');

  // ── Seeded PRNG (mulberry32) ──────────────────────────────────────
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ── Value noise (2D, 4×4 grid) ────────────────────────────────────
  function makeNoise(rng, gridW, gridH) {
    const g = new Float32Array(gridW * gridH);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    function lerp(a, b, t) { return a + (b - a) * (t * t * (3 - 2 * t)); }
    return function (nx, ny) {          // nx, ny in [0,1]
      const gx = nx * (gridW - 1), gy = ny * (gridH - 1);
      const x0 = Math.floor(gx) % gridW, y0 = Math.floor(gy) % gridH;
      const x1 = (x0 + 1) % gridW,      y1 = (y0 + 1) % gridH;
      const tx = gx - Math.floor(gx),   ty = gy - Math.floor(gy);
      return lerp(lerp(g[y0*gridW+x0], g[y0*gridW+x1], tx),
                  lerp(g[y1*gridW+x0], g[y1*gridW+x1], tx), ty);
    };
  }

  // ── Nebula lobe definitions ───────────────────────────────────────
  const LOBES = [
    { cx: 0.38, cy: 0.42, rx: 0.34, ry: 0.26, r: 90,  g: 30,  b: 100, a: 0.30 },
    { cx: 0.62, cy: 0.55, rx: 0.28, ry: 0.22, r: 55,  g: 20,  b: 130, a: 0.25 },
    { cx: 0.50, cy: 0.30, rx: 0.20, ry: 0.18, r: 110, g: 40,  b: 80,  a: 0.20 },
    { cx: 0.30, cy: 0.65, rx: 0.18, ry: 0.15, r: 70,  g: 50,  b: 160, a: 0.18 },
  ];

  // ── Build offscreen ───────────────────────────────────────────────
  let offscreen = null;
  let lastW = 0, lastH = 0;

  function build(w, h) {
    if (offscreen && lastW === w && lastH === h) return;
    lastW = w; lastH = h;

    offscreen = document.createElement('canvas');
    offscreen.width = w; offscreen.height = h;
    const oc = offscreen.getContext('2d');

    // Background gradient
    const bg = oc.createRadialGradient(w*0.5, h*0.5, 0, w*0.5, h*0.5, Math.max(w,h)*0.7);
    bg.addColorStop(0,   'rgba(8, 4, 20, 1)');
    bg.addColorStop(0.6, 'rgba(4, 2, 12, 1)');
    bg.addColorStop(1,   'rgba(2, 1, 6, 1)');
    oc.fillStyle = bg;
    oc.fillRect(0, 0, w, h);

    // Noise fields
    const rng1 = mulberry32(0xDEADBEEF);
    const rng2 = mulberry32(0xCAFEBABE);
    const n1   = makeNoise(rng1, 8, 8);
    const n2   = makeNoise(rng2, 6, 6);

    // Nebula lobes
    for (const lobe of LOBES) {
      const cx = lobe.cx * w, cy = lobe.cy * h;
      const rx = lobe.rx * w, ry = lobe.ry * h;
      const steps = 6;
      for (let s = steps; s >= 1; s--) {
        const f = s / steps;
        const frx = rx * f, fry = ry * f;
        const nx = (cx - frx) / w, ny = (cy - fry) / h;
        const nv = (n1(nx + 0.5, ny + 0.5) * 0.6 + n2(nx * 1.3, ny * 1.3) * 0.4);
        const alpha = lobe.a * f * (0.6 + nv * 0.8);
        const grad = oc.createRadialGradient(cx, cy, 0, cx, cy, Math.max(frx, fry));
        grad.addColorStop(0,   `rgba(${lobe.r},${lobe.g},${lobe.b},${alpha})`);
        grad.addColorStop(0.4, `rgba(${lobe.r},${lobe.g},${lobe.b},${alpha*0.6})`);
        grad.addColorStop(1,   `rgba(${lobe.r},${lobe.g},${lobe.b},0)`);
        oc.save();
        oc.translate(cx, cy);
        oc.scale(frx / Math.max(frx, fry), fry / Math.max(frx, fry));
        oc.translate(-cx, -cy);
        oc.fillStyle = grad;
        oc.beginPath(); oc.arc(cx, cy, Math.max(frx, fry), 0, Math.PI * 2); oc.fill();
        oc.restore();
      }
    }

    // Dust lanes
    const rngD = mulberry32(0xABCDEF01);
    for (let i = 0; i < 5; i++) {
      const x0 = rngD() * w, y0 = rngD() * h;
      const x1 = rngD() * w, y1 = rngD() * h;
      const lg = oc.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, 'rgba(0,0,0,0)');
      lg.addColorStop(0.5, `rgba(0,0,0,${0.06 + rngD() * 0.06})`);
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      oc.strokeStyle = lg;
      oc.lineWidth = 20 + rngD() * 60;
      oc.beginPath(); oc.moveTo(x0, y0); oc.lineTo(x1, y1); oc.stroke();
    }

    // Synthetic star layer
    const rngS = mulberry32(0x12345678);
    const count = Math.round((w * h) / 4000);
    for (let i = 0; i < count; i++) {
      const sx = rngS() * w, sy = rngS() * h;
      const mag = rngS() * rngS();                  // bias toward faint
      const r   = 0.4 + (1 - mag) * 1.2;
      const op  = 0.15 + (1 - mag) * 0.7;
      const bv  = rngS() * 2 - 0.4;
      let cr = 255, cg = 255, cb = 255;
      if (bv < -0.1)      { cr = 160; cg = 190; cb = 255; }
      else if (bv < 0.3)  { cr = 240; cg = 245; cb = 255; }
      else if (bv < 0.8)  { cr = 255; cg = 240; cb = 200; }
      else                { cr = 255; cg = 200; cb = 140; }
      oc.fillStyle = `rgba(${cr},${cg},${cb},${op})`;
      oc.beginPath(); oc.arc(sx, sy, r, 0, Math.PI * 2); oc.fill();
      if (mag < 0.03) {
        const gr = oc.createRadialGradient(sx, sy, 0, sx, sy, r * 4);
        gr.addColorStop(0, `rgba(${cr},${cg},${cb},${op * 0.3})`);
        gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        oc.fillStyle = gr;
        oc.beginPath(); oc.arc(sx, sy, r * 4, 0, Math.PI * 2); oc.fill();
      }
    }
  }

  // ── Draw loop ─────────────────────────────────────────────────────
  function draw() {
    const cw = window.innerWidth, ch = window.innerHeight;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw; canvas.height = ch;
    }
    build(cw, ch);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(offscreen, 0, 0);
    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
})();
