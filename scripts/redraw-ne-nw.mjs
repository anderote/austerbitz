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
//
// Shadows are drawn separately by the runtime shadow-projection shader, so no
// shadow rows are baked into these component sprites.
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

// Mirror an NE-facing sprite horizontally around the cell vertical axis.
// For pixel x in NE, the mirrored NW pixel sits at (31 - x).
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

// --- NORTHEAST (3/4 back, soldier rotated right; viewer sees soldier's right side on camera-LEFT) ---

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
  const p = makeSprite();
  // NE idle: vertical musket on camera-near side (viewer's left). Butt (11, 22).
  paintMusketVertical(p, 11, 22);
  // Hand grips lock from the body side.
  set(p, 12, 20, PAL.skinHi);
  save(p, 'weapon/musket/northeast/idle.png');
}

// --- NORTHWEST (mirror of NE around x=7.5; x' = 15 - x) ---

function drawBodyNW() {
  const p = makeSprite();
  // Same back-of-head block as NE (head sits at x=15..17 to match S body axis);
  // only the cheek peek flips to the opposite side.
  row(p, 15, 15, 17, PAL.musketStock);
  row(p, 16, 15, 17, PAL.musketStockShade);
  set(p, 16, 15, PAL.musketStockHi);
  // Cheek peek on viewer's left (camera-LEFT) due to opposite rotation.
  set(p, 13, 16, PAL.skinShade);
  save(p, 'anatomy/body/northwest/base.png');
}

function drawTrousersNW() {
  const p = makeSprite();
  // Leg columns x=14..17 (4 wide, centered under coat). Mirror of NE x=14..17.
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
  save(p, 'uniform/lower/trousers/northwest.png');
}

function drawCoatNW() {
  // Mirror of NE around x=15.5: x' = 31 - x for asymmetric elements.
  const p = makeSprite();
  // Torso fill rows 17-22.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 18, y, PAL.coatHi);   // lit side now camera-right
    set(p, 13, y, PAL.coatShade); // shaded camera-left
  }
  // Sleeve on camera-near side (viewer's right, x=19) -- mirror of NE x=12.
  set(p, 19, 17, PAL.coatHi);
  set(p, 19, 18, PAL.coatMid);
  set(p, 19, 19, PAL.coatShade);
  set(p, 19, 20, PAL.coatShade);
  // Far-side sleeve at x=12 (mirror of NE x=19).
  set(p, 12, 17, PAL.coatShade);
  set(p, 12, 18, PAL.coatDeep);
  // Backpack mirrored: x=13..16 (mirror of NE x=18..15).
  for (let y = 17; y <= 20; y++) {
    set(p, 13, y, PAL.musketStockShade); // shaded edge (mirror of NE x=18)
    set(p, 14, y, PAL.musketStock);
    set(p, 15, y, PAL.musketStockHi);
    set(p, 16, y, PAL.musketStockHi);    // lit edge (mirror of NE x=15)
  }
  // Shoulder straps mirrored.
  set(p, 16, 17, PAL.beltWhite); // mirror of NE (15, 17)
  set(p, 13, 17, PAL.beltWhite); // mirror of NE (18, 17)
  // Bottom strap (mirror of NE x=16,17 -> x=15,14).
  set(p, 15, 21, PAL.beltShade);
  set(p, 14, 21, PAL.beltShade);
  // Hem.
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 18, 23, PAL.coatDeep);
  set(p, 13, 23, PAL.coatDeep);
  save(p, 'uniform/coat-line/northwest/base.png');
}

function drawShakoNW() {
  // Mirror of NE shako. The shako body x=14..18 is symmetric around x=16 (the
  // figure's centerline), so we keep the same x range and only flip the
  // lit/shade edges. Plume stays centered at x=16.
  const p = makeSprite();
  set(p, 16, 7, PAL.plumeTip);
  set(p, 16, 8, PAL.plumeRed);
  for (let y = 9; y <= 13; y++) {
    row(p, y, 14, 18, PAL.shakoMid);
    set(p, 18, y, PAL.shakoHi);   // lit side flipped to camera-right
    set(p, 14, y, PAL.shakoShade); // shaded side flipped to camera-left
  }
  // No brass plate (back view).
  // Brim: west-leaning, overhangs only on the left.
  row(p, 14, 13, 18, PAL.shakoShade);
  save(p, 'uniform/head/shako-standard/northwest.png');
}

