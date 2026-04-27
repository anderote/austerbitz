#!/usr/bin/env node
// Hand-painted chibi pixel components for the British line infantry kit -- NE & NW facings.
// 3/4 back view (mirror pair). NE = soldier facing northeast (away + slightly to viewer's left
// rotation, so viewer sees more of the soldier's right side, which is camera-LEFT of figure).
// NW is the mirror around x=7.5.
//
// Row layout (32w x 36h) -- identical to S:
// (coords below shifted +8 from original 16-wide layout to keep figure centered.)
//   7     plume tip white at x=8
//   8     plume body red at x=8
//   9-13  shako body (5 wide x=6..10)
//   14    brim (7 wide x=5..11)
//   15-16 head -- BACK OF HEAD (hair color, no face features); one cheek peek pixel
//   17-22 coat torso (back view, NO X-belts) + backpack on top
//   23    coat hem
//   24-25 trousers (split legs)
//   26-27 gaiters (brass buttons row 26)
//   28    boots
//   29-30 ground shadow
//
// Backpack: 4w x 4h tan block over the upper torso, shifted 1 px toward
// the camera-far side (NE: shifted right; NW: shifted left). White strap
// pixels suggest shoulder straps.
//
// Musket: vertical on the camera-near side of the figure (NE: x=3 / viewer's
// left; NW: x=12 / viewer's right). Kept vertical for readability.

import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COMPONENTS = resolve(ROOT, 'public/sprites/components');

const W = 32;
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

// --- NORTHEAST (3/4 back, soldier rotated right; viewer sees soldier's right side on camera-LEFT) ---

function drawShadowNE() {
  const p = makeSprite();
  row(p, 30, 12, 19, PAL.shadow, 110);
  row(p, 29, 13, 18, PAL.shadow, 70);
  save(p, 'shadow/northeast/default.png');
}

function drawBodyNE() {
  // Back-of-head: hair pixels (musketStock dark brown) across rows 15-16, x=15..17.
  // One skin "cheek peek" pixel at (18, 16) showing the rotated jaw.
  const p = makeSprite();
  row(p, 15, 15, 17, PAL.musketStock);
  row(p, 16, 15, 17, PAL.musketStockShade); // slightly darker on lower row
  // Add a subtle highlight on the back of head (one pixel of musketStockHi)
  set(p, 16, 15, PAL.musketStockHi);
  // Cheek peek -- visible jaw on viewer's right side (camera-RIGHT) due to rotation.
  set(p, 18, 16, PAL.skinShade);
  save(p, 'anatomy/body/northeast/base.png');
}

function drawTrousersNE() {
  const p = makeSprite();
  // Leg columns x=14..17 (4 wide, centered under coat).
  // Same range for trousers, gaiters, and row 28.
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
  save(p, 'uniform/lower/trousers/northeast.png');
}

function drawCoatNE() {
  // Back of coat: solid red, NO X-belts, NO chest brass.
  // One sleeve visible on camera-near side (viewer's left, x=12).
  // Backpack overlaid on top of torso, shifted 1 px right (x=15..18) to
  // emphasize the rightward rotation of NE.
  const p = makeSprite();
  // Torso fill rows 17-22.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);   // viewer's left = lit
    set(p, 18, y, PAL.coatShade); // viewer's right = shaded
  }
  // Sleeve on the camera-near side (viewer's left, x=12).
  set(p, 12, 17, PAL.coatHi);
  set(p, 12, 18, PAL.coatMid);
  set(p, 12, 19, PAL.coatShade);
  set(p, 12, 20, PAL.coatShade);
  // Far-side sleeve barely visible (camera-RIGHT, x=19) due to back-3/4 rotation.
  set(p, 19, 17, PAL.coatShade);
  set(p, 19, 18, PAL.coatDeep);
  // Backpack: 4 wide x 4 tall, x=15..18, rows 17-20 (shifted 1 px right).
  // Fill with mid tan, then shade the camera-right edge.
  for (let y = 17; y <= 20; y++) {
    set(p, 15, y, PAL.musketStockHi);    // lit edge
    set(p, 16, y, PAL.musketStockHi);
    set(p, 17, y, PAL.musketStock);      // mid
    set(p, 18, y, PAL.musketStockShade); // shaded edge
  }
  // Shoulder strap pixels (white) at top corners of pack -- straps come over the shoulders.
  set(p, 15, 17, PAL.beltWhite);
  set(p, 18, 17, PAL.beltWhite);
  // Bottom strap tying pack to belt (thin grey/cream line).
  set(p, 16, 21, PAL.beltShade);
  set(p, 17, 21, PAL.beltShade);
  // Coat hem.
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  save(p, 'uniform/coat-line/northeast/base.png');
}

