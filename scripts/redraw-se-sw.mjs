#!/usr/bin/env node
// Hand-painted chibi pixel components for the British line infantry kit --
// SE and SW (3/4 front view) facings. SE is drawn explicitly; SW mirrors SE
// horizontally around the cell vertical axis (x' = 15 - x).
//
// Row layout (16w x 36h) -- identical to S facing:
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
//   29-30 ground shadow
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COMPONENTS = resolve(ROOT, 'public/sprites/components');

const W = 16;
const H = 36;

const PAL = {
  shadow: '#000000',
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

// Mirror an existing sprite horizontally around the cell vertical axis (x = 15 - x).
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

function drawShadowSE() {
  const p = makeSprite();
  // Slight asymmetry: shadow extends a touch farther on viewer-right
  // (the camera-near side as the figure rotates).
  row(p, 30, 4, 12, PAL.shadow, 110);
  row(p, 29, 5, 11, PAL.shadow, 70);
  return p;
}

function drawBodySE() {
  const p = makeSprite();
  // Face shifts 1 px right: skin blob at x=8..10 rows 15-16.
  // Top-left lit; right side deeper shadow per rotation.
  set(p, 8, 15, PAL.skinShade);
  set(p, 9, 15, PAL.skinShade);
  set(p, 10, 15, PAL.skinDeep);
  set(p, 8, 16, PAL.skinHi);
  set(p, 9, 16, PAL.skinShade);
  set(p, 10, 16, PAL.skinDeep);
  return p;
}

function drawTrousersSE() {
  const p = makeSprite();
  // Leg columns x=6..9 (4 wide, centered under coat).
  // Same range for trousers, gaiters, and row 28. SW mirror of x=6..9 is x=6..9.
  for (let y = 24; y <= 25; y++) {
    set(p, 6, y, PAL.trouserHi);
    set(p, 7, y, PAL.trouserMid);
    set(p, 8, y, PAL.trouserMid);
    set(p, 9, y, PAL.trouserShade);
  }
  for (let y = 26; y <= 27; y++) {
    set(p, 6, y, PAL.gaiterBlack);
    set(p, 7, y, PAL.gaiterBlack);
    set(p, 8, y, PAL.gaiterBlack);
    set(p, 9, y, PAL.gaiterBlack);
  }
  // Edge highlight on lit side, one row.
  set(p, 6, 26, PAL.gaiterHi);
  // Brass buttons on inner two columns of the leg block.
  set(p, 7, 26, PAL.brass);
  set(p, 8, 26, PAL.brass);
  // Row 28: square off the leg, same columns as gaiters.
  row(p, 28, 6, 9, PAL.gaiterBlack);
  return p;
}

function drawCoatSE() {
  const p = makeSprite();
  // Torso fill rows 17-22.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 5, 10, PAL.coatMid);
    set(p, 5, y, PAL.coatHi);
    set(p, 10, y, PAL.coatShade);
  }
  // X-belts, shifted +1 px right to follow rotated torso.
  // Belt visible on camera-near side (left shoulder -> right hip)
  // is the "emphasized" one -- drawn last so it overlays.
  const beltFar  = [[10, 17], [9, 18], [8, 19], [7, 20], [6, 21], [5, 22]];
  const beltNear = [[5, 17], [6, 18], [7, 19], [8, 20], [9, 21], [10, 22]];
  for (const [x, y] of beltFar) set(p, x, y, PAL.beltShade);
  for (const [x, y] of beltNear) set(p, x, y, PAL.beltWhite);
  // Brass plate shifts +1 px right to face camera-right.
  set(p, 9, 19, PAL.brass);
  // Sleeves swap shading vs S:
  //   right sleeve x=4 -> SHADED (far side from viewer now)
  //   left  sleeve x=11 -> LIT (closer to viewer)
  set(p, 4, 17, PAL.coatShade);
  set(p, 4, 18, PAL.coatShade);
  set(p, 4, 19, PAL.coatDeep);
  set(p, 11, 17, PAL.coatHi);
  set(p, 11, 18, PAL.coatMid);
  set(p, 11, 19, PAL.coatShade);
  set(p, 11, 20, PAL.coatMid);
  set(p, 11, 21, PAL.coatShade);
  // Backpack strap hint -- 1 px on far edge row 17, suggesting pack behind soldier.
  // Use belt-shade off-white to read as a strap.
  set(p, 12, 17, PAL.beltShade);
  // Coat hem row 23.
  row(p, 23, 5, 10, PAL.coatShade);
  set(p, 5, 23, PAL.coatDeep);
  set(p, 10, 23, PAL.coatDeep);
  return p;
}

