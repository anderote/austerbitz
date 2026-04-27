#!/usr/bin/env node
// Hand-painted chibi pixel components for the British line infantry kit -- N facing.
// Soldier is facing AWAY from the camera (pure back view).
// Each call writes one 32x36 RGBA PNG with transparent background.
// (coords below shifted +8 from original 16-wide layout to keep figure centered.)
//
// N-facing row layout (32w x 36h) -- mirrors S layout but back-of-head:
//   7     plume tip white at x=8
//   8     plume body red at x=8
//   9-13  shako body (5 rows tall, 5 wide x=6..10) -- NO brass plate (badge is on front)
//   14    brim (7 wide, dark)
//   15-16 back of head (hair only, no face features)
//   17-22 coat torso (6 rows) back view -- NO X-belts; backpack overlaid x=6..9 rows 17-20;
//         waist/cartridge belt single horizontal row 22
//   23    coat hem (darker)
//   24-25 trousers (split legs)
//   26-27 gaiters (brass buttons row 26)
//   28    boots
//   29-30 ground shadow (semi-alpha)
//
// Musket runs VERTICAL on viewer's right (x=12) -- mirror of S which had it at x=3.
// From behind, the soldier's right shoulder is on viewer's right, so the musket sits
// shouldered there. Bayonet socket offsets to the LEFT (x=11) -- same anatomical
// side of the barrel as in S but mirrored across the figure.

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
  // N-facing additions:
  hairTop: '#5A3A22',     // lit top of hair (slightly lighter than musketStock)
  hairDeep: '#2A1A0E',    // shaded back of hair
  packLeather: '#8B6F4A', // tan-brown backpack canvas/leather
  packShade: '#5E4730',   // backpack shaded edge
  packHi: '#A88A60',      // backpack lid edge highlight
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

// --- NORTH ---

function drawShadowNorth() {
  const p = makeSprite();
  row(p, 30, 12, 19, PAL.shadow, 110);
  row(p, 29, 13, 18, PAL.shadow, 70);
  save(p, 'shadow/north/default.png');
}

function drawBodyNorth() {
  const p = makeSprite();
  // Back of head: hair only, no face. 3 wide x 2 tall, x=15..17, rows 15-16.
  // Row 15 (top, lit) slightly lighter; row 16 (deeper) darker.
  set(p, 15, 15, PAL.hairTop);
  set(p, 16, 15, PAL.hairTop);
  set(p, 17, 15, PAL.musketStock);
  set(p, 15, 16, PAL.musketStock);
  set(p, 16, 16, PAL.musketStock);
  set(p, 17, 16, PAL.hairDeep);
  save(p, 'anatomy/body/north/base.png');
}

function drawTrousersNorth() {
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
  // Brass buttons on inner two columns of the leg block.
  set(p, 15, 26, PAL.brass);
  set(p, 16, 26, PAL.brass);
  // Row 28: square off the leg, same columns as gaiters.
  row(p, 28, 14, 17, PAL.gaiterBlack);
  save(p, 'uniform/lower/trousers/north.png');
}

