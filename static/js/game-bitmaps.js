// ── Pixel-art ship bitmaps ────────────────────────────────────────────
// Each row is a bitmask (left to right). PX = pixel size in canvas px.
const PX = 3;

// Enemy type A — classic crab invader (11×8)
const E0 = [
  [0,0,1,0,0,0,0,0,1,0,0],
  [0,0,0,1,0,0,0,1,0,0,0],
  [0,0,1,1,1,1,1,1,1,0,0],
  [0,1,1,0,1,1,1,0,1,1,0],
  [1,1,1,1,1,1,1,1,1,1,1],
  [1,0,1,1,1,1,1,1,1,0,1],
  [1,0,1,0,0,0,0,0,1,0,1],
  [0,0,0,1,1,0,1,1,0,0,0],
];

// Enemy type B — squid (11×8)
const E1 = [
  [0,0,0,0,1,1,1,0,0,0,0],
  [0,0,0,1,1,1,1,1,0,0,0],
  [0,0,1,1,1,1,1,1,1,0,0],
  [0,1,1,0,1,1,1,0,1,1,0],
  [1,1,1,1,1,1,1,1,1,1,1],
  [0,1,1,1,1,1,1,1,1,1,0],
  [0,0,1,0,0,0,0,0,1,0,0],
  [0,1,0,0,0,0,0,0,0,1,0],
];

// Enemy type C — heavy drone x2 (11×8)
const E2 = [
  [0,1,0,0,0,0,0,0,0,1,0],
  [0,1,1,0,0,1,0,0,1,1,0],
  [1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,1,1,1,1,1,0,0,1],
  [1,1,0,1,0,1,0,1,0,1,1],
  [1,1,1,1,1,1,1,1,1,1,1],
  [0,1,0,0,1,0,1,0,0,1,0],
  [1,0,0,0,0,0,0,0,0,0,1],
];

// Enemy type D — boss x3+ (11×9)
const E3 = [
  [1,0,0,1,0,0,0,1,0,0,1],
  [0,1,0,1,0,1,0,1,0,1,0],
  [0,1,1,1,1,1,1,1,1,1,0],
  [1,0,1,0,1,1,1,0,1,0,1],
  [1,1,1,1,1,1,1,1,1,1,1],
  [1,0,1,0,1,1,1,0,1,0,1],
  [0,1,1,1,0,1,0,1,1,1,0],
  [0,0,1,0,0,0,0,0,1,0,0],
  [0,1,0,0,0,0,0,0,0,1,0],
];

// Friendly type A — rounded shuttle (9×7)
const F0 = [
  [0,0,1,1,1,1,1,0,0],
  [0,1,1,1,1,1,1,1,0],
  [1,1,0,1,1,1,0,1,1],
  [1,1,1,1,1,1,1,1,1],
  [0,1,0,1,1,1,0,1,0],
  [0,1,0,0,0,0,0,1,0],
  [0,1,0,0,0,0,0,1,0],
];

// Friendly type B — delta wing (11×6)
const F1 = [
  [0,0,0,0,0,1,0,0,0,0,0],
  [0,0,0,0,1,1,1,0,0,0,0],
  [0,0,1,1,1,1,1,1,1,0,0],
  [0,1,1,1,0,1,0,1,1,1,0],
  [1,1,0,0,0,1,0,0,0,1,1],
  [1,0,0,0,0,0,0,0,0,0,1],
];

// Friendly type C — X-wing (9×8)
const F2 = [
  [1,0,0,0,1,0,0,0,1],
  [0,1,0,0,1,0,0,1,0],
  [0,0,1,0,1,0,1,0,0],
  [0,0,0,1,1,1,0,0,0],
  [0,0,0,1,1,1,0,0,0],
  [0,0,1,0,1,0,1,0,0],
  [0,1,0,0,1,0,0,1,0],
  [1,0,0,0,1,0,0,0,1],
];

// Friendly type D — heavy transport x2 (11×8)
const F3 = [
  [0,0,0,1,1,1,1,1,0,0,0],
  [0,0,1,1,1,1,1,1,1,0,0],
  [0,1,1,0,0,1,0,0,1,1,0],
  [1,1,1,0,1,1,1,0,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1],
  [0,1,1,0,1,1,1,0,1,1,0],
  [0,0,1,1,0,0,0,1,1,0,0],
  [0,1,0,0,0,0,0,0,0,1,0],
];

