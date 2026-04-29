#!/usr/bin/env node
// Hand-painted chibi pixel components for the British line infantry kit --
// SE and SW (3/4 front view) facings. SE is drawn explicitly; SW mirrors SE
// horizontally around the cell vertical axis (x' = 31 - x).
//
// Row layout (32w x 36h) -- identical to S facing:
// (coords below shifted +8 from original 16-wide layout to keep figure centered.)
//   7     plume tip white at x=8
//   8     plume body red at x=8
//   9-13  shako body 5 wide x=6..10 (shakoHi at x=6, shakoShade at x=10)
//   14    brim 7 wide x=5..11 dark
//   15-16 face -- 3w x 2t skin blob, lit top-left
//   17-22 coat torso 6 wide x=5..10 with X-belts and brass buckle
//         sleeves at x=4 and x=11
//   23    coat hem (darker red)
//   24-25 trousers split legs
//   26-27 gaiters with brass buttons row 26
//   28    boots
//
// Shadows are drawn separately by the runtime shadow-projection shader, so no
// shadow rows are baked into these component sprites.
//
// SE: 3/4 turned to soldier's left (= viewer's right). Body still mostly
// front-facing, rotated ~45 deg toward camera-right. Face shifts +1 px right.
// Lit side follows rotation: left sleeve (x=11) is lit (closer to viewer),
// right sleeve (x=4) is shaded (far side). Brass plate shifts to (9,11).
// Musket vertical at x=3 with offset socket bayonet at x=4, hand at (4,20).
// Tiny backpack-strap pixel at far-right edge row 17.
//
// SW: horizontal mirror of SE around x=8 center.

import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  paintMusketVertical,
  paintMusketHorizontal,
  paintMusketDiagonal,
  paintMusketHitTilted,
} from './lib/musket-shapes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COMPONENTS = resolve(ROOT, 'public/sprites/components');

const W = 32;
const H = 36;

const PAL = {
  skinHi: '#F0CDA0',
  skinShade: '#C49072',
  skinDeep: '#A87651',
  shakoMid: '#0F1226',
  shakoHi: '#26294A',
  shakoShade: '#070815',
  brass: '#F5B044',
  plumeTip: '#EDE8DA',
  plumeRed: '#D13B33',
  coatMid: '#C6373B',
  coatHi: '#E36A6A',
  coatShade: '#8E1F25',
  coatDeep: '#5C1419',
  beltWhite: '#EDE8DA',
  beltShade: '#B8B0A0',
  trouserMid: '#C9C2A8',
  trouserHi: '#D9D2B8',
  trouserShade: '#A89E80',
  gaiterBlack: '#1A1820',
  gaiterHi: '#2C2830',
  musketBarrel: '#5C3A20',
  musketMuzzle: '#2E1A0A',
  musketStock: '#3F2A1B',
  musketStockHi: '#6A4530',
  musketStockShade: '#241608',
  hammer: '#1A1820',
  bayonet: '#B0B8C4',
  bayonetTip: '#E8ECF2',
};

function makeSprite() {
  const p = new PNG({ width: W, height: H, colorType: 6 });
  p.data.fill(0);
  return p;
}

function set(p, x, y, hex, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const i = (y * W + x) * 4;
  p.data[i + 0] = r;
  p.data[i + 1] = g;
  p.data[i + 2] = b;
  p.data[i + 3] = a;
}

function row(p, y, x0, x1, hex, a = 255) {
  for (let x = x0; x <= x1; x++) set(p, x, y, hex, a);
}

function save(p, relPath) {
  const out = resolve(COMPONENTS, relPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, PNG.sync.write(p));
  console.log(`  ${relPath}`);
}

