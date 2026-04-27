#!/usr/bin/env node
// Hand-painted chibi pixel components for the British line infantry kit:
// E (east) and W (west) facings. Pure side-profile, mirror pair.
//
// Profile views are visually distinct from S/front:
//   - Narrower silhouette (torso 4 wide, x=7..10).
//   - Asymmetric belt: only ONE diagonal cartridge-box belt visible
//     (over near shoulder, down to far hip).
//   - Backpack hump visible at the BACK of the soldier (camera-rear).
//   - Only the near arm visible; far arm hidden behind body.
//   - Single visible leg (legs aligned in profile).
//   - Musket vertical, held in front of body on the camera-side.
//
// 32w x 36h, 22 px tall, feet on row 28. Row layout matches S exactly:
// (coords below shifted +8 from original 16-wide layout to keep figure centered.)
//   7-8   plume tip (white) + plume body (red) at x=16 (E) / x=16 (W mirror)
//   9-13  shako body (4 wide x=15..18 in E)
//   14    brim (5 wide x=14..18 in E)
//   15-16 face (profile, 2 px wide, with nose hint)
//   17-22 coat torso (4 wide x=15..18 in E) + sleeve + belt + backpack
//   23    coat hem (4 wide)
//   24-25 trousers
//   26-27 gaiters
//   28    boots
//   29-30 ground shadow

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
  packTan: '#8B6F4A',
  packShade: '#5E4A30',
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

// Clear pixel(s) by setting alpha=0.
function clearPixel(p, x, y) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  p.data[i + 0] = 0;
  p.data[i + 1] = 0;
  p.data[i + 2] = 0;
  p.data[i + 3] = 0;
}