function drawMusketNW() {
  const p = makeSprite();
  // NW idle: mirror of NE -- vertical musket on camera-near side (viewer's right).
  paintMusketVertical(p, 20, 22, { flipX: true });
  set(p, 19, 20, PAL.skinHi);
  save(p, 'weapon/musket/northwest/idle.png');
}

// --- NE FIRING POSE ---
// 3/4 back view firing up-right. Diagonal Brown Bess at ~45 deg, butt low-left
// near chest (12,18), bayonet tip up-right at (22,8). Both arms reach forward
// (up-right) to grip the gun. Backpack stays on back. No X-belts (back view).

function drawCoatNortheastFiring() {
  const p = makeSprite();
  // Torso fill rows 17-22 (back view, lit on viewer's left).
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  // Backpack: 4 wide x 4 tall, x=15..18, rows 17-20 (shifted 1 px right vs S).
  for (let y = 17; y <= 20; y++) {
    set(p, 15, y, PAL.musketStockHi);
    set(p, 16, y, PAL.musketStockHi);
    set(p, 17, y, PAL.musketStock);
    set(p, 18, y, PAL.musketStockShade);
  }
  // Shoulder strap pixels (white).
  set(p, 15, 17, PAL.beltWhite);
  set(p, 18, 17, PAL.beltWhite);
  // Bottom strap.
  set(p, 16, 21, PAL.beltShade);
  set(p, 17, 21, PAL.beltShade);
  // Coat hem.
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);

  // Camera-near sleeve (viewer's left, x=12) tucks down to grip the butt
  // at (12,18). Hand pixel sits just inboard of the butt at (13,18).
  set(p, 12, 17, PAL.coatHi);          // near shoulder cap (lit)
  set(p, 12, 18, PAL.coatMid);         // forearm tucked toward butt
  // Far-side arm (camera-far, viewer's right) reaches across the chest
  // up-right toward the forestock grip alongside the barrel. Forearm
  // forms a short stair-step from the far shoulder to the forestock.
  set(p, 19, 17, PAL.coatShade);       // far shoulder cap (shaded)
  set(p, 18, 17, PAL.coatShade);       // bicep crossing inward
  set(p, 17, 16, PAL.coatMid);         // forearm rising
  set(p, 16, 16, PAL.coatMid);         // forearm continuing
  set(p, 15, 16, PAL.skinHi);          // far hand on forestock (snug against barrel pixel (14,16))
  return p;
}

function drawMusketNortheastFiring() {
  const p = makeSprite();
  // 45-deg diagonal pointing up-right; butt heel at (10, 19).
  paintMusketDiagonal(p, 10, 19);
  return p;
}

// --- NE MAKE-READY / HIT / DYING ---

const PAL_BLOOD = {
  bright: '#D13B33',
  dark:   '#7A1A22',
  pool:   '#5C1419',
};

function drawCoatNortheastMakeReady() {
  const p = makeSprite();
  // Same torso/pack/hem as idle.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  for (let y = 17; y <= 20; y++) {
    set(p, 15, y, PAL.musketStockHi);
    set(p, 16, y, PAL.musketStockHi);
    set(p, 17, y, PAL.musketStock);
    set(p, 18, y, PAL.musketStockShade);
  }
  set(p, 15, 17, PAL.beltWhite);
  set(p, 18, 17, PAL.beltWhite);
  set(p, 16, 21, PAL.beltShade);
  set(p, 17, 21, PAL.beltShade);
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  // Both arms reach up to vertical centerline musket. Camera-near sleeve
  // (viewer's left, x=12) rises high; far-side sleeve barely visible.
  set(p, 12, 17, PAL.coatHi);          // near shoulder
  set(p, 13, 16, PAL.coatMid);         // upper arm rising
  set(p, 14, 15, PAL.coatHi);          // forearm
  set(p, 15, 15, PAL.skinHi);          // near hand on forestock
  // Far sleeve hint.
  set(p, 19, 17, PAL.coatShade);
  set(p, 18, 16, PAL.coatShade);       // far forearm crossing inward (over pack edge)
  return p;
}

function drawMusketNortheastMakeReady() {
  const p = makeSprite();
  paintMusketVertical(p, 16, 20);
  return p;
}