// Mirror an existing sprite horizontally around the cell vertical axis (x = 31 - x).
function mirror(src) {
  const dst = makeSprite();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const di = (y * W + (W - 1 - x)) * 4;
      dst.data[di + 0] = src.data[si + 0];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

// --- SE drawers (return sprite so SW can mirror) ---

function drawBodySE() {
  const p = makeSprite();
  // Face shifts 1 px right: skin blob at x=16..18 rows 15-16.
  // Top-left lit; right side deeper shadow per rotation.
  set(p, 16, 15, PAL.skinShade);
  set(p, 17, 15, PAL.skinShade);
  set(p, 18, 15, PAL.skinDeep);
  set(p, 16, 16, PAL.skinHi);
  set(p, 17, 16, PAL.skinShade);
  set(p, 18, 16, PAL.skinDeep);
  return p;
}

function drawTrousersSE() {
  const p = makeSprite();
  // Leg columns x=14..17 (4 wide, centered under coat).
  // Same range for trousers, gaiters, and row 28. SW mirror of x=14..17 is x=14..17.
  for (let y = 24; y <= 25; y++) {
    set(p, 14, y, PAL.trouserHi);
    set(p, 15, y, PAL.trouserMid);
    set(p, 16, y, PAL.trouserMid);
    set(p, 17, y, PAL.trouserShade);
  }
  for (let y = 26; y <= 27; y++) {
    set(p, 14, y, PAL.gaiterBlack);
    set(p, 15, y, PAL.gaiterBlack);
    set(p, 16, y, PAL.gaiterBlack);
    set(p, 17, y, PAL.gaiterBlack);
  }
  // Edge highlight on lit side, one row.
  set(p, 14, 26, PAL.gaiterHi);
  // Brass buttons on inner two columns of the leg block.
  set(p, 15, 26, PAL.brass);
  set(p, 16, 26, PAL.brass);
  // Row 28: square off the leg, same columns as gaiters.
  row(p, 28, 14, 17, PAL.gaiterBlack);
  return p;
}

function drawCoatSE() {
  const p = makeSprite();
  // Torso fill rows 17-22.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  // X-belts, shifted +1 px right to follow rotated torso.
  // Belt visible on camera-near side (left shoulder -> right hip)
  // is the "emphasized" one -- drawn last so it overlays.
  const beltFar  = [[18, 17], [17, 18], [16, 19], [15, 20], [14, 21], [13, 22]];
  const beltNear = [[13, 17], [14, 18], [15, 19], [16, 20], [17, 21], [18, 22]];
  for (const [x, y] of beltFar) set(p, x, y, PAL.beltShade);
  for (const [x, y] of beltNear) set(p, x, y, PAL.beltWhite);
  // Brass plate shifts +1 px right to face camera-right.
  set(p, 17, 19, PAL.brass);
  // Sleeves swap shading vs S:
  //   right sleeve x=12 -> SHADED (far side from viewer now)
  //   left  sleeve x=19 -> LIT (closer to viewer)
  set(p, 12, 17, PAL.coatShade);
  set(p, 12, 18, PAL.coatShade);
  set(p, 12, 19, PAL.coatDeep);
  set(p, 19, 17, PAL.coatHi);
  set(p, 19, 18, PAL.coatMid);
  set(p, 19, 19, PAL.coatShade);
  set(p, 19, 20, PAL.coatMid);
  set(p, 19, 21, PAL.coatShade);
  // Backpack strap hint -- 1 px on far edge row 17, suggesting pack behind soldier.
  // Use belt-shade off-white to read as a strap.
  set(p, 20, 17, PAL.beltShade);
  // Coat hem row 23.
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  return p;
}

function drawShakoSE() {
  const p = makeSprite();
  set(p, 16, 7, PAL.plumeTip);
  set(p, 16, 8, PAL.plumeRed);
  for (let y = 9; y <= 13; y++) {
    row(p, y, 14, 18, PAL.shakoMid);
    set(p, 14, y, PAL.shakoHi);
    set(p, 18, y, PAL.shakoShade);
  }
  // Brass plate shifts from (16,11) to (17,11) -- faces camera-right.
  set(p, 17, 11, PAL.brass);
  // Brim overhangs only the RIGHT side for SE (east-leaning).
  row(p, 14, 14, 19, PAL.shakoShade);
  return p;
}

function drawMusketSE() {
  const p = makeSprite();
  // SE idle: vertical musket on viewer's left side (figure rotated to viewer-right).
  paintMusketVertical(p, 11, 22);
  // Right hand grips lock.
  set(p, 12, 20, PAL.skinHi);
  return p;
}

// --- SE FIRING POSE ---
// 3/4 front view firing down-right. Diagonal Brown Bess at ~45 deg, butt
// upper-left at chest (12,18), bayonet tip down-right at (22,28). Both arms
// reach forward (down-right). X-belts on chest stay (front view).

function drawCoatSEFiring() {
  const p = makeSprite();
  // Torso fill rows 17-22 (front-3/4, lit at viewer's left).
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  // X-belts (same rotation/shading as SE idle).
  const beltFar  = [[18, 17], [17, 18], [16, 19], [15, 20], [14, 21], [13, 22]];
  const beltNear = [[13, 17], [14, 18], [15, 19], [16, 20], [17, 21], [18, 22]];
  for (const [x, y] of beltFar) set(p, x, y, PAL.beltShade);
  for (const [x, y] of beltNear) set(p, x, y, PAL.beltWhite);
  // Brass plate shifted to camera-right.
  set(p, 17, 19, PAL.brass);
  // Backpack strap hint at far edge (mirrors SE idle).
  set(p, 20, 17, PAL.beltShade);
  // Coat hem.
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);

  // Far-side arm (camera-far, viewer's left, x=12) reaches inward to grip
  // the butt at the upper-left end of the diagonal.
  set(p, 12, 17, PAL.coatShade);       // far shoulder cap (shaded)
  set(p, 12, 18, PAL.coatShade);
  // (Hand on butt is the gun's butt pixel; coat sleeve stops at chest.)
  // Near-side arm (camera-near, viewer's right, x=19) extends down-and-in
  // along the diagonal to the forestock grip beside the barrel at (14,20).
  set(p, 19, 17, PAL.coatHi);          // near shoulder cap (lit)
  set(p, 19, 18, PAL.coatMid);         // bicep
  set(p, 18, 19, PAL.coatMid);         // forearm crossing inward
  set(p, 17, 20, PAL.coatMid);         // forearm continuing
  set(p, 16, 21, PAL.skinHi);          // near hand on forestock (snug to barrel (15,21))
  return p;
}

