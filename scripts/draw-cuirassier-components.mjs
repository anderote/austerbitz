#!/usr/bin/env node
// Hand-painted chibi pixel components for the cuirassier (heavy cavalry) kit.
// Each call writes one 32x36 RGBA PNG with transparent background.
//
// Phase 2 scope:
//   * Horse (8 facings, idle + 4-frame walk + 6-frame run)
//   * Rider torso, legs, arms-idle (8 facings)
//   * Steel cuirass with primary marker for regiment trim (8 facings)
//   * Plumed cuirassier helmet (8 facings)
//   * Saber weapon, 3 source facings (N, NW, W) — runtime mirrors derive rest
//
// All registry entries appended to public/components/index.json idempotently.
//
// Layout convention (32w x 36h, bottom-anchored):
//   y=0..7    helmet plume / hat top (rider only)
//   y=8..11   helmet body / face
//   y=12..18  rider torso, cuirass
//   y=19..23  saddle / horse withers / horse back
//   y=24..28  horse legs
//
// Shadows are projected procedurally at runtime, so no shadow pixels are
// baked into these component sprites.

import { PNG } from 'pngjs';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COMPONENTS = resolve(ROOT, 'public/sprites/components');
const REGISTRY_PATH = resolve(ROOT, 'public/components/index.json');

const W = 32;
const H = 36;

// =====================================================================
// PALETTE
// Marker pixel families (recolored per regiment by the shader / compositor):
//   primary   — magenta (#ff00ff family)  — rider coat / cuirass trim
//   secondary — cyan    (#00ffff family)  — plume / regimental sash (unused here)
//   tertiary  — yellow  (#ffff00 family)  — unused
// Literal art colors (bay coat, steel, leather) pass through unchanged.
// =====================================================================
const PAL = {
  // Bay horse coat
  coatHi: '#A56B3A',
  coatMid: '#8A4F26',
  coatShade: '#5C3318',
  coatDeep: '#3A1F0E',
  // Mane / tail / hooves / outline
  black: '#1A1414',
  hoofMid: '#2C1F18',
  // Skin (rider face / hands)
  skinHi: '#F0CFA8',
  skinMid: '#D4A47C',
  skinShade: '#9A6E4C',
  // Steel (cuirass, helmet, saber blade)
  steelHi: '#E0E4EC',
  steelMid: '#A8B0C0',
  steelShade: '#6A7488',
  steelDeep: '#3C4458',
  // Saddle / leather (boots, reins)
  leatherHi: '#7A4E2C',
  leatherMid: '#52331C',
  leatherShade: '#2C1C10',
  // Brass / hilt
  brassHi: '#F0D070',
  brassMid: '#B08830',
  brassShade: '#6E521C',
  // Primary (magenta) — rider coat
  primaryHi: '#FF80FF',
  primaryMid: '#FF00FF',
  primaryShade: '#A000A0',
  // Secondary (cyan) — plume
  secondaryHi: '#80FFFF',
  secondaryMid: '#00FFFF',
  secondaryShade: '#00A0A0',
};

// =====================================================================
// PIXEL HELPERS
// =====================================================================

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

// =====================================================================
// DIRECTIONS
// =====================================================================

const DIRS = [
  { kit: 'N',  fs: 'north' },
  { kit: 'NE', fs: 'northeast' },
  { kit: 'E',  fs: 'east' },
  { kit: 'SE', fs: 'southeast' },
  { kit: 'S',  fs: 'south' },
  { kit: 'SW', fs: 'southwest' },
  { kit: 'W',  fs: 'west' },
  { kit: 'NW', fs: 'northwest' },
];

// =====================================================================
// HORSE — IDLE (8 facings). Reuses the original Phase-1 art.
// =====================================================================

function drawHorseSouthAt(p, legPhase = 0) {
  // legPhase: 0 = neutral, 1 = left forward, 2 = neutral, 3 = right forward.
  // Ears
  set(p, 13, 13, PAL.coatShade);
  set(p, 18, 13, PAL.coatShade);
  set(p, 13, 14, PAL.coatMid);
  set(p, 18, 14, PAL.coatMid);

  // Forelock (between ears)
  set(p, 15, 13, PAL.black);
  set(p, 16, 13, PAL.black);
  row(p, 14, 14, 17, PAL.black);

  // Forehead / face
  row(p, 15, 14, 17, PAL.coatMid);
  set(p, 14, 15, PAL.coatHi);
  set(p, 17, 15, PAL.coatShade);

  // Eyes
  set(p, 14, 16, PAL.black);
  set(p, 17, 16, PAL.black);
  set(p, 15, 16, PAL.coatMid);
  set(p, 16, 16, PAL.coatMid);

  // Cheeks / muzzle
  row(p, 17, 14, 17, PAL.coatMid);
  set(p, 14, 17, PAL.coatHi);
  set(p, 17, 17, PAL.coatShade);
  row(p, 18, 14, 17, PAL.coatShade);
  set(p, 15, 18, PAL.black);
  set(p, 16, 18, PAL.black);

  // Neck
  row(p, 19, 13, 18, PAL.coatMid);
  set(p, 13, 19, PAL.black);
  set(p, 18, 19, PAL.coatHi);
  set(p, 13, 20, PAL.black);
  row(p, 20, 14, 18, PAL.coatMid);
  set(p, 18, 20, PAL.coatShade);

  // Chest
  row(p, 21, 12, 19, PAL.coatMid);
  set(p, 12, 21, PAL.coatShade);
  set(p, 19, 21, PAL.coatShade);
  row(p, 22, 11, 20, PAL.coatMid);
  set(p, 11, 22, PAL.coatShade);
  set(p, 20, 22, PAL.coatShade);
  row(p, 23, 11, 20, PAL.coatMid);
  set(p, 11, 23, PAL.coatShade);
  set(p, 20, 23, PAL.coatShade);
  set(p, 15, 22, PAL.coatHi);
  set(p, 16, 22, PAL.coatHi);

  // Belly
  row(p, 24, 12, 19, PAL.coatShade);
  set(p, 15, 24, PAL.coatDeep);
  set(p, 16, 24, PAL.coatDeep);

  // Legs (front view shows two pairs splayed). Phase shifts hooves left/right.
  const lOff = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  const rOff = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  // Left pair
  row(p, 25, 12, 13, PAL.coatMid);
  row(p, 26, 12, 13, PAL.coatShade);
  set(p, 13 + lOff, 27, PAL.coatMid);
  set(p, 13 + lOff, 28, PAL.black);
  // Right pair
  row(p, 25, 18, 19, PAL.coatMid);
  row(p, 26, 18, 19, PAL.coatShade);
  set(p, 18 + rOff, 27, PAL.coatMid);
  set(p, 18 + rOff, 28, PAL.black);
  set(p, 13 + lOff, 27, PAL.hoofMid);
  set(p, 18 + rOff, 27, PAL.hoofMid);
}

function drawHorseNorthAt(p, legPhase = 0) {
  // Rump
  row(p, 13, 14, 17, PAL.coatShade);
  row(p, 14, 13, 18, PAL.coatMid);
  set(p, 13, 14, PAL.coatShade);
  set(p, 18, 14, PAL.coatShade);
  row(p, 15, 12, 19, PAL.coatMid);
  set(p, 12, 15, PAL.coatShade);
  set(p, 19, 15, PAL.coatShade);
  row(p, 16, 12, 19, PAL.coatMid);
  set(p, 12, 16, PAL.coatShade);
  set(p, 19, 16, PAL.coatShade);
  set(p, 15, 14, PAL.coatHi);
  set(p, 16, 14, PAL.coatHi);
  set(p, 15, 15, PAL.coatHi);
  set(p, 16, 15, PAL.coatHi);
  // Body mass
  row(p, 17, 11, 20, PAL.coatMid);
  set(p, 11, 17, PAL.coatShade);
  set(p, 20, 17, PAL.coatShade);
  row(p, 18, 11, 20, PAL.coatMid);
  set(p, 11, 18, PAL.coatShade);
  set(p, 20, 18, PAL.coatShade);
  row(p, 19, 11, 20, PAL.coatMid);
  set(p, 11, 19, PAL.coatShade);
  set(p, 20, 19, PAL.coatShade);
  // Tail
  for (let y = 15; y <= 22; y++) {
    set(p, 16, y, PAL.black);
  }
  set(p, 15, 21, PAL.black);
  set(p, 15, 22, PAL.black);
  // Lower body
  row(p, 20, 11, 20, PAL.coatShade);
  row(p, 21, 12, 19, PAL.coatShade);
  // Legs
  const lOff = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  const rOff = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  row(p, 23, 12, 13, PAL.coatMid);
  row(p, 23, 18, 19, PAL.coatMid);
  row(p, 24, 12, 13, PAL.coatShade);
  row(p, 24, 18, 19, PAL.coatShade);
  set(p, 13 + lOff, 25, PAL.coatMid);
  set(p, 18 + rOff, 25, PAL.coatMid);
  set(p, 13 + lOff, 26, PAL.coatShade);
  set(p, 18 + rOff, 26, PAL.coatShade);
  set(p, 13 + lOff, 27, PAL.coatShade);
  set(p, 18 + rOff, 27, PAL.coatShade);
  set(p, 13 + lOff, 28, PAL.black);
  set(p, 18 + rOff, 28, PAL.black);
}

