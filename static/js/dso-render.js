// ── Background canvas ────────────────────────────────────────────────
let bgCanvas = null, bgCtx = null, bgDirty = true, lastBgUpdate = 0;

function buildBg(t) {
  if (!bgCanvas) { bgCanvas = document.createElement('canvas'); bgCtx = bgCanvas.getContext('2d'); }
  // Size the offscreen to device pixels so it blits 1:1 onto the device-resolution
  // main canvas; the transform lets us keep drawing star positions in CSS pixels.
  if (bgDirty) { bgCanvas.width = Math.round(w * _dpr); bgCanvas.height = Math.round(h * _dpr); }
  bgCtx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
  bgCtx.clearRect(0, 0, w, h);
  bgCtx.fillStyle = '#000';
  bgCtx.fillRect(0, 0, w, h);
  // Use zoom=1, pan=0 (the non-zen default state)
  const sra = HOME_RA_SPAN, sdec = HOME_DEC_SPAN;
  const xS = w / sra, yS = h / sdec;
  const xBase = HOME_RA + sra / 2, yBase = HOME_DEC + sdec / 2;
  // Stars - twinkling at bg update rate (~20fps), blit at native rate
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
  // Planets - use project() which uses current globals (zoom=1, pan=0 in non-zen)
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
