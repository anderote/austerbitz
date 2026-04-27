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
  // E idle: vertical musket on the camera-side of the figure (viewer's right).
  // Butt at hip (20, 22). Mirror of S idle layout (offsets the same).
  paintMusketVertical(p, 20, 22, { flipX: true });
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
  // E firing: horizontal musket pointing east, butt heel at (13, 18).
  paintMusketHorizontal(p, 13, 18);
  return p;
}

// --- E MAKE-READY / HIT / DYING ---

const PAL_BLOOD = {
  bright: '#D13B33',
  dark:   '#7A1A22',
  pool:   '#5C1419',
};

function drawCoatEastMakeReady() {
  const p = makeSprite();
  // Same torso/belt/backpack/hem as idle.
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
  // Near arm (camera-side, x=19, lit) reaches up to grip vertical musket at
  // body centerline (x=16). Both arms cross over chest area as gun is being raised.
  set(p, 19, 17, PAL.coatHi);          // near shoulder cap
  set(p, 18, 16, PAL.coatMid);         // forearm reaching across to gun
  set(p, 17, 15, PAL.skinHi);          // near hand on forestock
  // Far arm (camera-far side at the back of the figure x=15) just shows a
  // little sleeve raised — second hand at lock height.
  set(p, 15, 17, PAL.coatShade);       // far shoulder cap
  set(p, 16, 16, PAL.skinHi);          // far hand on lock
  return p;
}

function drawMusketEastMakeReady() {
  const p = makeSprite();
  // Vertical musket at body centerline; butt at hip (16, 20).
  paintMusketVertical(p, 16, 20);
  return p;
}

function drawCoatEastHit() {
  const p = makeSprite();
  // Same torso/belt/backpack/hem as idle.
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
  // Near arm (camera-side, x=19, lit) flung forward (east).
  set(p, 19, 17, PAL.coatHi);
  set(p, 20, 17, PAL.coatHi);
  set(p, 21, 17, PAL.coatMid);
  set(p, 22, 18, PAL.skinHi);
  // Far arm hint visible at rear — flailing back.
  set(p, 14, 17, PAL.coatShade);
  set(p, 13, 17, PAL.coatShade);
  return p;
}

function drawMusketEastHit() {
  const p = makeSprite();
  // Hit-tilted leaning forward to viewer's right. flipX so the lean tilts the
  // far end out into the cell-right.
  paintMusketHitTilted(p, 17, 23, { flipX: true });
  return p;
}

function drawBloodEastHit() {
  const p = makeSprite();
  // Spray erupting east (toward viewer-right, away from facing direction = chest exit).
  // Profile chest at x=18, blood goes east (right) and forward.
  set(p, 19, 18, PAL_BLOOD.bright);
  set(p, 20, 18, PAL_BLOOD.bright);
  set(p, 19, 19, PAL_BLOOD.bright);
  set(p, 21, 18, PAL_BLOOD.dark);
  set(p, 21, 19, PAL_BLOOD.dark);
  set(p, 22, 17, PAL_BLOOD.bright);
  set(p, 22, 20, PAL_BLOOD.dark);
  set(p, 23, 19, PAL_BLOOD.dark);
  return p;
}

function drawBodyEastDying() {
  const p = makeSprite();
  // Profile face shifted +1y, head sagged.
  set(p, 16, 16, PAL.skinShade);
  set(p, 17, 16, PAL.skinDeep);
  set(p, 18, 16, PAL.skinDeep);
  set(p, 16, 17, PAL.skinHi);
  set(p, 17, 17, PAL.skinShade);
  return p;
}

function drawShakoEastDying() {
  const p = makeSprite();
  // Shifted +1 row.
  set(p, 17, 8, PAL.plumeTip);
  set(p, 17, 9, PAL.plumeRed);
  for (let y = 10; y <= 14; y++) {
    row(p, y, 15, 18, PAL.shakoMid);
    set(p, 15, y, PAL.shakoShade);
    set(p, 18, y, PAL.shakoHi);
  }
  set(p, 18, 12, PAL.brass);
  row(p, 15, 15, 19, PAL.shakoShade);
  return p;
}

