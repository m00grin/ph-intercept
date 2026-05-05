// ── Pi-hole DNS game mode ─────────────────────────────────────────────
(function() {
  const canvas = document.getElementById('pihole-canvas');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  let active = false, evtSource = null;
  let lastT = 0, lastSpawn = 0, shipX = 0, shipY = 0, lastGun = 0;
  let lastEnemyAt = 0;
  let activeEnemies = 0, idleBlend = 0;
  let _hudGlowGrad = null, _hudGlowGradSY = -1;
  let _vigGrad = null, _vigGradW = -1, _vigGradH = -1;
  const entities = [], lasers = [], explosions = [], queue = [];
  const tally = { blocked: 0, allowed: 0 };
  let drone = { state: 'docked', x: 0, y: 0, lastFire: 0, side: 0, angle: 0, targetX: null, targetY: null, deployedAt: 0, recallAt: 0 };
  const droneMissiles = [];
  let hudGravity = null;
  let hudStats = { blocked: null, queries: null, percent: null };
  let hudStatsPollTimer = null;
  let gravityState = 'idle'; // 'idle' | 'updating' | 'done'
  let gravityDoneAt = 0;
  let gravityPollTimer = null;
  let arrowHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let arrowHovered = false;

  const domainFragments = [];
  const debris = [];
  const chainBolts = [];
  const chainRings = [];
  let blockingEnabled = null; // null=unknown, true, false
  let blockingOffAt = 0;
  let blockingDuration = 0;   // ms; 0 = indefinite
  let shipPowerState = 'up';  // 'up' | 'down' | 'startup'
  let startupAt = 0;
  const STARTUP_DUR = 1800;
  let powerdownAt = 0;
  const POWERDOWN_DUR = 800;
  let gunCheckState = 0;
  const GUN_CHECK_AT = [0.68, 0.76];
  const GUN_CHECK_DUR = 130;
  let gunCheckFiredAt = [0, 0];
  let shieldMenuOpen = false;
  let shieldHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let shieldMenuItems = [];
  let shieldHovered = false;
  let mouseX = -1, mouseY = -1;
  let currentShip = 'protector';  // 'protector' | 'falcon' | 'enterprise'
  let warpState = 'none';         // 'none' | 'out' | 'in'
  let warpAt = 0;
  let warpNextShip = null;
  const WARP_OUT_DUR = 300;
  const WARP_IN_DUR = 500;
  let shakeAt = 0, shakeDur = 0, shakeAmp = 0;
  let shipMenuOpen = false;
  let shipMenuItems = [];
  let shipMenuHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let shipMenuHovered = false;
  const DISABLE_OPTIONS = [
    { label: '10 SEC', timer: 10,  ms: 10000 },
    { label: '30 SEC', timer: 30,  ms: 30000 },
    { label: '5 MIN',  timer: 300, ms: 300000 },
    { label: 'DISABLE',   timer: null, ms: 0 },
  ];
  const CHAIN_RADIUS = 72;

  // Draws one nacelle engine exhaust flame centered at (x, base).
  function drawEngineFlare(x, base, ft, wScale = 1, lScale = wScale) {
    const l = (21 + 2 * Math.sin(ft * 1.9) + 1.5 * Math.sin(ft * 3.1 + 0.7)) * lScale;
    const fw = (3.5 + 0.4 * Math.sin(ft * 2.7 + 0.3)) * wScale;
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
    ctx.moveTo(x - fw, base);
    ctx.quadraticCurveTo(x - fw * 0.6, base + l * 0.65, x, base + l);
    ctx.quadraticCurveTo(x + fw * 0.6, base + l * 0.65, x + fw, base);
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
          else if (killedBy === 'chain') speed *= 2.0;
          else if (killedBy === 1) speed *= 0.8;
          else if (killedBy === 2) speed *= 1.2;
          else if (killedBy === 3) speed *= 1.5;
          ps.push({ x: px, y: py, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 1.5, col });
        }
      }
    }
    explosions.push({ ps, born: performance.now(), dur: 1200 });
    // Sparse drifting debris — a few slow pixels that linger for several seconds
    const nd = 3 + Math.floor(Math.random() * 3);
    const dnow = performance.now();
    for (let di = 0; di < nd; di++) {
      const da = Math.random() * Math.PI * 2;
      const ds = 0.005 + Math.random() * 0.011;
      debris.push({ x: x + (Math.random()-0.5)*10, y: y + (Math.random()-0.5)*10,
                    vx: Math.cos(da)*ds, vy: Math.sin(da)*ds,
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
    const blocked = ev.status === 'blocked';
    const isCache = ev.source === 'cache';
    const existing = entities.find(e => e.domain === ev.domain && e.type === ev.status && e.state !== 'shot');
    if (existing) {
      if (blocked) {
        const prevTier = Math.min(existing.count, 3);
        existing.count++;
        const newTier = Math.min(existing.count, 3);
        if (newTier > prevTier) {
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
      } else {
        tally.allowed++;
      }
      return;
    }
    if (entities.length >= 50) {
      if (!blocked) tally.allowed++;
      return;
    }

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
      chainFireAt: 0,
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
    tally.blocked++;
    const now = performance.now();
    const tier = Math.min(ent.count, 3);
    let seekerFire = false;
    if (tier >= 3) {
      if (Math.random() < 0.5) {
        // Beam style — triple spread from left gun, nose, right gun
        ent.state = 'shot';
        const sp = 10;
        lasers.push({ side: 0, tier, x1: ent.x - sp, y1: ent.y, born: now });
        lasers.push({ side: 2, tier, x1: ent.x,      y1: ent.y, born: now });
        lasers.push({ side: 1, tier, x1: ent.x + sp, y1: ent.y, born: now });
      } else {
        // Seeker style — 5 rapid bolts from nose gun, each arcing a different path to target
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
          lasers.push({ style: 'seeker', tier,
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
    lasers.length = 0;
    shakeAt = warpAt; shakeDur = 320; shakeAmp = 7;
    for (const e of entities) e.warpPushed = false;
  }

  // ── Game tick ─────────────────────────────────────────────────────
  function tick(t) {
    if (!active) return;
    requestAnimationFrame(tick);
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
          if (e.state === 'alive' && age > 2200) { e.state = 'targeted'; e.targetedAt = t; }
          if (e.state === 'targeted' && age > 3400) fireAt(e);
        } else if (e.state === 'targeted') {
          e.state = 'alive'; // drop targeting lock when shields are down
        }
        if (e.chainFireAt > 0 && t >= e.chainFireAt) {
          e.state = 'shot'; e.killedBy = 'chain'; e.chainFireAt = 0; tally.blocked++;
          chainRings.push({ x: e.x, y: e.y, born: t, dur: 340 });
        }
        if (e.state === 'seeker-incoming' && t >= e.detonateAt) {
          e.state = 'shot';
        }
        if (e.state === 'shot') {
          // Chain reaction — concussive blast detonates nearby enemies
          for (const other of entities) {
            if (other !== e && other.type === 'blocked' && other.state === 'alive' && !other.chainFireAt) {
              if (Math.hypot(other.x - e.x, other.y - e.y) < CHAIN_RADIUS) {
                other.chainFireAt = t + 120 + Math.random() * 220;
                // Fling debris bolts toward the chain victim
                const bdx = other.x - e.x, bdy = other.y - e.y;
                const bdist = Math.hypot(bdx, bdy) || 1;
                const bang = Math.atan2(bdy, bdx);
                const bcount = 3 + Math.floor(Math.random() * 3);
                for (let b = 0; b < bcount; b++) {
                  const ba = bang + (Math.random() - 0.5) * 0.4;
                  const bspeed = 0.38 + Math.random() * 0.14;
                  chainBolts.push({
                    x: e.x + (Math.random() - 0.5) * 8,
                    y: e.y + (Math.random() - 0.5) * 8,
                    vx: Math.cos(ba) * bspeed,
                    vy: Math.sin(ba) * bspeed,
                    born: t,
                    dur: bdist / bspeed + 80,
                  });
                }
              }
            }
          }
          const chainKill = e.killedBy === 'chain';
          const tier = Math.min(e.count, 3);
          const bmp = tier >= 3 ? E3 : tier === 2 ? E2 : (e.design === 0 ? E0 : E1);
          const color = chainKill
            ? `rgba(255,210,80,0.95)`
            : tier >= 3
            ? `rgba(190,60,255,0.9)`
            : tier === 2
            ? `rgba(255,130,30,0.9)`
            : `rgba(255,50,50,0.9)`;
          createExplosionFromBmp(bmp, e.x, e.y, e.killedBy, color);
          createDomainFragments(e.domain, e.x, e.y + bmpH(bmp) * PX / 2 + 10, tier);
          entities.splice(i, 1);
          continue;
        }
        if (e.y > H + 80) { entities.splice(i, 1); continue; }
      } else {
        e.labelAlpha = Math.max(0, 1 - (age - 2400) / 1000);
        if (e.x < -130 || e.x > W + 130 || e.y > H + 80) {
          tally.allowed++;
          entities.splice(i, 1);
        }
      }
    }

    // Laser collision
    for (let i = lasers.length - 1; i >= 0; i--) {
      const l = lasers[i];
      if (t < l.born) continue;
      for (const e of entities) {
        if (e.state === 'alive' && Math.hypot(e.x - l.x1, e.y - l.y1) < 25) {
          e.state = 'shot';
          e.killedBy = l.tier;
          lasers.splice(i, 1);
          break;
        }
      }
    }
    // Ship movement — passive hover drift + idle wander; track targeted enemy
    activeEnemies = 0;
    for (const e of entities) {
      if (e.type === 'blocked' && e.state !== 'shot') activeEnemies++;
    }
    if (activeEnemies > 0) lastEnemyAt = t;
    idleBlend = shipPowerState === 'up' ? Math.min(1, Math.max(0, (t - lastEnemyAt - 20000) / 2000)) : 0;
    const passiveDrift = 5 * Math.sin(t * 0.00038) + 2 * Math.sin(t * 0.00067);
    const idleDrift = idleBlend * 26 * Math.sin(t * 0.00021);
    const targeted = entities.find(e => e.state === 'targeted');
    const goalX = targeted ? W / 2 + Math.max(-110, Math.min(110, targeted.x - W / 2)) : W / 2 + passiveDrift + idleDrift;
    shipX += (goalX - shipX) * Math.min(1, 0.0038 * dt);

    // Ship Y retreat — rise when enemies descend, settle back during gaps
    const startupSurge = shipPowerState === 'startup' ? -22 * Math.min(1, (t - startupAt) / STARTUP_DUR) : 0;
    const goalY = H * 0.65 + (shipPowerState === 'up' && activeEnemies > 0 ? -42 : 0) + startupSurge;
    shipY += (goalY - shipY) * Math.min(1, 0.0008 * dt);

    // Support drone state machine — flanks the ship elevated and to one side, fires missiles
    const droneHoverX = shipX + drone.side * 110;
    const droneHoverY = shipY - 65;
    if (shipPowerState !== 'up' && drone.state !== 'docked' && drone.state !== 'docking') drone.state = 'docking';
    if (drone.state === 'docked' && activeEnemies >= DRONE_DEPLOY_THRESHOLD && shipPowerState === 'up') {
      drone.side = Math.random() < 0.5 ? -1 : 1;
      drone.angle = 0; drone.targetX = null; drone.targetY = null;
      drone.deployedAt = t; drone.recallAt = 0;
      drone.state = 'launching'; drone.x = shipX; drone.y = shipY;
      // Eject burst — spray outward toward the chosen side
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
      drone.x += (droneHoverX - drone.x) * Math.min(1, 0.003 * dt);
      drone.y += (droneHoverY - drone.y) * Math.min(1, 0.003 * dt);
      if (shipPowerState === 'up' && t - drone.lastFire > DRONE_FIRE_INTERVAL) {
        const droneTargets = entities.filter(e => e.type === 'blocked' && e.state !== 'shot' && e.state !== 'targeted' && e.state !== 'seeker-incoming' && !droneMissiles.some(m => m.target === e) && e.x >= 0 && e.x <= W && e.y >= 0 && e.y <= H);
        if (droneTargets.length) {
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
      const dockX = shipX + drone.side * 28;
      drone.x += (dockX - drone.x) * Math.min(1, 0.012 * dt);
      drone.y += (shipY - drone.y) * Math.min(1, 0.012 * dt);
      if (Math.hypot(drone.x - dockX, drone.y - shipY) < 3) drone.state = 'docked';
    }
    // Keep drone clear of main ship's weapon fire path (weapons fire ~±20px from shipX)
    if (drone.state === 'launching' || drone.state === 'active') {
      if (drone.side < 0) drone.x = Math.min(drone.x, shipX - 80);
      else               drone.x = Math.max(drone.x, shipX + 80);
    }

    // Missile travel, impact, and cleanup
    for (let i = droneMissiles.length - 1; i >= 0; i--) {
      const m = droneMissiles[i];
      if (m.exploded) {
        if (t - m.explodeAt > 700) droneMissiles.splice(i, 1);
        continue;
      }
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (Math.hypot(m.x - m.tx, m.y - m.ty) < 20 || t - m.born > m.dur + 150) {
        m.exploded = true; m.explodeAt = t;
        if (m.target && m.target.state !== 'shot') {
          m.target.state = 'shot'; m.target.killedBy = 'drone'; tally.blocked++;
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
        // AOE splash on nearby survivors
        for (const e of entities) {
          if (e.state === 'alive' && Math.hypot(e.x - m.x, e.y - m.y) < 48) {
            e.state = 'shot'; e.killedBy = 'drone'; tally.blocked++;
          }
        }
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
    for (let i = chainBolts.length - 1; i >= 0; i--) {
      const b = chainBolts[i];
      if (t - b.born > b.dur) { chainBolts.splice(i, 1); continue; }
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    for (let i = chainRings.length - 1; i >= 0; i--) {
      if (t - chainRings[i].born >= chainRings[i].dur) chainRings.splice(i, 1);
    }

    // Warp state machine
    if (warpState === 'out' && t - warpAt >= WARP_OUT_DUR) {
      currentShip = warpNextShip; warpNextShip = null;
      warpState = 'in'; warpAt = t;
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
    if (shipPowerState === 'startup' && t - startupAt >= STARTUP_DUR) shipPowerState = 'up';
    // Gun check arm/fire during startup
    if (shipPowerState === 'startup') {
      const sp = (t - startupAt) / STARTUP_DUR;
      if (gunCheckState === 0 && sp >= GUN_CHECK_AT[0]) { gunCheckState = 1; gunCheckFiredAt[0] = t; }
      if (gunCheckState === 1 && sp >= GUN_CHECK_AT[1]) { gunCheckState = 2; gunCheckFiredAt[1] = t; }
    }
    // Powerdown completion
    if (shipPowerState === 'powerdown' && t - powerdownAt >= POWERDOWN_DUR) shipPowerState = 'down';
    // Timed-block countdown → auto re-enable with startup sequence
    if (blockingEnabled === false && blockingDuration > 0 && shipPowerState === 'down') {
      if (t - blockingOffAt >= blockingDuration) {
        blockingEnabled = true; blockingDuration = 0;
        gunCheckState = 0; gunCheckFiredAt = [0, 0];
        shipPowerState = 'startup'; startupAt = t;
      }
    }

    render(t);
  }

  const _SHIP_CONFIGS = {
    protector:  { bmp: PLAYER_BMP,     color: 'rgba(160,210,255,0.95)', glow: 'rgba(130,195,255,0.55)', dimColor: 'rgba(160,210,255,0.22)',
                  flares: [{ xOff: -20, yOff: 0, size: 1 }, { xOff: 20, yOff: 0, size: 1 }] },
    falcon:     { bmp: FALCON_BMP,     color: 'rgba(210,210,210,0.95)', glow: 'rgba(180,180,180,0.40)', dimColor: 'rgba(210,210,210,0.22)',
                  flares: [{ xOff: -3, yOff: 0, size: 2, len: 1 }] },
    enterprise: { bmp: ENTERPRISE_BMP, color: 'rgba(200,215,255,0.95)', glow: 'rgba(160,185,255,0.40)', dimColor: 'rgba(200,215,255,0.22)',
                  flares: [{ xOff: -16, yOff: 0, size: 0.9 }, { xOff: 16, yOff: 0, size: 0.9 }, { xOff: 0, yOff: 0, size: 0.55 }] },
  };

  // ── Render ────────────────────────────────────────────────────────
  function render(t) {
    ctx.clearRect(0, 0, W, H);

    // Screen shake — decaying oscillation on warp-out blast
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

    // Debris — sparse drifting wreckage, fades over 8-13 s
    for (const d of debris) {
      const prog = (t - d.born) / d.dur;
      const a = prog < 0.65 ? 0.28 : 0.28 * (1 - (prog - 0.65) / 0.35);
      ctx.fillStyle = `rgba(${d.col},${a.toFixed(3)})`;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
    }

    // End shake translate — entities get warp-blast distortion instead of shaking
    if (shakeOn) { ctx.restore(); shakeOn = false; }

    // Ship-position-based warp distortion: Gaussian bell centered on ship's current Y
    let warpFrontY = null;
    if (warpState === 'out') {
      const _wp = Math.min(1, (t - warpAt) / WARP_OUT_DUR);
      const _p2 = Math.max(0, (_wp - 0.40) / 0.60);
      if (_p2 > 0) warpFrontY = shipY - _p2 * (H + 300);
    }

    // Entities
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
        const [col, glow, rcol, rglow] = tier >= 3
          ? [`rgba(190,60,255,${pulse})`, 'rgba(190,60,255,0.35)', 'rgba(255,210,50,0.9)',  'rgba(255,175,30,0.6)']
          : tier === 2
          ? [`rgba(255,130,30,${pulse})`, 'rgba(255,130,30,0.35)', 'rgba(0,220,255,0.9)',   'rgba(0,190,255,0.6)']
          : [`rgba(255,50,50,${pulse})`,  'rgba(255,60,40,0.35)',  'rgba(80,255,160,0.9)',  'rgba(60,240,140,0.6)'];
        // Mutation scale pulse
        const mp = e.mutateAt > 0 ? Math.min(1, (t - e.mutateAt) / 500) : 1;
        const mutActive = mp < 1;
        ctx.save();
        ctx.translate(ex, ey);
        if (mutActive) {
          const sc = 1 + 0.45 * Math.sin(mp * Math.PI);
          ctx.scale(sc, sc);
        }

        drawBmp(ctx, bmp, 0, 0, col, glow, EPX);

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

        // Expanding ring (world space — unaffected by scale)
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
          ? ['rgba(255,220,100,0.9)', 'rgba(255,220,100,0.3)']
          : tier === 2
          ? ['rgba(100,220,255,0.9)', 'rgba(100,220,255,0.3)']
          : [['rgba(50,215,120,0.9)','rgba(80,175,255,0.9)','rgba(175,220,70,0.9)'][e.design % 3],
              ['rgba(50,215,120,0.3)','rgba(80,175,255,0.3)','rgba(175,220,70,0.3)'][e.design % 3]];
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(Math.atan2(e.vy, e.vx) + Math.PI / 2);
        drawBmp(ctx, bmp, 0, 0, color, glow, EPX - 1);
        ctx.restore();
      }

      ctx.restore();

      // Domain label (always upright)
      const la = e.type === 'blocked' ? alpha : e.labelAlpha * alpha;
      if (la > 0.02) {
        const tier = Math.min(e.count, 3);
        const lbmp = e.type === 'blocked'
          ? (tier >= 3 ? E3 : tier === 2 ? E2 : (e.design === 0 ? E0 : E1))
          : (tier >= 3 ? F4 : tier === 2 ? F3 : [F0, F1, F2][e.design % 3]);
        const ly = ey + (bmpH(lbmp) * EPX / 2) + 10;
        ctx.save();
        ctx.globalAlpha = la * 0.85;
        ctx.font = '11px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        if (e.type === 'blocked') {
          const tier = Math.min(e.count, 3);
          ctx.fillStyle = tier >= 3 ? 'rgba(200,100,255,1)' : tier === 2 ? 'rgba(255,160,60,1)' : 'rgba(255,120,100,1)';
        } else {
          ctx.fillStyle = 'rgba(150,230,175,1)';
        }
        ctx.shadowColor = 'rgba(0,0,0,0.95)';
        ctx.shadowBlur = 4;
        const dom = e.domain.length > 32 ? '…' + e.domain.slice(-30) : e.domain;
        ctx.fillText(dom, ex, ly);
        ctx.restore();
      }
    }

    // Chain shockwave bolts — debris flung toward chain victims
    ctx.strokeStyle = 'rgba(255,185,55,1)';
    ctx.lineWidth = 1.5;
    for (const b of chainBolts) {
      const a = Math.max(0, 1 - (t - b.born) / b.dur * 1.15);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 22, b.y - b.vy * 22);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

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

    // Chain shockwave rings — expanding concussive ring at chain detonation point
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

    // Domain fragments — letters scatter from killed enemies
    for (const f of domainFragments) {
      const prog = (t - f.born) / f.dur;
      if (prog >= 1) continue;
      const a = Math.max(0, 1 - prog * 1.3);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillStyle = `rgba(${f.col},1)`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(Math.round(f.x), Math.round(f.y));
      ctx.rotate(f.rot);
      ctx.fillText(f.ch, 0, 0);
      ctx.restore();
    }

    // Ship and drone positions
    const passiveBob = 2.5 * Math.sin(t * 0.00055) + 1 * Math.sin(t * 0.00093);
    const cx = Math.round(shipX);
    const cy = Math.round(shipY + passiveBob);
    const gtp = shipGunTipPos(currentShip, cx, cy);

    // Laser lines — before ship so hull covers the origin end
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
        const bx = inv*inv*ox + 2*inv*prog*cpx + prog*prog*l.x1;
        const by = inv*inv*oy + 2*inv*prog*cpy + prog*prog*l.y1;
        const tp = Math.max(0, prog - 0.28);
        const tinv = 1 - tp;
        const trx = tinv*tinv*ox + 2*tinv*tp*cpx + tp*tp*l.x1;
        const trY = tinv*tinv*oy + 2*tinv*tp*cpy + tp*tp*l.y1;
        const alpha = Math.sin(prog * Math.PI) * 0.95;
        ctx.save();
        ctx.globalAlpha = alpha;
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
        // head — outer glow
        ctx.fillStyle = 'rgba(255,200,60,0.7)';
        ctx.shadowBlur = 22;
        ctx.shadowColor = 'rgba(255,180,0,0.9)';
        ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
        // head — bright white core
        ctx.fillStyle = 'rgba(255,255,220,1)';
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(bx, by, 2.5, 0, Math.PI * 2); ctx.fill();
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
        ? Math.min(1, Math.hypot(drone.x - shipX, drone.y - shipY) / 20)
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

      // Drone sprite — always points up, engine flare at exhaust end
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

    // Ship config for current selection
    const _SCFG = _SHIP_CONFIGS[currentShip];
    const _shipBmp = _SCFG.bmp;
    const flareBase = cy + bmpH(_shipBmp) * PX / 2 - 5;
    const ft = t * 0.005;

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
        // Streak trail
        if (p1 > 0.35) {
          const tlen = 30 + p1 * 100;
          const sg = ctx.createLinearGradient(0, offY, 0, offY + tlen);
          sg.addColorStop(0, `rgba(180,225,255,${(p1 * 0.55).toFixed(2)})`);
          sg.addColorStop(1, 'rgba(180,225,255,0)');
          ctx.fillStyle = sg; ctx.fillRect(-2, offY, 4, tlen);
        }
        ctx.save();
        ctx.translate(0, offY);
        ctx.scale(scX, 1 + p1 * 5.5);
        const wa = p2 > 0.3 ? Math.max(0, 1 - (p2 - 0.3) / 0.7) : 1;
        drawBmp(ctx, _shipBmp, 0, 0, `rgba(200,235,255,${wa.toFixed(2)})`, 'rgba(160,220,255,0.7)', PX);
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
          sg.addColorStop(0, `rgba(210,240,255,${(0.5 + p1 * 0.4).toFixed(2)})`);
          sg.addColorStop(1, 'rgba(180,225,255,0)');
          ctx.fillStyle = sg; ctx.fillRect(-2, streakY, 4, tlen);
        }
        // Ship materializes
        if (p2 > 0) {
          const scX2 = Math.min(1, p2 / 0.55);
          const scY2 = Math.max(1, 4 - p2 * 4.5);
          const wa2 = Math.min(1, p2 * 1.4).toFixed(2);
          ctx.save();
          ctx.scale(Math.max(0.08, scX2), Math.max(1, scY2));
          drawBmp(ctx, _shipBmp, 0, 0, `rgba(200,235,255,${wa2})`, 'rgba(160,220,255,0.65)', PX);
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
      ctx.save();
      ctx.globalAlpha = Math.max(0, flicker * sp);
      for (const f of _SCFG.flares) drawEngineFlare(cx + f.xOff, flareBase + f.yOff, ft, f.size, (f.len ?? f.size));
      ctx.restore();
      const sa = 0.22 + sp * 0.73;
      const pdCol  = _SCFG.color.replace(/[\d.]+\)$/, `${sa.toFixed(3)})`);
      const pdGlow = sp > 0.35 ? _SCFG.glow : null;
      drawBmp(ctx, _shipBmp, cx, cy, pdCol, pdGlow, PX);
    } else if (shipPowerState === 'startup') {
      const sp = Math.min(1, (t - startupAt) / STARTUP_DUR);
      const burst = sp < 0.20 ? 1 + 2.5 * (1 - sp / 0.20) : 1;
      const flicker = sp > 0.20 && sp < 0.48
        ? Math.abs(Math.sin(t * 0.045)) * Math.abs(Math.sin(t * 0.011 + 1.3))
        : 1;
      ctx.save();
      ctx.globalAlpha = sp < 0.20 ? sp / 0.20 : Math.min(1, flicker);
      for (const f of _SCFG.flares) drawEngineFlare(cx + f.xOff, flareBase + f.yOff, ft, f.size * burst, (f.len ?? f.size) * burst);
      ctx.restore();
      const sa = 0.22 + sp * 0.73;
      const suCol  = _SCFG.color.replace(/[\d.]+\)$/, `${sa.toFixed(3)})`);
      const suGlow = sp > 0.35 ? _SCFG.glow : null;
      drawBmp(ctx, _shipBmp, cx, cy, suCol, suGlow, PX);
    } else {
      const idleEngineScale = 1 - idleBlend * 0.35;
      const idleEngineAlpha = 1 - idleBlend * (0.32 - 0.12 * Math.abs(Math.sin(t * 0.0018)));
      ctx.save();
      ctx.globalAlpha = idleEngineAlpha;
      for (const f of _SCFG.flares) drawEngineFlare(cx + f.xOff, flareBase + f.yOff, ft, f.size * idleEngineScale, (f.len ?? f.size) * idleEngineScale);
      ctx.restore();
      drawBmp(ctx, _shipBmp, cx, cy, _SCFG.color, _SCFG.glow, PX);
    }

    // Muzzle flash and gun checks — skip during warp
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

    // ── HUD Strip ────────────────────────────────────────────
    ctx.save();
    ctx.translate(shakeSx, shakeSy);
    ctx.globalAlpha = 0.5;

    const SH = 108, SY = H - SH;
    const INT_W = 240, TDB_W = 220, OPT_W = 120;
    const INTEL_X = INT_W, TDB_X = W - TDB_W - OPT_W, OPT_X = W - OPT_W;
    const INTEL_W = TDB_X - INT_W;

    // Background
    ctx.fillStyle = 'rgba(8,11,16,0.72)';
    ctx.fillRect(0, SY, W, SH);
    // Inner glow at top edge (cached — changes only on resize)
    if (_hudGlowGradSY !== SY) {
      _hudGlowGrad = ctx.createLinearGradient(0, SY, 0, SY + 30);
      _hudGlowGrad.addColorStop(0, 'rgba(140,160,175,0.07)'); _hudGlowGrad.addColorStop(1, 'rgba(140,160,175,0)');
      _hudGlowGradSY = SY;
    }
    ctx.fillStyle = _hudGlowGrad; ctx.fillRect(0, SY + 1, W, 29);

    // Bracket corners on outer strip + module divider tick marks
    const _arm = 18;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(140,160,175,0.42)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(_arm, SY);     ctx.lineTo(0, SY);     ctx.lineTo(0, SY + _arm);
    ctx.moveTo(W - _arm, SY); ctx.lineTo(W, SY);     ctx.lineTo(W, SY + _arm);
    ctx.moveTo(0, SY + SH - _arm); ctx.lineTo(0, SY + SH); ctx.lineTo(_arm, SY + SH);
    ctx.moveTo(W, SY + SH - _arm); ctx.lineTo(W, SY + SH); ctx.lineTo(W - _arm, SY + SH);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(140,160,175,0.18)'; ctx.lineWidth = 1.5;
    for (const _dx of [INT_W, TDB_X, OPT_X]) {
      ctx.beginPath();
      ctx.moveTo(_dx, SY);         ctx.lineTo(_dx, SY + _arm);
      ctx.moveTo(_dx, SY + SH);    ctx.lineTo(_dx, SY + SH - _arm);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    const _modLabel = (text, x, align = 'left') => {
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.textAlign = align; ctx.fillStyle = 'rgba(65,165,200,0.38)';
      ctx.fillText(text, x, SY + 20);
    };
    const _fmtN = n => n == null ? '—' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e4 ? (n/1e3).toFixed(2)+'K' : String(n);

    // ── INTERCEPT ──────────────────────────────────────────
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
    ctx.font = '15px "Press Start 2P", monospace';
    if (shieldGlowColor) { ctx.shadowColor = shieldGlowColor; ctx.shadowBlur = 8; }
    ctx.fillStyle = shieldColor;
    ctx.fillText(shieldStr, INT_W / 2, SY + 58);
    ctx.shadowBlur = 0;
    if (blockingEnabled === false && blockingDuration > 0) {
      const remSec = Math.max(0, Math.ceil((blockingDuration - (t - blockingOffAt)) / 1000));
      const mins = Math.floor(remSec / 60), secs = remSec % 60;
      ctx.font = '11px "Press Start 2P", monospace';
      ctx.fillStyle = 'rgba(255,100,80,0.65)';
      ctx.fillText(`${mins}:${String(secs).padStart(2,'0')}`, INT_W / 2, SY + 76);
    }
    shieldHitbox = { x: 0, y: SY, w: INT_W, h: SH };

    // Disable menu — opens upward, bracket-outline style
    if (shieldMenuOpen) {
      const mw = INT_W - 24, mItemH = 26, mPad = 8;
      const mh = DISABLE_OPTIONS.length * mItemH + mPad * 2;
      const menuX = 12, menuY = SY - mh - 6;
      ctx.fillStyle = 'rgba(4,12,26,0.97)';
      ctx.fillRect(menuX, menuY, mw, mh);
      const _ma = 10;
      ctx.strokeStyle = 'rgba(55,195,235,0.38)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(menuX + _ma, menuY);     ctx.lineTo(menuX, menuY);     ctx.lineTo(menuX, menuY + _ma);
      ctx.moveTo(menuX + mw - _ma, menuY); ctx.lineTo(menuX + mw, menuY); ctx.lineTo(menuX + mw, menuY + _ma);
      ctx.moveTo(menuX, menuY + mh - _ma); ctx.lineTo(menuX, menuY + mh); ctx.lineTo(menuX + _ma, menuY + mh);
      ctx.moveTo(menuX + mw, menuY + mh - _ma); ctx.lineTo(menuX + mw, menuY + mh); ctx.lineTo(menuX + mw - _ma, menuY + mh);
      ctx.stroke();
      ctx.font = '11px "Press Start 2P", monospace';
      shieldMenuItems = DISABLE_OPTIONS.map((opt, idx) => {
        const iy = menuY + mPad + idx * mItemH;
        const hb = { x: menuX, y: iy, w: mw, h: mItemH };
        const hov = mouseX >= hb.x && mouseX <= hb.x + hb.w && mouseY >= hb.y && mouseY <= hb.y + hb.h;
        if (hov) { ctx.fillStyle = 'rgba(55,195,235,0.14)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
        ctx.textAlign = 'left';
        ctx.fillStyle = hov ? 'rgba(185,245,255,0.95)' : 'rgba(80,175,215,0.80)';
        ctx.fillText(opt.label, menuX + 12, iy + 18);
        return { ...opt, hitbox: hb };
      });
    } else {
      shieldMenuItems = [];
    }

    // ── INTEL ──────────────────────────────────────────────
    _modLabel('STATS', INTEL_X + INTEL_W / 2, 'center');
    const hsBlocked = hudStats.blocked;
    const hsAllowed = hudStats.queries != null && hudStats.blocked != null ? hudStats.queries - hudStats.blocked : null;
    const hsTotal = hudStats.queries;
    const pct = hudStats.percent;
    const intelCols = [
      { val: _fmtN(hsTotal),    label: 'total',     color: 'rgba(100,155,220,0.80)' },
      { val: _fmtN(hsBlocked),  label: 'blocked',   color: 'rgba(255,70,60,0.90)'   },
      { val: _fmtN(hsAllowed),  label: 'allowed',   color: 'rgba(50,215,120,0.90)'  },
      { val: pct != null ? pct.toFixed(1)+'%' : '—', label: 'intercept',
        color: pct == null ? 'rgba(150,150,150,0.50)' : pct >= 60 ? 'rgba(50,215,120,0.85)' : pct >= 40 ? 'rgba(210,220,70,0.85)' : 'rgba(255,110,50,0.85)' },
    ];
    const cellW = INTEL_W / intelCols.length;
    intelCols.forEach(({ val, label, color }, i) => {
      const icx = INTEL_X + cellW * i + cellW / 2;
      ctx.textAlign = 'center';
      ctx.font = '16px "Press Start 2P", monospace';
      ctx.fillStyle = color;
      ctx.fillText(val, icx, SY + 60);
      ctx.font = '11px "Press Start 2P", monospace';
      ctx.fillStyle = 'rgba(70,130,165,0.45)';
      ctx.fillText(label, icx, SY + 80);
    });

    // ── GRAVITY ────────────────────────────────────────────
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
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.fillStyle = sigsColor;
    ctx.fillText(sigsStr, TDB_X + TDB_W / 2, SY + 60);
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(70,130,165,0.45)';
    ctx.fillText('known threats', TDB_X + TDB_W / 2, SY + 80);
    // Update arrow — left side of section
    const _aW = bmpW(ARROW_DOWN_BMP) * ARROW_PX;
    const _aX = TDB_X + 30, _aY = SY + 52;
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

    // ── SHIPS / OPTIONS ────────────────────────────────────
    _modLabel('SHIPS', OPT_X + OPT_W / 2, 'center');
    const _canSelectShip = blockingEnabled === true && shipPowerState === 'up' && warpState === 'none';
    const _shipLabels = { protector: 'PROTECTOR', falcon: 'FALCON', enterprise: 'ENTERPRISE*' };
    ctx.textAlign = 'center';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.fillStyle = shipMenuHovered && _canSelectShip ? 'rgba(185,245,255,0.90)' : 'rgba(80,165,200,0.60)';
    ctx.fillText(_shipLabels[currentShip], OPT_X + OPT_W / 2, SY + 58);
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.fillStyle = _canSelectShip ? 'rgba(55,185,225,0.35)' : 'rgba(80,80,80,0.28)';
    ctx.fillText(_canSelectShip ? 'SELECT' : '—', OPT_X + OPT_W / 2, SY + 80);
    shipMenuHitbox = { x: OPT_X, y: SY, w: OPT_W, h: SH };

    // Ship selector popup — opens upward from OPTIONS
    if (shipMenuOpen && _canSelectShip) {
      const _ships = ['protector', 'falcon', 'enterprise'];
      const _sBmps  = { protector: PLAYER_BMP, falcon: FALCON_BMP, enterprise: ENTERPRISE_BMP };
      const _sCols  = { protector: 'rgba(160,210,255,0.85)', falcon: 'rgba(210,210,210,0.85)', enterprise: 'rgba(200,215,255,0.85)' };
      const _sGlows = { protector: 'rgba(130,195,255,0.35)', falcon: 'rgba(200,185,140,0.28)', enterprise: 'rgba(160,185,255,0.28)' };
      const _slotW = 90, _mPad = 10;
      const _mw = _ships.length * _slotW + _mPad * 2;
      const _mh = 96;
      const _mX = Math.max(4, Math.min(W - _mw - 4, OPT_X + OPT_W / 2 - _mw / 2));
      const _mY = SY - _mh - 8;
      ctx.fillStyle = 'rgba(4,12,26,0.97)';
      ctx.fillRect(_mX, _mY, _mw, _mh);
      const _ma2 = 10;
      ctx.strokeStyle = 'rgba(55,195,235,0.38)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(_mX + _ma2, _mY);        ctx.lineTo(_mX, _mY);        ctx.lineTo(_mX, _mY + _ma2);
      ctx.moveTo(_mX + _mw - _ma2, _mY);  ctx.lineTo(_mX + _mw, _mY);  ctx.lineTo(_mX + _mw, _mY + _ma2);
      ctx.moveTo(_mX, _mY + _mh - _ma2);  ctx.lineTo(_mX, _mY + _mh);  ctx.lineTo(_mX + _ma2, _mY + _mh);
      ctx.moveTo(_mX + _mw, _mY + _mh - _ma2); ctx.lineTo(_mX + _mw, _mY + _mh); ctx.lineTo(_mX + _mw - _ma2, _mY + _mh);
      ctx.stroke();
      shipMenuItems = _ships.map((s, i) => {
        const _sX  = _mX + _mPad + i * _slotW;
        const _sCX = _sX + _slotW / 2;
        const _isActive = s === currentShip;
        const hb = { x: _sX, y: _mY, w: _slotW, h: _mh };
        const hov = !_isActive && mouseX >= hb.x && mouseX <= hb.x + hb.w && mouseY >= hb.y && mouseY <= hb.y + hb.h;
        if (hov) { ctx.fillStyle = 'rgba(55,195,235,0.11)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
        ctx.save();
        ctx.globalAlpha = _isActive ? 0.28 : (hov ? 1.0 : 0.70);
        drawBmp(ctx, _sBmps[s], _sCX, _mY + _mh / 2 - 10, _sCols[s], hov ? _sGlows[s] : null, 2);
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.font = '7px "Press Start 2P", monospace';
        ctx.fillStyle = _isActive ? 'rgba(80,80,80,0.50)' : hov ? 'rgba(185,245,255,0.95)' : 'rgba(100,175,215,0.65)';
        ctx.fillText(_isActive ? 'ACTIVE' : _shipLabels[s], _sCX, _mY + _mh - 11);
        return { ship: s, hitbox: hb, active: _isActive };
      });
    } else {
      shipMenuItems = [];
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
    evtSource.onmessage = e => {
      try {
        const evts = JSON.parse(e.data);
        if (Array.isArray(evts)) queue.push(...evts);
      } catch {}
    };
    evtSource.onerror = () => {
      if (evtSource) { evtSource.close(); evtSource = null; }
      if (active) setTimeout(connect, 3000);
    };
  }

  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; shipX = W / 2; shipY = H * 0.65; }
  window.addEventListener('resize', () => { if (active) resize(); });

  // ── Public API ────────────────────────────────────────────────────
  window.enterPiholeMode = function() {
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
    domainFragments.length = 0; debris.length = 0; chainBolts.length = 0; chainRings.length = 0;
    tally.blocked = 0; tally.allowed = 0;
    drone.state = 'docked'; drone.x = 0; drone.y = 0; drone.lastFire = 0;
    drone.side = 0; drone.angle = 0; drone.targetX = null; drone.targetY = null;
    drone.deployedAt = 0; drone.recallAt = 0;
    droneMissiles.length = 0;
    hudGravity = null;
    hudStats = { blocked: null, queries: null, percent: null };
    if (hudStatsPollTimer) { clearInterval(hudStatsPollTimer); hudStatsPollTimer = null; }
    gravityState = 'idle'; gravityDoneAt = 0;
    if (gravityPollTimer) { clearTimeout(gravityPollTimer); gravityPollTimer = null; }
    blockingEnabled = null; // preserve blockingOffAt/blockingDuration so active timers survive exit/re-enter
    shipPowerState = 'up'; startupAt = 0; lastEnemyAt = 0;
    gunCheckState = 0; gunCheckFiredAt = [0, 0];
    shieldMenuOpen = false; shieldMenuItems = []; shieldHovered = false;
    shipMenuOpen = false; shipMenuItems = []; shipMenuHovered = false;
    currentShip = 'protector'; warpState = 'none'; warpAt = 0; warpNextShip = null;
    shakeAt = 0; shakeDur = 0; shakeAmp = 0;
    mouseX = -1; mouseY = -1;
    // Restore timed-block state that may have been set before navigating away
    const _saved = JSON.parse(sessionStorage.getItem('ph_block_timer') || 'null');
    if (_saved && _saved.duration > 0) {
      const _elapsed = Date.now() - _saved.wallOffAt;
      if (_elapsed < _saved.duration) {
        blockingOffAt = performance.now() - _elapsed;
        blockingDuration = _saved.duration;
        shipPowerState = 'down';
      } else {
        sessionStorage.removeItem('ph_block_timer');
      }
    }
    function fetchPiholeStats() {
      fetch('/api/pihole/stats', { signal: AbortSignal.timeout(1800) }).then(r => r.json()).then(d => {
        if (d.gravity != null) hudGravity = d.gravity;
        if (d.blocking != null) {
          blockingEnabled = d.blocking;
          if (!blockingEnabled && shipPowerState === 'up') shipPowerState = 'down';
        }
        if (d.blocked != null) hudStats.blocked = d.blocked;
        if (d.queries != null) hudStats.queries = d.queries;
        if (d.percent != null) hudStats.percent = d.percent;
      }).catch(() => {});
    }
    const _phLink = document.getElementById('pihole-link');
    if (_phLink) _phLink.style.display = 'block';
    fetchPiholeStats();
    hudStatsPollTimer = setInterval(fetchPiholeStats, 1000);
    connect();
    requestAnimationFrame(t => {
      lastT = t; lastSpawn = t;
      canvas.style.opacity = '1';  // triggers the 0.6s transition after first paint
      requestAnimationFrame(tick);
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
    const _phLinkExit = document.getElementById('pihole-link');
    if (_phLinkExit) _phLinkExit.style.display = 'none';
    warpState = 'none'; warpNextShip = null;
    blockingEnabled = null; // preserve blockingOffAt/blockingDuration so active timers survive exit/re-enter
    canvas.style.cursor = '';
    if (evtSource) { evtSource.close(); evtSource = null; }
    setTimeout(() => {
      active = false;  // stop tick only after fade completes — game keeps running during fade
      ctx.clearRect(0, 0, W, H);
      shipPowerState = 'up'; gunCheckState = 0; lastEnemyAt = 0;
      entities.length = 0; lasers.length = 0; explosions.length = 0; queue.length = 0;
      domainFragments.length = 0; debris.length = 0; chainBolts.length = 0; chainRings.length = 0;
      drone.state = 'docked'; drone.angle = 0; drone.targetX = null; drone.targetY = null;
      drone.deployedAt = 0; drone.recallAt = 0;
      droneMissiles.length = 0;
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
      if (drone.state !== 'docked') drone.state = 'docking';
    } else {
      blockingDuration = 0;
      sessionStorage.removeItem('ph_block_timer');
      gunCheckState = 0; gunCheckFiredAt = [0, 0];
      shipPowerState = 'startup'; startupAt = performance.now();
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
              if (d.gravity != null && d.gravity !== prevGravity) {
                hudGravity = d.gravity;
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

  canvas.addEventListener('click', e => {
    if (!active) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    // Ship menu open — click selects or dismisses
    if (shipMenuOpen) {
      e.stopPropagation();
      for (const item of shipMenuItems) {
        if (_inBox(mx, my, item.hitbox)) {
          if (!item.active) initWarpOut(item.ship);
          return;
        }
      }
      shipMenuOpen = false;
      return;
    }

    // Shield menu open — click selects or dismisses
    if (shieldMenuOpen) {
      e.stopPropagation();
      for (const item of shieldMenuItems) {
        if (_inBox(mx, my, item.hitbox)) { setBlocking(false, item.timer); return; }
      }
      shieldMenuOpen = false;
      return;
    }

    // Ship selector toggle
    if (_inBox(mx, my, shipMenuHitbox) && blockingEnabled === true && shipPowerState === 'up' && warpState === 'none') {
      e.stopPropagation();
      shipMenuOpen = !shipMenuOpen;
      return;
    }

    // Shield toggle
    if (_inBox(mx, my, shieldHitbox)) {
      e.stopPropagation();
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
    arrowHovered = !shipMenuOpen && gravityState === 'idle' && _inBox(mouseX, mouseY, arrowHitbox);
    shieldHovered = !shipMenuOpen && _inBox(mouseX, mouseY, shieldHitbox);
    shipMenuHovered = !shieldMenuOpen && _inBox(mouseX, mouseY, shipMenuHitbox) && blockingEnabled === true && shipPowerState === 'up' && warpState === 'none';
    const overShieldMenu = shieldMenuOpen && shieldMenuItems.some(item => _inBox(mouseX, mouseY, item.hitbox));
    const overShipMenu   = shipMenuOpen   && shipMenuItems.some(item => !item.active && _inBox(mouseX, mouseY, item.hitbox));
    canvas.style.cursor = (arrowHovered || shieldHovered || overShieldMenu || shipMenuHovered || overShipMenu) ? 'pointer' : '';
  });

  // Escape: navigate back immediately (works during splash too); restart only when active.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const ret = (window.BG_CONFIG || {}).return_url;
    if (ret) {
      const veil = document.createElement('div');
      veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity 180ms linear;z-index:9999;pointer-events:none;';
      document.body.appendChild(veil);
      void veil.offsetWidth;
      veil.style.opacity = '1';
      veil.addEventListener('transitionend', () => { window.location.href = ret; }, { once: true });
      return;
    }
    if (!active) return;
    exitPiholeMode(); setTimeout(() => enterPiholeMode(), 700);
  });
})();