function drawCoatNorth() {
  const p = makeSprite();
  // Torso fill rows 17-22 (6 rows). Back view: even shade, lit at x=13, shade at x=18.
  for (let y = 17; y <= 22; y++) {
    row(p, y, 13, 18, PAL.coatMid);
    set(p, 13, y, PAL.coatHi);
    set(p, 18, y, PAL.coatShade);
  }
  // NO X-belts (those are on the chest). Coat back is plain red.

  // Backpack: 4 wide x 4 tall (x=14..17, rows 17-20) tan-brown leather.
  for (let y = 17; y <= 20; y++) {
    for (let x = 14; x <= 17; x++) {
      set(p, x, y, PAL.packLeather);
    }
  }
  // Backpack shading: right column shaded, left column slightly lit.
  for (let y = 17; y <= 20; y++) {
    set(p, 17, y, PAL.packShade);
  }
  // Lid edge highlight on top row.
  row(p, 17, 14, 17, PAL.packHi);
  set(p, 17, 17, PAL.packLeather); // restore corner so it isn't too bright

  // Backpack straps: thin white verticals at the top corners, suggesting crossed
  // shoulder straps coming over from the chest.
  set(p, 14, 17, PAL.beltWhite);
  set(p, 17, 17, PAL.beltWhite);

  // Cartridge box / waist belt: single horizontal white strip at row 22.
  row(p, 22, 13, 18, PAL.beltWhite);

  // Sleeves: both visible hanging down. Both use coatMid (back is roughly even).
  // Top of shoulders gets a small kiss of light from sun on top-left.
  set(p, 12, 17, PAL.coatHi);
  set(p, 12, 18, PAL.coatMid);
  set(p, 12, 19, PAL.coatMid);
  set(p, 12, 20, PAL.coatShade);
  set(p, 19, 17, PAL.coatMid);
  set(p, 19, 18, PAL.coatMid);
  set(p, 19, 19, PAL.coatShade);
  set(p, 19, 20, PAL.coatShade);
  set(p, 19, 21, PAL.coatDeep);

  // Coat hem row 23.
  row(p, 23, 13, 18, PAL.coatShade);
  set(p, 13, 23, PAL.coatDeep);
  set(p, 18, 23, PAL.coatDeep);
  save(p, 'uniform/coat-line/north/base.png');
}

function drawShakoNorth() {
  const p = makeSprite();
  set(p, 16, 7, PAL.plumeTip);
  set(p, 16, 8, PAL.plumeRed);
  for (let y = 9; y <= 13; y++) {
    row(p, y, 14, 18, PAL.shakoMid);
    set(p, 14, y, PAL.shakoHi);
    set(p, 18, y, PAL.shakoShade);
  }
  // NO brass plate -- badge is on the front of the shako, invisible from behind.
  // Brim: pure-N rule = right-leaning (overhangs only on the right).
  row(p, 14, 14, 19, PAL.shakoShade);
  save(p, 'uniform/head/shako-standard/north.png');
}

function drawMusketNorth() {
  const p = makeSprite();
  // Vertical musket along x=20 (soldier's right side; from behind that's viewer's right).
  // Bayonet socket offset to LEFT (x=19) from barrel axis (x=20) -- same anatomical
  // side of the barrel as S, mirrored across the figure.
  set(p, 19, 3, PAL.bayonetTip);
  set(p, 19, 4, PAL.bayonet);
  set(p, 19, 5, PAL.bayonet);
  set(p, 19, 6, PAL.bayonet);
  set(p, 19, 7, PAL.bayonet);
  // T-shape socket: in-line steel pixel in barrel column at bayonet base row.
  set(p, 20, 7, PAL.bayonet);
  // Muzzle.
  set(p, 20, 8, PAL.musketMuzzle);
  // Barrel rows 9-19.
  for (let y = 9; y <= 19; y++) set(p, 20, y, PAL.musketBarrel);
  // Brass barrel band mid-barrel.
  set(p, 20, 14, PAL.brass);
  // Lock (brass) at row 20, hammer outboard at x=21.
  set(p, 20, 20, PAL.brass);
  set(p, 21, 20, PAL.hammer);
  // Stock.
  set(p, 20, 21, PAL.musketStockHi);
  set(p, 20, 22, PAL.musketStock);
  // Right hand grips the lock from the body side (inboard, x=19).
  set(p, 19, 20, PAL.skinHi);
  save(p, 'weapon/musket/north/idle.png');
}

function drawNorth() {
  console.log('Drawing N facing components:');
  drawShadowNorth();
  drawBodyNorth();
  drawTrousersNorth();
  drawCoatNorth();
  drawShakoNorth();
  drawMusketNorth();
}

drawNorth();

console.log('\nDone.');