function drawHorseEastAt(p, legPhase = 0) {
  // Head right
  set(p, 24, 13, PAL.coatShade);
  set(p, 25, 13, PAL.coatShade);
  row(p, 14, 23, 25, PAL.coatMid);
  set(p, 25, 14, PAL.coatHi);
  row(p, 15, 22, 25, PAL.coatMid);
  set(p, 24, 15, PAL.black);
  set(p, 25, 15, PAL.coatHi);
  row(p, 16, 22, 26, PAL.coatMid);
  set(p, 22, 16, PAL.coatShade);
  set(p, 26, 16, PAL.coatShade);
  row(p, 17, 23, 26, PAL.coatShade);
  set(p, 26, 17, PAL.black);
  set(p, 25, 17, PAL.coatDeep);
  // Mane
  for (let x = 17; x <= 21; x++) set(p, x, 16, PAL.black);
  // Neck
  for (let x = 17; x <= 22; x++) set(p, x, 17, PAL.coatMid);
  for (let x = 17; x <= 20; x++) set(p, x, 18, PAL.coatShade);
  // Body
  row(p, 18, 8, 16, PAL.coatMid);
  set(p, 8, 18, PAL.coatShade);
  set(p, 14, 18, PAL.coatHi);
  set(p, 15, 18, PAL.coatHi);
  set(p, 16, 18, PAL.coatHi);
  row(p, 19, 7, 21, PAL.coatMid);
  set(p, 7, 19, PAL.coatShade);
  set(p, 21, 19, PAL.coatShade);
  row(p, 20, 7, 21, PAL.coatMid);
  set(p, 7, 20, PAL.coatShade);
  set(p, 21, 20, PAL.coatShade);
  row(p, 21, 7, 21, PAL.coatMid);
  set(p, 7, 21, PAL.coatShade);
  set(p, 21, 21, PAL.coatShade);
  row(p, 22, 8, 20, PAL.coatShade);
  set(p, 8, 22, PAL.coatDeep);
  set(p, 20, 22, PAL.coatDeep);
  row(p, 23, 9, 19, PAL.coatShade);
  // Tail
  for (let y = 18; y <= 23; y++) set(p, 6, y, PAL.black);
  set(p, 5, 22, PAL.black);
  set(p, 5, 23, PAL.black);
  set(p, 5, 24, PAL.black);
  // Legs: front pair x=18,19; back pair x=10,11. Phase: alternate gait.
  // legPhase 0 = neutral, 1 = front-fwd/back-back, 2 = neutral, 3 = front-back/back-fwd.
  const frontStride = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  const backStride  = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  // Front pair
  set(p, 18, 24, PAL.coatMid);
  set(p, 19, 24, PAL.coatMid);
  for (let y = 25; y <= 27; y++) {
    set(p, 18 + frontStride, y, PAL.coatShade);
    set(p, 19 + frontStride, y, PAL.coatShade);
  }
  set(p, 18 + frontStride, 28, PAL.black);
  set(p, 19 + frontStride, 28, PAL.black);
  // Back pair
  set(p, 10, 24, PAL.coatMid);
  set(p, 11, 24, PAL.coatMid);
  for (let y = 25; y <= 27; y++) {
    set(p, 10 + backStride, y, PAL.coatShade);
    set(p, 11 + backStride, y, PAL.coatShade);
  }
  set(p, 10 + backStride, 28, PAL.black);
  set(p, 11 + backStride, 28, PAL.black);
}

function drawHorseWestAt(p, legPhase = 0) {
  // Head left
  set(p, 6, 13, PAL.coatShade);
  set(p, 7, 13, PAL.coatShade);
  row(p, 14, 6, 8, PAL.coatMid);
  set(p, 6, 14, PAL.coatHi);
  row(p, 15, 6, 9, PAL.coatMid);
  set(p, 7, 15, PAL.black);
  set(p, 6, 15, PAL.coatHi);
  row(p, 16, 5, 9, PAL.coatMid);
  set(p, 5, 16, PAL.coatShade);
  set(p, 9, 16, PAL.coatShade);
  row(p, 17, 5, 8, PAL.coatShade);
  set(p, 5, 17, PAL.black);
  set(p, 6, 17, PAL.coatDeep);
  // Mane
  for (let x = 10; x <= 14; x++) set(p, x, 16, PAL.black);
  // Neck
  for (let x = 9; x <= 14; x++) set(p, x, 17, PAL.coatMid);
  for (let x = 11; x <= 14; x++) set(p, x, 18, PAL.coatShade);
  // Body
  row(p, 18, 15, 23, PAL.coatMid);
  set(p, 23, 18, PAL.coatShade);
  set(p, 15, 18, PAL.coatHi);
  set(p, 16, 18, PAL.coatHi);
  set(p, 17, 18, PAL.coatHi);
  row(p, 19, 10, 24, PAL.coatMid);
  set(p, 10, 19, PAL.coatShade);
  set(p, 24, 19, PAL.coatShade);
  row(p, 20, 10, 24, PAL.coatMid);
  set(p, 10, 20, PAL.coatShade);
  set(p, 24, 20, PAL.coatShade);
  row(p, 21, 10, 24, PAL.coatMid);
  set(p, 10, 21, PAL.coatShade);
  set(p, 24, 21, PAL.coatShade);
  row(p, 22, 11, 23, PAL.coatShade);
  set(p, 11, 22, PAL.coatDeep);
  set(p, 23, 22, PAL.coatDeep);
  row(p, 23, 12, 22, PAL.coatShade);
  // Tail
  for (let y = 18; y <= 23; y++) set(p, 25, y, PAL.black);
  set(p, 26, 22, PAL.black);
  set(p, 26, 23, PAL.black);
  set(p, 26, 24, PAL.black);
  // Legs: front pair x=12,13; back pair x=20,21
  const frontStride = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  const backStride  = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  set(p, 12, 24, PAL.coatMid);
  set(p, 13, 24, PAL.coatMid);
  for (let y = 25; y <= 27; y++) {
    set(p, 12 + frontStride, y, PAL.coatShade);
    set(p, 13 + frontStride, y, PAL.coatShade);
  }
  set(p, 12 + frontStride, 28, PAL.black);
  set(p, 13 + frontStride, 28, PAL.black);
  set(p, 20, 24, PAL.coatMid);
  set(p, 21, 24, PAL.coatMid);
  for (let y = 25; y <= 27; y++) {
    set(p, 20 + backStride, y, PAL.coatShade);
    set(p, 21 + backStride, y, PAL.coatShade);
  }
  set(p, 20 + backStride, 28, PAL.black);
  set(p, 21 + backStride, 28, PAL.black);
}