// Mirror an E-facing sprite horizontally around the 32-px frame center.
// For pixel x in E, the mirrored W pixel sits at (31 - x).
function mirrorHorizontal(src) {
  const dst = makeSprite();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const dx = 31 - x;
      const di = (y * W + dx) * 4;
      dst.data[di + 0] = src.data[si + 0];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

// --- EAST (soldier facing camera-right) ---

function drawShadowEast() {
  const p = makeSprite();
  // Slightly narrower than S, since profile silhouette is narrower.
  row(p, 30, 13, 18, PAL.shadow, 110);
  row(p, 29, 14, 17, PAL.shadow, 70);
  return p;
}

function drawBodyEast() {
  const p = makeSprite();
  // Profile face: 2 px wide, with nose tip protruding to the right (camera-side).
  // Row 15 (forehead/eye): x=16 skinShade, x=17 skinDeep (brow + nose-bridge shadow).
  set(p, 16, 15, PAL.skinShade);
  set(p, 17, 15, PAL.skinDeep);
  // Nose tip at x=18 row 15 (1 px nub).
  set(p, 18, 15, PAL.skinDeep);
  // Row 16 (cheek/chin): x=16 skinHi, x=17 skinShade.
  set(p, 16, 16, PAL.skinHi);
  set(p, 17, 16, PAL.skinShade);
  return p;
}

function drawTrousersEast() {
  const p = makeSprite();
  // Leg columns x=16..17 (2 wide, profile leg on viewer's right).
  // Same range for trousers, gaiters, and row 28.
  for (let y = 24; y <= 25; y++) {
    set(p, 16, y, PAL.trouserHi);
    set(p, 17, y, PAL.trouserShade);
  }
  for (let y = 26; y <= 27; y++) {
    set(p, 16, y, PAL.gaiterBlack);
    set(p, 17, y, PAL.gaiterBlack);
  }
  // Edge highlight on lit side, one row.
  set(p, 16, 26, PAL.gaiterHi);
  // Single brass button for 2-wide profile.
  set(p, 17, 26, PAL.brass);
  // Row 28: square off the leg, same columns as gaiters.
  row(p, 28, 16, 17, PAL.gaiterBlack);
  return p;
}

function drawCoatEast() {
  const p = makeSprite();
  // Torso 4 wide, x=15..18, rows 17-22.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 15, 18, PAL.coatMid);
    set(p, 15, y, PAL.coatShade); // back of torso (camera-rear) shaded
    set(p, 18, y, PAL.coatHi);   // front (camera-side) lit
  }
  // Single white cartridge-box belt: over near (camera-side) shoulder
  // diagonally back to the far hip. From profile the belt is a narrow
  // diagonal sitting on the camera-side face of the torso.
  const belt = [
    [18, 17],
    [17, 18],
    [17, 19],
    [16, 20],
    [16, 21],
  ];
  for (const [x, y] of belt) set(p, x, y, PAL.beltWhite);
  // Backpack hump at BACK of soldier (camera-LEFT in E view), 2 wide, rows 18-21.
  for (let y = 18; y <= 21; y++) {
    set(p, 13, y, PAL.packShade);
    set(p, 14, y, PAL.packTan);
  }
  // Backpack strap going over the visible shoulder (1 px white at x=15 row 17).
  set(p, 15, 17, PAL.beltWhite);
  // Near arm (camera-side, lit) hangs straight down at x=19 rows 17-21.
  set(p, 19, 17, PAL.coatHi);
  set(p, 19, 18, PAL.coatHi);
  set(p, 19, 19, PAL.coatMid);
  set(p, 19, 20, PAL.coatMid);
  set(p, 19, 21, PAL.coatShade);
  // Coat hem row 23 (4 wide, matching torso).
  row(p, 23, 15, 18, PAL.coatShade);
  set(p, 15, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  return p;
}

function drawShakoEast() {
  const p = makeSprite();
  // Plume at top-center of shako (shifted slightly toward viewer side).
  set(p, 17, 7, PAL.plumeTip);
  set(p, 17, 8, PAL.plumeRed);
  // Shako body 4 wide, x=15..18, rows 9-13.
  for (let y = 9; y <= 13; y++) {
    row(p, y, 15, 18, PAL.shakoMid);
    set(p, 15, y, PAL.shakoShade); // back of shako shaded
    set(p, 18, y, PAL.shakoHi);   // front of shako lit
  }
  // Brass plate on FRONT of shako (camera-side = right edge).
  set(p, 18, 11, PAL.brass);
  // Brim: east-leaning, overhangs only on the right (body x=15..18, brim x=15..19).
  row(p, 14, 15, 19, PAL.shakoShade);
  return p;
}

function drawMusketEast() {
  const p = makeSprite();
  // Vertical Brown Bess on viewer's right (camera-side of figure, x=20).
  // Socket bayonet: blade offset 1 column right of barrel axis (x=21).
  set(p, 21, 3, PAL.bayonetTip);
  set(p, 21, 4, PAL.bayonet);
  set(p, 21, 5, PAL.bayonet);
  set(p, 21, 6, PAL.bayonet);
  set(p, 21, 7, PAL.bayonet);
  // T-shape socket: in-line steel pixel in barrel column at bayonet base row.
  set(p, 20, 7, PAL.bayonet);
  // Muzzle / socket.
  set(p, 20, 8, PAL.musketMuzzle);
  // Barrel rows 9-19.
  for (let y = 9; y <= 19; y++) set(p, 20, y, PAL.musketBarrel);
  // Brass barrel band mid-barrel.
  set(p, 20, 14, PAL.brass);
  // Lock (brass) row 20 with hammer outboard (camera-side, to the right).
  set(p, 20, 20, PAL.brass);
  set(p, 21, 20, PAL.hammer);
  // Stock.
  set(p, 20, 21, PAL.musketStockHi);
  set(p, 20, 22, PAL.musketStock);
  // Right hand grips lock from body-side (left of barrel).
  set(p, 19, 20, PAL.skinHi);
  return p;
}

// --- FIRING POSE (E) ---
// Horizontal musket at chest height, pointed east (right). Butt extends just
// past the body's back (viewer's left), bayonet projects past viewer's right.
// Both arms reach forward to grip the gun (front arm at the forestock, rear
// arm crossing torso to butt).

function drawCoatEastFiring() {
  const p = makeSprite();
  // Same torso/hem/backpack as idle.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 15, 18, PAL.coatMid);
    set(p, 15, y, PAL.coatShade);
    set(p, 18, y, PAL.coatHi);
  }
  const belt = [[18, 17], [17, 18], [17, 19], [16, 20], [16, 21]];
  for (const [x, y] of belt) set(p, x, y, PAL.beltWhite);
  for (let y = 18; y <= 21; y++) {
    set(p, 13, y, PAL.packShade);
    set(p, 14, y, PAL.packTan);
  }
  set(p, 15, 17, PAL.beltWhite);
  row(p, 23, 15, 18, PAL.coatShade);
  set(p, 15, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  // Front arm extended forward at chest level to grip the forestock.
  set(p, 19, 17, PAL.coatHi);     // front shoulder cap
  set(p, 20, 17, PAL.coatHi);     // bicep
  set(p, 21, 17, PAL.coatMid);    // forearm
  set(p, 22, 17, PAL.skinHi);     // hand on forestock (above barrel)
  // Rear arm crossing the torso to grip the butt at the rear shoulder.
  set(p, 15, 17, PAL.coatShade);   // rear shoulder cap (overrides strap)
  set(p, 14, 17, PAL.coatShade);   // bicep reaching back to butt
  return p;
}

function drawMusketEastFiring() {
  const p = makeSprite();
  // Horizontal Brown Bess along row 18, butt at viewer's left, bayonet at right.
  set(p, 13, 18, PAL.musketStockHi);   // butt extension outboard
  set(p, 14, 18, PAL.musketStock);     // butt
  set(p, 15, 18, PAL.brass);           // lock plate
  for (let x = 16; x <= 20; x++) set(p, x, 18, PAL.musketBarrel);
  set(p, 18, 18, PAL.brass);          // brass barrel band
  set(p, 21, 18, PAL.musketMuzzle);   // muzzle
  set(p, 22, 18, PAL.bayonet);        // bayonet blade
  set(p, 23, 18, PAL.bayonetTip);     // bayonet tip
  return p;
}

// --- WRITE ALL ---

function drawAll() {
  console.log('Drawing E facing components:');
  const eShadow = drawShadowEast();
  save(eShadow, 'shadow/east/default.png');
  const eBody = drawBodyEast();
  save(eBody, 'anatomy/body/east/base.png');
  const eTrousers = drawTrousersEast();
  save(eTrousers, 'uniform/lower/trousers/east.png');
  const eCoat = drawCoatEast();
  save(eCoat, 'uniform/coat-line/east/base.png');
  const eShako = drawShakoEast();
  save(eShako, 'uniform/head/shako-standard/east.png');
  const eMusket = drawMusketEast();
  save(eMusket, 'weapon/musket/east/idle.png');
  const eCoatFire = drawCoatEastFiring();
  save(eCoatFire, 'uniform/coat-line/east/present.png');
  save(eCoatFire, 'uniform/coat-line/east/fire.png');
  const eMusketFire = drawMusketEastFiring();
  save(eMusketFire, 'weapon/musket/east/present.png');
  save(eMusketFire, 'weapon/musket/east/fire.png');

  console.log('Drawing W facing components (mirrored from E):');
  save(mirrorHorizontal(eShadow), 'shadow/west/default.png');
  save(mirrorHorizontal(eBody), 'anatomy/body/west/base.png');
  // W trousers: mirror handles legs correctly. E legs at x=8..9 mirror to
  // W legs at x=6..7 (2 wide, profile leg on viewer's left). Row 28 is
  // just the squared-off leg base, no wider boot strip.
  save(mirrorHorizontal(eTrousers), 'uniform/lower/trousers/west.png');
  save(mirrorHorizontal(eCoat), 'uniform/coat-line/west/base.png');
  save(mirrorHorizontal(eShako), 'uniform/head/shako-standard/west.png');
  save(mirrorHorizontal(eMusket), 'weapon/musket/west/idle.png');
  save(mirrorHorizontal(eCoatFire), 'uniform/coat-line/west/present.png');
  save(mirrorHorizontal(eCoatFire), 'uniform/coat-line/west/fire.png');
  save(mirrorHorizontal(eMusketFire), 'weapon/musket/west/present.png');
  save(mirrorHorizontal(eMusketFire), 'weapon/musket/west/fire.png');
}

drawAll();
console.log('\nDone.');
