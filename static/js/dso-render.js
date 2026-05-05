// ── DSO rendering & background canvas ───────────────────────────────
let clusterMembers = new Map(); // DSO name → processed star array
let bgCanvas = null, bgCtx = null, bgDirty = true, lastBgUpdate = 0;

function drawClusterMembers(c, dso, xBase, yBase, xS, yS, zoom, outerR) {
  const members = clusterMembers.get(dso.name);
  if (!members) return;
  const zs = Math.sqrt(zoom);
  // Cluster center in canvas space — used for radial density falloff
  const cx = (xBase + panRA  - dso.ra)  * xS;
  const cy = (yBase + panDec - dso.dec) * yS;
  for (const m of members) {
    const dx = (xBase + panRA  - m.ra_h) * xS;
    const dy = (yBase + panDec - m.dec)  * yS;
    if (dx < -2 || dx > w + 2 || dy < -2 || dy > h + 2) continue;
    // Fade opacity with distance from cluster center — mimics natural density profile
    const dist = Math.hypot(dx - cx, dy - cy);
    const fade = Math.max(0, 1 - dist / (outerR * 1.1));
    if (fade < 0.01) continue;
    const r  = m.r * zs;
    const op = Math.min(0.25, m.bop * zs * fade * 0.25);
    if (op < 0.015) continue;
    c.fillStyle = m.cpfx + op + ')';
    c.fillRect(dx - r, dy - r, r * 2, r * 2);
  }
}

function drawDSO(c, dx, dy, outerR, dso, ts) {
  const isGalaxy = dso.type.includes('galaxy');
  const isCl = dso.type.includes('cluster');
  // PA is astronomical: 0°=North, 90°=East, measured N-through-E.
  // Canvas: North=-y, East=-x. Rotation to align +x with the major axis:
  //   rotate(-PI/2 - pa_rad) puts +x pointing pa degrees from North toward East.
  const hasPa = dso.pa !== undefined && !isCl;
  if (hasPa) {
    const pa = dso.pa * Math.PI / 180;
    const aspect = dso.aspect ?? 1;
    c.save();
    c.translate(dx, dy);
    c.rotate(-Math.PI / 2 - pa);
    c.scale(1, aspect);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, outerR);
    if (isGalaxy) {
      g.addColorStop(0,    `rgba(${dso.color}, ${Math.min(0.9,  (0.012*ts)).toFixed(4)})`);
      g.addColorStop(0.20, `rgba(${dso.color}, ${Math.min(0.8,  (0.008*ts)).toFixed(4)})`);
      g.addColorStop(0.50, `rgba(${dso.color}, ${Math.min(0.6,  (0.004*ts)).toFixed(4)})`);
      g.addColorStop(0.80, `rgba(${dso.color}, ${Math.min(0.3,  (0.001*ts)).toFixed(4)})`);
    } else {
      g.addColorStop(0,    `rgba(${dso.color}, ${Math.min(0.9,  (0.010*ts)).toFixed(4)})`);
      g.addColorStop(0.30, `rgba(${dso.color}, ${Math.min(0.7,  (0.008*ts)).toFixed(4)})`);
      g.addColorStop(0.60, `rgba(${dso.color}, ${Math.min(0.5,  (0.004*ts)).toFixed(4)})`);
      g.addColorStop(0.85, `rgba(${dso.color}, ${Math.min(0.2,  (0.001*ts)).toFixed(4)})`);
    }
    g.addColorStop(1, `rgba(${dso.color}, 0)`);
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, outerR, 0, Math.PI * 2); c.fill();
    if (isGalaxy) {
      const nr = outerR * 0.12;
      const ng = c.createRadialGradient(0, 0, 0, 0, 0, nr);
      ng.addColorStop(0, `rgba(${dso.color}, ${Math.min(0.95, (0.06*ts)).toFixed(4)})`);
      ng.addColorStop(1, `rgba(${dso.color}, 0)`);
      c.fillStyle = ng;
      c.beginPath(); c.arc(0, 0, nr, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  } else if (isCl) {
    const hasMem = clusterMembers.has(dso.name);
    // If we have resolved members, the glow is just the unresolved halo — keep it subtle.
    // Without members, the glow is the only representation — make it more visible.
    const base = hasMem ? 0.013 : 0.016;
    const g = c.createRadialGradient(dx, dy, 0, dx, dy, outerR);
    g.addColorStop(0,    `rgba(${dso.color}, ${Math.min(0.9, (base*ts)).toFixed(4)})`);
    g.addColorStop(0.20, `rgba(${dso.color}, ${Math.min(0.7, (base*0.5*ts)).toFixed(4)})`);
    g.addColorStop(0.50, `rgba(${dso.color}, ${Math.min(0.5, (base*0.25*ts)).toFixed(4)})`);
    g.addColorStop(0.80, `rgba(${dso.color}, ${Math.min(0.2, (base*0.06*ts)).toFixed(4)})`);
    g.addColorStop(1,    `rgba(${dso.color}, 0)`);
    c.fillStyle = g;
    c.fillRect(dx - outerR, dy - outerR, outerR * 2, outerR * 2);
  } else {
    const g = c.createRadialGradient(dx, dy, 0, dx, dy, outerR);
    g.addColorStop(0,    `rgba(${dso.color}, ${Math.min(0.9, (0.010*ts)).toFixed(4)})`);
    g.addColorStop(0.30, `rgba(${dso.color}, ${Math.min(0.7, (0.008*ts)).toFixed(4)})`);
    g.addColorStop(0.60, `rgba(${dso.color}, ${Math.min(0.5, (0.004*ts)).toFixed(4)})`);
    g.addColorStop(0.85, `rgba(${dso.color}, ${Math.min(0.2, (0.001*ts)).toFixed(4)})`);
    g.addColorStop(1,    `rgba(${dso.color}, 0)`);
    c.fillStyle = g;
    c.fillRect(dx - outerR, dy - outerR, outerR * 2, outerR * 2);
  }
}

