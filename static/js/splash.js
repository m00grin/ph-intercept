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
  const LINE_END   = [380,  750];
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
  function resize() {
    const nw = window.innerWidth, nh = window.innerHeight;
    if (nw === W && nh === H) return;
    W = el.width = nw; H = el.height = nh;
  }
  window.addEventListener('resize', resize);
  resize();

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

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

    // ── Layout - center the whole block vertically ────────────────
    const phSize   = Math.min(W * 0.20, H * 0.22, 180);
    const tagSize  = Math.max(12, Math.min(W * 0.015, 16));
    const lineGap  = phSize * 0.58;
    const tagGap   = 28;

    // phY is textBaseline='middle' → phSize/2 above it, rest below
    const lineY    = H / 2;
    const phY      = lineY - lineGap;
    const tagY     = lineY + tagGap;

    const phX      = W / 2 + 0.06 * phSize / 2;

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

    // ── Laser blast line (fires left → right) ────────────────────
    const lineT   = prog(now, LINE_END[0], LINE_END[1]);
    const lineAlp = ease(prog(now, LINE_END[0], LINE_END[0] + 55));
    const tip     = lineT * W;

    if (lineT > 0) {
      const TRAIL = W * 0.30;
      const tail  = Math.max(0, tip - TRAIL);

      ctx.save();
      ctx.globalAlpha = master * lineAlp;
      ctx.lineCap = 'butt';

      // Settled beam - dim persistent trace, always covers full 0..tip so there's no gap at the trail junction
      ctx.strokeStyle = 'rgba(55, 125, 255, 0.13)'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(tip, lineY); ctx.stroke();
      ctx.strokeStyle = 'rgba(100, 185, 255, 0.28)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(tip, lineY); ctx.stroke();
      ctx.strokeStyle = 'rgba(185, 220, 255, 0.62)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, lineY); ctx.lineTo(tip, lineY); ctx.stroke();

      // Hot trail - bright gradient from tail → tip, layered over settled
      const g0 = ctx.createLinearGradient(tail, 0, tip, 0);
      g0.addColorStop(0, 'rgba(50, 120, 255, 0)');
      g0.addColorStop(1, 'rgba(50, 120, 255, 0.22)');
      ctx.strokeStyle = g0; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(tail, lineY); ctx.lineTo(tip, lineY); ctx.stroke();

      const g1 = ctx.createLinearGradient(tail, 0, tip, 0);
      g1.addColorStop(0, 'rgba(100, 190, 255, 0)');
      g1.addColorStop(0.5, 'rgba(120, 200, 255, 0.42)');
      g1.addColorStop(1, 'rgba(160, 220, 255, 0.75)');
      ctx.strokeStyle = g1; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tail, lineY); ctx.lineTo(tip, lineY); ctx.stroke();

      ctx.shadowColor = 'rgba(200, 235, 255, 0.90)';
      ctx.shadowBlur  = 6;
      const g2 = ctx.createLinearGradient(tail, 0, tip, 0);
      g2.addColorStop(0, 'rgba(160, 210, 255, 0)');
      g2.addColorStop(0.4, 'rgba(210, 235, 255, 0.80)');
      g2.addColorStop(1, 'rgba(255, 255, 255, 1)');
      ctx.strokeStyle = g2; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(tail, lineY); ctx.lineTo(tip, lineY); ctx.stroke();
      ctx.shadowBlur = 0;

      // Tip bloom - tight and very bright while travelling
      if (lineT < 1) {
        const bg = ctx.createRadialGradient(tip, lineY, 0, tip, lineY, 18);
        bg.addColorStop(0,   'rgba(255, 255, 255, 1.0)');
        bg.addColorStop(0.15,'rgba(220, 245, 255, 0.90)');
        bg.addColorStop(0.45,'rgba(110, 195, 255, 0.55)');
        bg.addColorStop(1,   'rgba(50, 140, 255, 0)');
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(tip, lineY, 18, 0, Math.PI * 2); ctx.fill();
      }

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
      ctx.fillText('INTERCEPT  PROGRAM', W / 2 + 0.38 * tagSize / 2, tagY + tagDrift);
      ctx.restore();
    }

    ctx.restore();
    requestAnimationFrame(draw);
  }

  document.fonts.ready.then(() => requestAnimationFrame(draw));
})();