function drawHorseSoutheastAt(p, legPhase = 0) {
  // Head lower-right
  set(p, 22, 14, PAL.coatShade); set(p, 23, 14, PAL.coatShade);
  row(p, 15, 21, 24, PAL.coatMid);
  set(p, 22, 16, PAL.black);
  row(p, 16, 21, 24, PAL.coatMid);
  row(p, 17, 22, 24, PAL.coatShade);
  set(p, 24, 17, PAL.black);
  // Neck
  set(p, 19, 17, PAL.black); set(p, 20, 17, PAL.black); set(p, 21, 17, PAL.black);
  row(p, 18, 18, 22, PAL.coatMid);
  // Body
  row(p, 19, 11, 22, PAL.coatMid);
  row(p, 20, 10, 22, PAL.coatMid);
  set(p, 10, 20, PAL.coatShade); set(p, 22, 20, PAL.coatShade);
  row(p, 21, 10, 22, PAL.coatMid);
  set(p, 10, 21, PAL.coatShade); set(p, 22, 21, PAL.coatShade);
  row(p, 22, 11, 21, PAL.coatShade);
  row(p, 23, 12, 20, PAL.coatShade);
  // Tail
  for (let y = 19; y <= 23; y++) set(p, 9, y, PAL.black);
  set(p, 8, 23, PAL.black);
  // Legs (3 visible). Phase shifts each.
  const fOff = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  const mOff = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  const bOff = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  for (let y = 24; y <= 27; y++) set(p, 12 + bOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 12 + bOff, 28, PAL.black);
  for (let y = 24; y <= 27; y++) set(p, 16 + mOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 16 + mOff, 28, PAL.black);
  for (let y = 24; y <= 27; y++) set(p, 20 + fOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 20 + fOff, 28, PAL.black);
}

function drawHorseSouthwestAt(p, legPhase = 0) {
  set(p, 8, 14, PAL.coatShade); set(p, 9, 14, PAL.coatShade);
  row(p, 15, 7, 10, PAL.coatMid);
  set(p, 9, 16, PAL.black);
  row(p, 16, 7, 10, PAL.coatMid);
  row(p, 17, 7, 9, PAL.coatShade);
  set(p, 7, 17, PAL.black);
  set(p, 10, 17, PAL.black); set(p, 11, 17, PAL.black); set(p, 12, 17, PAL.black);
  row(p, 18, 9, 13, PAL.coatMid);
  row(p, 19, 9, 20, PAL.coatMid);
  row(p, 20, 9, 21, PAL.coatMid);
  set(p, 9, 20, PAL.coatShade); set(p, 21, 20, PAL.coatShade);
  row(p, 21, 9, 21, PAL.coatMid);
  set(p, 9, 21, PAL.coatShade); set(p, 21, 21, PAL.coatShade);
  row(p, 22, 10, 20, PAL.coatShade);
  row(p, 23, 11, 19, PAL.coatShade);
  for (let y = 19; y <= 23; y++) set(p, 22, y, PAL.black);
  set(p, 23, 23, PAL.black);
  const fOff = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  const mOff = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  const bOff = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  for (let y = 24; y <= 27; y++) set(p, 11 + fOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 11 + fOff, 28, PAL.black);
  for (let y = 24; y <= 27; y++) set(p, 15 + mOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 15 + mOff, 28, PAL.black);
  for (let y = 24; y <= 27; y++) set(p, 19 + bOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 19 + bOff, 28, PAL.black);
}

function drawHorseNortheastAt(p, legPhase = 0) {
  // Rump bulk upper-right with tail
  row(p, 15, 18, 22, PAL.coatShade);
  row(p, 16, 16, 23, PAL.coatMid);
  set(p, 23, 16, PAL.coatShade);
  row(p, 17, 14, 23, PAL.coatMid);
  set(p, 14, 17, PAL.coatShade); set(p, 23, 17, PAL.coatShade);
  row(p, 18, 12, 22, PAL.coatMid);
  set(p, 12, 18, PAL.coatShade); set(p, 22, 18, PAL.coatShade);
  // Tail
  set(p, 23, 16, PAL.black); set(p, 24, 17, PAL.black);
  set(p, 24, 18, PAL.black); set(p, 24, 19, PAL.black);
  set(p, 23, 20, PAL.black); set(p, 24, 20, PAL.black);
  // Mane sliver
  set(p, 11, 17, PAL.black); set(p, 12, 17, PAL.black); set(p, 13, 17, PAL.black);
  // Body
  row(p, 19, 10, 22, PAL.coatMid);
  row(p, 20, 10, 22, PAL.coatMid);
  set(p, 10, 20, PAL.coatShade); set(p, 22, 20, PAL.coatShade);
  row(p, 21, 10, 22, PAL.coatMid);
  set(p, 10, 21, PAL.coatShade); set(p, 22, 21, PAL.coatShade);
  row(p, 22, 11, 21, PAL.coatShade);
  row(p, 23, 12, 20, PAL.coatShade);
  const fOff = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  const mOff = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  const bOff = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  for (let y = 24; y <= 27; y++) set(p, 12 + bOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 12 + bOff, 28, PAL.black);
  for (let y = 24; y <= 27; y++) set(p, 16 + mOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 16 + mOff, 28, PAL.black);
  for (let y = 24; y <= 27; y++) set(p, 20 + fOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 20 + fOff, 28, PAL.black);
}

function drawHorseNorthwestAt(p, legPhase = 0) {
  row(p, 15, 9, 13, PAL.coatShade);
  row(p, 16, 8, 15, PAL.coatMid);
  set(p, 8, 16, PAL.coatShade);
  row(p, 17, 8, 17, PAL.coatMid);
  set(p, 8, 17, PAL.coatShade); set(p, 17, 17, PAL.coatShade);
  row(p, 18, 9, 19, PAL.coatMid);
  set(p, 9, 18, PAL.coatShade); set(p, 19, 18, PAL.coatShade);
  set(p, 8, 16, PAL.black); set(p, 7, 17, PAL.black);
  set(p, 7, 18, PAL.black); set(p, 7, 19, PAL.black);
  set(p, 7, 20, PAL.black); set(p, 8, 20, PAL.black);
  set(p, 18, 17, PAL.black); set(p, 19, 17, PAL.black); set(p, 20, 17, PAL.black);
  row(p, 19, 9, 21, PAL.coatMid);
  row(p, 20, 9, 21, PAL.coatMid);
  set(p, 9, 20, PAL.coatShade); set(p, 21, 20, PAL.coatShade);
  row(p, 21, 9, 21, PAL.coatMid);
  set(p, 9, 21, PAL.coatShade); set(p, 21, 21, PAL.coatShade);
  row(p, 22, 10, 20, PAL.coatShade);
  row(p, 23, 11, 19, PAL.coatShade);
  const fOff = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  const mOff = legPhase === 1 ? 1 : legPhase === 3 ? -1 : 0;
  const bOff = legPhase === 1 ? -1 : legPhase === 3 ? 1 : 0;
  for (let y = 24; y <= 27; y++) set(p, 11 + fOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 11 + fOff, 28, PAL.black);
  for (let y = 24; y <= 27; y++) set(p, 15 + mOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 15 + mOff, 28, PAL.black);
  for (let y = 24; y <= 27; y++) set(p, 19 + bOff, y, y === 24 ? PAL.coatMid : PAL.coatShade);
  set(p, 19 + bOff, 28, PAL.black);
}

const HORSE_DRAWERS = {
  N: drawHorseNorthAt,
  NE: drawHorseNortheastAt,
  E: drawHorseEastAt,
  SE: drawHorseSoutheastAt,
  S: drawHorseSouthAt,
  SW: drawHorseSouthwestAt,
  W: drawHorseWestAt,
  NW: drawHorseNorthwestAt,
};

function emitHorseAllFacings() {
  for (const { kit, fs } of DIRS) {
    // idle
    const p = makeSprite();
    HORSE_DRAWERS[kit](p, 0);
    save(p, `anatomy/horse/${fs}/idle.png`);
    // walk frames (4) — phases 0, 1, 2, 3
    for (let i = 0; i < 4; i++) {
      const wp = makeSprite();
      HORSE_DRAWERS[kit](wp, i);
      save(wp, `anatomy/horse/${fs}/walk-${i}.png`);
    }
    // run frames (6) — exaggerated stride: cycle 0,1,3,0,1,3 (gallop)
    const runPhases = [1, 3, 1, 3, 1, 3];
    for (let i = 0; i < 6; i++) {
      const rp = makeSprite();
      HORSE_DRAWERS[kit](rp, runPhases[i]);
      save(rp, `anatomy/horse/${fs}/run-${i}.png`);
    }
  }
}