function drawMusketSEFiring() {
  const p = makeSprite();
  // SE firing: diagonal pointing DOWN-right -- this is the canonical NE
  // diagonal flipped vertically. Butt at upper-left near chest (10, 17).
  paintMusketDiagonal(p, 10, 17, { flipY: true });
  return p;
}

// --- SE MAKE-READY / HIT / DYING ---

const PAL_BLOOD = {
  bright: '#D13B33',
  dark:   '#7A1A22',
  pool:   '#5C1419',
};

function drawCoatSEMakeReady() {
  const p = makeSprite();
  // Same torso/belts/hem as idle.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  const beltFar  = [[18, 17], [17, 18], [16, 19], [15, 20], [14, 21], [13, 22]];
  const beltNear = [[13, 17], [14, 18], [15, 19], [16, 20], [17, 21], [18, 22]];
  for (const [x, y] of beltFar) set(p, x, y, PAL.beltShade);
  for (const [x, y] of beltNear) set(p, x, y, PAL.beltWhite);
  set(p, 17, 19, PAL.brass);
  set(p, 20, 17, PAL.beltShade);
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  // Both arms reach up to vertical centerline musket.
  // Left sleeve (viewer's right, lit, near side) up to forestock.
  set(p, 19, 17, PAL.coatHi);          // near shoulder cap
  set(p, 18, 16, PAL.coatMid);         // forearm rising
  set(p, 17, 15, PAL.skinHi);          // hand on forestock
  // Right sleeve (viewer's left, shaded, far side) up to lock.
  set(p, 12, 17, PAL.coatShade);       // far shoulder cap
  set(p, 13, 16, PAL.coatShade);
  set(p, 14, 16, PAL.coatMid);         // forearm crossing
  set(p, 15, 16, PAL.skinHi);          // hand on lock
  return p;
}

