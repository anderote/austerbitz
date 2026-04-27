#!/usr/bin/env node
// Hand-painted chibi pixel components for the British line infantry kit.
// Each call writes one 32x36 RGBA PNG with transparent background.
// (coords below shifted +8 from original 16-wide layout to keep figure centered.)
//
// S-facing row layout (32w x 36h) -- chibi grenadier, port arms pose:
//   7     plume tip white at x=8
//   8     plume body red at x=8
//   9-13  shako body (5 rows tall, 5 wide x=6..10) -- grenadier height
//   14    brim (7 wide, dark)
//   15-16 face -- 6 px skin blob, no features
//   17    shoulder line (top of coat, sleeves caps, X-belt start)
//   17-22 coat torso (6 rows) w/ X-belts; right sleeve hangs at x=4 rows 17-19
//   23    coat hem (darker)
//   24-25 trousers (split legs)
//   26-27 gaiters (brass buttons row 26)
//   28    boots
//   29-30 ground shadow (semi-alpha)
//
// Musket runs DIAGONAL across the body (port arms): stock at lower-left
// (3,22) -> (4,21) -> lock at (5,20) -> barrel rises across chest to
// muzzle (12,13) -> bayonet up-right to (14,10). Brass band mid-barrel.
// Right hand grips at (4,20) beside the lock; left hand grips mid-barrel
// at (10,15).
//
// Bayonet rule (idle pose, all 8 facings): 5 px of blade in the offset
// bayonet column (1 tip + 4 mid) plus 1 in-line steel pixel in the barrel
// column at the bayonet base row (T-shape socket; no diagonal jog). For S
// idle the blade occupies (4, rows 3-7) -- tip at row 3, mid at rows 4-7 --
// with the in-line socket pixel at (3,7) and muzzle at (3,8).

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

// --- SOUTH ---

function drawShadowSouth() {
  const p = makeSprite();
  row(p, 30, 12, 19, PAL.shadow, 110);
  row(p, 29, 13, 18, PAL.shadow, 70);
  save(p, 'shadow/south/default.png');
}

function drawBodySouth() {
  const p = makeSprite();
  // 6-px face blob (3 wide x 2 tall), x=15..17, rows 15-16. No features.
  set(p, 15, 15, PAL.skinShade);
  set(p, 16, 15, PAL.skinShade);
  set(p, 17, 15, PAL.skinDeep);
  set(p, 15, 16, PAL.skinHi);
  set(p, 16, 16, PAL.skinHi);
  set(p, 17, 16, PAL.skinShade);
  save(p, 'anatomy/body/south/base.png');
}

function drawTrousersSouth() {
  const p = makeSprite();
  // Leg columns x=14..17 (4 wide, centered under coat). Same range for trousers, gaiters, row 28.
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
  // Brass buttons on inner two columns of leg block.
  set(p, 15, 26, PAL.brass);
  set(p, 16, 26, PAL.brass);
  // Row 28: square off the leg, same columns as gaiters.
  row(p, 28, 14, 17, PAL.gaiterBlack);
  save(p, 'uniform/lower/trousers/south.png');
}

function drawCoatSouth() {
  const p = makeSprite();
  // Torso fill rows 17-22 (6 rows).
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  // White X-crossbelts on rows 17-22.
  const belt1 = [[13, 17], [14, 18], [15, 19], [16, 20], [17, 21], [18, 22]];
  const belt2 = [[18, 17], [17, 18], [16, 19], [15, 20], [14, 21], [13, 22]];
  for (const [x, y] of belt1) set(p, x, y, PAL.beltWhite);
  for (const [x, y] of belt2) set(p, x, y, PAL.beltWhite);
  // Brass buckle/plate at chest center.
  set(p, 16, 19, PAL.brass);
  // Right sleeve (viewer's left, lit side) hangs straight down x=12 rows 17-19.
  set(p, 12, 17, PAL.coatHi);
  set(p, 12, 18, PAL.coatMid);
  set(p, 12, 19, PAL.coatShade);
  // Left sleeve (viewer's right, shaded side) hangs straight down x=19.
  set(p, 19, 17, PAL.coatShade);
  set(p, 19, 18, PAL.coatShade);
  set(p, 19, 19, PAL.coatMid);
  set(p, 19, 20, PAL.coatMid);
  set(p, 19, 21, PAL.coatDeep);
  // Coat hem row 23.
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  save(p, 'uniform/coat-line/south/base.png');
}