// =====================================================================
// RIDER LEGS — riding boots over saddle blanket. Sits straddle on horse back
// (rows 18-24). The leg "wraps" around the horse, so we draw the side of the
// thigh/boot visible on each facing. For front/back, both boots show.
// =====================================================================

function drawRiderLegsSouth(p) {
  // Front: both boots flank horse withers/saddle area.
  // Saddle blanket (rows 19-22) — primary marker (regiment edge on blanket)
  row(p, 19, 12, 19, PAL.leatherMid);
  row(p, 20, 11, 20, PAL.leatherMid);
  set(p, 11, 20, PAL.primaryMid); // blanket trim L
  set(p, 20, 20, PAL.primaryMid); // blanket trim R
  row(p, 21, 11, 20, PAL.leatherShade);
  // Thighs (rows 18-21) — knee bend visible flanking saddle
  for (let y = 18; y <= 21; y++) {
    set(p, 11, y, PAL.leatherMid);
    set(p, 12, y, PAL.leatherHi);
    set(p, 19, y, PAL.leatherHi);
    set(p, 20, y, PAL.leatherMid);
  }
  // Boots flare slightly out at knees (rows 22-24)
  for (let y = 22; y <= 24; y++) {
    set(p, 10, y, PAL.leatherMid);
    set(p, 11, y, PAL.leatherHi);
    set(p, 20, y, PAL.leatherHi);
    set(p, 21, y, PAL.leatherMid);
  }
  // Boot tops (cuff)
  set(p, 10, 22, PAL.leatherShade);
  set(p, 21, 22, PAL.leatherShade);
}

function drawRiderLegsNorth(p) {
  // Back: both boots visible at sides of horse rump.
  row(p, 19, 12, 19, PAL.leatherMid);
  row(p, 20, 11, 20, PAL.leatherMid);
  set(p, 11, 20, PAL.primaryMid);
  set(p, 20, 20, PAL.primaryMid);
  row(p, 21, 11, 20, PAL.leatherShade);
  for (let y = 18; y <= 21; y++) {
    set(p, 11, y, PAL.leatherMid);
    set(p, 12, y, PAL.leatherShade);
    set(p, 19, y, PAL.leatherShade);
    set(p, 20, y, PAL.leatherMid);
  }
  for (let y = 22; y <= 24; y++) {
    set(p, 10, y, PAL.leatherShade);
    set(p, 11, y, PAL.leatherMid);
    set(p, 20, y, PAL.leatherMid);
    set(p, 21, y, PAL.leatherShade);
  }
}

function drawRiderLegsEast(p) {
  // Side: only the near (right-side, viewer side) leg dominates. Far leg
  // partially visible behind horse body.
  // Saddle blanket along horse back
  row(p, 18, 9, 17, PAL.leatherMid);
  row(p, 19, 9, 17, PAL.leatherShade);
  set(p, 17, 18, PAL.primaryMid);
  set(p, 17, 19, PAL.primaryMid);
  set(p, 9, 18, PAL.primaryMid);
  // Near leg (right side viewer): thigh + boot stretched along horse flank
  for (let y = 19; y <= 22; y++) {
    set(p, 14, y, PAL.leatherHi);
    set(p, 15, y, PAL.leatherMid);
  }
  // Boot calf hanging down past horse belly
  for (let y = 23; y <= 25; y++) {
    set(p, 14, y, PAL.leatherMid);
    set(p, 15, y, PAL.leatherShade);
  }
}

function drawRiderLegsWest(p) {
  // Mirror of east
  row(p, 18, 14, 22, PAL.leatherMid);
  row(p, 19, 14, 22, PAL.leatherShade);
  set(p, 14, 18, PAL.primaryMid);
  set(p, 14, 19, PAL.primaryMid);
  set(p, 22, 18, PAL.primaryMid);
  for (let y = 19; y <= 22; y++) {
    set(p, 16, y, PAL.leatherHi);
    set(p, 17, y, PAL.leatherMid);
  }
  for (let y = 23; y <= 25; y++) {
    set(p, 16, y, PAL.leatherMid);
    set(p, 17, y, PAL.leatherShade);
  }
}

function drawRiderLegsSoutheast(p) {
  row(p, 18, 11, 19, PAL.leatherMid);
  row(p, 19, 10, 20, PAL.leatherShade);
  set(p, 10, 19, PAL.primaryMid);
  set(p, 20, 19, PAL.primaryMid);
  for (let y = 18; y <= 22; y++) {
    set(p, 13, y, PAL.leatherHi);
    set(p, 14, y, PAL.leatherMid);
    set(p, 18, y, PAL.leatherMid);
    set(p, 19, y, PAL.leatherShade);
  }
  for (let y = 23; y <= 25; y++) {
    set(p, 13, y, PAL.leatherMid);
    set(p, 14, y, PAL.leatherShade);
  }
}

function drawRiderLegsSouthwest(p) {
  row(p, 18, 12, 20, PAL.leatherMid);
  row(p, 19, 11, 21, PAL.leatherShade);
  set(p, 11, 19, PAL.primaryMid);
  set(p, 21, 19, PAL.primaryMid);
  for (let y = 18; y <= 22; y++) {
    set(p, 17, y, PAL.leatherHi);
    set(p, 18, y, PAL.leatherMid);
    set(p, 12, y, PAL.leatherMid);
    set(p, 13, y, PAL.leatherShade);
  }
  for (let y = 23; y <= 25; y++) {
    set(p, 17, y, PAL.leatherMid);
    set(p, 18, y, PAL.leatherShade);
  }
}

function drawRiderLegsNortheast(p) {
  row(p, 18, 12, 20, PAL.leatherMid);
  row(p, 19, 11, 21, PAL.leatherShade);
  set(p, 11, 19, PAL.primaryMid);
  set(p, 21, 19, PAL.primaryMid);
  for (let y = 18; y <= 22; y++) {
    set(p, 14, y, PAL.leatherShade);
    set(p, 15, y, PAL.leatherMid);
    set(p, 19, y, PAL.leatherMid);
    set(p, 20, y, PAL.leatherShade);
  }
  for (let y = 23; y <= 25; y++) {
    set(p, 14, y, PAL.leatherShade);
    set(p, 15, y, PAL.leatherMid);
  }
}

function drawRiderLegsNorthwest(p) {
  row(p, 18, 11, 19, PAL.leatherMid);
  row(p, 19, 10, 20, PAL.leatherShade);
  set(p, 10, 19, PAL.primaryMid);
  set(p, 20, 19, PAL.primaryMid);
  for (let y = 18; y <= 22; y++) {
    set(p, 11, y, PAL.leatherShade);
    set(p, 12, y, PAL.leatherMid);
    set(p, 16, y, PAL.leatherMid);
    set(p, 17, y, PAL.leatherShade);
  }
  for (let y = 23; y <= 25; y++) {
    set(p, 16, y, PAL.leatherShade);
    set(p, 17, y, PAL.leatherMid);
  }
}

const RIDER_LEGS_DRAWERS = {
  N: drawRiderLegsNorth,
  NE: drawRiderLegsNortheast,
  E: drawRiderLegsEast,
  SE: drawRiderLegsSoutheast,
  S: drawRiderLegsSouth,
  SW: drawRiderLegsSouthwest,
  W: drawRiderLegsWest,
  NW: drawRiderLegsNorthwest,
};

function emitRiderLegs() {
  for (const { kit, fs } of DIRS) {
    const p = makeSprite();
    RIDER_LEGS_DRAWERS[kit](p);
    save(p, `anatomy/rider-legs/${fs}/idle.png`);
  }
}

// =====================================================================
// RIDER TORSO — bare-skinned torso (cuirass overlays this). Hip line at y=18,
// shoulder at y=12. Centered on x=15-16.
// =====================================================================

