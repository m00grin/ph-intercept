// ── ph-intercept splash screen ────────────────────────────────────────
// Plays once on load, then calls enterPiholeMode() and self-destructs.
// Skipped (cooldown) if the user navigated back within COOLDOWN_MS.

(function () {
  const COOLDOWN_MS = 45000;

  // ── Cooldown check ────────────────────────────────────────────────
  // Deferred to 'load' so game.js is already parsed when we call enterPiholeMode.
  const lastShown = parseInt(sessionStorage.getItem('ph_splash_t') || '0');
  if (Date.now() - lastShown < COOLDOWN_MS) {
    window.addEventListener('load', () => {
      if (typeof window.enterPiholeMode === 'function') window.enterPiholeMode();
    });
    return;
  }
  sessionStorage.setItem('ph_splash_t', String(Date.now()));

  // ── Phase windows [start, end] in ms ─────────────────────────────
  const PH_IN      = [0,    450];
  const LINE_END   = [380, 1150];
  const XHAIR_IN   = [1150, 1400];
  const TAG_IN     = [1200, 1550];
  const FADE_OUT   = [2100, 2950];
  const GAME_START = 2250;

  // ── Helpers ───────────────────────────────────────────────────────
  function clamp(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function prog(now, s, e) { return clamp((now - s) / (e - s)); }
  function ease(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }
  function easeOut(t) { return 1 - (1-t)*(1-t); }
  function lerp(a, b, t) { return a + (b-a)*t; }

  // ── Canvas setup ──────────────────────────────────────────────────
  const el = document.createElement('canvas');
  el.id = 'splash-canvas';
  el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:200;pointer-events:none;';
  document.body.appendChild(el);
  const ctx = el.getContext('2d');

  let W = 0, H = 0;
  function resize() { W = el.width = window.innerWidth; H = el.height = window.innerHeight; }
  window.addEventListener('resize', resize);
  resize();

  let startT = null, gameFired = false;

  function draw(ts) {
    if (!startT) startT = ts;
    const now = ts - startT;

    resize();
    ctx.clearRect(0, 0, W, H);

    const fadeT  = ease(prog(now, FADE_OUT[0], FADE_OUT[1]));
    const master = 1 - fadeT;

    if (fadeT >= 1) { el.remove(); return; }

    if (!gameFired && now >= GAME_START) {
      gameFired = true;
      if (typeof window.enterPiholeMode === 'function') window.enterPiholeMode();
    }

    ctx.save();
    ctx.globalAlpha = master;

    // Dark background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // ── Layout — center the whole block vertically ────────────────
    const phSize   = Math.min(W * 0.20, H * 0.22, 180);
    const tagSize  = Math.max(11, Math.min(W * 0.015, 16));
    const lineGap  = phSize * 0.58;
    const tagGap   = 28;

    // phY is textBaseline='middle' → phSize/2 above it, rest below
    const lineY    = H / 2;
    const phY      = lineY - lineGap;
    const tagY     = lineY + tagGap;

    const phX      = W / 2;

    // ── "PH" ─────────────────────────────────────────────────────
    const phT     = ease(prog(now, PH_IN[0], PH_IN[1]));
    const phDrift = (1 - phT) * 18;

    ctx.save();
    ctx.globalAlpha   = master * phT;
    ctx.font          = `900 ${phSize}px 'Orbitron', monospace`;
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';
    ctx.letterSpacing = '0.06em';

    // Outer glow
    ctx.shadowColor = 'rgba(90, 160, 255, 0.55)';
    ctx.shadowBlur  = 52;
    ctx.fillStyle   = 'rgba(190, 220, 255, 0.12)';
    ctx.fillText('PH', phX, phY + phDrift);

    // Inner glow
    ctx.shadowBlur  = 22;
    ctx.fillStyle   = 'rgba(210, 230, 255, 0.5)';
    ctx.fillText('PH', phX, phY + phDrift);

    // Stroke pass for weight
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = 'rgba(200, 225, 255, 0.35)';
    ctx.lineWidth   = phSize * 0.04;
    ctx.lineJoin    = 'round';
    ctx.strokeText('PH', phX, phY + phDrift);

    // Crisp fill
    ctx.fillStyle = 'rgba(228, 238, 255, 0.95)';
    ctx.fillText('PH', phX, phY + phDrift);
    ctx.restore();

    // ── Converging lines ─────────────────────────────────────────
    const lineT   = easeOut(prog(now, LINE_END[0], LINE_END[1]));
    const lineAlp = ease(prog(now, LINE_END[0], LINE_END[0] + 200));

    ctx.save();
    ctx.globalAlpha = master * lineAlp;
    ctx.strokeStyle = 'rgba(80, 160, 255, 0.65)';
    ctx.lineWidth   = 0.75;

    const cx       = W / 2;
    const circR    = Math.min(H * 0.013, 11);  // reticle circle radius
    const leftTip  = lerp(0, cx, lineT);
    const rightTip = lerp(W, cx, lineT);

    // Draw lines — leave a gap for the circle once converged
    const gap = lineT >= 1 ? circR + 3 : 0;
    if (leftTip  > gap)       { ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(leftTip - gap, lineY); ctx.stroke(); }
    if (rightTip < W - gap)   { ctx.beginPath(); ctx.moveTo(W, lineY); ctx.lineTo(rightTip + gap, lineY); ctx.stroke(); }

    // Travelling tip glow
    if (lineT > 0 && lineT < 1) {
      [leftTip, rightTip].forEach(tx => {
        const tipAlpha = 0.7 * (1 - Math.abs(lineT - 0.5) * 2);
        const g = ctx.createRadialGradient(tx, lineY, 0, tx, lineY, 14);
        g.addColorStop(0, `rgba(160, 210, 255, ${tipAlpha})`);
        g.addColorStop(1, 'rgba(80, 160, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(tx, lineY, 14, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.restore();

    // ── Reticle (circle + 4 arms extending outward) ───────────────
    const xhairT = ease(prog(now, XHAIR_IN[0], XHAIR_IN[1]));
    if (xhairT > 0) {
      ctx.save();
      ctx.globalAlpha = master * xhairT;
      ctx.shadowColor = 'rgba(100, 200, 255, 0.85)';
      ctx.shadowBlur  = 10;
      ctx.strokeStyle = 'rgba(140, 215, 255, 0.95)';
      ctx.lineWidth   = 1.5;

      // Circle
      ctx.beginPath();
      ctx.arc(cx, lineY, circR, 0, Math.PI * 2);
      ctx.stroke();

      // Four arms extend outward from circle edge as xhairT goes 0→1
      const armLen  = Math.min(H * 0.065, 56);
      const armTip  = circR + 4 + armLen * xhairT;

      // Vertical arms
      ctx.beginPath(); ctx.moveTo(cx, lineY - circR - 4); ctx.lineTo(cx, lineY - armTip); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, lineY + circR + 4); ctx.lineTo(cx, lineY + armTip); ctx.stroke();

      // Horizontal stubs (short — the main line carries the horizontal weight)
      const hArm = Math.min(armLen * 0.35, 18) * xhairT;
      ctx.beginPath(); ctx.moveTo(cx - circR - 4, lineY); ctx.lineTo(cx - circR - 4 - hArm, lineY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + circR + 4, lineY); ctx.lineTo(cx + circR + 4 + hArm, lineY); ctx.stroke();

      // Center dot
      ctx.shadowBlur = 5;
      ctx.fillStyle  = 'rgba(210, 240, 255, 1)';
      ctx.beginPath(); ctx.arc(cx, lineY, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ── "INTERCEPT PROGRAM" ──────────────────────────────────────
    const tagT     = ease(prog(now, TAG_IN[0], TAG_IN[1]));
    const tagDrift = (1 - tagT) * 6;
    if (tagT > 0) {
      ctx.save();
      ctx.globalAlpha   = master * tagT * 0.8;
      ctx.font          = `400 ${tagSize}px 'IBM Plex Mono', monospace`;
      ctx.textAlign     = 'center';
      ctx.textBaseline  = 'top';
      ctx.letterSpacing = '0.38em';
      ctx.fillStyle     = 'rgba(160, 195, 235, 1)';
      ctx.fillText('INTERCEPT  PROGRAM', W / 2, tagY + tagDrift);
      ctx.restore();
    }

    ctx.restore();
    requestAnimationFrame(draw);
  }

  document.fonts.ready.then(() => requestAnimationFrame(draw));
})();
