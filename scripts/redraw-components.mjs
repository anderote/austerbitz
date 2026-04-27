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
import {
  paintMusketVertical,
  paintMusketHorizontal,
  paintMusketHitTilted,
} from './lib/musket-shapes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COMPONENTS = resolve(ROOT, 'public/sprites/components');

const W = 32;
const H = 36;

// Marker-color palette for the 3-slot regiment recolor system.
// Coat -> primary (magenta family). Belts/trousers -> secondary (cyan family).
// Shako/gaiters -> tertiary (yellow family). Skin/brass/wood/steel/plume stay literal.
// The runtime shader and editor recolor pass detect these families by channel
// dominance and remap to the active regiment's slot color, scaled by a brightness
// factor (mid -> 1.0x, hi -> ~1.25x, shade -> ~0.62x, deep -> ~0.31x).
const PAL = {
  shadow: '#000000',
  skinHi: '#F0CDA0',
  skinShade: '#C49072',
  skinDeep: '#A87651',
  // Tertiary (yellow family) — shako was very dark, so map to deep/shade yellow.
  shakoMid: '#505000',   // yellow deep
  shakoHi: '#A0A000',    // yellow shade
  shakoShade: '#505000', // yellow deep
  brass: '#F5B044',
  plumeTip: '#EDE8DA',
  plumeRed: '#D13B33',
  // Primary (magenta family) — coat.
  coatMid: '#FF00FF',   // magenta mid
  coatHi: '#FF80FF',    // magenta hi
  coatShade: '#A000A0', // magenta shade
  coatDeep: '#500050',  // magenta deep
  // Secondary (cyan family) — cross-belts (very high value cream -> hi/mid cyan).
  beltWhite: '#80FFFF', // cyan hi
  beltShade: '#00FFFF', // cyan mid
  // Secondary (cyan family) — trousers/breeches.
  trouserMid: '#00FFFF',   // cyan mid
  trouserHi: '#80FFFF',    // cyan hi
  trouserShade: '#00A0A0', // cyan shade
  // Tertiary (yellow family) — gaiters/boots (very dark -> deep yellow).
  gaiterBlack: '#505000', // yellow deep
  gaiterHi: '#A0A000',    // yellow shade
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
  // S idle: vertical musket alongside the body, butt at hip (11, 22).
  paintMusketVertical(p, 11, 22);
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
  // Vertical musket on body centerline, butt at hip (16, 20).
  paintMusketVertical(p, 16, 20);
  save(p, 'weapon/musket/south/make-ready.png');
}

function drawMusketSouthPresent() {
  const p = makeSprite();
  // Vertical musket pointed DOWN (flipY) -- butt at chest (16, 17).
  paintMusketVertical(p, 16, 17, { flipY: true });
  save(p, 'weapon/musket/south/present.png');
}

function drawMusketSouthFire() {
  const p = makeSprite();
  paintMusketVertical(p, 16, 17, { flipY: true });
  save(p, 'weapon/musket/south/fire.png');
}

// --- HIT (impact moment, body upright but jolted) ---

const PAL_BLOOD = {
  bright: '#D13B33',
  dark:   '#7A1A22',
  pool:   '#5C1419',
};

function drawCoatSouthHit() {
  const p = makeSprite();
  // Same torso/belts/hem as idle.
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
  // Right arm (viewer's left) flung outward in shock.
  set(p, 12, 17, PAL.coatHi);          // shoulder cap
  set(p, 11, 17, PAL.coatHi);          // bicep flung out
  set(p, 10, 17, PAL.coatMid);         // forearm extended
  set(p, 9, 18, PAL.skinHi);           // hand splayed
  // Left arm (viewer's right) limp at side, sleeve hanging.
  set(p, 19, 17, PAL.coatShade);
  set(p, 20, 18, PAL.coatShade);
  set(p, 20, 19, PAL.coatMid);
  set(p, 21, 20, PAL.skinHi);          // hand released musket
  save(p, 'uniform/coat-line/south/hit.png');
}

function drawMusketSouthHit() {
  const p = makeSprite();
  // Hit-tilted (slight rightward lean), butt heel at (14, 23).
  paintMusketHitTilted(p, 14, 23);
  save(p, 'weapon/musket/south/hit.png');
}

function drawBloodSouthHit() {
  const p = makeSprite();
  // Spray erupting south (toward viewer) from chest. Bright core near impact,
  // darker droplets trailing further out and down.
  set(p, 16, 19, PAL.brass);           // dummy — overpaint by buckle? actually no, this is fx layer
  // Reset that — fx layer should only be blood.
  for (let i = 0; i < p.data.length; i++) p.data[i] = 0;
  // Core impact spray on chest.
  set(p, 16, 18, PAL_BLOOD.bright);
  set(p, 15, 19, PAL_BLOOD.bright);
  set(p, 17, 19, PAL_BLOOD.bright);
  // Droplets radiating out.
  set(p, 14, 20, PAL_BLOOD.dark);
  set(p, 18, 20, PAL_BLOOD.dark);
  set(p, 13, 21, PAL_BLOOD.bright);
  set(p, 19, 22, PAL_BLOOD.dark);
  // A trailing droplet behind torso (north).
  set(p, 16, 16, PAL_BLOOD.dark);
  set(p, 12, 18, PAL_BLOOD.dark);
  save(p, 'fx/blood/south/hit.png');
}