function drawCoatNortheastHit() {
  const p = makeSprite();
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  for (let y = 17; y <= 20; y++) {
    set(p, 15, y, PAL.musketStockHi);
    set(p, 16, y, PAL.musketStockHi);
    set(p, 17, y, PAL.musketStock);
    set(p, 18, y, PAL.musketStockShade);
  }
  set(p, 15, 17, PAL.beltWhite);
  set(p, 18, 17, PAL.beltWhite);
  set(p, 16, 21, PAL.beltShade);
  set(p, 17, 21, PAL.beltShade);
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  // Near arm flung outward (camera-near, viewer's left).
  set(p, 12, 17, PAL.coatHi);
  set(p, 11, 17, PAL.coatHi);
  set(p, 10, 17, PAL.coatMid);
  set(p, 9, 18, PAL.skinHi);
  // Far arm partially visible flailing.
  set(p, 19, 17, PAL.coatShade);
  set(p, 20, 17, PAL.coatShade);
  set(p, 21, 18, PAL.skinHi);
  return p;
}

function drawMusketNortheastHit() {
  const p = makeSprite();
  // Hit-tilted, butt heel at (14, 23), leans the same way as S hit
  // (camera-near side of figure = viewer's left).
  paintMusketHitTilted(p, 14, 23);
  return p;
}

function drawBloodNortheastHit() {
  const p = makeSprite();
  // Spray erupting forward-left (camera-near side, since exit-wound from back-3/4).
  set(p, 13, 17, PAL_BLOOD.bright);
  set(p, 12, 17, PAL_BLOOD.bright);
  set(p, 14, 18, PAL_BLOOD.bright);
  set(p, 11, 18, PAL_BLOOD.dark);
  set(p, 13, 19, PAL_BLOOD.dark);
  set(p, 10, 19, PAL_BLOOD.bright);
  set(p, 12, 16, PAL_BLOOD.dark);
  set(p, 15, 18, PAL_BLOOD.dark);
  return p;
}

function drawBodyNortheastDying() {
  const p = makeSprite();
  // Hair shifted +1y.
  row(p, 16, 15, 17, PAL.musketStock);
  row(p, 17, 15, 17, PAL.musketStockShade);
  set(p, 16, 16, PAL.musketStockHi);
  set(p, 18, 17, PAL.skinShade);
  return p;
}

function drawShakoNortheastDying() {
  const p = makeSprite();
  // Shifted +1y.
  set(p, 16, 8, PAL.plumeTip);
  set(p, 16, 9, PAL.plumeRed);
  for (let y = 10; y <= 14; y++) {
    row(p, y, 14, 18, PAL.shakoMid);
    set(p, 14, y, PAL.shakoHi);
    set(p, 18, y, PAL.shakoShade);
  }
  row(p, 15, 14, 19, PAL.shakoShade);
  return p;
}