function buildBg(t) {
  if (!bgCanvas) { bgCanvas = document.createElement('canvas'); bgCtx = bgCanvas.getContext('2d'); }
  if (bgDirty) { bgCanvas.width = w; bgCanvas.height = h; }
  bgCtx.clearRect(0, 0, w, h);
  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, w, h);
  // Use zoom=1, pan=0 (the non-zen default state)
  const sra = HOME_RA_SPAN, sdec = HOME_DEC_SPAN;
  const xS = w / sra, yS = h / sdec;
  const xBase = HOME_RA + sra / 2, yBase = HOME_DEC + sdec / 2;
  // DSOs
  for (const dso of DEEP_SKY) {
    const dx = (xBase - dso.ra) * xS, dy = (yBase - dso.dec) * yS;
    const isCl = dso.type.includes('cluster');
    const outerR = dso.r * (isCl ? 1.4 : 2.0);
    if (dx < -outerR || dx > w+outerR || dy < -outerR || dy > h+outerR) continue;
    drawDSO(bgCtx, dx, dy, outerR, dso, 1);
    if (isCl) drawClusterMembers(bgCtx, dso, xBase, yBase, xS, yS, 1, outerR);
  }
  // Stars — twinkling at bg update rate (~20fps), blit at native rate
  // Only draw mag<7 stars in bg (dim ones aren't visible at zoom=1 anyway)
  for (let i = 0; i < starCache.length; i++) {
    const sc = starCache[i];
    if (sc.mag > 6.5) continue;
    const x = (xBase - sc.ra) * xS, y = (yBase - sc.dec) * yS;
    if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
    const p = sc.ph;
    let tw;
    if (p.simple) {
      tw = 1 + p.amp[0] * Math.sin(t * p.freq[0] + p.off[0]);
    } else {
      tw = 1 + p.amp[0]*Math.sin(t*p.freq[0]+p.off[0]) + p.amp[1]*Math.sin(t*p.freq[1]+p.off[1]) + p.amp[2]*Math.sin(t*p.freq[2]+p.off[2]);
      if (p.spike > 0) { tw += p.spike; p.spike *= 0.92; if (p.spike < 0.01) p.spike = 0; }
      else if (Math.random() < 0.0003) p.spike = 0.3 + Math.random() * 0.4;
    }
    const op = sc.bop * tw;
    bgCtx.fillStyle = sc.cpfx + op + ')';
    if (sc.rect) {
      bgCtx.fillRect(x - sc.r, y - sc.r, sc.r * 2, sc.r * 2);
    } else {
      bgCtx.beginPath(); bgCtx.arc(x, y, sc.r, 0, Math.PI * 2); bgCtx.fill();
    }
    if (sc.glow) {
      const r3 = sc.r * 3;
      bgCtx.beginPath(); bgCtx.arc(x, y, r3, 0, Math.PI * 2);
      const g = bgCtx.createRadialGradient(x, y, 0, x, y, r3);
      g.addColorStop(0, sc.cpfx + (op * 0.4) + ')');
      g.addColorStop(1, sc.cpfx + '0)');
      bgCtx.fillStyle = g; bgCtx.fill();
    }
  }
  // Planets — use project() which uses current globals (zoom=1, pan=0 in non-zen)
  for (const pl of planets) {
    const pd = pl.name === 'Moon' ? 1.10 : 1.08;
    const [px, py] = project(pl.ra, pl.dec, pd);
    if (px < -20 || px > w+20 || py < -20 || py > h+20) continue;
    if (pl.name === 'Moon') { drawMoonPhase(bgCtx, px, py, pl.radius, pl.glow, pl.elong); continue; }
    const pr = pl.radius;
    bgCtx.beginPath(); bgCtx.arc(px, py, pl.glow, 0, Math.PI*2);
    const gg = bgCtx.createRadialGradient(px, py, 0, px, py, pl.glow);
    gg.addColorStop(0, `rgba(${pl.color}, 0.25)`); gg.addColorStop(1, `rgba(${pl.color}, 0)`);
    bgCtx.fillStyle = gg; bgCtx.fill();
    bgCtx.beginPath(); bgCtx.arc(px, py, pr, 0, Math.PI*2);
    bgCtx.fillStyle = `rgba(${pl.color}, 0.9)`; bgCtx.fill();
    if (pl.ring) {
      bgCtx.save(); bgCtx.translate(px, py); bgCtx.rotate(0.45);
      bgCtx.beginPath(); bgCtx.ellipse(0, 0, pr*2.6, pr*0.35, 0, 0, Math.PI*2);
      bgCtx.strokeStyle = `rgba(${pl.color}, 0.55)`; bgCtx.lineWidth = 0.7; bgCtx.stroke(); bgCtx.restore();
    }
  }
  bgDirty = false;
}