function drawRiderTorsoSouth(p) {
  // Front view of torso (rows 12-18) — chest expanded slightly.
  row(p, 12, 13, 18, PAL.skinMid);
  row(p, 13, 13, 18, PAL.skinMid);
  set(p, 13, 13, PAL.skinShade);
  set(p, 18, 13, PAL.skinShade);
  row(p, 14, 12, 19, PAL.skinMid);
  set(p, 12, 14, PAL.skinShade);
  set(p, 19, 14, PAL.skinShade);
  row(p, 15, 12, 19, PAL.skinMid);
  row(p, 16, 12, 19, PAL.skinMid);
  row(p, 17, 13, 18, PAL.skinShade);
  row(p, 18, 13, 18, PAL.skinShade);
  // Highlight chest centre
  set(p, 15, 13, PAL.skinHi);
  set(p, 16, 13, PAL.skinHi);
  set(p, 15, 14, PAL.skinHi);
  set(p, 16, 14, PAL.skinHi);
}

function drawRiderTorsoNorth(p) {
  // Back of torso. Same outline but darker — back muscles.
  row(p, 12, 13, 18, PAL.skinShade);
  row(p, 13, 13, 18, PAL.skinShade);
  row(p, 14, 12, 19, PAL.skinShade);
  row(p, 15, 12, 19, PAL.skinShade);
  row(p, 16, 12, 19, PAL.skinShade);
  row(p, 17, 13, 18, PAL.skinShade);
  row(p, 18, 13, 18, PAL.skinShade);
}

function drawRiderTorsoEast(p) {
  // Side view: torso silhouette as narrow rectangle, chest forward.
  row(p, 12, 13, 17, PAL.skinMid);
  row(p, 13, 12, 17, PAL.skinMid);
  set(p, 17, 13, PAL.skinHi);
  row(p, 14, 12, 17, PAL.skinMid);
  row(p, 15, 12, 17, PAL.skinMid);
  set(p, 17, 14, PAL.skinHi);
  set(p, 17, 15, PAL.skinHi);
  row(p, 16, 13, 17, PAL.skinMid);
  row(p, 17, 13, 16, PAL.skinShade);
}

function drawRiderTorsoWest(p) {
  row(p, 12, 14, 18, PAL.skinMid);
  row(p, 13, 14, 19, PAL.skinMid);
  set(p, 14, 13, PAL.skinHi);
  row(p, 14, 14, 19, PAL.skinMid);
  row(p, 15, 14, 19, PAL.skinMid);
  set(p, 14, 14, PAL.skinHi);
  set(p, 14, 15, PAL.skinHi);
  row(p, 16, 14, 18, PAL.skinMid);
  row(p, 17, 15, 18, PAL.skinShade);
}

function drawRiderTorsoSoutheast(p) {
  row(p, 12, 13, 18, PAL.skinMid);
  row(p, 13, 12, 18, PAL.skinMid);
  set(p, 18, 13, PAL.skinHi);
  row(p, 14, 12, 18, PAL.skinMid);
  row(p, 15, 12, 18, PAL.skinMid);
  set(p, 18, 14, PAL.skinHi);
  row(p, 16, 13, 18, PAL.skinMid);
  row(p, 17, 13, 17, PAL.skinShade);
}

function drawRiderTorsoSouthwest(p) {
  row(p, 12, 13, 18, PAL.skinMid);
  row(p, 13, 13, 19, PAL.skinMid);
  set(p, 13, 13, PAL.skinHi);
  row(p, 14, 13, 19, PAL.skinMid);
  row(p, 15, 13, 19, PAL.skinMid);
  set(p, 13, 14, PAL.skinHi);
  row(p, 16, 13, 18, PAL.skinMid);
  row(p, 17, 14, 18, PAL.skinShade);
}

function drawRiderTorsoNortheast(p) {
  row(p, 12, 13, 18, PAL.skinShade);
  row(p, 13, 12, 18, PAL.skinShade);
  row(p, 14, 12, 18, PAL.skinShade);
  row(p, 15, 12, 18, PAL.skinShade);
  row(p, 16, 13, 18, PAL.skinShade);
  row(p, 17, 13, 17, PAL.skinShade);
}

function drawRiderTorsoNorthwest(p) {
  row(p, 12, 13, 18, PAL.skinShade);
  row(p, 13, 13, 19, PAL.skinShade);
  row(p, 14, 13, 19, PAL.skinShade);
  row(p, 15, 13, 19, PAL.skinShade);
  row(p, 16, 13, 18, PAL.skinShade);
  row(p, 17, 14, 18, PAL.skinShade);
}

const RIDER_TORSO_DRAWERS = {
  N: drawRiderTorsoNorth,
  NE: drawRiderTorsoNortheast,
  E: drawRiderTorsoEast,
  SE: drawRiderTorsoSoutheast,
  S: drawRiderTorsoSouth,
  SW: drawRiderTorsoSouthwest,
  W: drawRiderTorsoWest,
  NW: drawRiderTorsoNorthwest,
};

function emitRiderTorso() {
  for (const { kit, fs } of DIRS) {
    const p = makeSprite();
    RIDER_TORSO_DRAWERS[kit](p);
    save(p, `anatomy/rider-torso/${fs}/idle.png`);
  }
}

// =====================================================================
// CUIRASS — steel breastplate. Overlays torso. Primary marker on edge trim
// (regimental piping). Same layout per facing as torso but with the
// signature curved breastplate and shoulder straps.
// =====================================================================

function drawCuirassSouth(p) {
  // Front breastplate — wider than torso, hard steel reflection on chest.
  row(p, 12, 13, 18, PAL.steelMid);
  // Shoulder straps (red/primary regimental piping)
  set(p, 12, 12, PAL.primaryMid);
  set(p, 19, 12, PAL.primaryMid);
  set(p, 13, 12, PAL.primaryShade);
  set(p, 18, 12, PAL.primaryShade);
  // Neckline opening
  set(p, 15, 12, PAL.skinMid);
  set(p, 16, 12, PAL.skinMid);
  // Body of cuirass
  row(p, 13, 12, 19, PAL.steelMid);
  set(p, 12, 13, PAL.steelShade);
  set(p, 19, 13, PAL.steelShade);
  row(p, 14, 12, 19, PAL.steelMid);
  set(p, 12, 14, PAL.steelShade);
  set(p, 19, 14, PAL.steelShade);
  row(p, 15, 12, 19, PAL.steelMid);
  set(p, 12, 15, PAL.steelShade);
  set(p, 19, 15, PAL.steelShade);
  row(p, 16, 12, 19, PAL.steelMid);
  set(p, 12, 16, PAL.steelShade);
  set(p, 19, 16, PAL.steelShade);
  row(p, 17, 13, 18, PAL.steelShade);
  // Highlight ridge down centre
  set(p, 15, 13, PAL.steelHi);
  set(p, 16, 13, PAL.steelHi);
  set(p, 15, 14, PAL.steelHi);
  set(p, 16, 14, PAL.steelHi);
  set(p, 15, 15, PAL.steelHi);
  set(p, 16, 15, PAL.steelHi);
  // Lower edge primary trim
  row(p, 17, 13, 18, PAL.primaryMid);
}

function drawCuirassNorth(p) {
  // Backplate — flatter, no breastplate ridge, shows shoulder straps from rear.
  row(p, 12, 13, 18, PAL.steelShade);
  set(p, 12, 12, PAL.primaryMid);
  set(p, 19, 12, PAL.primaryMid);
  row(p, 13, 12, 19, PAL.steelMid);
  set(p, 12, 13, PAL.steelDeep);
  set(p, 19, 13, PAL.steelDeep);
  row(p, 14, 12, 19, PAL.steelMid);
  set(p, 12, 14, PAL.steelDeep);
  set(p, 19, 14, PAL.steelDeep);
  row(p, 15, 12, 19, PAL.steelShade);
  set(p, 12, 15, PAL.steelDeep);
  set(p, 19, 15, PAL.steelDeep);
  row(p, 16, 12, 19, PAL.steelShade);
  row(p, 17, 13, 18, PAL.primaryMid);
}

function drawCuirassEast(p) {
  // Side: cuirass reads as steel slab on torso side.
  row(p, 12, 13, 17, PAL.steelMid);
  set(p, 17, 12, PAL.primaryMid);
  set(p, 13, 12, PAL.primaryShade);
  for (let y = 13; y <= 16; y++) {
    set(p, 12, y, PAL.steelShade);
    set(p, 13, y, PAL.steelMid);
    set(p, 14, y, PAL.steelHi);
    set(p, 15, y, PAL.steelMid);
    set(p, 16, y, PAL.steelMid);
    set(p, 17, y, PAL.steelShade);
  }
  row(p, 17, 13, 16, PAL.primaryMid);
}