// Friendly type E — capital ship x3+ (13×8)
const F4 = [
  [0,0,0,0,1,1,1,1,1,0,0,0,0],
  [0,0,1,1,1,1,1,1,1,1,1,0,0],
  [0,1,1,0,0,1,1,1,0,0,1,1,0],
  [1,1,1,0,1,1,1,1,1,0,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1],
  [0,1,1,0,1,0,1,0,1,0,1,1,0],
  [0,0,1,1,0,0,1,0,0,1,1,0,0],
  [0,0,0,1,0,0,0,0,0,1,0,0,0],
];

// Player ship (21×17) — NSEA Protector: narrow spine + wide circular nacelle ring + pods
const PLAYER_BMP = [
  [0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0],  // r0:  nose (col 10)
  [0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0],  // r1:  3w
  [0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0],  // r2:  spine 3w
  [0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0],  // r3:  spine 3w
  [0,0,0,0,0,0,0,0,1,1,1,1,1,0,0,0,0,0,0,0,0],  // r4:  5w
  [0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0],  // r5:  9w — gun tips cols 6 & 14
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0],  // r6:  13w ring arm roots
  [0,0,0,1,1,1,0,0,1,1,1,1,1,0,0,1,1,1,0,0,0],  // r7:  L(3-5)+spine(8-12)+R(15-17)
  [0,0,1,1,1,0,0,0,1,1,1,1,1,0,0,0,1,1,1,0,0],  // r8:  L(2-4)+spine(8-12)+R(16-18)
  [0,1,1,1,0,0,0,0,1,1,1,1,1,0,0,0,0,1,1,1,0],  // r9:  L(1-3)+spine(8-12)+R(17-19)
  [1,1,1,0,0,0,0,0,0,1,1,1,0,0,0,0,0,0,1,1,1],  // r10: L(0-2)+spine(8-12)+R(18-20)
  [1,1,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,1,1],  // r11: L(0-2)+R(18-20) spine ends
  [1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1],  // r12: ring at outermost
  [0,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,0],  // r13: L(1-3)+R(17-19) curving in
  [0,0,1,1,1,1,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0],  // r14: pods L(2-5)+R(15-18)
  [0,0,1,1,1,1,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0],  // r15: pods
  [0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0],  // r16: exhaust L(3-4)+R(16-17)
];
const GUN_L_COL = 6, GUN_R_COL = 14, GUN_ROW = 5;

// Support drone — small delta fighter, cyan (7×5)
const DRONE_BMP = [
  [0,0,0,1,0,0,0],
  [0,0,1,1,1,0,0],
  [0,1,1,1,1,1,0],
  [1,1,0,1,0,1,1],
  [0,0,0,1,0,0,0],
];
const DRONE_PX = 3;
const DRONE_DEPLOY_THRESHOLD = 5;
const DRONE_RECALL_THRESHOLD = 3;
const DRONE_FIRE_INTERVAL = 900;

// Down-arrow — gravity update button in HUD (5×5)
const ARROW_DOWN_BMP = [
  [0,1,1,1,0],
  [0,1,1,1,0],
  [1,1,1,1,1],
  [0,1,1,1,0],
  [0,0,1,0,0],
];
const ARROW_PX = 3;

function bmpW(bmp) { return bmp[0].length; }
function bmpH(bmp) { return bmp.length; }

function droneTipPos(dx, dy) {
  const ox = dx - bmpW(DRONE_BMP) * DRONE_PX / 2;
  const oy = dy - bmpH(DRONE_BMP) * DRONE_PX / 2;
  const half = (DRONE_PX - 1) / 2;
  return { x: ox + 3 * DRONE_PX + half, y: oy + half };
}

// Exact canvas center of each gun pixel — matches drawBmp's fillRect placement.
function gunTipPos(cx, cy) {
  const ox = cx - bmpW(PLAYER_BMP) * PX / 2;
  const oy = cy - bmpH(PLAYER_BMP) * PX / 2;
  const half = (PX - 1) / 2;
  return {
    lx: ox + GUN_L_COL * PX + half,
    rx: ox + GUN_R_COL * PX + half,
    nx: ox + 10 * PX + half,      // nose (col 10, row 0) for triple center shot
    gy: oy + GUN_ROW * PX + half,
    ny: oy + half,
  };
}

