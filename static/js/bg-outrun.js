// ── Outrun background ────────────────────────────────────────────────
// Active while window._bgMode === 'outrun'. Renders to the shared #starfield canvas:
// a starry night sky, a banded sun on the horizon, and a bright pink perspective grid.
// Always loaded; idles unless outrun is the active mode.
//
// Perf: everything except the scrolling grid rows is static (it only depends on the
// viewport size), so the scene is rendered once to offscreen layers and blitted each
// frame. Only the ~12 horizontal rows + the dimming veil are drawn per frame. This keeps
// it light enough for low-power boards, matching how the starfield/nebula backgrounds
// cache-and-blit rather than redrawing vector art every frame.

(function () {
  const canvas = document.getElementById('starfield');
  const ctx    = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, hy = 0, cx = 0;

  // Cached static layers, rebuilt only when the viewport changes:
  //   base  - everything below the rows (sky, stars, sun, ground, grid columns)
  //   ghost - the faint sun continuation that sits ON TOP of the rows
  let base = null, baseCtx = null, ghost = null, ghostCtx = null;
  let cacheW = -1, cacheH = -1, cacheDpr = -1;

  // Sky stars, seeded once as fractional positions so they survive resizes.
  const STARS = [];
  for (let i = 0; i < 90; i++) {
    STARS.push({ fx: Math.random(), fy: Math.random() * 0.55, r: Math.random() < 0.85 ? 0.7 : 1.3, a: 0.25 + Math.random() * 0.6 });
  }

  // Sun gradient (context-bound, so each layer builds its own copy).
  function sunGradient(c, sunCy, sunR) {
    const sg = c.createLinearGradient(0, sunCy - sunR, 0, sunCy + sunR);
    sg.addColorStop(0,    '#ffe24a');
    sg.addColorStop(0.30, '#ffc23f');
    sg.addColorStop(0.52, '#ff8355');
    sg.addColorStop(0.74, '#ff4a85');
    sg.addColorStop(1,    '#ff2aa6');
    return sg;
  }

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    w = window.innerWidth; h = window.innerHeight;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw; canvas.height = bh;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
  }

  // Render the static scene into the offscreen layers. Called once per resize.
  function buildCache() {
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (!base)  { base  = document.createElement('canvas'); baseCtx  = base.getContext('2d'); }
    if (!ghost) { ghost = document.createElement('canvas'); ghostCtx = ghost.getContext('2d'); }
    base.width = bw;  base.height = bh;    // (assigning width also resets the context state)
    ghost.width = bw; ghost.height = bh;

    hy = Math.round(h * 0.60);
    cx = w / 2;
    const sunR  = Math.min(h * 0.24, w * 0.18);
    const sunCy = hy - sunR * 0.34;        // ~lower third sinks below the horizon

    // ── base layer ──
    const b = baseCtx;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sky
    const sky = b.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0,    '#05061c');
    sky.addColorStop(0.65, '#160c34');
    sky.addColorStop(1,    '#2c1552');
    b.fillStyle = sky; b.fillRect(0, 0, w, hy);

    // Stars (sky only)
    for (const s of STARS) {
      const sxp = s.fx * w, syp = s.fy * h;
      if (syp > hy - 6) continue;
      b.fillStyle = `rgba(255,255,255,${s.a})`;
      b.fillRect(sxp, syp, s.r, s.r);
    }

    // Sun: halo, clean disc, then slit bars sized to the circle's chord (no rim seam).
    const halo = b.createRadialGradient(cx, sunCy, sunR * 0.72, cx, sunCy, sunR * 2.1);
    halo.addColorStop(0,    'rgba(255, 140, 100, 0.22)');
    halo.addColorStop(0.35, 'rgba(255, 120, 110, 0.10)');
    halo.addColorStop(0.65, 'rgba(255, 110, 120, 0.035)');
    halo.addColorStop(1,    'rgba(255, 110, 120, 0)');
    b.fillStyle = halo;
    b.beginPath(); b.arc(cx, sunCy, sunR * 2.1, 0, Math.PI * 2); b.fill();

    b.beginPath(); b.arc(cx, sunCy, sunR, 0, Math.PI * 2);
    b.fillStyle = sunGradient(b, sunCy, sunR); b.fill();
    // Slit cuts (sky-coloured) and solid bands both thicken toward the bottom.
    for (let by = sunCy - sunR * 0.05, band = 6, cut = 3; by < sunCy + sunR; ) {
      const dy = by - sunCy;
      const half = Math.sqrt(Math.max(0, sunR * sunR - dy * dy));
      b.fillStyle = sky;
      b.fillRect(cx - half, by, half * 2, cut);
      by += cut + band;
      band += 3.6;
      cut  += 2;
    }

    // Ground (covers the sun's lower third)
    const gnd = b.createLinearGradient(0, hy, 0, h);
    gnd.addColorStop(0, '#1a0630');
    gnd.addColorStop(1, '#06010f');
    b.fillStyle = gnd; b.fillRect(0, hy, w, h - hy);

    // Grid columns: converge toward a vanishing point lifted above the horizon, so they
    // stay spread across the width at the horizon instead of collapsing to one dot.
    b.lineWidth = 1.3;
    const cols = 16, groundH = h - hy;
    const vpY = hy - groundH * 0.4, tTop = groundH / (h - vpY);
    for (let i = -cols; i <= cols; i++) {
      const xb = cx + (i / cols) * w * 1.7;
      const xTop = xb + (cx - xb) * tTop;
      const vg = b.createLinearGradient(xb, h, xTop, hy);
      vg.addColorStop(0, 'rgba(255, 55, 160, 0.6)');
      vg.addColorStop(1, 'rgba(255, 55, 160, 0.28)');
      b.strokeStyle = vg;
      b.beginPath(); b.moveTo(xb, h); b.lineTo(xTop, hy); b.stroke();
    }

    // ── ghost layer (faint sun continuation, drawn over the rows at runtime) ──
    const g = ghostCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 0.15;
    g.beginPath(); g.rect(0, hy, w, (sunCy + sunR) - hy); g.clip();   // below horizon only
    g.beginPath(); g.arc(cx, sunCy, sunR, 0, Math.PI * 2); g.clip();  // and within the disc
    g.fillStyle = sunGradient(g, sunCy, sunR);
    for (let by = sunCy - sunR * 0.05, band = 6, cut = 3; by < sunCy + sunR; ) {
      g.fillRect(cx - sunR, by + cut, sunR * 2, band);   // solid bands only; gaps stay bare grid
      by += cut + band;
      band += 3.6;
      cut  += 2;
    }

    cacheW = w; cacheH = h; cacheDpr = dpr;
  }

  function draw(ts) {
    if (window._bgMode !== 'outrun') { requestAnimationFrame(draw); return; }
    size();
    if (w !== cacheW || h !== cacheH || dpr !== cacheDpr) buildCache();

    // Static base (device pixels, blitted 1:1).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);

    // The only animated part: horizontal grid rows receding + scrolling toward the viewer.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = 'rgba(255, 60, 165, 0.6)';
    const rows = 12;
    const phase = (ts * 0.00024) % 1;
    for (let i = 0; i < rows; i++) {
      const p = (i + phase) / rows;               // 0 horizon .. 1 nearest
      const yy = hy + (h - hy) * p * p;
      ctx.globalAlpha = Math.min(1, p * 3.2);     // fade rows in away from the horizon
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Faint sun continuation over the rows, then the dimming veil over everything.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ghost, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(4, 2, 12, 0.42)';       // dimming veil (DIM knob)
    ctx.fillRect(0, 0, w, h);

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
})();