function drawShakoNE() {
  // Same shape as S but NO BRASS PLATE (frontal badge omitted on back view).
  const p = makeSprite();
  set(p, 16, 7, PAL.plumeTip);
  set(p, 16, 8, PAL.plumeRed);
  for (let y = 9; y <= 13; y++) {
    row(p, y, 14, 18, PAL.shakoMid);
    set(p, 14, y, PAL.shakoHi);   // viewer's left = lit
    set(p, 18, y, PAL.shakoShade); // viewer's right = shaded
  }
  // No brass plate on back.
  // Brim: east-leaning, overhangs only on the right.
  row(p, 14, 14, 19, PAL.shakoShade);
  save(p, 'uniform/head/shako-standard/northeast.png');
}

function drawMusketNE() {
  // Vertical musket on camera-near side (viewer's left, x=11).
  // Bayonet offset 1 column right (x=12) above muzzle.
  const p = makeSprite();
  set(p, 12, 3, PAL.bayonetTip);
  set(p, 12, 4, PAL.bayonet);
  set(p, 12, 5, PAL.bayonet);
  set(p, 12, 6, PAL.bayonet);
  set(p, 12, 7, PAL.bayonet);
  // T-shape socket: in-line steel pixel in barrel column at bayonet base row.
  set(p, 11, 7, PAL.bayonet);
  set(p, 11, 8, PAL.musketMuzzle);
  for (let y = 9; y <= 19; y++) set(p, 11, y, PAL.musketBarrel);
  set(p, 11, 14, PAL.brass);
  set(p, 11, 20, PAL.brass);
  set(p, 10, 20, PAL.hammer);
  set(p, 11, 21, PAL.musketStockHi);
  set(p, 11, 22, PAL.musketStock);
  // Hand grips lock from the body side.
  set(p, 12, 20, PAL.skinHi);
  save(p, 'weapon/musket/northeast/idle.png');
}

// --- NORTHWEST (mirror of NE around x=7.5; x' = 15 - x) ---

function drawShadowNW() {
  const p = makeSprite();
  row(p, 30, 4, 11, PAL.shadow, 110);
  row(p, 29, 5, 10, PAL.shadow, 70);
  save(p, 'shadow/northwest/default.png');
}

function drawBodyNW() {
  const p = makeSprite();
  // Same back-of-head block as NE (head sits at x=7..9 to match S body axis);
  // only the cheek peek flips to the opposite side.
  row(p, 15, 7, 9, PAL.musketStock);
  row(p, 16, 7, 9, PAL.musketStockShade);
  set(p, 8, 15, PAL.musketStockHi);
  // Cheek peek on viewer's left (camera-LEFT) due to opposite rotation.
  set(p, 5, 16, PAL.skinShade);
  save(p, 'anatomy/body/northwest/base.png');
}

function drawTrousersNW() {
  const p = makeSprite();
  // Leg columns x=6..9 (4 wide, centered under coat). Mirror of NE x=6..9.
  // Same range for trousers, gaiters, and row 28.
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
  save(p, 'uniform/lower/trousers/northwest.png');
}

