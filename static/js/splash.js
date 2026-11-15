(function () {
  const COOLDOWN_MS = 45000;
  let gameFired = false;
  function startGame() {
    if (gameFired) return;
    gameFired = true;
    if (typeof window.enterPiholeMode === 'function') window.enterPiholeMode();
    else window.addEventListener('load', () => {
      if (typeof window.enterPiholeMode === 'function') window.enterPiholeMode();
    }, { once: true });
  }

  let lastShown = 0;
  try { lastShown = parseInt(sessionStorage.getItem('ph_splash_t') || '0') || 0; } catch {}
  if (Date.now() - lastShown < COOLDOWN_MS) {
    window.addEventListener('load', startGame, { once: true });
    return;
  }
  try { sessionStorage.setItem('ph_splash_t', String(Date.now())); } catch {}

  const RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const T = { ph: [0, 450], ship: [250, 1150], tag: [800, 1150], warp: [2050, 2350], reveal: [1600, 2400], out: [2280, 3000], game: 2400 };
  const PACE = 1.08;
  const TAG = 'INTERCEPT PROGRAM';
  const BMP = [
    '000000000010000000000', '000000000111000000000', '000000000111000000000', '000000000111000000000',
    '000000001111100000000', '000000111111111000000', '000011111111111110000', '000111001111100111000',
    '001110001111100011100', '011100001111100001110', '111000000111000000111', '111000000010000000111',
    '111000000000000000111', '011100000000000001110', '001111000000000111100', '001111000000000111100',
    '000110000000000011000',
  ];
  const SHIP = [];
  for (let y = 0; y < 21; y++) for (let x = 0; x < 17; x++) if (BMP[16 - x][y] === '1') SHIP.push([x, y]);

  const clamp = t => t < 0 ? 0 : t > 1 ? 1 : t;
  const prog = (now, r) => clamp((now - r[0]) / (r[1] - r[0]));
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  const el = document.createElement('canvas');
  el.id = 'splash-canvas';
  el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:200;pointer-events:none;';
  document.body.appendChild(el);
  const ctx = el.getContext('2d');

  let W = 0, H = 0, dpr = 1, L = null;
  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = el.width = Math.round(window.innerWidth * dpr);
    H = el.height = Math.round(window.innerHeight * dpr);
    const S = Math.min(W * 0.32, H * 0.42, 340 * dpr);
    const u = S / 64;
    const p = Math.max(1, Math.round(0.45 * u));
    const tagPx = Math.max(16 * Math.max(1, Math.round(dpr)), Math.round(S * 0.94 * 0.0164 / 8) * 8);
    const shipTop0 = Math.round(15.85 * u - 10.5 * p);
    const base0 = Math.round(54.5 * u);
    const tagY0 = base0 + Math.round(6.5 * u);
    const top = Math.round((H - (tagY0 + tagPx - shipTop0)) / 2) - shipTop0;
    const ox = Math.round((W - S) / 2);
    L = {
      u, p, tagPx,
      shipLeft: ox + Math.round(62 * u) - 17 * p,
      shipTop: top + shipTop0,
      nozzles: [top + shipTop0 + 4 * p, top + shipTop0 + 17 * p],
      x0: ox + 2 * u, fs: 38 * u, base: top + base0, tagY: top + tagY0,
    };
  }
  layout();
  window.addEventListener('resize', layout);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  function jet(x, y, ft, thrust) {
    const p = L.p;
    const n1 = Math.sin(ft * 2.3) + 0.6 * Math.sin(ft * 5.9 + 1.1) + 0.4 * Math.sin(ft * 11.3);
    const idle = thrust < 0.1;
    const len = (idle ? 9 : 16 + 110 * thrust) * p * 0.5 * (1 + 0.12 * n1);
    const hw = (idle ? 1.0 : 1.5 + 0.9 * thrust) * p * (1 + 0.06 * n1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(x, y, 0, x, y, hw * 5);
    halo.addColorStop(0, `rgba(120,180,255,${(idle ? 0.2 : 0.35 + 0.35 * thrust).toFixed(3)})`);
    halo.addColorStop(1, 'rgba(40,90,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, y, hw * 5, 0, Math.PI * 2); ctx.fill();
    const outer = ctx.createLinearGradient(x, 0, x - len, 0);
    outer.addColorStop(0, 'rgba(90,160,255,0.95)');
    outer.addColorStop(0.4, 'rgba(50,110,255,0.6)');
    outer.addColorStop(1, 'rgba(30,70,255,0)');
    ctx.fillStyle = outer;
    ctx.beginPath(); ctx.moveTo(x, y - hw); ctx.quadraticCurveTo(x - len * 0.35, y - hw * 0.9, x - len, y);
    ctx.quadraticCurveTo(x - len * 0.35, y + hw * 0.9, x, y + hw); ctx.closePath(); ctx.fill();
    const core = ctx.createLinearGradient(x, 0, x - len * 0.55, 0);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.6, 'rgba(200,235,255,0.85)');
    core.addColorStop(1, 'rgba(140,200,255,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.moveTo(x, y - hw * 0.45); ctx.quadraticCurveTo(x - len * 0.2, y - hw * 0.4, x - len * 0.55, y);
    ctx.quadraticCurveTo(x - len * 0.2, y + hw * 0.4, x, y + hw * 0.45); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  const sparks = [];
  function emit(x, y, thrust, shipVx, dt) {
    if (thrust < 0.1) return;
    const n = Math.round((0.4 + 1.6 * thrust) * dt / 16 + Math.random() * 0.5);
    for (let i = 0; i < n; i++) {
      const out = (0.35 + Math.random() * 0.5) * dpr * (0.35 + 1.4 * thrust);
      sparks.push({
        x: x - Math.random() * shipVx * dt, y: y + (Math.random() - 0.5) * 0.9 * L.p,
        vx: shipVx - out, vy: (Math.random() - 0.5) * 0.05 * dpr, age: 0,
        life: 250 + Math.random() * 350, w: (0.45 + Math.random() * 0.35) * L.p, hit: false,
      });
    }
  }
  function drawSparks(dt) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const drag = Math.exp(-dt / 260);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) { sparks.splice(i, 1); continue; }
      s.vx *= drag; s.vy *= drag;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const blur = s.hit ? 10 : 34;
      const dx = Math.max(-60 * L.p, Math.min(60 * L.p, -s.vx * blur));
      const hot = Math.max(0, 1 - t * 4);
      ctx.strokeStyle = `rgba(${Math.round(90 + 165 * hot)},${Math.round(160 + 90 * hot)},255,${((1 - t * t) * (0.55 + 0.4 * hot)).toFixed(3)})`;
      ctx.lineWidth = s.w * (1 + t * 0.6);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + dx, s.y - s.vy * blur); ctx.stroke();
    }
    ctx.restore();
  }

  const ribbons = [[], []];
  let chaos = null;
  const nz = (x, k, o) => Math.sin(x * 0.017 + k.a + o) * 0.6 + Math.sin(x * 0.043 + k.b + o) * 0.4;
  function lay(i, x, y, now, heat) { ribbons[i].push({ x, y, born: now, heat, vx: 0, vy: 0, spin: 0, life: 0, hit: null }); }
  function shockwave(cx, cy, r, now) {
    if (!chaos) chaos = [0, 1].map(() => ({ a: Math.random() * 6.283, b: Math.random() * 6.283, bias: 0.6 + Math.random() * 0.9 }));
    const reach = W * 0.9;
    ribbons.forEach((pts, ri) => {
      const k = chaos[ri];
      for (const q of pts) {
        if (q.hit !== null) continue;
        const dx = q.x - cx, dy = q.y - cy, d = Math.hypot(dx, dy) || 1;
        if (d > r) continue;
        const x = q.x / dpr, n1 = nz(x, k, 0), n2 = nz(x, k, 2.1), n3 = nz(x, k, 4.3);
        const f = (0.08 + 0.5 * Math.max(0, 1 - d / reach)) * dpr * (0.5 + 1.1 * Math.abs(n1)) * k.bias;
        q.vx = dx / d * f * 0.6 + n2 * f * 0.9;
        q.vy = ((q.y < cy ? -1 : 1) * 0.5 + n1 * 1.3) * f;
        q.spin = n3 * 0.004;
        q.life = 260 + 520 * (0.5 + 0.5 * n3);
        q.hit = now;
        if (Math.random() < 0.18) {
          sparks.push({
            x: q.x, y: q.y, vx: q.vx * (1.5 + Math.random() * 2),
            vy: q.vy * (1.5 + Math.random() * 2) + (Math.random() - 0.5) * 0.3 * dpr,
            age: 0, life: 300 + Math.random() * 500, w: (0.3 + Math.random() * 0.4) * L.p, hit: true,
          });
        }
      }
    });
    for (const s of sparks) {
      const dx = s.x - cx, dy = s.y - cy, d = Math.hypot(dx, dy) || 1;
      if (d <= r && !s.hit) {
        const f = 0.8 * dpr * Math.max(0.2, 1 - d / reach);
        s.vx += dx / d * f; s.vy += dy / d * f + (Math.random() - 0.5) * f; s.hit = true;
      }
    }
  }
  function drawRibbons(now, dt) {
    const drag = Math.exp(-dt / 240);
    for (const pts of ribbons) for (const q of pts) if (q.hit !== null) {
      const c = Math.cos(q.spin * dt), sn = Math.sin(q.spin * dt), vx = q.vx * c - q.vy * sn;
      q.vy = q.vx * sn + q.vy * c; q.vx = vx;
      q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= drag; q.vy *= drag;
    }
    const p = L.p, life = RM ? 5000 : 2100;
    const feather = RM ? 0.35 : clamp((now - 700) / 1300) * 0.4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    for (const pts of ribbons) {
      while (pts.length && now - pts[0].born > life) pts.shift();
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < pts.length; i++) {
          const a0 = pts[i - 1], a1 = pts[i];
          const age = (now - a1.born) / life;
          const blown = a1.hit === null ? 0 : Math.min(1, (now - a1.hit) / a1.life);
          const tip = feather > 0 ? ease(clamp(i / pts.length / feather)) : 1;
          const fade = (RM ? 1 - age * age : Math.pow(1 - age, 1.3)) * (1 - blown) * tip;
          const hot = Math.max(0, 1 - age * 3.5) * Math.max(0.35, a1.heat);
          ctx.beginPath();
          ctx.moveTo(a0.x, a0.y);
          ctx.lineTo(a1.x, a1.y);
          if (pass === 0) {
            ctx.strokeStyle = `rgba(50,110,255,${(fade * 0.22).toFixed(3)})`;
            ctx.lineWidth = p * (2.2 + age * 4 + blown * 6);
          } else {
            ctx.strokeStyle = `rgba(${Math.round(120 + 135 * hot)},${Math.round(185 + 70 * hot)},255,${(fade * (0.5 + 0.45 * hot)).toFixed(3)})`;
            ctx.lineWidth = Math.max(1, p * (0.7 + 0.5 * hot + age * 1.2 + blown * 2));
          }
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function ship(left, top, p, color) {
    ctx.fillStyle = color;
    for (const [x, y] of SHIP) ctx.fillRect(left + x * p, top + y * p, p, p);
  }

  function warp(cx, cy, wp) {
    const k = L.p / 3;
    const p1 = Math.min(1, wp / 0.45), p2 = Math.max(0, (wp - 0.40) / 0.60);
    const offX = p2 * (W + 300 * k);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    if (wp < 0.35) {
      const fp = 1 - wp / 0.35, fr = (18 + wp * 560) * k;
      const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, fr);
      fg.addColorStop(0, `rgba(255,255,255,${fp.toFixed(2)})`);
      fg.addColorStop(0.12, `rgba(210,228,255,${(fp * 0.85).toFixed(2)})`);
      fg.addColorStop(0.4, `rgba(195,208,240,${(fp * 0.35).toFixed(2)})`);
      fg.addColorStop(1, 'rgba(195,208,240,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, fr, 0, Math.PI * 2); ctx.fill();
    }
    if (wp < 0.55) {
      const rp = wp / 0.55;
      ctx.strokeStyle = `rgba(185,212,255,${((1 - rp) * 0.9).toFixed(2)})`;
      ctx.lineWidth = Math.max(0.5, (2.5 - rp * 2) * k);
      ctx.shadowColor = 'rgba(160,200,255,0.9)'; ctx.shadowBlur = 10 * k;
      ctx.beginPath(); ctx.arc(0, 0, (10 + rp * 260) * k, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (p1 > 0.25) {
      const tlen = (80 + p1 * 340) * k, top = p1 * 0.88;
      for (const [hw, a, c] of [[16, 0.42, '195,208,240'], [6, 0.68, '215,228,255'], [2, 1, '245,248,255']]) {
        const sg = ctx.createLinearGradient(offX, 0, offX - tlen, 0);
        sg.addColorStop(0, `rgba(${c},${(top * a).toFixed(2)})`); sg.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = sg; ctx.fillRect(offX - tlen, -hw * k, tlen, hw * 2 * k);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(offX, 0);
    ctx.scale(1 + p1 * 7.5, Math.max(0.07, 1 - p1 * 0.93));
    const wa = p2 > 0.3 ? Math.max(0, 1 - (p2 - 0.3) / 0.7) : 1;
    ship(-8.5 * L.p, -10.5 * L.p, L.p, `rgba(255,255,255,${wa.toFixed(2)})`);
    ctx.restore();
  }

  function letters(alpha, drift) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = `900 ${L.fs}px Orbitron, monospace`;
    ctx.textBaseline = 'alphabetic';
    const w = ctx.measureText('PH').width;
    ctx.translate(L.x0, Math.round(L.base + drift));
    ctx.scale(60 * L.u / w, 1);
    ctx.fillStyle = '#e4eeff';
    ctx.fillText('PH', 0, 0);
    ctx.restore();
  }

  function tagline(alpha) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = `${L.tagPx}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = `${Math.round(L.tagPx / 4)}px`;
    ctx.fillStyle = '#c8daf2';
    ctx.fillText(TAG, Math.round(W / 2), L.tagY);
    ctx.restore();
  }

  let startT = null, lastT = null, lastLeft = null, rmSeeded = false;
  function draw(ts) {
    if (startT === null) startT = ts;
    const now = (ts - startT) * PACE;
    const dt = (lastT === null ? 16 : Math.min(50, ts - lastT)) * PACE;
    lastT = ts;
    if (now >= T.game) startGame();
    const master = 1 - ease(prog(now, T.out));
    if (master <= 0) { el.remove(); return; }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1 - ease(prog(now, T.reveal));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const raw = RM ? 1 : prog(now, T.ship);
    const wp = RM ? 0 : prog(now, T.warp);
    const shake = wp > 0 && wp < 0.6 ? 5 * dpr * (1 - wp / 0.6) : 0;
    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.globalAlpha = master;

    const startLeft = -47 * L.p;
    const left = Math.round(startLeft + (L.shipLeft - startLeft) * easeOut(raw));
    const thrust = RM ? 0 : (1 - raw) * (1 - raw);
    const shipVx = lastLeft === null ? 0 : (left - lastLeft) / Math.max(1, dt);
    if (RM && !rmSeeded) {
      rmSeeded = true;
      L.nozzles.forEach((y, i) => {
        for (let x = -6 * dpr; x <= L.shipLeft; x += 8 * dpr) {
          const f = Math.max(0, x) / Math.max(1, L.shipLeft);
          ribbons[i].push({ x, y, born: now - (1 - f) * 250, heat: f * 0.6, vx: 0, vy: 0, spin: 0, life: 0, hit: null });
        }
      });
    }
    if (!RM && raw > 0 && wp === 0 && lastLeft !== null) {
      L.nozzles.forEach((y, i) => {
        emit(left, y, raw < 1 ? Math.max(0.12, thrust) : 0.05, shipVx, dt);
        const pts = ribbons[i];
        if (!pts.length || left - pts[pts.length - 1].x >= 4 * dpr) lay(i, left, y, now, raw < 1 ? thrust : 0);
      });
    }
    lastLeft = left;
    if (wp > 0 && wp < 0.55) shockwave(left + 8.5 * L.p, L.shipTop + 10.5 * L.p, wp / 0.55 * W * 1.1, now);
    drawRibbons(now, dt);
    drawSparks(dt);
    if (raw > 0 && wp === 0) {
      for (const y of L.nozzles) jet(left + L.p, y, now * 0.02 + y, raw < 1 ? Math.max(0.12, thrust) : 0.05);
      ship(left, L.shipTop, L.p, '#ffffff');
    } else if (wp > 0 && wp < 1) {
      warp(left + 8.5 * L.p, L.shipTop + 10.5 * L.p, wp);
    }
    const phT = RM ? 1 : ease(prog(now, T.ph));
    letters(phT, RM ? 0 : (1 - phT) * 18 * dpr);
    tagline(ease(prog(now, T.tag)));
    ctx.restore();
    requestAnimationFrame(frame);
  }

  function frame(ts) {
    try { draw(ts); } catch { el.remove(); startGame(); }
  }

  const fonts = document.fonts
    ? Promise.all([document.fonts.load('900 40px Orbitron'), document.fonts.load('16px "Press Start 2P"')])
    : Promise.resolve();
  Promise.race([fonts, new Promise(r => setTimeout(r, 800))]).catch(() => {}).then(() => requestAnimationFrame(frame));
})();