function drawShakoSouth() {
  const p = makeSprite();
  set(p, 16, 7, PAL.plumeTip);
  set(p, 16, 8, PAL.plumeRed);
  for (let y = 9; y <= 13; y++) {
    row(p, y, 14, 18, PAL.shakoMid);
    set(p, 14, y, PAL.shakoHi);
    set(p, 18, y, PAL.shakoShade);
  }
  set(p, 16, 11, PAL.brass);
  // Brim overhangs only the LEFT side for S (one-side preferring rule).
  row(p, 14, 13, 18, PAL.shakoShade);
  set(p, 13, 14, PAL.shakoMid);
  save(p, 'uniform/head/shako-standard/south.png');
}

function drawMusketSouth() {
  const p = makeSprite();
  // Vertical musket along x=11 (soldier's right side, viewer's left).
  // Socket bayonet: blade offset 1 column right (x=12) from barrel axis (x=11),
  // attached via the socket that wraps around the muzzle.
  set(p, 12, 3, PAL.bayonetTip);     // bayonet tip (offset right of barrel)
  set(p, 12, 4, PAL.bayonet);
  set(p, 12, 5, PAL.bayonet);
  set(p, 12, 6, PAL.bayonet);
  set(p, 12, 7, PAL.bayonet);
  // Socket transition: in-line steel pixel in the barrel column at bayonet base
  // so both columns have steel at row 7 (forms T-shape socket; no diagonal jog).
  set(p, 11, 7, PAL.bayonet);
  // Muzzle / socket: barrel column at x=11.
  set(p, 11, 8, PAL.musketMuzzle);   // muzzle (top of barrel, darkest)
  // Barrel rows 9-19 (long brown column, Brown Bess).
  for (let y = 9; y <= 19; y++) set(p, 11, y, PAL.musketBarrel);
  // Brass barrel band (mid-barrel accent at chest height).
  set(p, 11, 14, PAL.brass);
  // Lock (brass) row 20 with hammer outboard.
  set(p, 11, 20, PAL.brass);
  set(p, 10, 20, PAL.hammer);
  // Stock (small): 2 wood pixels.
  set(p, 11, 21, PAL.musketStockHi);
  set(p, 11, 22, PAL.musketStock);
  // Right hand grips the lock from the body side.
  set(p, 12, 20, PAL.skinHi);
  save(p, 'weapon/musket/south/idle.png');
}

// --- SOUTH FIRING POSES ---
//
// Pose layout reference (S, 16x36). All pose-invariant layers (shadow, body,
// trousers, shako) are unchanged; only the coat (sleeves) and musket move.
//
//   make-ready: musket vertical at body centerline (x=8), both hands up.
//     - right sleeve diagonally up to forestock grip near (7,15)
//     - left sleeve up to lock-height grip near (9,18)
//     - musket vertical x=8 rows 5..18, hammer cocked back at (7,17)
//
//   present: musket angled forward-right ~30deg from vertical.
//     - butt tucked at (11,18); barrel runs to bayonet base (2,9); bayonet tip (1,7)
//     - right elbow flared at (11,18) with forearm up-right to (12,15)
//     - left arm forward at row 17-18 with hand at (10,15)
//
//   fire: same skeleton as present, but every drawn pixel y-shifted by -1
//     (recoil hop). Muzzle-flash fx layer adds a bright burst near the bayonet
//     base, just off the muzzle.

function drawCoatSouthMakeReady() {
  const p = makeSprite();
  // Torso fill rows 17-22 (unchanged from idle).
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  // White X-crossbelts (unchanged).
  const belt1 = [[13, 17], [14, 18], [15, 19], [16, 20], [17, 21], [18, 22]];
  const belt2 = [[18, 17], [17, 18], [16, 19], [15, 20], [14, 21], [13, 22]];
  for (const [x, y] of belt1) set(p, x, y, PAL.beltWhite);
  for (const [x, y] of belt2) set(p, x, y, PAL.beltWhite);
  set(p, 16, 19, PAL.brass);
  // Coat hem.
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  // Right sleeve (viewer's left, lit) lifted up across chest to forestock grip.
  // From shoulder cap at (13,17) angling up-right to grip near (15,15).
  set(p, 13, 17, PAL.coatHi);          // shoulder cap (lit)
  set(p, 14, 16, PAL.coatMid);         // upper arm rising
  set(p, 15, 15, PAL.coatHi);          // forearm/hand near forestock
  // Left sleeve (viewer's right, shaded) rises to thumb hammer at lock height.
  // From shoulder cap at (18,17) angling up-right to lock grip near (17,18).
  // Stays close to torso; gives a "thumb-cocking" silhouette.
  set(p, 18, 17, PAL.coatShade);      // shoulder cap (shaded)
  set(p, 18, 18, PAL.coatShade);
  set(p, 17, 18, PAL.coatMid);         // forearm crossing to lock area (under belt)
  save(p, 'uniform/coat-line/south/make-ready.png');
}