function drawMusketSEMakeReady() {
  const p = makeSprite();
  paintMusketVertical(p, 16, 20);
  return p;
}

function drawCoatSEHit() {
  const p = makeSprite();
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  const beltFar  = [[18, 17], [17, 18], [16, 19], [15, 20], [14, 21], [13, 22]];
  const beltNear = [[13, 17], [14, 18], [15, 19], [16, 20], [17, 21], [18, 22]];
  for (const [x, y] of beltFar) set(p, x, y, PAL.beltShade);
  for (const [x, y] of beltNear) set(p, x, y, PAL.beltWhite);
  set(p, 17, 19, PAL.brass);
  set(p, 20, 17, PAL.beltShade);
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  // Right arm (viewer's left, far-side) flung outward.
  set(p, 12, 17, PAL.coatShade);
  set(p, 11, 17, PAL.coatShade);
  set(p, 10, 17, PAL.coatShade);
  set(p, 9, 18, PAL.skinHi);
  // Left arm (viewer's right, near-side) flung outward forward.
  set(p, 19, 17, PAL.coatHi);
  set(p, 20, 17, PAL.coatHi);
  set(p, 21, 17, PAL.coatMid);
  set(p, 22, 18, PAL.skinHi);
  return p;
}

function drawMusketSEHit() {
  const p = makeSprite();
  // Hit-tilted, butt at (14, 23) -- same lean direction as S hit.
  paintMusketHitTilted(p, 14, 23);
  return p;
}

function drawBloodSEHit() {
  const p = makeSprite();
  // Spray erupting forward-right (camera-near side from a 3/4-front view).
  set(p, 19, 18, PAL_BLOOD.bright);
  set(p, 20, 19, PAL_BLOOD.bright);
  set(p, 18, 19, PAL_BLOOD.bright);
  set(p, 21, 20, PAL_BLOOD.dark);
  set(p, 22, 19, PAL_BLOOD.dark);
  set(p, 20, 17, PAL_BLOOD.bright);
  set(p, 21, 18, PAL_BLOOD.dark);
  set(p, 17, 17, PAL_BLOOD.dark);
  return p;
}

function drawBodySEDying() {
  const p = makeSprite();
  // Face shifted +1y.
  set(p, 16, 16, PAL.skinShade);
  set(p, 17, 16, PAL.skinShade);
  set(p, 18, 16, PAL.skinDeep);
  set(p, 16, 17, PAL.skinHi);
  set(p, 17, 17, PAL.skinShade);
  set(p, 18, 17, PAL.skinDeep);
  return p;
}

function drawShakoSEDying() {
  const p = makeSprite();
  // Shifted +1y.
  set(p, 16, 8, PAL.plumeTip);
  set(p, 16, 9, PAL.plumeRed);
  for (let y = 10; y <= 14; y++) {
    row(p, y, 14, 18, PAL.shakoMid);
    set(p, 14, y, PAL.shakoHi);
    set(p, 18, y, PAL.shakoShade);
  }
  set(p, 17, 12, PAL.brass);
  row(p, 15, 14, 19, PAL.shakoShade);
  return p;
}

