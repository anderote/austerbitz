#!/usr/bin/env node
// Hand-painted chibi pixel components for the cuirassier (heavy cavalry) kit.
// Each call writes one 32x36 RGBA PNG with transparent background.
// Modeled on scripts/redraw-components.mjs (line-infantry components).
//
// V1 scope: HORSE only, all 8 facings. Rider components (body, breastplate,
// helmet, saber) come later as separate composable layers stacked on top.
//
// Layout convention (32w x 36h):
//   y=0..11   reserved for rider/saddle composables (transparent)
//   y=12..28  horse body (head, neck, torso, legs)
//   y=29..30  ground shadow (semi-alpha)
//   x centred at 16 (chibi proportions; horse body ~14 px wide for side
//   facings, ~10 px wide for front/back)

import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COMPONENTS = resolve(ROOT, 'public/sprites/components');

const W = 32;
const H = 36;

// Bay horse palette (warm brown + dark brown shading + black mane/tail/hooves).
// Saddle/blanket would be a separate layer; horse art here is rider-less.
const PAL = {
  shadow: '#000000',
  // Bay coat
  coatHi: '#A56B3A',     // sunlit highlight
  coatMid: '#8A4F26',    // body main
  coatShade: '#5C3318',  // shaded side / underbelly
  coatDeep: '#3A1F0E',   // deep occlusion
  // Mane / tail / hooves / muzzle shadow
  black: '#1A1414',
  // Eye + nostril
  eyeWhite: '#E0D8C8',
  // Hoof highlight
  hoofMid: '#2C1F18',
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

// Common ground shadow under the horse. Wider than infantry (4 hooves).
function drawShadow(p, x0, x1) {
  row(p, 30, x0, x1, PAL.shadow, 110);
  row(p, 29, x0 + 1, x1 - 1, PAL.shadow, 70);
}

// =====================================================================
// SOUTH (front view) — horse facing the camera, ears + eyes + chest visible.
// Rider would sit on rows 8-22; horse fills rows 13-28.
// =====================================================================
function drawHorseSouth() {
  const p = makeSprite();
  drawShadow(p, 11, 20);

  // Ears (rows 13-14, x=13 + x=18)
  set(p, 13, 13, PAL.coatShade);
  set(p, 18, 13, PAL.coatShade);
  set(p, 13, 14, PAL.coatMid);
  set(p, 18, 14, PAL.coatMid);

  // Forelock (between ears) — black tuft
  set(p, 15, 13, PAL.black);
  set(p, 16, 13, PAL.black);
  row(p, 14, 14, 17, PAL.black);

  // Forehead / face top (rows 14-15) — wider than ears
  row(p, 15, 14, 17, PAL.coatMid);
  set(p, 14, 15, PAL.coatHi);
  set(p, 15, 15, PAL.coatMid);
  set(p, 16, 15, PAL.coatMid);
  set(p, 17, 15, PAL.coatShade);

  // Eyes (row 16): two black pixels with eye-white highlights
  set(p, 14, 16, PAL.black);
  set(p, 17, 16, PAL.black);
  set(p, 15, 16, PAL.coatMid);
  set(p, 16, 16, PAL.coatMid);

  // Cheeks / muzzle taper (rows 17-18)
  row(p, 17, 14, 17, PAL.coatMid);
  set(p, 14, 17, PAL.coatHi);
  set(p, 17, 17, PAL.coatShade);
  row(p, 18, 14, 17, PAL.coatShade);
  // Muzzle highlight + nostrils
  set(p, 15, 18, PAL.black);
  set(p, 16, 18, PAL.black);

  // Neck (rows 19-21) — narrower than head, sloping into body
  row(p, 19, 13, 18, PAL.coatMid);
  set(p, 13, 19, PAL.coatShade);
  set(p, 18, 19, PAL.coatHi);
  // Mane down right side of neck (front-on shows one side)
  set(p, 13, 19, PAL.black);
  set(p, 13, 20, PAL.black);

  row(p, 20, 13, 18, PAL.coatMid);
  set(p, 18, 20, PAL.coatShade);

  // Chest broadens (rows 21-23) — front-on bulk
  row(p, 21, 12, 19, PAL.coatMid);
  set(p, 12, 21, PAL.coatShade);
  set(p, 19, 21, PAL.coatShade);
  row(p, 22, 11, 20, PAL.coatMid);
  set(p, 11, 22, PAL.coatShade);
  set(p, 20, 22, PAL.coatShade);
  row(p, 23, 11, 20, PAL.coatMid);
  set(p, 11, 23, PAL.coatShade);
  set(p, 20, 23, PAL.coatShade);
  // Centre highlight column (chest down the middle)
  set(p, 15, 22, PAL.coatHi);
  set(p, 16, 22, PAL.coatHi);

  // Belly transition (row 24)
  row(p, 24, 12, 19, PAL.coatShade);
  // Inner-leg gap shadow row
  set(p, 15, 24, PAL.coatDeep);
  set(p, 16, 24, PAL.coatDeep);

  // Front legs visible — back legs hidden behind. Two legs at x=12-13 (left)
  // and x=18-19 (right).
  // Upper leg (rows 25-26)
  row(p, 25, 12, 13, PAL.coatMid);
  row(p, 25, 18, 19, PAL.coatMid);
  set(p, 12, 25, PAL.coatShade);
  set(p, 19, 25, PAL.coatShade);
  row(p, 26, 12, 13, PAL.coatShade);
  row(p, 26, 18, 19, PAL.coatShade);
  // Cannons / lower leg (rows 27-28) — slimmer
  set(p, 13, 27, PAL.coatMid);
  set(p, 18, 27, PAL.coatMid);
  set(p, 13, 28, PAL.coatShade);
  set(p, 18, 28, PAL.coatShade);
  // Hooves
  set(p, 13, 28, PAL.black);
  set(p, 18, 28, PAL.black);
  // Hoof shine
  set(p, 13, 27, PAL.hoofMid);
  set(p, 18, 27, PAL.hoofMid);

  save(p, 'anatomy/horse/south/idle.png');
}

// =====================================================================
// NORTH (back view) — horse facing away, rump + tail visible, head hidden.
// =====================================================================
function drawHorseNorth() {
  const p = makeSprite();
  drawShadow(p, 11, 20);

  // Rump / hindquarters at top (rows 13-22). No head visible.
  // Tail (rows 13-22) hangs down centre back.
  // Top of rump (apex)
  row(p, 13, 14, 17, PAL.coatShade);
  // Slight ear-tips peeking above rump? No — back view, head fully hidden.

  // Rump curve broadening downward
  row(p, 14, 13, 18, PAL.coatMid);
  set(p, 13, 14, PAL.coatShade);
  set(p, 18, 14, PAL.coatShade);
  row(p, 15, 12, 19, PAL.coatMid);
  set(p, 12, 15, PAL.coatShade);
  set(p, 19, 15, PAL.coatShade);
  row(p, 16, 12, 19, PAL.coatMid);
  set(p, 12, 16, PAL.coatShade);
  set(p, 19, 16, PAL.coatShade);
  // Highlight along back centre
  set(p, 15, 14, PAL.coatHi);
  set(p, 16, 14, PAL.coatHi);
  set(p, 15, 15, PAL.coatHi);
  set(p, 16, 15, PAL.coatHi);

  // Body mass continues
  row(p, 17, 11, 20, PAL.coatMid);
  set(p, 11, 17, PAL.coatShade);
  set(p, 20, 17, PAL.coatShade);
  row(p, 18, 11, 20, PAL.coatMid);
  set(p, 11, 18, PAL.coatShade);
  set(p, 20, 18, PAL.coatShade);
  row(p, 19, 11, 20, PAL.coatMid);
  set(p, 11, 19, PAL.coatShade);
  set(p, 20, 19, PAL.coatShade);

  // Tail — black streak hanging down centre, rows 15-22, x=15-16
  set(p, 15, 15, PAL.black);
  set(p, 16, 15, PAL.black);
  set(p, 15, 16, PAL.black);
  set(p, 16, 16, PAL.black);
  set(p, 16, 17, PAL.black);
  set(p, 16, 18, PAL.black);
  set(p, 16, 19, PAL.black);
  set(p, 16, 20, PAL.black);
  set(p, 15, 21, PAL.black);
  set(p, 16, 21, PAL.black);
  set(p, 16, 22, PAL.black);
  // Tail tip
  set(p, 15, 22, PAL.black);

  // Lower body / belly transition
  row(p, 20, 11, 20, PAL.coatShade);
  row(p, 21, 12, 19, PAL.coatShade);
  // Inner-leg gap deep shadow
  set(p, 15, 22, PAL.coatDeep);
  set(p, 16, 22, PAL.coatDeep);

  // Back legs at x=12-13 and x=18-19 (mirror of front view).
  row(p, 23, 12, 13, PAL.coatMid);
  row(p, 23, 18, 19, PAL.coatMid);
  set(p, 12, 23, PAL.coatShade);
  set(p, 19, 23, PAL.coatShade);
  row(p, 24, 12, 13, PAL.coatShade);
  row(p, 24, 18, 19, PAL.coatShade);
  // Hocks / cannons
  set(p, 13, 25, PAL.coatMid);
  set(p, 18, 25, PAL.coatMid);
  set(p, 13, 26, PAL.coatShade);
  set(p, 18, 26, PAL.coatShade);
  set(p, 13, 27, PAL.coatShade);
  set(p, 18, 27, PAL.coatShade);
  // Hooves
  set(p, 13, 28, PAL.black);
  set(p, 18, 28, PAL.black);

  save(p, 'anatomy/horse/north/idle.png');
}

// =====================================================================
// EAST (side view, facing right) — full horse profile, mane + tail + 4 legs
// visible. Wider footprint than front/back facings.
// =====================================================================
function drawHorseEast() {
  const p = makeSprite();
  drawShadow(p, 5, 27);

  // Head at right (rows 13-18, x=22-26)
  // Ears
  set(p, 24, 13, PAL.coatShade);
  set(p, 25, 13, PAL.coatShade);
  // Skull top
  row(p, 14, 23, 25, PAL.coatMid);
  set(p, 25, 14, PAL.coatHi);
  // Forehead + eye row
  row(p, 15, 22, 25, PAL.coatMid);
  set(p, 24, 15, PAL.black); // eye
  set(p, 25, 15, PAL.coatHi);
  // Cheek + muzzle (slopes down-right)
  row(p, 16, 22, 26, PAL.coatMid);
  set(p, 22, 16, PAL.coatShade);
  set(p, 26, 16, PAL.coatShade);
  row(p, 17, 23, 26, PAL.coatShade);
  set(p, 26, 17, PAL.black); // nostril
  set(p, 25, 17, PAL.coatDeep);

  // Neck slopes up-right from withers (x=16, y=18) to head (x=22, y=15)
  // Diagonal mane along top of neck (black row above coat)
  set(p, 17, 16, PAL.black);
  set(p, 18, 16, PAL.black);
  set(p, 19, 16, PAL.black);
  set(p, 20, 16, PAL.black);
  set(p, 21, 16, PAL.black);
  // Neck flesh
  set(p, 17, 17, PAL.coatMid);
  set(p, 18, 17, PAL.coatMid);
  set(p, 19, 17, PAL.coatMid);
  set(p, 20, 17, PAL.coatMid);
  set(p, 21, 17, PAL.coatMid);
  set(p, 22, 17, PAL.coatMid);
  set(p, 17, 18, PAL.coatShade);
  set(p, 18, 18, PAL.coatShade);
  set(p, 19, 18, PAL.coatShade);
  set(p, 20, 18, PAL.coatShade);

  // Body / barrel — long oval, rows 18-23, x=8-21
  row(p, 18, 8, 16, PAL.coatMid);
  set(p, 8, 18, PAL.coatShade);
  // Withers highlight
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
  // Belly shading
  row(p, 22, 8, 20, PAL.coatShade);
  set(p, 8, 22, PAL.coatDeep);
  set(p, 20, 22, PAL.coatDeep);
  row(p, 23, 9, 19, PAL.coatShade);

  // Tail at left (rear). Hangs from x=6, y=18 down to y=24.
  set(p, 6, 18, PAL.black);
  set(p, 6, 19, PAL.black);
  set(p, 6, 20, PAL.black);
  set(p, 6, 21, PAL.black);
  set(p, 5, 22, PAL.black);
  set(p, 6, 22, PAL.black);
  set(p, 5, 23, PAL.black);
  set(p, 6, 23, PAL.black);
  set(p, 5, 24, PAL.black);

  // Legs — 4 legs visible. Front pair at x=18-19, back pair at x=10-11.
  // Front legs
  set(p, 18, 24, PAL.coatMid);
  set(p, 19, 24, PAL.coatMid);
  set(p, 18, 25, PAL.coatShade);
  set(p, 19, 25, PAL.coatShade);
  set(p, 18, 26, PAL.coatShade);
  set(p, 19, 26, PAL.coatShade);
  set(p, 18, 27, PAL.coatShade);
  set(p, 19, 27, PAL.coatShade);
  set(p, 18, 28, PAL.black); // hooves
  set(p, 19, 28, PAL.black);
  // Back legs
  set(p, 10, 24, PAL.coatMid);
  set(p, 11, 24, PAL.coatMid);
  set(p, 10, 25, PAL.coatShade);
  set(p, 11, 25, PAL.coatShade);
  set(p, 10, 26, PAL.coatShade);
  set(p, 11, 26, PAL.coatShade);
  set(p, 10, 27, PAL.coatShade);
  set(p, 11, 27, PAL.coatShade);
  set(p, 10, 28, PAL.black);
  set(p, 11, 28, PAL.black);

  save(p, 'anatomy/horse/east/idle.png');
}

// =====================================================================
// WEST (side view, facing left) — mirror of EAST, head at left.
// Re-implemented (not just flipped) so we can tweak per-side asymmetry later.
// For now, hand-mirror EAST.
// =====================================================================
function drawHorseWest() {
  const p = makeSprite();
  drawShadow(p, 5, 27);

  // Head at left (rows 13-18, x=5-9)
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

  // Neck slopes up-left
  set(p, 10, 16, PAL.black);
  set(p, 11, 16, PAL.black);
  set(p, 12, 16, PAL.black);
  set(p, 13, 16, PAL.black);
  set(p, 14, 16, PAL.black);
  set(p, 9, 17, PAL.coatMid);
  set(p, 10, 17, PAL.coatMid);
  set(p, 11, 17, PAL.coatMid);
  set(p, 12, 17, PAL.coatMid);
  set(p, 13, 17, PAL.coatMid);
  set(p, 14, 17, PAL.coatMid);
  set(p, 11, 18, PAL.coatShade);
  set(p, 12, 18, PAL.coatShade);
  set(p, 13, 18, PAL.coatShade);
  set(p, 14, 18, PAL.coatShade);

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

  // Tail at right (rear).
  set(p, 25, 18, PAL.black);
  set(p, 25, 19, PAL.black);
  set(p, 25, 20, PAL.black);
  set(p, 25, 21, PAL.black);
  set(p, 25, 22, PAL.black);
  set(p, 26, 22, PAL.black);
  set(p, 25, 23, PAL.black);
  set(p, 26, 23, PAL.black);
  set(p, 26, 24, PAL.black);

  // Legs — front pair at x=12-13, back pair at x=20-21.
  set(p, 12, 24, PAL.coatMid);
  set(p, 13, 24, PAL.coatMid);
  set(p, 12, 25, PAL.coatShade);
  set(p, 13, 25, PAL.coatShade);
  set(p, 12, 26, PAL.coatShade);
  set(p, 13, 26, PAL.coatShade);
  set(p, 12, 27, PAL.coatShade);
  set(p, 13, 27, PAL.coatShade);
  set(p, 12, 28, PAL.black);
  set(p, 13, 28, PAL.black);
  set(p, 20, 24, PAL.coatMid);
  set(p, 21, 24, PAL.coatMid);
  set(p, 20, 25, PAL.coatShade);
  set(p, 21, 25, PAL.coatShade);
  set(p, 20, 26, PAL.coatShade);
  set(p, 21, 26, PAL.coatShade);
  set(p, 20, 27, PAL.coatShade);
  set(p, 21, 27, PAL.coatShade);
  set(p, 20, 28, PAL.black);
  set(p, 21, 28, PAL.black);

  save(p, 'anatomy/horse/west/idle.png');
}

// =====================================================================
// SOUTHEAST / SOUTHWEST / NORTHEAST / NORTHWEST — 3/4 views.
// V1: render compact 3/4 silhouettes derived from front/back rotated. These
// are placeholders — rough outlines so the system has all 8 facings, to be
// hand-tuned later once the user signs off on the front/side style.
// =====================================================================
function drawHorseSoutheast() {
  const p = makeSprite();
  drawShadow(p, 8, 24);
  // Compact 3/4: head at lower-right, rump at upper-left.
  // Head
  set(p, 22, 14, PAL.coatShade); set(p, 23, 14, PAL.coatShade); // ears
  row(p, 15, 21, 24, PAL.coatMid);
  set(p, 22, 16, PAL.black); // eye
  row(p, 16, 21, 24, PAL.coatMid);
  row(p, 17, 22, 24, PAL.coatShade);
  set(p, 24, 17, PAL.black); // nostril
  // Neck arc into body
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
  // Tail at upper-left rear
  set(p, 9, 19, PAL.black); set(p, 9, 20, PAL.black); set(p, 9, 21, PAL.black);
  set(p, 9, 22, PAL.black); set(p, 8, 23, PAL.black); set(p, 9, 23, PAL.black);
  // Legs (3/4 view shows 3-4 legs depending on stride; use 3 here)
  set(p, 12, 24, PAL.coatMid); set(p, 12, 25, PAL.coatShade);
  set(p, 12, 26, PAL.coatShade); set(p, 12, 27, PAL.coatShade);
  set(p, 12, 28, PAL.black);
  set(p, 16, 24, PAL.coatMid); set(p, 16, 25, PAL.coatShade);
  set(p, 16, 26, PAL.coatShade); set(p, 16, 27, PAL.coatShade);
  set(p, 16, 28, PAL.black);
  set(p, 20, 24, PAL.coatMid); set(p, 20, 25, PAL.coatShade);
  set(p, 20, 26, PAL.coatShade); set(p, 20, 27, PAL.coatShade);
  set(p, 20, 28, PAL.black);
  save(p, 'anatomy/horse/southeast/idle.png');
}

function drawHorseSouthwest() {
  // Mirror of SE: head at lower-left.
  const p = makeSprite();
  drawShadow(p, 7, 23);
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
  set(p, 22, 19, PAL.black); set(p, 22, 20, PAL.black); set(p, 22, 21, PAL.black);
  set(p, 22, 22, PAL.black); set(p, 22, 23, PAL.black); set(p, 23, 23, PAL.black);
  set(p, 11, 24, PAL.coatMid); set(p, 11, 25, PAL.coatShade);
  set(p, 11, 26, PAL.coatShade); set(p, 11, 27, PAL.coatShade);
  set(p, 11, 28, PAL.black);
  set(p, 15, 24, PAL.coatMid); set(p, 15, 25, PAL.coatShade);
  set(p, 15, 26, PAL.coatShade); set(p, 15, 27, PAL.coatShade);
  set(p, 15, 28, PAL.black);
  set(p, 19, 24, PAL.coatMid); set(p, 19, 25, PAL.coatShade);
  set(p, 19, 26, PAL.coatShade); set(p, 19, 27, PAL.coatShade);
  set(p, 19, 28, PAL.black);
  save(p, 'anatomy/horse/southwest/idle.png');
}

function drawHorseNortheast() {
  // 3/4 rear-right: rump at lower-right, head/neck barely visible at upper-left.
  const p = makeSprite();
  drawShadow(p, 8, 24);
  // Rump bulk
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
  // Mane sliver at far upper-left (back-of-neck visible)
  set(p, 11, 17, PAL.black); set(p, 12, 17, PAL.black); set(p, 13, 17, PAL.black);
  // Body continues
  row(p, 19, 10, 22, PAL.coatMid);
  row(p, 20, 10, 22, PAL.coatMid);
  set(p, 10, 20, PAL.coatShade); set(p, 22, 20, PAL.coatShade);
  row(p, 21, 10, 22, PAL.coatMid);
  set(p, 10, 21, PAL.coatShade); set(p, 22, 21, PAL.coatShade);
  row(p, 22, 11, 21, PAL.coatShade);
  row(p, 23, 12, 20, PAL.coatShade);
  // Legs
  set(p, 12, 24, PAL.coatMid); set(p, 12, 25, PAL.coatShade);
  set(p, 12, 26, PAL.coatShade); set(p, 12, 27, PAL.coatShade);
  set(p, 12, 28, PAL.black);
  set(p, 16, 24, PAL.coatMid); set(p, 16, 25, PAL.coatShade);
  set(p, 16, 26, PAL.coatShade); set(p, 16, 27, PAL.coatShade);
  set(p, 16, 28, PAL.black);
  set(p, 20, 24, PAL.coatMid); set(p, 20, 25, PAL.coatShade);
  set(p, 20, 26, PAL.coatShade); set(p, 20, 27, PAL.coatShade);
  set(p, 20, 28, PAL.black);
  save(p, 'anatomy/horse/northeast/idle.png');
}

function drawHorseNorthwest() {
  // Mirror of NE: rump at lower-left.
  const p = makeSprite();
  drawShadow(p, 7, 23);
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
  set(p, 11, 24, PAL.coatMid); set(p, 11, 25, PAL.coatShade);
  set(p, 11, 26, PAL.coatShade); set(p, 11, 27, PAL.coatShade);
  set(p, 11, 28, PAL.black);
  set(p, 15, 24, PAL.coatMid); set(p, 15, 25, PAL.coatShade);
  set(p, 15, 26, PAL.coatShade); set(p, 15, 27, PAL.coatShade);
  set(p, 15, 28, PAL.black);
  set(p, 19, 24, PAL.coatMid); set(p, 19, 25, PAL.coatShade);
  set(p, 19, 26, PAL.coatShade); set(p, 19, 27, PAL.coatShade);
  set(p, 19, 28, PAL.black);
  save(p, 'anatomy/horse/northwest/idle.png');
}

console.log('Drawing cuirassier horse components (8 facings):');
drawHorseSouth();
drawHorseNorth();
drawHorseEast();
drawHorseWest();
drawHorseSoutheast();
drawHorseSouthwest();
drawHorseNortheast();
drawHorseNorthwest();
console.log('Done.');