function drawCoatNW() {
  // Mirror of NE around x=7.5: x' = 15 - x for asymmetric elements.
  const p = makeSprite();
  // Torso fill rows 17-22.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 5, 10, PAL.coatMid);
    set(p, 10, y, PAL.coatHi);   // lit side now camera-right
    set(p, 5, y, PAL.coatShade); // shaded camera-left
  }
  // Sleeve on camera-near side (viewer's right, x=11) -- mirror of NE x=4.
  set(p, 11, 17, PAL.coatHi);
  set(p, 11, 18, PAL.coatMid);
  set(p, 11, 19, PAL.coatShade);
  set(p, 11, 20, PAL.coatShade);
  // Far-side sleeve at x=4 (mirror of NE x=11).
  set(p, 4, 17, PAL.coatShade);
  set(p, 4, 18, PAL.coatDeep);
  // Backpack mirrored: x=5..8 (mirror of NE x=10..7).
  for (let y = 17; y <= 20; y++) {
    set(p, 5, y, PAL.musketStockShade); // shaded edge (mirror of NE x=10)
    set(p, 6, y, PAL.musketStock);
    set(p, 7, y, PAL.musketStockHi);
    set(p, 8, y, PAL.musketStockHi);    // lit edge (mirror of NE x=7)
  }
  // Shoulder straps mirrored.
  set(p, 8, 17, PAL.beltWhite); // mirror of NE (7, 17)
  set(p, 5, 17, PAL.beltWhite); // mirror of NE (10, 17)
  // Bottom strap (mirror of NE x=8,9 -> x=7,6).
  set(p, 7, 21, PAL.beltShade);
  set(p, 6, 21, PAL.beltShade);
  // Hem.
  row(p, 23, 5, 10, PAL.coatShade);
  set(p, 10, 23, PAL.coatDeep);
  set(p, 5, 23, PAL.coatDeep);
  save(p, 'uniform/coat-line/northwest/base.png');
}

function drawShakoNW() {
  // Mirror of NE shako. The shako body x=6..10 is symmetric around x=8 (the
  // figure's centerline), so we keep the same x range and only flip the
  // lit/shade edges. Plume stays centered at x=8.
  const p = makeSprite();
  set(p, 8, 7, PAL.plumeTip);
  set(p, 8, 8, PAL.plumeRed);
  for (let y = 9; y <= 13; y++) {
    row(p, y, 6, 10, PAL.shakoMid);
    set(p, 10, y, PAL.shakoHi);   // lit side flipped to camera-right
    set(p, 6, y, PAL.shakoShade); // shaded side flipped to camera-left
  }
  // No brass plate (back view).
  // Brim: west-leaning, overhangs only on the left.
  row(p, 14, 5, 10, PAL.shakoShade);
  save(p, 'uniform/head/shako-standard/northwest.png');
}

function drawMusketNW() {
  // Mirror of NE musket: barrel at x=12 (mirror of x=3), bayonet offset to x=11.
  const p = makeSprite();
  set(p, 11, 3, PAL.bayonetTip);
  set(p, 11, 4, PAL.bayonet);
  set(p, 11, 5, PAL.bayonet);
  set(p, 11, 6, PAL.bayonet);
  set(p, 11, 7, PAL.bayonet);
  // T-shape socket: in-line steel pixel in barrel column at bayonet base row.
  set(p, 12, 7, PAL.bayonet);
  set(p, 12, 8, PAL.musketMuzzle);
  for (let y = 9; y <= 19; y++) set(p, 12, y, PAL.musketBarrel);
  set(p, 12, 14, PAL.brass);
  set(p, 12, 20, PAL.brass);
  set(p, 13, 20, PAL.hammer);
  set(p, 12, 21, PAL.musketStockHi);
  set(p, 12, 22, PAL.musketStock);
  set(p, 11, 20, PAL.skinHi);
  save(p, 'weapon/musket/northwest/idle.png');
}

function drawNE() {
  console.log('Drawing NE facing components:');
  drawShadowNE();
  drawBodyNE();
  drawTrousersNE();
  drawCoatNE();
  drawShakoNE();
  drawMusketNE();
}

function drawNW() {
  console.log('Drawing NW facing components:');
  drawShadowNW();
  drawBodyNW();
  drawTrousersNW();
  drawCoatNW();
  drawShakoNW();
  drawMusketNW();
}

const FACINGS = process.argv.slice(2);
const all = FACINGS.length === 0;

if (all || FACINGS.includes('NE')) drawNE();
if (all || FACINGS.includes('NW')) drawNW();

console.log('\nDone.');