function paintFiringCoat(p) {
  // Shared coat geometry for present + fire poses. Soldier facing the camera
  // with musket pointed south (downward). Both arms reach inward to grip
  // the vertical musket centered on the body axis.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  const belt1 = [[13, 17], [14, 18], [15, 19], [16, 20], [17, 21], [18, 22]];
  const belt2 = [[18, 17], [17, 18], [16, 19], [15, 20], [14, 21], [13, 22]];
  for (const [x, y] of belt1) set(p, x, y, PAL.beltWhite);
  for (const [x, y] of belt2) set(p, x, y, PAL.beltWhite);
  set(p, 16, 19, PAL.brass);
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  // Right arm reaching to butt at chest center.
  set(p, 12, 17, PAL.coatHi);          // shoulder cap outboard
  set(p, 14, 18, PAL.coatMid);         // forearm crossing inward toward butt
  set(p, 15, 18, PAL.skinHi);          // right hand on butt
  // Left arm dropping to forestock grip lower on the barrel.
  set(p, 19, 17, PAL.coatShade);      // shoulder cap outboard
  set(p, 18, 19, PAL.coatMid);        // forearm dropping
  set(p, 18, 20, PAL.coatMid);        // forearm continuing
  set(p, 17, 21, PAL.skinHi);          // left hand on forestock
}

function drawCoatSouthPresent() {
  const p = makeSprite();
  paintFiringCoat(p);
  save(p, 'uniform/coat-line/south/present.png');
}

function drawCoatSouthFire() {
  const p = makeSprite();
  paintFiringCoat(p);
  save(p, 'uniform/coat-line/south/fire.png');
}

function drawMusketSouthMakeReady() {
  const p = makeSprite();
  // Vertical musket along x=16 (body centerline), rows 5-18.
  // Bayonet at x=16 rows 2-4 (offset above muzzle, no socket cheat: aimed up).
  set(p, 16, 2, PAL.bayonetTip);
  set(p, 16, 3, PAL.bayonet);
  set(p, 16, 4, PAL.bayonet);
  // Muzzle (top of barrel, dark).
  set(p, 16, 5, PAL.musketMuzzle);
  // Barrel rows 6-18 brown.
  for (let y = 6; y <= 18; y++) set(p, 16, y, PAL.musketBarrel);
  // Brass barrel band mid-shaft.
  set(p, 16, 12, PAL.brass);
  // Hammer cocked back at (15,17) just outboard of the lock.
  set(p, 15, 17, PAL.hammer);
  // Stock pixels at the butt end below the lock.
  set(p, 16, 19, PAL.musketStockHi);
  set(p, 16, 20, PAL.musketStock);
  save(p, 'weapon/musket/south/make-ready.png');
}

function paintFiringMusket(p) {
  // Vertical musket pointed south (down). Centered on body axis (x=16),
  // butt at chest, muzzle/bayonet projecting past the figure feet.
  set(p, 16, 17, PAL.musketStock);     // butt top
  set(p, 16, 18, PAL.musketStock);     // butt
  set(p, 16, 19, PAL.brass);           // lock at hip
  for (let y = 20; y <= 26; y++) set(p, 16, y, PAL.musketBarrel);
  set(p, 16, 23, PAL.brass);           // brass barrel band
  set(p, 16, 27, PAL.musketMuzzle);    // muzzle
  set(p, 16, 28, PAL.bayonet);
  set(p, 16, 29, PAL.bayonetTip);      // bayonet tip past the feet
}

function drawMusketSouthPresent() {
  const p = makeSprite();
  paintFiringMusket(p);
  save(p, 'weapon/musket/south/present.png');
}

function drawMusketSouthFire() {
  const p = makeSprite();
  paintFiringMusket(p);
  save(p, 'weapon/musket/south/fire.png');
}

function drawSouth() {
  console.log('Drawing S facing components:');
  drawShadowSouth();
  drawBodySouth();
  drawTrousersSouth();
  drawCoatSouth();
  drawShakoSouth();
  drawMusketSouth();
  drawCoatSouthMakeReady();
  drawCoatSouthPresent();
  drawCoatSouthFire();
  drawMusketSouthMakeReady();
  drawMusketSouthPresent();
  drawMusketSouthFire();
}

const FACINGS = process.argv.slice(2);
const all = FACINGS.length === 0;

if (all || FACINGS.includes('S')) drawSouth();

console.log('\nDone.');