// Millennium Falcon — top-down saucer + offset cockpit + twin forward prongs (17×15)
const FALCON_BMP = [
  [0,0,0,0,0,1,0,1,0,0,0,0,0,0,0], // r0
  [0,0,0,0,0,1,0,1,0,0,0,0,0,0,0], // r1
  [0,0,0,0,1,1,0,1,1,0,0,0,0,0,0], // r2
  [0,0,0,1,1,1,1,1,1,1,0,0,0,0,0], // r3
  [0,0,1,1,1,1,1,1,1,1,1,0,0,1,1], // r4
  [0,1,1,1,1,1,1,1,1,1,1,1,0,1,1], // r5
  [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // r6
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // r7
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,0], // r8
  [1,1,1,1,1,1,1,1,1,1,1,1,1,0,0], // r9
  [1,1,1,1,1,1,1,1,1,1,1,1,1,0,0], // r10
  [1,1,1,1,1,1,1,1,1,1,1,1,1,0,0], // r11
  [1,1,1,1,1,1,1,1,1,1,1,1,1,0,0], // r12
  [0,1,1,1,1,1,1,1,1,1,1,1,0,0,0], // r13
  [0,1,1,1,1,1,1,1,1,1,1,1,0,0,0], // r14
  [0,0,1,1,1,1,1,1,1,1,1,0,0,0,0], // r15
  [0,0,0,0,1,1,1,1,1,0,0,0,0,0,0], // r16
];
const FALCON_GUN_L = 3, FALCON_GUN_R = 9, FALCON_GUN_ROW = 3;

// Enterprise NCC-1701 — top-down saucer + neck + secondary hull + nacelles (13×11)
const ENTERPRISE_BMP = [
  [0,0,0,1,1,1,1,1,1,1,0,0,0],
  [0,0,1,1,1,1,1,1,1,1,1,0,0],
  [0,1,1,1,0,1,1,1,0,1,1,1,0],
  [0,1,1,1,1,1,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,1,1,1,1,1,0,0],
  [0,0,0,0,0,1,1,1,0,0,0,0,0],
  [0,0,0,0,0,1,1,1,0,0,0,0,0],
  [1,1,0,0,1,1,1,1,1,0,0,1,1],
  [1,1,0,0,1,1,1,1,1,0,0,1,1],
  [1,1,0,0,0,1,1,1,0,0,0,1,1],
  [0,1,0,0,0,0,1,0,0,0,0,1,0],
];
const ENT_GUN_L = 3, ENT_GUN_R = 9, ENT_GUN_ROW = 0;

function shipGunTipPos(ship, cx, cy) {
  if (ship === 'falcon') {
    const ox = cx - bmpW(FALCON_BMP) * PX / 2;
    const oy = cy - bmpH(FALCON_BMP) * PX / 2;
    const half = (PX - 1) / 2;
    return { lx: ox + FALCON_GUN_L * PX + half, rx: ox + FALCON_GUN_R * PX + half,
              nx: ox + 6 * PX + half, gy: oy + FALCON_GUN_ROW * PX + half, ny: oy + half };
  }
  if (ship === 'enterprise') {
    const ox = cx - bmpW(ENTERPRISE_BMP) * PX / 2;
    const oy = cy - bmpH(ENTERPRISE_BMP) * PX / 2;
    const half = (PX - 1) / 2;
    return { lx: ox + ENT_GUN_L * PX + half, rx: ox + ENT_GUN_R * PX + half,
              nx: ox + 6 * PX + half, gy: oy + ENT_GUN_ROW * PX + half, ny: oy + half };
  }
  return gunTipPos(cx, cy);
}

function drawBmp(ctx, bmp, cx, cy, color, glowColor, px, solid = false) {
  const cols = bmpW(bmp), rows = bmpH(bmp);
  const ox = Math.round(cx - (cols * px) / 2);
  const oy = Math.round(cy - (rows * px) / 2);
  ctx.fillStyle = color;
  if (glowColor) {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 4;
  }
  const size = solid ? px - 2 : px - 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (bmp[r][c]) ctx.fillRect(ox + c * px, oy + r * px, size, size);
    }
  }
  if (glowColor) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }
}
