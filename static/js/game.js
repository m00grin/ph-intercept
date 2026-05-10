// ── Pi-hole DNS game mode ─────────────────────────────────────────────
(function() {
  const canvas = document.getElementById('pihole-canvas');
  const ctx = canvas.getContext('2d');
  const phLinkEl = document.getElementById('pihole-link');
  const settingsBtnEl = document.getElementById('settings-btn');
  let W = 0, H = 0;

  let safeBottom = 0, hudSH = 108;
  let active = false, evtSource = null, sseRetryDelay = 3000, _rafId = null;
  let lastT = 0, lastSpawn = 0, shipX = 0, shipY = 0, lastGun = 0;
  let lastEnemyAt = 0;
  let activeEnemies = 0, idleBlend = 0;
  let _hudGlowGrad = null, _hudGlowGradSY = -1;
  let _vigGrad = null, _vigGradW = -1, _vigGradH = -1;
  const entities = [], lasers = [], explosions = [], queue = [];
  let drone = { state: 'docked', x: 0, y: 0, lastFire: 0, side: 0, angle: 0, targetX: null, targetY: null, deployedAt: 0, recallAt: 0 };
  const droneMissiles = [];
  let drone2 = { state: 'docked', x: 0, y: 0, lastFire: 0, side: 0, angle: 0, targetX: null, targetY: null, deployedAt: 0, recallAt: 0 };
  const drone2Missiles = [];
  let hudGravity = null;
  let hudStats = { blocked: null, queries: null, percent: null };
  let hudStatsPollTimer = null, _onVisible = null, _onFocus = null, _exitTimer = null;
  let gravityState = 'idle'; // 'idle' | 'updating' | 'done'
  let gravityDoneAt = 0;
  let gravityPollTimer = null;
  let arrowHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let arrowHovered = false;

  const domainFragments = [];
  const debris = [];
  const chainRings = [];
  let blockingEnabled = null; // null=unknown, true, false
  let _firstEnterFetch = false;
  let blockingOffAt = 0;
  let blockingDuration = 0;   // ms; 0 = indefinite
  let shipPowerState = 'up';  // 'up' | 'down' | 'startup'
  let startupAt = 0;
  const STARTUP_DUR = 1800;
  let powerdownAt = 0;
  const POWERDOWN_DUR = 800;
  let carrierState = 'none';  // 'none'|'arriving'|'present'|'leaving'
  let carrierY = 0, carrierRestY = 0, carrierArrivingAt = 0, carrierLeavingAt = 0, launchAt = 0;
  let crewMembers = [], crewNextSpawn = 0, lastFuelAt = 0;
  const CARRIER_ARRIVE_DUR = 2200;
  const CARRIER_LEAVE_DUR = 1800;
  const LAUNCH_BOOST_DUR = 550;
  let gunCheckState = 0;
  const GUN_CHECK_AT = [0.68, 0.76];
  const GUN_CHECK_DUR = 130;
  let gunCheckFiredAt = [0, 0];
  let shieldMenuOpen = false;
  let shieldHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let shieldMenuItems = [];
  let shieldMenuPopupBox = null;
  let shieldHovered = false;
  let settingsMenuOpen = false;
  let settingsMenuItems = [];
  let settingsMenuPopupBox = null;
  let mouseX = -1, mouseY = -1;

  // Display toggles (persisted to localStorage)
  let showFriendlies = true;
  let showDomain     = true;
  let showClient     = false;
  (function _loadDisplaySettings() {
    try {
      const s = JSON.parse(localStorage.getItem('ph_display'));
      if (s) {
        if (s.friendlies != null) showFriendlies = !!s.friendlies;
        if (s.domain     != null) showDomain     = !!s.domain;
        if (s.client     != null) showClient      = !!s.client;
      }
    } catch {}
  })();
  function _saveDisplaySettings() {
    try { localStorage.setItem('ph_display', JSON.stringify({ friendlies: showFriendlies, domain: showDomain, client: showClient })); } catch {}
  }
  let currentShip = 'protector';  // 'protector' | 'falcon' | 'swordfish' | 'enterprise'
  let warpState = 'none';         // 'none' | 'out' | 'in'
  let warpAt = 0;
  let warpNextShip = null;
  const WARP_OUT_DUR = 300;
  const WARP_IN_DUR = 500;
  let shakeAt = 0, shakeDur = 0, shakeAmp = 0;
  let shipMenuOpen = false;
  let shipMenuItems = [];
  let shipMenuPopupBox = null;
  let shipMenuHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let shipMenuHovered = false;
  let shipBodyHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let shipQuote = null;    // { text: string, shownAt: number } | null
  let shipQuoteCooldown = 0; // performance.now() timestamp; no new quotes until after this
  let shipQuoteDeck = [];       // shuffled queue for the current ship
  let shipQuoteDeckFor = null;  // which ship the deck was built for
  let shipQuoteLastShown = null;
  const SHIP_QUOTES = {
    protector:  ["Never give up, never surrender!", "By Grabthar's hammer, by the suns of Warvan, you shall be avenged.", "EXPLAIN.", "I'm just the guy who dies in episode 3!", "Can you form some sort of rudimentary lathe?", "Are you enjoying your Kep-mok blood ticks, Dr. Lazarus?", "It's all real."],
    falcon:     ["Never tell me the odds!", "I'd just as soon kiss a Wookiee.", "BUT SIR!!", "I am a Jedi, like my father before me.", "I can fly anything.", "It's not my fault!", "Shut him up or shut him down!"],
    swordfish:  ["Bang.", "Whatever happens, happens.", "I'm not going there to die. I'm going to find out if I'm really alive.", "I'm not a bounty hunter for the money.", "I love a man who can cook.", "Ed and Ein are hungry!"],
    enterprise: ["THERE ARE FOUR LIGHTS!", "Good tea, nice house.", "Shaka, when the walls fell.", "Will you.. Please... Sit down?", "Live long and prosper.", "The needs of the many outweigh the needs of the few, or the one.", "He's dead, Jim.", "Risk is our business.", "Fascinating."],
  };
  const DISABLE_OPTIONS = [
    { label: '10 SEC', timer: 10,  ms: 10000 },
    { label: '30 SEC', timer: 30,  ms: 30000 },
    { label: '5 MIN',  timer: 300, ms: 300000 },
    { label: 'DISABLE',   timer: null, ms: 0 },
  ];
  // Draws one nacelle engine exhaust flame centered at (x, base).
  function drawEngineFlare(x, base, ft, wScale = 1, lScale = wScale, taper = 0.6, shape = 'arch', wobble = 1) {
    const l = (21 + 2 * Math.sin(ft * 1.9) + 1.5 * Math.sin(ft * 3.1 + 0.7)) * lScale;
    const fw = (3.5 + 0.4 * wobble * Math.sin(ft * 2.7 + 0.3)) * wScale;
    const og = ctx.createRadialGradient(x, base + l * 0.3, 0, x, base + l * 0.3, l * 0.7);
    og.addColorStop(0, 'rgba(80,140,255,0.22)');
    og.addColorStop(1, 'rgba(40,80,255,0)');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.ellipse(x, base + l * 0.3, l * 0.35, l * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    const fg = ctx.createLinearGradient(x, base, x, base + l);
    fg.addColorStop(0, 'rgba(150,200,255,0)');
    fg.addColorStop(0.12, 'rgba(150,200,255,0.70)');
    fg.addColorStop(0.4, 'rgba(70,120,255,0.55)');
    fg.addColorStop(1, 'rgba(40,80,255,0)');
    ctx.fillStyle = fg;
    ctx.shadowColor = 'rgba(80,140,255,0.3)'; ctx.shadowBlur = 8;
    ctx.beginPath();
    if (shape === 'column') {
      // Straight sides, rounded tip
      ctx.moveTo(x - fw, base);
      ctx.lineTo(x - fw * taper, base + l * 0.72);
      ctx.quadraticCurveTo(x, base + l, x + fw * taper, base + l * 0.72);
      ctx.lineTo(x + fw, base);
    } else {
      ctx.moveTo(x - fw, base);
      ctx.quadraticCurveTo(x - fw * taper, base + l * 0.65, x, base + l);
      ctx.quadraticCurveTo(x + fw * taper, base + l * 0.65, x + fw, base);
    }
    ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    const ig = ctx.createLinearGradient(x, base, x, base + l * 0.5);
    ig.addColorStop(0, 'rgba(210,235,255,0)');
    ig.addColorStop(0.15, 'rgba(210,235,255,0.90)');
    ig.addColorStop(1, 'rgba(160,205,255,0)');
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.moveTo(x - fw * 0.3, base);
    ctx.quadraticCurveTo(x, base + l * 0.5, x, base + l * 0.5);
    ctx.quadraticCurveTo(x, base + l * 0.5, x + fw * 0.3, base);
    ctx.closePath(); ctx.fill();
  }

  function createExplosionFromBmp(bmp, x, y, killedBy, color) {
    const ps = [];
    const cols = bmpW(bmp), rows = bmpH(bmp);
    const pxSize = PX;
    const ox = x - (cols * pxSize) / 2;
    const oy = y - (rows * pxSize) / 2;
    const col = color.split('(')[1].split(')')[0].split(',').slice(0, 3).join(',');
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (bmp[r][c]) {
          const px = ox + c * pxSize + (pxSize - 1) / 2;
          const py = oy + r * pxSize + (pxSize - 1) / 2;
          const dx = px - x;
          const dy = py - y;
          const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.5;
          let speed = 0.05 + Math.random() * 0.05;
          if (killedBy === 'drone') speed *= 0.5;
          else if (killedBy === 1) speed *= 0.8;
          else if (killedBy === 2) speed *= 1.2;
          else if (killedBy === 3) speed *= 1.5;
          ps.push({ x: px, y: py, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: Math.random() < 0.5 ? 1.5 : 1.0, col });
        }
      }
    }
    explosions.push({ ps, born: performance.now(), dur: 1200 });
    // Sparse drifting debris - a few slow pixels that linger for several seconds
    const nd = 3 + Math.floor(Math.random() * 3);
    const dnow = performance.now();
    for (let di = 0; di < nd; di++) {
      const da = Math.random() * Math.PI * 2;
      const ds = 0.005 + Math.random() * 0.011;
      debris.push({ x: x + (Math.random()-0.5)*10, y: y + (Math.random()-0.5)*10,
                    vx: Math.cos(da)*ds, vy: Math.sin(da)*ds,
                    sz: Math.random() < 0.5 ? 1 : 2,
                    col, born: dnow, dur: 8000 + Math.random() * 5000 });
    }
    while (debris.length > 70) debris.shift();
  }

  function createDomainFragments(domain, ex, labelY, tier) {
    const dom = domain.length > 32 ? '…' + domain.slice(-30) : domain;
    const col = tier >= 3 ? '200,100,255' : tier === 2 ? '255,160,60' : '255,120,100';
    const charW = 7; // approximate IBM Plex Mono width at 11px
    const ox = ex - (dom.length * charW) / 2;
    const now = performance.now();
    for (let i = 0; i < dom.length; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.022 + Math.random() * 0.055;
      domainFragments.push({
        ch: dom[i], x: ox + (i + 0.5) * charW, y: labelY,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 0.018,
        rot: 0, vrot: (Math.random() - 0.5) * 0.007,
        born: now, dur: 750 + Math.random() * 450, col,
      });
    }
  }

  // ── Entity management ─────────────────────────────────────────────
  function spawnEntity(ev) {
    if (ev.status === 'allowed' && !showFriendlies) return;
    const blocked = ev.status === 'blocked';
    const isCache = ev.source === 'cache';
    const existing = entities.find(e => e.domain === ev.domain && e.type === ev.status && e.state !== 'shot');
    if (existing) {
      const prevTier = Math.min(existing.count, 3);
      existing.count++;
      const newTier = Math.min(existing.count, 3);
      if (blocked && newTier > prevTier) {
          const tierColor = newTier >= 3 ? '190,60,255' : '255,130,30';
          existing.mutateAt = performance.now();
          existing.mutateColor = tierColor;
          const ps = [];
          for (let i = 0; i < 14; i++) {
            const a = (Math.PI * 2 * i / 14) + (Math.random() - 0.5) * 0.3;
            const s = 0.05 + Math.random() * 0.12;
            ps.push({ x: existing.x, y: existing.y, vx: Math.cos(a)*s, vy: Math.sin(a)*s,
                      r: 1.5 + Math.random() * 2.5, col: tierColor });
          }
          explosions.push({ ps, born: performance.now(), dur: 600 });
        }
      return;
    }
    if (entities.length >= 50) return;

    const now = performance.now();
    let x, y, vx, vy, headStart = 0;
    if (blocked) {
      const spd = 0.055 + Math.random() * 0.03;
      x = W * (0.1 + Math.random() * 0.8);
      if (Math.random() < 0.65) {
        y = -50;
      } else {
        y = H * (0.05 + Math.random() * 0.14);
        headStart = Math.min((y + 50) / spd, 1800);
      }
      vx = (Math.random() - 0.5) * 0.018; vy = spd;
    } else {
      const spd = isCache ? (0.095 + Math.random() * 0.03) : (0.078 + Math.random() * 0.03);
      x = W * (0.05 + Math.random() * 0.9); y = -50;
      const goRight = Math.random() < 0.5;
      const tx = goRight ? W + 100 : -100;
      const ty = H * (0.35 + Math.random() * 0.5);
      const d = Math.hypot(tx - x, ty - y);
      vx = (tx - x) / d * spd; vy = (ty - y) / d * spd;
    }

    entities.push({
      type: ev.status,
      source: ev.source || 'upstream',
      design: blocked ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 3),
      x, y, vx, vy,
      wobble: Math.random() * Math.PI * 2,
      domain: ev.domain,
      client: ev.client || '',
      spawnTime: now - headStart,
      appearAt: now,
      state: 'alive',  // alive | targeted | seeker-incoming | shot
      targetedAt: 0,
      shotAt: 0,
      labelAlpha: 1,
      count: 1,
      mutateAt: 0,
      mutateColor: '',
      warpPushed: false,
    });
  }

  function fireAt(ent) {
    ent.shotAt = performance.now();
    ent.mutateAt = 0;
    const now = performance.now();
    const tier = Math.min(ent.count, 3);
    let seekerFire = false;
    if (tier >= 3) {
      if (Math.random() < 0.5) {
        // Beam style - triple spread from left gun, nose, right gun
        ent.state = 'shot';
        const sp = 10;
        lasers.push({ side: 0, tier, x1: ent.x - sp, y1: ent.y, born: now });
        lasers.push({ side: 2, tier, x1: ent.x,      y1: ent.y, born: now });
        lasers.push({ side: 1, tier, x1: ent.x + sp, y1: ent.y, born: now });
      } else {
        // Seeker style - 5 rapid bolts from nose gun, each arcing a different path to target
        // Delay explosion until the last bolt arrives (born offset 4*30 + dur 210 = 330ms)
        seekerFire = true;
        ent.state = 'seeker-incoming';
        ent.detonateAt = now + 330;
        const gtp0 = shipGunTipPos(currentShip, Math.round(shipX), Math.round(shipY));
        const sx0 = gtp0.nx, sy0 = gtp0.ny;
        const tx = ent.x, ty = ent.y;
        const ddx = tx - sx0, ddy = ty - sy0, ddist = Math.hypot(ddx, ddy) || 1;
        const px = -ddy / ddist, py = ddx / ddist; // unit perpendicular to path
        const midX = (sx0 + tx) / 2, midY = (sy0 + ty) / 2;
        const offsets = [-52, 38, -24, 58, -10];
        for (let bi = 0; bi < offsets.length; bi++) {
          const off = offsets[bi] + (Math.random() - 0.5) * 18;
          lasers.push({ style: 'seeker', tier, target: ent,
                        x0: sx0, y0: sy0, x1: tx, y1: ty,
                        cpx: midX + px * off, cpy: midY + py * off,
                        born: now + bi * 30, dur: 210 });
        }
      }
    } else if (tier === 2) {
      // Double: both wing guns converge on target
      ent.state = 'shot';
      lasers.push({ side: 0, tier, x1: ent.x, y1: ent.y, born: now });
      lasers.push({ side: 1, tier, x1: ent.x, y1: ent.y, born: now });
    } else {
      // Single: alternating gun
      ent.state = 'shot';
      const side = lastGun;
      lastGun = 1 - lastGun;
      lasers.push({ side, tier, x1: ent.x, y1: ent.y, born: now });
    }
    if (!seekerFire) {
      const ps = [];
      const n = 10 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i / n) + (Math.random() - 0.5) * 0.5;
        const s = 0.06 + Math.random() * 0.14;
        const palettes = ['255,60,30', '255,130,40', '255,200,70', '255,255,180'];
        ps.push({ x: ent.x, y: ent.y, vx: Math.cos(a)*s, vy: Math.sin(a)*s,
                  r: 1.5 + Math.random() * 2.5, col: palettes[Math.floor(Math.random() * 4)] });
      }
      explosions.push({ ps, born: performance.now(), dur: 680 });
    }
  }

  function initWarpOut(nextShip) {
    warpNextShip = nextShip;
    warpState = 'out';
    warpAt = performance.now();
    shipMenuOpen = false;
    settingsMenuOpen = false;
    if (settingsBtnEl) settingsBtnEl.classList.remove('menu-open');
    shipQuote = null; shipQuoteCooldown = 0; shipQuoteDeck = []; shipQuoteDeckFor = null; shipQuoteLastShown = null;
    lasers.length = 0;
    shakeAt = warpAt; shakeDur = 500; shakeAmp = 16;
    for (const e of entities) e.warpPushed = false;
  }

  // ── Game tick ─────────────────────────────────────────────────────
  function tick(t) {
    _rafId = null;
    if (!active) return;
    _rafId = requestAnimationFrame(tick);
    const dt = Math.min(t - lastT, 80);
    lastT = t;

    const spawnRate = queue.length > 10 ? 70 : 130;
    if (queue.length > 0 && t - lastSpawn > spawnRate) {
      spawnEntity(queue.shift());
      lastSpawn = t;
    }

    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      const age = t - e.spawnTime;
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      if (e.type === 'blocked') {
        e.x += Math.sin(e.wobble + age * 0.002) * 0.012 * dt;
        if (shipPowerState === 'up' && warpState === 'none') {
          if (e.state === 'alive' && age > 2200 && t - e.appearAt > 600) { e.state = 'targeted'; e.targetedAt = t; }
          if (e.state === 'targeted' && age > 3400 && t - e.appearAt > 600) fireAt(e);
        } else if (e.state === 'targeted') {
          e.state = 'alive'; // drop targeting lock when shields are down
        }
        if (e.state === 'seeker-incoming' && t >= e.detonateAt) {
          e.state = 'shot';
          e.killedBy = Math.min(e.count, 3);
        }
        if (e.state === 'shot') {
          const tier = Math.min(e.count, 3);
          const bmp = tier >= 3 ? E3 : tier === 2 ? E2 : (e.design === 0 ? E0 : E1);
          const color = tier >= 3
            ? `rgba(190,60,255,0.9)`
            : tier === 2
            ? `rgba(255,130,30,0.9)`
            : `rgba(255,50,50,0.9)`;
          createExplosionFromBmp(bmp, e.x, e.y, e.killedBy, color);
          if (showDomain) {
            const _fBase = e.y + bmpH(bmp) * PX / 2 + 13;
            createDomainFragments(e.domain, e.x, (showClient && e.client) ? _fBase + 14 : _fBase, tier);
          }
          entities.splice(i, 1);
          continue;
        }
        if (e.y > H + 80) { entities.splice(i, 1); continue; }
      } else {
        e.labelAlpha = Math.max(0, 1 - (age - 2400) / 1000);
        if (e.x < -130 || e.x > W + 130 || e.y > H + 80) {
          entities.splice(i, 1);
        }
      }
    }

    // Laser collision
    for (let i = lasers.length - 1; i >= 0; i--) {
      const l = lasers[i];
      if (t < l.born) continue;
      if (l.style === 'seeker') continue; // detonation handled by timer, not proximity to destination
      for (const e of entities) {
        if (e.state === 'alive' && Math.hypot(e.x - l.x1, e.y - l.y1) < 25) {
          e.state = 'shot';
          e.killedBy = l.tier;
          lasers.splice(i, 1);
          break;
        }
      }
    }
    // Ship movement - passive hover drift + idle wander; track targeted enemy
    activeEnemies = 0;
    for (const e of entities) {
      if (e.type === 'blocked' && e.state !== 'shot') activeEnemies++;
    }
    if (activeEnemies > 0) lastEnemyAt = t;
    idleBlend = shipPowerState === 'up' ? Math.min(1, Math.max(0, (t - lastEnemyAt - 15000) / 2000)) : 0;
    const passiveDrift = 5 * Math.sin(t * 0.00038) + 2 * Math.sin(t * 0.00067);
    const idleDrift = idleBlend * 26 * Math.sin(t * 0.00021);
    const targeted = entities.find(e => e.state === 'targeted');
    const _carrierCX = W * 0.40;
    const _activeBayX = _carrierCX + CARRIER_BAY_DX[CARRIER_SHIP_ORDER.indexOf(currentShip)];
    let goalX, goalXLerp;
    if (carrierState === 'arriving' || carrierState === 'present') {
      goalX = _activeBayX; goalXLerp = 0.002;
    } else if (carrierState === 'leaving' && t - launchAt < LAUNCH_BOOST_DUR) {
      goalX = _activeBayX; goalXLerp = 0.0015;
    } else {
      goalX = targeted ? W / 2 + Math.max(-110, Math.min(110, targeted.x - W / 2)) : W / 2 + passiveDrift + idleDrift;
      goalXLerp = 0.0038;
    }
    shipX += (goalX - shipX) * Math.min(1, goalXLerp * dt);

    // Ship Y retreat - rise when enemies descend, settle back during gaps
    const _carrierDockY = carrierRestY;
    let goalY, goalYLerp;
    if ((carrierState === 'arriving' || carrierState === 'present') &&
        (shipPowerState === 'down' || shipPowerState === 'startup')) {
      goalY = _carrierDockY;
      goalYLerp = carrierState === 'present' ? 0.003 : 0.0015;
    } else if (carrierState === 'leaving' && t - launchAt < LAUNCH_BOOST_DUR) {
      goalY = H * 0.65 - 90;
      goalYLerp = 0.02;
    } else {
      const startupSurge = shipPowerState === 'startup' ? -22 * Math.min(1, (t - startupAt) / STARTUP_DUR) : 0;
      goalY = H * 0.65 + (shipPowerState === 'up' && activeEnemies > 0 ? -42 : 0) + startupSurge;
      goalYLerp = 0.0008;
    }
    shipY += (goalY - shipY) * Math.min(1, goalYLerp * dt);

    // Support drone state machine - flanks the ship elevated and to one side, fires missiles
    const droneHoverX = shipX + drone.side * 110;
    const droneHoverY = shipY - 65;
    if (shipPowerState !== 'up' && drone.state !== 'docked' && drone.state !== 'docking') drone.state = 'docking';
    if (drone.state === 'docked' && activeEnemies >= DRONE_DEPLOY_THRESHOLD && shipPowerState === 'up') {
      drone.side = Math.random() < 0.5 ? -1 : 1;
      drone.angle = 0; drone.targetX = null; drone.targetY = null;
      drone.deployedAt = t; drone.recallAt = 0;
      drone.state = 'launching'; drone.x = shipX; drone.y = shipY;
      // Eject burst - spray outward toward the chosen side
      const lps = [];
      const ejectDir = drone.side < 0 ? Math.PI : 0;
      for (let i = 0; i < 10; i++) {
        const a = ejectDir + (Math.random() - 0.5) * Math.PI * 0.65;
        const s = 0.05 + Math.random() * 0.1;
        lps.push({ x: shipX, y: shipY, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                    r: 1 + Math.random() * 1.5, col: '80,220,255' });
      }
      explosions.push({ ps: lps, born: t, dur: 380 });
    }
    if (drone.state === 'launching' || drone.state === 'active') {
      if (activeEnemies >= DRONE_RECALL_THRESHOLD) {
        drone.recallAt = 0;
      } else {
        if (drone.recallAt === 0) drone.recallAt = t;
        if (t - drone.recallAt > 2500) drone.state = 'docking';
      }
    }
    if (drone.state === 'launching') {
      drone.x += (droneHoverX - drone.x) * Math.min(1, 0.007 * dt);
      drone.y += (droneHoverY - drone.y) * Math.min(1, 0.007 * dt);
      if (Math.hypot(drone.x - droneHoverX, drone.y - droneHoverY) < 3) drone.state = 'active';
    }
    if (drone.state === 'active') {
      const droneBob = Math.sin(t * (Math.PI * 2 / 3200)) * 11;
      drone.x += (droneHoverX - drone.x) * Math.min(1, 0.003 * dt);
      drone.y += ((droneHoverY + droneBob) - drone.y) * Math.min(1, 0.003 * dt);
      if (shipPowerState === 'up' && t - drone.lastFire > DRONE_FIRE_INTERVAL) {
        const droneTargets = entities.filter(e => e.type === 'blocked' && Math.min(e.count, 3) < 3 && e.state !== 'shot' && e.state !== 'targeted' && e.state !== 'seeker-incoming' && !droneMissiles.some(m => m.target === e) && !drone2Missiles.some(m => m.target === e) && e.x >= 120 && e.x <= W - 120 && e.y >= 100 && e.y <= H - hudSH - safeBottom - 30);
        const shipHasTarget = entities.some(e => e.state === 'targeted');
        if (droneTargets.length && (droneTargets.length > 1 || shipHasTarget)) {
          const tgt = droneTargets[Math.floor(Math.random() * droneTargets.length)];
          drone.targetX = tgt.x; drone.targetY = tgt.y;
          // Launch from nose (top of sprite, drone always points up)
          const msx = drone.x;
          const msy = drone.y - bmpH(DRONE_BMP) * DRONE_PX / 2;
          const mdx = tgt.x - msx, mdy = tgt.y - msy;
          const mdist = Math.hypot(mdx, mdy) || 1;
          const mspd = 1.1;
          droneMissiles.push({ x: msx, y: msy, vx: mdx/mdist*mspd, vy: mdy/mdist*mspd,
                              tx: tgt.x, ty: tgt.y, born: t, dur: mdist/mspd,
                              target: tgt, exploded: false, explodeAt: 0 });
          drone.lastFire = t;
        }
      }
    }
    if (drone.state === 'docking') {
      drone.x += (shipX - drone.x) * Math.min(1, 0.012 * dt);
      drone.y += (shipY - drone.y) * Math.min(1, 0.012 * dt);
      if (Math.hypot(drone.x - shipX, drone.y - shipY) < 3) drone.state = 'docked';
    }
    // Keep drone clear of main ship's weapon fire path (weapons fire ~±20px from shipX)
    if (drone.state === 'launching' || drone.state === 'active') {
      if (drone.side < 0) drone.x = Math.min(drone.x, shipX - 80);
      else               drone.x = Math.max(drone.x, shipX + 80);
    }

    // Support drone 2 - heavier swept-wing variant, opposite side from drone 1
    const drone2HoverX = shipX + drone2.side * 110;
    const drone2HoverY = shipY - 58;
    if (shipPowerState !== 'up' && drone2.state !== 'docked' && drone2.state !== 'docking') drone2.state = 'docking';
    if (drone2.state === 'docked' && activeEnemies >= DRONE2_DEPLOY_THRESHOLD && shipPowerState === 'up') {
      drone2.side = drone.side !== 0 ? -drone.side : (Math.random() < 0.5 ? -1 : 1);
      drone2.angle = 0; drone2.targetX = null; drone2.targetY = null;
      drone2.deployedAt = t; drone2.recallAt = 0;
      drone2.state = 'launching'; drone2.x = shipX; drone2.y = shipY;
      const lps2 = [];
      const ejectDir2 = drone2.side < 0 ? Math.PI : 0;
      for (let i = 0; i < 10; i++) {
        const a = ejectDir2 + (Math.random() - 0.5) * Math.PI * 0.65;
        const s = 0.05 + Math.random() * 0.1;
        lps2.push({ x: shipX, y: shipY, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                    r: 1 + Math.random() * 1.5, col: '255,190,60' });
      }
      explosions.push({ ps: lps2, born: t, dur: 380 });
    }
    if (drone2.state === 'launching' || drone2.state === 'active') {
      if (activeEnemies >= DRONE2_RECALL_THRESHOLD) {
        drone2.recallAt = 0;
      } else {
        if (drone2.recallAt === 0) drone2.recallAt = t;
        if (t - drone2.recallAt > 2500) drone2.state = 'docking';
      }
    }
    if (drone2.state === 'launching') {
      drone2.x += (drone2HoverX - drone2.x) * Math.min(1, 0.007 * dt);
      drone2.y += (drone2HoverY - drone2.y) * Math.min(1, 0.007 * dt);
      if (Math.hypot(drone2.x - drone2HoverX, drone2.y - drone2HoverY) < 3) drone2.state = 'active';
    }
    if (drone2.state === 'active') {
      const drone2Bob = Math.sin(t * (Math.PI * 2 / 2800) + Math.PI) * 11;
      drone2.x += (drone2HoverX - drone2.x) * Math.min(1, 0.003 * dt);
      drone2.y += ((drone2HoverY + drone2Bob) - drone2.y) * Math.min(1, 0.003 * dt);
      if (shipPowerState === 'up' && t - drone2.lastFire > DRONE2_FIRE_INTERVAL) {
        const drone2Targets = entities.filter(e => e.type === 'blocked' && Math.min(e.count, 3) < 3 && e.state !== 'shot' && e.state !== 'targeted' && e.state !== 'seeker-incoming'
          && !droneMissiles.some(m => m.target === e) && !drone2Missiles.some(m => m.target === e)
          && e.x >= 120 && e.x <= W - 120 && e.y >= 100 && e.y <= H - hudSH - safeBottom - 30);
        const ship2HasTarget = entities.some(e => e.state === 'targeted');
        if (drone2Targets.length && (drone2Targets.length > 1 || ship2HasTarget)) {
          const tgt = drone2Targets[Math.floor(Math.random() * drone2Targets.length)];
          drone2.targetX = tgt.x; drone2.targetY = tgt.y;
          const msx = drone2.x;
          const msy = drone2.y - bmpH(DRONE2_BMP) * DRONE2_PX / 2;
          const mdx = tgt.x - msx, mdy = tgt.y - msy;
          const mdist = Math.hypot(mdx, mdy) || 1;
          const mspd = 1.1;
          drone2Missiles.push({ x: msx, y: msy, vx: mdx/mdist*mspd, vy: mdy/mdist*mspd,
                                 tx: tgt.x, ty: tgt.y, born: t, dur: mdist/mspd,
                                 target: tgt, exploded: false, explodeAt: 0 });
          drone2.lastFire = t;
        }
      }
    }
    if (drone2.state === 'docking') {
      drone2.x += (shipX - drone2.x) * Math.min(1, 0.012 * dt);
      drone2.y += (shipY - drone2.y) * Math.min(1, 0.012 * dt);
      if (Math.hypot(drone2.x - shipX, drone2.y - shipY) < 3) drone2.state = 'docked';
    }
    if (drone2.state === 'launching' || drone2.state === 'active') {
      if (drone2.side < 0) drone2.x = Math.min(drone2.x, shipX - 80);
      else                 drone2.x = Math.max(drone2.x, shipX + 80);
    }

    // Missile travel, impact, and cleanup
    for (let i = droneMissiles.length - 1; i >= 0; i--) {
      const m = droneMissiles[i];
      if (m.exploded) {
        if (t - m.explodeAt > 700) droneMissiles.splice(i, 1);
        continue;
      }
      m.x += m.vx * dt; m.y += m.vy * dt;
      const _tgt = m.target && m.target.state !== 'shot' && m.target.x >= 0 && m.target.x <= W && m.target.y >= 0 && m.target.y <= H ? m.target : null;
      const _htx = _tgt ? _tgt.x : m.tx;
      const _hty = _tgt ? _tgt.y : m.ty;
      if (Math.hypot(m.x - _htx, m.y - _hty) < 20 || t - m.born > m.dur + 150) {
        m.exploded = true; m.explodeAt = t;
        if (m.target && m.target.state !== 'shot') {
          m.target.state = 'shot'; m.target.killedBy = 'drone';
        }
        const mps = [];
        for (let j = 0; j < 80; j++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 0.08 + Math.random() * 0.38;
          mps.push({ x: m.x, y: m.y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp,
                     r: 3 + Math.random() * 5, col: j < 40 ? '80,220,255' : j < 65 ? '210,245,255' : '255,255,255' });
        }
        explosions.push({ ps: mps, born: t, dur: 1300 });
        chainRings.push({ x: m.x, y: m.y, born: t, dur: 550,
                          col1: 'rgba(80,220,255,1)', colS: 'rgba(40,180,255,0.9)', maxR: 110 });
        chainRings.push({ x: m.x, y: m.y, born: t, dur: 380,
                          col1: 'rgba(200,245,255,1)', colS: 'rgba(180,235,255,0.9)', maxR: 55 });
      }
    }

    // Drone 2 missile travel, impact, and cleanup
    for (let i = drone2Missiles.length - 1; i >= 0; i--) {
      const m = drone2Missiles[i];
      if (m.exploded) {
        if (t - m.explodeAt > 700) drone2Missiles.splice(i, 1);
        continue;
      }
      m.x += m.vx * dt; m.y += m.vy * dt;
      const _tgt2 = m.target && m.target.state !== 'shot' && m.target.x >= 0 && m.target.x <= W && m.target.y >= 0 && m.target.y <= H ? m.target : null;
      const _htx2 = _tgt2 ? _tgt2.x : m.tx;
      const _hty2 = _tgt2 ? _tgt2.y : m.ty;
      if (Math.hypot(m.x - _htx2, m.y - _hty2) < 20 || t - m.born > m.dur + 150) {
        m.exploded = true; m.explodeAt = t;
        if (m.target && m.target.state !== 'shot') {
          m.target.state = 'shot'; m.target.killedBy = 'drone';
        }
        const mps = [];
        for (let j = 0; j < 80; j++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 0.08 + Math.random() * 0.38;
          mps.push({ x: m.x, y: m.y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp,
                     r: 3 + Math.random() * 5, col: j < 40 ? '255,190,60' : j < 65 ? '255,230,140' : '255,255,220' });
        }
        explosions.push({ ps: mps, born: t, dur: 1300 });
        chainRings.push({ x: m.x, y: m.y, born: t, dur: 550,
                          col1: 'rgba(255,190,60,1)', colS: 'rgba(255,150,30,0.9)', maxR: 110 });
        chainRings.push({ x: m.x, y: m.y, born: t, dur: 380,
                          col1: 'rgba(255,240,180,1)', colS: 'rgba(255,220,140,0.9)', maxR: 55 });
      }
    }

    for (let i = lasers.length - 1; i >= 0; i--) {
      const _l = lasers[i];
      if (t - _l.born > (_l.style === 'seeker' ? _l.dur + 60 : 300)) lasers.splice(i, 1);
    }

    for (let i = explosions.length - 1; i >= 0; i--) {
      const ex = explosions[i];
      if (t - ex.born > ex.dur) { explosions.splice(i, 1); continue; }
      for (const p of ex.ps) { p.x += p.vx * dt; p.y += p.vy * dt; }
    }

    // Domain fragment & debris drift
    for (let i = domainFragments.length - 1; i >= 0; i--) {
      const f = domainFragments[i];
      if (t - f.born > f.dur) { domainFragments.splice(i, 1); continue; }
      f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vrot * dt;
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      if (t - d.born > d.dur) { debris.splice(i, 1); continue; }
      d.x += d.vx * dt; d.y += d.vy * dt;
    }
    for (let i = chainRings.length - 1; i >= 0; i--) {
      if (t - chainRings[i].born >= chainRings[i].dur) chainRings.splice(i, 1);
    }

    // Warp state machine
    if (warpState === 'out' && t - warpAt >= WARP_OUT_DUR) {
      currentShip = warpNextShip; warpNextShip = null;
      sessionStorage.setItem('ph_ship', currentShip);
      warpState = 'in'; warpAt = t;
      for (const c of crewMembers) { if (c.state !== 'fleeing') { c.state = 'fleeing'; c.stateAt = t; c.wpIdx = 0; c.fromX = c.x; c.fromY = c.y; } }
    } else if (warpState === 'in' && t - warpAt >= WARP_IN_DUR) {
      warpState = 'none'; shipPowerState = 'up';
      gunCheckState = 0; gunCheckFiredAt = [0, 0];
    }

    // Warp-out shockwave: permanent velocity impulse as ship passes each entity
    if (warpState === 'out') {
      const _wp = Math.min(1, (t - warpAt) / WARP_OUT_DUR);
      const _p2 = Math.max(0, (_wp - 0.40) / 0.60);
      if (_p2 > 0) {
        const warpFrontY = shipY - _p2 * (H + 300);
        for (const e of entities) {
          if (!e.warpPushed && warpFrontY <= e.y) {
            const lateralDist = e.x - shipX;
            const falloff = Math.exp(-Math.abs(lateralDist) / 160);
            e.vx += Math.sign(lateralDist || 1) * 0.12 * falloff;
            e.vy -= 0.04 * falloff;
            e.warpPushed = true;
          }
        }
      }
    }

    // Startup sequence completion
    if (shipPowerState === 'startup' && t - startupAt >= STARTUP_DUR) {
      shipPowerState = 'up';
      if (carrierState === 'present') {
        carrierState = 'leaving'; carrierLeavingAt = t; launchAt = t;
        crewMembers = []; crewNextSpawn = 0; lastFuelAt = 0;
        chainRings.push({ x: shipX, y: shipY, born: t, dur: 380, maxR: 90,
          col1: 'rgba(180,220,255,0.9)', colS: 'rgba(120,180,255,0.7)' });
      }
    }
    // Gun check arm/fire during startup
    if (shipPowerState === 'startup') {
      const sp = (t - startupAt) / STARTUP_DUR;
      if (gunCheckState === 0 && sp >= GUN_CHECK_AT[0]) { gunCheckState = 1; gunCheckFiredAt[0] = t; }
      if (gunCheckState === 1 && sp >= GUN_CHECK_AT[1]) { gunCheckState = 2; gunCheckFiredAt[1] = t; }
    }
    // Powerdown completion - trigger carrier arrival
    if (shipPowerState === 'powerdown' && t - powerdownAt >= POWERDOWN_DUR) {
      shipPowerState = 'down';
      if (carrierState === 'none') {
        carrierState = 'arriving'; carrierRestY = H * 0.78;
        carrierY = H + 240; carrierArrivingAt = t;
      }
    }
    // Also trigger carrier if blocking was detected off via poll (e.g. external Pi-hole toggle)
    if (shipPowerState === 'down' && blockingEnabled === false && carrierState === 'none') {
      carrierState = 'arriving'; carrierRestY = H * 0.78;
      carrierY = H + 240; carrierArrivingAt = t;
    }
    // Timed-block countdown → auto re-enable with startup sequence
    if (blockingEnabled === false && blockingDuration > 0 && shipPowerState === 'down') {
      if (t - blockingOffAt >= blockingDuration) {
        blockingEnabled = true; blockingDuration = 0;
        gunCheckState = 0; gunCheckFiredAt = [0, 0];
        shipPowerState = 'startup'; startupAt = t;
        if (carrierState === 'arriving') { carrierState = 'leaving'; carrierLeavingAt = t; launchAt = t; }
      }
    }
    // Carrier position animation
    if (carrierState === 'arriving') {
      const cp = Math.min(1, (t - carrierArrivingAt) / CARRIER_ARRIVE_DUR);
      const ease = 1 - Math.pow(1 - cp, 3);
      carrierY = (H + 240) + (carrierRestY - (H + 240)) * ease;
      if (cp >= 1) { carrierState = 'present'; carrierY = carrierRestY; }
    }
    // Guard: carrier must not stay present while ship is up (happens when startup completes before
    // carrier finishes arriving - e.g. rapid remote toggle or returning from a backgrounded tab)
    if (shipPowerState === 'up' && carrierState === 'present') {
      carrierState = 'leaving'; carrierLeavingAt = t; launchAt = t;
      crewMembers = []; crewNextSpawn = 0; lastFuelAt = 0;
    }
    if (carrierState === 'leaving') {
      const lp = Math.min(1, (t - carrierLeavingAt) / CARRIER_LEAVE_DUR);
      carrierY = carrierRestY + lp * lp * (H + 240 - carrierRestY);
      if (lp >= 1) { carrierState = 'none'; carrierY = 0; carrierRestY = 0; }
    }

    if (settingsBtnEl) {
      const _startupPhase = shipPowerState === 'startup' ? (t - startupAt) / STARTUP_DUR : -1;
      const _btnHide = shipPowerState === 'powerdown' || (_startupPhase >= 0 && _startupPhase <= 0.72);
      settingsBtnEl.style.transition = _btnHide ? 'opacity 100ms ease' : '';
      settingsBtnEl.style.opacity = _btnHide ? '0' : '';
      settingsBtnEl.style.pointerEvents = _btnHide ? 'none' : '';
      if (_btnHide) {
        // Close the canvas menu but leave menu-open class so the button fades out as-is
        // (removing it would trigger the X→burger span animation while fading, visible to the user)
        if (settingsMenuOpen) settingsMenuOpen = false;
      } else if (!settingsMenuOpen) {
        // Snap the button state clean while opacity is still 0; the class removal is invisible
        settingsBtnEl.classList.remove('menu-open');
      }
    }

    render(t);

  }

  const _phIcon = new Image();
  _phIcon.src = '/static/icons/pihole.svg';

  const _SHIP_CONFIGS = {
    protector:  { bmp: PROTECTOR_BMP,     color: 'rgba(195,208,240,0.95)', glow: 'rgba(170,190,235,0.55)', dimColor: 'rgba(195,208,240,0.22)',
                  flares: [{ xOff: -20, yOff: 0, size: 1, burstWScale: 0 }, { xOff: 20, yOff: 0, size: 1, burstWScale: 0 }] },
    falcon:     { bmp: FALCON_BMP,     color: 'rgba(195,208,240,0.95)', glow: 'rgba(170,190,235,0.45)', dimColor: 'rgba(195,208,240,0.22)',
                  flares: [{ xOff: -3, yOff: 1, size: 3.2, len: 0.75, taper: 0.85, shape: 'column', wobble: 0.15, burstWScale: 0 }] },
    swordfish:  { bmp: SWORDFISH_BMP,  color: 'rgba(207,50,33,0.95)', glow: 'rgba(203,38,20,0.55)', dimColor: 'rgba(207,50,33,0.22)',
                  flares: [{ xOff: 0, yOff: 6, size: 1.5, len: 1.0, burstWScale: 0 }] },
    enterprise: { bmp: ENTERPRISE_BMP, color: 'rgba(195,208,240,0.95)', glow: 'rgba(170,190,235,0.48)', dimColor: 'rgba(195,208,240,0.22)',
                  flares: [{ xOff: -13, yOff: 0, size: 0.9, burstWScale: 0 }, { xOff: 13, yOff: 0, size: 0.9, burstWScale: 0 }, { xOff: 0, yOff: -34, size: 0.50, burstWScale: 0 }] },
  };

  // ── Render ────────────────────────────────────────────────────────
  function render(t) {
    ctx.clearRect(0, 0, W, H);

    // Screen shake - decaying oscillation on warp-out blast
    const shakeAge = t - shakeAt;
    let shakeOn = false;
    let shakeSx = 0, shakeSy = 0;
    if (shakeAge < shakeDur) {
      const decay = 1 - shakeAge / shakeDur;
      shakeSx = Math.sin(shakeAge * 0.072) * shakeAmp * decay;
      shakeSy = Math.cos(shakeAge * 0.055) * shakeAmp * 0.6 * decay;
      ctx.save();
      ctx.translate(shakeSx, shakeSy);
      shakeOn = true;
    }

    // Debris - sparse drifting wreckage, fades over 8-13 s
    for (const d of debris) {
      const prog = (t - d.born) / d.dur;
      const a = prog < 0.65 ? 0.28 : 0.28 * (1 - (prog - 0.65) / 0.35);
      ctx.fillStyle = `rgba(${d.col},${a.toFixed(3)})`;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), d.sz, d.sz);
    }

    // End shake translate - entities get warp-blast distortion instead of shaking
    if (shakeOn) { ctx.restore(); shakeOn = false; }

    // Ship-position-based warp distortion: Gaussian bell centered on ship's current Y
    let warpFrontY = null;
    if (warpState === 'out') {
      const _wp = Math.min(1, (t - warpAt) / WARP_OUT_DUR);
      const _p2 = Math.max(0, (_wp - 0.40) / 0.60);
      if (_p2 > 0) warpFrontY = shipY - _p2 * (H + 300);
    }

    // ── Carrier ship ──────────────────────────────────────────────────────
    if (carrierState !== 'none') {
      const ccx = Math.round(W * 0.40);
      const ccy = Math.round(carrierY);
      const _cFade = carrierState === 'arriving'
        ? Math.min(1, (t - carrierArrivingAt) / 700)
        : carrierState === 'leaving'
        ? Math.max(0, 1 - (t - carrierLeavingAt) / 550)
        : 1;
      ctx.save();
      ctx.globalAlpha = _cFade;
      { // Interior fill - subtle sci-fi deck surface (drawn before hull so hull is on top)
        const _iOx = Math.round(ccx - 75 * CARRIER_PX / 2) + 2 * CARRIER_PX;
        const _iOy = Math.round(ccy - 24 * CARRIER_PX / 2) + 1 * CARRIER_PX;
        ctx.fillStyle = 'rgba(25, 65, 140, 0.07)';
        ctx.fillRect(_iOx, _iOy, 71 * CARRIER_PX, 22 * CARRIER_PX);
      }
      drawBmp(ctx, CARRIER_BMP, ccx, ccy, 'rgba(130,145,170,0.88)', 'rgba(100,120,160,0.28)', CARRIER_PX);
      for (let li = 0; li < CARRIER_LIGHT_OFFSETS.length; li++) {
        const lo = CARRIER_LIGHT_OFFSETS[li];
        const lx = ccx + lo.dx, ly = ccy + lo.dy;
        const brightness = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.003 + li * 0.47));
        ctx.fillStyle = `rgba(255,155,30,${brightness.toFixed(3)})`;
        ctx.shadowColor = 'rgba(255,120,10,0.9)'; ctx.shadowBlur = 12;
        ctx.fillRect(lx - 2, ly - 2, 5, 5);
      }
      ctx.shadowBlur = 0;
      // Ground crew - emerge from top-centre hatch when blocking off 30s+
      {
        const _hatchX = ccx;
        const _hatchY = ccy - 63;  // under island structure (bitmap row 1)
        const _topCY  = ccy - 48;  // corridor above all ships (row ~3.5)
        const _botCY  = ccy + 48;  // corridor below all ships (row ~19.5)
        const _bumpY  = ccy + 63;  // fuel bump on bottom border (bitmap row 22)
        // Gap X offsets from ccx for routing fuel crew between ship bays
        const _gapDXs = [-90, 0, 90, 90];

        const _crewEligible = carrierState === 'present' && shipPowerState === 'down'
            && blockingEnabled === false && t - blockingOffAt >= 30000;

        // Build a ship-avoiding flee path from a crew member's current position
        const _makeFleePath = c => {
          if (c.y <= _topCY) {
            return [{ x: _hatchX, y: _hatchY }];
          }
          if (!c.gapX) {
            return [{ x: _hatchX, y: _topCY }, { x: _hatchX, y: _hatchY }];
          }
          const onGapCol = Math.abs(c.x - c.gapX) < 6;
          return [
            ...(!onGapCol || c.y > _botCY ? [{ x: c.gapX, y: _botCY }] : []),
            { x: c.gapX, y: _topCY },
            { x: _hatchX, y: _topCY },
            { x: _hatchX, y: _hatchY },
          ];
        };

        if (shipPowerState === 'startup') {
          for (const c of crewMembers) {
            if (c.state !== 'fleeing') {
              c.state = 'fleeing'; c.stateAt = t; c.wpIdx = 0;
              c.fromX = c.x; c.fromY = c.y;
              c.returnPath = _makeFleePath(c); c.fleepathReady = true;
            }
          }
        }
        // Crew set fleeing from outside the render block (e.g. warp) need fresh flee path
        for (const c of crewMembers) {
          if (c.state === 'fleeing' && !c.fleepathReady) {
            c.fromX = c.x; c.fromY = c.y;
            c.returnPath = _makeFleePath(c); c.fleepathReady = true;
          }
        }

        // Waypoint movement - all movement states use waypoint lists
        for (const c of crewMembers) {
          const _dt = (t - c.stateAt) / 1000;
          if (c.state === 'walking' || c.state === 'returning' || c.state === 'fleeing') {
            const _path = (c.state === 'walking') ? c.waypoints : c.returnPath;
            const _speed = c.state === 'fleeing' ? 85 : 28;
            if (c.wpIdx >= _path.length) {
              if (c.state === 'walking') { c.state = 'at_post'; c.stateAt = t; }
              continue;
            }
            const _wp = _path[c.wpIdx];
            const _dist = Math.hypot(_wp.x - c.fromX, _wp.y - c.fromY);
            const _p = _dist > 0 ? Math.min(1, _dt * _speed / _dist) : 1;
            c.x = c.fromX + (_wp.x - c.fromX) * _p;
            c.y = c.fromY + (_wp.y - c.fromY) * _p;
            if (_p >= 1) {
              c.x = _wp.x; c.y = _wp.y; c.wpIdx++;
              c.fromX = c.x; c.fromY = c.y; c.stateAt = t;
              if (c.wpIdx >= _path.length && c.state === 'walking') {
                c.state = 'at_post'; c.stateAt = t;
              }
            }
          } else if (c.state === 'at_post') {
            if (t - c.spawnedAt >= c.lifetime) {
              c.state = 'returning'; c.stateAt = t; c.wpIdx = 0;
              c.fromX = c.x; c.fromY = c.y;
              if (c.type === 'fuel') lastFuelAt = t;
            }
          }
        }

        crewMembers = crewMembers.filter(c =>
          (c.state !== 'returning' && c.state !== 'fleeing') ||
          Math.hypot(c.x - _hatchX, c.y - _hatchY) > 5
        );

        // Spawn crew to service the active ship
        if (_crewEligible && t > crewNextSpawn && crewMembers.length < 3) {
          const _hasFuel = crewMembers.some(c => c.type === 'fuel');
          const _fuelOk = !_hasFuel && t - lastFuelAt >= 300000;
          const _firstCrew = crewMembers.length === 0 && lastFuelAt === 0;
          const _type = (_firstCrew || _fuelOk) && !_hasFuel
            ? 'fuel'
            : ['inspect', 'signal', 'repair', 'idle'][Math.floor(Math.random() * 4)];
          const _shipIdx = CARRIER_SHIP_ORDER.indexOf(currentShip);
          const _bayX = ccx + CARRIER_BAY_DX[_shipIdx];
          const _gapX = ccx + _gapDXs[_shipIdx];

          let _waypoints, _returnPath, _gapRef;
          if (_type === 'fuel') {
            const _shipBackY = ccy + Math.ceil(bmpH(_SHIP_CONFIGS[currentShip].bmp) * PX / 2) - (currentShip === 'enterprise' ? 9 : 0) + (currentShip === 'swordfish' ? 4 : 0) - (currentShip === 'protector' ? 9 : 0) + (currentShip === 'falcon' ? 2 : 0);
            _gapRef = _gapX;
            _waypoints = [
              { x: _hatchX, y: _topCY },   // step down from hatch to top corridor
              { x: _gapX,   y: _topCY },   // slide to gap lane
              { x: _gapX,   y: _botCY },   // drop through gap past all ships
              { x: _bayX,   y: _bumpY - 4 }, // approach fuel bump
              { x: _bayX,   y: _shipBackY }, // walk hose up to ship back
            ];
            _returnPath = [
              { x: _bayX,   y: _bumpY - 4 }, // walk hose back to bump
              { x: _gapX,   y: _botCY },   // slide to gap lane
              { x: _gapX,   y: _topCY },   // climb through gap
              { x: _hatchX, y: _topCY },   // slide to hatch column
              { x: _hatchX, y: _hatchY },  // return to hatch
            ];
          } else {
            const _takenSpots = crewMembers
              .filter(c => c.type !== 'fuel' && c.waypoints)
              .map(c => c.waypoints[c.waypoints.length - 1]);
            if (Math.random() < 0.4) {
              // Work alongside the ship in the gap lane
              _gapRef = _gapX;
              let _sideY, _sa = 0;
              do {
                _sideY = ccy + Math.round((Math.random() - 0.5) * 48);
                _sa++;
              } while (_sa < 20 && _takenSpots.some(s => Math.abs(s.x - _gapX) < 5 && Math.abs(s.y - _sideY) < 14));
              _waypoints = [
                { x: _hatchX, y: _topCY },
                { x: _gapX,   y: _topCY },
                { x: _gapX,   y: _sideY },
              ];
              _returnPath = [
                { x: _gapX,   y: _topCY },
                { x: _hatchX, y: _topCY },
                { x: _hatchX, y: _hatchY },
              ];
            } else {
              // Work in the top corridor above the active ship
              _gapRef = undefined;
              let _workX, _attempts = 0;
              do {
                _workX = _bayX + Math.round((Math.random() - 0.5) * 40);
                _attempts++;
              } while (_attempts < 20 && _takenSpots.some(s => Math.abs(s.y - _topCY) < 5 && Math.abs(s.x - _workX) < 14));
              _waypoints = [
                { x: _hatchX, y: _topCY },
                { x: _workX,  y: _topCY },
              ];
              _returnPath = [
                { x: _hatchX, y: _topCY },
                { x: _hatchX, y: _hatchY },
              ];
            }
          }

          crewMembers.push({
            type: _type, x: _hatchX, y: _hatchY, fromX: _hatchX, fromY: _hatchY,
            state: 'walking', stateAt: t, wpIdx: 0,
            waypoints: _waypoints, returnPath: _returnPath,
            bumpX: _bayX, bumpY: _bumpY, gapX: _gapRef,
            spawnedAt: t, lifetime: 18000 + Math.random() * 14000,
          });
          crewNextSpawn = t + 5000 + Math.random() * 8000;
        }

        // Draw crew
        for (const c of crewMembers) {
          const _distToHatch = Math.hypot(c.x - _hatchX, c.y - _hatchY);
          const _a = Math.min(1, (t - c.spawnedAt) / 400) * Math.min(1, _distToHatch / 16);
          if (_a < 0.01) continue;
          ctx.save();
          ctx.globalAlpha *= _a;
          const _dx = Math.round(c.x), _dy = Math.round(c.y);
          const _col = c.type === 'fuel'    ? 'rgba(240,175,70,0.95)'
                     : c.type === 'inspect' ? 'rgba(120,195,255,0.95)'
                     : c.type === 'repair'  ? 'rgba(255,140,80,0.95)'
                     : c.type === 'idle'    ? 'rgba(180,200,180,0.85)'
                     :                        'rgba(255,225,70,0.95)';

          // Fuel hose - extends as he walks to ship back, retracts as he returns
          if (c.type === 'fuel' && (
              c.state === 'at_post' ||
              (c.state === 'walking'   && c.wpIdx === 4) ||
              (c.state === 'returning' && c.wpIdx === 0)
          )) {
            ctx.strokeStyle = `rgba(255,160,40,${(0.7 + 0.2 * Math.sin(t * 0.005)).toFixed(2)})`;
            ctx.lineWidth = 0.3;
            ctx.beginPath();
            ctx.moveTo(_dx, _dy + 4);
            ctx.quadraticCurveTo((_dx + c.bumpX) / 2 + 7, (_dy + 4 + c.bumpY) / 2, c.bumpX, c.bumpY);
            ctx.stroke();
          }

          if (c.state === 'at_post') {
            if (c.type === 'fuel') {
              const _by = _dy + Math.round(Math.sin(t * 0.0025) * 1);
              drawBmp(ctx, Math.floor(t / 1100) % 2 === 0 ? CREW_CROUCH : CREW_STAND_A, _dx, _by, _col, null, CREW_PX);
            } else if (c.type === 'inspect') {
              const _raised = Math.sin(t * 0.0014) > 0.55;
              drawBmp(ctx, _raised ? CREW_REACH : CREW_STAND_A, _dx, _dy, _col, null, CREW_PX);
              if (_raised) {
                ctx.fillStyle = 'rgba(190,235,255,0.6)';
                ctx.shadowColor = 'rgba(80,190,255,0.5)'; ctx.shadowBlur = 3;
                ctx.fillRect(_dx + 3, _dy - 5, 2, 4); ctx.shadowBlur = 0;
              }
            } else if (c.type === 'repair') {
              drawBmp(ctx, CREW_CROUCH, _dx, _dy, _col, null, CREW_PX);
              if (Math.sin(t * 0.007) > 0.85) {
                ctx.fillStyle = 'rgba(255,220,80,0.9)';
                ctx.shadowColor = 'rgba(255,200,40,0.8)'; ctx.shadowBlur = 5;
                ctx.fillRect(_dx + 2, _dy - 3, 2, 2); ctx.shadowBlur = 0;
              }
            } else if (c.type === 'idle') {
              drawBmp(ctx, Math.floor(t / 2200) % 2 === 0 ? CREW_STAND_A : CREW_STAND_B, _dx, _dy, _col, null, CREW_PX);
            } else {
              drawBmp(ctx, Math.floor(t / 700) % 2 === 0 ? CREW_REACH : CREW_STAND_A, _dx, _dy, _col, null, CREW_PX);
            }
          } else {
            const _rate = c.state === 'fleeing' ? 110 : 260;
            drawBmp(ctx, Math.floor(t / _rate) % 2 === 0 ? CREW_STAND_A : CREW_STAND_B, _dx, _dy, _col, null, CREW_PX);
          }
          ctx.restore();
        }
      }
      // Redraw hatch structure rows on top of crew so crew appears behind it
      drawBmp(ctx, CARRIER_BMP.slice(1, 3), ccx, ccy - 60, 'rgba(130,145,170,0.88)', 'rgba(100,120,160,0.28)', CARRIER_PX);
      // Inactive ships drawn after crew so ships occlude crew walking through bays
      const _deckY = ccy;
      for (let bi = 0; bi < CARRIER_SHIP_ORDER.length; bi++) {
        const bShip = CARRIER_SHIP_ORDER[bi];
        const bx = ccx + CARRIER_BAY_DX[bi];
        if (bShip !== currentShip) {
          drawBmp(ctx, _SHIP_CONFIGS[bShip].bmp, bx, _deckY, _SHIP_CONFIGS[bShip].dimColor, null, PX);
        }
      }

      // Carrier propulsion jets
      const _jft = t * 0.005;
      const _cHalfH = CARRIER_BMP.length * CARRIER_PX / 2;
      const _jXOffs = [-155, -55, 55, 155];
      if (carrierState === 'arriving') {
        const _cp = Math.min(1, (t - carrierArrivingAt) / CARRIER_ARRIVE_DUR);
        const _js = (1 - _cp * 0.65) * 0.3;
        const _jBase = ccy + _cHalfH;
        for (const jdx of _jXOffs) drawEngineFlare(ccx + jdx, _jBase, _jft, _js, _js * 1.6);
      } else if (carrierState === 'leaving') {
        const _lp = Math.min(1, (t - carrierLeavingAt) / CARRIER_LEAVE_DUR);
        const _js = (0.08 + _lp * 0.35) * 0.9;
        const _jBase = ccy - _cHalfH;
        ctx.save();
        ctx.scale(1, -1);
        for (const jdx of _jXOffs) drawEngineFlare(ccx + jdx, -_jBase, _jft, _js, _js * 1.6);
        ctx.restore();
      }
      ctx.restore();
    }

    // Entities (drawn after carrier so they appear over it during powerdown)
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.imageSmoothingEnabled = false;
    for (const e of entities) {
      const age = t - e.spawnTime;
      const alpha = Math.min(1, (t - e.appearAt) / 400);

      // Warp-blast push: visual distortion peaks as ship passes each entity, then fades naturally
      let ex = e.x, ey = e.y;
      if (warpFrontY !== null) {
        const lateralDist = e.x - shipX;
        const vertDist = e.y - warpFrontY; // positive = entity below ship (not yet passed)
        const proximity = Math.exp(-Math.pow(vertDist / 75, 2));
        const lateralFalloff = Math.exp(-Math.abs(lateralDist) / 160);
        ex = e.x + Math.sign(lateralDist || 1) * proximity * lateralFalloff * 30;
        ey = e.y - proximity * lateralFalloff * 10;
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      const EPX = PX;
      if (e.type === 'blocked') {
        const tier = Math.min(e.count, 3);
        const bmp  = tier >= 3 ? E3 : tier === 2 ? E2 : (e.design === 0 ? E0 : E1);
        const pulse = 0.75 + 0.25 * Math.sin(age * 0.005);
        const [colFull, glow, rcol, rglow] = tier >= 3
          ? ['rgba(190,60,255,1)', 'rgba(190,60,255,0.35)', 'rgba(255,210,50,0.9)',  'rgba(255,175,30,0.6)']
          : tier === 2
          ? ['rgba(255,130,30,1)', 'rgba(255,130,30,0.35)', 'rgba(0,220,255,0.9)',   'rgba(0,190,255,0.6)']
          : ['rgba(255,50,50,1)',  'rgba(255,60,40,0.35)',  'rgba(80,255,160,0.9)',  'rgba(60,240,140,0.6)'];
        // Mutation scale pulse
        const mp = e.mutateAt > 0 ? Math.min(1, (t - e.mutateAt) / 500) : 1;
        const mutActive = mp < 1;
        ctx.save();
        ctx.translate(ex, ey);
        if (mutActive) {
          const sc = 1 + 0.45 * Math.sin(mp * Math.PI);
          ctx.scale(sc, sc);
        }

        const _sp = getCachedSprite(bmp, colFull, glow, EPX);
        ctx.globalAlpha = alpha * pulse;
        ctx.drawImage(_sp.canvas, -_sp.w / 2, -_sp.h / 2);
        ctx.globalAlpha = alpha;

        // Targeting reticle
        if (e.state === 'targeted') {
          const rAge = t - e.targetedAt;
          const rPulse = 0.5 + 0.5 * Math.sin(rAge * 0.015);
          const r = 22 + Math.max(0, 1 - rAge / 500) * 10;
          ctx.globalAlpha = alpha * (0.5 + 0.4 * rPulse);
          ctx.strokeStyle = rcol;
          ctx.lineWidth = 1;
          ctx.shadowColor = rglow;
          ctx.shadowBlur = 6;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
          const arm = 6;
          ctx.beginPath();
          ctx.moveTo(-r, 0); ctx.lineTo(-r + arm, 0);
          ctx.moveTo(r - arm, 0); ctx.lineTo(r, 0);
          ctx.moveTo(0, -r); ctx.lineTo(0, -r + arm);
          ctx.moveTo(0, r - arm); ctx.lineTo(0, r);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = alpha;
        }

        ctx.restore();

        // Expanding ring (world space - unaffected by scale)
        if (mutActive) {
          const rr = Math.round(12 + 36 * mp);
          ctx.save();
          ctx.globalAlpha = alpha * (1 - mp);
          ctx.strokeStyle = `rgba(${e.mutateColor},1)`;
          ctx.lineWidth = 2;
          ctx.shadowColor = `rgba(${e.mutateColor},0.6)`;
          ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(ex, ey, rr, 0, Math.PI * 2); ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      } else {
        const tier = Math.min(e.count, 3);
        const bmp = tier >= 3 ? F4 : tier === 2 ? F3 : [F0, F1, F2][e.design % 3];
        const [color, glow] = tier >= 3
          ? ['rgba(205,170,75,0.72)', 'rgba(205,170,75,0.2)']
          : tier === 2
          ? ['rgba(100,220,255,0.72)', 'rgba(100,220,255,0.2)']
          : [['rgba(50,215,120,0.72)','rgba(80,175,255,0.72)','rgba(175,220,70,0.72)'][e.design % 3],
              ['rgba(50,215,120,0.2)','rgba(80,175,255,0.2)','rgba(175,220,70,0.2)'][e.design % 3]];
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(Math.atan2(e.vy, e.vx) + Math.PI / 2);
        const _sp = getCachedSprite(bmp, color, glow, EPX - 1);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(_sp.canvas, -_sp.w / 2, -_sp.h / 2);
        ctx.imageSmoothingEnabled = false;
        ctx.restore();
      }

      ctx.restore();

      // Domain / client labels (always upright)
      const la = e.type === 'blocked' ? alpha : e.labelAlpha * alpha;
      if (la > 0.02 && (showDomain || showClient)) {
        const tier = Math.min(e.count, 3);
        const lbmp = e.type === 'blocked'
          ? (tier >= 3 ? E3 : tier === 2 ? E2 : (e.design === 0 ? E0 : E1))
          : (tier >= 3 ? F4 : tier === 2 ? F3 : [F0, F1, F2][e.design % 3]);
        const baseY = ey + (bmpH(lbmp) * EPX / 2) + 13;
        const both = showDomain && showClient;
        ctx.save();
        ctx.globalAlpha = la * 0.85;
        ctx.shadowColor = 'rgba(0,0,0,0.95)';
        ctx.shadowBlur = 4;
        if (showClient && e.client) {
          ctx.fillStyle = 'rgba(130,185,225,0.80)';
          const cli = e.client.length > 32 ? '…' + e.client.slice(-30) : e.client;
          ctx.fillText(cli, ex, baseY);
        }
        if (showDomain) {
          const domY = both && showClient && e.client ? baseY + 14 : baseY;
          if (e.type === 'blocked') {
            ctx.fillStyle = tier >= 3 ? 'rgba(200,100,255,1)' : tier === 2 ? 'rgba(255,160,60,1)' : 'rgba(255,120,100,1)';
          } else {
            ctx.fillStyle = 'rgba(150,230,175,1)';
          }
          const dom = e.domain.length > 32 ? '…' + e.domain.slice(-30) : e.domain;
          ctx.fillText(dom, ex, domY);
        }
        ctx.restore();
      }
    }

    // Explosions
    for (const ex of explosions) {
      const pa = Math.max(0, 1 - (t - ex.born) / ex.dur * 1.4);
      if (pa <= 0) continue;
      const paStr = pa.toFixed(2);
      let lastCol = null;
      for (const p of ex.ps) {
        if (p.col !== lastCol) {
          ctx.fillStyle = `rgba(${p.col},${paStr})`;
          lastCol = p.col;
        }
        const half = Math.max(1, Math.round(p.r));
        ctx.fillRect(Math.round(p.x) - half, Math.round(p.y) - half, half * 2, half * 2);
      }
    }

    // Chain shockwave rings - expanding concussive ring at chain detonation point
    for (const r of chainRings) {
      const prog = (t - r.born) / r.dur;
      const radius = prog * (r.maxR || 52);
      const a = Math.max(0, (1 - prog) * 0.75);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = r.col1 || 'rgba(255,210,80,1)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = r.colS || 'rgba(255,180,40,0.9)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(Math.round(r.x), Math.round(r.y), radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Domain fragments - letters scatter from killed enemies (only when domain labels are on)
    if (showDomain && domainFragments.length > 0) {
      ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const f of domainFragments) {
        const prog = (t - f.born) / f.dur;
        if (prog >= 1) continue;
        const a = Math.max(0, 1 - prog * 1.3);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgba(${f.col},1)`;
        ctx.translate(Math.round(f.x), Math.round(f.y));
        ctx.rotate(f.rot);
        ctx.fillText(f.ch, 0, 0);
        ctx.restore();
      }
      ctx.textBaseline = 'alphabetic';
    }

    // Ship and drone positions
    const passiveBob = shipPowerState === 'up' ? 2.5 * Math.sin(t * 0.00055) + 1 * Math.sin(t * 0.00093) : 0;
    const cx = Math.round(shipX);
    const cy = Math.round(shipY + passiveBob);
    const gtp = shipGunTipPos(currentShip, cx, cy);

    // Laser lines - before ship so hull covers the origin end
    for (const l of lasers) {
      if (l.style === 'seeker') {
        const age = t - l.born;
        if (age < 0 || age > l.dur + 60) continue;
        const prog = Math.min(1, age / l.dur);
        const inv = 1 - prog;
        // Translate bezier so origin tracks the live nose gun tip (fixes floating after ship recoil)
        const odx = gtp.nx - l.x0, ody = gtp.ny - l.y0;
        const ox = l.x0 + odx, oy = l.y0 + ody;
        const cpx = l.cpx + odx, cpy = l.cpy + ody;
        const ex1 = l.target && l.target.state === 'seeker-incoming' ? l.target.x : l.x1;
        const ey1 = l.target && l.target.state === 'seeker-incoming' ? l.target.y : l.y1;
        const bx = inv*inv*ox + 2*inv*prog*cpx + prog*prog*ex1;
        const by = inv*inv*oy + 2*inv*prog*cpy + prog*prog*ey1;
        const tp = Math.max(0, prog - 0.28);
        const tinv = 1 - tp;
        const trx = tinv*tinv*ox + 2*tinv*tp*cpx + tp*tp*ex1;
        const trY = tinv*tinv*oy + 2*tinv*tp*cpy + tp*tp*ey1;
        const inFlight = age <= l.dur;
        // fade in quickly at source, hold full brightness - no fade at target end
        const alpha = Math.min(1, age / (l.dur * 0.12));
        // impact phase: how far through the 55ms post-arrival window (1→0)
        const impactF = inFlight ? 0 : Math.max(0, 1 - (age - l.dur) / 55);
        // head grows in last 20% of flight, peaks on arrival
        const approachF = inFlight ? Math.max(0, (prog - 0.80) / 0.20) : 1;
        const headR = 5 + approachF * 7;
        ctx.save();
        ctx.globalAlpha = alpha;
        if (inFlight) {
          // outer glow trail
          ctx.strokeStyle = 'rgba(255,180,20,0.45)';
          ctx.lineWidth = 5;
          ctx.shadowColor = 'rgba(255,160,0,0.6)';
          ctx.shadowBlur = 18;
          ctx.beginPath(); ctx.moveTo(trx, trY); ctx.lineTo(bx, by); ctx.stroke();
          // bright core trail
          ctx.strokeStyle = '#ffee66';
          ctx.lineWidth = 2;
          ctx.shadowColor = 'rgba(255,220,60,0.9)';
          ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.moveTo(trx, trY); ctx.lineTo(bx, by); ctx.stroke();
        }
        // head / impact burst - full alpha in flight, impactF fade after arrival
        ctx.globalAlpha = inFlight ? alpha : impactF;
        ctx.fillStyle = 'rgba(255,200,60,0.85)';
        ctx.shadowColor = 'rgba(255,180,0,0.9)';
        ctx.shadowBlur = 22 + approachF * 24;
        ctx.beginPath(); ctx.arc(bx, by, headR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,220,1)';
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(bx, by, inFlight ? 2.5 : 4, 0, Math.PI * 2); ctx.fill();
        // expanding ring on arrival
        if (!inFlight) {
          const ringR = 6 + (1 - impactF) * 26;
          ctx.strokeStyle = 'rgba(255,230,100,0.9)';
          ctx.lineWidth = 1.5;
          ctx.shadowColor = 'rgba(255,200,40,0.8)';
          ctx.shadowBlur = 12;
          ctx.globalAlpha = impactF * 0.85;
          ctx.beginPath(); ctx.arc(bx, by, ringR, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      } else {
        const a = Math.max(0, 1 - (t - l.born) / 300);
        const sx = l.side === 2 ? gtp.nx : l.side === 1 ? gtp.rx : gtp.lx;
        const sy = l.side === 2 ? gtp.ny : gtp.gy;
        const [lCol, lGlow] = l.tier >= 3
          ? ['#ffdd44', 'rgba(255,200,40,0.8)']
          : l.tier === 2
          ? ['#00ddff', 'rgba(0,200,255,0.8)']
          : ['#4fffaa', 'rgba(80,255,160,0.8)'];
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = lCol;
        ctx.lineWidth = 2;
        ctx.shadowColor = lGlow;
        ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(l.x1, l.y1); ctx.stroke();
        ctx.restore();
      }
    }

    // Drone missiles (traveling) and sprite (rotated toward target)
    if (drone.state !== 'docked') {
      const dAlpha = drone.state === 'docking'
        ? Math.min(1, Math.hypot(drone.x - shipX, drone.y - shipY) / 45)
        : 1;
      const dx = Math.round(drone.x), dy = Math.round(drone.y);

      // Draw in-flight missiles
      for (const m of droneMissiles) {
        if (m.exploded) continue;
        const mAge = t - m.born;
        const mAlpha = Math.min(1, mAge / 50) * dAlpha;
        if (mAlpha <= 0) continue;
        const mAng = Math.atan2(m.vy, m.vx);
        const trailLen = 15;
        ctx.save();
        ctx.globalAlpha = mAlpha;
        ctx.strokeStyle = 'rgba(120,255,80,1)';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(80,255,50,0.85)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(m.x - Math.cos(mAng) * trailLen, m.y - Math.sin(mAng) * trailLen);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(230,255,200,0.95)';
        ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Drone sprite - always points up, engine flare at exhaust end
      ctx.save();
      ctx.globalAlpha = dAlpha;
      ctx.translate(dx, dy);
      const burstAge = t - drone.deployedAt;
      if (burstAge < 280) {
        const sc = 1 + 0.5 * Math.pow(1 - burstAge / 280, 2);
        ctx.scale(sc, sc);
      }
      const halfH = bmpH(DRONE_BMP) * DRONE_PX / 2;
      const dfl = 7 + 2 * Math.sin(t * 0.013);
      const dfg = ctx.createLinearGradient(0, halfH - 2, 0, halfH + dfl);
      dfg.addColorStop(0, 'rgba(80,220,255,0)');
      dfg.addColorStop(0.2, 'rgba(80,220,255,0.55)');
      dfg.addColorStop(1, 'rgba(40,150,255,0)');
      ctx.fillStyle = dfg;
      ctx.beginPath();
      ctx.moveTo(-2, halfH - 2);
      ctx.quadraticCurveTo(0, halfH + dfl * 0.7, 0, halfH + dfl);
      ctx.quadraticCurveTo(0, halfH + dfl * 0.7, 2, halfH - 2);
      ctx.closePath(); ctx.fill();
      drawBmp(ctx, DRONE_BMP, 0, 0, 'rgba(80,220,255,0.95)', 'rgba(60,200,255,0.5)', DRONE_PX);
      ctx.restore();
    }

    // Drone 2 missiles and sprite
    if (drone2.state !== 'docked') {
      const d2Alpha = drone2.state === 'docking'
        ? Math.min(1, Math.hypot(drone2.x - shipX, drone2.y - shipY) / 45)
        : 1;
      const d2x = Math.round(drone2.x), d2y = Math.round(drone2.y);

      for (const m of drone2Missiles) {
        if (m.exploded) continue;
        const mAge = t - m.born;
        const mAlpha = Math.min(1, mAge / 50) * d2Alpha;
        if (mAlpha <= 0) continue;
        const mAng = Math.atan2(m.vy, m.vx);
        const trailLen = 15;
        ctx.save();
        ctx.globalAlpha = mAlpha;
        ctx.strokeStyle = 'rgba(255,200,60,1)';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255,160,30,0.85)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(m.x - Math.cos(mAng) * trailLen, m.y - Math.sin(mAng) * trailLen);
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,245,200,0.95)';
        ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = d2Alpha;
      ctx.translate(d2x, d2y);
      const burst2Age = t - drone2.deployedAt;
      if (burst2Age < 280) {
        const sc = 1 + 0.5 * Math.pow(1 - burst2Age / 280, 2);
        ctx.scale(sc, sc);
      }
      const halfH2 = bmpH(DRONE2_BMP) * DRONE2_PX / 2;
      const dfl2 = 7 + 2 * Math.sin(t * 0.011);
      const dfg2 = ctx.createLinearGradient(0, halfH2 - 2, 0, halfH2 + dfl2);
      dfg2.addColorStop(0, 'rgba(255,190,60,0)');
      dfg2.addColorStop(0.2, 'rgba(255,190,60,0.55)');
      dfg2.addColorStop(1, 'rgba(255,140,30,0)');
      ctx.fillStyle = dfg2;
      ctx.beginPath();
      ctx.moveTo(-2, halfH2 - 2);
      ctx.quadraticCurveTo(0, halfH2 + dfl2 * 0.7, 0, halfH2 + dfl2);
      ctx.quadraticCurveTo(0, halfH2 + dfl2 * 0.7, 2, halfH2 - 2);
      ctx.closePath(); ctx.fill();
      drawBmp(ctx, DRONE2_BMP, 0, 0, 'rgba(255,190,60,0.95)', 'rgba(255,160,40,0.5)', DRONE2_PX);
      ctx.restore();
    }

    // Ship config for current selection
    const _SCFG = _SHIP_CONFIGS[currentShip];
    const _shipBmp = _SCFG.bmp;
    const flareBase = cy + bmpH(_shipBmp) * PX / 2 - 5;
    const _shipHW = bmpW(_shipBmp) * PX / 2, _shipHH = bmpH(_shipBmp) * PX / 2;
    shipBodyHitbox = warpState === 'none' ? { x: cx - _shipHW, y: cy - _shipHH, w: _shipHW * 2, h: _shipHH * 2 } : { x: 0, y: 0, w: 0, h: 0 };
    const ft = t * 0.005;

    // Descent streak (landing) and launch streak (departing)
    if (carrierState !== 'none' && warpState === 'none') {
      if ((carrierState === 'arriving' || carrierState === 'present') && shipPowerState === 'down') {
        const _dockY = carrierRestY;
        const _descTotal = _dockY - H * 0.65;
        const _descProg = _descTotal > 0 ? Math.min(1, (shipY - H * 0.65) / _descTotal) : 0;
        // Fade out when within 30px of dock to kill the trail on arrival
        const _dockFade = Math.min(1, Math.abs(shipY - _dockY) / 30);
        const _sa = Math.min(0.55, _descProg) * _dockFade;
        if (_sa > 0.02) {
          for (let si = 1; si <= 4; si++) {
            ctx.save();
            ctx.globalAlpha = _sa * (1 - si / 5) * 0.45;
            drawBmp(ctx, _shipBmp, cx, cy - si * 11, _SCFG.dimColor, null, PX);
            ctx.restore();
          }
        }
      }
      if (carrierState === 'leaving' && t - launchAt < LAUNCH_BOOST_DUR) {
        const _lp = (t - launchAt) / LAUNCH_BOOST_DUR;
        const _la = Math.pow(1 - _lp, 0.7);
        for (let si = 1; si <= 4; si++) {
          ctx.save();
          ctx.globalAlpha = _la * (1 - si / 5) * 0.45;
          drawBmp(ctx, _shipBmp, cx, cy + si * 16 * _la, _SCFG.color, null, PX);
          ctx.restore();
        }
      }
    }

    if (warpState !== 'none') {
      // ── Warp animation ────────────────────────────────────
      const wdur = warpState === 'out' ? WARP_OUT_DUR : WARP_IN_DUR;
      const wp = Math.min(1, (t - warpAt) / wdur);
      ctx.save();
      ctx.translate(cx, cy);
      if (warpState === 'out') {
        const p1 = Math.min(1, wp / 0.45);
        const p2 = Math.max(0, (wp - 0.40) / 0.60);
        const scX = Math.max(0.07, 1 - p1 * 0.93);
        const offY = -p2 * (H + 300);

        // Departure flash - bright radial bloom at ignition
        if (wp < 0.35) {
          const fp = 1 - wp / 0.35;
          const fr = 18 + wp * 560;
          const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, fr);
          fg.addColorStop(0,    `rgba(255,255,255,${fp.toFixed(2)})`);
          fg.addColorStop(0.12, `rgba(210,228,255,${(fp * 0.85).toFixed(2)})`);
          fg.addColorStop(0.4,  `rgba(195,208,240,${(fp * 0.35).toFixed(2)})`);
          fg.addColorStop(1,    'rgba(195,208,240,0)');
          ctx.fillStyle = fg;
          ctx.beginPath(); ctx.arc(0, 0, fr, 0, Math.PI * 2); ctx.fill();
        }

        // Shockwave ring - expands outward and fades
        if (wp < 0.55) {
          const rp = wp / 0.55;
          const rr = 10 + rp * 260;
          const ra = Math.max(0, 1 - rp);
          ctx.save();
          ctx.strokeStyle = `rgba(185,212,255,${(ra * 0.9).toFixed(2)})`;
          ctx.lineWidth = Math.max(0.5, 2.5 - rp * 2);
          ctx.shadowColor = 'rgba(160,200,255,0.9)';
          ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }

        // Streak trail - three layers: outer glow, mid, core
        if (p1 > 0.25) {
          const tlen = 80 + p1 * 340;
          const top  = p1 * 0.88;
          const sg0 = ctx.createLinearGradient(0, offY, 0, offY + tlen);
          sg0.addColorStop(0, `rgba(195,208,240,${(top * 0.42).toFixed(2)})`);
          sg0.addColorStop(1, 'rgba(195,208,240,0)');
          ctx.fillStyle = sg0; ctx.fillRect(-16, offY, 32, tlen);

          const sg1 = ctx.createLinearGradient(0, offY, 0, offY + tlen);
          sg1.addColorStop(0, `rgba(215,228,255,${(top * 0.68).toFixed(2)})`);
          sg1.addColorStop(1, 'rgba(215,225,248,0)');
          ctx.fillStyle = sg1; ctx.fillRect(-6, offY, 12, tlen);

          const sg2 = ctx.createLinearGradient(0, offY, 0, offY + tlen);
          sg2.addColorStop(0, `rgba(245,248,255,${top.toFixed(2)})`);
          sg2.addColorStop(1, 'rgba(240,244,255,0)');
          ctx.fillStyle = sg2; ctx.fillRect(-2, offY, 4, tlen);
        }

        ctx.save();
        ctx.translate(0, offY);
        ctx.scale(scX, 1 + p1 * 7.5);
        const wa = p2 > 0.3 ? Math.max(0, 1 - (p2 - 0.3) / 0.7) : 1;
        const wGlow = p1 > 0.25 ? _SCFG.glow.replace(/[\d.]+\)$/, `${Math.min(0.95, p1).toFixed(2)})`) : _SCFG.glow;
        drawBmp(ctx, _shipBmp, 0, 0, _SCFG.color.replace(/[\d.]+\)$/, `${wa.toFixed(2)})`), wGlow, PX);
        ctx.restore();
      } else {
        // warp-in
        const p1 = Math.min(1, wp / 0.50);
        const p2 = Math.max(0, (wp - 0.40) / 0.55);
        // Incoming streak from bottom
        if (p1 < 1) {
          const streakY = (1 - p1) * (H + 250);
          const tlen = 80 + p1 * 80;
          const sg = ctx.createLinearGradient(0, streakY, 0, streakY + tlen);
          sg.addColorStop(0, `rgba(195,208,240,${(0.5 + p1 * 0.4).toFixed(2)})`);
          sg.addColorStop(1, 'rgba(170,190,235,0)');
          ctx.fillStyle = sg; ctx.fillRect(-2, streakY, 4, tlen);
        }
        // Ship materializes
        if (p2 > 0) {
          const scX2 = Math.min(1, p2 / 0.55);
          const scY2 = Math.max(1, 4 - p2 * 4.5);
          const wa2 = Math.min(1, p2 * 1.4).toFixed(2);
          ctx.save();
          ctx.scale(Math.max(0.08, scX2), Math.max(1, scY2));
          drawBmp(ctx, _shipBmp, 0, 0, _SCFG.color.replace(/[\d.]+\)$/, `${wa2})`), _SCFG.glow, PX);
          ctx.restore();
        }
      }
      ctx.restore();
    } else if (shipPowerState === 'down') {
      drawBmp(ctx, _shipBmp, cx, cy, _SCFG.dimColor, null, PX);
    } else if (shipPowerState === 'powerdown') {
      const sp = Math.max(0, 1 - (t - powerdownAt) / POWERDOWN_DUR);
      const flicker = sp < 0.55
        ? Math.abs(Math.sin(t * 0.045)) * Math.abs(Math.sin(t * 0.011 + 1.3))
        : 1;
      const sa = 0.22 + sp * 0.73;
      const pdCol  = _SCFG.color.replace(/[\d.]+\)$/, `${sa.toFixed(3)})`);
      const pdGlow = sp > 0.35 ? _SCFG.glow : null;
      drawBmp(ctx, _shipBmp, cx, cy, pdCol, pdGlow, PX);
      ctx.save();
      ctx.globalAlpha = Math.max(0, flicker * sp);
      for (const f of _SCFG.flares) drawEngineFlare(cx + f.xOff, flareBase + f.yOff, ft, f.size, (f.len ?? f.size), (f.taper ?? 0.6), (f.shape ?? 'arch'), (f.wobble ?? 1));
      ctx.restore();
    } else if (shipPowerState === 'startup') {
      const sp = Math.min(1, (t - startupAt) / STARTUP_DUR);
      const burstBase = sp < 0.20 ? 2.5 * (1 - sp / 0.20) : 0;
      const flicker = sp > 0.20 && sp < 0.48
        ? Math.abs(Math.sin(t * 0.045)) * Math.abs(Math.sin(t * 0.011 + 1.3))
        : 1;
      const sa = 0.22 + sp * 0.73;
      const suCol  = _SCFG.color.replace(/[\d.]+\)$/, `${sa.toFixed(3)})`);
      const suGlow = sp > 0.35 ? _SCFG.glow : null;
      drawBmp(ctx, _shipBmp, cx, cy, suCol, suGlow, PX);
      ctx.save();
      ctx.globalAlpha = sp < 0.20 ? sp / 0.20 : Math.min(1, flicker);
      for (const f of _SCFG.flares) { const fbW = 1 + burstBase * (f.burstWScale ?? (f.burstScale ?? 1)); const fbL = 1 + burstBase * (f.burstScale ?? 1); drawEngineFlare(cx + f.xOff, flareBase + f.yOff, ft, f.size * fbW, (f.len ?? f.size) * fbL, (f.taper ?? 0.6), (f.shape ?? 'arch'), (f.wobble ?? 1)); }
      ctx.restore();
    } else {
      const _launchBoost = (carrierState === 'leaving' && t - launchAt < LAUNCH_BOOST_DUR)
        ? Math.pow(1 - (t - launchAt) / LAUNCH_BOOST_DUR, 0.6) : 0;
      const idleWScale      = (1 - idleBlend * 0.50);
      const idleEngineAlpha = Math.min(1, (1 - idleBlend * (0.45 - 0.12 * Math.abs(Math.sin(t * 0.0018)))) + _launchBoost * 0.4);
      if (_launchBoost > 0) {
        // Exhaust plume - wide downward blast cone below ship
        const _pl = _launchBoost * 95;
        const _pw = _launchBoost * 28;
        const pg = ctx.createLinearGradient(cx, flareBase, cx, flareBase + _pl);
        pg.addColorStop(0, `rgba(160,200,255,${(_launchBoost * 0.75).toFixed(2)})`);
        pg.addColorStop(0.25, `rgba(100,150,255,${(_launchBoost * 0.45).toFixed(2)})`);
        pg.addColorStop(1, 'rgba(60,100,220,0)');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.moveTo(cx - _pw * 0.3, flareBase);
        ctx.quadraticCurveTo(cx - _pw, flareBase + _pl * 0.6, cx - _pw * 0.5, flareBase + _pl);
        ctx.quadraticCurveTo(cx, flareBase + _pl * 1.05, cx + _pw * 0.5, flareBase + _pl);
        ctx.quadraticCurveTo(cx + _pw, flareBase + _pl * 0.6, cx + _pw * 0.3, flareBase);
        ctx.closePath(); ctx.fill();
      }
      drawBmp(ctx, _shipBmp, cx, cy, _SCFG.color, _SCFG.glow, PX);
      ctx.save();
      ctx.globalAlpha = idleEngineAlpha;
      for (const f of _SCFG.flares) { const fes = idleWScale * (1 + _launchBoost * 2.8 * (f.burstScale ?? 1)); drawEngineFlare(cx + f.xOff, flareBase + f.yOff, ft, f.size * idleWScale, (f.len ?? f.size) * fes, (f.taper ?? 0.6), (f.shape ?? 'arch'), (f.wobble ?? 1)); }
      ctx.restore();
    }

    // Muzzle flash and gun checks - skip during warp
    if (warpState === 'none') {
      for (const gl of lasers) {
        const glAge = t - gl.born;
        if (glAge < 0 || glAge >= 120) continue;
        const fx = gl.style === 'seeker' ? gl.x0 : gl.side === 2 ? gtp.nx : gl.side === 1 ? gtp.rx : gtp.lx;
        const fy = gl.style === 'seeker' ? gl.y0 : gl.side === 2 ? gtp.ny : gtp.gy;
        const [fCol, fGlow] = gl.tier >= 3
          ? ['rgba(255,220,70,0.9)',  'rgba(255,195,30,0.7)']
          : gl.tier === 2
          ? ['rgba(0,220,255,0.9)',   'rgba(0,200,255,0.7)']
          : ['rgba(100,255,175,0.9)', 'rgba(100,255,175,0.7)'];
        ctx.fillStyle = fCol;
        ctx.shadowColor = fGlow;
        ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (shipPowerState === 'startup' && gunCheckState > 0) {
        const gtp2 = shipGunTipPos(currentShip, cx, cy);
        for (let gi = 0; gi < 2; gi++) {
          if (gunCheckState <= gi) continue;
          const age = t - gunCheckFiredAt[gi];
          if (age < 0 || age > GUN_CHECK_DUR) continue;
          const a = Math.max(0, 1 - age / GUN_CHECK_DUR);
          const gx = gi === 0 ? gtp2.lx : gtp2.rx;
          const r = 4 + 8 * (1 - a);
          ctx.save();
          ctx.globalAlpha = a * 0.9;
          ctx.strokeStyle = 'rgba(100,255,175,1)';
          ctx.lineWidth = 1.5;
          ctx.shadowColor = 'rgba(80,255,160,0.8)';
          ctx.shadowBlur = 14;
          ctx.beginPath(); ctx.arc(gx, gtp2.gy, r, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(180,255,220,0.95)';
          ctx.shadowBlur = 6;
          ctx.beginPath(); ctx.arc(gx, gtp2.gy, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }

    // ── Ship easter-egg speech bubble ──────────────────────────
    if (shipQuote) {
      const _qAge = t - shipQuote.shownAt;
      const _qTotal = 3500, _qFadeIn = 100, _qFadeStart = 3000;
      if (_qAge > _qTotal) {
        shipQuote = null;
        shipQuoteCooldown = performance.now() + 800;
      } else {
        const _qA = _qAge < _qFadeIn ? _qAge / _qFadeIn : _qAge > _qFadeStart ? 1 - (_qAge - _qFadeStart) / (_qTotal - _qFadeStart) : 1;
        ctx.save();
        ctx.globalAlpha = _qA;
        const _qFont = 9;
        ctx.font = `${_qFont}px "Press Start 2P", monospace`;
        const _qMaxW = Math.min(200, W - 40);
        const _qWords = shipQuote.text.split(' ');
        const _qLines = [];
        let _qCur = '';
        for (const _qW of _qWords) {
          const _qTest = _qCur ? _qCur + ' ' + _qW : _qW;
          if (ctx.measureText(_qTest).width > _qMaxW && _qCur) { _qLines.push(_qCur); _qCur = _qW; }
          else _qCur = _qTest;
        }
        if (_qCur) _qLines.push(_qCur);
        const _qLineH = _qFont + 9;
        const _qBY = cy - _shipHH - 14;
        ctx.fillStyle = 'rgba(215,225,248,0.95)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        for (let _qi = 0; _qi < _qLines.length; _qi++) {
          ctx.fillText(_qLines[_qi], cx, _qBY - (_qLines.length - 1 - _qi) * _qLineH);
        }
        ctx.restore();
      }
    }

    // ── HUD Strip ────────────────────────────────────────────
    ctx.save();
    ctx.translate(shakeSx, shakeSy);
    ctx.globalAlpha = 0.62;

    // Responsive layout: panel widths scale with viewport, STATS gets the remainder
    const SH = hudSH;
    const SY = H - SH - safeBottom;
    const INT_W  = Math.min(240, Math.max(150, Math.round(W * 0.30)));
    const OPT_W  = W < 480 ? 0   : Math.min(140, Math.max(95,  Math.round(W * 0.16)));
    const TDB_W  = Math.min(250, Math.max(140, Math.round(W * 0.28)));
    const TDB_X  = W - TDB_W - OPT_W;
    const INTEL_X = INT_W, OPT_X = W - OPT_W;
    const INTEL_W = Math.max(0, TDB_X - INT_W);

    // Scaled fonts
    const _fs = W < 480 ? 0.75 : W < 660 ? 0.87 : 1;
    const _fVal   = Math.max(9,  Math.round(15 * _fs));
    const _fSub   = Math.max(7,  Math.round(10 * _fs));
    const _fLabel = _fs < 1 ? 7 : 9;
    const _fShip  = Math.max(8,  Math.round(12 * _fs));

    // Scaled Y anchors (proportional to strip height)
    const _yLabel = SY + Math.round(SH * 0.185);
    const _yVal   = SY + Math.round(SH * 0.574);
    const _ySub   = SY + Math.round(SH * 0.745);

    // Background
    ctx.fillStyle = 'rgba(8,11,16,0.80)';
    ctx.fillRect(0, SY, W, SH);
    // Inner glow at top edge (cached - changes only on resize)
    const _glowH = Math.round(SH * 0.28);
    if (_hudGlowGradSY !== SY) {
      _hudGlowGrad = ctx.createLinearGradient(0, SY, 0, SY + _glowH);
      _hudGlowGrad.addColorStop(0, 'rgba(140,160,175,0.07)'); _hudGlowGrad.addColorStop(1, 'rgba(140,160,175,0)');
      _hudGlowGradSY = SY;
    }
    ctx.fillStyle = _hudGlowGrad; ctx.fillRect(0, SY + 1, W, _glowH - 1);

    // Bracket corners on outer strip + module divider tick marks
    const _arm = Math.round(18 * SH / 108);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(140,160,175,0.42)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(_arm, SY);     ctx.lineTo(0, SY);     ctx.lineTo(0, SY + _arm);
    ctx.moveTo(W - _arm, SY); ctx.lineTo(W, SY);     ctx.lineTo(W, SY + _arm);
    ctx.moveTo(0, SY + SH - _arm); ctx.lineTo(0, SY + SH); ctx.lineTo(_arm, SY + SH);
    ctx.moveTo(W, SY + SH - _arm); ctx.lineTo(W, SY + SH); ctx.lineTo(W - _arm, SY + SH);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(140,160,175,0.18)'; ctx.lineWidth = 1.5;
    const _dividers = OPT_W > 0 ? [INT_W, TDB_X, OPT_X] : [INT_W, TDB_X];
    for (const _dx of _dividers) {
      ctx.beginPath();
      ctx.moveTo(_dx, SY);         ctx.lineTo(_dx, SY + _arm);
      ctx.moveTo(_dx, SY + SH);    ctx.lineTo(_dx, SY + SH - _arm);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    const _modLabel = (text, x, align = 'left') => {
      ctx.font = `${_fLabel}px "Press Start 2P", monospace`;
      ctx.textAlign = align; ctx.fillStyle = 'rgba(65,165,200,0.38)';
      ctx.fillText(text, x, _yLabel);
    };
    const _fmtN = n => n == null ? '—' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e4 ? (n/1e3).toFixed(2)+'K' : String(n);

    // ── INTERCEPT ──────────────────────────────────────────
    ctx.save();
    ctx.beginPath(); ctx.rect(0, SY, INT_W, SH); ctx.clip();
    _modLabel('INTERCEPT', INT_W / 2, 'center');
    let shieldStr, shieldColor, shieldGlowColor = null;
    if (blockingEnabled === null) {
      shieldStr = 'STANDBY'; shieldColor = 'rgba(150,150,150,0.35)';
    } else if (shipPowerState === 'powerdown') {
      const sp = Math.max(0, 1 - (t - powerdownAt) / POWERDOWN_DUR);
      const f = 0.5 + 0.5 * Math.abs(Math.sin(t * 0.012));
      shieldStr = 'POWERING DOWN';
      shieldColor = `rgba(255,160,50,${(0.45 + 0.4 * sp * f).toFixed(2)})`;
    } else if (blockingEnabled === false) {
      shieldStr = 'OFFLINE';
      shieldColor = 'rgba(255,80,60,0.90)'; shieldGlowColor = 'rgba(255,80,60,0.35)';
    } else if (shipPowerState === 'startup') {
      const sp = (t - startupAt) / STARTUP_DUR;
      if (sp > 0.72) {
        const f = 0.6 + 0.4 * Math.abs(Math.sin(t * 0.016));
        shieldStr = 'ONLINE';
        shieldColor = `rgba(50,215,120,${(0.55 + 0.45 * f).toFixed(2)})`;
        shieldGlowColor = `rgba(50,215,120,${(f * 0.45).toFixed(2)})`;
      } else {
        shieldStr = 'STARTING...';
        shieldColor = `rgba(210,200,70,${(0.4 + 0.3 * Math.abs(Math.sin(t * 0.009))).toFixed(2)})`;
      }
    } else {
      shieldStr = 'ACTIVE';
      shieldColor = shieldHovered ? 'rgba(50,215,120,0.95)' : 'rgba(50,215,120,0.75)';
      shieldGlowColor = shieldHovered ? 'rgba(50,215,120,0.35)' : null;
    }
    ctx.textAlign = 'center';
    ctx.font = `${_fVal}px "Press Start 2P", monospace`;
    if (shieldGlowColor) { ctx.shadowColor = shieldGlowColor; ctx.shadowBlur = 8; }
    ctx.fillStyle = shieldColor;
    ctx.fillText(shieldStr, INT_W / 2, _yVal);
    const _shieldTW = ctx.measureText(shieldStr).width;
    ctx.shadowBlur = 0;
    const _hasTimer = blockingEnabled === false && blockingDuration > 0;
    if (_hasTimer) {
      const remSec = Math.max(0, Math.ceil((blockingDuration - (t - blockingOffAt)) / 1000));
      const mins = Math.floor(remSec / 60), secs = remSec % 60;
      ctx.font = `${_fSub}px "Press Start 2P", monospace`;
      ctx.fillStyle = 'rgba(255,100,80,0.65)';
      ctx.fillText(`${mins}:${String(secs).padStart(2,'0')}`, INT_W / 2, _ySub);
    }
    {
      const _pad = 10;
      const _hbW = _shieldTW + _pad * 2;
      const _hbH = _hasTimer ? Math.round(SH * 0.39) : Math.round(SH * 0.24);
      shieldHitbox = { x: INT_W / 2 - _hbW / 2, y: SY + Math.round(SH * 0.42), w: _hbW, h: _hbH };
    }
    ctx.restore();

    // Disable menu - opens upward, bracket-outline style
    if (shieldMenuOpen) {
      const mw = 150, mItemH = 26, mPad = 8;
      const mh = DISABLE_OPTIONS.length * mItemH + mPad * 2;
      const menuX = Math.max(0, Math.min(W - mw, Math.round(INT_W / 2 - mw / 2))), menuY = SY - mh - 6;
      ctx.fillStyle = 'rgba(8,11,16,0.92)';
      ctx.fillRect(menuX, menuY, mw, mh);
      const _menuGlow = ctx.createLinearGradient(0, menuY, 0, menuY + 24);
      _menuGlow.addColorStop(0, 'rgba(140,160,175,0.07)'); _menuGlow.addColorStop(1, 'rgba(140,160,175,0)');
      ctx.fillStyle = _menuGlow; ctx.fillRect(menuX, menuY + 1, mw, 24);
      const _ma = 14;
      ctx.strokeStyle = 'rgba(140,160,175,0.42)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(menuX + _ma, menuY);        ctx.lineTo(menuX, menuY);        ctx.lineTo(menuX, menuY + _ma);
      ctx.moveTo(menuX + mw - _ma, menuY);   ctx.lineTo(menuX + mw, menuY);   ctx.lineTo(menuX + mw, menuY + _ma);
      ctx.moveTo(menuX, menuY + mh - _ma);   ctx.lineTo(menuX, menuY + mh);   ctx.lineTo(menuX + _ma, menuY + mh);
      ctx.moveTo(menuX + mw, menuY + mh - _ma); ctx.lineTo(menuX + mw, menuY + mh); ctx.lineTo(menuX + mw - _ma, menuY + mh);
      ctx.stroke();
      ctx.font = `${_fSub}px "Press Start 2P", monospace`;
      shieldMenuPopupBox = { x: menuX, y: menuY, w: mw, h: mh };
      shieldMenuItems = DISABLE_OPTIONS.map((opt, idx) => {
        const iy = menuY + mPad + idx * mItemH;
        const hb = { x: menuX, y: iy, w: mw, h: mItemH };
        const hov = mouseX >= hb.x && mouseX <= hb.x + hb.w && mouseY >= hb.y && mouseY <= hb.y + hb.h;
        if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
        ctx.textAlign = 'left';
        ctx.fillStyle = hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
        ctx.fillText(opt.label, menuX + 14, iy + 18);
        return { ...opt, hitbox: hb };
      });
    } else {
      shieldMenuItems = [];
      shieldMenuPopupBox = null;
    }

    // ── Settings menu - opens upward from bottom-left, bracket-outline style ──
    if (settingsMenuOpen) {
      const _sitems = [
        { key: 'friendlies', label: 'FRIENDLIES', state: showFriendlies, divAfter: true },
        { key: 'client',     label: 'CLIENT',      state: showClient },
        { key: 'domain',     label: 'DOMAIN',     state: showDomain },
      ];
      const smw = 186, smItemH = 28, smPad = 10, smDivH = 10, smPhRowH = 34;
      const smh = smPad + smItemH + smDivH + smItemH * 2 + smDivH + smPhRowH + smPad;
      const smX = 6, smY = SY - smh - 6;
      settingsMenuPopupBox = { x: smX, y: smY, w: smw, h: smh };
      ctx.fillStyle = 'rgba(8,11,16,0.92)';
      ctx.fillRect(smX, smY, smw, smh);
      const _smGlow = ctx.createLinearGradient(0, smY, 0, smY + 24);
      _smGlow.addColorStop(0, 'rgba(140,160,175,0.07)'); _smGlow.addColorStop(1, 'rgba(140,160,175,0)');
      ctx.fillStyle = _smGlow; ctx.fillRect(smX, smY + 1, smw, 24);
      const _sma = 14;
      ctx.strokeStyle = 'rgba(140,160,175,0.42)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(smX + _sma, smY);         ctx.lineTo(smX, smY);         ctx.lineTo(smX, smY + _sma);
      ctx.moveTo(smX + smw - _sma, smY);   ctx.lineTo(smX + smw, smY);   ctx.lineTo(smX + smw, smY + _sma);
      ctx.moveTo(smX, smY + smh - _sma);   ctx.lineTo(smX, smY + smh);   ctx.lineTo(smX + _sma, smY + smh);
      ctx.moveTo(smX + smw, smY + smh - _sma); ctx.lineTo(smX + smw, smY + smh); ctx.lineTo(smX + smw - _sma, smY + smh);
      ctx.stroke();
      let siy = smY + smPad;
      settingsMenuItems = [];
      ctx.font = `${_fSub}px "Press Start 2P", monospace`;
      for (const item of _sitems) {
        const hb = { x: smX, y: siy, w: smw, h: smItemH };
        // Row label (static, no row-level hover)
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(175,200,238,0.65)';
        ctx.fillText(item.label, smX + 12, siy + 19);
        // Toggle switch (track + sliding knob); hover state on pill only
        const pillW = 36, pillH = 14, pillX = smX + smw - 12 - pillW, pillY = siy + (smItemH - pillH) / 2;
        const pillHov = mouseX >= pillX && mouseX <= pillX + pillW && mouseY >= pillY && mouseY <= pillY + pillH;
        const knobSz = 10, knobPad = 2;
        const knobX = item.state ? pillX + pillW - knobSz - knobPad : pillX + knobPad;
        const knobY = pillY + (pillH - knobSz) / 2;
        ctx.fillStyle = item.state ? 'rgba(50,215,120,0.22)' : 'rgba(30,32,40,0.55)';
        ctx.fillRect(pillX, pillY, pillW, pillH);
        ctx.strokeStyle = item.state
          ? (pillHov ? 'rgba(80,240,150,0.95)' : 'rgba(50,215,120,0.60)')
          : (pillHov ? 'rgba(130,135,150,0.85)' : 'rgba(85,88,100,0.50)');
        ctx.lineWidth = 1; ctx.lineCap = 'butt';
        ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1);
        ctx.fillStyle = item.state
          ? (pillHov ? 'rgba(80,240,150,1)'     : 'rgba(50,215,120,0.95)')
          : (pillHov ? 'rgba(135,140,155,0.90)' : 'rgba(95,100,115,0.75)');
        ctx.fillRect(knobX, knobY, knobSz, knobSz);
        settingsMenuItems.push({ key: item.key, hitbox: { x: pillX - 4, y: pillY - 6, w: pillW + 8, h: pillH + 12 } });
        siy += smItemH;
        if (item.divAfter) {
          ctx.strokeStyle = 'rgba(140,160,175,0.14)'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(smX + 10, siy + smDivH / 2); ctx.lineTo(smX + smw - 10, siy + smDivH / 2);
          ctx.stroke();
          siy += smDivH;
        }
      }
      // Divider before pihole row
      ctx.strokeStyle = 'rgba(140,160,175,0.14)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(smX + 10, siy + smDivH / 2); ctx.lineTo(smX + smw - 10, siy + smDivH / 2);
      ctx.stroke();
      siy += smDivH;
      // Pi-hole admin link row
      {
        const phHb = { x: smX, y: siy, w: smw, h: smPhRowH };
        const phHov = mouseX >= phHb.x && mouseX <= phHb.x + phHb.w && mouseY >= phHb.y && mouseY <= phHb.y + phHb.h;
        if (phHov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(phHb.x, phHb.y, phHb.w, phHb.h); }
        // Pi-hole icon
        const iconH = smPhRowH - 8, iconW = Math.round(iconH * 90 / 130);
        const iconX = smX + 12, iconY = siy + (smPhRowH - iconH) / 2;
        if (_phIcon.complete && _phIcon.naturalWidth > 0) {
          ctx.save();
          ctx.globalAlpha = phHov ? 0.88 : 0.45;
          ctx.drawImage(_phIcon, iconX, iconY, iconW, iconH);
          ctx.restore();
        }
        // Label
        ctx.textAlign = 'left';
        ctx.font = `${_fSub}px "Press Start 2P", monospace`;
        ctx.fillStyle = phHov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.55)';
        ctx.fillText('PI-HOLE', iconX + iconW + 12, siy + smPhRowH / 2 + 6);
        // External link arrow drawn with lines
        const _ax = smX + smw - 14, _ay = siy + smPhRowH / 2;
        ctx.strokeStyle = phHov ? 'rgba(215,225,248,0.70)' : 'rgba(140,160,175,0.32)';
        ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(_ax - 5, _ay + 4); ctx.lineTo(_ax + 4, _ay - 4);
        ctx.moveTo(_ax - 1, _ay - 4); ctx.lineTo(_ax + 4, _ay - 4); ctx.lineTo(_ax + 4, _ay + 1);
        ctx.stroke();
        settingsMenuItems.push({ key: 'pihole-link', hitbox: phHb });
      }
    } else {
      settingsMenuItems = [];
      settingsMenuPopupBox = null;
    }

    // ── INTEL ──────────────────────────────────────────────
    // Column thresholds scale with _fSub so "intercept" (9 chars) always fits its cell.
    // 2-col: need cell ≥ ~9 * _fSub * 0.75 + 8px padding  → 15 * _fSub per cell × 2
    // 4-col: same logic × 4
    if (INTEL_W >= 50) {
      const _i2Min = 15 * _fSub, _i4Min = 33 * _fSub;
      const hsBlocked = hudStats.blocked;
      const hsAllowed = hudStats.queries != null && hudStats.blocked != null ? hudStats.queries - hudStats.blocked : null;
      const hsTotal = hudStats.queries;
      const pct = hudStats.percent;
      const _pctColor = pct == null ? 'rgba(150,150,150,0.50)' : pct >= 60 ? 'rgba(50,215,120,0.85)' : pct >= 40 ? 'rgba(210,220,70,0.85)' : 'rgba(255,110,50,0.85)';
      const _pctVal = pct != null ? pct.toFixed(1)+'%' : '—';
      const intelCols = INTEL_W >= _i4Min
        ? [
            { val: _fmtN(hsTotal),   label: 'total',     color: 'rgba(100,155,220,0.80)' },
            { val: _fmtN(hsBlocked), label: 'blocked',   color: 'rgba(255,70,60,0.90)'   },
            { val: _fmtN(hsAllowed), label: 'allowed',   color: 'rgba(50,215,120,0.90)'  },
            { val: _pctVal,          label: 'intercept', color: _pctColor },
          ]
        : INTEL_W >= _i2Min
        ? [
            { val: _fmtN(hsBlocked), label: 'blocked',   color: 'rgba(255,70,60,0.90)' },
            { val: _pctVal,          label: 'intercept', color: _pctColor },
          ]
        : [
            { val: _fmtN(hsBlocked), label: 'blocked', color: 'rgba(255,70,60,0.90)' },
          ];
      if (INTEL_W >= _i4Min) _modLabel('STATS', INTEL_X + INTEL_W / 2, 'center');
      ctx.save();
      ctx.beginPath(); ctx.rect(INTEL_X, SY, INTEL_W, SH); ctx.clip();
      const cellW = INTEL_W / intelCols.length;
      intelCols.forEach(({ val, label, color }, i) => {
        const icx = INTEL_X + cellW * i + cellW / 2;
        ctx.textAlign = 'center';
        ctx.font = `${_fVal}px "Press Start 2P", monospace`;
        ctx.fillStyle = color;
        ctx.fillText(val, icx, _yVal);
        ctx.font = `${_fSub}px "Press Start 2P", monospace`;
        ctx.fillStyle = 'rgba(70,130,165,0.45)';
        ctx.fillText(label, icx, _ySub);
      });
      ctx.restore();
    }

    // ── GRAVITY ────────────────────────────────────────────
    ctx.save();
    ctx.beginPath(); ctx.rect(TDB_X, SY, TDB_W, SH); ctx.clip();
    _modLabel('GRAVITY', TDB_X + TDB_W / 2, 'center');
    let sigsStr, sigsColor = 'rgba(100,160,210,0.65)';
    if (gravityState === 'updating') {
      sigsStr = 'UPDATING';
      sigsColor = `rgba(255,190,50,${(0.65 + 0.35 * Math.sin(t * 0.006)).toFixed(2)})`;
    } else {
      sigsStr = hudGravity == null ? '—' : hudGravity >= 1e6 ? (hudGravity/1e6).toFixed(3)+'M' : hudGravity >= 1e3 ? (hudGravity/1e3).toFixed(3)+'K' : String(hudGravity);
      if (gravityState === 'done') {
        const age = t - gravityDoneAt;
        const flash = Math.max(0, 1 - age / 1200);
        if (flash > 0.01) sigsColor = `rgba(50,215,120,${(0.65 + 0.35 * flash).toFixed(2)})`;
        if (age > 1500) gravityState = 'idle';
      }
    }
    ctx.textAlign = 'center';
    ctx.font = `${_fVal}px "Press Start 2P", monospace`;
    ctx.fillStyle = sigsColor;
    ctx.fillText(sigsStr, TDB_X + TDB_W / 2, _yVal);
    ctx.font = `${_fSub}px "Press Start 2P", monospace`;
    ctx.fillStyle = 'rgba(70,130,165,0.45)';
    ctx.fillText('known threats', TDB_X + TDB_W / 2, _ySub);
    // Update arrow - left side of section
    const _aW = bmpW(ARROW_DOWN_BMP) * ARROW_PX;
    const _aX = TDB_X + Math.round(30 * SH / 108), _aY = SY + Math.round(SH * 0.48);
    let arrowCol = arrowHovered ? 'rgba(255,190,50,0.95)' : 'rgba(100,160,210,0.55)';
    let arrowGlw = arrowHovered ? 'rgba(255,190,50,0.50)' : null;
    if (gravityState === 'updating') {
      const p = (0.65 + 0.35 * Math.sin(t * 0.008)).toFixed(2);
      arrowCol = `rgba(255,190,50,${p})`; arrowGlw = 'rgba(255,190,50,0.35)';
      drawBmp(ctx, ARROW_DOWN_BMP, _aX, _aY + Math.round(Math.max(0, Math.sin(t * 0.005)) * 2), arrowCol, arrowGlw, ARROW_PX);
    } else {
      if (gravityState === 'done') {
        const flash = Math.max(0, 1 - (t - gravityDoneAt) / 1200);
        if (flash > 0.01) { arrowCol = `rgba(50,215,120,${(0.5+0.5*flash).toFixed(2)})`; arrowGlw = `rgba(50,215,120,${(flash*0.4).toFixed(2)})`; }
      }
      drawBmp(ctx, ARROW_DOWN_BMP, _aX, _aY, arrowCol, arrowGlw, ARROW_PX);
    }
    arrowHitbox = { x: _aX - _aW / 2 - 4, y: _aY - 14, w: _aW + 8, h: 28 };
    ctx.restore();

    // ── SHIPS / OPTIONS ────────────────────────────────────
    const _canSelectShip = blockingEnabled === true && shipPowerState === 'up' && warpState === 'none';
    const _shipLabels = { protector: 'PROTECTOR', falcon: 'FALCON', swordfish: 'SWORDFISH', enterprise: 'ENTERPRISE' };
    if (OPT_W > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(OPT_X, SY, OPT_W, SH); ctx.clip();
      _modLabel('SHIPS', OPT_X + OPT_W / 2, 'center');
      ctx.textAlign = 'center';
      ctx.font = `${_fShip}px "Press Start 2P", monospace`;
      ctx.fillStyle = shipMenuHovered && _canSelectShip ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
      ctx.fillText(_shipLabels[currentShip], OPT_X + OPT_W / 2, _yVal);
      ctx.font = `${_fLabel}px "Press Start 2P", monospace`;
      ctx.fillStyle = _canSelectShip ? 'rgba(175,200,238,0.32)' : 'rgba(80,80,80,0.28)';
      ctx.fillText(_canSelectShip ? 'SELECT' : '—', OPT_X + OPT_W / 2, _ySub);
      shipMenuHitbox = { x: OPT_X, y: SY, w: OPT_W, h: SH };
      ctx.restore();
    } else {
      shipMenuHitbox = { x: 0, y: 0, w: 0, h: 0 };
    }

    // Ship selector popup - opens upward from OPTIONS
    // Layout: 1×4 row on wide screens, 2×2 grid on compact screens
    if (shipMenuOpen && _canSelectShip && OPT_W > 0) {
      const _ships = ['protector', 'falcon', 'swordfish', 'enterprise'];
      const _sBmps  = { protector: PROTECTOR_BMP, falcon: FALCON_BMP, swordfish: SWORDFISH_BMP, enterprise: ENTERPRISE_BMP };
      const _sCols  = { protector: 'rgba(195,208,240,0.85)', falcon: 'rgba(195,208,240,0.85)', swordfish: 'rgba(207,50,33,0.85)', enterprise: 'rgba(195,208,240,0.85)' };
      const _sGlows = { protector: 'rgba(170,190,235,0.32)', falcon: 'rgba(170,190,235,0.32)', swordfish: 'rgba(203,38,20,0.32)', enterprise: 'rgba(170,190,235,0.32)' };
      const _grid2x2 = W < 660;
      const _cols = _grid2x2 ? 2 : 4;
      const _rows = _grid2x2 ? 2 : 1;
      const _slotW = _grid2x2 ? 85 : 90;
      const _slotH = _grid2x2 ? 82 : 96;
      const _mPad = 10;
      const _mw = _cols * _slotW + _mPad * 2;
      const _mh = _rows * _slotH + _mPad * 2;
      const _mX = Math.max(4, Math.min(W - _mw - 4, OPT_X + OPT_W / 2 - _mw / 2));
      const _mY = SY - _mh - 8;
      ctx.fillStyle = 'rgba(8,11,16,0.92)';
      ctx.fillRect(_mX, _mY, _mw, _mh);
      const _shipMenuGlow = ctx.createLinearGradient(0, _mY, 0, _mY + 24);
      _shipMenuGlow.addColorStop(0, 'rgba(140,160,175,0.07)'); _shipMenuGlow.addColorStop(1, 'rgba(140,160,175,0)');
      ctx.fillStyle = _shipMenuGlow; ctx.fillRect(_mX, _mY + 1, _mw, 24);
      const _ma2 = 14;
      ctx.strokeStyle = 'rgba(140,160,175,0.42)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(_mX + _ma2, _mY);        ctx.lineTo(_mX, _mY);        ctx.lineTo(_mX, _mY + _ma2);
      ctx.moveTo(_mX + _mw - _ma2, _mY);  ctx.lineTo(_mX + _mw, _mY);  ctx.lineTo(_mX + _mw, _mY + _ma2);
      ctx.moveTo(_mX, _mY + _mh - _ma2);  ctx.lineTo(_mX, _mY + _mh);  ctx.lineTo(_mX + _ma2, _mY + _mh);
      ctx.moveTo(_mX + _mw, _mY + _mh - _ma2); ctx.lineTo(_mX + _mw, _mY + _mh); ctx.lineTo(_mX + _mw - _ma2, _mY + _mh);
      ctx.stroke();
      shipMenuPopupBox = { x: _mX, y: _mY, w: _mw, h: _mh };
      let _anyHov = false;
      shipMenuItems = _ships.map((s, i) => {
        const _col = i % _cols, _row = Math.floor(i / _cols);
        const _sX  = _mX + _mPad + _col * _slotW;
        const _sY  = _mY + _mPad + _row * _slotH;
        const _sCX = _sX + _slotW / 2;
        const _isActive = s === currentShip;
        // 1×4: hitbox spans the full menu height per column (original behaviour)
        // 2×2: hitbox is per cell
        const hb = _grid2x2
          ? { x: _sX, y: _sY, w: _slotW, h: _slotH }
          : { x: _sX, y: _mY, w: _slotW, h: _mh };
        const _shipCY = _grid2x2 ? _sY + _slotH / 2 - 10 : _mY + _mh / 2 - 10;
        const _labelY = _grid2x2 ? _sY + _slotH - 11      : _mY + _mh - 11;
        const hov = !_anyHov && !_isActive && mouseX >= hb.x && mouseX < hb.x + hb.w && mouseY >= hb.y && mouseY < hb.y + hb.h;
        if (hov) _anyHov = true;
        if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
        ctx.save();
        ctx.globalAlpha = _isActive ? 0.28 : (hov ? 1.0 : 0.70);
        drawBmp(ctx, _sBmps[s], _sCX, _shipCY, _sCols[s], hov ? _sGlows[s] : null, 2);
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.font = '7px "Press Start 2P", monospace';
        ctx.fillStyle = _isActive ? 'rgba(80,80,80,0.50)' : hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
        ctx.fillText(_isActive ? 'ACTIVE' : _shipLabels[s], _sCX, _labelY);
        return { ship: s, hitbox: hb, active: _isActive };
      });
    } else {
      shipMenuItems = [];
      shipMenuPopupBox = null;
    }

    // Intercept-off vignette (gradient cached; alpha drives the pulse)
    if (blockingEnabled === false && shipPowerState === 'down') {
      if (_vigGradW !== W || _vigGradH !== H) {
        _vigGrad = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, Math.hypot(W, H) * 0.62);
        _vigGrad.addColorStop(0, 'rgba(0,0,0,0)'); _vigGrad.addColorStop(1, 'rgba(210,25,25,1)');
        _vigGradW = W; _vigGradH = H;
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.0018);
      ctx.save();
      ctx.globalAlpha = 0.07 + 0.05 * pulse;
      ctx.fillStyle = _vigGrad; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    ctx.restore();

    // Close shake translate (if not already restored before entity drawing)
    if (shakeOn) ctx.restore();
  }

  // ── SSE ───────────────────────────────────────────────────────────
  function connect() {
    if (evtSource) { evtSource.close(); evtSource = null; }
    evtSource = new EventSource('/api/pihole/events');
    evtSource.onopen = () => { sseRetryDelay = 3000; };
    evtSource.onmessage = e => {
      try {
        const evts = JSON.parse(e.data);
        if (Array.isArray(evts)) queue.push(...evts);
      } catch {}
    };
    evtSource.onerror = () => {
      if (evtSource) { evtSource.close(); evtSource = null; }
      if (active) setTimeout(connect, sseRetryDelay);
      sseRetryDelay = Math.min(sseRetryDelay * 2, 60000);
    };
  }

  function resize() {
    safeBottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
    W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight;
    shipX = W / 2; shipY = (H - safeBottom) * 0.65;
    hudSH = W < 480 ? 84 : W < 660 ? 94 : 108;
    if (settingsBtnEl) settingsBtnEl.style.bottom = Math.round(hudSH / 2 - 10 + safeBottom) + 'px';
  }
  window.addEventListener('resize', () => { if (active) resize(); });
  document.addEventListener('dragstart', e => e.preventDefault());

  // ── Public API ────────────────────────────────────────────────────
  window.enterPiholeMode = function() {
    if (_exitTimer !== null) { clearTimeout(_exitTimer); _exitTimer = null; active = false; }
    if (active) return;
    active = true;
    canvas.tabIndex = -1;
    canvas.focus({ preventScroll: true });
    resize();
    canvas.style.opacity = '0';
    canvas.style.zIndex = '15';   // ensure it's above the dash when entering
    document.body.classList.add('pihole-mode');
    if (window._startZenFade) window._startZenFade(true);
    entities.length = 0; lasers.length = 0; explosions.length = 0; queue.length = 0;
    domainFragments.length = 0; debris.length = 0; chainRings.length = 0;
    drone.state = 'docked'; drone.x = 0; drone.y = 0; drone.lastFire = 0;
    drone.side = 0; drone.angle = 0; drone.targetX = null; drone.targetY = null;
    drone.deployedAt = 0; drone.recallAt = 0;
    droneMissiles.length = 0;
    drone2.state = 'docked'; drone2.x = 0; drone2.y = 0; drone2.lastFire = 0;
    drone2.side = 0; drone2.angle = 0; drone2.targetX = null; drone2.targetY = null;
    drone2.deployedAt = 0; drone2.recallAt = 0;
    drone2Missiles.length = 0;
    hudGravity = null;
    hudStats = { blocked: null, queries: null, percent: null };
    if (hudStatsPollTimer) { clearInterval(hudStatsPollTimer); hudStatsPollTimer = null; }
    gravityState = 'idle'; gravityDoneAt = 0;
    if (gravityPollTimer) { clearTimeout(gravityPollTimer); gravityPollTimer = null; }
    blockingEnabled = null; // preserve blockingOffAt/blockingDuration so active timers survive exit/re-enter
    shipPowerState = 'up'; startupAt = 0; lastEnemyAt = 0;
    gunCheckState = 0; gunCheckFiredAt = [0, 0];
    carrierState = 'none'; carrierY = 0; carrierRestY = 0; carrierArrivingAt = 0; carrierLeavingAt = 0; launchAt = 0;
    shieldMenuOpen = false; shieldMenuItems = []; shieldHovered = false;
    shipMenuOpen = false; shipMenuItems = []; shipMenuHovered = false;
    settingsMenuOpen = false; settingsMenuItems = [];
    if (settingsBtnEl) { settingsBtnEl.style.display = 'block'; settingsBtnEl.classList.remove('menu-open'); }
    currentShip = sessionStorage.getItem('ph_ship') || 'protector'; warpState = 'none'; warpAt = 0; warpNextShip = null;
    shakeAt = 0; shakeDur = 0; shakeAmp = 0;
    mouseX = -1; mouseY = -1;
    // Restore timed-block state that may have been set before navigating away
    _firstEnterFetch = true;
    const _saved = JSON.parse(sessionStorage.getItem('ph_block_timer') || 'null');
    if (_saved && _saved.duration > 0) {
      const _elapsed = Date.now() - _saved.wallOffAt;
      if (_elapsed < _saved.duration) {
        blockingOffAt = performance.now() - _elapsed;
        blockingDuration = _saved.duration;
        shipPowerState = 'down';
        // Blocking was already off before we arrived - snap carrier/ship to docked state
        carrierRestY = H * 0.78;
        carrierY = carrierRestY;
        carrierState = 'present';
        shipX = W * 0.40 + CARRIER_BAY_DX[CARRIER_SHIP_ORDER.indexOf(currentShip)];
        shipY = carrierRestY;
        _firstEnterFetch = false;
      } else {
        sessionStorage.removeItem('ph_block_timer');
      }
    }
    function fetchPiholeStats() {
      fetch('/api/pihole/stats', { signal: AbortSignal.timeout(1800) }).then(r => r.json()).then(d => {
        if (d.gravity != null) hudGravity = d.gravity;
        if (d.blocking != null) {
          const _wasFirst = _firstEnterFetch;
          if (_firstEnterFetch) _firstEnterFetch = false;
          const _prev = blockingEnabled;
          blockingEnabled = d.blocking;
          if (!d.blocking && !_wasFirst && _prev !== false) {
            shieldMenuOpen = false;
            shipMenuOpen = false; shipMenuItems = [];
            settingsMenuOpen = false;
            _closeSettingsBtnAnimated();
          }
          if (!d.blocking) {
            // Recalibrate countdown from Pi-hole's timer whenever blocking is off with a known duration
            if (d.block_timer > 0) {
              blockingOffAt = performance.now();
              blockingDuration = d.block_timer * 1000;
            }
            if (_wasFirst && shipPowerState === 'up') {
              // Blocking was already off when we arrived - snap to docked, skip animation
              shipPowerState = 'down';
              if (shipQuote) shipQuote.shownAt = performance.now() - 3000;
              carrierRestY = H * 0.78;
              carrierY = carrierRestY;
              carrierState = 'present';
              shipX = W * 0.40 + CARRIER_BAY_DX[CARRIER_SHIP_ORDER.indexOf(currentShip)];
              shipY = carrierRestY;
            } else if (!_wasFirst && shipPowerState === 'up') {
              shipPowerState = 'down';
              if (shipQuote) shipQuote.shownAt = performance.now() - 3000;
              if (drone.state !== 'docked') drone.state = 'docking';
              if (drone2.state !== 'docked') drone2.state = 'docking';
            }
          } else if (_prev === false && !_wasFirst && shipPowerState === 'down') {
            // Blocking re-enabled remotely - start startup; carrier departs when startup completes (same as normal flow)
            blockingDuration = 0;
            sessionStorage.removeItem('ph_block_timer');
            gunCheckState = 0; gunCheckFiredAt = [0, 0];
            shipMenuOpen = false; shipMenuItems = [];
            settingsMenuOpen = false;
            // No classList.remove here - button is about to fade via _btnHide; removing now would flash X→burger while fading
            shipPowerState = 'startup'; startupAt = performance.now();
          }
        }
        if (d.blocked != null) hudStats.blocked = d.blocked;
        if (d.queries != null) hudStats.queries = d.queries;
        if (d.percent != null) hudStats.percent = d.percent;
      }).catch(() => {});
    }
    if (settingsBtnEl) settingsBtnEl.style.display = 'block';
    fetchPiholeStats();
    hudStatsPollTimer = setInterval(fetchPiholeStats, 1000);
    if (_onVisible) document.removeEventListener('visibilitychange', _onVisible);
    _onVisible = function() {
      if (document.visibilityState !== 'visible') return;
      clearSpriteCache();
      fetchPiholeStats();
      if (!evtSource) connect();
      // reset interval so next tick is exactly 1s from now, not 0–999ms
      if (hudStatsPollTimer) { clearInterval(hudStatsPollTimer); }
      hudStatsPollTimer = setInterval(fetchPiholeStats, 1000);
      // Revive rAF loop if the browser froze/dropped the pending callback
      if (active) { if (_rafId !== null) cancelAnimationFrame(_rafId); _rafId = requestAnimationFrame(tick); }
    };
    document.addEventListener('visibilitychange', _onVisible);
    // Also clear on window focus: tab may stay visible all day while machine idles,
    // skipping visibilitychange entirely, yet the browser can still reclaim GPU-backed
    // canvas memory. Focus fires when the user returns and is cheap to handle.
    if (_onFocus) window.removeEventListener('focus', _onFocus);
    _onFocus = () => clearSpriteCache();
    window.addEventListener('focus', _onFocus);
    connect();
    requestAnimationFrame(t => {
      lastT = t; lastSpawn = t;
      canvas.style.opacity = '1';  // triggers the 0.6s transition after first paint
      _rafId = requestAnimationFrame(tick);
    });
  };

  window.exitPiholeMode = function() {
    if (!active) return;
    canvas.style.opacity = '0';
    canvas.style.zIndex = '1';    // drop below dashboard so it fades under, not over
    document.body.classList.remove('pihole-mode');
    if (window._startZenFade) window._startZenFade(false);
    if (hudStatsPollTimer) { clearInterval(hudStatsPollTimer); hudStatsPollTimer = null; }
    if (gravityPollTimer) { clearTimeout(gravityPollTimer); gravityPollTimer = null; }
    gravityState = 'idle'; arrowHovered = false;
    shieldMenuOpen = false; shieldHovered = false; shieldMenuItems = [];
    shipMenuOpen = false; shipMenuHovered = false; shipMenuItems = [];
    settingsMenuOpen = false; settingsMenuItems = [];
    if (settingsBtnEl) { settingsBtnEl.style.display = 'none'; settingsBtnEl.classList.remove('menu-open'); }
    warpState = 'none'; warpNextShip = null;
    blockingEnabled = null; // preserve blockingOffAt/blockingDuration so active timers survive exit/re-enter
    canvas.style.cursor = '';
    if (evtSource) { evtSource.close(); evtSource = null; }
    if (_onVisible) { document.removeEventListener('visibilitychange', _onVisible); _onVisible = null; }
    if (_onFocus) { window.removeEventListener('focus', _onFocus); _onFocus = null; }
    _exitTimer = setTimeout(() => {
      _exitTimer = null;
      active = false; if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
      ctx.clearRect(0, 0, W, H);
      shipPowerState = 'up'; gunCheckState = 0; lastEnemyAt = 0;
      carrierState = 'none'; carrierY = 0; carrierRestY = 0;
      entities.length = 0; lasers.length = 0; explosions.length = 0; queue.length = 0;
      domainFragments.length = 0; debris.length = 0; chainRings.length = 0;
      drone.state = 'docked'; drone.angle = 0; drone.targetX = null; drone.targetY = null;
      drone.deployedAt = 0; drone.recallAt = 0;
      droneMissiles.length = 0;
      drone2.state = 'docked'; drone2.angle = 0; drone2.targetX = null; drone2.targetY = null;
      drone2.deployedAt = 0; drone2.recallAt = 0;
      drone2Missiles.length = 0;
      canvas.style.zIndex = '';   // restore to CSS default (15) for next session
    }, 650);
  };

  // ── Blocking toggle ───────────────────────────────────────────────
  function setBlocking(enable, timerSec = null) {
    blockingEnabled = enable;
    shieldMenuOpen = false;
    if (!enable) {
      blockingOffAt = performance.now();
      blockingDuration = timerSec ? timerSec * 1000 : 0;
      if (blockingDuration > 0)
        sessionStorage.setItem('ph_block_timer', JSON.stringify({ wallOffAt: Date.now(), duration: blockingDuration }));
      shipPowerState = 'powerdown'; powerdownAt = performance.now();
      if (shipQuote) shipQuote.shownAt = performance.now() - 3000;
      if (drone.state !== 'docked') drone.state = 'docking';
      if (drone2.state !== 'docked') drone2.state = 'docking';
    } else {
      blockingDuration = 0;
      sessionStorage.removeItem('ph_block_timer');
      gunCheckState = 0; gunCheckFiredAt = [0, 0];
      shipPowerState = 'startup'; startupAt = performance.now();
      if (carrierState === 'arriving') {
        carrierState = 'leaving'; carrierLeavingAt = performance.now(); launchAt = performance.now();
      }
    }
    fetch('/api/pihole/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable, timer: timerSec }),
    }).then(r => r.json()).then(d => {
      if ('blocking' in d) {
        blockingEnabled = d.blocking;
        if (!blockingEnabled && shipPowerState === 'startup') shipPowerState = 'down';
      }
    }).catch(() => {});
  }

  // ── Gravity update ────────────────────────────────────────────────
  function triggerGravityUpdate() {
    const prevGravity = hudGravity;
    const triggeredAt = performance.now();
    gravityState = 'updating';
    fetch('/api/pihole/gravity-update', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.error || !d.ok) { gravityState = 'idle'; return; }
        let polls = 0;
        function poll() {
          if (!active || gravityState !== 'updating') return;
          if (polls++ > 40) { gravityState = 'idle'; return; }
          fetch('/api/pihole/stats', { signal: AbortSignal.timeout(4000) })
            .then(r => r.json())
            .then(d => {
              const elapsed = performance.now() - triggeredAt;
              const countChanged = d.gravity != null && d.gravity !== prevGravity;
              const minWaitPassed = elapsed > 25000;
              if (countChanged || (d.gravity != null && minWaitPassed)) {
                if (d.gravity != null) hudGravity = d.gravity;
                gravityState = 'done';
                gravityDoneAt = performance.now();
              } else {
                gravityPollTimer = setTimeout(poll, 3000);
              }
            })
            .catch(() => { gravityPollTimer = setTimeout(poll, 5000); });
        }
        gravityPollTimer = setTimeout(poll, 4000);
      })
      .catch(() => { gravityState = 'idle'; });
  }

  function _inBox(mx, my, box) {
    return mx >= box.x && mx <= box.x + box.w && my >= box.y && my <= box.y + box.h;
  }

  function _closeSettingsBtnAnimated() {
    if (!settingsBtnEl || !settingsBtnEl.classList.contains('menu-open')) return;
    // Freeze the current animated transform on each span so the CSS transition
    // has a real start value to animate from (animation overrides transition otherwise).
    const spans = settingsBtnEl.querySelectorAll('span');
    spans.forEach(s => { s.style.transform = getComputedStyle(s).transform; });
    settingsBtnEl.classList.remove('menu-open');
    settingsBtnEl.getBoundingClientRect(); // force reflow
    spans.forEach(s => { s.style.transform = ''; });
  }

  canvas.addEventListener('click', e => {
    if (!active) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    // Settings menu open - click toggles a setting or dismisses
    if (settingsMenuOpen) {
      e.stopPropagation();
      for (const item of settingsMenuItems) {
        if (_inBox(mx, my, item.hitbox)) {
          if      (item.key === 'friendlies')  { showFriendlies = !showFriendlies; _saveDisplaySettings(); }
          else if (item.key === 'domain')      { showDomain     = !showDomain;     _saveDisplaySettings(); }
          else if (item.key === 'client')      { showClient     = !showClient;     _saveDisplaySettings(); }
          else if (item.key === 'pihole-link') {
            const url = phLinkEl ? phLinkEl.dataset.href : null;
            if (url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
            settingsMenuOpen = false;
            _closeSettingsBtnAnimated();
          }
          return;
        }
      }
      if (settingsMenuPopupBox && _inBox(mx, my, settingsMenuPopupBox)) return;
      settingsMenuOpen = false;
      _closeSettingsBtnAnimated();
      // fall through; let the click reach shield/ship hitboxes
    }

    // Ship menu open - click selects or dismisses; fall through to activate other targets
    if (shipMenuOpen) {
      e.stopPropagation();
      for (const item of shipMenuItems) {
        if (_inBox(mx, my, item.hitbox)) {
          if (!item.active) initWarpOut(item.ship);
          return;
        }
      }
      if (shipMenuPopupBox && _inBox(mx, my, shipMenuPopupBox)) return;
      shipMenuOpen = false;
      if (_inBox(mx, my, shipMenuHitbox)) return; // don't immediately reopen
    }

    // Shield menu open - click selects or dismisses; fall through to activate other targets
    if (shieldMenuOpen) {
      e.stopPropagation();
      for (const item of shieldMenuItems) {
        if (_inBox(mx, my, item.hitbox)) { setBlocking(false, item.timer); return; }
      }
      if (shieldMenuPopupBox && _inBox(mx, my, shieldMenuPopupBox)) return;
      shieldMenuOpen = false;
      if (_inBox(mx, my, shieldHitbox)) return; // don't immediately reopen
    }

    // Ship selector toggle
    if (_inBox(mx, my, shipMenuHitbox) && blockingEnabled === true && shipPowerState === 'up' && warpState === 'none') {
      e.stopPropagation();
      shipMenuOpen = !shipMenuOpen;
      return;
    }

    // Ship body easter egg
    if (_inBox(mx, my, shipBodyHitbox) && warpState === 'none' && shipPowerState === 'up') {
      e.stopPropagation();
      if (!shipQuote && performance.now() >= shipQuoteCooldown) {
        if (shipQuoteDeck.length === 0 || shipQuoteDeckFor !== currentShip) {
          const _src = [...SHIP_QUOTES[currentShip]];
          for (let _i = _src.length - 1; _i > 0; _i--) {
            const _j = Math.floor(Math.random() * (_i + 1));
            [_src[_i], _src[_j]] = [_src[_j], _src[_i]];
          }
          // seam protection: don't let first card of new deck match last shown (same ship reshuffle only)
          if (_src.length > 1 && shipQuoteDeckFor === currentShip && _src[0] === shipQuoteLastShown) {
            const _sw = 1 + Math.floor(Math.random() * (_src.length - 1));
            [_src[0], _src[_sw]] = [_src[_sw], _src[0]];
          }
          shipQuoteDeck = _src;
          shipQuoteDeckFor = currentShip;
        }
        const _chosen = shipQuoteDeck.shift();
        shipQuoteLastShown = _chosen;
        shipQuote = { text: _chosen, shownAt: performance.now() };
      }
      return;
    }

    // Shield toggle - also closes settings menu
    if (_inBox(mx, my, shieldHitbox)) {
      e.stopPropagation();
      settingsMenuOpen = false;
      _closeSettingsBtnAnimated();
      if (blockingEnabled === false && shipPowerState === 'down') { setBlocking(true); }
      else if (blockingEnabled === true && shipPowerState === 'up') { shieldMenuOpen = true; }
      return;
    }

    // Gravity arrow
    if (gravityState === 'idle' && _inBox(mx, my, arrowHitbox)) {
      e.stopPropagation();
      triggerGravityUpdate();
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (!active) { arrowHovered = false; shieldHovered = false; shipMenuHovered = false; canvas.style.cursor = ''; return; }
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left; mouseY = e.clientY - rect.top;
    arrowHovered = gravityState === 'idle' && _inBox(mouseX, mouseY, arrowHitbox);
    shieldHovered = _inBox(mouseX, mouseY, shieldHitbox);
    shipMenuHovered = _inBox(mouseX, mouseY, shipMenuHitbox) && blockingEnabled === true && shipPowerState === 'up' && warpState === 'none';
    const overShieldMenu   = shieldMenuOpen   && shieldMenuItems.some(item => _inBox(mouseX, mouseY, item.hitbox));
    const overShipMenu     = shipMenuOpen     && shipMenuItems.some(item => !item.active && _inBox(mouseX, mouseY, item.hitbox));
    const overSettingsMenu = settingsMenuOpen && settingsMenuItems.some(item => _inBox(mouseX, mouseY, item.hitbox));
    canvas.style.cursor = (arrowHovered || shieldHovered || overShieldMenu || shipMenuHovered || overShipMenu || overSettingsMenu) ? 'pointer' : '';
  });

  // The settings button sits above the canvas (z-index 16) and captures pointer events,
  // so canvas mousemove never fires while hovering it.
  if (phLinkEl) {
    phLinkEl.addEventListener('mouseenter', () => {
      arrowHovered = false; shieldHovered = false; shipMenuHovered = false;
      canvas.style.cursor = '';
    });
    phLinkEl.addEventListener('click', () => {
      const url = phLinkEl.dataset.href;
      if (url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
    });
  }
  if (settingsBtnEl) {
    settingsBtnEl.addEventListener('mouseenter', () => {
      arrowHovered = false; shieldHovered = false; shipMenuHovered = false;
      canvas.style.cursor = '';
    });
    settingsBtnEl.addEventListener('click', e => {
      e.stopPropagation();
      if (!active) return;
      settingsMenuOpen = !settingsMenuOpen;
      if (settingsMenuOpen) { settingsBtnEl.classList.add('menu-open'); }
      else { _closeSettingsBtnAnimated(); }
      if (settingsMenuOpen) {
        shieldMenuOpen = false;
        shipMenuOpen = false;
      }
    });
  }

  // Escape: navigates back to return_url with a fade transition when one is configured.
  // Does nothing if return_url is not set.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const ret = (window.BG_CONFIG || {}).return_url;
    if (!ret || /^(javascript|data):/i.test(ret)) return;
    const veil = document.createElement('div');
    veil.dataset.navVeil = '1';
    veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity 180ms linear;z-index:9999;pointer-events:none;';
    document.body.appendChild(veil);
    void veil.offsetWidth;
    veil.style.opacity = '1';
    veil.addEventListener('transitionend', () => { window.location.href = ret; }, { once: true });
  });

  // Restore from browser back-forward cache (e.g. after ESC navigation + back button)
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    document.querySelectorAll('[data-nav-veil]').forEach(el => el.remove());
    active = false;
    if (evtSource) { evtSource.close(); evtSource = null; }
    if (hudStatsPollTimer) { clearInterval(hudStatsPollTimer); hudStatsPollTimer = null; }
    if (gravityPollTimer) { clearTimeout(gravityPollTimer); gravityPollTimer = null; }
    window.enterPiholeMode();
  });
})();