function drawCuirassWest(p) {
  row(p, 12, 14, 18, PAL.steelMid);
  set(p, 14, 12, PAL.primaryMid);
  set(p, 18, 12, PAL.primaryShade);
  for (let y = 13; y <= 16; y++) {
    set(p, 14, y, PAL.steelShade);
    set(p, 15, y, PAL.steelMid);
    set(p, 16, y, PAL.steelHi);
    set(p, 17, y, PAL.steelMid);
    set(p, 18, y, PAL.steelShade);
  }
  row(p, 17, 15, 18, PAL.primaryMid);
}

function drawCuirassSoutheast(p) {
  row(p, 12, 13, 18, PAL.steelMid);
  set(p, 18, 12, PAL.primaryMid);
  set(p, 13, 12, PAL.primaryShade);
  for (let y = 13; y <= 16; y++) {
    set(p, 13, y, PAL.steelShade);
    set(p, 14, y, PAL.steelMid);
    set(p, 15, y, PAL.steelHi);
    set(p, 16, y, PAL.steelMid);
    set(p, 17, y, PAL.steelMid);
    set(p, 18, y, PAL.steelShade);
  }
  row(p, 17, 13, 17, PAL.primaryMid);
}

function drawCuirassSouthwest(p) {
  row(p, 12, 13, 18, PAL.steelMid);
  set(p, 13, 12, PAL.primaryMid);
  set(p, 18, 12, PAL.primaryShade);
  for (let y = 13; y <= 16; y++) {
    set(p, 13, y, PAL.steelShade);
    set(p, 14, y, PAL.steelMid);
    set(p, 15, y, PAL.steelMid);
    set(p, 16, y, PAL.steelHi);
    set(p, 17, y, PAL.steelMid);
    set(p, 18, y, PAL.steelShade);
  }
  row(p, 17, 14, 18, PAL.primaryMid);
}

function drawCuirassNortheast(p) {
  row(p, 12, 13, 18, PAL.steelShade);
  set(p, 18, 12, PAL.primaryMid);
  for (let y = 13; y <= 16; y++) {
    set(p, 13, y, PAL.steelDeep);
    set(p, 14, y, PAL.steelShade);
    set(p, 15, y, PAL.steelShade);
    set(p, 16, y, PAL.steelShade);
    set(p, 17, y, PAL.steelShade);
    set(p, 18, y, PAL.steelDeep);
  }
  row(p, 17, 13, 17, PAL.primaryMid);
}

function drawCuirassNorthwest(p) {
  row(p, 12, 13, 18, PAL.steelShade);
  set(p, 13, 12, PAL.primaryMid);
  for (let y = 13; y <= 16; y++) {
    set(p, 13, y, PAL.steelDeep);
    set(p, 14, y, PAL.steelShade);
    set(p, 15, y, PAL.steelShade);
    set(p, 16, y, PAL.steelShade);
    set(p, 17, y, PAL.steelShade);
    set(p, 18, y, PAL.steelDeep);
  }
  row(p, 17, 14, 18, PAL.primaryMid);
}

const CUIRASS_DRAWERS = {
  N: drawCuirassNorth,
  NE: drawCuirassNortheast,
  E: drawCuirassEast,
  SE: drawCuirassSoutheast,
  S: drawCuirassSouth,
  SW: drawCuirassSouthwest,
  W: drawCuirassWest,
  NW: drawCuirassNorthwest,
};

function emitCuirass() {
  for (const { kit, fs } of DIRS) {
    const p = makeSprite();
    CUIRASS_DRAWERS[kit](p);
    save(p, `armor/cuirass/${fs}/base.png`);
  }
}

// =====================================================================
// HELMET — cuirassier helmet with horsehair plume. Steel cap (rows 6-10),
// plume (secondary cyan marker, rows 1-6 trailing back). Face peeks below.
// =====================================================================

function drawHelmetSouth(p) {
  // Plume tips (back of head, secondary marker)
  set(p, 15, 4, PAL.secondaryMid);
  set(p, 16, 4, PAL.secondaryMid);
  set(p, 14, 5, PAL.secondaryShade);
  set(p, 15, 5, PAL.secondaryHi);
  set(p, 16, 5, PAL.secondaryHi);
  set(p, 17, 5, PAL.secondaryShade);
  set(p, 14, 6, PAL.secondaryMid);
  set(p, 17, 6, PAL.secondaryMid);
  // Helmet cap (steel)
  row(p, 7, 13, 18, PAL.steelMid);
  set(p, 13, 7, PAL.steelShade);
  set(p, 18, 7, PAL.steelShade);
  row(p, 8, 12, 19, PAL.steelMid);
  set(p, 12, 8, PAL.steelShade);
  set(p, 19, 8, PAL.steelShade);
  row(p, 9, 12, 19, PAL.steelMid);
  set(p, 12, 9, PAL.steelShade);
  set(p, 19, 9, PAL.steelShade);
  // Brim / visor
  row(p, 10, 12, 19, PAL.steelDeep);
  // Highlight
  set(p, 15, 7, PAL.steelHi);
  set(p, 16, 7, PAL.steelHi);
  // Face below brim (skin showing)
  row(p, 11, 14, 17, PAL.skinMid);
  set(p, 14, 11, PAL.skinShade);
  set(p, 17, 11, PAL.skinShade);
  // Eyes
  set(p, 15, 11, PAL.black);
  set(p, 16, 11, PAL.black);
}

function drawHelmetNorth(p) {
  // Back of head — plume cascading down nape
  set(p, 15, 4, PAL.secondaryMid);
  set(p, 16, 4, PAL.secondaryMid);
  set(p, 15, 5, PAL.secondaryHi);
  set(p, 16, 5, PAL.secondaryHi);
  set(p, 14, 6, PAL.secondaryMid);
  set(p, 15, 6, PAL.secondaryMid);
  set(p, 16, 6, PAL.secondaryMid);
  set(p, 17, 6, PAL.secondaryMid);
  set(p, 15, 7, PAL.secondaryShade);
  set(p, 16, 7, PAL.secondaryShade);
  set(p, 15, 8, PAL.secondaryShade);
  set(p, 16, 8, PAL.secondaryShade);
  // Cap
  row(p, 7, 13, 18, PAL.steelShade);
  row(p, 8, 12, 19, PAL.steelShade);
  row(p, 9, 12, 19, PAL.steelShade);
  row(p, 10, 12, 19, PAL.steelDeep);
  // Hair tuft below cap
  row(p, 11, 14, 17, PAL.leatherShade);
}

function drawHelmetEast(p) {
  // Side: plume sweeps backward (left side).
  set(p, 11, 5, PAL.secondaryMid);
  set(p, 12, 5, PAL.secondaryHi);
  set(p, 13, 5, PAL.secondaryMid);
  set(p, 11, 6, PAL.secondaryMid);
  set(p, 12, 6, PAL.secondaryMid);
  set(p, 10, 6, PAL.secondaryShade);
  // Cap (right side)
  row(p, 7, 13, 17, PAL.steelMid);
  set(p, 13, 7, PAL.steelShade);
  row(p, 8, 12, 18, PAL.steelMid);
  set(p, 12, 8, PAL.steelShade);
  set(p, 18, 8, PAL.steelHi);
  row(p, 9, 12, 18, PAL.steelMid);
  set(p, 18, 9, PAL.steelHi);
  row(p, 10, 12, 18, PAL.steelDeep);
  // Face peek (right edge)
  set(p, 17, 11, PAL.skinMid);
  set(p, 18, 11, PAL.skinMid);
  set(p, 18, 11, PAL.black);  // eye
}

function drawHelmetWest(p) {
  set(p, 19, 5, PAL.secondaryMid);
  set(p, 20, 5, PAL.secondaryHi);
  set(p, 18, 5, PAL.secondaryMid);
  set(p, 19, 6, PAL.secondaryMid);
  set(p, 20, 6, PAL.secondaryMid);
  set(p, 21, 6, PAL.secondaryShade);
  row(p, 7, 14, 18, PAL.steelMid);
  set(p, 18, 7, PAL.steelShade);
  row(p, 8, 13, 19, PAL.steelMid);
  set(p, 19, 8, PAL.steelShade);
  set(p, 13, 8, PAL.steelHi);
  row(p, 9, 13, 19, PAL.steelMid);
  set(p, 13, 9, PAL.steelHi);
  row(p, 10, 13, 19, PAL.steelDeep);
  set(p, 13, 11, PAL.skinMid);
  set(p, 14, 11, PAL.skinMid);
  set(p, 13, 11, PAL.black);
}

