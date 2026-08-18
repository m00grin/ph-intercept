// ── HUD strip ─────────────────────────────────────────────────────────
// The bottom status strip and its four canvas-drawn menus, lifted out of
// game.js render(). It was ~1000 of render()'s 2795 lines and is the part most
// likely to change, but it is not pure drawing: it also computes the menu
// hit-boxes that game.js's click handler reads back, so those are exposed as
// properties rather than hidden in the closure.
//
// No build step here, so this is a plain window global loaded before game.js
// (see templates/index.html), matching how window.BG_CONFIG / window.SKY_PRESETS
// are already consumed.
//
// Canvas state: the caller owns save/translate/restore. draw() leaves the
// context balanced, because render() keeps drawing the intercept-off vignette
// under the same transform afterwards.
(function () {
  'use strict';

  // Private to the strip: animation phase and cached gradients/CSS values.
  let _hudGlowGrad = null, _hudGlowGradSY = null, _hudHideT = 0, _hudPrevT = 0, _lastCrtFloorCss = null, _lastHudBandCss = null;

  // Immutables handed over once by game.js (see HUD.init).
  let C = null;

  const HUD = {
    // Shared with game.js: written by its pointer/resize handlers as well as here.
    revealAt: 0,
    slideAt: 0,
    slideFrom: 0,
    slideTo: 0,
    visible: true,

    // Outputs: hit-boxes computed while drawing, read by game.js hit-testing.
    settingsMenuItems: [],
    settingsMenuPopupBox: null,
    bgModeItems: [],
    bgModeBox: null,
    bgSkyItems: [],
    bgSkyBox: null,

    init(consts) { C = consts; },

    // S carries the per-frame values; see the call site in render().
    draw(ctx, S) {
      ctx.globalAlpha = 0.62;

      // Responsive layout: panel widths scale with viewport, STATS gets the remainder
      let _animSH = S.hudSH;
      if (HUD.slideAt > 0) {
        const _sp = Math.min(1, (S.t - HUD.slideAt) / C.HUD_SLIDE_DUR);
        _animSH = HUD.slideFrom + (HUD.slideTo - HUD.slideFrom) * (1 - Math.pow(1 - _sp, 3));
        if (_sp >= 1) HUD.slideAt = 0;
      }
      const SH = _animSH;
      const SY = S.H - SH - S.safeBottom;

      // ── HUD auto-hide ────────────────────────────────────────
      // Slide the whole strip below the viewport once idle; a mouse hovering the
      // bottom band (or any menu open) keeps it alive. Touch/pen have no hover, so
      // they rely on the idle timer, re-armed by taps in the reveal zone (see the
      // window pointer listeners). Sliding as a unit avoids alpha-compositing cost.
      let _hudTarget = 0;
      if (S.hudAutoHide) {
        if (HUD.revealAt === 0) HUD.revealAt = S.t;   // grace period on first frame / enable
        const _zoneTop = S.H - S.hudSH - S.safeBottom - 50;
        const _hover = S._lastPtrType === 'mouse' && S.mouseX >= 0 && S.mouseY >= _zoneTop;
        const _menusOpen = S.settingsMenuOpen || C.P1.shieldMenuOpen || C.P1.shipMenuOpen || C.P2.shieldMenuOpen || C.P2.shipMenuOpen;
        // A gravity/blocklist pull in progress keeps the HUD up so the UPDATING
        // status stays visible until it lands.
        const _gravityBusy = C.P1.gravityState === 'updating' || C.P2.gravityState === 'updating';
        if (_hover || _menusOpen || _gravityBusy) HUD.revealAt = S.t;
        if (S.t - HUD.revealAt > C.AUTOHIDE_MS) _hudTarget = 1;
      }
      const _hdt = _hudPrevT ? Math.min(S.t - _hudPrevT, 80) : 16;
      _hudPrevT = S.t;
      _hudHideT += (_hudTarget - _hudHideT) * Math.min(1, _hdt / C.HUD_FADE_DUR);
      if (_hudHideT < 0.001) _hudHideT = 0;
      else if (_hudHideT > 0.999) _hudHideT = 1;
      HUD.visible = _hudHideT < 0.5;
      const _hudSlideY = _hudHideT * (S.hudSH + S.safeBottom + 8);
      if (_hudHideT > 0) ctx.translate(0, _hudSlideY);

      // Lock the DOM burger button to the canvas HUD: same warp shake, same auto-hide
      // slide. (The button lives above the canvas, so it can't inherit the ctx transform.)
      if (C.settingsBtnEl) {
        C.settingsBtnEl.style.transform = `translate(${S.shakeSx.toFixed(2)}px, ${(S.shakeSy + _hudSlideY).toFixed(2)}px)`;
        if (S.hudAutoHide && !HUD.visible && !S.settingsMenuOpen) C.settingsBtnEl.style.pointerEvents = 'none';
      }

      // Keep the CRT's HUD-easing in step with the auto-hide slide: the eased band
      // shrinks as the strip slides off (--hud-h tracks the strip's on-screen top
      // edge) and its reduction fades to full (--crt-floor -> 1), so the filter fills
      // straight back in over the space the HUD vacated. Change-detected so the CSS
      // var only rewrites during the slide, not every frame.
      const _hudBandH = Math.max(0, Math.round(S.hudSH + S.safeBottom - _hudSlideY));
      if (_hudBandH !== _lastHudBandCss) {
        _lastHudBandCss = _hudBandH;
        document.documentElement.style.setProperty('--hud-h', _hudBandH + 'px');
      }
      const _crtFloor = (0.58 + 0.42 * _hudHideT).toFixed(3);
      if (_crtFloor !== _lastCrtFloorCss) {
        _lastCrtFloorCss = _crtFloor;
        document.documentElement.style.setProperty('--crt-floor', _crtFloor);
      }

      const INT_W  = Math.min(240, Math.max(150, Math.round(S.W * 0.30)));
      const OPT_W  = S.W < 480 ? 0   : Math.min(140, Math.max(95,  Math.round(S.W * 0.16)));
      const TDB_W  = Math.min(250, Math.max(140, Math.round(S.W * 0.28)));
      const TDB_X  = S.W - TDB_W - OPT_W;
      const INTEL_X = INT_W, OPT_X = S.W - OPT_W;
      const INTEL_W = Math.max(0, TDB_X - INT_W);

      // Scaled fonts
      const _fs = S.W < 480 ? 0.75 : S.W < 660 ? 0.87 : 1;
      const _fVal   = Math.max(10, Math.round(16 * _fs));
      const _fSub   = Math.max(8,  Math.round(10 * _fs));
      const _fLabel = _fs < 1 ? 8 : 10;
      const _fShip  = Math.max(8,  Math.round(12 * _fs));

      // In 2P mode the strip is two rows; _rowH is the height of each row
      const _isP2 = S.twoPlayerMode !== 'off';
      const _rowH = _isP2 ? (S.W < 480 ? 66 : S.W < 660 ? 76 : 86) : SH;
      const _p2RowSY = SY + _rowH + 1;

      // Scaled Y anchors (proportional to row height)
      // _yLabel uses the 1P row height so the top-label distance from the HUD edge is consistent in both modes
      const _1pSH = S.W < 480 ? 84 : S.W < 660 ? 94 : 108;
      const _yLabel = SY + Math.round(_1pSH * 0.185);
      const _yVal   = SY + Math.round(_rowH * 0.574);
      const _ySub   = SY + Math.round(_rowH * 0.745);
      const _yLabel2 = _p2RowSY + Math.round(_rowH * 0.185);
      const _yVal2   = _p2RowSY + Math.round(_rowH * 0.574);
      const _ySub2   = _p2RowSY + Math.round(_rowH * 0.745);
      // In 2P mode, column sublabels (total/blocked/etc.) slide to sit on the row centerline
      const _ySubLabel = _isP2 ? SY + _rowH + Math.round(_fLabel * 0.45) : _ySub;
      // Extra clip height to let centerline labels render in 2P mode
      const _lbExtra = _isP2 ? Math.round(_fLabel * 1.1) : 0;


      // Background
      ctx.fillStyle = 'rgba(8,11,16,0.80)';
      ctx.fillRect(0, SY, S.W, SH);
      // Inner glow at top edge (cached - changes only on resize)
      const _glowH = Math.round(SH * 0.28);
      if (_hudGlowGradSY !== SY) {
        _hudGlowGrad = ctx.createLinearGradient(0, SY, 0, SY + _glowH);
        _hudGlowGrad.addColorStop(0, 'rgba(140,160,175,0.07)'); _hudGlowGrad.addColorStop(1, 'rgba(140,160,175,0)');
        _hudGlowGradSY = SY;
      }
      ctx.fillStyle = _hudGlowGrad; ctx.fillRect(0, SY + 1, S.W, _glowH - 1);

      // Bracket corners on outer strip + module divider tick marks
      const _arm = Math.round(18 * SH / 108);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(140,160,175,0.42)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(_arm, SY);     ctx.lineTo(0, SY);     ctx.lineTo(0, SY + _arm);
      ctx.moveTo(S.W - _arm, SY); ctx.lineTo(S.W, SY);     ctx.lineTo(S.W, SY + _arm);
      ctx.moveTo(0, SY + SH - _arm); ctx.lineTo(0, SY + SH); ctx.lineTo(_arm, SY + SH);
      ctx.moveTo(S.W, SY + SH - _arm); ctx.lineTo(S.W, SY + SH); ctx.lineTo(S.W - _arm, SY + SH);
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
      const _p2ModLabel = (text, x, align = 'left') => {
        ctx.font = `${_fLabel}px "Press Start 2P", monospace`;
        ctx.textAlign = align; ctx.fillStyle = 'rgba(55,190,170,0.40)';
        ctx.fillText(text, x, _yLabel2);
      };
      const _fmtN = n => n == null ? '—' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e4 ? (n/1e3).toFixed(2)+'K' : String(n);
      const _fmtGravity = n => {
        if (n == null) return '—';
        n = Math.round(n);
        if (n < 100000)   return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        if (n < 1000000)  return (n / 1000).toFixed(1) + 'K';
        if (n < 10000000) return (n / 1000000).toFixed(3) + 'M';
        if (n < 100000000) return (n / 1000000).toFixed(2) + 'M';
        return (n / 1000000).toFixed(1) + 'M';
      };

      // ── INTERCEPT ──────────────────────────────────────────
      ctx.save();
      ctx.beginPath(); ctx.rect(0, SY, INT_W, _rowH); ctx.clip();
      _modLabel('INTERCEPT', INT_W / 2, 'center');
      if (_isP2 && C.P1.blockingEnabled !== null && S.shipPowerState !== 'powerdown' && S.shipPowerState !== 'startup') {
        ctx.font = `${_fSub + 2}px "Press Start 2P", monospace`;
        ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(100,155,220,0.50)';
        ctx.fillText('P1', 26, _yVal);
      }
      let shieldStr, shieldColor, shieldGlowColor = null;
      if (C.P1.blockingEnabled === null) {
        shieldStr = 'STANDBY'; shieldColor = 'rgba(150,150,150,0.35)';
      } else if (S.shipPowerState === 'powerdown') {
        const sp = Math.max(0, 1 - (S.t - C.P1.powerdownAt) / C.POWERDOWN_DUR);
        const f = 0.5 + 0.5 * Math.abs(Math.sin(S.t * 0.012));
        shieldStr = 'POWERING DOWN';
        shieldColor = `rgba(255,160,50,${(0.45 + 0.4 * sp * f).toFixed(2)})`;
      } else if (C.P1.blockingEnabled === false) {
        shieldStr = 'OFFLINE';
        shieldColor = 'rgba(255,80,60,0.90)'; shieldGlowColor = 'rgba(255,80,60,0.35)';
      } else if (S.shipPowerState === 'startup') {
        const sp = (S.t - C.P1.startupAt) / C.STARTUP_DUR;
        if (sp > 0.72) {
          const f = 0.6 + 0.4 * Math.abs(Math.sin(S.t * 0.016));
          shieldStr = 'ONLINE';
          shieldColor = `rgba(50,215,120,${(0.55 + 0.45 * f).toFixed(2)})`;
          shieldGlowColor = `rgba(50,215,120,${(f * 0.45).toFixed(2)})`;
        } else {
          shieldStr = 'STARTING...';
          shieldColor = `rgba(210,200,70,${(0.4 + 0.3 * Math.abs(Math.sin(S.t * 0.009))).toFixed(2)})`;
        }
      } else {
        shieldStr = 'ACTIVE';
        shieldColor = C.P1.shieldHovered ? 'rgba(50,215,120,0.95)' : 'rgba(50,215,120,0.75)';
        shieldGlowColor = C.P1.shieldHovered ? 'rgba(50,215,120,0.35)' : null;
      }
      ctx.textAlign = 'center';
      ctx.font = `${_fVal}px "Press Start 2P", monospace`;
      if (shieldGlowColor) { ctx.shadowColor = shieldGlowColor; ctx.shadowBlur = 8; }
      ctx.fillStyle = shieldColor;
      ctx.fillText(shieldStr, INT_W / 2, _yVal);
      const _shieldTW = ctx.measureText(shieldStr).width;
      ctx.shadowBlur = 0;
      const _hasTimer = C.P1.blockingEnabled === false && C.P1.blockingDuration > 0;
      if (_hasTimer) {
        const remSec = Math.max(0, Math.ceil((C.P1.blockingDuration - (S.t - C.P1.blockingOffAt)) / 1000));
        const mins = Math.floor(remSec / 60), secs = remSec % 60;
        ctx.font = `${_fSub}px "Press Start 2P", monospace`;
        ctx.fillStyle = 'rgba(255,100,80,0.65)';
        ctx.fillText(`${mins}:${String(secs).padStart(2,'0')}`, INT_W / 2, _ySub);
      }
      {
        const _hbPad = 10;
        const _hbTop = _yVal - Math.round(_fVal * 0.95);
        const _hbH = _hasTimer ? Math.round(_fVal * 0.95 + _fSub * 2.2) : Math.round(_fVal * 1.35);
        C.P1.shieldHitbox = { x: INT_W / 2 - _shieldTW / 2 - _hbPad, y: _hbTop, w: _shieldTW + _hbPad * 2, h: _hbH };
      }
      ctx.restore();

      // Disable menu - opens upward, bracket-outline style
      if (C.P1.shieldMenuOpen) {
        const mw = 150, mItemH = 26, mPad = 8;
        const mh = C.DISABLE_OPTIONS.length * mItemH + mPad * 2;
        const menuX = Math.max(0, Math.min(S.W - mw, Math.round(INT_W / 2 - mw / 2))), menuY = SY - mh - 6;
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
        C.P1.shieldMenuPopupBox = { x: menuX, y: menuY, w: mw, h: mh };
        C.P1.shieldMenuItems = C.DISABLE_OPTIONS.map((opt, idx) => {
          const iy = menuY + mPad + idx * mItemH;
          const hb = { x: menuX, y: iy, w: mw, h: mItemH };
          const hov = S.mouseX >= hb.x && S.mouseX < hb.x + hb.w && S.mouseY >= hb.y && S.mouseY < hb.y + hb.h;
          if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
          ctx.textAlign = 'left';
          ctx.fillStyle = hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
          ctx.fillText(opt.label, menuX + 14, iy + 18);
          const timer = opt.timerFn ? opt.timerFn() : opt.timer;
          return { ...opt, timer, hitbox: hb };
        });
      } else {
        C.P1.shieldMenuItems = [];
        C.P1.shieldMenuPopupBox = null;
      }

      // ── Settings menu - opens upward from bottom-left, bracket-outline style ──
      if (S.settingsMenuOpen) {
        const _sitems = [
          { key: 'friendlies', label: 'FRIENDLIES', state: S.showFriendlies, divAfter: true },
          { key: 'client',     label: 'CLIENT',      state: S.showClient },
          { key: 'domain',     label: 'DOMAIN',     state: S.showDomain, divAfter: true },
          { key: 'crt',        label: 'CRT FILTER',  state: S.crtEnabled },
          { key: 'autohide',   label: 'AUTO-HIDE',   state: S.hudAutoHide },
        ];
        const smw = 186, smItemH = 28, smPad = 10, smDivH = 10, smPhRowH = 34;
        const _has2P = window.TWO_PLAYER_ENABLED !== false;
        let _togH = 0;
        for (const it of _sitems) { _togH += smItemH; if (it.divAfter) _togH += smDivH; }
        // Background section: a single BACKGROUND row; mode + sky presets live in flyouts off it.
        const _bgRows = 1;
        const smh = smPad + _togH + _bgRows * smItemH + (_has2P ? smDivH + smItemH : 0) + smDivH + smPhRowH + (S.twoPlayerMode === 'local' && window.P2_DASHBOARD ? smPhRowH : 0) + smPad;
        const smX = 6, smY = SY - smh - 6;
        HUD.settingsMenuPopupBox = { x: smX, y: smY, w: smw, h: smh };
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
        HUD.settingsMenuItems = [];
        ctx.font = `${_fSub}px "Press Start 2P", monospace`;
        for (const item of _sitems) {
          const hb = { x: smX, y: siy, w: smw, h: smItemH };
          // Row label (static, no row-level hover)
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(175,200,238,0.65)';
          ctx.fillText(item.label, smX + 12, siy + 19);
          // Toggle switch (track + sliding knob); hover state on pill only
          const pillW = 36, pillH = 14, pillX = smX + smw - 12 - pillW, pillY = siy + (smItemH - pillH) / 2;
          const pillHov = S.mouseX >= pillX && S.mouseX <= pillX + pillW && S.mouseY >= pillY && S.mouseY <= pillY + pillH;
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
          HUD.settingsMenuItems.push({ key: item.key, hitbox: { x: pillX - 4, y: pillY - 6, w: pillW + 8, h: pillH + 12 } });
          siy += smItemH;
          if (item.divAfter) {
            ctx.strokeStyle = 'rgba(140,160,175,0.14)'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(smX + 10, siy + smDivH / 2); ctx.lineTo(smX + smw - 10, siy + smDivH / 2);
            ctx.stroke();
            siy += smDivH;
          }
        }
        // ── Background row: label + '>' that opens the mode flyout; selection lives there. ──
        let _bgModeRowY = siy;
        {
          const _bgHb = { x: smX, y: siy, w: smw, h: smItemH };
          const _bgHov = (S.mouseX >= _bgHb.x && S.mouseX <= _bgHb.x + _bgHb.w && S.mouseY >= _bgHb.y && S.mouseY <= _bgHb.y + _bgHb.h) || S.bgMenuOpen;
          if (_bgHov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(_bgHb.x, _bgHb.y, _bgHb.w, _bgHb.h); }
          ctx.font = `${_fSub}px "Press Start 2P", monospace`;
          ctx.textAlign = 'left';
          ctx.fillStyle = _bgHov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
          ctx.fillText('BACKGROUND', smX + 12, siy + 19);
          const _bAx = smX + smw - 14, _bAy = siy + smItemH / 2;
          ctx.strokeStyle = _bgHov ? 'rgba(215,225,248,0.70)' : 'rgba(140,160,175,0.32)';
          ctx.lineWidth = 1.5; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(_bAx - 4, _bAy - 4); ctx.lineTo(_bAx + 4, _bAy); ctx.lineTo(_bAx - 4, _bAy + 4);
          ctx.stroke();
          HUD.settingsMenuItems.push({ key: 'bg-mode', hitbox: _bgHb });
          _bgModeRowY = siy;
          siy += smItemH;
        }
        if (_has2P) {
          // Divider before 2P MODE row
          ctx.strokeStyle = 'rgba(140,160,175,0.14)'; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(smX + 10, siy + smDivH / 2); ctx.lineTo(smX + smw - 10, siy + smDivH / 2);
          ctx.stroke();
          siy += smDivH;
          // 2P MODE row
          {
            const tpHb = { x: smX, y: siy, w: smw, h: smItemH };
            const tpHov = S.mouseX >= tpHb.x && S.mouseX <= tpHb.x + tpHb.w && S.mouseY >= tpHb.y && S.mouseY <= tpHb.y + tpHb.h;
            if (tpHov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(tpHb.x, tpHb.y, tpHb.w, tpHb.h); }
            ctx.textAlign = 'left';
            ctx.font = `${_fSub}px "Press Start 2P", monospace`;
            ctx.fillStyle = tpHov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.55)';
            ctx.fillText('2-PLAYER MODE', smX + 12, siy + 19);
            const _tpAx = smX + smw - 14, _tpAy = siy + smItemH / 2;
            ctx.strokeStyle = tpHov ? 'rgba(215,225,248,0.70)' : 'rgba(140,160,175,0.32)';
            ctx.lineWidth = 1.5; ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(_tpAx - 4, _tpAy - 4); ctx.lineTo(_tpAx + 4, _tpAy); ctx.lineTo(_tpAx - 4, _tpAy + 4);
            ctx.stroke();
            HUD.settingsMenuItems.push({ key: '2p-mode', hitbox: tpHb });
            siy += smItemH;
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
          const phHov = S.mouseX >= phHb.x && S.mouseX <= phHb.x + phHb.w && S.mouseY >= phHb.y && S.mouseY <= phHb.y + phHb.h;
          if (phHov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(phHb.x, phHb.y, phHb.w, phHb.h); }
          // Provider icon (Pi-hole, AdGuard, or Technitium)
          const _iconAspect = C.PROVIDER_ICON_ASPECT;
          const iconH = smPhRowH - 8, iconW = Math.round(iconH * _iconAspect);
          const iconX = smX + 12, iconY = siy + (smPhRowH - iconH) / 2;
          if (C._phIcon.complete && C._phIcon.naturalWidth > 0) {
            ctx.save();
            ctx.globalAlpha = phHov ? 0.88 : 0.45;
            ctx.drawImage(C._phIcon, iconX, iconY, iconW, iconH);
            ctx.restore();
          }
          // Label (shrink to fit so long names don't collide with the link arrow at smX+smw-14)
          ctx.textAlign = 'left';
          const _phLbl = _isP2 ? C.PROVIDER_NAME + ' 1' : C.PROVIDER_NAME;
          const _phLblX = iconX + iconW + 12;
          C._fitLabelFont(_phLbl, (smX + smw - 19) - _phLblX - 4, _fSub);
          ctx.fillStyle = phHov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.55)';
          ctx.fillText(_phLbl, _phLblX, siy + smPhRowH / 2 + 6);
          // External link arrow drawn with lines
          const _ax = smX + smw - 14, _ay = siy + smPhRowH / 2;
          ctx.strokeStyle = phHov ? 'rgba(215,225,248,0.70)' : 'rgba(140,160,175,0.32)';
          ctx.lineWidth = 1.5; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(_ax - 5, _ay + 4); ctx.lineTo(_ax + 4, _ay - 4);
          ctx.moveTo(_ax - 1, _ay - 4); ctx.lineTo(_ax + 4, _ay - 4); ctx.lineTo(_ax + 4, _ay + 1);
          ctx.stroke();
          HUD.settingsMenuItems.push({ key: 'pihole-link', hitbox: phHb });
          siy += smPhRowH;
          // PI-HOLE 2 admin link (local 2P mode only)
          if (S.twoPlayerMode === 'local' && window.P2_DASHBOARD) {
            const ph2Hb = { x: smX, y: siy, w: smw, h: smPhRowH };
            const ph2Hov = !phHov && S.mouseX >= ph2Hb.x && S.mouseX <= ph2Hb.x + ph2Hb.w && S.mouseY >= ph2Hb.y && S.mouseY <= ph2Hb.y + ph2Hb.h;
            ctx.strokeStyle = 'rgba(140,160,175,0.10)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(smX + 30, siy + 0.5); ctx.lineTo(smX + smw - 10, siy + 0.5); ctx.stroke();
            if (ph2Hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(ph2Hb.x, ph2Hb.y, ph2Hb.w, ph2Hb.h); }
            const _icon2H = smPhRowH - 8, _icon2W = Math.round(_icon2H * C.PROVIDER_ICON_ASPECT);
            const _icon2X = smX + 12, _icon2Y = siy + (smPhRowH - _icon2H) / 2;
            if (C._phIcon.complete && C._phIcon.naturalWidth > 0) {
              ctx.save(); ctx.globalAlpha = ph2Hov ? 0.88 : 0.45;
              ctx.drawImage(C._phIcon, _icon2X, _icon2Y, _icon2W, _icon2H);
              ctx.restore();
            }
            ctx.textAlign = 'left';
            const _ph2Lbl = C.PROVIDER_NAME + ' 2';
            const _ph2LblX = _icon2X + _icon2W + 12;
            C._fitLabelFont(_ph2Lbl, (smX + smw - 19) - _ph2LblX - 4, _fSub);
            ctx.fillStyle = ph2Hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.55)';
            ctx.fillText(_ph2Lbl, _ph2LblX, siy + smPhRowH / 2 + 6);
            const _a2x = smX + smw - 14, _a2y = siy + smPhRowH / 2;
            ctx.strokeStyle = ph2Hov ? 'rgba(215,225,248,0.70)' : 'rgba(140,160,175,0.32)';
            ctx.lineWidth = 1.5; ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(_a2x - 5, _a2y + 4); ctx.lineTo(_a2x + 4, _a2y - 4);
            ctx.moveTo(_a2x - 1, _a2y - 4); ctx.lineTo(_a2x + 4, _a2y - 4); ctx.lineTo(_a2x + 4, _a2y + 1);
            ctx.stroke();
            HUD.settingsMenuItems.push({ key: 'pihole-link-2', hitbox: ph2Hb });
          }
        }
        // ── Background flyouts: mode list, with a sky-preset list cascading off STARS ──
        if (S.bgMenuOpen) {
          const _fItemH = 26, _fPad = 8;
          // Width to fit the widest label (24px left inset for the dot + right pad; rows with a
          // '>' cascade arrow get extra room so the label doesn't crowd the arrow).
          const _flyoutW = (opts) => {
            ctx.font = `${_fSub}px "Press Start 2P", monospace`;
            let wmax = 0;
            for (const o of opts) wmax = Math.max(wmax, ctx.measureText(o.label).width);
            return Math.ceil(wmax) + 24 + (opts.some(o => o.arrow) ? 32 : 18);
          };
          // Draw one flyout panel of selectable rows; returns its hitbox list + box.
          const _drawFlyout = (fx, fy, fw, opts, activeKey) => {
            const fh = opts.length * _fItemH + _fPad * 2;
            ctx.fillStyle = 'rgba(8,11,16,0.96)';
            ctx.fillRect(fx, fy, fw, fh);
            const a = 12;
            ctx.strokeStyle = 'rgba(140,160,175,0.42)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(fx + a, fy);        ctx.lineTo(fx, fy);        ctx.lineTo(fx, fy + a);
            ctx.moveTo(fx + fw - a, fy);   ctx.lineTo(fx + fw, fy);   ctx.lineTo(fx + fw, fy + a);
            ctx.moveTo(fx, fy + fh - a);   ctx.lineTo(fx, fy + fh);   ctx.lineTo(fx + a, fy + fh);
            ctx.moveTo(fx + fw, fy + fh - a); ctx.lineTo(fx + fw, fy + fh); ctx.lineTo(fx + fw - a, fy + fh);
            ctx.stroke();
            ctx.font = `${_fSub}px "Press Start 2P", monospace`;
            // Center label, active dot and arrow on one line via a middle baseline.
            ctx.textBaseline = 'middle';
            const items = opts.map((opt, idx) => {
              const iy = fy + _fPad + idx * _fItemH;
              const cy = iy + _fItemH / 2;
              const hb = { x: fx, y: iy, w: fw, h: _fItemH };
              const disabled = !!opt.disabled;
              const hov = !disabled && S.mouseX >= hb.x && S.mouseX < hb.x + hb.w && S.mouseY >= hb.y && S.mouseY < hb.y + hb.h;
              const active = opt.key === activeKey;
              if (hov || (opt.arrow && S.bgSkyOpen)) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
              if (active && !disabled) {
                ctx.fillStyle = 'rgba(120,180,255,0.95)';
                ctx.beginPath(); ctx.arc(fx + 13, cy - 1, 3, 0, Math.PI * 2); ctx.fill();
              }
              ctx.textAlign = 'left';
              ctx.fillStyle = disabled ? 'rgba(130,140,155,0.35)'
                            : active ? 'rgba(150,200,255,0.98)'
                            : hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.6)';
              ctx.fillText(opt.label, fx + 24, cy);
              if (opt.arrow) {
                const ax = fx + fw - 12;
                ctx.strokeStyle = hov || S.bgSkyOpen ? 'rgba(215,225,248,0.7)' : 'rgba(140,160,175,0.4)';
                ctx.lineWidth = 1.5; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(ax - 4, cy - 4); ctx.lineTo(ax + 3, cy); ctx.lineTo(ax - 4, cy + 4); ctx.stroke();
              }
              return { key: opt.key, hitbox: hb, disabled };
            });
            ctx.textBaseline = 'alphabetic';
            return { items, box: { x: fx, y: fy, w: fw, h: fh } };
          };
          // Mode flyout - STARFIELD carries a '>' (opens sky cascade); CUSTOM is disabled unless
          // BG_IMAGE is configured in the compose/env.
          const _modeOpts = C.BG_MODE_ORDER.map(k => ({ key: k, label: C.BG_MODE_LABELS[k], arrow: k === 'starfield', disabled: k === 'image' && !C.bgImageAvailable }));
          const _modeFw = _flyoutW(_modeOpts);
          let _mfx = smX + smw + 6;
          if (_mfx + _modeFw > S.W - 4) _mfx = Math.max(4, smX - _modeFw - 6);
          const _modeFh = _modeOpts.length * _fItemH + _fPad * 2;
          // Line the flyouts' first row highlight up with the BACKGROUND row highlight: the panel
          // top sits _fPad above the row so its first item row lands exactly on it.
          const _mfy = Math.max(6, Math.min(_bgModeRowY - _fPad, SY - _modeFh - 6));
          const _m = _drawFlyout(_mfx, _mfy, _modeFw, _modeOpts, S.bgMode);
          HUD.bgModeItems = _m.items; HUD.bgModeBox = _m.box;
          // Sky cascade off the STARFIELD row (index 0), when open and starfield is active.
          if (S.bgSkyOpen && S.bgMode === 'starfield') {
            const _skyOpts = C.SKY_PRESET_ORDER.map(k => ({ key: k, label: C.SKY_PRESET_LABELS[k] }));
            const _skyFw = _flyoutW(_skyOpts);   // wide enough for "SUMMER TRIANGLE" / "SOUTHERN CROSS"
            let _sfx = _mfx + _modeFw + 6;
            if (_sfx + _skyFw > S.W - 4) _sfx = Math.max(4, _mfx - _skyFw - 6);
            const _skyFh = _skyOpts.length * _fItemH + _fPad * 2;
            const _sfy = Math.max(6, Math.min(_mfy, SY - _skyFh - 6));   // top-align with the mode flyout
            const _s = _drawFlyout(_sfx, _sfy, _skyFw, _skyOpts, S.bgPreset);
            HUD.bgSkyItems = _s.items; HUD.bgSkyBox = _s.box;
          } else {
            HUD.bgSkyItems = []; HUD.bgSkyBox = null;
          }
        } else {
          HUD.bgModeItems = []; HUD.bgModeBox = null;
          HUD.bgSkyItems = []; HUD.bgSkyBox = null;
        }
      } else {
        HUD.settingsMenuItems = [];
        HUD.settingsMenuPopupBox = null;
        HUD.bgModeItems = []; HUD.bgModeBox = null;
        HUD.bgSkyItems = []; HUD.bgSkyBox = null;
      }

      // ── INTEL ──────────────────────────────────────────────
      // Column thresholds scale with _fSub so "intercept" (9 chars) always fits its cell.
      // 2-col: need cell ≥ ~9 * _fSub * 0.75 + 8px padding  → 15 * _fSub per cell × 2
      // 4-col: same logic × 4
      if (INTEL_W >= 50) {
        const _i2Min = 15 * _fSub, _i4Min = 33 * _fSub;
        const hsBlocked = C.P1.hudStats.blocked;
        // Technitium mirrors its dashboard's "No Error" card; others show allowed (total - blocked).
        const _isTech = C.PROVIDER === 'technitium';
        const hsAllowed = _isTech ? C.P1.hudStats.no_error
          : (C.P1.hudStats.queries != null && C.P1.hudStats.blocked != null ? C.P1.hudStats.queries - C.P1.hudStats.blocked : null);
        const _allowedLabel = _isTech ? 'no error' : 'allowed';
        const hsTotal = C.P1.hudStats.queries;
        const pct = C.P1.hudStats.percent;
        const _pctColor = pct == null ? 'rgba(150,150,150,0.50)' : pct >= 60 ? 'rgba(50,215,120,0.85)' : pct >= 40 ? 'rgba(210,220,70,0.85)' : 'rgba(255,110,50,0.85)';
        const _pctVal = pct != null ? pct.toFixed(1)+'%' : '—';
        const intelCols = INTEL_W >= _i4Min
          ? [
              { val: _fmtN(hsTotal),   label: 'total',     color: 'rgba(130,185,255,0.90)' },
              { val: _fmtN(hsBlocked), label: 'blocked',   color: 'rgba(255,70,60,0.90)'   },
              { val: _fmtN(hsAllowed), label: _allowedLabel, color: 'rgba(50,215,120,0.90)'  },
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
        ctx.beginPath(); ctx.rect(INTEL_X, SY, INTEL_W, _rowH + _lbExtra); ctx.clip();
        const cellW = INTEL_W / intelCols.length;
        intelCols.forEach(({ val, label, color }, i) => {
          const icx = INTEL_X + cellW * i + cellW / 2;
          ctx.textAlign = 'center';
          ctx.font = `${_fVal}px "Press Start 2P", monospace`;
          ctx.fillStyle = color;
          ctx.fillText(val, icx, _yVal);
          ctx.font = `${_fLabel}px "Press Start 2P", monospace`;
          ctx.fillStyle = 'rgba(70,130,165,0.45)';
          ctx.fillText(label, icx, _ySubLabel);
        });
        ctx.restore();
      }

      // ── GRAVITY / FILTER ───────────────────────────────────
      ctx.save();
      ctx.beginPath(); ctx.rect(TDB_X, SY, TDB_W, _rowH + _lbExtra); ctx.clip();
      _modLabel(C.PROVIDER_TOGGLE_LABEL, TDB_X + TDB_W / 2, 'center');
      let sigsStr, sigsColor = 'rgba(95,200,230,0.82)';
      if (C.P1.gravityState === 'updating') {
        sigsStr = 'UPDATING';
        sigsColor = `rgba(255,190,50,${(0.65 + 0.35 * Math.sin(S.t * 0.006)).toFixed(2)})`;
      } else {
        sigsStr = _fmtGravity(C.P1.hudGravity);
        if (C.P1.gravityState === 'done') {
          const age = S.t - C.P1.gravityDoneAt;
          const flash = Math.max(0, 1 - age / 1200);
          if (flash > 0.01) sigsColor = `rgba(50,215,120,${(0.65 + 0.35 * flash).toFixed(2)})`;
          if (age > 1500) C.P1.gravityState = 'idle';
        }
      }
      ctx.textAlign = 'center';
      ctx.font = `${_fVal}px "Press Start 2P", monospace`;
      ctx.fillStyle = sigsColor;
      ctx.fillText(sigsStr, TDB_X + TDB_W / 2, _yVal);
      ctx.font = `${_fLabel}px "Press Start 2P", monospace`;
      ctx.fillStyle = 'rgba(70,130,165,0.45)';
      ctx.fillText('known threats', TDB_X + TDB_W / 2, _ySubLabel);
      // Update arrow - left side of section
      const _aW = bmpW(ARROW_DOWN_BMP) * ARROW_PX;
      const _aX = TDB_X + Math.round(30 * _fs), _aY = SY + Math.round(_rowH * 0.48);
      let arrowCol = C.P1.arrowHovered ? 'rgba(255,190,50,0.95)' : 'rgba(95,200,230,0.55)';
      let arrowGlw = C.P1.arrowHovered ? 'rgba(255,190,50,0.50)' : null;
      if (C.P1.gravityState === 'updating') {
        const p = (0.65 + 0.35 * Math.sin(S.t * 0.008)).toFixed(2);
        arrowCol = `rgba(255,190,50,${p})`; arrowGlw = 'rgba(255,190,50,0.35)';
        drawBmp(ctx, ARROW_DOWN_BMP, _aX, _aY + Math.round(Math.max(0, Math.sin(S.t * 0.005)) * 3), arrowCol, arrowGlw, ARROW_PX);
      } else {
        if (C.P1.gravityState === 'done') {
          const flash = Math.max(0, 1 - (S.t - C.P1.gravityDoneAt) / 1200);
          if (flash > 0.01) { arrowCol = `rgba(50,215,120,${(0.5+0.5*flash).toFixed(2)})`; arrowGlw = `rgba(50,215,120,${(flash*0.4).toFixed(2)})`; }
        }
        drawBmp(ctx, ARROW_DOWN_BMP, _aX, _aY, arrowCol, arrowGlw, ARROW_PX);
      }
      C.P1.arrowHitbox = { x: _aX - _aW / 2 - 4, y: _aY - 14, w: _aW + 8, h: 28 };
      ctx.restore();

      // ── SHIPS / OPTIONS ────────────────────────────────────
      const _canSelectShip = C.P1.blockingEnabled === true && S.shipPowerState === 'up' && C.P1.warpState === 'none';
      const _shipLabels = { protector: 'PROTECTOR', falcon: 'FALCON', swordfish: 'SWORDFISH', enterprise: 'ENTERPRISE', serenity: 'SERENITY', normandy: 'NORMANDY', pes: 'PES', inbound: 'MISSINGNO.' };
      if (OPT_W > 0) {
        ctx.save();
        ctx.beginPath(); ctx.rect(OPT_X, SY, OPT_W, _rowH + _lbExtra); ctx.clip();
        _modLabel('SHIP', OPT_X + OPT_W / 2, 'center');
        ctx.textAlign = 'center';
        ctx.font = `${_fShip}px "Press Start 2P", monospace`;
        ctx.fillStyle = C.P1.shipMenuHovered && _canSelectShip ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
        ctx.fillText(_shipLabels[C.P1.currentShip], OPT_X + OPT_W / 2, _yVal);
        const _shipTW = ctx.measureText(_shipLabels[C.P1.currentShip]).width;
        ctx.font = `${_fLabel}px "Press Start 2P", monospace`;
        ctx.fillStyle = _canSelectShip ? 'rgba(175,200,238,0.32)' : 'rgba(80,80,80,0.28)';
        ctx.fillText(_canSelectShip ? 'SELECT' : '—', OPT_X + OPT_W / 2, _ySubLabel);
        {
          const _hbPad = 12;
          const _hbTop = _yVal - Math.round(_fShip * 1.05);
          const _hbH = Math.round(_fShip * 1.55);
          C.P1.shipMenuHitbox = { x: OPT_X + OPT_W / 2 - _shipTW / 2 - _hbPad, y: _hbTop, w: _shipTW + _hbPad * 2, h: _hbH };
        }
        ctx.restore();
      } else {
        C.P1.shipMenuHitbox = { x: 0, y: 0, w: 0, h: 0 };
      }

      // Ship selector popup - opens upward from OPTIONS
      // Layout: 2×4 grid on wide screens, 4×2 grid on compact screens
      if (C.P1.shipMenuOpen && _canSelectShip && OPT_W > 0) {
        const _ships = ['enterprise', 'falcon', 'normandy', 'pes', 'protector', 'serenity', 'swordfish', 'inbound'];
        const _sBmps  = { enterprise: ENTERPRISE_BMP, falcon: FALCON_BMP, normandy: NORMANDY_BMP, pes: PES_BMP,
                          protector: PROTECTOR_BMP, serenity: SERENITY_BMP, swordfish: SWORDFISH_BMP, inbound: INBOUND_BMP };
        const _sCols  = { enterprise: 'rgba(195,208,240,0.85)', falcon: 'rgba(195,208,240,0.85)', normandy: 'rgba(195,208,240,0.85)', pes: 'rgba(89,223,139,0.85)',
                          protector: 'rgba(195,208,240,0.85)', serenity: 'rgba(195,208,240,0.85)', swordfish: 'rgba(207,50,33,0.85)', inbound: 'rgba(150,155,165,0.85)' };
        const _sGlows = { enterprise: 'rgba(170,190,235,0.32)', falcon: 'rgba(170,190,235,0.32)', normandy: 'rgba(170,190,235,0.32)', pes: 'rgba(89,223,139,0.32)',
                          protector: 'rgba(170,190,235,0.32)', serenity: 'rgba(170,190,235,0.32)', swordfish: 'rgba(203,38,20,0.32)', inbound: null };
        const _compact = S.W < 660;
        const _cols = _compact ? 2 : 4;
        const _rows = _compact ? 4 : 2;
        const _slotW = _compact ? 85 : 90;
        const _slotH = _compact ? 70 : 82;
        const _mPad = 10;
        const _mw = _cols * _slotW + _mPad * 2;
        const _mh = _rows * _slotH + _mPad * 2;
        const _mX = Math.max(4, Math.min(S.W - _mw - 4, OPT_X + OPT_W / 2 - _mw / 2));
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
        C.P1.shipMenuPopupBox = { x: _mX, y: _mY, w: _mw, h: _mh };
        let _anyHov = false;
        C.P1.shipMenuItems = _ships.map((s, i) => {
          const _col = i % _cols, _row = Math.floor(i / _cols);
          const _sX  = _mX + _mPad + _col * _slotW;
          const _sY  = _mY + _mPad + _row * _slotH;
          const _sCX = _sX + _slotW / 2;
          const _isActive = s === C.P1.currentShip;
          const _isLocked = s === 'inbound';
          const _isTaken = _isP2 && !_isActive && s === C.P2.currentShip;
          const hb = { x: _sX, y: _sY, w: _slotW, h: _slotH };
          const _shipCY = _sY + _slotH / 2 - 8;
          const _labelY = _sY + _slotH - 11;
          const hov = !_anyHov && !_isActive && !_isLocked && !_isTaken && S.mouseX >= hb.x && S.mouseX < hb.x + hb.w && S.mouseY >= hb.y && S.mouseY < hb.y + hb.h;
          if (hov) _anyHov = true;
          if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
          const _glitching = _isLocked && S.missingnoGlitchAt > 0 && (S.t - S.missingnoGlitchAt) < 1400;
          ctx.save();
          ctx.globalAlpha = _isLocked || _isTaken ? 0.35 : (_isActive ? 0.28 : (hov ? 1.0 : 0.70));
          if (_glitching) {
            // Draw only existing 1-pixels, each randomly toggled off using a per-pixel sin hash
            const _gAge = S.t - S.missingnoGlitchAt;
            const _gBmp = INBOUND_BMP;
            const _gPx  = 2;
            const _gCols = bmpW(_gBmp), _gRows = bmpH(_gBmp);
            const _gOx = Math.round(_sCX - (_gCols * _gPx) / 2);
            const _gOy = Math.round(_shipCY - (_gRows * _gPx) / 2);
            ctx.fillStyle = _sCols['inbound'];
            for (let r = 0; r < _gRows; r++) {
              for (let c = 0; c < _gCols; c++) {
                if (!_gBmp[r][c]) continue;
                const _seed = Math.sin(r * 127.1 + c * 311.7 + _gAge * 0.023) * 43758.5453;
                const _rnd  = _seed - Math.floor(_seed);
                if (_rnd > 0.30) ctx.fillRect(_gOx + c * _gPx, _gOy + r * _gPx, _gPx - 1, _gPx - 1);
              }
            }
          } else {
            drawBmp(ctx, _sBmps[s], _sCX, _shipCY, _sCols[s], hov ? _sGlows[s] : null, 2);
          }
          ctx.restore();
          ctx.textAlign = 'center';
          ctx.font = '8px "Press Start 2P", monospace';
          // Flash the label when glitching (toggle every 400ms)
          const _labelVisible = !_glitching || Math.floor((S.t - S.missingnoGlitchAt) / 400) % 2 === 1;
          if (_labelVisible) {
            ctx.fillStyle = (_isLocked || _isTaken) ? 'rgba(130,135,145,0.55)' : _isActive ? 'rgba(80,80,80,0.50)' : hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
            ctx.fillText(_isActive ? 'ACTIVE' : _isTaken ? 'P2' : _shipLabels[s], _sCX, _labelY);
          }
          return { ship: s, hitbox: hb, active: _isActive, locked: _isLocked || _isTaken, taken: _isTaken };
        });
      } else {
        C.P1.shipMenuItems = [];
        C.P1.shipMenuPopupBox = null;
      }

      // ── P2 HUD ROW ─────────────────────────────────────────────────────
      if (_isP2) {
        const _fmtP2 = n => n == null ? '—' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e4 ? (n/1e3).toFixed(2)+'K' : String(n);
        const _canSelectP2Ship = C.P2.blockingEnabled === true && C.P2.warpState === 'none' && S._p2ShipVisible;

        // ── P2 INTERCEPT ───────────────────────────────────────
        ctx.save();
        ctx.beginPath(); ctx.rect(0, _p2RowSY, INT_W, _rowH); ctx.clip();
        const _p2LabelVisible = C.P2.blockingEnabled !== null && C.P2.startupAt === 0 && !(C.P2.blockingEnabled === false && C.P2.powerdownAt > 0 && S.t - C.P2.powerdownAt < C.POWERDOWN_DUR);
        if (_p2LabelVisible) {
          ctx.font = `${_fSub + 2}px "Press Start 2P", monospace`;
          ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(100,155,220,0.50)';
          ctx.fillText('P2', 26, _yVal2);
        }
        let _p2ShieldStr, _p2ShieldColor, _p2ShieldGlow = null;
        if (C.P2.blockingEnabled === null) {
          _p2ShieldStr = 'STANDBY'; _p2ShieldColor = 'rgba(150,150,150,0.35)';
        } else if (C.P2.blockingEnabled === false && C.P2.powerdownAt > 0 && S.t - C.P2.powerdownAt < C.POWERDOWN_DUR) {
          const _p2sp = Math.max(0, 1 - (S.t - C.P2.powerdownAt) / C.POWERDOWN_DUR);
          const _p2pf = 0.5 + 0.5 * Math.abs(Math.sin(S.t * 0.012));
          _p2ShieldStr = 'POWERING DOWN'; _p2ShieldColor = `rgba(255,160,50,${(0.45 + 0.4 * _p2sp * _p2pf).toFixed(2)})`;
        } else if (C.P2.blockingEnabled === false) {
          _p2ShieldStr = 'OFFLINE'; _p2ShieldColor = 'rgba(255,80,60,0.90)'; _p2ShieldGlow = 'rgba(255,80,60,0.35)';
        } else if (C.P2.startupAt > 0) {
          const _p2sp = (S.t - C.P2.startupAt) / C.STARTUP_DUR;
          if (_p2sp > 0.72) {
            const _p2sf = 0.6 + 0.4 * Math.abs(Math.sin(S.t * 0.016));
            _p2ShieldStr = 'ONLINE'; _p2ShieldColor = `rgba(50,215,120,${(0.55 + 0.45 * _p2sf).toFixed(2)})`; _p2ShieldGlow = `rgba(50,215,120,${(_p2sf * 0.45).toFixed(2)})`;
          } else {
            _p2ShieldStr = 'STARTING...'; _p2ShieldColor = `rgba(210,200,70,${(0.4 + 0.3 * Math.abs(Math.sin(S.t * 0.009))).toFixed(2)})`;
          }
        } else {
          _p2ShieldStr = 'ACTIVE';
          _p2ShieldColor = C.P2.shieldHovered ? 'rgba(50,215,120,0.95)' : 'rgba(50,215,120,0.75)';
          _p2ShieldGlow = C.P2.shieldHovered ? 'rgba(50,215,120,0.35)' : null;
        }
        ctx.textAlign = 'center';
        ctx.font = `${_fVal}px "Press Start 2P", monospace`;
        if (_p2ShieldGlow) { ctx.shadowColor = _p2ShieldGlow; ctx.shadowBlur = 8; }
        ctx.fillStyle = _p2ShieldColor;
        ctx.fillText(_p2ShieldStr, INT_W / 2, _yVal2);
        const _p2ShieldTW = ctx.measureText(_p2ShieldStr).width;
        ctx.shadowBlur = 0;
        const _p2HasTimer = C.P2.blockingEnabled === false && C.P2.blockingDuration > 0;
        if (_p2HasTimer) {
          const _p2remSec = Math.max(0, Math.ceil((C.P2.blockingDuration - (S.t - C.P2.blockingOffAt)) / 1000));
          const _p2mins = Math.floor(_p2remSec / 60), _p2secs = _p2remSec % 60;
          ctx.font = `${_fSub}px "Press Start 2P", monospace`;
          ctx.fillStyle = 'rgba(255,100,80,0.65)';
          ctx.fillText(`${_p2mins}:${String(_p2secs).padStart(2,'0')}`, INT_W / 2, _ySub2);
        }
        if (S._p2ShipVisible) {
          const _p2hbPad = 10;
          const _p2hbTop = _yVal2 - Math.round(_fVal * 0.95);
          const _p2hbH = _p2HasTimer ? Math.round(_fVal * 0.95 + _fSub * 2.2) : Math.round(_fVal * 1.35);
          C.P2.shieldHitbox = { x: INT_W / 2 - _p2ShieldTW / 2 - _p2hbPad, y: _p2hbTop, w: _p2ShieldTW + _p2hbPad * 2, h: _p2hbH };
        } else {
          C.P2.shieldHitbox = { x: 0, y: 0, w: 0, h: 0 };
        }
        ctx.restore();

        // P2 shield (disable) menu
        if (C.P2.shieldMenuOpen) {
          const _p2mw = 150, _p2mItemH = 26, _p2mPad = 8;
          const _p2mh = C.DISABLE_OPTIONS.length * _p2mItemH + _p2mPad * 2;
          const _p2menuX = Math.max(0, Math.min(S.W - _p2mw, Math.round(INT_W / 2 - _p2mw / 2)));
          const _p2menuY = SY - _p2mh - 6;
          ctx.fillStyle = 'rgba(8,11,16,0.92)'; ctx.fillRect(_p2menuX, _p2menuY, _p2mw, _p2mh);
          const _p2mGlow = ctx.createLinearGradient(0, _p2menuY, 0, _p2menuY + 24);
          _p2mGlow.addColorStop(0, 'rgba(140,160,175,0.07)'); _p2mGlow.addColorStop(1, 'rgba(140,160,175,0)');
          ctx.fillStyle = _p2mGlow; ctx.fillRect(_p2menuX, _p2menuY + 1, _p2mw, 24);
          const _p2ma = 14;
          ctx.strokeStyle = 'rgba(140,160,175,0.42)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(_p2menuX + _p2ma, _p2menuY);       ctx.lineTo(_p2menuX, _p2menuY);           ctx.lineTo(_p2menuX, _p2menuY + _p2ma);
          ctx.moveTo(_p2menuX + _p2mw - _p2ma, _p2menuY); ctx.lineTo(_p2menuX + _p2mw, _p2menuY); ctx.lineTo(_p2menuX + _p2mw, _p2menuY + _p2ma);
          ctx.moveTo(_p2menuX, _p2menuY + _p2mh - _p2ma); ctx.lineTo(_p2menuX, _p2menuY + _p2mh); ctx.lineTo(_p2menuX + _p2ma, _p2menuY + _p2mh);
          ctx.moveTo(_p2menuX + _p2mw, _p2menuY + _p2mh - _p2ma); ctx.lineTo(_p2menuX + _p2mw, _p2menuY + _p2mh); ctx.lineTo(_p2menuX + _p2mw - _p2ma, _p2menuY + _p2mh);
          ctx.stroke();
          ctx.font = `${_fSub}px "Press Start 2P", monospace`;
          C.P2.shieldMenuPopupBox = { x: _p2menuX, y: _p2menuY, w: _p2mw, h: _p2mh };
          C.P2.shieldMenuItems = C.DISABLE_OPTIONS.map((opt, idx) => {
            const iy = _p2menuY + _p2mPad + idx * _p2mItemH;
            const hb = { x: _p2menuX, y: iy, w: _p2mw, h: _p2mItemH };
            const hov = S.mouseX >= hb.x && S.mouseX < hb.x + hb.w && S.mouseY >= hb.y && S.mouseY < hb.y + hb.h;
            if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
            ctx.textAlign = 'left';
            ctx.fillStyle = hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
            ctx.fillText(opt.label, _p2menuX + 14, iy + 18);
            const timer = opt.timerFn ? opt.timerFn() : opt.timer;
            return { ...opt, timer, hitbox: hb };
          });
        } else {
          C.P2.shieldMenuItems = []; C.P2.shieldMenuPopupBox = null;
        }

        // ── P2 STATS (INTEL) ───────────────────────────────────
        if (INTEL_W >= 50) {
          const _p2i2Min = 15 * _fSub, _p2i4Min = 33 * _fSub;
          const _p2Blocked = C.P2.hudStats.blocked;
          const _p2Allowed = C.PROVIDER === 'technitium' ? C.P2.hudStats.no_error
            : (C.P2.hudStats.queries != null && _p2Blocked != null ? C.P2.hudStats.queries - _p2Blocked : null);
          const _p2AllowedLabel = C.PROVIDER === 'technitium' ? 'no error' : 'allowed';
          const _p2Total   = C.P2.hudStats.queries;
          const _p2Pct     = C.P2.hudStats.percent;
          const _p2PctColor = _p2Pct == null ? 'rgba(150,150,150,0.50)' : _p2Pct >= 60 ? 'rgba(50,215,120,0.85)' : _p2Pct >= 40 ? 'rgba(210,220,70,0.85)' : 'rgba(255,110,50,0.85)';
          const _p2PctVal = _p2Pct != null ? _p2Pct.toFixed(1)+'%' : '—';
          const _p2Cols = INTEL_W >= _p2i4Min
            ? [
                { val: _fmtP2(_p2Total),   label: 'total',     color: 'rgba(130,185,255,0.90)' },
                { val: _fmtP2(_p2Blocked), label: 'blocked',   color: 'rgba(255,70,60,0.90)'   },
                { val: _fmtP2(_p2Allowed), label: _p2AllowedLabel, color: 'rgba(50,215,120,0.90)'  },
                { val: _p2PctVal,           label: 'intercept', color: _p2PctColor },
              ]
            : INTEL_W >= _p2i2Min
            ? [
                { val: _fmtP2(_p2Blocked), label: 'blocked',   color: 'rgba(255,70,60,0.90)'  },
                { val: _p2PctVal,           label: 'intercept', color: _p2PctColor },
              ]
            : [{ val: _fmtP2(_p2Blocked), label: 'blocked', color: 'rgba(255,70,60,0.90)'  }];
          ctx.save();
          ctx.beginPath(); ctx.rect(INTEL_X, _p2RowSY, INTEL_W, _rowH); ctx.clip();
          const _p2CellW = INTEL_W / _p2Cols.length;
          _p2Cols.forEach(({ val, label, color }, i) => {
            const icx = INTEL_X + _p2CellW * i + _p2CellW / 2;
            ctx.textAlign = 'center';
            ctx.font = `${_fVal}px "Press Start 2P", monospace`;
            ctx.fillStyle = color; ctx.fillText(val, icx, _yVal2);
          });
          ctx.restore();
        }

        // ── P2 GRAVITY ─────────────────────────────────────────
        ctx.save();
        ctx.beginPath(); ctx.rect(TDB_X, _p2RowSY, TDB_W, _rowH); ctx.clip();
        let _p2SigsStr, _p2SigsColor = 'rgba(95,200,230,0.82)';
        if (C.P2.gravityState === 'updating') {
          _p2SigsStr = 'UPDATING';
          _p2SigsColor = `rgba(255,190,50,${(0.65 + 0.35 * Math.sin(S.t * 0.006)).toFixed(2)})`;
        } else {
          _p2SigsStr = _fmtGravity(C.P2.hudGravity);
          if (C.P2.gravityState === 'done') {
            const _p2age = S.t - C.P2.gravityDoneAt;
            const _p2flash = Math.max(0, 1 - _p2age / 1200);
            if (_p2flash > 0.01) _p2SigsColor = `rgba(50,215,120,${(0.65 + 0.35 * _p2flash).toFixed(2)})`;
            if (_p2age > 1500) C.P2.gravityState = 'idle';
          }
        }
        ctx.textAlign = 'center';
        ctx.font = `${_fVal}px "Press Start 2P", monospace`;
        ctx.fillStyle = _p2SigsColor; ctx.fillText(_p2SigsStr, TDB_X + TDB_W / 2, _yVal2);
        const _p2aW = bmpW(ARROW_DOWN_BMP) * ARROW_PX;
        const _p2aX = TDB_X + Math.round(30 * _fs), _p2aY = _p2RowSY + Math.round(_rowH * 0.48);
        let _p2ArrowCol = C.P2.arrowHovered ? 'rgba(255,190,50,0.95)' : 'rgba(95,200,230,0.55)';
        let _p2ArrowGlw = C.P2.arrowHovered ? 'rgba(255,190,50,0.50)' : null;
        if (C.P2.gravityState === 'updating') {
          const _p2ap = (0.65 + 0.35 * Math.sin(S.t * 0.008)).toFixed(2);
          _p2ArrowCol = `rgba(255,190,50,${_p2ap})`; _p2ArrowGlw = 'rgba(255,190,50,0.35)';
          drawBmp(ctx, ARROW_DOWN_BMP, _p2aX, _p2aY + Math.round(Math.max(0, Math.sin(S.t * 0.005)) * 3), _p2ArrowCol, _p2ArrowGlw, ARROW_PX);
        } else {
          if (C.P2.gravityState === 'done') {
            const _p2flash = Math.max(0, 1 - (S.t - C.P2.gravityDoneAt) / 1200);
            if (_p2flash > 0.01) { _p2ArrowCol = `rgba(50,215,120,${(0.5+0.5*_p2flash).toFixed(2)})`; _p2ArrowGlw = `rgba(50,215,120,${(_p2flash*0.4).toFixed(2)})`; }
          }
          drawBmp(ctx, ARROW_DOWN_BMP, _p2aX, _p2aY, _p2ArrowCol, _p2ArrowGlw, ARROW_PX);
        }
        C.P2.arrowHitbox = { x: _p2aX - _p2aW / 2 - 4, y: _p2aY - 14, w: _p2aW + 8, h: 28 };
        ctx.restore();

        // ── P2 SHIP ────────────────────────────────────────────
        if (OPT_W > 0) {
          ctx.save();
          ctx.beginPath(); ctx.rect(OPT_X, _p2RowSY, OPT_W, _rowH); ctx.clip();
          ctx.textAlign = 'center';
          ctx.font = `${_fShip}px "Press Start 2P", monospace`;
          ctx.fillStyle = C.P2.shipMenuHovered && _canSelectP2Ship ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
          ctx.fillText(_shipLabels[C.P2.currentShip], OPT_X + OPT_W / 2, _yVal2);
          const _p2ShipTW = ctx.measureText(_shipLabels[C.P2.currentShip]).width;
          {
            const _hbPad = 8;
            const _hbTop = _yVal2 - Math.round(_fShip * 0.95);
            const _hbH = Math.round(_fShip * 1.35);
            C.P2.shipMenuHitbox = { x: OPT_X + OPT_W / 2 - _p2ShipTW / 2 - _hbPad, y: _hbTop, w: _p2ShipTW + _hbPad * 2, h: _hbH };
          }
          ctx.restore();
        } else {
          C.P2.shipMenuHitbox = { x: 0, y: 0, w: 0, h: 0 };
        }

        // P2 ship selector popup
        if (C.P2.shipMenuOpen && _canSelectP2Ship && OPT_W > 0) {
          const _p2ships = ['enterprise', 'falcon', 'normandy', 'pes', 'protector', 'serenity', 'swordfish', 'inbound'];
          const _p2sBmps  = { enterprise: ENTERPRISE_BMP, falcon: FALCON_BMP, normandy: NORMANDY_BMP, pes: PES_BMP,
                              protector: PROTECTOR_BMP, serenity: SERENITY_BMP, swordfish: SWORDFISH_BMP, inbound: INBOUND_BMP };
          const _p2sCols  = { enterprise: 'rgba(195,208,240,0.85)', falcon: 'rgba(195,208,240,0.85)', normandy: 'rgba(195,208,240,0.85)', pes: 'rgba(89,223,139,0.85)',
                              protector: 'rgba(195,208,240,0.85)', serenity: 'rgba(195,208,240,0.85)', swordfish: 'rgba(207,50,33,0.85)', inbound: 'rgba(150,155,165,0.85)' };
          const _p2sGlows = { enterprise: 'rgba(170,190,235,0.32)', falcon: 'rgba(170,190,235,0.32)', normandy: 'rgba(170,190,235,0.32)', pes: 'rgba(89,223,139,0.32)',
                              protector: 'rgba(170,190,235,0.32)', serenity: 'rgba(170,190,235,0.32)', swordfish: 'rgba(203,38,20,0.32)', inbound: null };
          const _p2compact = S.W < 660;
          const _p2cols = _p2compact ? 2 : 4;
          const _p2rows = _p2compact ? 4 : 2;
          const _p2slotW = _p2compact ? 85 : 90;
          const _p2slotH = _p2compact ? 70 : 82;
          const _p2mPad = 10;
          const _p2mw = _p2cols * _p2slotW + _p2mPad * 2;
          const _p2mh = _p2rows * _p2slotH + _p2mPad * 2;
          const _p2mX = Math.max(4, Math.min(S.W - _p2mw - 4, OPT_X + OPT_W / 2 - _p2mw / 2));
          const _p2mY = SY - _p2mh - 8;
          ctx.fillStyle = 'rgba(8,11,16,0.92)'; ctx.fillRect(_p2mX, _p2mY, _p2mw, _p2mh);
          const _p2smGlow = ctx.createLinearGradient(0, _p2mY, 0, _p2mY + 24);
          _p2smGlow.addColorStop(0, 'rgba(140,160,175,0.07)'); _p2smGlow.addColorStop(1, 'rgba(140,160,175,0)');
          ctx.fillStyle = _p2smGlow; ctx.fillRect(_p2mX, _p2mY + 1, _p2mw, 24);
          const _p2sma = 14;
          ctx.strokeStyle = 'rgba(140,160,175,0.42)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(_p2mX + _p2sma, _p2mY);       ctx.lineTo(_p2mX, _p2mY);       ctx.lineTo(_p2mX, _p2mY + _p2sma);
          ctx.moveTo(_p2mX + _p2mw - _p2sma, _p2mY); ctx.lineTo(_p2mX + _p2mw, _p2mY); ctx.lineTo(_p2mX + _p2mw, _p2mY + _p2sma);
          ctx.moveTo(_p2mX, _p2mY + _p2mh - _p2sma); ctx.lineTo(_p2mX, _p2mY + _p2mh); ctx.lineTo(_p2mX + _p2sma, _p2mY + _p2mh);
          ctx.moveTo(_p2mX + _p2mw, _p2mY + _p2mh - _p2sma); ctx.lineTo(_p2mX + _p2mw, _p2mY + _p2mh); ctx.lineTo(_p2mX + _p2mw - _p2sma, _p2mY + _p2mh);
          ctx.stroke();
          C.P2.shipMenuPopupBox = { x: _p2mX, y: _p2mY, w: _p2mw, h: _p2mh };
          let _p2anyHov = false;
          C.P2.shipMenuItems = _p2ships.map((s, i) => {
            const _p2col = i % _p2cols, _p2row = Math.floor(i / _p2cols);
            const _p2sX  = _p2mX + _p2mPad + _p2col * _p2slotW;
            const _p2sY  = _p2mY + _p2mPad + _p2row * _p2slotH;
            const _p2sCX = _p2sX + _p2slotW / 2;
            const _p2isActive = s === C.P2.currentShip;
            const _p2isLocked = s === 'inbound';
            const _p2isTaken = !_p2isActive && s === C.P1.currentShip;
            const hb = { x: _p2sX, y: _p2sY, w: _p2slotW, h: _p2slotH };
            const _p2shipCY = _p2sY + _p2slotH / 2 - 8;
            const _p2labelY = _p2sY + _p2slotH - 11;
            const hov = !_p2anyHov && !_p2isActive && !_p2isLocked && !_p2isTaken && S.mouseX >= hb.x && S.mouseX < hb.x + hb.w && S.mouseY >= hb.y && S.mouseY < hb.y + hb.h;
            if (hov) _p2anyHov = true;
            if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
            const _p2glitching = _p2isLocked && S.missingnoGlitchAt > 0 && (S.t - S.missingnoGlitchAt) < 1400;
            ctx.save();
            ctx.globalAlpha = _p2isLocked || _p2isTaken ? 0.35 : (_p2isActive ? 0.28 : (hov ? 1.0 : 0.70));
            if (_p2glitching) {
              const _gAge = S.t - S.missingnoGlitchAt;
              const _gBmp = INBOUND_BMP, _gPx = 2;
              const _gCols = bmpW(_gBmp), _gRows = bmpH(_gBmp);
              const _gOx = Math.round(_p2sCX - (_gCols * _gPx) / 2);
              const _gOy = Math.round(_p2shipCY - (_gRows * _gPx) / 2);
              ctx.fillStyle = _p2sCols['inbound'];
              for (let r = 0; r < _gRows; r++) for (let c = 0; c < _gCols; c++) {
                if (!_gBmp[r][c]) continue;
                const _seed = Math.sin(r * 127.1 + c * 311.7 + _gAge * 0.023) * 43758.5453;
                if (_seed - Math.floor(_seed) > 0.30) ctx.fillRect(_gOx + c * _gPx, _gOy + r * _gPx, _gPx - 1, _gPx - 1);
              }
            } else {
              drawBmp(ctx, _p2sBmps[s], _p2sCX, _p2shipCY, _p2sCols[s], hov ? _p2sGlows[s] : null, 2);
            }
            ctx.restore();
            ctx.textAlign = 'center';
            ctx.font = '8px "Press Start 2P", monospace';
            const _p2labelVisible = !_p2glitching || Math.floor((S.t - S.missingnoGlitchAt) / 400) % 2 === 1;
            if (_p2labelVisible) {
              ctx.fillStyle = (_p2isLocked || _p2isTaken) ? 'rgba(130,135,145,0.55)' : _p2isActive ? 'rgba(80,80,80,0.50)' : hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
              ctx.fillText(_p2isActive ? 'ACTIVE' : _p2isTaken ? 'P1' : _shipLabels[s], _p2sCX, _p2labelY);
            }
            return { ship: s, hitbox: hb, active: _p2isActive, locked: _p2isLocked || _p2isTaken, taken: _p2isTaken };
          });
        } else {
          C.P2.shipMenuItems = []; C.P2.shipMenuPopupBox = null;
        }
      } // end _isP2 HUD row

    },
  };

  window.HUD = HUD;
})();