function drawCoatSEDying() {
  const p = makeSprite();
  // Slumped torso (rows 18-23).
  for (let y = 18; y <= 23; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  // Crumpled belt core.
  set(p, 14, 19, PAL.beltWhite);
  set(p, 17, 19, PAL.beltWhite);
  set(p, 15, 20, PAL.beltWhite);
  set(p, 16, 20, PAL.beltWhite);
  set(p, 17, 21, PAL.brass);
  // Pack strap hint.
  set(p, 20, 18, PAL.beltShade);
  // Hem.
  row(p, 24, 13, 18, PAL.coatShade);
  set(p, 13, 24, PAL.coatDeep);
  set(p, 18, 24, PAL.coatDeep);
  // Right arm bent inward, hand clutching chest.
  set(p, 12, 19, PAL.coatHi);
  set(p, 13, 20, PAL.coatMid);
  set(p, 14, 21, PAL.coatMid);
  set(p, 15, 21, PAL.skinHi);
  // Left arm flung out wide forward (near-side of body).
  set(p, 19, 19, PAL.coatShade);
  set(p, 20, 19, PAL.coatShade);
  set(p, 21, 20, PAL.coatMid);
  set(p, 22, 20, PAL.coatMid);
  set(p, 23, 21, PAL.skinHi);
  return p;
}

function drawTrousersSEDying() {
  const p = makeSprite();
  for (let y = 25; y <= 26; y++) {
    set(p, 14, y, PAL.trouserHi);
    set(p, 15, y, PAL.trouserMid);
    set(p, 16, y, PAL.trouserMid);
    set(p, 17, y, PAL.trouserShade);
  }
  for (let y = 27; y <= 28; y++) {
    set(p, 13, y, PAL.gaiterBlack);
    set(p, 14, y, PAL.gaiterBlack);
    set(p, 17, y, PAL.gaiterBlack);
    set(p, 18, y, PAL.gaiterBlack);
  }
  set(p, 13, 27, PAL.gaiterHi);
  return p;
}

function drawMusketSEDying() {
  const p = makeSprite();
  // Musket flat on ground, butt at viewer's left, muzzle east.
  paintMusketHorizontal(p, 17, 29);
  return p;
}

function drawBloodSEDying() {
  const p = makeSprite();
  row(p, 30, 11, 21, PAL_BLOOD.pool);
  row(p, 29, 12, 20, PAL_BLOOD.dark);
  set(p, 13, 28, PAL_BLOOD.pool);
  set(p, 19, 28, PAL_BLOOD.pool);
  set(p, 16, 19, PAL_BLOOD.dark);
  set(p, 15, 21, PAL_BLOOD.dark);
  return p;
}

function drawSE() {
  console.log('Drawing SE facing components:');
  const body = drawBodySE();
  save(body, 'anatomy/body/southeast/base.png');
  const trousers = drawTrousersSE();
  save(trousers, 'uniform/lower/trousers/southeast.png');
  const coat = drawCoatSE();
  save(coat, 'uniform/coat-line/southeast/base.png');
  const shako = drawShakoSE();
  save(shako, 'uniform/head/shako-standard/southeast.png');
  const musket = drawMusketSE();
  save(musket, 'weapon/musket/southeast/idle.png');
  const coatFire = drawCoatSEFiring();
  save(coatFire, 'uniform/coat-line/southeast/present.png');
  save(coatFire, 'uniform/coat-line/southeast/fire.png');
  const musketFire = drawMusketSEFiring();
  save(musketFire, 'weapon/musket/southeast/present.png');
  save(musketFire, 'weapon/musket/southeast/fire.png');
  // Make-ready / hit / dying.
  const coatMR = drawCoatSEMakeReady();
  save(coatMR, 'uniform/coat-line/southeast/make-ready.png');
  const musketMR = drawMusketSEMakeReady();
  save(musketMR, 'weapon/musket/southeast/make-ready.png');
  const coatHit = drawCoatSEHit();
  save(coatHit, 'uniform/coat-line/southeast/hit.png');
  const musketHit = drawMusketSEHit();
  save(musketHit, 'weapon/musket/southeast/hit.png');
  const bloodHit = drawBloodSEHit();
  save(bloodHit, 'fx/blood/southeast/hit.png');
  const bodyDying = drawBodySEDying();
  save(bodyDying, 'anatomy/body/southeast/dying.png');
  const shakoDying = drawShakoSEDying();
  save(shakoDying, 'uniform/head/shako-standard/southeast-dying.png');
  const coatDying = drawCoatSEDying();
  save(coatDying, 'uniform/coat-line/southeast/dying.png');
  const trousersDying = drawTrousersSEDying();
  save(trousersDying, 'uniform/lower/trousers/southeast-dying.png');
  const musketDying = drawMusketSEDying();
  save(musketDying, 'weapon/musket/southeast/dying.png');
  const bloodDying = drawBloodSEDying();
  save(bloodDying, 'fx/blood/southeast/dying.png');
  return {
    body, trousers, coat, shako, musket, coatFire, musketFire,
    coatMR, musketMR, coatHit, musketHit, bloodHit,
    bodyDying, shakoDying, coatDying, trousersDying, musketDying, bloodDying,
  };
}

// Clear pixel(s) in a row by setting alpha=0.
function clearPixel(p, x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  p.data[i + 0] = 0;
  p.data[i + 1] = 0;
  p.data[i + 2] = 0;
  p.data[i + 3] = 0;
}

function drawSW(seSprites) {
  console.log('Drawing SW facing components (mirror of SE):');
  save(mirror(seSprites.body), 'anatomy/body/southwest/base.png');
  // Trousers: mirror handles the leg block correctly. SE legs at x=8..11
  // mirror to SW legs at x=4..7 (4 wide, shifted 1 left for SW lean). Row 28
  // is just the squared-off leg base, no wider boot strip.
  save(mirror(seSprites.trousers), 'uniform/lower/trousers/southwest.png');
  save(mirror(seSprites.coat), 'uniform/coat-line/southwest/base.png');
  // Shako: mirror puts brim at cols 12..17; SW spec is brim 13..18 (west-leaning).
  // Clear x=12 (was set by mirror) and set x=18.
  const swShako = mirror(seSprites.shako);
  clearPixel(swShako, 12, 14);
  set(swShako, 18, 14, PAL.shakoShade);
  save(swShako, 'uniform/head/shako-standard/southwest.png');
  save(mirror(seSprites.musket), 'weapon/musket/southwest/idle.png');
  // Firing pose: mirror the SE coat + musket diagonals to SW.
  const swCoatFire = mirror(seSprites.coatFire);
  save(swCoatFire, 'uniform/coat-line/southwest/present.png');
  save(swCoatFire, 'uniform/coat-line/southwest/fire.png');
  const swMusketFire = mirror(seSprites.musketFire);
  save(swMusketFire, 'weapon/musket/southwest/present.png');
  save(swMusketFire, 'weapon/musket/southwest/fire.png');
  // Make-ready / hit / dying mirrored from SE.
  save(mirror(seSprites.coatMR), 'uniform/coat-line/southwest/make-ready.png');
  save(mirror(seSprites.musketMR), 'weapon/musket/southwest/make-ready.png');
  save(mirror(seSprites.coatHit), 'uniform/coat-line/southwest/hit.png');
  save(mirror(seSprites.musketHit), 'weapon/musket/southwest/hit.png');
  save(mirror(seSprites.bloodHit), 'fx/blood/southwest/hit.png');
  save(mirror(seSprites.bodyDying), 'anatomy/body/southwest/dying.png');
  save(mirror(seSprites.shakoDying), 'uniform/head/shako-standard/southwest-dying.png');
  save(mirror(seSprites.coatDying), 'uniform/coat-line/southwest/dying.png');
  save(mirror(seSprites.trousersDying), 'uniform/lower/trousers/southwest-dying.png');
  save(mirror(seSprites.musketDying), 'weapon/musket/southwest/dying.png');
  save(mirror(seSprites.bloodDying), 'fx/blood/southwest/dying.png');
}

const FACINGS = process.argv.slice(2);
const all = FACINGS.length === 0;

const se = (all || FACINGS.includes('SE') || FACINGS.includes('SW')) ? drawSE() : null;
if (all || FACINGS.includes('SW')) drawSW(se);

console.log('\nDone.');