function drawCoatNortheastDying() {
  const p = makeSprite();
  // Slumped torso (rows 18-23).
  for (let y = 18; y <= 23; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  // Pack still on, slid +1y.
  for (let y = 18; y <= 21; y++) {
    set(p, 15, y, PAL.musketStockHi);
    set(p, 16, y, PAL.musketStockHi);
    set(p, 17, y, PAL.musketStock);
    set(p, 18, y, PAL.musketStockShade);
  }
  set(p, 15, 18, PAL.beltWhite);
  set(p, 18, 18, PAL.beltWhite);
  set(p, 16, 22, PAL.beltShade);
  set(p, 17, 22, PAL.beltShade);
  row(p, 24, 13, 18, PAL.coatShade);
  set(p, 13, 24, PAL.coatDeep);
  set(p, 18, 24, PAL.coatDeep);
  // Near arm slumped, forward; far arm hint.
  set(p, 12, 19, PAL.coatHi);
  set(p, 11, 20, PAL.coatMid);
  set(p, 10, 21, PAL.skinHi);
  set(p, 19, 19, PAL.coatShade);
  return p;
}

function drawTrousersNortheastDying() {
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

function drawMusketNortheastDying() {
  const p = makeSprite();
  // Musket flat on ground, butt at viewer's right, muzzle pointing west
  // (camera-near side of NE figure -- matches the NE idle's gun position).
  paintMusketHorizontal(p, 14, 29, { flipX: true });
  return p;
}

function drawBloodNortheastDying() {
  const p = makeSprite();
  row(p, 30, 11, 21, PAL_BLOOD.pool);
  row(p, 29, 12, 20, PAL_BLOOD.dark);
  set(p, 13, 28, PAL_BLOOD.pool);
  set(p, 19, 28, PAL_BLOOD.pool);
  set(p, 14, 19, PAL_BLOOD.dark);
  set(p, 13, 21, PAL_BLOOD.dark);
  return p;
}

function drawNE() {
  console.log('Drawing NE facing components:');
  drawBodyNE();
  drawTrousersNE();
  drawCoatNE();
  drawShakoNE();
  drawMusketNE();
  const neCoatFire = drawCoatNortheastFiring();
  save(neCoatFire, 'uniform/coat-line/northeast/present.png');
  save(neCoatFire, 'uniform/coat-line/northeast/fire.png');
  const neMusketFire = drawMusketNortheastFiring();
  save(neMusketFire, 'weapon/musket/northeast/present.png');
  save(neMusketFire, 'weapon/musket/northeast/fire.png');
  // Make-ready / hit / dying.
  const neCoatMR = drawCoatNortheastMakeReady();
  save(neCoatMR, 'uniform/coat-line/northeast/make-ready.png');
  const neMusketMR = drawMusketNortheastMakeReady();
  save(neMusketMR, 'weapon/musket/northeast/make-ready.png');
  const neCoatHit = drawCoatNortheastHit();
  save(neCoatHit, 'uniform/coat-line/northeast/hit.png');
  const neMusketHit = drawMusketNortheastHit();
  save(neMusketHit, 'weapon/musket/northeast/hit.png');
  const neBloodHit = drawBloodNortheastHit();
  save(neBloodHit, 'fx/blood/northeast/hit.png');
  const neBodyDying = drawBodyNortheastDying();
  save(neBodyDying, 'anatomy/body/northeast/dying.png');
  const neShakoDying = drawShakoNortheastDying();
  save(neShakoDying, 'uniform/head/shako-standard/northeast-dying.png');
  const neCoatDying = drawCoatNortheastDying();
  save(neCoatDying, 'uniform/coat-line/northeast/dying.png');
  const neTrousersDying = drawTrousersNortheastDying();
  save(neTrousersDying, 'uniform/lower/trousers/northeast-dying.png');
  const neMusketDying = drawMusketNortheastDying();
  save(neMusketDying, 'weapon/musket/northeast/dying.png');
  const neBloodDying = drawBloodNortheastDying();
  save(neBloodDying, 'fx/blood/northeast/dying.png');
  return {
    neCoatFire, neMusketFire,
    neCoatMR, neMusketMR,
    neCoatHit, neMusketHit, neBloodHit,
    neBodyDying, neShakoDying, neCoatDying, neTrousersDying, neMusketDying, neBloodDying,
  };
}

function drawNW(neFireSprites) {
  console.log('Drawing NW facing components:');
  drawBodyNW();
  drawTrousersNW();
  drawCoatNW();
  drawShakoNW();
  drawMusketNW();
  if (neFireSprites) {
    const nwCoatFire = mirrorHorizontal(neFireSprites.neCoatFire);
    save(nwCoatFire, 'uniform/coat-line/northwest/present.png');
    save(nwCoatFire, 'uniform/coat-line/northwest/fire.png');
    const nwMusketFire = mirrorHorizontal(neFireSprites.neMusketFire);
    save(nwMusketFire, 'weapon/musket/northwest/present.png');
    save(nwMusketFire, 'weapon/musket/northwest/fire.png');
    save(mirrorHorizontal(neFireSprites.neCoatMR), 'uniform/coat-line/northwest/make-ready.png');
    save(mirrorHorizontal(neFireSprites.neMusketMR), 'weapon/musket/northwest/make-ready.png');
    save(mirrorHorizontal(neFireSprites.neCoatHit), 'uniform/coat-line/northwest/hit.png');
    save(mirrorHorizontal(neFireSprites.neMusketHit), 'weapon/musket/northwest/hit.png');
    save(mirrorHorizontal(neFireSprites.neBloodHit), 'fx/blood/northwest/hit.png');
    save(mirrorHorizontal(neFireSprites.neBodyDying), 'anatomy/body/northwest/dying.png');
    save(mirrorHorizontal(neFireSprites.neShakoDying), 'uniform/head/shako-standard/northwest-dying.png');
    save(mirrorHorizontal(neFireSprites.neCoatDying), 'uniform/coat-line/northwest/dying.png');
    save(mirrorHorizontal(neFireSprites.neTrousersDying), 'uniform/lower/trousers/northwest-dying.png');
    save(mirrorHorizontal(neFireSprites.neMusketDying), 'weapon/musket/northwest/dying.png');
    save(mirrorHorizontal(neFireSprites.neBloodDying), 'fx/blood/northwest/dying.png');
  }
}

const FACINGS = process.argv.slice(2);
const all = FACINGS.length === 0;

const neFireSprites = (all || FACINGS.includes('NE') || FACINGS.includes('NW')) ? drawNE() : null;
if (all || FACINGS.includes('NW')) drawNW(neFireSprites);

console.log('\nDone.');