function drawHelmetSoutheast(p) {
  set(p, 13, 5, PAL.secondaryMid);
  set(p, 14, 5, PAL.secondaryHi);
  set(p, 12, 6, PAL.secondaryMid);
  set(p, 13, 6, PAL.secondaryShade);
  row(p, 7, 13, 18, PAL.steelMid);
  row(p, 8, 12, 19, PAL.steelMid);
  set(p, 19, 8, PAL.steelHi);
  row(p, 9, 12, 19, PAL.steelMid);
  set(p, 19, 9, PAL.steelHi);
  row(p, 10, 12, 19, PAL.steelDeep);
  row(p, 11, 14, 18, PAL.skinMid);
  set(p, 17, 11, PAL.black);
}

function drawHelmetSouthwest(p) {
  set(p, 18, 5, PAL.secondaryMid);
  set(p, 17, 5, PAL.secondaryHi);
  set(p, 19, 6, PAL.secondaryMid);
  set(p, 18, 6, PAL.secondaryShade);
  row(p, 7, 13, 18, PAL.steelMid);
  row(p, 8, 12, 19, PAL.steelMid);
  set(p, 12, 8, PAL.steelHi);
  row(p, 9, 12, 19, PAL.steelMid);
  set(p, 12, 9, PAL.steelHi);
  row(p, 10, 12, 19, PAL.steelDeep);
  row(p, 11, 13, 17, PAL.skinMid);
  set(p, 14, 11, PAL.black);
}

function drawHelmetNortheast(p) {
  set(p, 13, 4, PAL.secondaryMid);
  set(p, 14, 4, PAL.secondaryHi);
  set(p, 13, 5, PAL.secondaryMid);
  set(p, 12, 5, PAL.secondaryShade);
  set(p, 13, 6, PAL.secondaryShade);
  row(p, 7, 13, 18, PAL.steelShade);
  row(p, 8, 12, 19, PAL.steelShade);
  row(p, 9, 12, 19, PAL.steelShade);
  row(p, 10, 12, 19, PAL.steelDeep);
}

function drawHelmetNorthwest(p) {
  set(p, 18, 4, PAL.secondaryMid);
  set(p, 17, 4, PAL.secondaryHi);
  set(p, 18, 5, PAL.secondaryMid);
  set(p, 19, 5, PAL.secondaryShade);
  set(p, 18, 6, PAL.secondaryShade);
  row(p, 7, 13, 18, PAL.steelShade);
  row(p, 8, 12, 19, PAL.steelShade);
  row(p, 9, 12, 19, PAL.steelShade);
  row(p, 10, 12, 19, PAL.steelDeep);
}

const HELMET_DRAWERS = {
  N: drawHelmetNorth,
  NE: drawHelmetNortheast,
  E: drawHelmetEast,
  SE: drawHelmetSoutheast,
  S: drawHelmetSouth,
  SW: drawHelmetSouthwest,
  W: drawHelmetWest,
  NW: drawHelmetNorthwest,
};

function emitHelmet() {
  for (const { kit, fs } of DIRS) {
    const p = makeSprite();
    HELMET_DRAWERS[kit](p);
    save(p, `headgear/helmet-cuirassier/${fs}/base.png`);
  }
}

// =====================================================================
// RIDER ARMS (idle) — neutral arms, hands forward at reins. Skin + leather
// gloves. Comes after cuirass so the cuffs cover the breastplate edge.
// =====================================================================

function drawRiderArmsSouth(p) {
  // Both arms hang slightly forward, hands meeting at saddle pommel x=15-16, y=18.
  // Left arm
  set(p, 11, 13, PAL.skinShade);
  set(p, 11, 14, PAL.primaryMid);  // sleeve
  set(p, 11, 15, PAL.primaryMid);
  set(p, 12, 16, PAL.primaryMid);
  set(p, 13, 17, PAL.skinMid);     // hand
  // Right arm
  set(p, 20, 13, PAL.skinShade);
  set(p, 20, 14, PAL.primaryMid);
  set(p, 20, 15, PAL.primaryMid);
  set(p, 19, 16, PAL.primaryMid);
  set(p, 18, 17, PAL.skinMid);
  // Reins (leather strands)
  set(p, 14, 18, PAL.leatherShade);
  set(p, 15, 18, PAL.leatherMid);
  set(p, 16, 18, PAL.leatherMid);
  set(p, 17, 18, PAL.leatherShade);
}

function drawRiderArmsNorth(p) {
  // Back: shoulders + sleeves visible, hands not (front of horse).
  set(p, 11, 13, PAL.primaryShade);
  set(p, 12, 13, PAL.primaryMid);
  set(p, 11, 14, PAL.primaryMid);
  set(p, 11, 15, PAL.primaryMid);
  set(p, 19, 13, PAL.primaryMid);
  set(p, 20, 13, PAL.primaryShade);
  set(p, 20, 14, PAL.primaryMid);
  set(p, 20, 15, PAL.primaryMid);
}

function drawRiderArmsEast(p) {
  // Side: viewer-side arm extends forward to reins, far arm partly hidden.
  // Near (right) arm
  set(p, 17, 13, PAL.primaryMid);
  set(p, 17, 14, PAL.primaryMid);
  set(p, 18, 15, PAL.primaryMid);
  set(p, 18, 16, PAL.skinMid);  // hand
  // Reins
  set(p, 19, 16, PAL.leatherShade);
  set(p, 20, 16, PAL.leatherMid);
  set(p, 21, 17, PAL.leatherShade);
}

function drawRiderArmsWest(p) {
  set(p, 14, 13, PAL.primaryMid);
  set(p, 14, 14, PAL.primaryMid);
  set(p, 13, 15, PAL.primaryMid);
  set(p, 13, 16, PAL.skinMid);
  set(p, 12, 16, PAL.leatherShade);
  set(p, 11, 16, PAL.leatherMid);
  set(p, 10, 17, PAL.leatherShade);
}

function drawRiderArmsSoutheast(p) {
  set(p, 12, 13, PAL.primaryShade);
  set(p, 12, 14, PAL.primaryMid);
  set(p, 13, 15, PAL.primaryMid);
  set(p, 14, 16, PAL.skinMid);
  set(p, 18, 13, PAL.primaryMid);
  set(p, 19, 14, PAL.primaryMid);
  set(p, 19, 15, PAL.primaryMid);
  set(p, 19, 16, PAL.skinMid);
  set(p, 16, 17, PAL.leatherMid);
  set(p, 17, 17, PAL.leatherShade);
}

function drawRiderArmsSouthwest(p) {
  set(p, 12, 13, PAL.primaryMid);
  set(p, 12, 14, PAL.primaryMid);
  set(p, 12, 15, PAL.primaryMid);
  set(p, 12, 16, PAL.skinMid);
  set(p, 19, 13, PAL.primaryShade);
  set(p, 19, 14, PAL.primaryMid);
  set(p, 18, 15, PAL.primaryMid);
  set(p, 17, 16, PAL.skinMid);
  set(p, 14, 17, PAL.leatherShade);
  set(p, 15, 17, PAL.leatherMid);
}

function drawRiderArmsNortheast(p) {
  set(p, 12, 13, PAL.primaryShade);
  set(p, 12, 14, PAL.primaryShade);
  set(p, 19, 13, PAL.primaryMid);
  set(p, 19, 14, PAL.primaryMid);
  set(p, 19, 15, PAL.primaryShade);
}

function drawRiderArmsNorthwest(p) {
  set(p, 19, 13, PAL.primaryShade);
  set(p, 19, 14, PAL.primaryShade);
  set(p, 12, 13, PAL.primaryMid);
  set(p, 12, 14, PAL.primaryMid);
  set(p, 12, 15, PAL.primaryShade);
}

