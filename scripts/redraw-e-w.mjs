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
// 16w x 36h, 22 px tall, feet on row 28. Row layout matches S exactly:
//   7-8   plume tip (white) + plume body (red) at x=8 (E) / x=8 (W mirror)
//   9-13  shako body (4 wide x=7..10 in E)
//   14    brim (5 wide x=6..10 in E)
//   15-16 face (profile, 2 px wide, with nose hint)
//   17-22 coat torso (4 wide x=7..10 in E) + sleeve + belt + backpack
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

// Mirror an E-facing sprite horizontally around the 16-px frame center.
// For pixel x in E, the mirrored W pixel sits at (15 - x).
function mirrorHorizontal(src) {
  const dst = makeSprite();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const dx = 15 - x;
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
  row(p, 30, 5, 10, PAL.shadow, 110);
  row(p, 29, 6, 9, PAL.shadow, 70);
  return p;
}

function drawBodyEast() {
  const p = makeSprite();
  // Profile face: 2 px wide, with nose tip protruding to the right (camera-side).
  // Row 15 (forehead/eye): x=8 skinShade, x=9 skinDeep (brow + nose-bridge shadow).
  set(p, 8, 15, PAL.skinShade);
  set(p, 9, 15, PAL.skinDeep);
  // Nose tip at x=10 row 15 (1 px nub).
  set(p, 10, 15, PAL.skinDeep);
  // Row 16 (cheek/chin): x=8 skinHi, x=9 skinShade.
  set(p, 8, 16, PAL.skinHi);
  set(p, 9, 16, PAL.skinShade);
  return p;
}

function drawTrousersEast() {
  const p = makeSprite();
  // Leg columns x=8..9 (2 wide, profile leg on viewer's right).
  // Same range for trousers, gaiters, and row 28.
  for (let y = 24; y <= 25; y++) {
    set(p, 8, y, PAL.trouserHi);
    set(p, 9, y, PAL.trouserShade);
  }
  for (let y = 26; y <= 27; y++) {
    set(p, 8, y, PAL.gaiterBlack);
    set(p, 9, y, PAL.gaiterBlack);
  }
  // Edge highlight on lit side, one row.
  set(p, 8, 26, PAL.gaiterHi);
  // Single brass button for 2-wide profile.
  set(p, 9, 26, PAL.brass);
  // Row 28: square off the leg, same columns as gaiters.
  row(p, 28, 8, 9, PAL.gaiterBlack);
  return p;
}

function drawCoatEast() {
  const p = makeSprite();
  // Torso 4 wide, x=7..10, rows 17-22.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 7, 10, PAL.coatMid);
    set(p, 7, y, PAL.coatShade); // back of torso (camera-rear) shaded
    set(p, 10, y, PAL.coatHi);   // front (camera-side) lit
  }
  // Single white cartridge-box belt: over near (camera-side) shoulder
  // diagonally back to the far hip. From profile the belt is a narrow
  // diagonal sitting on the camera-side face of the torso.
  const belt = [
    [10, 17],
    [9, 18],
    [9, 19],
    [8, 20],
    [8, 21],
  ];
  for (const [x, y] of belt) set(p, x, y, PAL.beltWhite);
  // Backpack hump at BACK of soldier (camera-LEFT in E view), 2 wide, rows 18-21.
  for (let y = 18; y <= 21; y++) {
    set(p, 5, y, PAL.packShade);
    set(p, 6, y, PAL.packTan);
  }
  // Backpack strap going over the visible shoulder (1 px white at x=7 row 17).
  set(p, 7, 17, PAL.beltWhite);
  // Near arm (camera-side, lit) hangs straight down at x=11 rows 17-21.
  set(p, 11, 17, PAL.coatHi);
  set(p, 11, 18, PAL.coatHi);
  set(p, 11, 19, PAL.coatMid);
  set(p, 11, 20, PAL.coatMid);
  set(p, 11, 21, PAL.coatShade);
  // Coat hem row 23 (4 wide, matching torso).
  row(p, 23, 7, 10, PAL.coatShade);
  set(p, 7, 23, PAL.coatDeep);
  set(p, 10, 23, PAL.coatDeep);
  return p;
}

function drawShakoEast() {
  const p = makeSprite();
  // Plume at top-center of shako (shifted slightly toward viewer side).
  set(p, 9, 7, PAL.plumeTip);
  set(p, 9, 8, PAL.plumeRed);
  // Shako body 4 wide, x=7..10, rows 9-13.
  for (let y = 9; y <= 13; y++) {
    row(p, y, 7, 10, PAL.shakoMid);
    set(p, 7, y, PAL.shakoShade); // back of shako shaded
    set(p, 10, y, PAL.shakoHi);   // front of shako lit
  }
  // Brass plate on FRONT of shako (camera-side = right edge).
  set(p, 10, 11, PAL.brass);
  // Brim: east-leaning, overhangs only on the right (body x=7..10, brim x=7..11).
  row(p, 14, 7, 11, PAL.shakoShade);
  return p;
}

function drawMusketEast() {
  const p = makeSprite();
  // Vertical Brown Bess on viewer's right (camera-side of figure, x=12).
  // Socket bayonet: blade offset 1 column right of barrel axis (x=13).
  set(p, 13, 5, PAL.bayonetTip);
  set(p, 13, 6, PAL.bayonet);
  set(p, 13, 7, PAL.bayonet);
  // T-shape socket: in-line steel pixel in barrel column at bayonet base row.
  set(p, 12, 7, PAL.bayonet);
  // Muzzle / socket.
  set(p, 12, 8, PAL.musketMuzzle);
  // Barrel rows 9-19.
  for (let y = 9; y <= 19; y++) set(p, 12, y, PAL.musketBarrel);
  // Brass barrel band mid-barrel.
  set(p, 12, 14, PAL.brass);
  // Lock (brass) row 20 with hammer outboard (camera-side, to the right).
  set(p, 12, 20, PAL.brass);
  set(p, 13, 20, PAL.hammer);
  // Stock.
  set(p, 12, 21, PAL.musketStockHi);
  set(p, 12, 22, PAL.musketStock);
  // Right hand grips lock from body-side (left of barrel).
  set(p, 11, 20, PAL.skinHi);
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
}

drawAll();
console.log('\nDone.');