function drawShakoSE() {
  const p = makeSprite();
  set(p, 8, 7, PAL.plumeTip);
  set(p, 8, 8, PAL.plumeRed);
  for (let y = 9; y <= 13; y++) {
    row(p, y, 6, 10, PAL.shakoMid);
    set(p, 6, y, PAL.shakoHi);
    set(p, 10, y, PAL.shakoShade);
  }
  // Brass plate shifts from (8,11) to (9,11) -- faces camera-right.
  set(p, 9, 11, PAL.brass);
  // Brim overhangs only the RIGHT side for SE (east-leaning).
  row(p, 14, 6, 11, PAL.shakoShade);
  return p;
}

function drawMusketSE() {
  const p = makeSprite();
  // Vertical musket along x=3 (same column as S), socket bayonet offset at x=4.
  set(p, 4, 5, PAL.bayonetTip);
  set(p, 4, 6, PAL.bayonet);
  set(p, 4, 7, PAL.bayonet);
  // T-shape socket: in-line steel pixel in barrel column at bayonet base row.
  set(p, 3, 7, PAL.bayonet);
  set(p, 3, 8, PAL.musketMuzzle);
  for (let y = 9; y <= 19; y++) set(p, 3, y, PAL.musketBarrel);
  set(p, 3, 14, PAL.brass);
  set(p, 3, 20, PAL.brass);
  set(p, 2, 20, PAL.hammer);
  set(p, 3, 21, PAL.musketStockHi);
  set(p, 3, 22, PAL.musketStock);
  // Right hand grips lock.
  set(p, 4, 20, PAL.skinHi);
  return p;
}

function drawSE() {
  console.log('Drawing SE facing components:');
  const shadow = drawShadowSE();
  save(shadow, 'shadow/southeast/default.png');
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
  return { shadow, body, trousers, coat, shako, musket };
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
  save(mirror(seSprites.shadow), 'shadow/southwest/default.png');
  save(mirror(seSprites.body), 'anatomy/body/southwest/base.png');
  // Trousers: mirror handles the leg block correctly. SE legs at x=8..11
  // mirror to SW legs at x=4..7 (4 wide, shifted 1 left for SW lean). Row 28
  // is just the squared-off leg base, no wider boot strip.
  save(mirror(seSprites.trousers), 'uniform/lower/trousers/southwest.png');
  save(mirror(seSprites.coat), 'uniform/coat-line/southwest/base.png');
  // Shako: mirror puts brim at cols 4..9; SW spec is brim 5..10 (west-leaning).
  // Clear x=4 (was set by mirror) and set x=10.
  const swShako = mirror(seSprites.shako);
  clearPixel(swShako, 4, 14);
  set(swShako, 10, 14, PAL.shakoShade);
  save(swShako, 'uniform/head/shako-standard/southwest.png');
  save(mirror(seSprites.musket), 'weapon/musket/southwest/idle.png');
}

const FACINGS = process.argv.slice(2);
const all = FACINGS.length === 0;

const se = (all || FACINGS.includes('SE') || FACINGS.includes('SW')) ? drawSE() : null;
if (all || FACINGS.includes('SW')) drawSW(se);

console.log('\nDone.');