const RIDER_ARMS_DRAWERS = {
  N: drawRiderArmsNorth,
  NE: drawRiderArmsNortheast,
  E: drawRiderArmsEast,
  SE: drawRiderArmsSoutheast,
  S: drawRiderArmsSouth,
  SW: drawRiderArmsSouthwest,
  W: drawRiderArmsWest,
  NW: drawRiderArmsNorthwest,
};

function emitRiderArms() {
  for (const { kit, fs } of DIRS) {
    const p = makeSprite();
    RIDER_ARMS_DRAWERS[kit](p);
    save(p, `anatomy/rider-arms/${fs}/idle.png`);
  }
}

// =====================================================================
// SABER — 3 source facings (N, NW, W). Sheathed at hip in idle, blade
// pointed downward. Steel blade + brass guard.
// =====================================================================

function drawSaberNorth(p) {
  // From behind: scabbard hangs down rider's left side (viewer's right).
  // Hilt at top, blade tip at bottom.
  set(p, 19, 13, PAL.brassMid);    // pommel
  set(p, 19, 14, PAL.brassHi);     // grip
  set(p, 19, 15, PAL.brassMid);
  set(p, 18, 16, PAL.brassShade);  // guard
  set(p, 19, 16, PAL.brassMid);
  set(p, 20, 16, PAL.brassShade);
  // Scabbard (steel)
  set(p, 19, 17, PAL.steelMid);
  set(p, 19, 18, PAL.steelMid);
  set(p, 19, 19, PAL.steelShade);
  set(p, 19, 20, PAL.steelShade);
  set(p, 19, 21, PAL.steelDeep);
  // Tip
  set(p, 19, 22, PAL.brassMid);
}

function drawSaberNorthwest(p) {
  // 3/4 back-left: scabbard angles slightly toward bottom-right
  set(p, 17, 13, PAL.brassMid);
  set(p, 17, 14, PAL.brassHi);
  set(p, 18, 15, PAL.brassMid);
  set(p, 18, 16, PAL.steelMid);
  set(p, 19, 17, PAL.steelMid);
  set(p, 19, 18, PAL.steelShade);
  set(p, 20, 19, PAL.steelShade);
  set(p, 20, 20, PAL.steelDeep);
  set(p, 21, 21, PAL.brassMid);
}

function drawSaberWest(p) {
  // Side view: saber sheathed across back of saddle horizontally trailing
  // behind rider. Hilt forward (right), tip behind (left).
  set(p, 14, 17, PAL.brassMid);    // pommel
  set(p, 15, 17, PAL.brassHi);     // grip
  set(p, 16, 17, PAL.brassMid);
  set(p, 17, 17, PAL.brassShade);  // guard
  // Blade angled down-right toward stirrup
  set(p, 17, 18, PAL.steelMid);
  set(p, 18, 18, PAL.steelMid);
  set(p, 18, 19, PAL.steelMid);
  set(p, 19, 19, PAL.steelShade);
  set(p, 19, 20, PAL.steelShade);
  set(p, 20, 20, PAL.steelDeep);
  set(p, 20, 21, PAL.steelDeep);
  set(p, 21, 21, PAL.brassMid); // tip / chape
}

function emitSaber() {
  // Only N, NW, W — the kit JSON's weapon block derives the rest at runtime.
  const sources = [
    { kit: 'N',  fs: 'north',     draw: drawSaberNorth },
    { kit: 'NW', fs: 'northwest', draw: drawSaberNorthwest },
    { kit: 'W',  fs: 'west',      draw: drawSaberWest },
  ];
  for (const { fs, draw } of sources) {
    const p = makeSprite();
    draw(p);
    save(p, `weapon/saber/${fs}/idle.png`);
  }
}

// =====================================================================
// REGISTRY UPDATE — append entries to public/components/index.json idempotently.
// =====================================================================

function registryEntries() {
  const entries = [];
  for (const { kit, fs } of DIRS) {
    // Horse walk frames
    for (let i = 0; i < 4; i++) {
      entries.push({
        id: `horse-bay-${fs}-walk-${i}`,
        type: 'anatomy',
        category: 'horse',
        facings: [kit],
        path: `anatomy/horse/${fs}/walk-${i}.png`,
        pivot: [16, 32],
        notes: `Bay horse walk frame ${i} (procedural).`,
      });
    }
    // Horse run frames
    for (let i = 0; i < 6; i++) {
      entries.push({
        id: `horse-bay-${fs}-run-${i}`,
        type: 'anatomy',
        category: 'horse',
        facings: [kit],
        path: `anatomy/horse/${fs}/run-${i}.png`,
        pivot: [16, 32],
        notes: `Bay horse run frame ${i} (procedural).`,
      });
    }
    // Rider torso
    entries.push({
      id: `rider-torso-${fs}`,
      type: 'anatomy',
      category: 'rider-torso',
      facings: [kit],
      path: `anatomy/rider-torso/${fs}/idle.png`,
      pivot: [16, 32],
      notes: 'Cuirassier rider torso (procedural).',
    });
    // Rider legs
    entries.push({
      id: `rider-legs-${fs}`,
      type: 'anatomy',
      category: 'rider-legs',
      facings: [kit],
      path: `anatomy/rider-legs/${fs}/idle.png`,
      pivot: [16, 32],
      notes: 'Cuirassier rider legs / boots (procedural).',
    });
    // Rider arms idle
    entries.push({
      id: `rider-arms-${fs}-idle`,
      type: 'anatomy',
      category: 'rider-arms',
      facings: [kit],
      path: `anatomy/rider-arms/${fs}/idle.png`,
      pivot: [16, 32],
      notes: 'Cuirassier rider arms, idle / hands on reins (procedural).',
    });
    // Cuirass (armor)
    entries.push({
      id: `cuirass-${fs}`,
      type: 'armor',
      category: 'cuirass',
      facings: [kit],
      path: `armor/cuirass/${fs}/base.png`,
      pivot: [16, 32],
      notes: 'Cuirassier steel cuirass with regiment trim (procedural).',
    });
    // Helmet (headgear)
    entries.push({
      id: `helmet-cuirassier-${fs}`,
      type: 'uniform',
      category: 'headgear',
      facings: [kit],
      path: `headgear/helmet-cuirassier/${fs}/base.png`,
      pivot: [16, 32],
      notes: 'Cuirassier plumed helmet (procedural).',
    });
  }
  // Saber — 3 source facings only
  for (const { kit, fs } of [
    { kit: 'N',  fs: 'north' },
    { kit: 'NW', fs: 'northwest' },
    { kit: 'W',  fs: 'west' },
  ]) {
    entries.push({
      id: `saber-${fs}`,
      type: 'weapon',
      category: 'primary',
      facings: [kit],
      path: `weapon/saber/${fs}/idle.png`,
      pivot: [16, 32],
      notes: 'Cuirassier saber, idle / sheathed (procedural). Other facings derived at runtime.',
    });
  }
  return entries;
}

function updateRegistry() {
  const raw = readFileSync(REGISTRY_PATH, 'utf8');
  const reg = JSON.parse(raw);
  if (!reg.components || !Array.isArray(reg.components)) {
    throw new Error('public/components/index.json is malformed (missing components array)');
  }
  const existingIds = new Set(reg.components.map((c) => c.id));
  let added = 0;
  for (const entry of registryEntries()) {
    if (existingIds.has(entry.id)) continue;
    reg.components.push(entry);
    added++;
  }
  if (added > 0) {
    writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n');
    console.log(`Registered ${added} cuirassier component entries in ${REGISTRY_PATH}`);
  } else {
    console.log('Cuirassier component registry already up to date.');
  }
}

// =====================================================================
// MAIN
// =====================================================================

console.log('Drawing cuirassier components:');
console.log('  Horse (idle + walk-0..3 + run-0..5, 8 facings):');
emitHorseAllFacings();
console.log('  Rider torso (8 facings):');
emitRiderTorso();
console.log('  Rider legs (8 facings):');
emitRiderLegs();
console.log('  Cuirass (8 facings):');
emitCuirass();
console.log('  Helmet (8 facings):');
emitHelmet();
console.log('  Rider arms (idle, 8 facings):');
emitRiderArms();
console.log('  Saber (3 source facings: N, NW, W):');
emitSaber();
console.log('Updating component registry:');
updateRegistry();
console.log('Done.');