function drawCoatEastDying() {
  const p = makeSprite();
  // Slumped torso shifted +1y (rows 18-23) but same column range.
  for (let y = 18; y <= 23; y++) {
    row(p, y, 15, 18, PAL.coatMid);
    set(p, 15, y, PAL.coatShade);
    set(p, 18, y, PAL.coatHi);
  }
  // Crumpled belt — just the diagonal core.
  set(p, 18, 18, PAL.beltWhite);
  set(p, 17, 19, PAL.beltWhite);
  set(p, 16, 20, PAL.beltWhite);
  set(p, 17, 21, PAL.brass);
  // Backpack still present, slid down.
  for (let y = 19; y <= 22; y++) {
    set(p, 13, y, PAL.packShade);
    set(p, 14, y, PAL.packTan);
  }
  // Coat hem row 24.
  row(p, 24, 15, 18, PAL.coatShade);
  set(p, 15, 24, PAL.coatDeep);
  set(p, 18, 24, PAL.coatDeep);
  // Near arm slumped forward (collapsing on side).
  set(p, 19, 19, PAL.coatHi);
  set(p, 20, 20, PAL.coatMid);
  set(p, 21, 21, PAL.skinHi);          // hand outstretched forward
  return p;
}

function drawTrousersEastDying() {
  const p = makeSprite();
  // Knee buckled +1y, gaiters slid lower.
  for (let y = 25; y <= 26; y++) {
    set(p, 16, y, PAL.trouserHi);
    set(p, 17, y, PAL.trouserShade);
  }
  for (let y = 27; y <= 28; y++) {
    set(p, 16, y, PAL.gaiterBlack);
    set(p, 17, y, PAL.gaiterBlack);
  }
  // One foot splayed outward (east).
  set(p, 18, 28, PAL.gaiterBlack);
  set(p, 16, 27, PAL.gaiterHi);
  return p;
}

function drawMusketEastDying() {
  const p = makeSprite();
  // Horizontal musket flat on ground, butt at viewer's left, muzzle east.
  paintMusketHorizontal(p, 17, 29);
  return p;
}

function drawBloodEastDying() {
  const p = makeSprite();
  // Pool spreading under figure.
  row(p, 30, 13, 22, PAL_BLOOD.pool);
  row(p, 29, 14, 21, PAL_BLOOD.dark);
  set(p, 14, 28, PAL_BLOOD.pool);
  set(p, 20, 28, PAL_BLOOD.pool);
  set(p, 19, 19, PAL_BLOOD.dark);
  set(p, 20, 21, PAL_BLOOD.dark);
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
  // Make-ready / hit / dying for E.
  const eCoatMR = drawCoatEastMakeReady();
  save(eCoatMR, 'uniform/coat-line/east/make-ready.png');
  const eMusketMR = drawMusketEastMakeReady();
  save(eMusketMR, 'weapon/musket/east/make-ready.png');
  const eCoatHit = drawCoatEastHit();
  save(eCoatHit, 'uniform/coat-line/east/hit.png');
  const eMusketHit = drawMusketEastHit();
  save(eMusketHit, 'weapon/musket/east/hit.png');
  const eBloodHit = drawBloodEastHit();
  save(eBloodHit, 'fx/blood/east/hit.png');
  const eBodyDying = drawBodyEastDying();
  save(eBodyDying, 'anatomy/body/east/dying.png');
  const eShakoDying = drawShakoEastDying();
  save(eShakoDying, 'uniform/head/shako-standard/east-dying.png');
  const eCoatDying = drawCoatEastDying();
  save(eCoatDying, 'uniform/coat-line/east/dying.png');
  const eTrousersDying = drawTrousersEastDying();
  save(eTrousersDying, 'uniform/lower/trousers/east-dying.png');
  const eMusketDying = drawMusketEastDying();
  save(eMusketDying, 'weapon/musket/east/dying.png');
  const eBloodDying = drawBloodEastDying();
  save(eBloodDying, 'fx/blood/east/dying.png');

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
  // W mirrored from E.
  save(mirrorHorizontal(eCoatMR), 'uniform/coat-line/west/make-ready.png');
  save(mirrorHorizontal(eMusketMR), 'weapon/musket/west/make-ready.png');
  save(mirrorHorizontal(eCoatHit), 'uniform/coat-line/west/hit.png');
  save(mirrorHorizontal(eMusketHit), 'weapon/musket/west/hit.png');
  save(mirrorHorizontal(eBloodHit), 'fx/blood/west/hit.png');
  save(mirrorHorizontal(eBodyDying), 'anatomy/body/west/dying.png');
  save(mirrorHorizontal(eShakoDying), 'uniform/head/shako-standard/west-dying.png');
  save(mirrorHorizontal(eCoatDying), 'uniform/coat-line/west/dying.png');
  save(mirrorHorizontal(eTrousersDying), 'uniform/lower/trousers/west-dying.png');
  save(mirrorHorizontal(eMusketDying), 'weapon/musket/west/dying.png');
  save(mirrorHorizontal(eBloodDying), 'fx/blood/west/dying.png');
}

drawAll();
console.log('\nDone.');
