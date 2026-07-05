// ── Pi-hole DNS game mode ─────────────────────────────────────────────
(function() {
  const canvas = document.getElementById('pihole-canvas');
  const ctx = canvas.getContext('2d');
  const phLinkEl = document.getElementById('pihole-link');
  const PROVIDER = window.PROVIDER || 'pihole';
  // Provider-aware branding. Any provider not listed falls back to Pi-hole.
  const PROVIDER_NAME = PROVIDER === 'adguard' ? 'ADGUARD'
                      : PROVIDER === 'technitium' ? 'TECHNITIUM'
                      : 'PI-HOLE';
  const PROVIDER_ICON = PROVIDER === 'adguard' ? '/static/icons/adguard.svg'
                      : PROVIDER === 'technitium' ? '/static/icons/technitium.svg'
                      : '/static/icons/pihole.svg';
  // Pi-hole's mascot is tall (90x130); AdGuard and Technitium icons are square.
  const PROVIDER_ICON_ASPECT = (PROVIDER === 'adguard' || PROVIDER === 'technitium') ? 1.0 : (90 / 130);
  // Label for the block-toggle module (Pi-hole: GRAVITY, AdGuard: FILTER, Technitium: BLOCK LIST).
  const PROVIDER_TOGGLE_LABEL = PROVIDER === 'adguard' ? 'FILTER'
                              : PROVIDER === 'technitium' ? 'BLOCK LIST'
                              : 'GRAVITY';
  // Shrink a "Press Start 2P" label so it fits within maxW. Keeps long provider
  // names (e.g. TECHNITIUM) from colliding with a row's link arrow. Sets ctx.font
  // as a side effect and returns the chosen pixel size.
  function _fitLabelFont(text, maxW, baseSize) {
    ctx.font = `${baseSize}px "Press Start 2P", monospace`;
    const w = ctx.measureText(text).width;
    const size = (w > maxW && w > 0) ? Math.max(6, Math.floor(baseSize * maxW / w)) : baseSize;
    if (size !== baseSize) ctx.font = `${size}px "Press Start 2P", monospace`;
    return size;
  }
  const settingsBtnEl = document.getElementById('settings-btn');

  // ── CRT power flash (on/off) ──────────────────────────────────────────
  // A pure CSS animation toggled by a class; playing it just re-adds the class
  // after a reflow so it restarts.
  const crtPowerEl   = document.getElementById('crt-power');
  // Fires only on a deliberate CRT toggle (never continuously), and the whole CRT
  // look is opt-in, so it intentionally ignores prefers-reduced-motion.
  function _playCrtOneShot(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;            // force reflow so the animation restarts
    el.classList.add(cls);
  }
  // The power flash and the filter's warm-up/cool-down (crt-warming / crt-cooling
  // fade the scanlines, glow and content bump) run together and end together, so
  // the flash drives the tube coming to life / dying rather than sitting over an
  // instant toggle. Cleared here on the flash's animationend; for power-off the
  // filter (crt-on) is dropped in the same frame the cool-down ends.
  if (crtPowerEl) crtPowerEl.addEventListener('animationend', () => {
    const wasOff = crtPowerEl.classList.contains('off');
    crtPowerEl.classList.remove('on', 'off');
    if (wasOff && !crtEnabled) document.body.classList.remove('crt-on', 'crt-cooling');
    else document.body.classList.remove('crt-warming');
  });

  let W = 0, H = 0;
  let _dpr = 1; // device pixel ratio the backing store is currently sized for

  let safeBottom = 0, hudSH = 108;
  let active = false, evtSource = null, sseRetryDelay = 3000, _rafId = null;
  let lastT = 0, lastSpawn = 0, shipX = 0, shipY = 0, lastGun = 0;
  let lastEnemyAt = 0, p2LastEnemyAt = 0;
  let activeEnemies = 0, idleBlend = 0, p2IdleBlend = 0;
  let _hudGlowGrad = null, _hudGlowGradSY = -1;
  let _vigGrad = null, _vigGradL = null, _vigGradR = null;
  let _vigGradW = -1, _vigGradH = -1, _vigGradIs2P = false;
  let _hudSlideAt = 0, _hudSlideFrom = 0, _hudSlideTo = 0;
  const HUD_SLIDE_DUR = 340;
  // HUD auto-hide: slides the whole strip off-screen after idle; summoned back by
  // pointer activity in the bottom reveal zone. Device-agnostic (mouse/touch/pen).
  let _hudRevealAt = 0;        // perf-clock ts of last reveal-keeping activity
  let _hudHideT = 0;           // 0 = fully shown, 1 = fully hidden (slide progress)
  let _hudPrevT = 0;           // previous render ts, for frame-rate-independent easing
  let _hudVisible = true;      // is the strip mostly shown (gates HUD interactions)
  let _lastPtrType = 'mouse';  // last pointer type seen (mouse hover keeps HUD alive; touch has no hover)
  let _lastHudBandCss = -1;    // last --hud-h written (CRT HUD-easing band height), change-detected
  let _lastCrtFloorCss = '';   // last --crt-floor written (CRT reduction over that band)
  const AUTOHIDE_MS = 4000;    // idle time before the HUD slides away
  const HUD_FADE_DUR = 240;    // slide time-constant (ms)
  const entities = [], lasers = [], explosions = [], queue = [];
  let drone = { state: 'docked', x: 0, y: 0, lastFire: 0, side: 0, angle: 0, targetX: null, targetY: null, deployedAt: 0, recallAt: 0 };
  const droneMissiles = [];
  let drone2 = { state: 'docked', x: 0, y: 0, lastFire: 0, side: 0, angle: 0, targetX: null, targetY: null, deployedAt: 0, recallAt: 0 };
  const drone2Missiles = [];
  let hudGravity = null;
  let hudStats = { blocked: null, queries: null, no_error: null, percent: null };
  let hudStatsPollTimer = null, _onVisible = null, _onFocus = null, _sleepCheckTimer = null, _exitTimer = null;
  let gravityState = 'idle'; // 'idle' | 'updating' | 'done'
  let gravityDoneAt = 0;
  let gravityPollTimer = null;
  let arrowHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let arrowHovered = false;

  const domainFragments = [];
  const debris = [];
  const chainRings = [];
  let blockingEnabled = null; // null=unknown, true, false
  // Reconciliation guard for the local blocking toggle: while a command is
  // pending, ignore stale poll reads (which lag the toggle round-trip + Pi-hole
  // propagation) so a delayed poll can't spuriously flip shipPowerState after a
  // genuine toggle. null = none pending, else true/false.
  let blockingCmdExpected = null, blockingCmdDeadline = 0;
  let _firstEnterFetch = false;
  let blockingOffAt = 0;
  // When blocking last transitioned to off. Unlike blockingOffAt (which the poll
  // recalibrates every tick to track a live countdown), this is set once per
  // off-transition so the 30s ground-crew timer can actually elapse even when the
  // provider reports a counting-down timer (e.g. an AdGuard remote timed disable).
  let blockingOffSince = 0;
  let blockingDuration = 0;   // ms; 0 = indefinite
  let shipPowerState = 'up';  // 'up' | 'down' | 'startup'
  let startupAt = 0;
  const STARTUP_DUR = 1800;
  let powerdownAt = 0;
  const POWERDOWN_DUR = 800;
  let carrierState = 'none';  // 'none'|'arriving'|'present'|'leaving'
  let carrierY = 0, carrierRestY = 0, carrierArrivingAt = 0, carrierLeavingAt = 0, launchAt = 0;
  let crewMembers = [], crewNextSpawn = 0, lastFuelAt = 0;
  let p2CrewMembers = [], p2CrewNextSpawn = 0, p2LastFuelAt = 0;
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
  let hudAutoHide    = false;   // slide the HUD away when idle
  let crtEnabled     = false;   // retro CRT-filter overlay
  (function _loadDisplaySettings() {
    try {
      const s = JSON.parse(localStorage.getItem('ph_display'));
      if (s) {
        if (s.friendlies != null) showFriendlies = !!s.friendlies;
        if (s.domain     != null) showDomain     = !!s.domain;
        if (s.client     != null) showClient      = !!s.client;
        if (s.autohide   != null) hudAutoHide     = !!s.autohide;
        if (s.crt        != null) crtEnabled      = !!s.crt;
      }
    } catch {}
    if (crtEnabled && document.body) document.body.classList.add('crt-on');
  })();
  function _saveDisplaySettings() {
    try { localStorage.setItem('ph_display', JSON.stringify({ friendlies: showFriendlies, domain: showDomain, client: showClient, autohide: hudAutoHide, crt: crtEnabled })); } catch {}
  }
  // ── Background settings (mode + sky preset) ───────────────────────
  // Persisted under ph_bg and applied live via window.applyBgMode / window.applySkyPreset
  // (see starfield-lite.js). Initial values come from window.BG_CONFIG, which index.html
  // already reconciled with localStorage. The picker is always shown; the compose/env values
  // load as the default and stay authoritative for CUSTOM: BG_IMAGE (if set) is always loaded
  // into #bg-image, so CUSTOM works regardless of the in-app selection (backward compatible).
  const SKY_PRESET_ORDER  = ['summer_triangle', 'orion', 'scorpius', 'southern_cross'];
  const SKY_PRESET_LABELS = { summer_triangle: 'SUMMER TRIANGLE', orion: 'ORION', scorpius: 'SCORPIUS', southern_cross: 'SOUTHERN CROSS' };
  // 'image' mode is labelled CUSTOM in the UI; it's only selectable when BG_IMAGE is configured.
  const BG_MODE_ORDER  = ['starfield', 'nebula', 'outrun', 'dark', 'image'];
  const BG_MODE_LABELS = { starfield: 'STARFIELD', nebula: 'NEBULA', outrun: 'OUTRUN', dark: 'DARK', image: 'CUSTOM' };
  const _bgCfg0 = window.BG_CONFIG || {};
  const bgImageAvailable = !!_bgCfg0.bg_image;   // BG_IMAGE set in compose -> CUSTOM is selectable
  let bgMode   = BG_MODE_ORDER.includes(_bgCfg0.bg_mode) ? _bgCfg0.bg_mode : 'starfield';
  let bgPreset = SKY_PRESET_ORDER.includes(_bgCfg0.sky_preset) ? _bgCfg0.sky_preset : 'summer_triangle';
  // Background picker flyouts. The BACKGROUND row opens a mode flyout (STARS/NEBULA/DARK);
  // choosing STARS opens a further sky-preset flyout that cascades off it. Selections apply
  // live and keep the flyouts open (compare freely); clicking away closes them.
  let bgMenuOpen = false;   // mode flyout open
  let bgSkyOpen  = false;   // sky-preset cascade open (only meaningful with starfield)
  let bgModeItems = [], bgModeBox = null;
  let bgSkyItems  = [], bgSkyBox  = null;
  function _saveBgSettings() {
    try { localStorage.setItem('ph_bg', JSON.stringify({ mode: bgMode, preset: bgPreset })); } catch {}
  }
  function _applyBgMode(mode) {
    bgMode = mode;
    if (window.applyBgMode) window.applyBgMode(mode);
    _saveBgSettings();
  }
  function _applyBgPreset(preset) {
    bgPreset = preset;
    const _p = (window.SKY_PRESETS || {})[preset];
    if (_p && window.applySkyPreset) window.applySkyPreset(_p.ra, _p.dec);
    _saveBgSettings();
  }
  // ── 2P state ──────────────────────────────────────────────────────
  let twoPlayerMode = 'off';        // 'off' | 'local'
  const p2Entities = [], p2Queue = [];
  let lastP2Spawn = 0;
  let p2ShipX = 0, p2ShipY = -300;
  let p2CurrentShip = localStorage.getItem('ph_p2_ship') || 'falcon';
  let p2WarpState = 'none';  // 'none' | 'out' | 'in'
  let p2WarpAt = 0;
  let p2WarpNextShip = null;
  let p2WarpPrevShip = null;
  let p2HudStats = { blocked: null, queries: null, no_error: null, percent: null };
  let p2BlockingEnabled = null;
  let p2BlockingOffAt = 0, p2BlockingDuration = 0, p2PowerdownAt = 0;
  let p2BlockingOffSince = 0;  // set once per off-transition; see blockingOffSince
  // Reconciliation guard for locally-issued remote toggles. While a command is
  // pending, ignore stale poll reads (which lag the toggle round-trip + Pi-hole
  // propagation) so they can't clobber optimistic state or kill the in-flight
  // startup/powerdown animation. p2CmdExpected: null = none pending, else true/false.
  let p2CmdExpected = null, p2CmdDeadline = 0;
  let p2GunCheckFiredAt = [0, 0];
  let p2EvtSource = null, p2StatsPollTimer = null;
  let _p1ShipVisible = false;       // true once P1 has live data (gated in 2P mode)
  let _p2ShipVisible = false;       // true once P2 has live data (drives ship arrival)
  let _p2ShipRipInAt = 0;           // perf.now() when ship arrival animation fires
  let _2pBannerAt = 0;              // perf.now() when 2P mode first activated (banner anim)
  let _carrierSmoothX = 0;          // lerped carrier center X for smooth 2P mode transitions
  let p2CarrierState = 'none';  // 'none'|'arriving'|'present'|'leaving'
  let p2CarrierY = 0, p2CarrierRestY = 0, p2CarrierArrivingAt = 0, p2CarrierLeavingAt = 0, p2LaunchAt = 0, p2StartupAt = 0;
  let _p2CarrierSmoothX = 0;
  let _p2FastDepart = false;    // true while ship is animating off-screen after disconnect
  let _p2BottomEntry = false;   // true when ship enters from bottom (suppress rip-in trail)
  let _p2SnapReveal = false;    // true on page-load refresh: snap P2 ship to position, no animation
  const p2Lasers = [];
  let lastP2Gun = 0;

  let currentShip = 'protector';  // 'protector'|'falcon'|'swordfish'|'enterprise'|'serenity'|'normandy'|'pes'
  let warpState = 'none';         // 'none' | 'out' | 'in'
  let warpAt = 0;
  let warpNextShip = null;
  let warpPrevShip = null;
  const WARP_OUT_DUR = 300;
  const WARP_IN_DUR = 500;
  let shakeAt = 0, shakeDur = 0, shakeAmp = 0;
  let shipMenuOpen = false;
  let shipMenuItems = [];
  let shipMenuPopupBox = null;
  let shipMenuHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let shipMenuHovered = false;
  let shipBodyHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let p2ShipBodyHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let missingnoGlitchAt = 0, missingnoGlitchCooldown = 0;
  let shipQuote = null;    // { text: string, shownAt: number } | null
  let shipQuoteCooldown = 0; // performance.now() timestamp; no new quotes until after this
  let shipQuoteDeck = [];       // shuffled queue for the current ship
  let shipQuoteDeckFor = null;  // which ship the deck was built for
  let shipQuoteLastShown = null;
  // Quintuple-click easter egg: embiggen the P1 ship to 3x for 5 seconds, then it
  // bounces back to normal on its own. A squash-and-stretch drives the grow/shrink.
  const SHIP_EGG_BIG = 3;
  const SHIP_EGG_HOLD = 5000;  // ms the ship stays big before auto-reverting
  let shipEggBig    = false;  // currently big (or growing to big)
  let shipEggBigUntil = 0;    // performance.now() timestamp the auto-revert fires
  let shipEggFrom   = 1;      // scale at the start of the running grow/shrink
  let shipEggTo     = 1;      // scale the current animation is heading to
  let shipEggAnimAt = -1;     // performance.now() the grow/shrink began (-1 = settled)
  let shipEggScale  = 1;      // last computed magnitude, reused for the hitbox + bubble
  let shipClickTimes = [];    // recent ship-click times, windowed for quintuple-click detection
  // Overshoot easing: settles past the target then eases back, for the "boing".
  function _easeOutBack(x) { const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  let p2ShipQuote = null;
  let p2ShipQuoteCooldown = 0;
  let p2ShipQuoteDeck = [];
  let p2ShipQuoteDeckFor = null;
  let p2ShipQuoteLastShown = null;
  let p2HudGravity = null;
  let p2GravityState = 'idle';
  let p2GravityDoneAt = 0;
  let p2ShieldHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let p2ShieldHovered = false;
  let p2ShieldMenuOpen = false;
  let p2ShieldMenuItems = [];
  let p2ShieldMenuPopupBox = null;
  let p2ShipMenuHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let p2ShipMenuOpen = false;
  let p2ShipMenuItems = [];
  let p2ShipMenuPopupBox = null;
  let p2ShipMenuHovered = false;
  let p2ArrowHitbox = { x: 0, y: 0, w: 0, h: 0 };
  let p2ArrowHovered = false;
  const SHIP_QUOTES = {
    protector:  ["Never give up, never surrender!", "By Grabthar's hammer, by the suns of Warvan, you shall be avenged.", "EXPLAIN.", "I'm just the guy who dies in episode 3!", "Can you form some sort of rudimentary lathe?", "Are you enjoying your Kep-mok blood ticks, Dr. Lazarus?", "It's all real."],
    falcon:     ["Never tell me the odds!", "I'd just as soon kiss a Wookiee.", "BUT SIR!!", "I am a Jedi, like my father before me.", "I can fly anything.", "It's not my fault!", "Shut him up or shut him down!"],
    swordfish:  ["Bang.", "Whatever happens, happens.", "I'm not going there to die. I'm going to find out if I'm really alive.", "I'm not a bounty hunter for the money.", "I love a man who can cook.", "Ed and Ein are hungry!"],
    enterprise: ["THERE ARE FOUR LIGHTS!", "Good tea, nice house.", "Shaka, when the walls fell.", "Will you.. Please... Sit down?", "Live long and prosper.", "The needs of the many outweigh the needs of the few, or the one.", "He's dead, Jim.", "Risk is our business.", "Fascinating."],
    serenity:   ["Time for some thrilling heroics.", "I am a leaf on the wind. Watch how I soar.", "Curse your sudden but inevitable betrayal!", "Also, I can kill you with my brain."],
    normandy:   ["Just because I like you doesn't mean I won't kill you.", "I'm Commander Shepard, and this is my favorite store on the Citadel.", "I should go.", "You big stupid jellyfish!", "Does this unit have a soul?", "Emergency... Induction... Port.", "I've had enough of your snide insinuations!"],
    pes:        ["Good news everyone!", "I don't want to live on this planet anymore.", "Shut up and take my money!", "I did do the nasty in the pasty."],
    inbound:    ["[coming soon.]"],
  };
  function _secsUntilMidnight() {
    const now = new Date(), midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return Math.round((midnight - now) / 1000);
  }
  const DISABLE_OPTIONS = PROVIDER === 'adguard' ? [
    { label: '30 SEC',   timer: 30,   ms: 30000 },
    { label: '1 MIN',    timer: 60,   ms: 60000 },
    { label: '10 MIN',   timer: 600,  ms: 600000 },
    { label: '1 HR',     timer: 3600, ms: 3600000 },
    { label: 'TOMORROW', timerFn: _secsUntilMidnight },
    { label: 'DISABLE',  timer: null, ms: 0 },
  ] : [
    { label: '10 SEC', timer: 10,  ms: 10000 },
    { label: '30 SEC', timer: 30,  ms: 30000 },
    { label: '5 MIN',  timer: 300, ms: 300000 },
    { label: 'DISABLE', timer: null, ms: 0 },
  ];
  // Blocked-entity tier palette [bodyColor, bodyGlow, reticleColor, reticleGlow], indexed
  // 0 = tier 0/1, 1 = tier 2, 2 = tier 3+. Hoisted out of the per-frame entity draw so the
  // array isn't re-allocated for every blocked entity every frame (values unchanged).
  const ENTITY_TIER_COLORS = [
    ['rgba(255,50,50,1)',  'rgba(255,60,40,0.35)',  'rgba(80,255,160,0.9)', 'rgba(60,240,140,0.6)'],
    ['rgba(255,130,30,1)', 'rgba(255,130,30,0.35)', 'rgba(0,220,255,0.9)',  'rgba(0,190,255,0.6)'],
    ['rgba(190,60,255,1)', 'rgba(190,60,255,0.35)', 'rgba(255,210,50,0.9)', 'rgba(255,175,30,0.6)'],
  ];
  // Draws one nacelle engine exhaust flame centered at (x, base).
  function drawEngineFlare(x, base, ft, wScale = 1, lScale = wScale, taper = 0.6, shape = 'arch', wobble = 1, col = null) {
    const fire = col === 'fire';
    const l = (21 + 2 * Math.sin(ft * 1.9) + 1.5 * Math.sin(ft * 3.1 + 0.7)) * lScale;
    const fw = (3.5 + 0.4 * wobble * Math.sin(ft * 2.7 + 0.3)) * wScale;
    const og = ctx.createRadialGradient(x, base + l * 0.3, 0, x, base + l * 0.3, l * 0.7);
    og.addColorStop(0, fire ? 'rgba(255,100,30,0.22)' : 'rgba(80,140,255,0.22)');
    og.addColorStop(1, fire ? 'rgba(180,30,0,0)'      : 'rgba(40,80,255,0)');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.ellipse(x, base + l * 0.3, l * 0.35, l * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    const fg = ctx.createLinearGradient(x, base, x, base + l);
    fg.addColorStop(0,    fire ? 'rgba(255,160,80,0)'    : 'rgba(150,200,255,0)');
    fg.addColorStop(0.12, fire ? 'rgba(255,160,80,0.70)' : 'rgba(150,200,255,0.70)');
    fg.addColorStop(0.4,  fire ? 'rgba(220,80,20,0.55)'  : 'rgba(70,120,255,0.55)');
    fg.addColorStop(1,    fire ? 'rgba(180,30,0,0)'       : 'rgba(40,80,255,0)');
    ctx.fillStyle = fg;
    ctx.shadowColor = fire ? 'rgba(255,100,30,0.3)' : 'rgba(80,140,255,0.3)'; ctx.shadowBlur = 8;
    ctx.beginPath();
    if (shape === 'column') {
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
    ig.addColorStop(0,    fire ? 'rgba(255,235,200,0)'    : 'rgba(210,235,255,0)');
    ig.addColorStop(0.15, fire ? 'rgba(255,235,200,0.90)' : 'rgba(210,235,255,0.90)');
    ig.addColorStop(1,    fire ? 'rgba(255,180,100,0)'    : 'rgba(160,205,255,0)');
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
      x = twoPlayerMode !== 'off' ? W * (0.05 + Math.random() * 0.40) : W * (0.1 + Math.random() * 0.8);
      if (Math.random() < 0.65) {
        y = -50;
      } else {
        y = H * (0.05 + Math.random() * 0.14);
        headStart = Math.min((y + 50) / spd, 1800);
      }
      vx = (Math.random() - 0.5) * 0.018; vy = spd;
    } else {
      const spd = isCache ? (0.095 + Math.random() * 0.03) : (0.078 + Math.random() * 0.03);
      x = twoPlayerMode !== 'off' ? W * (0.03 + Math.random() * 0.44) : W * (0.05 + Math.random() * 0.9);
      y = -50;
      const goRight = Math.random() < 0.5;
      const tx = twoPlayerMode !== 'off' ? (goRight ? W / 2 - 20 : -100) : (goRight ? W + 100 : -100);
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

  function spawnP2Entity(ev) {
    if (ev.status === 'allowed' && !showFriendlies) return;
    const blocked = ev.status === 'blocked';
    const isCache = ev.source === 'cache';
    const now = performance.now();
    const existing = p2Entities.find(e => e.domain === ev.domain && e.type === ev.status && e.state !== 'shot');
    if (existing) {
      const prevTier = Math.min(existing.count, 3);
      existing.count++;
      const newTier = Math.min(existing.count, 3);
      if (blocked && newTier > prevTier) {
        const tierColor = newTier >= 3 ? '190,60,255' : '255,130,30';
        existing.mutateAt = now;
        existing.mutateColor = tierColor;
        const ps = [];
        for (let i = 0; i < 14; i++) {
          const a = (Math.PI * 2 * i / 14) + (Math.random() - 0.5) * 0.3;
          const s = 0.05 + Math.random() * 0.12;
          ps.push({ x: existing.x, y: existing.y, vx: Math.cos(a)*s, vy: Math.sin(a)*s,
                    r: 1.5 + Math.random() * 2.5, col: tierColor });
        }
        explosions.push({ ps, born: now, dur: 600 });
      }
      return;
    }
    if (p2Entities.length >= 50) return;
    let x, y, vx, vy, headStart = 0;
    if (blocked) {
      const spd = 0.055 + Math.random() * 0.03;
      x = W * (0.55 + Math.random() * 0.40);
      if (Math.random() < 0.65) { y = -50; }
      else { y = H * (0.05 + Math.random() * 0.14); headStart = Math.min((y + 50) / spd, 1800); }
      vx = (Math.random() - 0.5) * 0.018; vy = spd;
    } else {
      const spd = isCache ? (0.095 + Math.random() * 0.03) : (0.078 + Math.random() * 0.03);
      x = W * (0.55 + Math.random() * 0.40); y = -50;
      const goRight = Math.random() < 0.5;
      const tx = goRight ? W + 100 : W / 2 + 50;
      const ty = H * (0.35 + Math.random() * 0.5);
      const d = Math.hypot(tx - x, ty - y);
      vx = (tx - x) / d * spd; vy = (ty - y) / d * spd;
    }
    const design = blocked ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 3);
    p2Entities.push({
      type: ev.status, source: ev.source || 'upstream',
      design,
      x, y, vx, vy, wobble: Math.random() * Math.PI * 2,
      domain: ev.domain, client: ev.client || '',
      spawnTime: now - headStart, appearAt: now,
      state: 'alive',
      targetedAt: 0, shotAt: 0, labelAlpha: 1, count: 1,
      mutateAt: 0, mutateColor: '', warpPushed: false,
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

  function fireAtP2(ent) {
    ent.shotAt = performance.now();
    ent.mutateAt = 0;
    const now = performance.now();
    const tier = Math.min(ent.count, 3);
    let seekerFire = false;
    const _gtp2 = shipGunTipPos(p2CurrentShip, Math.round(p2ShipX), Math.round(p2ShipY));
    if (tier >= 3) {
      if (Math.random() < 0.5) {
        ent.state = 'shot';
        const sp = 10;
        p2Lasers.push({ side: 0, tier, x1: ent.x - sp, y1: ent.y, born: now });
        p2Lasers.push({ side: 2, tier, x1: ent.x,      y1: ent.y, born: now });
        p2Lasers.push({ side: 1, tier, x1: ent.x + sp, y1: ent.y, born: now });
      } else {
        seekerFire = true;
        ent.state = 'seeker-incoming';
        ent.detonateAt = now + 330;
        const sx0 = _gtp2.nx, sy0 = _gtp2.ny;
        const tx = ent.x, ty = ent.y;
        const ddx = tx - sx0, ddy = ty - sy0, ddist = Math.hypot(ddx, ddy) || 1;
        const px = -ddy / ddist, py = ddx / ddist;
        const midX = (sx0 + tx) / 2, midY = (sy0 + ty) / 2;
        const offsets = [-52, 38, -24, 58, -10];
        for (let bi = 0; bi < offsets.length; bi++) {
          const off = offsets[bi] + (Math.random() - 0.5) * 18;
          p2Lasers.push({ style: 'seeker', tier, target: ent,
                          x0: sx0, y0: sy0, x1: tx, y1: ty,
                          cpx: midX + px * off, cpy: midY + py * off,
                          born: now + bi * 30, dur: 210 });
        }
      }
    } else if (tier === 2) {
      ent.state = 'shot';
      p2Lasers.push({ side: 0, tier, x1: ent.x, y1: ent.y, born: now });
      p2Lasers.push({ side: 1, tier, x1: ent.x, y1: ent.y, born: now });
    } else {
      ent.state = 'shot';
      const side = lastP2Gun;
      lastP2Gun = 1 - lastP2Gun;
      p2Lasers.push({ side, tier, x1: ent.x, y1: ent.y, born: now });
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
    warpPrevShip = null;
    warpNextShip = nextShip;
    warpState = 'out';
    warpAt = performance.now();
    shipMenuOpen = false;
    settingsMenuOpen = false;
    if (settingsBtnEl) settingsBtnEl.classList.remove('menu-open');
    shipQuote = null; shipQuoteCooldown = 0; shipQuoteDeck = []; shipQuoteDeckFor = null; shipQuoteLastShown = null;
    // Snap the triple-click size egg back to normal so a giant ship doesn't warp out huge.
    shipEggBig = false; shipEggFrom = 1; shipEggTo = 1; shipEggAnimAt = -1; shipEggScale = 1; shipClickTimes = [];
    p2ShipQuote = null; p2ShipQuoteCooldown = 0; p2ShipQuoteDeck = []; p2ShipQuoteDeckFor = null; p2ShipQuoteLastShown = null;
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

    if (twoPlayerMode !== 'off') {
      const p2Rate = p2Queue.length > 10 ? 70 : 130;
      if (p2Queue.length > 0 && t - lastP2Spawn > p2Rate) {
        spawnP2Entity(p2Queue.shift());
        lastP2Spawn = t;
      }
      // P2 entity movement + AI
      for (let i = p2Entities.length - 1; i >= 0; i--) {
        const e = p2Entities[i];
        const age = t - e.spawnTime;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.type === 'blocked') {
          e.x += Math.sin(e.wobble + age * 0.002) * 0.012 * dt;
          if (_p2ShipVisible && warpState === 'none' && p2BlockingEnabled !== false) {
            if (e.state === 'alive' && age > 2200 && t - e.appearAt > 600) { e.state = 'targeted'; e.targetedAt = t; }
            if (e.state === 'targeted' && age > 3400 && t - e.appearAt > 600) fireAtP2(e);
          } else if (e.state === 'targeted') {
            e.state = 'alive';
          }
          if (e.state === 'seeker-incoming' && t >= e.detonateAt) {
            e.state = 'shot';
            e.killedBy = Math.min(e.count, 3);
          }
          if (e.state === 'shot') {
            const tier = Math.min(e.count, 3);
            const bmp = tier >= 3 ? E3 : tier === 2 ? E2 : (e.design === 0 ? E0 : E1);
            const color = tier >= 3 ? `rgba(190,60,255,0.9)` : tier === 2 ? `rgba(255,130,30,0.9)` : `rgba(255,50,50,0.9)`;
            createExplosionFromBmp(bmp, e.x, e.y, e.killedBy, color);
            p2Entities.splice(i, 1); continue;
          }
          if (e.y > H + 80) { p2Entities.splice(i, 1); continue; }
        } else {
          e.labelAlpha = Math.max(0, 1 - (age - 2400) / 1000);
          if (e.x < W / 2 - 50 || e.x > W + 130 || e.y > H + 80) {
            p2Entities.splice(i, 1);
          }
        }
      }
      // P2 ship movement: drop in, passive drift, track targeted enemy, dock to carrier
      const _p2targeted = p2Entities.find(e => e.state === 'targeted');
      const _p2ActiveEnemies = p2Entities.filter(e => e.type === 'blocked' && e.state !== 'shot').length;
      if (_p2ActiveEnemies > 0) p2LastEnemyAt = t;
      p2IdleBlend = (p2BlockingEnabled !== false) ? Math.min(1, Math.max(0, (t - p2LastEnemyAt - 15000) / 2000)) : 0;
      const _p2PassiveDrift = 5 * Math.sin(t * 0.00038 + Math.PI) + 2 * Math.sin(t * 0.00067 + Math.PI);
      const _p2FreeCX = W * 3 / 4;
      _p2CarrierSmoothX += (W * 0.80 - _p2CarrierSmoothX) * Math.min(1, 0.003 * dt);
      const _p2BayIdx = CARRIER_SHIP_ORDER.indexOf(p2CurrentShip);
      const _p2effCarrierState = twoPlayerMode !== 'off'
        ? (p2BlockingEnabled === false ? carrierState : (p2StartupAt > 0 ? carrierState : (p2LaunchAt > 0 && t - p2LaunchAt < CARRIER_LEAVE_DUR ? 'leaving' : 'none')))
        : p2CarrierState;
      const _p2effCarrierX     = twoPlayerMode !== 'off' ? _carrierSmoothX : _p2CarrierSmoothX;
      const _p2effCarrierY     = twoPlayerMode !== 'off' ? carrierRestY    : p2CarrierRestY;
      const _p2effLaunchAt     = p2LaunchAt;
      const _p2ActiveBayX  = _p2effCarrierX + (_p2BayIdx >= 0 ? CARRIER_BAY_DX[_p2BayIdx] : 0);
      const _p2CarrierDockY = _p2effCarrierY + (_p2BayIdx >= 0 ? CARRIER_BAY_DY[_p2BayIdx] : 0);
      let _p2GoalX, _p2GoalXLerp;
      if (_p2effCarrierState === 'arriving') {
        _p2GoalX = _p2ActiveBayX; _p2GoalXLerp = 0.002;
      } else if (_p2effCarrierState === 'present') {
        _p2GoalX = _p2ActiveBayX; _p2GoalXLerp = twoPlayerMode === 'off' ? 1 : 0.003;
      } else if (_p2effCarrierState === 'leaving' && t - _p2effLaunchAt < LAUNCH_BOOST_DUR) {
        _p2GoalX = _p2ActiveBayX; _p2GoalXLerp = 0.0015;
      } else {
        _p2GoalX = _p2ShipVisible
          ? (_p2targeted ? _p2FreeCX + Math.max(-80, Math.min(80, _p2targeted.x - _p2FreeCX)) : _p2FreeCX + _p2PassiveDrift)
          : _p2FreeCX;
        _p2GoalXLerp = 0.0038;
      }
      p2ShipX += (_p2GoalX - p2ShipX) * Math.min(1, _p2GoalXLerp * dt);
      const _p2inCarrier = _p2effCarrierState === 'arriving' || _p2effCarrierState === 'present';
      let _p2GoalY, _p2GoalYLerp;
      if (_p2inCarrier) {
        _p2GoalY = _p2CarrierDockY;
        _p2GoalYLerp = _p2effCarrierState === 'present' ? 0.003 : 0.0015;
      } else if (_p2effCarrierState === 'leaving' && t - _p2effLaunchAt < LAUNCH_BOOST_DUR) {
        _p2GoalY = H * 0.65 - 90; _p2GoalYLerp = 0.02;
      } else {
        _p2GoalY = _p2ShipVisible
          ? H * 0.65 + (_p2ActiveEnemies > 0 ? -42 : 0)
          : (_p2BottomEntry ? H + 100 : (_p2SnapReveal ? (H - safeBottom) * 0.65 : -300));
        _p2GoalYLerp = (_p2GoalY > p2ShipY + 10 || p2ShipY > H * 0.8) ? 0.009 : (_p2FastDepart ? 0.007 : 0.0008);
      }
      p2ShipY += (_p2GoalY - p2ShipY) * Math.min(1, _p2GoalYLerp * dt);
      if (_p2FastDepart && p2ShipY <= -250) _p2FastDepart = false;
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
    // P2 laser collision
    if (twoPlayerMode !== 'off') {
      for (let i = p2Lasers.length - 1; i >= 0; i--) {
        const l = p2Lasers[i];
        if (t < l.born) continue;
        if (l.style === 'seeker') continue;
        for (const e of p2Entities) {
          if (e.state === 'alive' && Math.hypot(e.x - l.x1, e.y - l.y1) < 25) {
            e.state = 'shot';
            e.killedBy = l.tier;
            p2Lasers.splice(i, 1);
            break;
          }
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
    const _carrierTargetX = twoPlayerMode !== 'off' ? W * 0.50 : W * 0.40;
    _carrierSmoothX += (_carrierTargetX - _carrierSmoothX) * Math.min(1, 0.003 * dt);
    const _carrierCX = _carrierSmoothX;
    const _shipBayIdx = CARRIER_SHIP_ORDER.indexOf(currentShip);
    const _activeBayX = _carrierCX + (_shipBayIdx >= 0 ? CARRIER_BAY_DX[_shipBayIdx] : 0);
    const _freeCX = twoPlayerMode !== 'off' ? W / 4 : W / 2;
    let goalX, goalXLerp;
    if ((carrierState === 'arriving' || carrierState === 'present') && (shipPowerState === 'down' || shipPowerState === 'startup')) {
      // In 2P the carrier may already be present (the other player brought it up),
      // so a welding lerp of 1 would snap P1 to the bay. Glide instead, matching the
      // P2 ship's handling; single-player still welds since the carrier arrives with it.
      goalX = _activeBayX; goalXLerp = carrierState === 'present' ? (twoPlayerMode === 'off' ? 1 : 0.003) : 0.002;
    } else if (launchAt > 0 && t - launchAt < LAUNCH_BOOST_DUR) {
      goalX = _activeBayX; goalXLerp = 0.0015;
    } else {
      goalX = targeted ? _freeCX + Math.max(-80, Math.min(80, targeted.x - _freeCX)) : _freeCX + passiveDrift + idleDrift;
      goalXLerp = 0.0038;
    }
    shipX += (goalX - shipX) * Math.min(1, goalXLerp * dt);

    // Ship Y retreat - rise when enemies descend, settle back during gaps
    const _carrierDockY = carrierRestY + (_shipBayIdx >= 0 ? CARRIER_BAY_DY[_shipBayIdx] : 0);
    let goalY, goalYLerp;
    if ((carrierState === 'arriving' || carrierState === 'present') &&
        (shipPowerState === 'down' || shipPowerState === 'startup')) {
      goalY = _carrierDockY;
      goalYLerp = carrierState === 'present' ? 0.003 : 0.0015;
    } else if (launchAt > 0 && t - launchAt < LAUNCH_BOOST_DUR) {
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
                              tx: tgt.x, ty: tgt.y, born: t, dur: mdist/mspd, spd: mspd,
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
                                 tx: tgt.x, ty: tgt.y, born: t, dur: mdist/mspd, spd: mspd,
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
      const _tgt = m.target && m.target.state !== 'shot' && m.target.x >= 0 && m.target.x <= W && m.target.y >= 0 && m.target.y <= H ? m.target : null;
      const _htx = _tgt ? _tgt.x : m.tx;
      const _hty = _tgt ? _tgt.y : m.ty;
      if (_tgt) { const _hd = Math.hypot(_htx - m.x, _hty - m.y) || 1; m.vx = (_htx - m.x) / _hd * m.spd; m.vy = (_hty - m.y) / _hd * m.spd; }
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (Math.hypot(m.x - _htx, m.y - _hty) < 20 || t - m.born > m.dur + 150) {
        m.exploded = true; m.explodeAt = t;
        if (m.target && m.target.state !== 'shot') {
          m.target.state = 'shot'; m.target.killedBy = 'drone';
        }
        const mps = [];
        for (let j = 0; j < 50; j++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 0.08 + Math.random() * 0.30;
          mps.push({ x: m.x, y: m.y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp,
                     r: 2 + Math.random() * 3, col: j < 25 ? '80,220,255' : j < 40 ? '210,245,255' : '255,255,255' });
        }
        explosions.push({ ps: mps, born: t, dur: 900 });
        chainRings.push({ x: m.x, y: m.y, born: t, dur: 420,
                          col1: 'rgba(80,220,255,1)', colS: 'rgba(40,180,255,0.9)', maxR: 75 });
        chainRings.push({ x: m.x, y: m.y, born: t, dur: 280,
                          col1: 'rgba(200,245,255,1)', colS: 'rgba(180,235,255,0.9)', maxR: 38 });
      }
    }

    // Drone 2 missile travel, impact, and cleanup
    for (let i = drone2Missiles.length - 1; i >= 0; i--) {
      const m = drone2Missiles[i];
      if (m.exploded) {
        if (t - m.explodeAt > 700) drone2Missiles.splice(i, 1);
        continue;
      }
      const _tgt2 = m.target && m.target.state !== 'shot' && m.target.x >= 0 && m.target.x <= W && m.target.y >= 0 && m.target.y <= H ? m.target : null;
      const _htx2 = _tgt2 ? _tgt2.x : m.tx;
      const _hty2 = _tgt2 ? _tgt2.y : m.ty;
      if (_tgt2) { const _hd2 = Math.hypot(_htx2 - m.x, _hty2 - m.y) || 1; m.vx = (_htx2 - m.x) / _hd2 * m.spd; m.vy = (_hty2 - m.y) / _hd2 * m.spd; }
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (Math.hypot(m.x - _htx2, m.y - _hty2) < 20 || t - m.born > m.dur + 150) {
        m.exploded = true; m.explodeAt = t;
        if (m.target && m.target.state !== 'shot') {
          m.target.state = 'shot'; m.target.killedBy = 'drone';
        }
        const mps = [];
        for (let j = 0; j < 50; j++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 0.08 + Math.random() * 0.30;
          mps.push({ x: m.x, y: m.y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp,
                     r: 2 + Math.random() * 3, col: j < 25 ? '255,190,60' : j < 40 ? '255,230,140' : '255,255,220' });
        }
        explosions.push({ ps: mps, born: t, dur: 900 });
        chainRings.push({ x: m.x, y: m.y, born: t, dur: 420,
                          col1: 'rgba(255,190,60,1)', colS: 'rgba(255,150,30,0.9)', maxR: 75 });
        chainRings.push({ x: m.x, y: m.y, born: t, dur: 280,
                          col1: 'rgba(255,240,180,1)', colS: 'rgba(255,220,140,0.9)', maxR: 38 });
      }
    }

    for (let i = lasers.length - 1; i >= 0; i--) {
      const _l = lasers[i];
      if (t - _l.born > (_l.style === 'seeker' ? _l.dur + 60 : 300)) lasers.splice(i, 1);
    }
    for (let i = p2Lasers.length - 1; i >= 0; i--) {
      const _l = p2Lasers[i];
      if (t - _l.born > (_l.style === 'seeker' ? _l.dur + 60 : 300)) p2Lasers.splice(i, 1);
    }

    // Defensive caps; these arrays expire fast and are bounded by game mechanics,
    // but trim the oldest entries if something anomalous pumps them.
    if (lasers.length > 120) lasers.length = 120;
    if (p2Lasers.length > 120) p2Lasers.length = 120;
    if (explosions.length > 120) explosions.length = 120;
    if (domainFragments.length > 800) domainFragments.length = 800;
    if (chainRings.length > 80) chainRings.length = 80;
    if (droneMissiles.length > 12) droneMissiles.length = 12;
    if (drone2Missiles.length > 12) drone2Missiles.length = 12;

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
      warpPrevShip = currentShip;
      currentShip = warpNextShip; warpNextShip = null;
      localStorage.setItem('ph_ship', currentShip);
      warpState = 'in'; warpAt = t;
      for (const c of crewMembers) { if (c.state !== 'fleeing') { c.state = 'fleeing'; c.stateAt = t; c.wpIdx = 0; c.fromX = c.x; c.fromY = c.y; } }
    } else if (warpState === 'in' && t - warpAt >= WARP_IN_DUR) {
      warpState = 'none'; warpPrevShip = null; shipPowerState = 'up';
      gunCheckState = 0; gunCheckFiredAt = [0, 0];
    }

    if (p2WarpState === 'out' && t - p2WarpAt >= WARP_OUT_DUR) {
      p2WarpPrevShip = p2CurrentShip;
      p2CurrentShip = p2WarpNextShip; p2WarpNextShip = null;
      localStorage.setItem('ph_p2_ship', p2CurrentShip);
      p2WarpState = 'in'; p2WarpAt = t;
      for (const c of p2CrewMembers) { if (c.state !== 'fleeing') { c.state = 'fleeing'; c.stateAt = t; c.wpIdx = 0; c.fromX = c.x; c.fromY = c.y; } }
    } else if (p2WarpState === 'in' && t - p2WarpAt >= WARP_IN_DUR) {
      p2WarpState = 'none'; p2WarpPrevShip = null;
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
    if (twoPlayerMode !== 'off' && p2WarpState === 'out') {
      const _p2wp = Math.max(0, Math.min(1, (t - p2WarpAt) / WARP_OUT_DUR));
      const _p2p2 = Math.max(0, (_p2wp - 0.40) / 0.60);
      if (_p2p2 > 0) {
        const _p2warpFrontY = p2ShipY - _p2p2 * (H + 300);
        for (const e of p2Entities) {
          if (!e.warpPushed && _p2warpFrontY <= e.y) {
            const lateralDist = e.x - p2ShipX;
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
      launchAt = t;
      if (carrierState === 'present' && (twoPlayerMode === 'off' || (p2BlockingEnabled !== false && p2StartupAt === 0))) {
        carrierState = 'leaving'; carrierLeavingAt = t;
        crewMembers = []; crewNextSpawn = 0; lastFuelAt = 0;
        if (twoPlayerMode !== 'off') { p2CrewMembers = []; p2CrewNextSpawn = 0; p2LastFuelAt = 0; }
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
        carrierState = 'arriving'; carrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10;
        carrierY = H + 240; carrierArrivingAt = t;
      }
    }
    // Also trigger carrier if blocking was detected off via poll (e.g. external Pi-hole toggle)
    if (shipPowerState === 'down' && blockingEnabled === false && carrierState === 'none') {
      carrierState = 'arriving'; carrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10;
      carrierY = H + 240; carrierArrivingAt = t;
    }
    // Timed-block countdown → auto re-enable with startup sequence
    if (blockingEnabled === false && blockingDuration > 0 && shipPowerState === 'down') {
      if (t - blockingOffAt >= blockingDuration) {
        blockingEnabled = true; blockingDuration = 0;
        gunCheckState = 0; gunCheckFiredAt = [0, 0];
        shipPowerState = 'startup'; startupAt = t;
        if (carrierState === 'arriving' && (twoPlayerMode === 'off' || p2BlockingEnabled !== false)) { carrierState = 'leaving'; carrierLeavingAt = t; launchAt = t; }
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
    if (shipPowerState === 'up' && (carrierState === 'present' || carrierState === 'arriving') && (twoPlayerMode === 'off' || (p2BlockingEnabled !== false && p2StartupAt === 0))) {
      carrierState = 'leaving'; carrierLeavingAt = t;
      if (twoPlayerMode === 'off') launchAt = t;
      crewMembers = []; crewNextSpawn = 0; lastFuelAt = 0;
      if (twoPlayerMode !== 'off') { p2CrewMembers = []; p2CrewNextSpawn = 0; p2LastFuelAt = 0; }
    }
    if (carrierState === 'leaving') {
      const lp = Math.min(1, (t - carrierLeavingAt) / CARRIER_LEAVE_DUR);
      carrierY = carrierRestY + lp * lp * (H + 240 - carrierRestY);
      // Carrier gone -> no ship docked, so no crew should remain. The P2 crew loop
      // is gated on carrierState !== 'none', so any still-fleeing crew would freeze
      // and reappear on the next arrival; force-clear them here as a catch-all.
      if (lp >= 1) { carrierState = 'none'; carrierY = 0; carrierRestY = 0; if (twoPlayerMode !== 'off') { p2CrewMembers = []; p2CrewNextSpawn = 0; p2LastFuelAt = 0; } }
    }

    // P2 timed-block auto-re-enable
    if (p2BlockingEnabled === false && p2BlockingDuration > 0 && t - p2BlockingOffAt >= p2BlockingDuration) {
      p2BlockingEnabled = true; p2BlockingDuration = 0;
      p2StartupAt = t; p2GunCheckFiredAt[0] = 0; p2GunCheckFiredAt[1] = 0;
      if ((twoPlayerMode !== 'off' ? carrierState : p2CarrierState) === 'none') chainRings.push({ x: p2ShipX, y: p2ShipY, born: t, dur: 380, maxR: 90, col1: 'rgba(180,220,255,0.9)', colS: 'rgba(120,180,255,0.7)' });
    }
    // In 2P mode, trigger shared carrier when P2 goes offline (poll-detected or setP2Blocking missed it)
    if (twoPlayerMode !== 'off' && p2BlockingEnabled === false && _p2ShipVisible && carrierState === 'none') {
      carrierState = 'arriving'; carrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10;
      carrierY = H + 240; carrierArrivingAt = t;
    }
    // P2 startup sequence: engine on → weapon check → launch
    if (p2StartupAt > 0 && p2BlockingEnabled === true) {
      const _p2sp = (t - p2StartupAt) / STARTUP_DUR;
      if (p2GunCheckFiredAt[0] === 0 && _p2sp >= GUN_CHECK_AT[0]) { p2GunCheckFiredAt[0] = t; }
      if (p2GunCheckFiredAt[0] > 0 && p2GunCheckFiredAt[1] === 0 && _p2sp >= GUN_CHECK_AT[1]) { p2GunCheckFiredAt[1] = t; }
      if (_p2sp >= 1.0) { p2LaunchAt = t; p2StartupAt = 0; }
    }

    // ── P2 carrier state tick (1P mode only — in 2P mode P2 shares the main carrier) ───
    if (twoPlayerMode === 'off') {
      if (p2BlockingEnabled === false && _p2ShipVisible && p2CarrierState === 'none') {
        p2CarrierState = 'arriving'; p2CarrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10;
        p2CarrierY = H + 240; p2CarrierArrivingAt = t;
      }
      if (p2BlockingEnabled === true && p2StartupAt === 0 && p2LaunchAt > 0 && (p2CarrierState === 'present' || p2CarrierState === 'arriving')) {
        p2CarrierState = 'leaving'; p2CarrierLeavingAt = t;
      }
      if (p2CarrierState === 'arriving') {
        const _p2cp = Math.min(1, (t - p2CarrierArrivingAt) / CARRIER_ARRIVE_DUR);
        const _p2ease = 1 - Math.pow(1 - _p2cp, 3);
        p2CarrierY = (H + 240) + (p2CarrierRestY - (H + 240)) * _p2ease;
        if (_p2cp >= 1) { p2CarrierState = 'present'; p2CarrierY = p2CarrierRestY; }
      }
      if (p2CarrierState === 'leaving') {
        const _p2lp = Math.min(1, (t - p2CarrierLeavingAt) / CARRIER_LEAVE_DUR);
        p2CarrierY = p2CarrierRestY + _p2lp * _p2lp * (H + 240 - p2CarrierRestY);
        if (_p2lp >= 1) { p2CarrierState = 'none'; p2CarrierY = 0; p2CarrierRestY = 0; }
      }
    }

    if (settingsBtnEl) {
      const _startupPhase = shipPowerState === 'startup' ? (t - startupAt) / STARTUP_DUR : -1;
      // Auto-hide slide + warp shake are applied to the button as a transform in
      // render() (below), locked to the canvas HUD. Here we only fade it out for
      // power-up/down transitions.
      const _btnHide = twoPlayerMode === 'off' && (shipPowerState === 'powerdown' || (_startupPhase >= 0 && _startupPhase <= 0.72));
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

    try {
      render(t);
    } catch (e) {
      console.error('Render error, resetting canvas context:', e);
      // Reassigning canvas.width resets the entire 2D context state (transform, clip,
      // save stack) so a dirty ctx from a mid-render throw can't corrupt future frames.
      canvas.width = canvas.width;
      // The reset above also clears the device-pixel transform; restore it.
      ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    }

  }

  const _phIcon = new Image();
  _phIcon.src = PROVIDER_ICON;

  const _SHIP_CONFIGS = {
    protector:  { bmp: PROTECTOR_BMP,     color: 'rgba(195,208,240,0.95)', glow: 'rgba(170,190,235,0.55)', dimColor: 'rgba(195,208,240,0.55)',
                  flares: [{ xOff: -20, yOff: 0, size: 1, burstWScale: 0 }, { xOff: 20, yOff: 0, size: 1, burstWScale: 0 }] },
    falcon:     { bmp: FALCON_BMP,     color: 'rgba(195,208,240,0.95)', glow: 'rgba(170,190,235,0.45)', dimColor: 'rgba(195,208,240,0.55)',
                  flares: [{ xOff: -3, yOff: 1, size: 3.2, len: 0.75, taper: 0.85, shape: 'column', wobble: 0.15, burstWScale: 0 }] },
    swordfish:  { bmp: SWORDFISH_BMP,  color: 'rgba(207,50,33,0.95)', glow: 'rgba(203,38,20,0.55)', dimColor: 'rgba(207,50,33,0.55)',
                  flares: [{ xOff: 0, yOff: 5, size: 1.5, len: 1.0, burstWScale: 0 }] },
    enterprise: { bmp: ENTERPRISE_BMP, color: 'rgba(195,208,240,0.95)', glow: 'rgba(170,190,235,0.48)', dimColor: 'rgba(195,208,240,0.55)',
                  flares: [{ xOff: -13.5, yOff: 2, size: 0.9, burstWScale: 0 }, { xOff: 13.5, yOff: 2, size: 0.9, burstWScale: 0 }, { xOff: 0, yOff: -40, size: 0.50, burstWScale: 0, col: 'fire' }] },
    serenity:   { bmp: SERENITY_BMP,   color: 'rgba(195,208,240,0.95)', glow: 'rgba(170,190,235,0.55)', dimColor: 'rgba(195,208,240,0.55)',
                  flares: [{ xOff: -19.5, yOff: -17, size: 1, burstWScale: 0 }, { xOff: 19.5, yOff: -17, size: 1, burstWScale: 0 }] },
    normandy:   { bmp: NORMANDY_BMP,   color: 'rgba(195,208,240,0.95)', glow: 'rgba(170,190,235,0.55)', dimColor: 'rgba(195,208,240,0.55)',
                  flares: [{ xOff: -7.5, yOff: 4, size: 0.8, burstWScale: 0 }, { xOff: 7.5, yOff: 4, size: 0.8, burstWScale: 0 }, { xOff: -16.5, yOff: -2, size: 0.8, burstWScale: 0 }, { xOff: 16.5, yOff: -2, size: 0.8, burstWScale: 0 }] },
    pes:        { bmp: PES_BMP,        color: 'rgba(89,223,139,0.95)', glow: 'rgba(89,223,139,0.55)', dimColor: 'rgba(89,223,139,0.55)',
                  flares: [{ xOff: 0, yOff: -24, size: 1.5, burstWScale: 0 }], flareSplitRow: 22, launchBlastYOff: -24, launchBlastSourceHW: 4.5 },
    inbound:    { bmp: INBOUND_BMP,    color: 'rgba(140,145,155,0.50)', glow: 'rgba(120,125,135,0.28)', dimColor: 'rgba(140,145,155,0.15)',
                  flares: [] },
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
      const _wp = Math.max(0, Math.min(1, (t - warpAt) / WARP_OUT_DUR));
      const _p2 = Math.max(0, (_wp - 0.40) / 0.60);
      if (_p2 > 0) warpFrontY = shipY - _p2 * (H + 300);
    }

    // Bay trapdoor: two panels slide in/out at a ship's carrier bay during ship swaps
    const _drawTrapDoor = (shName, isClosing, p, _cx, _cy) => {
      const _bi = CARRIER_SHIP_ORDER.indexOf(shName);
      if (_bi < 0) return;
      const _bx = _cx + CARRIER_BAY_DX[_bi];
      const _by = _cy + CARRIER_BAY_DY[_bi];
      const _ep = isClosing ? p : 1 - p;  // 0 = open, 1 = closed
      const hw = 38, ph = 28;
      const _lx = _bx - hw * (2 - _ep);   // left panel left edge
      const _rx = _bx + hw * (1 - _ep);   // right panel left edge
      ctx.save();
      ctx.fillStyle = 'rgba(8, 28, 105, 1)';
      ctx.fillRect(_lx, _by - ph, hw, ph * 2);
      ctx.fillRect(_rx, _by - ph, hw, ph * 2);
      const _gA = Math.min(1, _ep * 2.5);
      ctx.shadowColor = 'rgba(145, 210, 255, 1)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = `rgba(220, 248, 255, ${_gA.toFixed(2)})`;
      ctx.fillRect(_lx + hw - 1, _by - ph, 3, ph * 2);
      ctx.fillRect(_rx, _by - ph, 3, ph * 2);
      ctx.shadowBlur = 0;
      if (_ep > 0.60) {
        const _fa = (_ep - 0.60) / 0.40;
        ctx.fillStyle = `rgba(200, 242, 255, ${(_fa * 0.90).toFixed(2)})`;
        ctx.fillRect(_bx - hw, _by - ph, hw * 2, ph * 2);
      }
      ctx.restore();
    };

    // ── Carrier ship ──────────────────────────────────────────────────────
    if (carrierState !== 'none') {
      const ccx = Math.round(_carrierSmoothX);
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
        const _iOy = Math.round(ccy - CARRIER_BMP.length * CARRIER_PX / 2) + 1 * CARRIER_PX;
        ctx.fillStyle = 'rgba(25, 65, 140, 0.07)';
        ctx.fillRect(_iOx, _iOy, 71 * CARRIER_PX, (CARRIER_BMP.length - 2) * CARRIER_PX);
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
        const _hatchY = ccy - 111;  // under island structure (bitmap row 1, 40-row carrier)
        const _topRail = ccy - 90;  // above row 1 ships (top safe corridor)
        const _midCY   = ccy +   6; // between ship rows (mid safe corridor)
        const _botRail = ccy + 102; // below row 2 ships (bottom safe corridor)
        // Gap X offsets from ccx for routing fuel crew to each ship bay (between column pairs)
        const _gapDXs = [-90, 0, 90, 90, -90, 0, 90];

        const _crewEligible = carrierState === 'present' && shipPowerState === 'down'
            && blockingEnabled === false && t - blockingOffSince >= 30000;

        // Build a ship-avoiding flee path using per-crew fleeX/fleeViaY safe corridor
        const _makeFleePath = c => {
          const fx = c.fleeX;
          const fy = c.fleeViaY;
          const pts = [];
          if (c.y <= fy) {
            if (Math.abs(c.x - _hatchX) > 6) pts.push({ x: _hatchX, y: c.y });
            pts.push({ x: _hatchX, y: _hatchY });
          } else {
            if (Math.abs(c.x - fx) > 10) pts.push({ x: fx, y: c.y });
            pts.push({ x: fx, y: fy });
            if (Math.abs(fx - _hatchX) > 6) pts.push({ x: _hatchX, y: fy });
            pts.push({ x: _hatchX, y: _hatchY });
          }
          return pts;
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
            if (t - c.stateAt >= c.lifetime) {
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

        // Spawn crew to service the active ship (skip if ship has no carrier bay yet)
        if (_crewEligible && t > crewNextSpawn && crewMembers.length < 3 &&
            CARRIER_SHIP_ORDER.indexOf(currentShip) >= 0) {
          const _hasFuel = crewMembers.some(c => c.type === 'fuel');
          const _fuelOk = !_hasFuel && t - lastFuelAt >= 300000;
          const _firstCrew = crewMembers.length === 0 && lastFuelAt === 0;
          const _type = (_firstCrew || _fuelOk) && !_hasFuel
            ? 'fuel'
            : ['inspect', 'signal', 'repair', 'idle'][Math.floor(Math.random() * 4)];
          const _shipIdx = CARRIER_SHIP_ORDER.indexOf(currentShip);
          const _bayX = ccx + CARRIER_BAY_DX[_shipIdx];
          const _bayDY = CARRIER_BAY_DY[_shipIdx];
          const _gapX = ccx + _gapDXs[_shipIdx];
          const _isRow1 = _bayDY < 0;
          const _rowTopCY = _isRow1 ? _topRail : _midCY;
          const _bumpX = ccx + CARRIER_BUMP_DX[_shipIdx];
          const _bumpY = ccy + CARRIER_BUMP_DY[_shipIdx];
          const _isSideBump = _isRow1; // row 1 ships fuel from port/starboard side bumps

          let _waypoints, _returnPath, _fleeX, _fleeViaY;
          if (_type === 'fuel') {
            const _shipBackY = ccy + _bayDY + Math.ceil(bmpH(_SHIP_CONFIGS[currentShip].bmp) * PX / 2) - (currentShip === 'enterprise' ? 9 : 0) + (currentShip === 'swordfish' ? 4 : 0) - (currentShip === 'protector' ? 9 : 0) + (currentShip === 'falcon' ? 2 : 0);
            if (_isSideBump) {
              _fleeX = _gapX; _fleeViaY = _topRail;
              _waypoints = [
                { x: _hatchX, y: _topRail },        // step into top corridor
                { x: _gapX,   y: _topRail },        // slide to gap column
                { x: _gapX,   y: _bumpY },          // descend in gap to bump level
                { x: _bumpX,  y: _bumpY },          // walk to fuel port
                { x: _bayX,   y: _shipBackY },       // park under ship bottom edge
              ];
              _returnPath = [
                { x: _bumpX,  y: _bumpY },          // step back from ship
                { x: _gapX,   y: _bumpY },          // walk back toward gap column
                { x: _gapX,   y: _topRail },        // climb to top corridor
                { x: _hatchX, y: _topRail },        // slide to hatch column
                { x: _hatchX, y: _hatchY },         // return to hatch
              ];
            } else {
              _fleeX = _gapX; _fleeViaY = _midCY;
              _waypoints = [
                { x: _hatchX, y: _midCY },      // descend to mid corridor
                { x: _gapX,   y: _midCY },      // slide to gap lane
                { x: _gapX,   y: _botRail },    // drop to bottom rail
                { x: _bumpX,  y: _bumpY - 4 }, // approach bottom bump
                { x: _bayX,   y: _shipBackY },  // walk hose up to ship back
              ];
              _returnPath = [
                { x: _bumpX,  y: _bumpY - 4 }, // walk hose back to bump
                { x: _gapX,   y: _botRail },    // slide to gap lane
                { x: _gapX,   y: _midCY },      // climb through gap to mid corridor
                { x: _hatchX, y: _midCY },      // slide to hatch column
                { x: _hatchX, y: _hatchY },     // return to hatch
              ];
            }
          } else {
            const _takenSpots = crewMembers
              .filter(c => c.type !== 'fuel' && c.waypoints)
              .map(c => c.waypoints[c.waypoints.length - 1]);
            if (Math.random() < 0.4) {
              // Work alongside the ship in the gap lane
              _fleeX = _gapX; _fleeViaY = _rowTopCY;
              let _sideY, _sa = 0;
              do {
                _sideY = ccy + _bayDY + Math.round((Math.random() - 0.5) * 48);
                _sa++;
              } while (_sa < 20 && _takenSpots.some(s => Math.abs(s.x - _gapX) < 5 && Math.abs(s.y - _sideY) < 14));
              _waypoints = [
                { x: _hatchX, y: _rowTopCY },
                { x: _gapX,   y: _rowTopCY },
                { x: _gapX,   y: _sideY },
              ];
              _returnPath = [
                { x: _gapX,   y: _rowTopCY },
                { x: _hatchX, y: _rowTopCY },
                { x: _hatchX, y: _hatchY },
              ];
            } else {
              // Work in the corridor at the active ship's row level
              _fleeX = _hatchX; _fleeViaY = _rowTopCY;
              let _workX, _attempts = 0;
              do {
                _workX = _bayX + Math.round((Math.random() - 0.5) * 40);
                _attempts++;
              } while (_attempts < 20 && _takenSpots.some(s => Math.abs(s.y - _rowTopCY) < 5 && Math.abs(s.x - _workX) < 14));
              _waypoints = [
                { x: _hatchX, y: _rowTopCY },
                { x: _workX,  y: _rowTopCY },
              ];
              _returnPath = [
                { x: _hatchX, y: _rowTopCY },
                { x: _hatchX, y: _hatchY },
              ];
            }
          }

          crewMembers.push({
            type: _type, x: _hatchX, y: _hatchY, fromX: _hatchX, fromY: _hatchY,
            state: 'walking', stateAt: t, wpIdx: 0,
            waypoints: _waypoints, returnPath: _returnPath,
            bumpX: _bumpX, bumpY: _bumpY, fleeX: _fleeX, fleeViaY: _fleeViaY,
            hoseFwdWpIdx: _waypoints.length - 1,
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

          // Fuel hose - extends as he walks to ship, retracts as he returns
          if (c.type === 'fuel' && (
              c.state === 'at_post' ||
              (c.state === 'walking'   && c.wpIdx === c.hoseFwdWpIdx) ||
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
      // Ground crew for P2 ship on shared carrier (2P mode)
      if (twoPlayerMode !== 'off') {
        const _p2HatchX = ccx, _p2HatchY = ccy - 111;
        const _p2TopRail = ccy - 90, _p2MidCY = ccy + 6, _p2BotRail = ccy + 102;
        const _p2GapDXs = [-90, 0, 90, 90, -90, 0, 90];
        const _p2CrewEligible = carrierState === 'present' && p2BlockingEnabled === false && t - p2BlockingOffSince >= 30000;
        const _p2MakeFleePath = c => {
          const fx = c.fleeX, fy = c.fleeViaY, pts = [];
          if (c.y <= fy) {
            if (Math.abs(c.x - _p2HatchX) > 6) pts.push({ x: _p2HatchX, y: c.y });
            pts.push({ x: _p2HatchX, y: _p2HatchY });
          } else {
            if (Math.abs(c.x - fx) > 10) pts.push({ x: fx, y: c.y });
            pts.push({ x: fx, y: fy });
            if (Math.abs(fx - _p2HatchX) > 6) pts.push({ x: _p2HatchX, y: fy });
            pts.push({ x: _p2HatchX, y: _p2HatchY });
          }
          return pts;
        };
        if (p2StartupAt > 0) {
          for (const c of p2CrewMembers) {
            if (c.state !== 'fleeing') { c.state = 'fleeing'; c.stateAt = t; c.wpIdx = 0; c.fromX = c.x; c.fromY = c.y; c.returnPath = _p2MakeFleePath(c); c.fleepathReady = true; }
          }
        }
        for (const c of p2CrewMembers) {
          if (c.state === 'fleeing' && !c.fleepathReady) { c.fromX = c.x; c.fromY = c.y; c.returnPath = _p2MakeFleePath(c); c.fleepathReady = true; }
        }
        for (const c of p2CrewMembers) {
          const _dt = (t - c.stateAt) / 1000;
          if (c.state === 'walking' || c.state === 'returning' || c.state === 'fleeing') {
            const _path = c.state === 'walking' ? c.waypoints : c.returnPath;
            const _speed = c.state === 'fleeing' ? 85 : 28;
            if (c.wpIdx >= _path.length) { if (c.state === 'walking') { c.state = 'at_post'; c.stateAt = t; } continue; }
            const _wp = _path[c.wpIdx];
            const _dist = Math.hypot(_wp.x - c.fromX, _wp.y - c.fromY);
            const _p = _dist > 0 ? Math.min(1, _dt * _speed / _dist) : 1;
            c.x = c.fromX + (_wp.x - c.fromX) * _p; c.y = c.fromY + (_wp.y - c.fromY) * _p;
            if (_p >= 1) { c.x = _wp.x; c.y = _wp.y; c.wpIdx++; c.fromX = c.x; c.fromY = c.y; c.stateAt = t; if (c.wpIdx >= _path.length && c.state === 'walking') { c.state = 'at_post'; c.stateAt = t; } }
          } else if (c.state === 'at_post') {
            if (t - c.stateAt >= c.lifetime) { c.state = 'returning'; c.stateAt = t; c.wpIdx = 0; c.fromX = c.x; c.fromY = c.y; if (c.type === 'fuel') p2LastFuelAt = t; }
          }
        }
        p2CrewMembers = p2CrewMembers.filter(c => (c.state !== 'returning' && c.state !== 'fleeing') || Math.hypot(c.x - _p2HatchX, c.y - _p2HatchY) > 5);
        if (_p2CrewEligible && t > p2CrewNextSpawn && p2CrewMembers.length < 3 && CARRIER_SHIP_ORDER.indexOf(p2CurrentShip) >= 0) {
          const _hasFuel = p2CrewMembers.some(c => c.type === 'fuel');
          const _fuelOk = !_hasFuel && t - p2LastFuelAt >= 300000;
          const _firstCrew = p2CrewMembers.length === 0 && p2LastFuelAt === 0;
          const _type = (_firstCrew || _fuelOk) && !_hasFuel ? 'fuel' : ['inspect', 'signal', 'repair', 'idle'][Math.floor(Math.random() * 4)];
          const _p2SI = CARRIER_SHIP_ORDER.indexOf(p2CurrentShip);
          const _p2BayX = ccx + CARRIER_BAY_DX[_p2SI], _p2BayDY = CARRIER_BAY_DY[_p2SI];
          const _p2GapX = ccx + _p2GapDXs[_p2SI], _p2IsRow1 = _p2BayDY < 0;
          const _p2RowTopCY = _p2IsRow1 ? _p2TopRail : _p2MidCY;
          const _p2BumpX = ccx + CARRIER_BUMP_DX[_p2SI], _p2BumpY = ccy + CARRIER_BUMP_DY[_p2SI];
          let _p2Wp, _p2Ret, _p2FleeX, _p2FleeViaY;
          if (_type === 'fuel') {
            const _p2ShipBackY = ccy + _p2BayDY + Math.ceil(bmpH(_SHIP_CONFIGS[p2CurrentShip].bmp) * PX / 2) - (p2CurrentShip === 'enterprise' ? 9 : 0) + (p2CurrentShip === 'swordfish' ? 4 : 0) - (p2CurrentShip === 'protector' ? 9 : 0) + (p2CurrentShip === 'falcon' ? 2 : 0);
            if (_p2IsRow1) {
              _p2FleeX = _p2GapX; _p2FleeViaY = _p2TopRail;
              _p2Wp  = [{ x: _p2HatchX, y: _p2TopRail }, { x: _p2GapX, y: _p2TopRail }, { x: _p2GapX, y: _p2BumpY }, { x: _p2BumpX, y: _p2BumpY }, { x: _p2BayX, y: _p2ShipBackY }];
              _p2Ret = [{ x: _p2BumpX, y: _p2BumpY }, { x: _p2GapX, y: _p2BumpY }, { x: _p2GapX, y: _p2TopRail }, { x: _p2HatchX, y: _p2TopRail }, { x: _p2HatchX, y: _p2HatchY }];
            } else {
              _p2FleeX = _p2GapX; _p2FleeViaY = _p2MidCY;
              _p2Wp  = [{ x: _p2HatchX, y: _p2MidCY }, { x: _p2GapX, y: _p2MidCY }, { x: _p2GapX, y: _p2BotRail }, { x: _p2BumpX, y: _p2BumpY - 4 }, { x: _p2BayX, y: _p2ShipBackY }];
              _p2Ret = [{ x: _p2BumpX, y: _p2BumpY - 4 }, { x: _p2GapX, y: _p2BotRail }, { x: _p2GapX, y: _p2MidCY }, { x: _p2HatchX, y: _p2MidCY }, { x: _p2HatchX, y: _p2HatchY }];
            }
          } else {
            const _taken = p2CrewMembers.filter(c => c.type !== 'fuel' && c.waypoints).map(c => c.waypoints[c.waypoints.length - 1]);
            if (Math.random() < 0.4) {
              _p2FleeX = _p2GapX; _p2FleeViaY = _p2RowTopCY;
              let _sy, _sa = 0; do { _sy = ccy + _p2BayDY + Math.round((Math.random() - 0.5) * 48); _sa++; } while (_sa < 20 && _taken.some(s => Math.abs(s.x - _p2GapX) < 5 && Math.abs(s.y - _sy) < 14));
              _p2Wp  = [{ x: _p2HatchX, y: _p2RowTopCY }, { x: _p2GapX, y: _p2RowTopCY }, { x: _p2GapX, y: _sy }];
              _p2Ret = [{ x: _p2GapX, y: _p2RowTopCY }, { x: _p2HatchX, y: _p2RowTopCY }, { x: _p2HatchX, y: _p2HatchY }];
            } else {
              _p2FleeX = _p2HatchX; _p2FleeViaY = _p2RowTopCY;
              let _wx, _wa = 0; do { _wx = _p2BayX + Math.round((Math.random() - 0.5) * 40); _wa++; } while (_wa < 20 && _taken.some(s => Math.abs(s.y - _p2RowTopCY) < 5 && Math.abs(s.x - _wx) < 14));
              _p2Wp  = [{ x: _p2HatchX, y: _p2RowTopCY }, { x: _wx, y: _p2RowTopCY }];
              _p2Ret = [{ x: _p2HatchX, y: _p2RowTopCY }, { x: _p2HatchX, y: _p2HatchY }];
            }
          }
          p2CrewMembers.push({ type: _type, x: _p2HatchX, y: _p2HatchY, fromX: _p2HatchX, fromY: _p2HatchY, state: 'walking', stateAt: t, wpIdx: 0, waypoints: _p2Wp, returnPath: _p2Ret, bumpX: _p2BumpX, bumpY: _p2BumpY, fleeX: _p2FleeX, fleeViaY: _p2FleeViaY, hoseFwdWpIdx: _p2Wp.length - 1, spawnedAt: t, lifetime: 18000 + Math.random() * 14000 });
          p2CrewNextSpawn = t + 5000 + Math.random() * 8000;
        }
        for (const c of p2CrewMembers) {
          const _distToHatch = Math.hypot(c.x - _p2HatchX, c.y - _p2HatchY);
          const _a = Math.min(1, (t - c.spawnedAt) / 400) * Math.min(1, _distToHatch / 16);
          if (_a < 0.01) continue;
          ctx.save(); ctx.globalAlpha *= _a;
          const _dx = Math.round(c.x), _dy = Math.round(c.y);
          const _col = c.type === 'fuel' ? 'rgba(240,175,70,0.95)' : c.type === 'inspect' ? 'rgba(120,195,255,0.95)' : c.type === 'repair' ? 'rgba(255,140,80,0.95)' : c.type === 'idle' ? 'rgba(180,200,180,0.85)' : 'rgba(255,225,70,0.95)';
          if (c.type === 'fuel' && (c.state === 'at_post' || (c.state === 'walking' && c.wpIdx === c.hoseFwdWpIdx) || (c.state === 'returning' && c.wpIdx === 0))) {
            ctx.strokeStyle = `rgba(255,160,40,${(0.7 + 0.2 * Math.sin(t * 0.005)).toFixed(2)})`; ctx.lineWidth = 0.3;
            ctx.beginPath(); ctx.moveTo(_dx, _dy + 4); ctx.quadraticCurveTo((_dx + c.bumpX) / 2 + 7, (_dy + 4 + c.bumpY) / 2, c.bumpX, c.bumpY); ctx.stroke();
          }
          if (c.state === 'at_post') {
            if (c.type === 'fuel') { const _by = _dy + Math.round(Math.sin(t * 0.0025) * 1); drawBmp(ctx, Math.floor(t / 1100) % 2 === 0 ? CREW_CROUCH : CREW_STAND_A, _dx, _by, _col, null, CREW_PX);
            } else if (c.type === 'inspect') { const _raised = Math.sin(t * 0.0014) > 0.55; drawBmp(ctx, _raised ? CREW_REACH : CREW_STAND_A, _dx, _dy, _col, null, CREW_PX); if (_raised) { ctx.fillStyle = 'rgba(190,235,255,0.6)'; ctx.shadowColor = 'rgba(80,190,255,0.5)'; ctx.shadowBlur = 3; ctx.fillRect(_dx + 3, _dy - 5, 2, 4); ctx.shadowBlur = 0; }
            } else if (c.type === 'repair') { drawBmp(ctx, CREW_CROUCH, _dx, _dy, _col, null, CREW_PX); if (Math.sin(t * 0.007) > 0.85) { ctx.fillStyle = 'rgba(255,220,80,0.9)'; ctx.shadowColor = 'rgba(255,200,40,0.8)'; ctx.shadowBlur = 5; ctx.fillRect(_dx + 2, _dy - 3, 2, 2); ctx.shadowBlur = 0; }
            } else if (c.type === 'idle') { drawBmp(ctx, Math.floor(t / 2200) % 2 === 0 ? CREW_STAND_A : CREW_STAND_B, _dx, _dy, _col, null, CREW_PX);
            } else { drawBmp(ctx, Math.floor(t / 700) % 2 === 0 ? CREW_REACH : CREW_STAND_A, _dx, _dy, _col, null, CREW_PX); }
          } else { const _rate = c.state === 'fleeing' ? 110 : 260; drawBmp(ctx, Math.floor(t / _rate) % 2 === 0 ? CREW_STAND_A : CREW_STAND_B, _dx, _dy, _col, null, CREW_PX); }
          ctx.restore();
        }
      }
      // Redraw hatch structure rows on top of crew so crew appears behind it
      drawBmp(ctx, CARRIER_BMP.slice(1, 3), ccx, ccy - 108, 'rgba(130,145,170,0.88)', 'rgba(100,120,160,0.28)', CARRIER_PX);
      // Inactive ships drawn after crew so crew always appears underneath parked ships
      for (let bi = 0; bi < CARRIER_SHIP_ORDER.length; bi++) {
        const bShip = CARRIER_SHIP_ORDER[bi];
        if (bShip === currentShip || (twoPlayerMode !== 'off' && bShip === p2CurrentShip)) continue;
        const bx = ccx + CARRIER_BAY_DX[bi];
        const by = ccy + CARRIER_BAY_DY[bi];
        drawBmp(ctx, _SHIP_CONFIGS[bShip].bmp, bx, by, _SHIP_CONFIGS[bShip].dimColor, null, PX);
      }
      // Bay trapdoor effects for P1 ship swap
      if (warpState === 'out' && warpNextShip !== null) { _drawTrapDoor(warpNextShip, true, Math.min(1, (t - warpAt) / (WARP_OUT_DUR * 0.50)), ccx, ccy); }
      if (warpState === 'in' && warpPrevShip !== null) { _drawTrapDoor(warpPrevShip, false, Math.min(1, (t - warpAt) / (WARP_IN_DUR * 0.45)), ccx, ccy); }
      // Bay trapdoor effects for P2 ship swap (shared carrier in 2P mode)
      if (twoPlayerMode !== 'off') {
        if (p2WarpState === 'out' && p2WarpNextShip !== null) { _drawTrapDoor(p2WarpNextShip, true, Math.min(1, (t - p2WarpAt) / (WARP_OUT_DUR * 0.50)), ccx, ccy); }
        if (p2WarpState === 'in' && p2WarpPrevShip !== null) { _drawTrapDoor(p2WarpPrevShip, false, Math.min(1, (t - p2WarpAt) / (WARP_IN_DUR * 0.45)), ccx, ccy); }
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

    // ── P2 Carrier ship (1P mode only — in 2P mode P2 shares the centered main carrier) ───
    if (p2CarrierState !== 'none' && twoPlayerMode === 'off') {
      const _p2ccx = Math.round(_p2CarrierSmoothX);
      const _p2ccy = Math.round(p2CarrierY);
      const _p2cFade = p2CarrierState === 'arriving'
        ? Math.min(1, (t - p2CarrierArrivingAt) / 700)
        : p2CarrierState === 'leaving'
        ? Math.max(0, 1 - (t - p2CarrierLeavingAt) / 550)
        : 1;
      ctx.save();
      ctx.globalAlpha = _p2cFade;
      { const _iOx = Math.round(_p2ccx - 75 * CARRIER_PX / 2) + 2 * CARRIER_PX;
        const _iOy = Math.round(_p2ccy - CARRIER_BMP.length * CARRIER_PX / 2) + 1 * CARRIER_PX;
        ctx.fillStyle = 'rgba(25, 65, 140, 0.07)';
        ctx.fillRect(_iOx, _iOy, 71 * CARRIER_PX, (CARRIER_BMP.length - 2) * CARRIER_PX); }
      drawBmp(ctx, CARRIER_BMP, _p2ccx, _p2ccy, 'rgba(130,145,170,0.88)', 'rgba(100,120,160,0.28)', CARRIER_PX);
      for (let _li = 0; _li < CARRIER_LIGHT_OFFSETS.length; _li++) {
        const _lo = CARRIER_LIGHT_OFFSETS[_li];
        const _lb = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.003 + _li * 0.47));
        ctx.fillStyle = `rgba(255,155,30,${_lb.toFixed(3)})`;
        ctx.shadowColor = 'rgba(255,120,10,0.9)'; ctx.shadowBlur = 12;
        ctx.fillRect(_p2ccx + _lo.dx - 2, _p2ccy + _lo.dy - 2, 5, 5);
      }
      ctx.shadowBlur = 0;
      // Ground crew for P2 ship
      {
        const _p2HatchX = _p2ccx, _p2HatchY = _p2ccy - 111;
        const _p2TopRail = _p2ccy - 90, _p2MidCY = _p2ccy + 6, _p2BotRail = _p2ccy + 102;
        const _p2GapDXs = [-90, 0, 90, 90, -90, 0, 90];
        const _p2CrewEligible = p2CarrierState === 'present' && p2BlockingEnabled === false && t - p2BlockingOffSince >= 30000;
        const _p2MakeFleePath = c => {
          const fx = c.fleeX, fy = c.fleeViaY, pts = [];
          if (c.y <= fy) {
            if (Math.abs(c.x - _p2HatchX) > 6) pts.push({ x: _p2HatchX, y: c.y });
            pts.push({ x: _p2HatchX, y: _p2HatchY });
          } else {
            if (Math.abs(c.x - fx) > 10) pts.push({ x: fx, y: c.y });
            pts.push({ x: fx, y: fy });
            if (Math.abs(fx - _p2HatchX) > 6) pts.push({ x: _p2HatchX, y: fy });
            pts.push({ x: _p2HatchX, y: _p2HatchY });
          }
          return pts;
        };
        if (p2StartupAt > 0) {
          for (const c of p2CrewMembers) {
            if (c.state !== 'fleeing') { c.state = 'fleeing'; c.stateAt = t; c.wpIdx = 0; c.fromX = c.x; c.fromY = c.y; c.returnPath = _p2MakeFleePath(c); c.fleepathReady = true; }
          }
        }
        for (const c of p2CrewMembers) {
          if (c.state === 'fleeing' && !c.fleepathReady) { c.fromX = c.x; c.fromY = c.y; c.returnPath = _p2MakeFleePath(c); c.fleepathReady = true; }
        }
        for (const c of p2CrewMembers) {
          const _dt = (t - c.stateAt) / 1000;
          if (c.state === 'walking' || c.state === 'returning' || c.state === 'fleeing') {
            const _path = c.state === 'walking' ? c.waypoints : c.returnPath;
            const _speed = c.state === 'fleeing' ? 85 : 28;
            if (c.wpIdx >= _path.length) { if (c.state === 'walking') { c.state = 'at_post'; c.stateAt = t; } continue; }
            const _wp = _path[c.wpIdx];
            const _dist = Math.hypot(_wp.x - c.fromX, _wp.y - c.fromY);
            const _p = _dist > 0 ? Math.min(1, _dt * _speed / _dist) : 1;
            c.x = c.fromX + (_wp.x - c.fromX) * _p; c.y = c.fromY + (_wp.y - c.fromY) * _p;
            if (_p >= 1) { c.x = _wp.x; c.y = _wp.y; c.wpIdx++; c.fromX = c.x; c.fromY = c.y; c.stateAt = t; if (c.wpIdx >= _path.length && c.state === 'walking') { c.state = 'at_post'; c.stateAt = t; } }
          } else if (c.state === 'at_post') {
            if (t - c.stateAt >= c.lifetime) { c.state = 'returning'; c.stateAt = t; c.wpIdx = 0; c.fromX = c.x; c.fromY = c.y; if (c.type === 'fuel') p2LastFuelAt = t; }
          }
        }
        p2CrewMembers = p2CrewMembers.filter(c => (c.state !== 'returning' && c.state !== 'fleeing') || Math.hypot(c.x - _p2HatchX, c.y - _p2HatchY) > 5);
        if (_p2CrewEligible && t > p2CrewNextSpawn && p2CrewMembers.length < 3 && CARRIER_SHIP_ORDER.indexOf(p2CurrentShip) >= 0) {
          const _hasFuel = p2CrewMembers.some(c => c.type === 'fuel');
          const _fuelOk = !_hasFuel && t - p2LastFuelAt >= 300000;
          const _firstCrew = p2CrewMembers.length === 0 && p2LastFuelAt === 0;
          const _type = (_firstCrew || _fuelOk) && !_hasFuel ? 'fuel' : ['inspect', 'signal', 'repair', 'idle'][Math.floor(Math.random() * 4)];
          const _p2SI = CARRIER_SHIP_ORDER.indexOf(p2CurrentShip);
          const _p2BayX = _p2ccx + CARRIER_BAY_DX[_p2SI], _p2BayDY = CARRIER_BAY_DY[_p2SI];
          const _p2GapX = _p2ccx + _p2GapDXs[_p2SI], _p2IsRow1 = _p2BayDY < 0;
          const _p2RowTopCY = _p2IsRow1 ? _p2TopRail : _p2MidCY;
          const _p2BumpX = _p2ccx + CARRIER_BUMP_DX[_p2SI], _p2BumpY = _p2ccy + CARRIER_BUMP_DY[_p2SI];
          let _p2Wp, _p2Ret, _p2FleeX, _p2FleeViaY;
          if (_type === 'fuel') {
            const _p2ShipBackY = _p2ccy + _p2BayDY + Math.ceil(bmpH(_SHIP_CONFIGS[p2CurrentShip].bmp) * PX / 2) - (p2CurrentShip === 'enterprise' ? 9 : 0) + (p2CurrentShip === 'swordfish' ? 4 : 0) - (p2CurrentShip === 'protector' ? 9 : 0) + (p2CurrentShip === 'falcon' ? 2 : 0);
            if (_p2IsRow1) {
              _p2FleeX = _p2GapX; _p2FleeViaY = _p2TopRail;
              _p2Wp  = [{ x: _p2HatchX, y: _p2TopRail }, { x: _p2GapX, y: _p2TopRail }, { x: _p2GapX, y: _p2BumpY }, { x: _p2BumpX, y: _p2BumpY }, { x: _p2BayX, y: _p2ShipBackY }];
              _p2Ret = [{ x: _p2BumpX, y: _p2BumpY }, { x: _p2GapX, y: _p2BumpY }, { x: _p2GapX, y: _p2TopRail }, { x: _p2HatchX, y: _p2TopRail }, { x: _p2HatchX, y: _p2HatchY }];
            } else {
              _p2FleeX = _p2GapX; _p2FleeViaY = _p2MidCY;
              _p2Wp  = [{ x: _p2HatchX, y: _p2MidCY }, { x: _p2GapX, y: _p2MidCY }, { x: _p2GapX, y: _p2BotRail }, { x: _p2BumpX, y: _p2BumpY - 4 }, { x: _p2BayX, y: _p2ShipBackY }];
              _p2Ret = [{ x: _p2BumpX, y: _p2BumpY - 4 }, { x: _p2GapX, y: _p2BotRail }, { x: _p2GapX, y: _p2MidCY }, { x: _p2HatchX, y: _p2MidCY }, { x: _p2HatchX, y: _p2HatchY }];
            }
          } else {
            const _taken = p2CrewMembers.filter(c => c.type !== 'fuel' && c.waypoints).map(c => c.waypoints[c.waypoints.length - 1]);
            if (Math.random() < 0.4) {
              _p2FleeX = _p2GapX; _p2FleeViaY = _p2RowTopCY;
              let _sy, _sa = 0; do { _sy = _p2ccy + _p2BayDY + Math.round((Math.random() - 0.5) * 48); _sa++; } while (_sa < 20 && _taken.some(s => Math.abs(s.x - _p2GapX) < 5 && Math.abs(s.y - _sy) < 14));
              _p2Wp  = [{ x: _p2HatchX, y: _p2RowTopCY }, { x: _p2GapX, y: _p2RowTopCY }, { x: _p2GapX, y: _sy }];
              _p2Ret = [{ x: _p2GapX, y: _p2RowTopCY }, { x: _p2HatchX, y: _p2RowTopCY }, { x: _p2HatchX, y: _p2HatchY }];
            } else {
              _p2FleeX = _p2HatchX; _p2FleeViaY = _p2RowTopCY;
              let _wx, _wa = 0; do { _wx = _p2BayX + Math.round((Math.random() - 0.5) * 40); _wa++; } while (_wa < 20 && _taken.some(s => Math.abs(s.y - _p2RowTopCY) < 5 && Math.abs(s.x - _wx) < 14));
              _p2Wp  = [{ x: _p2HatchX, y: _p2RowTopCY }, { x: _wx, y: _p2RowTopCY }];
              _p2Ret = [{ x: _p2HatchX, y: _p2RowTopCY }, { x: _p2HatchX, y: _p2HatchY }];
            }
          }
          p2CrewMembers.push({ type: _type, x: _p2HatchX, y: _p2HatchY, fromX: _p2HatchX, fromY: _p2HatchY, state: 'walking', stateAt: t, wpIdx: 0, waypoints: _p2Wp, returnPath: _p2Ret, bumpX: _p2BumpX, bumpY: _p2BumpY, fleeX: _p2FleeX, fleeViaY: _p2FleeViaY, hoseFwdWpIdx: _p2Wp.length - 1, spawnedAt: t, lifetime: 18000 + Math.random() * 14000 });
          p2CrewNextSpawn = t + 5000 + Math.random() * 8000;
        }
        for (const c of p2CrewMembers) {
          const _distToHatch = Math.hypot(c.x - _p2HatchX, c.y - _p2HatchY);
          const _a = Math.min(1, (t - c.spawnedAt) / 400) * Math.min(1, _distToHatch / 16);
          if (_a < 0.01) continue;
          ctx.save(); ctx.globalAlpha *= _a;
          const _dx = Math.round(c.x), _dy = Math.round(c.y);
          const _col = c.type === 'fuel' ? 'rgba(240,175,70,0.95)' : c.type === 'inspect' ? 'rgba(120,195,255,0.95)' : c.type === 'repair' ? 'rgba(255,140,80,0.95)' : c.type === 'idle' ? 'rgba(180,200,180,0.85)' : 'rgba(255,225,70,0.95)';
          if (c.type === 'fuel' && (c.state === 'at_post' || (c.state === 'walking' && c.wpIdx === c.hoseFwdWpIdx) || (c.state === 'returning' && c.wpIdx === 0))) {
            ctx.strokeStyle = `rgba(255,160,40,${(0.7 + 0.2 * Math.sin(t * 0.005)).toFixed(2)})`; ctx.lineWidth = 0.3;
            ctx.beginPath(); ctx.moveTo(_dx, _dy + 4); ctx.quadraticCurveTo((_dx + c.bumpX) / 2 + 7, (_dy + 4 + c.bumpY) / 2, c.bumpX, c.bumpY); ctx.stroke();
          }
          if (c.state === 'at_post') {
            if (c.type === 'fuel') { const _by = _dy + Math.round(Math.sin(t * 0.0025) * 1); drawBmp(ctx, Math.floor(t / 1100) % 2 === 0 ? CREW_CROUCH : CREW_STAND_A, _dx, _by, _col, null, CREW_PX);
            } else if (c.type === 'inspect') { const _raised = Math.sin(t * 0.0014) > 0.55; drawBmp(ctx, _raised ? CREW_REACH : CREW_STAND_A, _dx, _dy, _col, null, CREW_PX); if (_raised) { ctx.fillStyle = 'rgba(190,235,255,0.6)'; ctx.shadowColor = 'rgba(80,190,255,0.5)'; ctx.shadowBlur = 3; ctx.fillRect(_dx + 3, _dy - 5, 2, 4); ctx.shadowBlur = 0; }
            } else if (c.type === 'repair') { drawBmp(ctx, CREW_CROUCH, _dx, _dy, _col, null, CREW_PX); if (Math.sin(t * 0.007) > 0.85) { ctx.fillStyle = 'rgba(255,220,80,0.9)'; ctx.shadowColor = 'rgba(255,200,40,0.8)'; ctx.shadowBlur = 5; ctx.fillRect(_dx + 2, _dy - 3, 2, 2); ctx.shadowBlur = 0; }
            } else if (c.type === 'idle') { drawBmp(ctx, Math.floor(t / 2200) % 2 === 0 ? CREW_STAND_A : CREW_STAND_B, _dx, _dy, _col, null, CREW_PX);
            } else { drawBmp(ctx, Math.floor(t / 700) % 2 === 0 ? CREW_REACH : CREW_STAND_A, _dx, _dy, _col, null, CREW_PX); }
          } else { const _rate = c.state === 'fleeing' ? 110 : 260; drawBmp(ctx, Math.floor(t / _rate) % 2 === 0 ? CREW_STAND_A : CREW_STAND_B, _dx, _dy, _col, null, CREW_PX); }
          ctx.restore();
        }
      }
      // Redraw island on top of crew, then inactive ships on top of both
      drawBmp(ctx, CARRIER_BMP.slice(1, 3), _p2ccx, _p2ccy - 108, 'rgba(130,145,170,0.88)', 'rgba(100,120,160,0.28)', CARRIER_PX);
      for (let _bi2 = 0; _bi2 < CARRIER_SHIP_ORDER.length; _bi2++) {
        const _bs2 = CARRIER_SHIP_ORDER[_bi2];
        if (_bs2 !== p2CurrentShip) {
          drawBmp(ctx, _SHIP_CONFIGS[_bs2].bmp, _p2ccx + CARRIER_BAY_DX[_bi2], _p2ccy + CARRIER_BAY_DY[_bi2], _SHIP_CONFIGS[_bs2].dimColor, null, PX);
        }
      }
      const _p2jft = t * 0.005, _p2cHH = CARRIER_BMP.length * CARRIER_PX / 2;
      const _p2jX = [-155, -55, 55, 155];
      if (p2CarrierState === 'arriving') {
        const _cp2 = Math.min(1, (t - p2CarrierArrivingAt) / CARRIER_ARRIVE_DUR);
        const _js2 = (1 - _cp2 * 0.65) * 0.3;
        for (const jdx of _p2jX) drawEngineFlare(_p2ccx + jdx, _p2ccy + _p2cHH, _p2jft, _js2, _js2 * 1.6);
      } else if (p2CarrierState === 'leaving') {
        const _lp2 = Math.min(1, (t - p2CarrierLeavingAt) / CARRIER_LEAVE_DUR);
        const _js2 = (0.08 + _lp2 * 0.35) * 0.9;
        ctx.save(); ctx.scale(1, -1);
        for (const jdx of _p2jX) drawEngineFlare(_p2ccx + jdx, -(_p2ccy - _p2cHH), _p2jft, _js2, _js2 * 1.6);
        ctx.restore();
      }
      ctx.restore();
    }

    // Entities (drawn after carrier so they appear over it during powerdown)
    ctx.font = '12px "IBM Plex Mono", monospace';
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
        const [colFull, glow, rcol, rglow] = ENTITY_TIER_COLORS[tier >= 3 ? 2 : tier === 2 ? 1 : 0];
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
        ctx.drawImage(_sp.bitmap, -_sp.w / 2, -_sp.h / 2);
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
        ctx.drawImage(_sp.bitmap, -_sp.w / 2, -_sp.h / 2);
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
            ctx.fillStyle = 'rgba(150,230,175,0.72)';
          }
          const dom = e.domain.length > 32 ? '…' + e.domain.slice(-30) : e.domain;
          ctx.fillText(dom, ex, domY);
        }
        ctx.restore();
      }
    }

    // ── P2 entities (right half, cosmetic) ───────────────────────────
    if (twoPlayerMode !== 'off' && p2Entities.length > 0) {
      ctx.save();
      // When carrier is present it's centered at W/2, so the right-half clip would cut through
      // the carrier's center bay column. Lift the left edge to 0 so entities can reach any bay.
      const _p2eClipX = carrierState !== 'none' ? 0 : W / 2;
      ctx.beginPath(); ctx.rect(_p2eClipX, 0, W - _p2eClipX, H - hudSH - safeBottom); ctx.clip();
      ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.imageSmoothingEnabled = false;
      for (const e of p2Entities) {
        const age = t - e.spawnTime;
        const alpha = Math.min(1, (t - e.appearAt) / 400) * 0.80;
        if (alpha < 0.02) continue;
        const EPX = PX;
        ctx.save();
        ctx.globalAlpha = alpha;
        if (e.type === 'blocked') {
          const tier = Math.min(e.count, 3);
          const bmp = tier >= 3 ? E3 : tier === 2 ? E2 : (e.design === 0 ? E0 : E1);
          const pulse = 0.75 + 0.25 * Math.sin(age * 0.005);
          const _tc = ENTITY_TIER_COLORS[tier >= 3 ? 2 : tier === 2 ? 1 : 0];
          const colFull = _tc[0], glow = _tc[1];
          const _sp = getCachedSprite(bmp, colFull, glow, EPX);
          ctx.globalAlpha = alpha * pulse;
          ctx.save(); ctx.translate(e.x, e.y);
          ctx.drawImage(_sp.bitmap, -_sp.w / 2, -_sp.h / 2);
          ctx.restore();
          ctx.globalAlpha = alpha;
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
          ctx.translate(e.x, e.y);
          ctx.rotate(Math.atan2(e.vy, e.vx) + Math.PI / 2);
          const _sp = getCachedSprite(bmp, color, glow, EPX - 1);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(_sp.bitmap, -_sp.w / 2, -_sp.h / 2);
          ctx.imageSmoothingEnabled = false;
          ctx.restore();
        }
        ctx.restore();
        const la = e.type === 'blocked' ? alpha : e.labelAlpha * alpha;
        if (la > 0.02 && (showDomain || showClient)) {
          const tier = Math.min(e.count, 3);
          const lbmp = e.type === 'blocked'
            ? (tier >= 3 ? E3 : tier === 2 ? E2 : (e.design === 0 ? E0 : E1))
            : (tier >= 3 ? F4 : tier === 2 ? F3 : [F0, F1, F2][e.design % 3]);
          const baseY = e.y + (bmpH(lbmp) * EPX / 2) + 13;
          const both = showDomain && showClient;
          ctx.save(); ctx.globalAlpha = la * 0.85;
          if (showClient && e.client) {
            ctx.fillStyle = 'rgba(55,210,185,0.78)';
            const cli = e.client.length > 32 ? '…' + e.client.slice(-30) : e.client;
            ctx.fillText(cli, e.x, baseY);
          }
          if (showDomain) {
            const domY = both && showClient && e.client ? baseY + 14 : baseY;
            if (e.type === 'blocked') {
              ctx.fillStyle = tier >= 3 ? 'rgba(200,100,255,1)' : tier === 2 ? 'rgba(255,160,60,1)' : 'rgba(255,120,100,1)';
            } else {
              ctx.fillStyle = 'rgba(150,230,175,0.72)';
            }
            const dom = e.domain.length > 26 ? '…' + e.domain.slice(-24) : e.domain;
            ctx.fillText(dom, e.x, domY);
          }
          ctx.restore();
        }
      }
      ctx.restore();
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
      ctx.font = '12px "IBM Plex Mono", monospace';
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

    // Triple-click size egg: bouncy grow/shrink with squash-and-stretch. _eggSX/_eggSY are
    // the per-axis scale and _eggRot a decaying tilt; all identity when settled at 1x.
    let _eggSX = 1, _eggSY = 1, _eggRot = 0;
    {
      // Auto-revert once the hold expires: bounce back to normal size on its own.
      if (shipEggBig && t >= shipEggBigUntil) {
        shipEggBig = false; shipEggFrom = shipEggScale; shipEggTo = 1; shipEggAnimAt = t;
      }
      // The shrink is also kicked off early when blocking is disabled (see setBlocking) and
      // plays out during the 'powerdown' hold, so the ship is normal-size by the time it
      // descends. Only snap instantly for cases with no powerdown window: warp, or a
      // ship already committed to 'down'/'startup' (e.g. an external poll-driven toggle).
      if ((warpState !== 'none' || shipPowerState === 'down' || shipPowerState === 'startup') && (shipEggBig || shipEggAnimAt >= 0 || shipEggScale !== 1)) {
        shipEggBig = false; shipEggFrom = 1; shipEggTo = 1; shipEggAnimAt = -1; shipEggScale = 1; shipClickTimes = [];
      }
      let _mag = shipEggTo;
      if (shipEggAnimAt >= 0) {
        const _dur = shipEggTo >= shipEggFrom ? 650 : 520;   // grow lingers, shrink snaps
        const _p = Math.min(1, (t - shipEggAnimAt) / _dur);
        _mag = shipEggFrom + (shipEggTo - shipEggFrom) * _easeOutBack(_p);
        // Jelly wobble: width and height pulse out of phase, decaying over the animation.
        const _wob = Math.sin(_p * Math.PI * 4) * Math.pow(1 - _p, 1.6) * 0.24;
        _eggRot = Math.sin(_p * Math.PI * 5) * Math.pow(1 - _p, 2) * 0.13;
        _eggSX = _mag * (1 + _wob);
        _eggSY = _mag * (1 - _wob);
        if (_p >= 1) shipEggAnimAt = -1;
      } else {
        _eggSX = _mag; _eggSY = _mag;
      }
      shipEggScale = _mag;
    }

    // Laser lines - before ship so hull covers the origin end
    if (twoPlayerMode !== 'off') { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W / 2, H); ctx.clip(); }
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
    if (twoPlayerMode !== 'off') ctx.restore();

    // P2 laser lines (right half, clipped)
    if (twoPlayerMode !== 'off' && p2Lasers.length > 0) {
      const _p2cx_l = Math.round(p2ShipX);
      const _p2cy_l = Math.round(p2ShipY + 2.5 * Math.sin(t * 0.00055 + Math.PI));
      const gtp2 = shipGunTipPos(p2CurrentShip, _p2cx_l, _p2cy_l);
      ctx.save(); ctx.beginPath(); ctx.rect(W / 2, 0, W / 2, H); ctx.clip();
      for (const l of p2Lasers) {
        if (l.style === 'seeker') {
          const age = t - l.born;
          if (age < 0 || age > l.dur + 60) continue;
          const prog = Math.min(1, age / l.dur);
          const inv = 1 - prog;
          const odx = gtp2.nx - l.x0, ody = gtp2.ny - l.y0;
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
          const alpha = Math.min(1, age / (l.dur * 0.12));
          const impactF = inFlight ? 0 : Math.max(0, 1 - (age - l.dur) / 55);
          const approachF = inFlight ? Math.max(0, (prog - 0.80) / 0.20) : 1;
          const headR = 5 + approachF * 7;
          ctx.save();
          ctx.globalAlpha = alpha;
          if (inFlight) {
            ctx.strokeStyle = 'rgba(255,180,20,0.45)'; ctx.lineWidth = 5;
            ctx.shadowColor = 'rgba(255,160,0,0.6)'; ctx.shadowBlur = 18;
            ctx.beginPath(); ctx.moveTo(trx, trY); ctx.lineTo(bx, by); ctx.stroke();
            ctx.strokeStyle = '#ffee66'; ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(255,220,60,0.9)'; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.moveTo(trx, trY); ctx.lineTo(bx, by); ctx.stroke();
          }
          ctx.globalAlpha = inFlight ? alpha : impactF;
          ctx.fillStyle = 'rgba(255,200,60,0.85)';
          ctx.shadowColor = 'rgba(255,180,0,0.9)'; ctx.shadowBlur = 22 + approachF * 24;
          ctx.beginPath(); ctx.arc(bx, by, headR, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,220,1)'; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(bx, by, inFlight ? 2.5 : 4, 0, Math.PI * 2); ctx.fill();
          if (!inFlight) {
            const ringR = 6 + (1 - impactF) * 26;
            ctx.strokeStyle = 'rgba(255,230,100,0.9)'; ctx.lineWidth = 1.5;
            ctx.shadowColor = 'rgba(255,200,40,0.8)'; ctx.shadowBlur = 12;
            ctx.globalAlpha = impactF * 0.85;
            ctx.beginPath(); ctx.arc(bx, by, ringR, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.restore();
        } else {
          const a = Math.max(0, 1 - (t - l.born) / 300);
          const sx = l.side === 2 ? gtp2.nx : l.side === 1 ? gtp2.rx : gtp2.lx;
          const sy = l.side === 2 ? gtp2.ny : gtp2.gy;
          const [lCol, lGlow] = l.tier >= 3
            ? ['#ffdd44', 'rgba(255,200,40,0.8)']
            : l.tier === 2
            ? ['#00ddff', 'rgba(0,200,255,0.8)']
            : ['#4fffaa', 'rgba(80,255,160,0.8)'];
          ctx.save();
          ctx.globalAlpha = a;
          ctx.strokeStyle = lCol; ctx.lineWidth = 2;
          ctx.shadowColor = lGlow; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(l.x1, l.y1); ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
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

    // Muzzle flash and gun checks - drawn before ship so hull renders on top
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

    // Ship config for current selection
    const _SCFG = _SHIP_CONFIGS[currentShip];
    const _shipBmp = _SCFG.bmp;
    const flareBase = cy + bmpH(_shipBmp) * PX / 2 - 5;
    const _shipHW = bmpW(_shipBmp) * PX / 2, _shipHH = bmpH(_shipBmp) * PX / 2;
    // Grow the clickable body with the size egg so the enlarged ship still takes clicks.
    const _hbHW = _shipHW * shipEggScale, _hbHH = _shipHH * shipEggScale;
    shipBodyHitbox = (_p1ShipVisible || twoPlayerMode === 'off') && warpState === 'none' ? { x: cx - _hbHW, y: cy - _hbHH, w: _hbHW * 2, h: _hbHH * 2 } : { x: 0, y: 0, w: 0, h: 0 };
    const ft = t * 0.005;
    if (!_p1ShipVisible && twoPlayerMode !== 'off') {
      const _ca = 0.25 + 0.20 * Math.sin(t * 0.0025);
      ctx.save(); ctx.globalAlpha = _ca;
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(65,165,200,1)';
      ctx.fillText('P1', W * 0.25, H * 0.44);
      ctx.fillText('CONNECTING', W * 0.25, H * 0.44 + 18);
      ctx.restore();
    } else {

    // Descent streak (landing) and launch streak (departing)
    if (carrierState !== 'none' && warpState === 'none') {
      if ((carrierState === 'arriving' || carrierState === 'present') && shipPowerState === 'down') {
        const _shipBi = CARRIER_SHIP_ORDER.indexOf(currentShip);
        const _dockY = carrierRestY + (_shipBi >= 0 ? CARRIER_BAY_DY[_shipBi] : 0);
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
      if (launchAt > 0 && t - launchAt < LAUNCH_BOOST_DUR) {
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

    // Apply the size egg around the whole ship rig (hull + engine flares) so they scale
    // together about the ship centre. Skipped during warp (which has its own scaling).
    const _eggOn = warpState === 'none' && (Math.abs(_eggSX - 1) > 0.001 || Math.abs(_eggSY - 1) > 0.001 || Math.abs(_eggRot) > 0.0001);
    if (_eggOn) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(_eggRot);
      ctx.scale(_eggSX, _eggSY);
      ctx.translate(-cx, -cy);
    }

    if (warpState !== 'none') {
      // ── Warp animation ────────────────────────────────────
      const wdur = warpState === 'out' ? WARP_OUT_DUR : WARP_IN_DUR;
      const wp = Math.max(0, Math.min(1, (t - warpAt) / wdur));
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
      const sa = 0.55 + sp * 0.40;
      const pdCol  = _SCFG.color.replace(/[\d.]+\)$/, `${sa.toFixed(3)})`);
      const pdGlow = sp > 0.35 ? _SCFG.glow : null;
      const _sr = _SCFG.flareSplitRow ?? bmpH(_shipBmp);
      drawBmp(ctx, _shipBmp, cx, cy, pdCol, pdGlow, PX, false, 0, _sr);
      ctx.save(); ctx.globalAlpha = Math.max(0, flicker * sp); for (const f of _SCFG.flares) drawEngineFlare(cx + f.xOff, flareBase + f.yOff, ft, f.size, (f.len ?? f.size), (f.taper ?? 0.6), (f.shape ?? 'arch'), (f.wobble ?? 1), (f.col ?? null)); ctx.restore();
      if (_SCFG.flareSplitRow != null) drawBmp(ctx, _shipBmp, cx, cy, pdCol, pdGlow, PX, false, _sr);
    } else if (shipPowerState === 'startup') {
      const sp = Math.min(1, (t - startupAt) / STARTUP_DUR);
      const burstBase = sp < 0.20 ? 2.5 * (1 - sp / 0.20) : 0;
      const flicker = sp > 0.20 && sp < 0.48
        ? Math.abs(Math.sin(t * 0.045)) * Math.abs(Math.sin(t * 0.011 + 1.3))
        : 1;
      const sa = 0.55 + sp * 0.40;
      const suCol  = _SCFG.color.replace(/[\d.]+\)$/, `${sa.toFixed(3)})`);
      const suGlow = sp > 0.35 ? _SCFG.glow : null;
      const _sr = _SCFG.flareSplitRow ?? bmpH(_shipBmp);
      drawBmp(ctx, _shipBmp, cx, cy, suCol, suGlow, PX, false, 0, _sr);
      ctx.save(); ctx.globalAlpha = sp < 0.20 ? sp / 0.20 : Math.min(1, flicker); for (const f of _SCFG.flares) { const fbW = 1 + burstBase * (f.burstWScale ?? (f.burstScale ?? 1)); const fbL = 1 + burstBase * (f.burstScale ?? 1); drawEngineFlare(cx + f.xOff, flareBase + f.yOff, ft, f.size * fbW, (f.len ?? f.size) * fbL, (f.taper ?? 0.6), (f.shape ?? 'arch'), (f.wobble ?? 1), (f.col ?? null)); } ctx.restore();
      if (_SCFG.flareSplitRow != null) drawBmp(ctx, _shipBmp, cx, cy, suCol, suGlow, PX, false, _sr);
    } else {
      const _launchBoost = (launchAt > 0 && t - launchAt < LAUNCH_BOOST_DUR)
        ? Math.pow(1 - (t - launchAt) / LAUNCH_BOOST_DUR, 0.6) : 0;
      const idleWScale      = (1 - idleBlend * 0.50);
      const idleEngineAlpha = Math.min(1, (1 - idleBlend * (0.45 - 0.12 * Math.abs(Math.sin(t * 0.0018)))) + _launchBoost * 0.4);
      if (_launchBoost > 0) {
        // Exhaust plume - wide downward blast cone below ship
        const _pl = _launchBoost * 95;
        const _pw = _launchBoost * 28;
        const _blastBase = flareBase + (_SCFG.launchBlastYOff ?? 0);
        const _srcHW = _SCFG.launchBlastSourceHW ?? _pw * 0.3;
        const pg = ctx.createLinearGradient(cx, _blastBase, cx, _blastBase + _pl);
        pg.addColorStop(0, `rgba(160,200,255,${(_launchBoost * 0.75).toFixed(2)})`);
        pg.addColorStop(0.25, `rgba(100,150,255,${(_launchBoost * 0.45).toFixed(2)})`);
        pg.addColorStop(1, 'rgba(60,100,220,0)');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.moveTo(cx - _srcHW, _blastBase);
        ctx.quadraticCurveTo(cx - _pw, _blastBase + _pl * 0.6, cx - _pw * 0.5, _blastBase + _pl);
        ctx.quadraticCurveTo(cx, _blastBase + _pl * 1.05, cx + _pw * 0.5, _blastBase + _pl);
        ctx.quadraticCurveTo(cx + _pw, _blastBase + _pl * 0.6, cx + _srcHW, _blastBase);
        ctx.closePath(); ctx.fill();
      }
      const _sr = _SCFG.flareSplitRow ?? bmpH(_shipBmp);
      drawBmp(ctx, _shipBmp, cx, cy, _SCFG.color, _SCFG.glow, PX, false, 0, _sr);
      ctx.save(); ctx.globalAlpha = idleEngineAlpha; for (const f of _SCFG.flares) { const fes = idleWScale * (1 + _launchBoost * 2.8 * (f.burstScale ?? 1)); drawEngineFlare(cx + f.xOff, flareBase + f.yOff, ft, f.size * idleWScale, (f.len ?? f.size) * fes, (f.taper ?? 0.6), (f.shape ?? 'arch'), (f.wobble ?? 1), (f.col ?? null)); } ctx.restore();
      if (_SCFG.flareSplitRow != null) drawBmp(ctx, _shipBmp, cx, cy, _SCFG.color, _SCFG.glow, PX, false, _sr);
    }

    if (_eggOn) ctx.restore();

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
        const _qFont = 10;
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
        const _qLineH = _qFont + 8;
        const _qBY = cy - _shipHH * shipEggScale - 14;
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
    } // end P1 ship visible

    // ── P2 ship + status (right half) ────────────────────────
    if (twoPlayerMode !== 'off') {
      const _p2cx = Math.round(p2ShipX);
      const _p2InCarrierNow = twoPlayerMode !== 'off'
        ? (p2BlockingEnabled === false || p2StartupAt > 0 || (p2LaunchAt > 0 && t - p2LaunchAt < CARRIER_LEAVE_DUR))
        : p2CarrierState !== 'none';
      const _p2cy = Math.round(p2ShipY + (_p2InCarrierNow ? 0 : 2.5 * Math.sin(t * 0.00055 + Math.PI)));
      const _p2cfg = _SHIP_CONFIGS[p2CurrentShip] || _SHIP_CONFIGS.protector;
      const _p2base = _p2cy + bmpH(_p2cfg.bmp) * PX / 2 - 5;
      const _p2HW = bmpW(_p2cfg.bmp) * PX / 2, _p2HH = bmpH(_p2cfg.bmp) * PX / 2;
      p2ShipBodyHitbox = (_p2ShipVisible && p2WarpState === 'none') ? { x: _p2cx - _p2HW, y: _p2cy - _p2HH, w: _p2HW * 2, h: _p2HH * 2 } : { x: 0, y: 0, w: 0, h: 0 };
      const _ripAge = _p2ShipRipInAt > 0 ? t - _p2ShipRipInAt : 99999;

      if (!_p2ShipVisible && !_p2FastDepart && twoPlayerMode === 'local') {
        // P2 connecting in local mode
        const _ca = 0.25 + 0.20 * Math.sin(t * 0.0025);
        ctx.save(); ctx.globalAlpha = _ca;
        ctx.font = '8px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(65,165,200,1)';
        ctx.fillText('P2', W * 0.75, H * 0.44);
        ctx.fillText('CONNECTING', W * 0.75, H * 0.44 + 18);
        ctx.restore();
      }

      if (p2ShipY > -250) {
        // Descent streak during rip-in
        if (_ripAge < 700) {
          const _rp = _ripAge / 700;
          for (let si = 1; si <= 5; si++) {
            ctx.save();
            ctx.globalAlpha = (1 - _rp) * (1 - si / 6) * 0.45;
            drawBmp(ctx, _p2cfg.bmp, _p2cx, _p2cy - si * 15 * (1 - _rp), _p2cfg.dimColor, null, PX);
            ctx.restore();
          }
        }

        if (p2WarpState !== 'none') {
          const _p2wdur = p2WarpState === 'out' ? WARP_OUT_DUR : WARP_IN_DUR;
          const _p2wp  = Math.max(0, Math.min(1, (t - p2WarpAt) / _p2wdur));
          ctx.save();
          ctx.beginPath(); ctx.rect(W / 2, 0, W / 2, H); ctx.clip();
          ctx.translate(_p2cx, _p2cy);
          if (p2WarpState === 'out') {
            const _w1 = Math.min(1, _p2wp / 0.45);
            const _w2 = Math.max(0, (_p2wp - 0.40) / 0.60);
            const _scX = Math.max(0.07, 1 - _w1 * 0.93);
            const _oY  = -_w2 * (H + 300);
            if (_p2wp < 0.35) {
              const fp = 1 - _p2wp / 0.35;
              const fr = 18 + _p2wp * 560;
              const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, fr);
              fg.addColorStop(0, `rgba(255,255,255,${fp.toFixed(2)})`);
              fg.addColorStop(0.12, `rgba(210,228,255,${(fp * 0.85).toFixed(2)})`);
              fg.addColorStop(0.4,  `rgba(195,208,240,${(fp * 0.35).toFixed(2)})`);
              fg.addColorStop(1,   'rgba(195,208,240,0)');
              ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, fr, 0, Math.PI * 2); ctx.fill();
            }
            if (_p2wp < 0.55) {
              const rp = _p2wp / 0.55;
              const rr = 10 + rp * 260;
              const ra = Math.max(0, 1 - rp);
              ctx.save();
              ctx.strokeStyle = `rgba(185,212,255,${(ra * 0.9).toFixed(2)})`;
              ctx.lineWidth = Math.max(0.5, 2.5 - rp * 2);
              ctx.shadowColor = 'rgba(160,200,255,0.9)'; ctx.shadowBlur = 10;
              ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
              ctx.restore();
            }
            if (_w1 > 0.25) {
              const tlen = 80 + _w1 * 340;
              const top  = _w1 * 0.88;
              const sg0 = ctx.createLinearGradient(0, _oY, 0, _oY + tlen);
              sg0.addColorStop(0, `rgba(195,208,240,${(top * 0.42).toFixed(2)})`); sg0.addColorStop(1, 'rgba(195,208,240,0)');
              ctx.fillStyle = sg0; ctx.fillRect(-16, _oY, 32, tlen);
              const sg1 = ctx.createLinearGradient(0, _oY, 0, _oY + tlen);
              sg1.addColorStop(0, `rgba(215,228,255,${(top * 0.68).toFixed(2)})`); sg1.addColorStop(1, 'rgba(215,225,248,0)');
              ctx.fillStyle = sg1; ctx.fillRect(-6, _oY, 12, tlen);
              const sg2 = ctx.createLinearGradient(0, _oY, 0, _oY + tlen);
              sg2.addColorStop(0, `rgba(245,248,255,${top.toFixed(2)})`); sg2.addColorStop(1, 'rgba(240,244,255,0)');
              ctx.fillStyle = sg2; ctx.fillRect(-2, _oY, 4, tlen);
            }
            ctx.save();
            ctx.translate(0, _oY); ctx.scale(_scX, 1 + _w1 * 7.5);
            const _wa = _w2 > 0.3 ? Math.max(0, 1 - (_w2 - 0.3) / 0.7) : 1;
            drawBmp(ctx, _p2cfg.bmp, 0, 0, _p2cfg.color.replace(/[\d.]+\)$/, `${(_wa * 0.72).toFixed(2)})`), _p2cfg.glow, PX);
            ctx.restore();
          } else {
            const _w1 = Math.min(1, _p2wp / 0.50);
            const _w2 = Math.max(0, (_p2wp - 0.40) / 0.55);
            if (_w1 < 1) {
              const streakY = (1 - _w1) * (H + 250);
              const tlen = 80 + _w1 * 80;
              const sg = ctx.createLinearGradient(0, streakY, 0, streakY + tlen);
              sg.addColorStop(0, `rgba(195,208,240,${(0.5 + _w1 * 0.4).toFixed(2)})`);
              sg.addColorStop(1, 'rgba(170,190,235,0)');
              ctx.fillStyle = sg; ctx.fillRect(-2, streakY, 4, tlen);
            }
            if (_w2 > 0) {
              const wa2 = (Math.min(1, _w2 * 1.4) * 0.72).toFixed(2);
              ctx.save();
              ctx.scale(Math.max(0.08, Math.min(1, _w2 / 0.55)), Math.max(1, 4 - _w2 * 4.5));
              drawBmp(ctx, _p2cfg.bmp, 0, 0, _p2cfg.color.replace(/[\d.]+\)$/, `${wa2})`), _p2cfg.glow, PX);
              ctx.restore();
            }
          }
          ctx.restore();
        } else {
          const _p2powered = p2BlockingEnabled !== false;
          const _p2RipAlpha = (_ripAge < 400 ? Math.min(1, _ripAge / 180) : 1) * 0.72;
          const _p2LaunchBoost = (p2LaunchAt > 0 && t - p2LaunchAt < LAUNCH_BOOST_DUR)
            ? Math.pow(1 - (t - p2LaunchAt) / LAUNCH_BOOST_DUR, 0.6) : 0;
          const _p2IdleWS = 1 - p2IdleBlend * 0.50;
          const _p2IdleEA = Math.min(1, (1 - p2IdleBlend * (0.45 - 0.12 * Math.abs(Math.sin(t * 0.0018 + Math.PI)))) + _p2LaunchBoost * 0.4);
          const _p2sr = _p2cfg.flareSplitRow ?? bmpH(_p2cfg.bmp);
          if (p2StartupAt > 0) {
            const _p2sp = Math.min(1, (t - p2StartupAt) / STARTUP_DUR);
            const _p2burstBase = _p2sp < 0.20 ? 2.5 * (1 - _p2sp / 0.20) : 0;
            const _p2flicker = (_p2sp > 0.20 && _p2sp < 0.48) ? Math.abs(Math.sin(t * 0.045)) * Math.abs(Math.sin(t * 0.011 + 1.3)) : 1;
            const _p2sa = 0.55 + _p2sp * 0.40;
            const _p2suCol = _p2cfg.color.replace(/[\d.]+\)$/, `${_p2sa.toFixed(3)})`);
            const _p2suGlow = _p2sp > 0.35 ? _p2cfg.glow : null;
            ctx.save(); ctx.globalAlpha = _p2RipAlpha;
            drawBmp(ctx, _p2cfg.bmp, _p2cx, _p2cy, _p2suCol, _p2suGlow, PX, false, 0, _p2sr);
            ctx.restore();
            ctx.save(); ctx.globalAlpha = _p2sp < 0.20 ? _p2RipAlpha * _p2sp / 0.20 : _p2RipAlpha * Math.min(1, _p2flicker);
            for (const f of _p2cfg.flares) {
              const _fbW = 1 + _p2burstBase * (f.burstWScale ?? (f.burstScale ?? 1));
              const _fbL = 1 + _p2burstBase * (f.burstScale ?? 1);
              drawEngineFlare(_p2cx + f.xOff, _p2base + f.yOff, t * 0.005, f.size * _fbW, (f.len ?? f.size) * _fbL, (f.taper ?? 0.6), (f.shape ?? 'arch'), (f.wobble ?? 1), (f.col ?? null));
            }
            ctx.restore();
            if (_p2cfg.flareSplitRow != null) {
              ctx.save(); ctx.globalAlpha = _p2RipAlpha;
              drawBmp(ctx, _p2cfg.bmp, _p2cx, _p2cy, _p2suCol, _p2suGlow, PX, false, _p2sr);
              ctx.restore();
            }
          } else {
            if (_p2powered && _p2LaunchBoost > 0) {
              const _p2pl = _p2LaunchBoost * 95;
              const _p2pw = _p2LaunchBoost * 28;
              const _p2blastBase = _p2base + (_p2cfg.launchBlastYOff ?? 0);
              const _p2srcHW = _p2cfg.launchBlastSourceHW ?? _p2pw * 0.3;
              const _p2pg = ctx.createLinearGradient(_p2cx, _p2blastBase, _p2cx, _p2blastBase + _p2pl);
              _p2pg.addColorStop(0, `rgba(160,200,255,${(_p2LaunchBoost * 0.75).toFixed(2)})`);
              _p2pg.addColorStop(0.25, `rgba(100,150,255,${(_p2LaunchBoost * 0.45).toFixed(2)})`);
              _p2pg.addColorStop(1, 'rgba(60,100,220,0)');
              ctx.save(); ctx.globalAlpha = _p2RipAlpha; ctx.fillStyle = _p2pg;
              ctx.beginPath();
              ctx.moveTo(_p2cx - _p2srcHW, _p2blastBase);
              ctx.quadraticCurveTo(_p2cx - _p2pw, _p2blastBase + _p2pl * 0.6, _p2cx - _p2pw * 0.5, _p2blastBase + _p2pl);
              ctx.quadraticCurveTo(_p2cx, _p2blastBase + _p2pl * 1.05, _p2cx + _p2pw * 0.5, _p2blastBase + _p2pl);
              ctx.quadraticCurveTo(_p2cx + _p2pw, _p2blastBase + _p2pl * 0.6, _p2cx + _p2srcHW, _p2blastBase);
              ctx.closePath(); ctx.fill(); ctx.restore();
            }
            ctx.save(); ctx.globalAlpha = _p2RipAlpha;
            drawBmp(ctx, _p2cfg.bmp, _p2cx, _p2cy, _p2powered ? _p2cfg.color : _p2cfg.dimColor, _p2powered ? _p2cfg.glow : null, PX, false, 0, _p2sr);
            ctx.restore();
            if (_p2powered) {
              ctx.save(); ctx.globalAlpha = _p2RipAlpha * _p2IdleEA;
              for (const f of _p2cfg.flares) {
                const _p2fes = _p2IdleWS * (1 + _p2LaunchBoost * 2.8 * (f.burstScale ?? 1));
                drawEngineFlare(_p2cx + f.xOff, _p2base + f.yOff, t * 0.005, f.size * _p2IdleWS, (f.len ?? f.size) * _p2fes, (f.taper ?? 0.6), (f.shape ?? 'arch'), (f.wobble ?? 1), (f.col ?? null));
              }
              ctx.restore();
              if (_p2cfg.flareSplitRow != null) {
                ctx.save(); ctx.globalAlpha = _p2RipAlpha;
                drawBmp(ctx, _p2cfg.bmp, _p2cx, _p2cy, _p2cfg.color, _p2cfg.glow, PX, false, _p2sr);
                ctx.restore();
              }
            }
          }
        }

        // P2 gun check rings on launch
        if (p2GunCheckFiredAt[0] > 0 || p2GunCheckFiredAt[1] > 0) {
          const _gctp2 = shipGunTipPos(p2CurrentShip, _p2cx, _p2cy);
          for (let gi = 0; gi < 2; gi++) {
            const at = p2GunCheckFiredAt[gi]; if (at <= 0) continue;
            const age = t - at; if (age < 0 || age > GUN_CHECK_DUR) continue;
            const a = Math.max(0, 1 - age / GUN_CHECK_DUR);
            const gx = gi === 0 ? _gctp2.lx : _gctp2.rx;
            const r = 4 + 8 * (1 - a);
            ctx.save();
            ctx.globalAlpha = a * 0.9;
            ctx.strokeStyle = 'rgba(100,255,175,1)'; ctx.lineWidth = 1.5;
            ctx.shadowColor = 'rgba(80,255,160,0.8)'; ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.arc(gx, _gctp2.gy, r, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = 'rgba(180,255,220,0.95)'; ctx.shadowBlur = 6;
            ctx.beginPath(); ctx.arc(gx, _gctp2.gy, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
        }

        // "P2 ONLINE" label fades in after arrival, persists briefly
        if (_p2ShipRipInAt > 0 && _ripAge > 350 && _ripAge < 2200) {
          const _fa = _ripAge < 500 ? (_ripAge - 350) / 150 : Math.max(0, 1 - (_ripAge - 1800) / 400);
          ctx.save(); ctx.globalAlpha = _fa * 0.90;
          ctx.font = '8px "Press Start 2P", monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(50,215,120,1)';
          ctx.shadowColor = 'rgba(50,215,120,0.55)'; ctx.shadowBlur = 10;
          ctx.fillText('P2 ONLINE', _p2cx, _p2cy - bmpH(_p2cfg.bmp) * PX / 2 - 16);
          ctx.shadowBlur = 0; ctx.restore();
        }
      }

      // Arrival chain ring
      if (_p2ShipRipInAt > 0 && _ripAge > 380 && _ripAge < 780) {
        const _rp = (_ripAge - 380) / 400;
        ctx.save(); ctx.globalAlpha = Math.max(0, (1 - _rp) * 0.75);
        ctx.strokeStyle = 'rgba(50,215,120,1)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(50,215,120,0.7)'; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(_p2cx, _p2cy, 12 + _rp * 70, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0; ctx.restore();
      }

      // P2 ship easter-egg speech bubble
      if (p2ShipQuote) {
        const _q2Age = t - p2ShipQuote.shownAt;
        const _q2Total = 3500, _q2FadeIn = 100, _q2FadeStart = 3000;
        if (_q2Age > _q2Total) {
          p2ShipQuote = null;
          p2ShipQuoteCooldown = performance.now() + 800;
        } else {
          const _q2A = _q2Age < _q2FadeIn ? _q2Age / _q2FadeIn : _q2Age > _q2FadeStart ? 1 - (_q2Age - _q2FadeStart) / (_q2Total - _q2FadeStart) : 1;
          ctx.save();
          ctx.globalAlpha = _q2A;
          const _q2Font = 10;
          ctx.font = `${_q2Font}px "Press Start 2P", monospace`;
          const _q2MaxW = Math.min(200, W / 2 - 20);
          const _q2Words = p2ShipQuote.text.split(' ');
          const _q2Lines = [];
          let _q2Cur = '';
          for (const _q2W of _q2Words) {
            const _q2Test = _q2Cur ? _q2Cur + ' ' + _q2W : _q2W;
            if (ctx.measureText(_q2Test).width > _q2MaxW && _q2Cur) { _q2Lines.push(_q2Cur); _q2Cur = _q2W; }
            else _q2Cur = _q2Test;
          }
          if (_q2Cur) _q2Lines.push(_q2Cur);
          const _q2LineH = _q2Font + 8;
          const _q2BY = _p2cy - _p2HH - 14;
          ctx.fillStyle = 'rgba(215,225,248,0.95)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 6;
          for (let _q2i = 0; _q2i < _q2Lines.length; _q2i++) {
            ctx.fillText(_q2Lines[_q2i], _p2cx, _q2BY - (_q2Lines.length - 1 - _q2i) * _q2LineH);
          }
          ctx.restore();
        }
      }

      // Full-width 2P activation banner (first 2.8s)
      if (_2pBannerAt > 0) {
        const _bAge = t - _2pBannerAt;
        if (_bAge < 2800) {
          const _ba = _bAge < 300 ? _bAge / 300 : _bAge > 2200 ? Math.max(0, 1 - (_bAge - 2200) / 600) : 1;
          ctx.save(); ctx.globalAlpha = _ba * 0.92;
          ctx.font = '10px "Press Start 2P", monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(50,215,120,1)';
          ctx.shadowColor = 'rgba(50,215,120,0.55)'; ctx.shadowBlur = 14;
          ctx.fillText('2-PLAYER MODE', W / 2, H * 0.28);
          ctx.shadowBlur = 0; ctx.restore();
        }
      }
    }

    // ── HUD Strip ────────────────────────────────────────────
    ctx.save();
    ctx.translate(shakeSx, shakeSy);
    ctx.globalAlpha = 0.62;

    // Responsive layout: panel widths scale with viewport, STATS gets the remainder
    let _animSH = hudSH;
    if (_hudSlideAt > 0) {
      const _sp = Math.min(1, (t - _hudSlideAt) / HUD_SLIDE_DUR);
      _animSH = _hudSlideFrom + (_hudSlideTo - _hudSlideFrom) * (1 - Math.pow(1 - _sp, 3));
      if (_sp >= 1) _hudSlideAt = 0;
    }
    const SH = _animSH;
    const SY = H - SH - safeBottom;

    // ── HUD auto-hide ────────────────────────────────────────
    // Slide the whole strip below the viewport once idle; a mouse hovering the
    // bottom band (or any menu open) keeps it alive. Touch/pen have no hover, so
    // they rely on the idle timer, re-armed by taps in the reveal zone (see the
    // window pointer listeners). Sliding as a unit avoids alpha-compositing cost.
    let _hudTarget = 0;
    if (hudAutoHide) {
      if (_hudRevealAt === 0) _hudRevealAt = t;   // grace period on first frame / enable
      const _zoneTop = H - hudSH - safeBottom - 50;
      const _hover = _lastPtrType === 'mouse' && mouseX >= 0 && mouseY >= _zoneTop;
      const _menusOpen = settingsMenuOpen || shieldMenuOpen || shipMenuOpen || p2ShieldMenuOpen || p2ShipMenuOpen;
      // A gravity/blocklist pull in progress keeps the HUD up so the UPDATING
      // status stays visible until it lands.
      const _gravityBusy = gravityState === 'updating' || p2GravityState === 'updating';
      if (_hover || _menusOpen || _gravityBusy) _hudRevealAt = t;
      if (t - _hudRevealAt > AUTOHIDE_MS) _hudTarget = 1;
    }
    const _hdt = _hudPrevT ? Math.min(t - _hudPrevT, 80) : 16;
    _hudPrevT = t;
    _hudHideT += (_hudTarget - _hudHideT) * Math.min(1, _hdt / HUD_FADE_DUR);
    if (_hudHideT < 0.001) _hudHideT = 0;
    else if (_hudHideT > 0.999) _hudHideT = 1;
    _hudVisible = _hudHideT < 0.5;
    const _hudSlideY = _hudHideT * (hudSH + safeBottom + 8);
    if (_hudHideT > 0) ctx.translate(0, _hudSlideY);

    // Lock the DOM burger button to the canvas HUD: same warp shake, same auto-hide
    // slide. (The button lives above the canvas, so it can't inherit the ctx transform.)
    if (settingsBtnEl) {
      settingsBtnEl.style.transform = `translate(${shakeSx.toFixed(2)}px, ${(shakeSy + _hudSlideY).toFixed(2)}px)`;
      if (hudAutoHide && !_hudVisible && !settingsMenuOpen) settingsBtnEl.style.pointerEvents = 'none';
    }

    // Keep the CRT's HUD-easing in step with the auto-hide slide: the eased band
    // shrinks as the strip slides off (--hud-h tracks the strip's on-screen top
    // edge) and its reduction fades to full (--crt-floor -> 1), so the filter fills
    // straight back in over the space the HUD vacated. Change-detected so the CSS
    // var only rewrites during the slide, not every frame.
    const _hudBandH = Math.max(0, Math.round(hudSH + safeBottom - _hudSlideY));
    if (_hudBandH !== _lastHudBandCss) {
      _lastHudBandCss = _hudBandH;
      document.documentElement.style.setProperty('--hud-h', _hudBandH + 'px');
    }
    const _crtFloor = (0.58 + 0.42 * _hudHideT).toFixed(3);
    if (_crtFloor !== _lastCrtFloorCss) {
      _lastCrtFloorCss = _crtFloor;
      document.documentElement.style.setProperty('--crt-floor', _crtFloor);
    }

    const INT_W  = Math.min(240, Math.max(150, Math.round(W * 0.30)));
    const OPT_W  = W < 480 ? 0   : Math.min(140, Math.max(95,  Math.round(W * 0.16)));
    const TDB_W  = Math.min(250, Math.max(140, Math.round(W * 0.28)));
    const TDB_X  = W - TDB_W - OPT_W;
    const INTEL_X = INT_W, OPT_X = W - OPT_W;
    const INTEL_W = Math.max(0, TDB_X - INT_W);

    // Scaled fonts
    const _fs = W < 480 ? 0.75 : W < 660 ? 0.87 : 1;
    const _fVal   = Math.max(10, Math.round(16 * _fs));
    const _fSub   = Math.max(8,  Math.round(10 * _fs));
    const _fLabel = _fs < 1 ? 8 : 10;
    const _fShip  = Math.max(8,  Math.round(12 * _fs));

    // In 2P mode the strip is two rows; _rowH is the height of each row
    const _isP2 = twoPlayerMode !== 'off';
    const _rowH = _isP2 ? (W < 480 ? 66 : W < 660 ? 76 : 86) : SH;
    const _p2RowSY = SY + _rowH + 1;

    // Scaled Y anchors (proportional to row height)
    // _yLabel uses the 1P row height so the top-label distance from the HUD edge is consistent in both modes
    const _1pSH = W < 480 ? 84 : W < 660 ? 94 : 108;
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
    if (_isP2 && blockingEnabled !== null && shipPowerState !== 'powerdown' && shipPowerState !== 'startup') {
      ctx.font = `${_fSub + 2}px "Press Start 2P", monospace`;
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(100,155,220,0.50)';
      ctx.fillText('P1', 26, _yVal);
    }
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
      const _hbPad = 10;
      const _hbTop = _yVal - Math.round(_fVal * 0.95);
      const _hbH = _hasTimer ? Math.round(_fVal * 0.95 + _fSub * 2.2) : Math.round(_fVal * 1.35);
      shieldHitbox = { x: INT_W / 2 - _shieldTW / 2 - _hbPad, y: _hbTop, w: _shieldTW + _hbPad * 2, h: _hbH };
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
        const hov = mouseX >= hb.x && mouseX < hb.x + hb.w && mouseY >= hb.y && mouseY < hb.y + hb.h;
        if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
        ctx.textAlign = 'left';
        ctx.fillStyle = hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
        ctx.fillText(opt.label, menuX + 14, iy + 18);
        const timer = opt.timerFn ? opt.timerFn() : opt.timer;
        return { ...opt, timer, hitbox: hb };
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
        { key: 'domain',     label: 'DOMAIN',     state: showDomain, divAfter: true },
        { key: 'crt',        label: 'CRT FILTER',  state: crtEnabled },
        { key: 'autohide',   label: 'AUTO-HIDE',   state: hudAutoHide },
      ];
      const smw = 186, smItemH = 28, smPad = 10, smDivH = 10, smPhRowH = 34;
      const _has2P = window.TWO_PLAYER_ENABLED !== false;
      let _togH = 0;
      for (const it of _sitems) { _togH += smItemH; if (it.divAfter) _togH += smDivH; }
      // Background section: a single BACKGROUND row; mode + sky presets live in flyouts off it.
      const _bgRows = 1;
      const smh = smPad + _togH + _bgRows * smItemH + (_has2P ? smDivH + smItemH : 0) + smDivH + smPhRowH + (twoPlayerMode === 'local' && window.P2_DASHBOARD ? smPhRowH : 0) + smPad;
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
      // ── Background row: label + '>' that opens the mode flyout; selection lives there. ──
      let _bgModeRowY = siy;
      {
        const _bgHb = { x: smX, y: siy, w: smw, h: smItemH };
        const _bgHov = (mouseX >= _bgHb.x && mouseX <= _bgHb.x + _bgHb.w && mouseY >= _bgHb.y && mouseY <= _bgHb.y + _bgHb.h) || bgMenuOpen;
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
        settingsMenuItems.push({ key: 'bg-mode', hitbox: _bgHb });
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
          const tpHov = mouseX >= tpHb.x && mouseX <= tpHb.x + tpHb.w && mouseY >= tpHb.y && mouseY <= tpHb.y + tpHb.h;
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
          settingsMenuItems.push({ key: '2p-mode', hitbox: tpHb });
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
        const phHov = mouseX >= phHb.x && mouseX <= phHb.x + phHb.w && mouseY >= phHb.y && mouseY <= phHb.y + phHb.h;
        if (phHov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(phHb.x, phHb.y, phHb.w, phHb.h); }
        // Provider icon (Pi-hole, AdGuard, or Technitium)
        const _iconAspect = PROVIDER_ICON_ASPECT;
        const iconH = smPhRowH - 8, iconW = Math.round(iconH * _iconAspect);
        const iconX = smX + 12, iconY = siy + (smPhRowH - iconH) / 2;
        if (_phIcon.complete && _phIcon.naturalWidth > 0) {
          ctx.save();
          ctx.globalAlpha = phHov ? 0.88 : 0.45;
          ctx.drawImage(_phIcon, iconX, iconY, iconW, iconH);
          ctx.restore();
        }
        // Label (shrink to fit so long names don't collide with the link arrow at smX+smw-14)
        ctx.textAlign = 'left';
        const _phLbl = _isP2 ? PROVIDER_NAME + ' 1' : PROVIDER_NAME;
        const _phLblX = iconX + iconW + 12;
        _fitLabelFont(_phLbl, (smX + smw - 19) - _phLblX - 4, _fSub);
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
        settingsMenuItems.push({ key: 'pihole-link', hitbox: phHb });
        siy += smPhRowH;
        // PI-HOLE 2 admin link (local 2P mode only)
        if (twoPlayerMode === 'local' && window.P2_DASHBOARD) {
          const ph2Hb = { x: smX, y: siy, w: smw, h: smPhRowH };
          const ph2Hov = !phHov && mouseX >= ph2Hb.x && mouseX <= ph2Hb.x + ph2Hb.w && mouseY >= ph2Hb.y && mouseY <= ph2Hb.y + ph2Hb.h;
          ctx.strokeStyle = 'rgba(140,160,175,0.10)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(smX + 30, siy + 0.5); ctx.lineTo(smX + smw - 10, siy + 0.5); ctx.stroke();
          if (ph2Hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(ph2Hb.x, ph2Hb.y, ph2Hb.w, ph2Hb.h); }
          const _icon2H = smPhRowH - 8, _icon2W = Math.round(_icon2H * PROVIDER_ICON_ASPECT);
          const _icon2X = smX + 12, _icon2Y = siy + (smPhRowH - _icon2H) / 2;
          if (_phIcon.complete && _phIcon.naturalWidth > 0) {
            ctx.save(); ctx.globalAlpha = ph2Hov ? 0.88 : 0.45;
            ctx.drawImage(_phIcon, _icon2X, _icon2Y, _icon2W, _icon2H);
            ctx.restore();
          }
          ctx.textAlign = 'left';
          const _ph2Lbl = PROVIDER_NAME + ' 2';
          const _ph2LblX = _icon2X + _icon2W + 12;
          _fitLabelFont(_ph2Lbl, (smX + smw - 19) - _ph2LblX - 4, _fSub);
          ctx.fillStyle = ph2Hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.55)';
          ctx.fillText(_ph2Lbl, _ph2LblX, siy + smPhRowH / 2 + 6);
          const _a2x = smX + smw - 14, _a2y = siy + smPhRowH / 2;
          ctx.strokeStyle = ph2Hov ? 'rgba(215,225,248,0.70)' : 'rgba(140,160,175,0.32)';
          ctx.lineWidth = 1.5; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(_a2x - 5, _a2y + 4); ctx.lineTo(_a2x + 4, _a2y - 4);
          ctx.moveTo(_a2x - 1, _a2y - 4); ctx.lineTo(_a2x + 4, _a2y - 4); ctx.lineTo(_a2x + 4, _a2y + 1);
          ctx.stroke();
          settingsMenuItems.push({ key: 'pihole-link-2', hitbox: ph2Hb });
        }
      }
      // ── Background flyouts: mode list, with a sky-preset list cascading off STARS ──
      if (bgMenuOpen) {
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
            const hov = !disabled && mouseX >= hb.x && mouseX < hb.x + hb.w && mouseY >= hb.y && mouseY < hb.y + hb.h;
            const active = opt.key === activeKey;
            if (hov || (opt.arrow && bgSkyOpen)) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
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
              ctx.strokeStyle = hov || bgSkyOpen ? 'rgba(215,225,248,0.7)' : 'rgba(140,160,175,0.4)';
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
        const _modeOpts = BG_MODE_ORDER.map(k => ({ key: k, label: BG_MODE_LABELS[k], arrow: k === 'starfield', disabled: k === 'image' && !bgImageAvailable }));
        const _modeFw = _flyoutW(_modeOpts);
        let _mfx = smX + smw + 6;
        if (_mfx + _modeFw > W - 4) _mfx = Math.max(4, smX - _modeFw - 6);
        const _modeFh = _modeOpts.length * _fItemH + _fPad * 2;
        // Line the flyouts' first row highlight up with the BACKGROUND row highlight: the panel
        // top sits _fPad above the row so its first item row lands exactly on it.
        const _mfy = Math.max(6, Math.min(_bgModeRowY - _fPad, SY - _modeFh - 6));
        const _m = _drawFlyout(_mfx, _mfy, _modeFw, _modeOpts, bgMode);
        bgModeItems = _m.items; bgModeBox = _m.box;
        // Sky cascade off the STARFIELD row (index 0), when open and starfield is active.
        if (bgSkyOpen && bgMode === 'starfield') {
          const _skyOpts = SKY_PRESET_ORDER.map(k => ({ key: k, label: SKY_PRESET_LABELS[k] }));
          const _skyFw = _flyoutW(_skyOpts);   // wide enough for "SUMMER TRIANGLE" / "SOUTHERN CROSS"
          let _sfx = _mfx + _modeFw + 6;
          if (_sfx + _skyFw > W - 4) _sfx = Math.max(4, _mfx - _skyFw - 6);
          const _skyFh = _skyOpts.length * _fItemH + _fPad * 2;
          const _sfy = Math.max(6, Math.min(_mfy, SY - _skyFh - 6));   // top-align with the mode flyout
          const _s = _drawFlyout(_sfx, _sfy, _skyFw, _skyOpts, bgPreset);
          bgSkyItems = _s.items; bgSkyBox = _s.box;
        } else {
          bgSkyItems = []; bgSkyBox = null;
        }
      } else {
        bgModeItems = []; bgModeBox = null;
        bgSkyItems = []; bgSkyBox = null;
      }
    } else {
      settingsMenuItems = [];
      settingsMenuPopupBox = null;
      bgModeItems = []; bgModeBox = null;
      bgSkyItems = []; bgSkyBox = null;
    }

    // ── INTEL ──────────────────────────────────────────────
    // Column thresholds scale with _fSub so "intercept" (9 chars) always fits its cell.
    // 2-col: need cell ≥ ~9 * _fSub * 0.75 + 8px padding  → 15 * _fSub per cell × 2
    // 4-col: same logic × 4
    if (INTEL_W >= 50) {
      const _i2Min = 15 * _fSub, _i4Min = 33 * _fSub;
      const hsBlocked = hudStats.blocked;
      // Technitium mirrors its dashboard's "No Error" card; others show allowed (total - blocked).
      const _isTech = PROVIDER === 'technitium';
      const hsAllowed = _isTech ? hudStats.no_error
        : (hudStats.queries != null && hudStats.blocked != null ? hudStats.queries - hudStats.blocked : null);
      const _allowedLabel = _isTech ? 'no error' : 'allowed';
      const hsTotal = hudStats.queries;
      const pct = hudStats.percent;
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
    _modLabel(PROVIDER_TOGGLE_LABEL, TDB_X + TDB_W / 2, 'center');
    let sigsStr, sigsColor = 'rgba(95,200,230,0.82)';
    if (gravityState === 'updating') {
      sigsStr = 'UPDATING';
      sigsColor = `rgba(255,190,50,${(0.65 + 0.35 * Math.sin(t * 0.006)).toFixed(2)})`;
    } else {
      sigsStr = _fmtGravity(hudGravity);
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
    ctx.font = `${_fLabel}px "Press Start 2P", monospace`;
    ctx.fillStyle = 'rgba(70,130,165,0.45)';
    ctx.fillText('known threats', TDB_X + TDB_W / 2, _ySubLabel);
    // Update arrow - left side of section
    const _aW = bmpW(ARROW_DOWN_BMP) * ARROW_PX;
    const _aX = TDB_X + Math.round(30 * _fs), _aY = SY + Math.round(_rowH * 0.48);
    let arrowCol = arrowHovered ? 'rgba(255,190,50,0.95)' : 'rgba(95,200,230,0.55)';
    let arrowGlw = arrowHovered ? 'rgba(255,190,50,0.50)' : null;
    if (gravityState === 'updating') {
      const p = (0.65 + 0.35 * Math.sin(t * 0.008)).toFixed(2);
      arrowCol = `rgba(255,190,50,${p})`; arrowGlw = 'rgba(255,190,50,0.35)';
      drawBmp(ctx, ARROW_DOWN_BMP, _aX, _aY + Math.round(Math.max(0, Math.sin(t * 0.005)) * 3), arrowCol, arrowGlw, ARROW_PX);
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
    const _shipLabels = { protector: 'PROTECTOR', falcon: 'FALCON', swordfish: 'SWORDFISH', enterprise: 'ENTERPRISE', serenity: 'SERENITY', normandy: 'NORMANDY', pes: 'PES', inbound: 'MISSINGNO.' };
    if (OPT_W > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(OPT_X, SY, OPT_W, _rowH + _lbExtra); ctx.clip();
      _modLabel('SHIP', OPT_X + OPT_W / 2, 'center');
      ctx.textAlign = 'center';
      ctx.font = `${_fShip}px "Press Start 2P", monospace`;
      ctx.fillStyle = shipMenuHovered && _canSelectShip ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
      ctx.fillText(_shipLabels[currentShip], OPT_X + OPT_W / 2, _yVal);
      const _shipTW = ctx.measureText(_shipLabels[currentShip]).width;
      ctx.font = `${_fLabel}px "Press Start 2P", monospace`;
      ctx.fillStyle = _canSelectShip ? 'rgba(175,200,238,0.32)' : 'rgba(80,80,80,0.28)';
      ctx.fillText(_canSelectShip ? 'SELECT' : '—', OPT_X + OPT_W / 2, _ySubLabel);
      {
        const _hbPad = 12;
        const _hbTop = _yVal - Math.round(_fShip * 1.05);
        const _hbH = Math.round(_fShip * 1.55);
        shipMenuHitbox = { x: OPT_X + OPT_W / 2 - _shipTW / 2 - _hbPad, y: _hbTop, w: _shipTW + _hbPad * 2, h: _hbH };
      }
      ctx.restore();
    } else {
      shipMenuHitbox = { x: 0, y: 0, w: 0, h: 0 };
    }

    // Ship selector popup - opens upward from OPTIONS
    // Layout: 2×4 grid on wide screens, 4×2 grid on compact screens
    if (shipMenuOpen && _canSelectShip && OPT_W > 0) {
      const _ships = ['enterprise', 'falcon', 'normandy', 'pes', 'protector', 'serenity', 'swordfish', 'inbound'];
      const _sBmps  = { enterprise: ENTERPRISE_BMP, falcon: FALCON_BMP, normandy: NORMANDY_BMP, pes: PES_BMP,
                        protector: PROTECTOR_BMP, serenity: SERENITY_BMP, swordfish: SWORDFISH_BMP, inbound: INBOUND_BMP };
      const _sCols  = { enterprise: 'rgba(195,208,240,0.85)', falcon: 'rgba(195,208,240,0.85)', normandy: 'rgba(195,208,240,0.85)', pes: 'rgba(89,223,139,0.85)',
                        protector: 'rgba(195,208,240,0.85)', serenity: 'rgba(195,208,240,0.85)', swordfish: 'rgba(207,50,33,0.85)', inbound: 'rgba(150,155,165,0.85)' };
      const _sGlows = { enterprise: 'rgba(170,190,235,0.32)', falcon: 'rgba(170,190,235,0.32)', normandy: 'rgba(170,190,235,0.32)', pes: 'rgba(89,223,139,0.32)',
                        protector: 'rgba(170,190,235,0.32)', serenity: 'rgba(170,190,235,0.32)', swordfish: 'rgba(203,38,20,0.32)', inbound: null };
      const _compact = W < 660;
      const _cols = _compact ? 2 : 4;
      const _rows = _compact ? 4 : 2;
      const _slotW = _compact ? 85 : 90;
      const _slotH = _compact ? 70 : 82;
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
        const _isLocked = s === 'inbound';
        const _isTaken = _isP2 && !_isActive && s === p2CurrentShip;
        const hb = { x: _sX, y: _sY, w: _slotW, h: _slotH };
        const _shipCY = _sY + _slotH / 2 - 8;
        const _labelY = _sY + _slotH - 11;
        const hov = !_anyHov && !_isActive && !_isLocked && !_isTaken && mouseX >= hb.x && mouseX < hb.x + hb.w && mouseY >= hb.y && mouseY < hb.y + hb.h;
        if (hov) _anyHov = true;
        if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
        const _glitching = _isLocked && missingnoGlitchAt > 0 && (t - missingnoGlitchAt) < 1400;
        ctx.save();
        ctx.globalAlpha = _isLocked || _isTaken ? 0.35 : (_isActive ? 0.28 : (hov ? 1.0 : 0.70));
        if (_glitching) {
          // Draw only existing 1-pixels, each randomly toggled off using a per-pixel sin hash
          const _gAge = t - missingnoGlitchAt;
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
        const _labelVisible = !_glitching || Math.floor((t - missingnoGlitchAt) / 400) % 2 === 1;
        if (_labelVisible) {
          ctx.fillStyle = (_isLocked || _isTaken) ? 'rgba(130,135,145,0.55)' : _isActive ? 'rgba(80,80,80,0.50)' : hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
          ctx.fillText(_isActive ? 'ACTIVE' : _isTaken ? 'P2' : _shipLabels[s], _sCX, _labelY);
        }
        return { ship: s, hitbox: hb, active: _isActive, locked: _isLocked || _isTaken, taken: _isTaken };
      });
    } else {
      shipMenuItems = [];
      shipMenuPopupBox = null;
    }

    // ── P2 HUD ROW ─────────────────────────────────────────────────────
    if (_isP2) {
      const _fmtP2 = n => n == null ? '—' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e4 ? (n/1e3).toFixed(2)+'K' : String(n);
      const _canSelectP2Ship = p2BlockingEnabled === true && p2WarpState === 'none' && _p2ShipVisible;

      // ── P2 INTERCEPT ───────────────────────────────────────
      ctx.save();
      ctx.beginPath(); ctx.rect(0, _p2RowSY, INT_W, _rowH); ctx.clip();
      const _p2LabelVisible = p2BlockingEnabled !== null && p2StartupAt === 0 && !(p2BlockingEnabled === false && p2PowerdownAt > 0 && t - p2PowerdownAt < POWERDOWN_DUR);
      if (_p2LabelVisible) {
        ctx.font = `${_fSub + 2}px "Press Start 2P", monospace`;
        ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(100,155,220,0.50)';
        ctx.fillText('P2', 26, _yVal2);
      }
      let _p2ShieldStr, _p2ShieldColor, _p2ShieldGlow = null;
      if (p2BlockingEnabled === null) {
        _p2ShieldStr = 'STANDBY'; _p2ShieldColor = 'rgba(150,150,150,0.35)';
      } else if (p2BlockingEnabled === false && p2PowerdownAt > 0 && t - p2PowerdownAt < POWERDOWN_DUR) {
        const _p2sp = Math.max(0, 1 - (t - p2PowerdownAt) / POWERDOWN_DUR);
        const _p2pf = 0.5 + 0.5 * Math.abs(Math.sin(t * 0.012));
        _p2ShieldStr = 'POWERING DOWN'; _p2ShieldColor = `rgba(255,160,50,${(0.45 + 0.4 * _p2sp * _p2pf).toFixed(2)})`;
      } else if (p2BlockingEnabled === false) {
        _p2ShieldStr = 'OFFLINE'; _p2ShieldColor = 'rgba(255,80,60,0.90)'; _p2ShieldGlow = 'rgba(255,80,60,0.35)';
      } else if (p2StartupAt > 0) {
        const _p2sp = (t - p2StartupAt) / STARTUP_DUR;
        if (_p2sp > 0.72) {
          const _p2sf = 0.6 + 0.4 * Math.abs(Math.sin(t * 0.016));
          _p2ShieldStr = 'ONLINE'; _p2ShieldColor = `rgba(50,215,120,${(0.55 + 0.45 * _p2sf).toFixed(2)})`; _p2ShieldGlow = `rgba(50,215,120,${(_p2sf * 0.45).toFixed(2)})`;
        } else {
          _p2ShieldStr = 'STARTING...'; _p2ShieldColor = `rgba(210,200,70,${(0.4 + 0.3 * Math.abs(Math.sin(t * 0.009))).toFixed(2)})`;
        }
      } else {
        _p2ShieldStr = 'ACTIVE';
        _p2ShieldColor = p2ShieldHovered ? 'rgba(50,215,120,0.95)' : 'rgba(50,215,120,0.75)';
        _p2ShieldGlow = p2ShieldHovered ? 'rgba(50,215,120,0.35)' : null;
      }
      ctx.textAlign = 'center';
      ctx.font = `${_fVal}px "Press Start 2P", monospace`;
      if (_p2ShieldGlow) { ctx.shadowColor = _p2ShieldGlow; ctx.shadowBlur = 8; }
      ctx.fillStyle = _p2ShieldColor;
      ctx.fillText(_p2ShieldStr, INT_W / 2, _yVal2);
      const _p2ShieldTW = ctx.measureText(_p2ShieldStr).width;
      ctx.shadowBlur = 0;
      const _p2HasTimer = p2BlockingEnabled === false && p2BlockingDuration > 0;
      if (_p2HasTimer) {
        const _p2remSec = Math.max(0, Math.ceil((p2BlockingDuration - (t - p2BlockingOffAt)) / 1000));
        const _p2mins = Math.floor(_p2remSec / 60), _p2secs = _p2remSec % 60;
        ctx.font = `${_fSub}px "Press Start 2P", monospace`;
        ctx.fillStyle = 'rgba(255,100,80,0.65)';
        ctx.fillText(`${_p2mins}:${String(_p2secs).padStart(2,'0')}`, INT_W / 2, _ySub2);
      }
      if (_p2ShipVisible) {
        const _p2hbPad = 10;
        const _p2hbTop = _yVal2 - Math.round(_fVal * 0.95);
        const _p2hbH = _p2HasTimer ? Math.round(_fVal * 0.95 + _fSub * 2.2) : Math.round(_fVal * 1.35);
        p2ShieldHitbox = { x: INT_W / 2 - _p2ShieldTW / 2 - _p2hbPad, y: _p2hbTop, w: _p2ShieldTW + _p2hbPad * 2, h: _p2hbH };
      } else {
        p2ShieldHitbox = { x: 0, y: 0, w: 0, h: 0 };
      }
      ctx.restore();

      // P2 shield (disable) menu
      if (p2ShieldMenuOpen) {
        const _p2mw = 150, _p2mItemH = 26, _p2mPad = 8;
        const _p2mh = DISABLE_OPTIONS.length * _p2mItemH + _p2mPad * 2;
        const _p2menuX = Math.max(0, Math.min(W - _p2mw, Math.round(INT_W / 2 - _p2mw / 2)));
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
        p2ShieldMenuPopupBox = { x: _p2menuX, y: _p2menuY, w: _p2mw, h: _p2mh };
        p2ShieldMenuItems = DISABLE_OPTIONS.map((opt, idx) => {
          const iy = _p2menuY + _p2mPad + idx * _p2mItemH;
          const hb = { x: _p2menuX, y: iy, w: _p2mw, h: _p2mItemH };
          const hov = mouseX >= hb.x && mouseX < hb.x + hb.w && mouseY >= hb.y && mouseY < hb.y + hb.h;
          if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
          ctx.textAlign = 'left';
          ctx.fillStyle = hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
          ctx.fillText(opt.label, _p2menuX + 14, iy + 18);
          const timer = opt.timerFn ? opt.timerFn() : opt.timer;
          return { ...opt, timer, hitbox: hb };
        });
      } else {
        p2ShieldMenuItems = []; p2ShieldMenuPopupBox = null;
      }

      // ── P2 STATS (INTEL) ───────────────────────────────────
      if (INTEL_W >= 50) {
        const _p2i2Min = 15 * _fSub, _p2i4Min = 33 * _fSub;
        const _p2Blocked = p2HudStats.blocked;
        const _p2Allowed = PROVIDER === 'technitium' ? p2HudStats.no_error
          : (p2HudStats.queries != null && _p2Blocked != null ? p2HudStats.queries - _p2Blocked : null);
        const _p2AllowedLabel = PROVIDER === 'technitium' ? 'no error' : 'allowed';
        const _p2Total   = p2HudStats.queries;
        const _p2Pct     = p2HudStats.percent;
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
      if (p2GravityState === 'updating') {
        _p2SigsStr = 'UPDATING';
        _p2SigsColor = `rgba(255,190,50,${(0.65 + 0.35 * Math.sin(t * 0.006)).toFixed(2)})`;
      } else {
        _p2SigsStr = _fmtGravity(p2HudGravity);
        if (p2GravityState === 'done') {
          const _p2age = t - p2GravityDoneAt;
          const _p2flash = Math.max(0, 1 - _p2age / 1200);
          if (_p2flash > 0.01) _p2SigsColor = `rgba(50,215,120,${(0.65 + 0.35 * _p2flash).toFixed(2)})`;
          if (_p2age > 1500) p2GravityState = 'idle';
        }
      }
      ctx.textAlign = 'center';
      ctx.font = `${_fVal}px "Press Start 2P", monospace`;
      ctx.fillStyle = _p2SigsColor; ctx.fillText(_p2SigsStr, TDB_X + TDB_W / 2, _yVal2);
      const _p2aW = bmpW(ARROW_DOWN_BMP) * ARROW_PX;
      const _p2aX = TDB_X + Math.round(30 * _fs), _p2aY = _p2RowSY + Math.round(_rowH * 0.48);
      let _p2ArrowCol = p2ArrowHovered ? 'rgba(255,190,50,0.95)' : 'rgba(95,200,230,0.55)';
      let _p2ArrowGlw = p2ArrowHovered ? 'rgba(255,190,50,0.50)' : null;
      if (p2GravityState === 'updating') {
        const _p2ap = (0.65 + 0.35 * Math.sin(t * 0.008)).toFixed(2);
        _p2ArrowCol = `rgba(255,190,50,${_p2ap})`; _p2ArrowGlw = 'rgba(255,190,50,0.35)';
        drawBmp(ctx, ARROW_DOWN_BMP, _p2aX, _p2aY + Math.round(Math.max(0, Math.sin(t * 0.005)) * 3), _p2ArrowCol, _p2ArrowGlw, ARROW_PX);
      } else {
        if (p2GravityState === 'done') {
          const _p2flash = Math.max(0, 1 - (t - p2GravityDoneAt) / 1200);
          if (_p2flash > 0.01) { _p2ArrowCol = `rgba(50,215,120,${(0.5+0.5*_p2flash).toFixed(2)})`; _p2ArrowGlw = `rgba(50,215,120,${(_p2flash*0.4).toFixed(2)})`; }
        }
        drawBmp(ctx, ARROW_DOWN_BMP, _p2aX, _p2aY, _p2ArrowCol, _p2ArrowGlw, ARROW_PX);
      }
      p2ArrowHitbox = { x: _p2aX - _p2aW / 2 - 4, y: _p2aY - 14, w: _p2aW + 8, h: 28 };
      ctx.restore();

      // ── P2 SHIP ────────────────────────────────────────────
      if (OPT_W > 0) {
        ctx.save();
        ctx.beginPath(); ctx.rect(OPT_X, _p2RowSY, OPT_W, _rowH); ctx.clip();
        ctx.textAlign = 'center';
        ctx.font = `${_fShip}px "Press Start 2P", monospace`;
        ctx.fillStyle = p2ShipMenuHovered && _canSelectP2Ship ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
        ctx.fillText(_shipLabels[p2CurrentShip], OPT_X + OPT_W / 2, _yVal2);
        const _p2ShipTW = ctx.measureText(_shipLabels[p2CurrentShip]).width;
        {
          const _hbPad = 8;
          const _hbTop = _yVal2 - Math.round(_fShip * 0.95);
          const _hbH = Math.round(_fShip * 1.35);
          p2ShipMenuHitbox = { x: OPT_X + OPT_W / 2 - _p2ShipTW / 2 - _hbPad, y: _hbTop, w: _p2ShipTW + _hbPad * 2, h: _hbH };
        }
        ctx.restore();
      } else {
        p2ShipMenuHitbox = { x: 0, y: 0, w: 0, h: 0 };
      }

      // P2 ship selector popup
      if (p2ShipMenuOpen && _canSelectP2Ship && OPT_W > 0) {
        const _p2ships = ['enterprise', 'falcon', 'normandy', 'pes', 'protector', 'serenity', 'swordfish', 'inbound'];
        const _p2sBmps  = { enterprise: ENTERPRISE_BMP, falcon: FALCON_BMP, normandy: NORMANDY_BMP, pes: PES_BMP,
                            protector: PROTECTOR_BMP, serenity: SERENITY_BMP, swordfish: SWORDFISH_BMP, inbound: INBOUND_BMP };
        const _p2sCols  = { enterprise: 'rgba(195,208,240,0.85)', falcon: 'rgba(195,208,240,0.85)', normandy: 'rgba(195,208,240,0.85)', pes: 'rgba(89,223,139,0.85)',
                            protector: 'rgba(195,208,240,0.85)', serenity: 'rgba(195,208,240,0.85)', swordfish: 'rgba(207,50,33,0.85)', inbound: 'rgba(150,155,165,0.85)' };
        const _p2sGlows = { enterprise: 'rgba(170,190,235,0.32)', falcon: 'rgba(170,190,235,0.32)', normandy: 'rgba(170,190,235,0.32)', pes: 'rgba(89,223,139,0.32)',
                            protector: 'rgba(170,190,235,0.32)', serenity: 'rgba(170,190,235,0.32)', swordfish: 'rgba(203,38,20,0.32)', inbound: null };
        const _p2compact = W < 660;
        const _p2cols = _p2compact ? 2 : 4;
        const _p2rows = _p2compact ? 4 : 2;
        const _p2slotW = _p2compact ? 85 : 90;
        const _p2slotH = _p2compact ? 70 : 82;
        const _p2mPad = 10;
        const _p2mw = _p2cols * _p2slotW + _p2mPad * 2;
        const _p2mh = _p2rows * _p2slotH + _p2mPad * 2;
        const _p2mX = Math.max(4, Math.min(W - _p2mw - 4, OPT_X + OPT_W / 2 - _p2mw / 2));
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
        p2ShipMenuPopupBox = { x: _p2mX, y: _p2mY, w: _p2mw, h: _p2mh };
        let _p2anyHov = false;
        p2ShipMenuItems = _p2ships.map((s, i) => {
          const _p2col = i % _p2cols, _p2row = Math.floor(i / _p2cols);
          const _p2sX  = _p2mX + _p2mPad + _p2col * _p2slotW;
          const _p2sY  = _p2mY + _p2mPad + _p2row * _p2slotH;
          const _p2sCX = _p2sX + _p2slotW / 2;
          const _p2isActive = s === p2CurrentShip;
          const _p2isLocked = s === 'inbound';
          const _p2isTaken = !_p2isActive && s === currentShip;
          const hb = { x: _p2sX, y: _p2sY, w: _p2slotW, h: _p2slotH };
          const _p2shipCY = _p2sY + _p2slotH / 2 - 8;
          const _p2labelY = _p2sY + _p2slotH - 11;
          const hov = !_p2anyHov && !_p2isActive && !_p2isLocked && !_p2isTaken && mouseX >= hb.x && mouseX < hb.x + hb.w && mouseY >= hb.y && mouseY < hb.y + hb.h;
          if (hov) _p2anyHov = true;
          if (hov) { ctx.fillStyle = 'rgba(140,160,175,0.08)'; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); }
          const _p2glitching = _p2isLocked && missingnoGlitchAt > 0 && (t - missingnoGlitchAt) < 1400;
          ctx.save();
          ctx.globalAlpha = _p2isLocked || _p2isTaken ? 0.35 : (_p2isActive ? 0.28 : (hov ? 1.0 : 0.70));
          if (_p2glitching) {
            const _gAge = t - missingnoGlitchAt;
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
          const _p2labelVisible = !_p2glitching || Math.floor((t - missingnoGlitchAt) / 400) % 2 === 1;
          if (_p2labelVisible) {
            ctx.fillStyle = (_p2isLocked || _p2isTaken) ? 'rgba(130,135,145,0.55)' : _p2isActive ? 'rgba(80,80,80,0.50)' : hov ? 'rgba(215,225,248,0.95)' : 'rgba(175,200,238,0.65)';
            ctx.fillText(_p2isActive ? 'ACTIVE' : _p2isTaken ? 'P1' : _shipLabels[s], _p2sCX, _p2labelY);
          }
          return { ship: s, hitbox: hb, active: _p2isActive, locked: _p2isLocked || _p2isTaken, taken: _p2isTaken };
        });
      } else {
        p2ShipMenuItems = []; p2ShipMenuPopupBox = null;
      }
    } // end _isP2 HUD row

    // Intercept-off vignette -- full screen in 1P, per-half in 2P
    const _p1Off = blockingEnabled === false && shipPowerState === 'down';
    const _p2Off = _isP2 && p2BlockingEnabled === false;
    if (_p1Off || _p2Off) {
      if (_vigGradW !== W || _vigGradH !== H || _vigGradIs2P !== _isP2) {
        _vigGradIs2P = _isP2;
        _vigGrad = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, Math.hypot(W, H) * 0.62);
        _vigGrad.addColorStop(0, 'rgba(0,0,0,0)'); _vigGrad.addColorStop(1, 'rgba(210,25,25,1)');
        _vigGradL = ctx.createRadialGradient(W / 4, H / 2, H * 0.28, W / 4, H / 2, Math.hypot(W / 2, H) * 0.62);
        _vigGradL.addColorStop(0, 'rgba(0,0,0,0)'); _vigGradL.addColorStop(1, 'rgba(210,25,25,1)');
        _vigGradR = ctx.createRadialGradient(W * 3 / 4, H / 2, H * 0.28, W * 3 / 4, H / 2, Math.hypot(W / 2, H) * 0.62);
        _vigGradR.addColorStop(0, 'rgba(0,0,0,0)'); _vigGradR.addColorStop(1, 'rgba(210,25,25,1)');
        _vigGradW = W; _vigGradH = H;
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.0018);
      ctx.save(); ctx.globalAlpha = 0.07 + 0.05 * pulse;
      if (!_isP2) {
        ctx.fillStyle = _vigGrad; ctx.fillRect(0, 0, W, H);
      } else {
        if (_p1Off) {
          ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W / 2, H); ctx.clip();
          ctx.fillStyle = _vigGradL; ctx.fillRect(0, 0, W / 2, H);
          ctx.restore();
        }
        if (_p2Off) {
          ctx.save(); ctx.beginPath(); ctx.rect(W / 2, 0, W / 2, H); ctx.clip();
          ctx.fillStyle = _vigGradR; ctx.fillRect(W / 2, 0, W / 2, H);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }

  // ── SSE ───────────────────────────────────────────────────────────
  function connect() {
    if (evtSource) { evtSource.close(); evtSource = null; }
    evtSource = new EventSource('/api/pihole/events');
    evtSource.onopen = () => { sseRetryDelay = 3000; };
    evtSource.onmessage = e => {
      try {
        const evts = JSON.parse(e.data);
        if (Array.isArray(evts)) {
          queue.push(...evts);
          if (queue.length > 200) queue.splice(0, queue.length - 200);
        }
      } catch {}
    };
    evtSource.onerror = () => {
      if (evtSource) { evtSource.close(); evtSource = null; }
      if (active) setTimeout(connect, sseRetryDelay);
      sseRetryDelay = Math.min(sseRetryDelay * 2, 60000);
    };
  }

  // ── 2P connection management ──────────────────────────────────────
  function _p1Reveal() {
    if (_p1ShipVisible) return;
    _p1ShipVisible = true;
  }

  function _p2Reveal() {
    if (_p2ShipVisible) return;
    _p2ShipVisible = true;
    if (_p2SnapReveal) {
      _p2SnapReveal = false;
      p2ShipY = (H - safeBottom) * 0.65;
      _p2ShipRipInAt = 0;
    } else {
      _p2ShipRipInAt = _p2BottomEntry ? 0 : performance.now();
    }
    _p2BottomEntry = false;
  }

  function _disconnectP2() {
    if (p2EvtSource) { p2EvtSource.close(); p2EvtSource = null; }
    if (p2StatsPollTimer) { clearInterval(p2StatsPollTimer); p2StatsPollTimer = null; }
    _p2FastDepart = p2ShipY > -100;
    _p2BottomEntry = false;
    _p2SnapReveal = false;
    _p2ShipVisible = false;
    _p2ShipRipInAt = 0;
    p2Queue.length = 0;
    p2Entities.length = 0;
    p2Lasers.length = 0;
    p2HudStats = { blocked: null, queries: null, no_error: null, percent: null };
    p2BlockingEnabled = null;
    p2CmdExpected = null; p2CmdDeadline = 0;
    p2WarpState = 'none'; p2WarpAt = 0; p2WarpNextShip = null; p2WarpPrevShip = null;
    p2CarrierState = 'none'; p2CarrierY = 0; p2CarrierRestY = 0; p2CarrierArrivingAt = 0; p2CarrierLeavingAt = 0; p2LaunchAt = 0; p2StartupAt = 0; p2PowerdownAt = 0;
    p2CrewMembers = []; p2CrewNextSpawn = 0; p2LastFuelAt = 0;
    p2HudGravity = null; p2GravityState = 'idle'; p2GravityDoneAt = 0;
    p2ShieldMenuOpen = false; p2ShieldMenuItems = []; p2ShieldMenuPopupBox = null;
    p2ShipMenuOpen = false; p2ShipMenuItems = []; p2ShipMenuPopupBox = null;
  }

  function fetchP2Stats() {
      fetch('/api/pihole2/stats', { signal: AbortSignal.timeout(1800) })
        .then(r => r.json())
        .then(d => {
          if (d.blocked != null) p2HudStats.blocked = d.blocked;
          if (d.queries != null) p2HudStats.queries = d.queries;
          if (d.no_error != null) p2HudStats.no_error = d.no_error;
          if (d.percent != null) p2HudStats.percent = d.percent;
          // Reconciliation: while a locally-issued toggle is pending, a poll that
          // still reflects the pre-toggle state is stale. Ignore it so it can't
          // revert optimistic state or cancel the running startup/powerdown.
          if (p2CmdExpected !== null && d.blocking != null) {
            if (d.blocking === p2CmdExpected || performance.now() >= p2CmdDeadline) p2CmdExpected = null;
            else d = { ...d, blocking: null };
          }
          if (d.blocking != null) {
            const _pb = p2BlockingEnabled; p2BlockingEnabled = d.blocking;
            // Stamp the off-transition once so the P2 crew timer runs even under a live countdown.
            if (d.blocking === false && _pb !== false) p2BlockingOffSince = performance.now();
            if (d.blocking === false && d.block_timer > 0) { p2BlockingOffAt = performance.now(); p2BlockingDuration = d.block_timer * 1000; }
            else if (d.blocking === true) { p2BlockingDuration = 0; }
            if (d.blocking === true && _pb === false && p2StartupAt === 0 && p2LaunchAt === 0) { const _now = performance.now(); p2StartupAt = _now; p2PowerdownAt = 0; p2GunCheckFiredAt[0] = 0; p2GunCheckFiredAt[1] = 0; if ((twoPlayerMode !== 'off' ? carrierState : p2CarrierState) === 'none') chainRings.push({ x: p2ShipX, y: p2ShipY, born: _now, dur: 380, maxR: 90, col1: 'rgba(180,220,255,0.9)', colS: 'rgba(120,180,255,0.7)' }); }
            // Only tear down startup on a genuine enabled->disabled transition; a
            // stray poll reporting 'false' must not nuke a running startup.
            // Clear p2LaunchAt too, else its stale value blocks the next enable's
            // startup trigger (guarded by p2LaunchAt === 0).
            if (d.blocking === false && _pb !== false) { p2StartupAt = 0; p2LaunchAt = 0; if (_pb === true) p2PowerdownAt = performance.now(); }
            if (twoPlayerMode === 'off' && _pb !== false && d.blocking === false && _p2ShipVisible && p2CarrierState === 'none') { p2CarrierState = 'arriving'; p2CarrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10; p2CarrierY = H + 240; p2CarrierArrivingAt = performance.now(); }
            if (twoPlayerMode !== 'off' && _pb !== false && d.blocking === false && _p2ShipVisible && carrierState === 'none') { carrierState = 'arriving'; carrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10; carrierY = H + 240; carrierArrivingAt = performance.now(); }
          }
          if (d.gravity != null && p2GravityState === 'idle') p2HudGravity = d.gravity;
          if (!_p2ShipVisible && (d.blocked != null || d.queries != null)) _p2Reveal();
        }).catch(() => {});
  }

  function _connectP2Local(snapReveal) {
    _disconnectP2();
    p2ShipX = W * 3 / 4;
    if (snapReveal) {
      p2ShipY = (H - safeBottom) * 0.65;
      _p2SnapReveal = true;
      _p2BottomEntry = false;
    } else {
      p2ShipY = H + 100;
      _p2BottomEntry = true;
    }
    fetchP2Stats();
    p2StatsPollTimer = setInterval(fetchP2Stats, 1000);
    p2EvtSource = new EventSource('/api/pihole2/events');
    p2EvtSource.onmessage = e => {
      try {
        const evts = JSON.parse(e.data);
        if (Array.isArray(evts)) {
          p2Queue.push(...evts);
          if (p2Queue.length > 200) p2Queue.splice(0, p2Queue.length - 200);
          if (!_p2ShipVisible) _p2Reveal();
        }
      } catch {}
    };
    p2EvtSource.onerror = () => {};
  }

  async function _init2P(isInitialLoad) {
    try {
      const s = await fetch('/api/2p/status', { signal: AbortSignal.timeout(1800) }).then(r => r.json());
      const newMode = s.mode === 'local' ? 'local' : 'off';
      const wasOff = twoPlayerMode === 'off';
      const modeChanged = newMode !== twoPlayerMode;
      const _prevHudSH = hudSH;
      twoPlayerMode = newMode;
      resize(modeChanged && active && !isInitialLoad);
      if (modeChanged && active && !isInitialLoad) {
        _hudSlideFrom = _prevHudSH;
        _hudSlideTo = hudSH;
        _hudSlideAt = performance.now();
      }
      if (newMode === 'local') {
        _connectP2Local(isInitialLoad);
        p2ShipX = W * 3 / 4;
        if (wasOff && !isInitialLoad) { _2pBannerAt = performance.now(); }
      }
    } catch {}
  }

  function resize(skipShipSnap) {
    safeBottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
    // Render the backing store at physical-pixel resolution so fractional OS/browser
    // scaling (e.g. Windows 150% => devicePixelRatio 1.5) stays crisp instead of the
    // browser nearest-neighbor upscaling a CSS-resolution canvas into uneven blocks.
    // At devicePixelRatio 1 (100% scaling) this is a no-op: _dpr=1, transform=identity.
    // Cap at 3 to bound the backing-store size on very high-DPR displays.
    _dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * _dpr); canvas.height = Math.round(H * _dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    // All game coordinates stay in CSS pixels; the transform maps them to device pixels.
    ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    _carrierSmoothX = twoPlayerMode !== 'off' ? W * 0.50 : W * 0.40;
    _p2CarrierSmoothX = W * 0.80;
    const _2pH = twoPlayerMode !== 'off' ? (W < 480 ? 66 : W < 660 ? 76 : 86) : 0;
    hudSH = _2pH > 0 ? _2pH * 2 + 1 : (W < 480 ? 84 : W < 660 ? 94 : 108);
    // Carrier rest Y for the new viewport; docked-ship bay offsets hang off this.
    const _restY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10;

    // A docked ship must be snapped onto its bay on the re-centered carrier, not
    // reset to the free-flight position, or it lands off the carrier after a resize.
    const _p1Docked = (carrierState === 'arriving' || carrierState === 'present') && (shipPowerState === 'down' || shipPowerState === 'startup');
    if (_p1Docked) {
      carrierRestY = _restY;
      if (carrierState === 'present') carrierY = _restY;
      const _bi = CARRIER_SHIP_ORDER.indexOf(currentShip);
      shipX = _carrierSmoothX + (_bi >= 0 ? CARRIER_BAY_DX[_bi] : 0);
      shipY = _restY + (_bi >= 0 ? CARRIER_BAY_DY[_bi] : 0);
    } else {
      if (!skipShipSnap) shipX = twoPlayerMode !== 'off' ? W / 4 : W / 2;
      shipY = (H - safeBottom) * 0.65;
    }

    // P2 shares the main carrier in 2P, has its own in 1P.
    const _p2Own = twoPlayerMode === 'off';
    if (_p2Own) p2CarrierRestY = _restY;
    const _p2CarrierSt = _p2Own ? p2CarrierState : carrierState;
    const _p2Docked = _p2ShipVisible && p2BlockingEnabled === false && (_p2CarrierSt === 'arriving' || _p2CarrierSt === 'present');
    if (_p2Docked) {
      if (_p2Own && _p2CarrierSt === 'present') p2CarrierY = _restY;
      const _p2cx = _p2Own ? _p2CarrierSmoothX : _carrierSmoothX;
      const _p2bi = CARRIER_SHIP_ORDER.indexOf(p2CurrentShip);
      p2ShipX = _p2cx + (_p2bi >= 0 ? CARRIER_BAY_DX[_p2bi] : 0);
      p2ShipY = _restY + (_p2bi >= 0 ? CARRIER_BAY_DY[_p2bi] : 0);
    } else {
      p2ShipX = W * 3 / 4;
      if (_p2ShipVisible && p2CarrierState === 'none') p2ShipY = (H - safeBottom) * 0.65;
    }

    // Crew coordinates are anchored to the old carrier position; drop them so they
    // re-emerge cleanly at the new hatch instead of floating off the carrier.
    crewMembers = []; crewNextSpawn = 0; lastFuelAt = 0;
    p2CrewMembers = []; p2CrewNextSpawn = 0; p2LastFuelAt = 0;

    // Settings button centered on the full HUD strip
    if (settingsBtnEl) settingsBtnEl.style.bottom = Math.round(hudSH / 2 - 10 + safeBottom) + 'px';
  }
  window.addEventListener('resize', () => { if (active) resize(); });
  document.addEventListener('dragstart', e => e.preventDefault());
  document.addEventListener('contextmenu', e => e.preventDefault());

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
    p2Entities.length = 0; p2Lasers.length = 0; p2Queue.length = 0;
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
    hudStats = { blocked: null, queries: null, no_error: null, percent: null };
    _p1ShipVisible = false;
    if (hudStatsPollTimer) { clearInterval(hudStatsPollTimer); hudStatsPollTimer = null; }
    gravityState = 'idle'; gravityDoneAt = 0;
    if (gravityPollTimer) { clearTimeout(gravityPollTimer); gravityPollTimer = null; }
    blockingEnabled = null; // preserve blockingOffAt/blockingDuration so active timers survive exit/re-enter
    blockingCmdExpected = null; blockingCmdDeadline = 0;
    shipPowerState = 'up'; startupAt = 0; lastEnemyAt = 0;
    gunCheckState = 0; gunCheckFiredAt = [0, 0];
    carrierState = 'none'; carrierY = 0; carrierRestY = 0; carrierArrivingAt = 0; carrierLeavingAt = 0; launchAt = 0;
    shieldMenuOpen = false; shieldMenuItems = []; shieldHovered = false;
    shipMenuOpen = false; shipMenuItems = []; shipMenuHovered = false;
    settingsMenuOpen = false; settingsMenuItems = [];
    p2HudGravity = null; p2GravityState = 'idle'; p2GravityDoneAt = 0;
    p2ShieldMenuOpen = false; p2ShieldMenuItems = []; p2ShieldHovered = false; p2ShieldMenuPopupBox = null;
    p2ShipMenuOpen = false; p2ShipMenuItems = []; p2ShipMenuHovered = false; p2ShipMenuPopupBox = null;
    p2ArrowHovered = false;
    { const _s2 = localStorage.getItem('ph_p2_ship'); p2CurrentShip = (_s2 && _SHIP_CONFIGS[_s2]) ? _s2 : 'falcon'; }
    if (settingsBtnEl) { settingsBtnEl.style.display = 'block'; settingsBtnEl.classList.remove('menu-open'); }
    { const _s = localStorage.getItem('ph_ship'); currentShip = (_s && _SHIP_CONFIGS[_s]) ? _s : 'protector'; } warpState = 'none'; warpAt = 0; warpNextShip = null; warpPrevShip = null;
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
        carrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10;
        carrierY = carrierRestY;
        carrierState = 'present';
        { const _bi = CARRIER_SHIP_ORDER.indexOf(currentShip); shipX = _carrierSmoothX + (_bi >= 0 ? CARRIER_BAY_DX[_bi] : 0); shipY = carrierRestY + (_bi >= 0 ? CARRIER_BAY_DY[_bi] : 0); }
        _firstEnterFetch = false;
      } else {
        sessionStorage.removeItem('ph_block_timer');
      }
    }
    function fetchPiholeStats() {
      fetch('/api/pihole/stats', { signal: AbortSignal.timeout(1800) }).then(r => r.json()).then(d => {
        if (d.gravity != null) hudGravity = d.gravity;
        // Reconciliation: while a local toggle is pending, a poll still reflecting
        // the pre-toggle state is stale. Ignore it until the backend catches up
        // (or the deadline lapses) so it can't spuriously flip shipPowerState.
        if (blockingCmdExpected !== null && d.blocking != null) {
          if (d.blocking === blockingCmdExpected || performance.now() >= blockingCmdDeadline) blockingCmdExpected = null;
          else d = { ...d, blocking: null };
        }
        if (d.blocking != null) {
          const _wasFirst = _firstEnterFetch;
          if (_firstEnterFetch) _firstEnterFetch = false;
          const _prev = blockingEnabled;
          blockingEnabled = d.blocking;
          // Stamp the off-transition once (not every poll) so the crew timer runs.
          // Already-off on first load: backdate so crew can emerge promptly.
          if (!d.blocking && _prev !== false) blockingOffSince = _wasFirst ? performance.now() - 30000 : performance.now();
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
              carrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10;
              carrierY = carrierRestY;
              carrierState = 'present';
              { const _bi = CARRIER_SHIP_ORDER.indexOf(currentShip); shipX = _carrierSmoothX + (_bi >= 0 ? CARRIER_BAY_DX[_bi] : 0); shipY = carrierRestY + (_bi >= 0 ? CARRIER_BAY_DY[_bi] : 0); }
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
        if (d.no_error != null) hudStats.no_error = d.no_error;
        if (d.percent != null) hudStats.percent = d.percent;
        if (!_p1ShipVisible && (d.blocking != null || d.blocked != null || d.queries != null)) _p1Reveal();
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
      if (hudStatsPollTimer) { clearInterval(hudStatsPollTimer); }
      hudStatsPollTimer = setInterval(fetchPiholeStats, 1000);
      if (p2StatsPollTimer) { fetchP2Stats(); clearInterval(p2StatsPollTimer); p2StatsPollTimer = setInterval(fetchP2Stats, 1000); }
      if (active) { if (_rafId !== null) cancelAnimationFrame(_rafId); _rafId = requestAnimationFrame(tick); }
    };
    document.addEventListener('visibilitychange', _onVisible);
    // Also clear on window focus: tab may stay visible all day while machine idles,
    // skipping visibilitychange entirely, yet the browser can still reclaim GPU-backed
    // canvas memory. Focus fires when the user returns and is cheap to handle.
    if (_onFocus) window.removeEventListener('focus', _onFocus);
    _onFocus = () => {
      clearSpriteCache();
      fetchPiholeStats();
      if (!evtSource) connect();
      if (hudStatsPollTimer) clearInterval(hudStatsPollTimer);
      hudStatsPollTimer = setInterval(fetchPiholeStats, 1000);
      if (p2StatsPollTimer) { fetchP2Stats(); clearInterval(p2StatsPollTimer); p2StatsPollTimer = setInterval(fetchP2Stats, 1000); }
      if (active) { if (_rafId !== null) cancelAnimationFrame(_rafId); _rafId = requestAnimationFrame(tick); }
    };
    window.addEventListener('focus', _onFocus);
    // Sleep/wake detection: neither visibilitychange nor focus fires when the machine
    // sleeps while the tab stays focused. A timer that fires significantly late means
    // the machine woke from sleep -- rebuild the sprite cache, revive the RAF loop,
    // and restart SSE + stats polling which may have dropped during the sleep.
    if (_sleepCheckTimer) clearInterval(_sleepCheckTimer);
    let _sleepCheckLast = Date.now();
    _sleepCheckTimer = setInterval(() => {
      const now = Date.now();
      if (now - _sleepCheckLast > 12000) {
        clearSpriteCache();
        fetchPiholeStats();
        if (!evtSource) connect();
        if (hudStatsPollTimer) clearInterval(hudStatsPollTimer);
        hudStatsPollTimer = setInterval(fetchPiholeStats, 1000);
        if (p2StatsPollTimer) { fetchP2Stats(); clearInterval(p2StatsPollTimer); p2StatsPollTimer = setInterval(fetchP2Stats, 1000); }
        if (active) { if (_rafId !== null) cancelAnimationFrame(_rafId); _rafId = requestAnimationFrame(tick); }
      }
      _sleepCheckLast = now;
    }, 4000);
    connect();
    if (window.TWO_PLAYER_ENABLED !== false) _init2P(true);
    requestAnimationFrame(t => {
      lastT = t; lastSpawn = t;
      canvas.style.opacity = '1';  // triggers the 0.6s transition after first paint
      _rafId = requestAnimationFrame(tick);
    });
  };

  window.exitPiholeMode = function() {
    if (!active) return;
    if (window.close2PModal) window.close2PModal();
    _disconnectP2();
    twoPlayerMode = 'off'; _2pBannerAt = 0;
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
    p2ShieldMenuOpen = false; p2ShieldMenuItems = []; p2ShipMenuOpen = false; p2ShipMenuItems = [];
    if (settingsBtnEl) { settingsBtnEl.style.display = 'none'; settingsBtnEl.classList.remove('menu-open'); }
    warpState = 'none'; warpNextShip = null;
    blockingEnabled = null; // preserve blockingOffAt/blockingDuration so active timers survive exit/re-enter
    canvas.style.cursor = '';
    if (evtSource) { evtSource.close(); evtSource = null; }
    if (_onVisible) { document.removeEventListener('visibilitychange', _onVisible); _onVisible = null; }
    if (_onFocus) { window.removeEventListener('focus', _onFocus); _onFocus = null; }
    if (_sleepCheckTimer) { clearInterval(_sleepCheckTimer); _sleepCheckTimer = null; }
    _exitTimer = setTimeout(() => {
      _exitTimer = null;
      active = false; if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
      ctx.clearRect(0, 0, W, H);
      shipPowerState = 'up'; gunCheckState = 0; lastEnemyAt = 0;
      carrierState = 'none'; carrierY = 0; carrierRestY = 0;
      entities.length = 0; lasers.length = 0; explosions.length = 0; queue.length = 0;
      p2Entities.length = 0; p2Lasers.length = 0; p2Queue.length = 0;
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
    // Arm the reconciliation guard: suppress stale polls until the backend
    // reports this value (or the 4s deadline lapses if the toggle silently failed).
    blockingCmdExpected = enable; blockingCmdDeadline = performance.now() + 4000;
    shieldMenuOpen = false;
    if (!enable) {
      blockingOffAt = performance.now();
      blockingOffSince = performance.now();
      blockingDuration = timerSec ? timerSec * 1000 : 0;
      if (blockingDuration > 0)
        sessionStorage.setItem('ph_block_timer', JSON.stringify({ wallOffAt: Date.now(), duration: blockingDuration }));
      shipPowerState = 'powerdown'; powerdownAt = performance.now();
      // If the ship is embiggened (triple-click egg), shrink it back with the bouncy
      // animation during the powerdown hold so it docks at normal size.
      if (shipEggBig || shipEggTo > 1) {
        shipEggBig = false; shipEggFrom = shipEggScale; shipEggTo = 1; shipEggAnimAt = performance.now();
      }
      if (shipQuote) shipQuote.shownAt = performance.now() - 3000;
      if (drone.state !== 'docked') drone.state = 'docking';
      if (drone2.state !== 'docked') drone2.state = 'docking';
    } else {
      blockingDuration = 0;
      sessionStorage.removeItem('ph_block_timer');
      gunCheckState = 0; gunCheckFiredAt = [0, 0];
      shipPowerState = 'startup'; startupAt = performance.now();
      if (carrierState === 'arriving' && (twoPlayerMode === 'off' || p2BlockingEnabled !== false)) {
        carrierState = 'leaving'; carrierLeavingAt = performance.now(); launchAt = performance.now();
      }
    }
    fetch('/api/pihole/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable, timer: timerSec }),
    }).then(r => r.json()).then(d => {
      if ('blocking' in d) {
        // Server disagrees with the request (rejected/failed) -> drop the guard and
        // let reality win; agrees -> keep it armed until a poll confirms.
        if (d.blocking !== blockingCmdExpected) blockingCmdExpected = null;
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

  function setP2Blocking(enable, timerSec = null) {
    const _prevP2 = p2BlockingEnabled;
    // Arm the reconciliation guard: suppress stale polls until the backend reports
    // this value (or the deadline lapses if the toggle silently failed).
    p2CmdExpected = enable; p2CmdDeadline = performance.now() + 4000;
    p2BlockingEnabled = enable;
    if (enable === false && _prevP2 !== false) p2BlockingOffSince = performance.now();
    if (enable === false && timerSec > 0) { p2BlockingOffAt = performance.now(); p2BlockingDuration = timerSec * 1000; }
    else if (enable === true) { p2BlockingDuration = 0; }
    if (enable === true && _prevP2 === false) { const _now = performance.now(); p2StartupAt = _now; p2PowerdownAt = 0; p2GunCheckFiredAt[0] = 0; p2GunCheckFiredAt[1] = 0; const _p2rc = twoPlayerMode !== 'off' ? carrierState : p2CarrierState; if (_p2rc === 'none') chainRings.push({ x: p2ShipX, y: p2ShipY, born: _now, dur: 380, maxR: 90, col1: 'rgba(180,220,255,0.9)', colS: 'rgba(120,180,255,0.7)' }); }
    if (enable === false) { p2StartupAt = 0; p2LaunchAt = 0; if (_prevP2 === true) p2PowerdownAt = performance.now(); }
    if (twoPlayerMode === 'off' && _prevP2 !== false && enable === false && _p2ShipVisible && p2CarrierState === 'none') {
      p2CarrierState = 'arriving'; p2CarrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10;
      p2CarrierY = H + 240; p2CarrierArrivingAt = performance.now();
    }
    if (twoPlayerMode !== 'off' && _prevP2 !== false && enable === false && _p2ShipVisible && carrierState === 'none') {
      carrierState = 'arriving'; carrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10;
      carrierY = H + 240; carrierArrivingAt = performance.now();
    }
    p2ShieldMenuOpen = false;
    fetch('/api/pihole2/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable, timer: timerSec }),
    }).then(r => r.json()).then(d => {
      if ('blocking' in d) {
        // If the server disagrees with what we asked (toggle rejected/failed),
        // the command didn't take: drop the guard and let reality win. If it
        // agrees, keep the guard armed until a stats poll confirms, covering the
        // Pi-hole propagation window.
        if (d.blocking !== p2CmdExpected) p2CmdExpected = null;
        const _pb2 = p2BlockingEnabled; p2BlockingEnabled = d.blocking;
        if (d.blocking === true && _pb2 === false && p2StartupAt === 0 && p2LaunchAt === 0) { const _now = performance.now(); p2StartupAt = _now; p2PowerdownAt = 0; p2GunCheckFiredAt[0] = 0; p2GunCheckFiredAt[1] = 0; const _p2rc = twoPlayerMode !== 'off' ? carrierState : p2CarrierState; if (_p2rc === 'none') chainRings.push({ x: p2ShipX, y: p2ShipY, born: _now, dur: 380, maxR: 90, col1: 'rgba(180,220,255,0.9)', colS: 'rgba(120,180,255,0.7)' }); }
        if (d.blocking === false && _pb2 !== false) { p2StartupAt = 0; p2LaunchAt = 0; if (_pb2 === true) p2PowerdownAt = performance.now(); }
        if (twoPlayerMode === 'off' && _pb2 !== false && d.blocking === false && _p2ShipVisible && p2CarrierState === 'none') { p2CarrierState = 'arriving'; p2CarrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10; p2CarrierY = H + 240; p2CarrierArrivingAt = performance.now(); }
        if (twoPlayerMode !== 'off' && _pb2 !== false && d.blocking === false && _p2ShipVisible && carrierState === 'none') { carrierState = 'arriving'; carrierRestY = (H - hudSH - safeBottom) - Math.round(CARRIER_BMP.length * CARRIER_PX / 2) - 10; carrierY = H + 240; carrierArrivingAt = performance.now(); }
      }
    }).catch(() => {});
  }

  function triggerP2GravityUpdate() {
    const prevGravity = p2HudGravity;
    const triggeredAt = performance.now();
    p2GravityState = 'updating';
    fetch('/api/pihole2/gravity-update', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.error || !d.ok) { p2GravityState = 'idle'; return; }
        let polls = 0;
        function poll() {
          if (!active || p2GravityState !== 'updating') return;
          if (polls++ > 40) { p2GravityState = 'idle'; return; }
          fetch('/api/pihole2/stats', { signal: AbortSignal.timeout(4000) })
            .then(r => r.json())
            .then(d => {
              const elapsed = performance.now() - triggeredAt;
              const countChanged = d.gravity != null && d.gravity !== prevGravity;
              if (countChanged || (d.gravity != null && elapsed > 25000)) {
                if (d.gravity != null) p2HudGravity = d.gravity;
                p2GravityState = 'done'; p2GravityDoneAt = performance.now();
              } else {
                setTimeout(poll, 3000);
              }
            })
            .catch(() => { setTimeout(poll, 5000); });
        }
        setTimeout(poll, 4000);
      })
      .catch(() => { p2GravityState = 'idle'; });
  }

  function initP2WarpOut(nextShip) {
    p2WarpPrevShip = null;
    p2WarpNextShip = nextShip;
    p2WarpState = 'out';
    p2WarpAt = performance.now();
    shakeAt = p2WarpAt; shakeDur = 500; shakeAmp = 16;
    p2ShipMenuOpen = false;
    p2ShipQuote = null; p2ShipQuoteCooldown = 0; p2ShipQuoteDeck = []; p2ShipQuoteDeckFor = null; p2ShipQuoteLastShown = null;
    p2Lasers.length = 0;
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
    // When the HUD is auto-hidden, the first click in the bottom band just summons
    // it back rather than firing an unseen control underneath.
    if (hudAutoHide && !_hudVisible && my >= H - hudSH - safeBottom - 50) {
      _hudRevealAt = performance.now();
      e.stopPropagation();
      return;
    }
    const _isP2Active = twoPlayerMode !== 'off' && _p2ShipVisible;

    // Settings menu open - click toggles a setting or dismisses
    if (settingsMenuOpen) {
      e.stopPropagation();
      // Background flyouts take priority and stay open after a pick (so you can compare).
      // Sky cascade first (it sits on top of / beside the mode flyout).
      if (bgSkyOpen) {
        for (const it of bgSkyItems) {
          if (_inBox(mx, my, it.hitbox)) { _applyBgPreset(it.key); return; }
        }
        if (bgSkyBox && _inBox(mx, my, bgSkyBox)) return;   // padding click: consume
      }
      if (bgMenuOpen) {
        for (const it of bgModeItems) {
          if (_inBox(mx, my, it.hitbox)) {
            if (it.disabled) return;                // CUSTOM with no BG_IMAGE: inert, keep menu open
            _applyBgMode(it.key);
            bgSkyOpen = (it.key === 'starfield');   // STARFIELD reveals the sky cascade; others hide it
            return;
          }
        }
        if (bgModeBox && _inBox(mx, my, bgModeBox)) return;
      }
      for (const item of settingsMenuItems) {
        if (_inBox(mx, my, item.hitbox)) {
          if (item.key !== 'bg-mode') { bgMenuOpen = false; bgSkyOpen = false; }
          if      (item.key === 'friendlies')  { showFriendlies = !showFriendlies; _saveDisplaySettings(); }
          else if (item.key === 'domain')      { showDomain     = !showDomain;     _saveDisplaySettings(); }
          else if (item.key === 'client')      { showClient     = !showClient;     _saveDisplaySettings(); }
          else if (item.key === 'crt') {
            crtEnabled = !crtEnabled;
            _saveDisplaySettings();
            if (crtEnabled) {
              document.body.classList.remove('crt-cooling');
              document.body.classList.add('crt-on', 'crt-warming'); // fade the filter in with the flash
              _playCrtOneShot(crtPowerEl, 'on');
            } else if (!crtPowerEl) {
              document.body.classList.remove('crt-on', 'crt-warming', 'crt-cooling'); // no element -> drop now
            } else {
              document.body.classList.remove('crt-warming');
              document.body.classList.add('crt-cooling');        // keep crt-on; fade out with the collapse
              _playCrtOneShot(crtPowerEl, 'off');
            }
          }
          else if (item.key === 'autohide')    { hudAutoHide     = !hudAutoHide; _hudRevealAt = performance.now(); _saveDisplaySettings(); }
          else if (item.key === 'bg-mode')     { bgMenuOpen = !bgMenuOpen; if (!bgMenuOpen) bgSkyOpen = false; }
          else if (item.key === '2p-mode') {
            settingsMenuOpen = false;
            _closeSettingsBtnAnimated();
            if (window.open2PModal) window.open2PModal();
          }
          else if (item.key === 'pihole-link') {
            const url = phLinkEl ? phLinkEl.dataset.href : null;
            if (url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
            settingsMenuOpen = false;
            _closeSettingsBtnAnimated();
          }
          else if (item.key === 'pihole-link-2') {
            const url2 = window.P2_DASHBOARD;
            if (url2 && /^https?:\/\//i.test(url2)) window.open(url2, '_blank', 'noopener,noreferrer');
            settingsMenuOpen = false;
            _closeSettingsBtnAnimated();
          }
          return;
        }
      }
      if (settingsMenuPopupBox && _inBox(mx, my, settingsMenuPopupBox)) { bgMenuOpen = false; bgSkyOpen = false; return; }
      settingsMenuOpen = false;
      bgMenuOpen = false; bgSkyOpen = false;
      _closeSettingsBtnAnimated();
      // fall through; let the click reach shield/ship hitboxes
    }

    // P2 ship menu open
    if (p2ShipMenuOpen) {
      e.stopPropagation();
      for (const item of p2ShipMenuItems) {
        if (_inBox(mx, my, item.hitbox)) {
          if (!item.active && !item.locked) initP2WarpOut(item.ship);
          if (item.locked && !item.taken && performance.now() >= missingnoGlitchCooldown) { missingnoGlitchAt = performance.now(); missingnoGlitchCooldown = missingnoGlitchAt + 2200; }
          return;
        }
      }
      if (p2ShipMenuPopupBox && _inBox(mx, my, p2ShipMenuPopupBox)) return;
      p2ShipMenuOpen = false;
      if (_inBox(mx, my, p2ShipMenuHitbox)) return;
    }

    // P2 shield menu open
    if (p2ShieldMenuOpen) {
      e.stopPropagation();
      for (const item of p2ShieldMenuItems) {
        if (_inBox(mx, my, item.hitbox)) { setP2Blocking(false, item.timer); return; }
      }
      if (p2ShieldMenuPopupBox && _inBox(mx, my, p2ShieldMenuPopupBox)) return;
      p2ShieldMenuOpen = false;
      if (_inBox(mx, my, p2ShieldHitbox)) return;
    }

    // Ship menu open - click selects or dismisses; fall through to activate other targets
    if (shipMenuOpen) {
      e.stopPropagation();
      for (const item of shipMenuItems) {
        if (_inBox(mx, my, item.hitbox)) {
          if (!item.active && !item.locked) initWarpOut(item.ship);
          if (item.locked && !item.taken && performance.now() >= missingnoGlitchCooldown) { missingnoGlitchAt = performance.now(); missingnoGlitchCooldown = missingnoGlitchAt + 2200; }
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
      // Quintuple-click within 1000ms embiggens the ship to 3x; it auto-reverts after
      // SHIP_EGG_HOLD on its own. While already big, clicks don't affect the size at all
      // (no re-arm, no shrink) - but a single click still pops a quote, below.
      if (!shipEggBig) {
        const _now = performance.now();
        shipClickTimes = shipClickTimes.filter(_ct => _now - _ct < 1000);
        shipClickTimes.push(_now);
        if (shipClickTimes.length >= 5) {
          shipClickTimes = [];
          shipEggBig = true;
          shipEggFrom = shipEggScale;
          shipEggTo = SHIP_EGG_BIG;
          shipEggAnimAt = _now;
          shipEggBigUntil = _now + SHIP_EGG_HOLD;
        }
      }
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

    // P2 ship body easter egg
    if (_p2ShipVisible && _inBox(mx, my, p2ShipBodyHitbox) && p2WarpState === 'none' && p2BlockingEnabled !== false) {
      e.stopPropagation();
      if (!p2ShipQuote && performance.now() >= p2ShipQuoteCooldown) {
        const _p2q = p2CurrentShip || 'protector';
        if (p2ShipQuoteDeck.length === 0 || p2ShipQuoteDeckFor !== _p2q) {
          const _src = [...(SHIP_QUOTES[_p2q] || SHIP_QUOTES.protector)];
          for (let _i = _src.length - 1; _i > 0; _i--) {
            const _j = Math.floor(Math.random() * (_i + 1));
            [_src[_i], _src[_j]] = [_src[_j], _src[_i]];
          }
          if (_src.length > 1 && p2ShipQuoteDeckFor === _p2q && _src[0] === p2ShipQuoteLastShown) {
            const _sw = 1 + Math.floor(Math.random() * (_src.length - 1));
            [_src[0], _src[_sw]] = [_src[_sw], _src[0]];
          }
          p2ShipQuoteDeck = _src;
          p2ShipQuoteDeckFor = _p2q;
        }
        const _chosen = p2ShipQuoteDeck.shift();
        p2ShipQuoteLastShown = _chosen;
        p2ShipQuote = { text: _chosen, shownAt: performance.now() };
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
      return;
    }

    // P2 ship selector toggle
    if (_isP2Active && _inBox(mx, my, p2ShipMenuHitbox) && p2BlockingEnabled === true && p2WarpState === 'none') {
      e.stopPropagation();
      p2ShipMenuOpen = !p2ShipMenuOpen;
      return;
    }

    // P2 shield toggle
    if (_isP2Active && _inBox(mx, my, p2ShieldHitbox)) {
      e.stopPropagation();
      if (p2BlockingEnabled === false) setP2Blocking(true);
      else if (p2BlockingEnabled === true) p2ShieldMenuOpen = true;
      return;
    }

    // P2 gravity arrow
    if (_isP2Active && p2GravityState === 'idle' && _inBox(mx, my, p2ArrowHitbox)) {
      e.stopPropagation();
      triggerP2GravityUpdate();
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (!active) { arrowHovered = false; shieldHovered = false; shipMenuHovered = false; p2ArrowHovered = false; p2ShieldHovered = false; p2ShipMenuHovered = false; canvas.style.cursor = ''; return; }
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left; mouseY = e.clientY - rect.top;
    const _p2mv = twoPlayerMode !== 'off' && _p2ShipVisible;
    arrowHovered = gravityState === 'idle' && _inBox(mouseX, mouseY, arrowHitbox);
    shieldHovered = _inBox(mouseX, mouseY, shieldHitbox);
    shipMenuHovered = _inBox(mouseX, mouseY, shipMenuHitbox) && blockingEnabled === true && shipPowerState === 'up' && warpState === 'none';
    p2ArrowHovered = _p2mv && p2GravityState === 'idle' && _inBox(mouseX, mouseY, p2ArrowHitbox);
    p2ShieldHovered = _p2mv && _inBox(mouseX, mouseY, p2ShieldHitbox);
    p2ShipMenuHovered = _p2mv && _inBox(mouseX, mouseY, p2ShipMenuHitbox) && p2BlockingEnabled === true && p2WarpState === 'none';
    const overShieldMenu   = shieldMenuOpen   && shieldMenuItems.some(item => _inBox(mouseX, mouseY, item.hitbox));
    const overShipMenu     = shipMenuOpen     && shipMenuItems.some(item => !item.active && !item.locked && _inBox(mouseX, mouseY, item.hitbox));
    const overSettingsMenu = settingsMenuOpen && settingsMenuItems.some(item => _inBox(mouseX, mouseY, item.hitbox));
    const overBgFlyout     = (bgMenuOpen && bgModeItems.some(item => !item.disabled && _inBox(mouseX, mouseY, item.hitbox)))
                          || (bgSkyOpen && bgSkyItems.some(item => _inBox(mouseX, mouseY, item.hitbox)));
    const overP2ShieldMenu = p2ShieldMenuOpen && p2ShieldMenuItems.some(item => _inBox(mouseX, mouseY, item.hitbox));
    const overP2ShipMenu   = p2ShipMenuOpen   && p2ShipMenuItems.some(item => !item.active && !item.locked && _inBox(mouseX, mouseY, item.hitbox));
    canvas.style.cursor = (arrowHovered || shieldHovered || overShieldMenu || shipMenuHovered || overShipMenu || overSettingsMenu || overBgFlyout || p2ArrowHovered || p2ShieldHovered || overP2ShieldMenu || p2ShipMenuHovered || overP2ShipMenu) ? 'pointer' : '';
  });

  // HUD auto-hide: any pointer activity in the bottom reveal zone re-arms the idle
  // timer. Pointer Events unify mouse/touch/pen, so touch taps summon the HUD too.
  function _onHudPointer(e) {
    _lastPtrType = e.pointerType || 'mouse';
    if (!hudAutoHide) return;
    if (e.clientY >= H - hudSH - safeBottom - 50) _hudRevealAt = performance.now();
  }
  window.addEventListener('pointermove', _onHudPointer, { passive: true });
  window.addEventListener('pointerdown', _onHudPointer, { passive: true });

  // The settings button sits above the canvas (z-index 16) and captures pointer events,
  // so canvas mousemove never fires while hovering it.
  if (phLinkEl) {
    phLinkEl.addEventListener('mouseenter', () => {
      arrowHovered = false; shieldHovered = false; shipMenuHovered = false;
      p2ArrowHovered = false; p2ShieldHovered = false; p2ShipMenuHovered = false;
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
      p2ArrowHovered = false; p2ShieldHovered = false; p2ShipMenuHovered = false;
      canvas.style.cursor = '';
    });
    settingsBtnEl.addEventListener('click', e => {
      e.stopPropagation();
      if (!active) return;
      settingsMenuOpen = !settingsMenuOpen;
      bgMenuOpen = false; bgSkyOpen = false;   // never reopen straight into a background flyout
      if (settingsMenuOpen) { settingsBtnEl.classList.add('menu-open'); }
      else { _closeSettingsBtnAnimated(); }
      if (settingsMenuOpen) {
        shieldMenuOpen = false;
        shipMenuOpen = false;
        p2ShieldMenuOpen = false;
        p2ShipMenuOpen = false;
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

  // Called by 2p.js when the modal closes, so mode changes take effect immediately
  window._game2PReconnect = function() {
    if (!active) return;
    _disconnectP2();
    setTimeout(() => { if (active) _init2P().catch(() => {}); }, 900);
  };

  // ── Test-only hook ─────────────────────────────────────────────────
  // Opt-in (window.__PH_TEST must be set before load); never present in
  // production. Exposes a read-only state snapshot plus direct drivers so the
  // blocking/animation state machine can be exercised without canvas hit-testing.
  if (window.__PH_TEST) {
    window.__phTest = {
      state: () => ({
        blockingEnabled, shipPowerState, startupAt, launchAt, blockingCmdExpected,
        p2BlockingEnabled, p2StartupAt, p2LaunchAt, p2PowerdownAt, p2CmdExpected,
        carrierState, twoPlayerMode,
        crewCount: crewMembers.length, p2CrewCount: p2CrewMembers.length,
      }),
      setBlocking: (e, t = null) => setBlocking(e, t),
      setP2Blocking: (e, t = null) => setP2Blocking(e, t),
      // Inject a dummy P2 crew member parked at post, to verify it is force-cleared
      // when the shared carrier departs (rather than left orphaned).
      // Placed far from the hatch so it cannot coincidentally reach the hatch and
      // be filtered out within the carrier-leave window; only an explicit clear
      // removes it.
      addP2Crew: () => p2CrewMembers.push({
        type: 'fuel', x: 9000, y: 9000, fromX: 9000, fromY: 9000, state: 'at_post',
        stateAt: performance.now(), wpIdx: 0, waypoints: [], returnPath: [],
        bumpX: 0, bumpY: 0, fleeX: 9000, fleeViaY: 9000, hoseFwdWpIdx: 0,
        spawnedAt: performance.now(), lifetime: 9e9,
      }),
    };
  }
})();