// --- DYING (collapsed) ---

function drawBodySouthDying() {
  const p = makeSprite();
  // Head sagged forward and down 1px — face blob at rows 16-17 (was 15-16).
  set(p, 15, 16, PAL.skinShade);
  set(p, 16, 16, PAL.skinShade);
  set(p, 17, 16, PAL.skinDeep);
  set(p, 15, 17, PAL.skinHi);
  set(p, 16, 17, PAL.skinHi);
  set(p, 17, 17, PAL.skinShade);
  save(p, 'anatomy/body/south/dying.png');
}

function drawShakoSouthDying() {
  const p = makeSprite();
  // Shako tilted forward — shifted +1 row (plume sags, brim lower).
  set(p, 16, 8, PAL.plumeTip);
  set(p, 16, 9, PAL.plumeRed);
  for (let y = 10; y <= 14; y++) {
    row(p, y, 14, 18, PAL.shakoMid);
    set(p, 14, y, PAL.shakoHi);
    set(p, 18, y, PAL.shakoShade);
  }
  set(p, 16, 12, PAL.brass);
  row(p, 15, 13, 18, PAL.shakoShade);
  set(p, 13, 15, PAL.shakoMid);
  save(p, 'uniform/head/shako-standard/south-dying.png');
}

function drawCoatSouthDying() {
  const p = makeSprite();
  // Slumped torso: collapsed, hem lower (rows 18-24 instead of 17-23), shoulders
  // dropped. Fewer distinct rows = compressed silhouette.
  for (let y = 18; y <= 23; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  // Crumpled crossbelts (just the X core remains).
  set(p, 14, 19, PAL.beltWhite);
  set(p, 17, 19, PAL.beltWhite);
  set(p, 15, 20, PAL.beltWhite);
  set(p, 16, 20, PAL.beltWhite);
  set(p, 16, 21, PAL.brass);
  // Coat hem row 24.
  row(p, 24, 13, 18, PAL.coatShade);
  set(p, 13, 24, PAL.coatDeep);
  set(p, 18, 24, PAL.coatDeep);
  // Right arm (viewer's left) bent inward, hand clutching chest.
  set(p, 12, 19, PAL.coatHi);          // right shoulder cap
  set(p, 13, 20, PAL.coatMid);         // bicep angling in
  set(p, 14, 21, PAL.coatMid);         // forearm crossing chest
  set(p, 15, 21, PAL.skinHi);          // hand clutching chest
  // Left arm (viewer's right) flung out wide.
  set(p, 19, 19, PAL.coatShade);       // left shoulder cap
  set(p, 20, 19, PAL.coatShade);       // bicep extending out
  set(p, 21, 20, PAL.coatMid);         // upper arm
  set(p, 22, 20, PAL.coatMid);         // forearm
  set(p, 23, 21, PAL.skinHi);          // hand flung out
  save(p, 'uniform/coat-line/south/dying.png');
}

function drawTrousersSouthDying() {
  const p = makeSprite();
  // Buckled legs splayed slightly outward, gaiters at row 27 (one row lower).
  for (let y = 25; y <= 26; y++) {
    set(p, 14, y, PAL.trouserHi);
    set(p, 15, y, PAL.trouserMid);
    set(p, 16, y, PAL.trouserMid);
    set(p, 17, y, PAL.trouserShade);
  }
  for (let y = 27; y <= 28; y++) {
    set(p, 13, y, PAL.gaiterBlack);    // splayed left
    set(p, 14, y, PAL.gaiterBlack);
    set(p, 17, y, PAL.gaiterBlack);
    set(p, 18, y, PAL.gaiterBlack);    // splayed right
  }
  set(p, 13, 27, PAL.gaiterHi);
  save(p, 'uniform/lower/trousers/south-dying.png');
}

function drawMusketSouthDying() {
  const p = makeSprite();
  // Musket thrown out to viewer's right, lying flat on the ground.
  paintMusketHorizontal(p, 17, 29);
  save(p, 'weapon/musket/south/dying.png');
}

function drawBloodSouthDying() {
  const p = makeSprite();
  // Pool spreading under figure (rows 28-30), wider than the ground shadow.
  row(p, 30, 11, 21, PAL_BLOOD.pool);
  row(p, 29, 12, 20, PAL_BLOOD.dark);
  set(p, 13, 28, PAL_BLOOD.pool);
  set(p, 19, 28, PAL_BLOOD.pool);
  // A few stray droplets from impact still on chest.
  set(p, 16, 19, PAL_BLOOD.dark);
  set(p, 15, 21, PAL_BLOOD.dark);
  save(p, 'fx/blood/south/dying.png');
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
  drawCoatSouthHit();
  drawMusketSouthHit();
  drawBloodSouthHit();
  drawBodySouthDying();
  drawShakoSouthDying();
  drawCoatSouthDying();
  drawTrousersSouthDying();
  drawMusketSouthDying();
  drawBloodSouthDying();
}

const FACINGS = process.argv.slice(2);
const all = FACINGS.length === 0;

if (all || FACINGS.includes('S')) drawSouth();

console.log('\nDone.');
