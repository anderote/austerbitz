#!/usr/bin/env node
// Procedural pixel components for the 12-pounder cannon kit.
// Each call writes one 32x36 RGBA PNG with transparent background.
// Modeled on scripts/draw-cuirassier-components.mjs (named palette + helpers).
//
// Layers per facing (back-to-front draw order):
//   trail   — wooden carriage trail with red trim (primary marker)
//   wheels  — two wheels with steel-blue rims (secondary marker)
//   barrel  — bronze barrel (literal warm brass, no marker)
//   crew    — 4-figure line-infantry crew around the gun (regiment recolor)
//
// Pose-specific layers:
//   muzzle-flash-<dir>-fire    — yellow/white burst at muzzle (fire pose)
//   smoke-<dir>-fire           — grey-white smoke puff (fire pose)
//   handspike-<dir>-reload     — wood pole leaning on trail (make-ready pose)
//   crew-<dir>-<variant>       — idle / fire / reload crew variants
//
// Layout convention (32w x 36h): bottom-anchored. Carriage rests on rows
// 24..30 (ground at row 30). Barrel sits above the wheels around rows 18..24.
// Trail extends opposite the muzzle. The 8 facings are hand-authored — no
// runtime mirroring — so silhouettes read cleanly from each direction.

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

// Palette. Marker-pixel families come from the regiment recolor system:
//   primary   — magenta (#ff00ff family)  — carriage red trim, crew coats
//   secondary — cyan    (#00ffff family)  — wheel rims, crew belts/breeches
//   tertiary  — yellow  (#ffff00 family)  — crew shakos / gaiters
// Literal art colors (bronze, wood, skin) pass through unchanged.
const PAL = {
  shadow: '#000000',
  // Carriage timber (literal warm brown)
  woodHi: '#9C6B40',
  woodMid: '#704A28',
  woodShade: '#4A2F18',
  woodDeep: '#2A1A0C',
  // Bronze barrel (literal warm brass)
  bronzeHi: '#E8C572',
  bronzeMid: '#B88A3C',
  bronzeShade: '#7A5520',
  bronzeDeep: '#3F2A0E',
  // Outline / iron fittings
  outline: '#161018',
  ironMid: '#3C3840',
  // Primary (magenta family) — carriage red trim, crew coats
  primaryHi: '#FF80FF',
  primaryMid: '#FF00FF',
  primaryShade: '#A000A0',
  // Secondary (cyan family) — steel-blue wheel rims, crew belts/breeches
  secondaryHi: '#80FFFF',
  secondaryMid: '#00FFFF',
  secondaryShade: '#00A0A0',
  // Tertiary (yellow family) — crew shakos / gaiters
  tertiaryHi: '#FFFF80',
  tertiaryMid: '#FFFF00',
  tertiaryShade: '#A0A000',
  // Skin (crew faces)
  skin: '#E4BC9C',
  skinShadow: '#BA8E6C',
  // Muzzle flash
  flashCore: '#FFF6C8',
  flashMid: '#FFD060',
  flashEdge: '#FF8020',
  // Smoke
  smokeHi: '#E8E2D8',
  smokeMid: '#B8B0A8',
  smokeShade: '#807870',
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

function col(p, x, y0, y1, hex, a = 255) {
  for (let y = y0; y <= y1; y++) set(p, x, y, hex, a);
}

function save(p, relPath) {
  const out = resolve(COMPONENTS, relPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, PNG.sync.write(p));
  console.log(`  ${relPath}`);
}

// =====================================================================
// WHEELS
//
// Standard wheel = 9x9 pixel disc with steel-blue rim (secondary marker)
// and dark hub. 4 visible spokes, outline ring. Position depends on
// facing: front/back show two splayed wheels (left + right of carriage);
// side views show one main wheel dominant.
// =====================================================================

function drawWheelDisc(p, cx, cy, opts = {}) {
  const rim = opts.rim ?? PAL.secondaryMid;
  const rimHi = opts.rimHi ?? PAL.secondaryHi;
  const rimShade = opts.rimShade ?? PAL.secondaryShade;
  // 9x9 disc centered at (cx, cy). Approximate filled circle.
  // Row offsets relative to cy:
  //   -4:  cx-2..cx+2  (5 wide)
  //   -3:  cx-3..cx+3  (7 wide)
  //   -2..+2: cx-4..cx+4 (9 wide)
  //   +3:  cx-3..cx+3
  //   +4:  cx-2..cx+2
  const rowSpans = [
    [-4, -2, 2],
    [-3, -3, 3],
    [-2, -4, 4],
    [-1, -4, 4],
    [0,  -4, 4],
    [1,  -4, 4],
    [2,  -4, 4],
    [3,  -3, 3],
    [4,  -2, 2],
  ];
  // Outline ring on the perimeter pixels.
  for (const [dy, x0, x1] of rowSpans) {
    for (let dx = x0; dx <= x1; dx++) {
      // outline if perimeter of the disc
      const above = rowSpans.find((r) => r[0] === dy - 1);
      const below = rowSpans.find((r) => r[0] === dy + 1);
      const onTop = !above;
      const onBot = !below;
      const atL = dx === x0;
      const atR = dx === x1;
      const aboveCovers = above && dx >= above[1] && dx <= above[2];
      const belowCovers = below && dx >= below[1] && dx <= below[2];
      const isPerim = onTop || onBot || atL || atR || !aboveCovers || !belowCovers;
      if (isPerim) {
        set(p, cx + dx, cy + dy, PAL.outline);
      }
    }
  }
  // Rim band (one inset). Lit on top, shaded on bottom.
  // Top-arc inset rim
  set(p, cx - 1, cy - 3, rimHi);
  set(p, cx,     cy - 3, rimHi);
  set(p, cx + 1, cy - 3, rimHi);
  set(p, cx - 2, cy - 3, rim);
  set(p, cx + 2, cy - 3, rim);
  // Side rims
  set(p, cx - 3, cy - 2, rim);
  set(p, cx + 3, cy - 2, rim);
  set(p, cx - 3, cy - 1, rim);
  set(p, cx + 3, cy - 1, rim);
  set(p, cx - 3, cy,     rim);
  set(p, cx + 3, cy,     rim);
  set(p, cx - 3, cy + 1, rimShade);
  set(p, cx + 3, cy + 1, rimShade);
  set(p, cx - 3, cy + 2, rimShade);
  set(p, cx + 3, cy + 2, rimShade);
  // Bottom-arc inset rim
  set(p, cx - 2, cy + 3, rimShade);
  set(p, cx + 2, cy + 3, rimShade);
  set(p, cx - 1, cy + 3, rimShade);
  set(p, cx,     cy + 3, rimShade);
  set(p, cx + 1, cy + 3, rimShade);

  // 4 spokes (cardinal cross): up, down, left, right from hub.
  set(p, cx, cy - 2, rim);
  set(p, cx, cy - 1, rim);
  set(p, cx, cy + 1, rim);
  set(p, cx, cy + 2, rim);
  set(p, cx - 2, cy, rim);
  set(p, cx - 1, cy, rim);
  set(p, cx + 1, cy, rim);
  set(p, cx + 2, cy, rim);

  // Dark hub center
  set(p, cx, cy, PAL.outline);
  set(p, cx - 1, cy - 1, PAL.ironMid);
  set(p, cx + 1, cy + 1, PAL.ironMid);
}

// Pair of wheels for front/back facings.
function drawWheelsFrontBack() {
  const p = makeSprite();
  // Wheels splayed at x=8 (left) and x=24 (right), y=27.
  drawWheelDisc(p, 8, 27);
  drawWheelDisc(p, 24, 27);
  // Ground shadow under each wheel
  row(p, 32, 4, 12, PAL.shadow, 110);
  row(p, 32, 20, 28, PAL.shadow, 110);
  return p;
}

// Side view: dominant foreground wheel.
function drawWheelsSide(_mirror = false) {
  const p = makeSprite();
  // Foreground wheel centered at (16, 26).
  drawWheelDisc(p, 16, 26);
  // Ground shadow under wheel
  row(p, 32, 11, 21, PAL.shadow, 120);
  return p;
}

// 3/4 view: two wheels visible, near pair on the side opposite the muzzle.
function drawWheels34(muzzleAngle /* 'right' | 'left' */) {
  const p = makeSprite();
  if (muzzleAngle === 'right') {
    // Near wheel on right (slightly closer/larger), far wheel on left.
    drawWheelDisc(p, 21, 27);
    drawWheelDisc(p, 11, 25);
    row(p, 32, 7, 25, PAL.shadow, 100);
  } else {
    drawWheelDisc(p, 11, 27);
    drawWheelDisc(p, 21, 25);
    row(p, 32, 7, 25, PAL.shadow, 100);
  }
  return p;
}

// =====================================================================
// TRAIL — wooden carriage frame with red primary trim. Extends opposite
// the muzzle. Sits between the wheels.
// =====================================================================

// Front-facing trail: muzzle pointing toward viewer (S). Trail extends
// away from camera (north, upper portion of cell). Cheeks visible front-on.
function drawTrailFront() {
  const p = makeSprite();
  // Two cheek beams flanking center gap.
  // Left cheek: x=12..14
  for (let y = 21; y <= 28; y++) {
    set(p, 12, y, PAL.woodShade);
    set(p, 13, y, PAL.woodMid);
    set(p, 14, y, PAL.woodHi);
  }
  // Right cheek: x=17..19
  for (let y = 21; y <= 28; y++) {
    set(p, 17, y, PAL.woodHi);
    set(p, 18, y, PAL.woodMid);
    set(p, 19, y, PAL.woodShade);
  }
  // Center gap (x=15,16) for breech — left transparent.
  // Outlines
  col(p, 11, 21, 28, PAL.outline);
  col(p, 20, 21, 28, PAL.outline);
  col(p, 15, 22, 27, PAL.woodDeep);
  col(p, 16, 22, 27, PAL.woodDeep);
  // Top trim (red primary along upper rim of cheeks)
  row(p, 20, 12, 14, PAL.primaryMid);
  row(p, 20, 17, 19, PAL.primaryMid);
  set(p, 12, 20, PAL.primaryShade);
  set(p, 19, 20, PAL.primaryShade);
  // Bottom outline
  row(p, 29, 11, 14, PAL.outline);
  row(p, 29, 17, 20, PAL.outline);
  // Trail beam extending up (away from camera) — pointing toward trailward (north) corner.
  // Spade pointing up: triangular taper.
  for (let y = 18; y <= 19; y++) {
    set(p, 14, y, PAL.woodMid);
    set(p, 15, y, PAL.woodHi);
    set(p, 16, y, PAL.woodHi);
    set(p, 17, y, PAL.woodMid);
  }
  // Spade tip
  set(p, 15, 17, PAL.primaryMid);
  set(p, 16, 17, PAL.primaryMid);
  set(p, 15, 16, PAL.primaryShade);
  set(p, 16, 16, PAL.primaryShade);
  // Spade outline
  set(p, 14, 17, PAL.outline);
  set(p, 17, 17, PAL.outline);
  set(p, 14, 16, PAL.outline);
  set(p, 17, 16, PAL.outline);
  return p;
}

// Back-facing trail: muzzle points away (N). Trail extends toward camera
// (south). Spade end visible at bottom.
function drawTrailBack() {
  const p = makeSprite();
  // Cheeks shifted up (since trail extends down).
  // Left cheek
  for (let y = 18; y <= 24; y++) {
    set(p, 12, y, PAL.woodShade);
    set(p, 13, y, PAL.woodMid);
    set(p, 14, y, PAL.woodHi);
  }
  // Right cheek
  for (let y = 18; y <= 24; y++) {
    set(p, 17, y, PAL.woodHi);
    set(p, 18, y, PAL.woodMid);
    set(p, 19, y, PAL.woodShade);
  }
  col(p, 11, 18, 24, PAL.outline);
  col(p, 20, 18, 24, PAL.outline);
  col(p, 15, 19, 23, PAL.woodDeep);
  col(p, 16, 19, 23, PAL.woodDeep);
  // Trail beam extending down toward viewer
  for (let y = 25; y <= 30; y++) {
    set(p, 14, y, PAL.woodMid);
    set(p, 15, y, PAL.woodHi);
    set(p, 16, y, PAL.woodHi);
    set(p, 17, y, PAL.woodMid);
  }
  col(p, 13, 25, 29, PAL.outline);
  col(p, 18, 25, 29, PAL.outline);
  // Spade tip at bottom (red primary)
  row(p, 30, 13, 18, PAL.primaryMid);
  set(p, 13, 30, PAL.primaryShade);
  set(p, 18, 30, PAL.primaryShade);
  set(p, 14, 31, PAL.primaryShade);
  set(p, 15, 31, PAL.primaryMid);
  set(p, 16, 31, PAL.primaryMid);
  set(p, 17, 31, PAL.primaryShade);
  // Top trim line on cheek tops
  row(p, 17, 12, 14, PAL.primaryMid);
  row(p, 17, 17, 19, PAL.primaryMid);
  return p;
}

// Side trail: long horizontal trail beam extending opposite muzzle.
// `muzzleDir`: 'east' means muzzle right, trail extends left.
function drawTrailSide(muzzleDir /* 'east' | 'west' */) {
  const p = makeSprite();
  const trailRight = muzzleDir === 'west'; // trail on right side of cell
  // Cheek (single visible) at center where wheel attaches.
  // Wood beam: x=13..18, y=22..28
  for (let y = 22; y <= 28; y++) {
    set(p, 13, y, PAL.woodShade);
    set(p, 14, y, PAL.woodMid);
    set(p, 15, y, PAL.woodHi);
    set(p, 16, y, PAL.woodMid);
    set(p, 17, y, PAL.woodMid);
    set(p, 18, y, PAL.woodShade);
  }
  col(p, 12, 22, 28, PAL.outline);
  col(p, 19, 22, 28, PAL.outline);
  // Top trim red
  row(p, 21, 13, 18, PAL.primaryMid);
  set(p, 12, 21, PAL.primaryShade);
  set(p, 19, 21, PAL.primaryShade);

  if (trailRight) {
    // Trail extends right from x=19 to x=29 (within 2-3 px of edge).
    for (let x = 19; x <= 28; x++) {
      set(p, x, 26, PAL.woodMid);
      set(p, x, 27, PAL.woodHi);
      set(p, x, 28, PAL.woodShade);
    }
    row(p, 25, 19, 28, PAL.outline);
    row(p, 29, 19, 29, PAL.outline);
    // Spade triangular end (red primary) — taper to point at right.
    // Spade segment x=28..30: triangular profile
    set(p, 29, 26, PAL.primaryMid);
    set(p, 29, 27, PAL.primaryHi);
    set(p, 29, 28, PAL.primaryMid);
    set(p, 30, 27, PAL.primaryShade);
    set(p, 28, 26, PAL.primaryShade);
    set(p, 28, 28, PAL.primaryShade);
    set(p, 30, 26, PAL.outline);
    set(p, 30, 28, PAL.outline);
  } else {
    // Trail extends left from x=12 down to x=3.
    for (let x = 3; x <= 12; x++) {
      set(p, x, 26, PAL.woodMid);
      set(p, x, 27, PAL.woodHi);
      set(p, x, 28, PAL.woodShade);
    }
    row(p, 25, 3, 12, PAL.outline);
    row(p, 29, 2, 12, PAL.outline);
    // Spade triangular end on left
    set(p, 2, 26, PAL.primaryMid);
    set(p, 2, 27, PAL.primaryHi);
    set(p, 2, 28, PAL.primaryMid);
    set(p, 1, 27, PAL.primaryShade);
    set(p, 3, 26, PAL.primaryShade);
    set(p, 3, 28, PAL.primaryShade);
    set(p, 1, 26, PAL.outline);
    set(p, 1, 28, PAL.outline);
  }
  return p;
}

// 3/4 trail: diagonal trail extending into the back-corner of the cell.
function drawTrail34(corner /* 'NE' | 'NW' | 'SE' | 'SW' */) {
  const p = makeSprite();
  // Carriage cheek block in middle (compressed since seen at angle).
  for (let y = 22; y <= 28; y++) {
    set(p, 13, y, PAL.woodShade);
    set(p, 14, y, PAL.woodMid);
    set(p, 15, y, PAL.woodHi);
    set(p, 16, y, PAL.woodHi);
    set(p, 17, y, PAL.woodMid);
    set(p, 18, y, PAL.woodShade);
  }
  col(p, 12, 22, 28, PAL.outline);
  col(p, 19, 22, 28, PAL.outline);
  // Top trim
  row(p, 21, 13, 18, PAL.primaryMid);
  set(p, 12, 21, PAL.primaryShade);
  set(p, 19, 21, PAL.primaryShade);

  // Diagonal trail beam from the cheek toward the indicated corner.
  // Trail extends toward the corner OPPOSITE the muzzle (here corner names
  // refer to where the trail goes / where the spade ends up).
  const drawDiag = (xStart, yStart, dx, dy, len) => {
    let x = xStart, y = yStart;
    for (let i = 0; i < len; i++) {
      set(p, x, y, PAL.woodMid);
      set(p, x + 1, y, PAL.woodHi);
      set(p, x, y + 1, PAL.woodShade);
      set(p, x + 1, y + 1, PAL.woodMid);
      x += dx; y += dy;
    }
    // Spade end (red triangle) at the far corner.
    set(p, x, y, PAL.primaryMid);
    set(p, x + 1, y, PAL.primaryHi);
    set(p, x, y + 1, PAL.primaryShade);
    set(p, x + 1, y + 1, PAL.primaryMid);
    set(p, x - dx, y, PAL.primaryShade);
  };

  if (corner === 'SE') drawDiag(19, 25, 1, 1, 5);
  if (corner === 'SW') drawDiag(11, 25, -1, 1, 5);
  if (corner === 'NE') drawDiag(19, 22, 1, -1, 5);
  if (corner === 'NW') drawDiag(11, 22, -1, -1, 5);

  return p;
}

// =====================================================================
// BARREL — bronze cannon barrel. Position/angle depends on facing.
// =====================================================================

// Front (S): muzzle points at viewer, larger muzzle ring.
function drawBarrelFront() {
  const p = makeSprite();
  // Muzzle ring centered at (16, 25). 5-px outer diameter.
  // Outer ring (concentric circle).
  // Top arc
  set(p, 15, 22, PAL.bronzeShade);
  set(p, 16, 22, PAL.bronzeMid);
  set(p, 17, 22, PAL.bronzeShade);
  set(p, 14, 23, PAL.bronzeShade);
  set(p, 15, 23, PAL.bronzeHi);
  set(p, 16, 23, PAL.bronzeHi);
  set(p, 17, 23, PAL.bronzeMid);
  set(p, 18, 23, PAL.bronzeShade);
  // Sides
  set(p, 13, 24, PAL.bronzeShade);
  set(p, 14, 24, PAL.bronzeHi);
  set(p, 18, 24, PAL.bronzeMid);
  set(p, 19, 24, PAL.bronzeShade);
  set(p, 13, 25, PAL.bronzeMid);
  set(p, 14, 25, PAL.bronzeHi);
  set(p, 18, 25, PAL.bronzeMid);
  set(p, 19, 25, PAL.bronzeShade);
  set(p, 13, 26, PAL.bronzeShade);
  set(p, 14, 26, PAL.bronzeMid);
  set(p, 18, 26, PAL.bronzeShade);
  set(p, 19, 26, PAL.bronzeShade);
  // Bottom arc
  set(p, 14, 27, PAL.bronzeShade);
  set(p, 15, 27, PAL.bronzeMid);
  set(p, 16, 27, PAL.bronzeShade);
  set(p, 17, 27, PAL.bronzeShade);
  set(p, 18, 27, PAL.bronzeShade);
  // Outline ring
  set(p, 15, 21, PAL.outline);
  set(p, 16, 21, PAL.outline);
  set(p, 17, 21, PAL.outline);
  set(p, 13, 23, PAL.outline);
  set(p, 19, 23, PAL.outline);
  set(p, 12, 24, PAL.outline);
  set(p, 12, 25, PAL.outline);
  set(p, 12, 26, PAL.outline);
  set(p, 20, 24, PAL.outline);
  set(p, 20, 25, PAL.outline);
  set(p, 20, 26, PAL.outline);
  set(p, 13, 27, PAL.outline);
  set(p, 14, 28, PAL.outline);
  set(p, 15, 28, PAL.outline);
  set(p, 16, 28, PAL.outline);
  set(p, 17, 28, PAL.outline);
  set(p, 18, 28, PAL.outline);
  set(p, 19, 27, PAL.outline);
  // Inner bore (dark)
  set(p, 15, 24, PAL.bronzeDeep);
  set(p, 16, 24, PAL.outline);
  set(p, 17, 24, PAL.bronzeDeep);
  set(p, 15, 25, PAL.outline);
  set(p, 16, 25, PAL.outline);
  set(p, 17, 25, PAL.outline);
  set(p, 15, 26, PAL.bronzeDeep);
  set(p, 16, 26, PAL.outline);
  set(p, 17, 26, PAL.bronzeDeep);
  // Highlight on outer rim top-left
  set(p, 14, 23, PAL.bronzeHi);
  return p;
}

// Back (N): breech of barrel + cascabel knob facing camera.
function drawBarrelBack() {
  const p = makeSprite();
  // Breech is a rounded bronze block (larger).
  for (let y = 18; y <= 25; y++) {
    set(p, 13, y, PAL.bronzeShade);
    set(p, 14, y, PAL.bronzeMid);
    set(p, 15, y, PAL.bronzeHi);
    set(p, 16, y, PAL.bronzeHi);
    set(p, 17, y, PAL.bronzeMid);
    set(p, 18, y, PAL.bronzeShade);
  }
  // Outline
  col(p, 12, 18, 25, PAL.outline);
  col(p, 19, 18, 25, PAL.outline);
  row(p, 17, 13, 18, PAL.outline);
  // Cascabel knob (ball at very rear, viewer-facing, below breech)
  set(p, 14, 26, PAL.outline);
  set(p, 15, 26, PAL.bronzeMid);
  set(p, 16, 26, PAL.bronzeMid);
  set(p, 17, 26, PAL.outline);
  set(p, 15, 27, PAL.bronzeShade);
  set(p, 16, 27, PAL.bronzeShade);
  set(p, 15, 28, PAL.outline);
  set(p, 16, 28, PAL.outline);
  // Reinforce ring (gold band) prominent
  row(p, 20, 13, 18, PAL.bronzeHi);
  row(p, 21, 13, 18, PAL.bronzeShade);
  // Top of breech block highlight
  row(p, 18, 14, 17, PAL.bronzeHi);
  return p;
}

// Side (E or W): long bronze barrel ~14 px.
function drawBarrelSide(muzzleDir /* 'east' | 'west' */) {
  const p = makeSprite();
  const east = muzzleDir === 'east';
  if (east) {
    // Barrel x=14..29 (~15 px including muzzle swell), rows 21..25 thickness.
    // Body rows 22..24 main bore; 21 and 25 are top/bottom outline.
    // Breech block (fatter, x=14..16).
    for (let y = 21; y <= 25; y++) {
      set(p, 14, y, PAL.bronzeMid);
      set(p, 15, y, PAL.bronzeHi);
      set(p, 16, y, PAL.bronzeMid);
    }
    set(p, 13, 22, PAL.bronzeShade);
    set(p, 13, 23, PAL.bronzeMid);
    set(p, 13, 24, PAL.bronzeShade);
    // Breech outline
    col(p, 12, 22, 24, PAL.outline);
    set(p, 13, 21, PAL.outline);
    set(p, 14, 20, PAL.outline);
    set(p, 15, 20, PAL.outline);
    set(p, 16, 20, PAL.outline);
    set(p, 13, 25, PAL.outline);
    set(p, 14, 26, PAL.outline);
    set(p, 15, 26, PAL.outline);
    set(p, 16, 26, PAL.outline);
    // Trunnion shoulder (where barrel meets cheek): a small bronze stud at y=25 below
    set(p, 17, 25, PAL.bronzeShade);
    set(p, 18, 25, PAL.bronzeShade);
    set(p, 17, 26, PAL.outline);
    set(p, 18, 26, PAL.outline);
    // Reinforce ring (gold band) ~1/3 along — at x=18..19
    col(p, 18, 21, 24, PAL.bronzeHi);
    col(p, 19, 21, 24, PAL.bronzeShade);
    set(p, 18, 20, PAL.outline);
    set(p, 19, 20, PAL.outline);
    set(p, 18, 25, PAL.outline);
    set(p, 19, 25, PAL.outline);
    // Main barrel body x=20..27, 3 rows thick.
    for (let x = 20; x <= 27; x++) {
      set(p, x, 22, PAL.bronzeShade);
      set(p, x, 23, PAL.bronzeHi);
      set(p, x, 24, PAL.bronzeMid);
    }
    row(p, 21, 20, 27, PAL.outline);
    row(p, 25, 20, 27, PAL.outline);
    // Muzzle swell at x=27..29 (slightly thicker)
    set(p, 27, 21, PAL.outline);
    set(p, 27, 25, PAL.outline);
    set(p, 28, 22, PAL.bronzeShade);
    set(p, 28, 23, PAL.bronzeHi);
    set(p, 28, 24, PAL.bronzeMid);
    set(p, 28, 21, PAL.outline);
    set(p, 28, 25, PAL.outline);
    // Muzzle face (bore) at x=29
    set(p, 29, 21, PAL.outline);
    set(p, 29, 22, PAL.bronzeMid);
    set(p, 29, 23, PAL.bronzeDeep);
    set(p, 29, 24, PAL.bronzeMid);
    set(p, 29, 25, PAL.outline);
    set(p, 30, 22, PAL.outline);
    set(p, 30, 23, PAL.outline);
    set(p, 30, 24, PAL.outline);
  } else {
    // Mirror: muzzle on left x=2, breech on right x=18.
    for (let y = 21; y <= 25; y++) {
      set(p, 18, y, PAL.bronzeMid);
      set(p, 17, y, PAL.bronzeHi);
      set(p, 16, y, PAL.bronzeMid);
    }
    set(p, 19, 22, PAL.bronzeShade);
    set(p, 19, 23, PAL.bronzeMid);
    set(p, 19, 24, PAL.bronzeShade);
    col(p, 20, 22, 24, PAL.outline);
    set(p, 19, 21, PAL.outline);
    set(p, 18, 20, PAL.outline);
    set(p, 17, 20, PAL.outline);
    set(p, 16, 20, PAL.outline);
    set(p, 19, 25, PAL.outline);
    set(p, 18, 26, PAL.outline);
    set(p, 17, 26, PAL.outline);
    set(p, 16, 26, PAL.outline);
    // Trunnion shoulder
    set(p, 14, 25, PAL.bronzeShade);
    set(p, 15, 25, PAL.bronzeShade);
    set(p, 14, 26, PAL.outline);
    set(p, 15, 26, PAL.outline);
    // Reinforce ring at x=12..13
    col(p, 13, 21, 24, PAL.bronzeHi);
    col(p, 12, 21, 24, PAL.bronzeShade);
    set(p, 13, 20, PAL.outline);
    set(p, 12, 20, PAL.outline);
    set(p, 13, 25, PAL.outline);
    set(p, 12, 25, PAL.outline);
    // Main barrel body x=4..11
    for (let x = 4; x <= 11; x++) {
      set(p, x, 22, PAL.bronzeShade);
      set(p, x, 23, PAL.bronzeHi);
      set(p, x, 24, PAL.bronzeMid);
    }
    row(p, 21, 4, 11, PAL.outline);
    row(p, 25, 4, 11, PAL.outline);
    // Muzzle swell
    set(p, 4, 21, PAL.outline);
    set(p, 4, 25, PAL.outline);
    set(p, 3, 22, PAL.bronzeShade);
    set(p, 3, 23, PAL.bronzeHi);
    set(p, 3, 24, PAL.bronzeMid);
    set(p, 3, 21, PAL.outline);
    set(p, 3, 25, PAL.outline);
    // Bore
    set(p, 2, 21, PAL.outline);
    set(p, 2, 22, PAL.bronzeMid);
    set(p, 2, 23, PAL.bronzeDeep);
    set(p, 2, 24, PAL.bronzeMid);
    set(p, 2, 25, PAL.outline);
    set(p, 1, 22, PAL.outline);
    set(p, 1, 23, PAL.outline);
    set(p, 1, 24, PAL.outline);
  }
  return p;
}

// 3/4 barrel: diagonal foreshortened.
function drawBarrel34(muzzleCorner /* 'NE'|'NW'|'SE'|'SW' */) {
  const p = makeSprite();
  // Breech bulge at carriage end (center of cell).
  for (let y = 22; y <= 26; y++) {
    set(p, 13, y, PAL.bronzeShade);
    set(p, 14, y, PAL.bronzeMid);
    set(p, 15, y, PAL.bronzeHi);
    set(p, 16, y, PAL.bronzeMid);
    set(p, 17, y, PAL.bronzeShade);
  }
  col(p, 12, 22, 26, PAL.outline);
  col(p, 18, 22, 26, PAL.outline);
  row(p, 21, 13, 17, PAL.outline);
  row(p, 27, 13, 17, PAL.outline);

  // Foreshortened diagonal stripe extending to muzzle corner.
  const drawDiag = (xStart, yStart, dx, dy, len) => {
    let x = xStart, y = yStart;
    for (let i = 0; i < len; i++) {
      set(p, x, y, PAL.bronzeShade);
      set(p, x, y + 1, PAL.bronzeHi);
      set(p, x + 1, y, PAL.bronzeMid);
      set(p, x + 1, y + 1, PAL.bronzeShade);
      x += dx; y += dy;
    }
    // Muzzle ring at end
    set(p, x, y, PAL.outline);
    set(p, x, y + 1, PAL.bronzeDeep);
    set(p, x + 1, y, PAL.outline);
    set(p, x + 1, y + 1, PAL.outline);
  };
  // Reinforce gold band one third out
  if (muzzleCorner === 'SE') {
    drawDiag(17, 22, 1, 1, 5);
    set(p, 19, 24, PAL.bronzeHi);
    set(p, 20, 25, PAL.bronzeHi);
  }
  if (muzzleCorner === 'SW') {
    drawDiag(13, 22, -1, 1, 5);
    set(p, 11, 24, PAL.bronzeHi);
    set(p, 10, 25, PAL.bronzeHi);
  }
  if (muzzleCorner === 'NE') {
    drawDiag(17, 24, 1, -1, 5);
    set(p, 19, 22, PAL.bronzeHi);
    set(p, 20, 21, PAL.bronzeHi);
  }
  if (muzzleCorner === 'NW') {
    drawDiag(13, 24, -1, -1, 5);
    set(p, 11, 22, PAL.bronzeHi);
    set(p, 10, 21, PAL.bronzeHi);
  }
  return p;
}

// =====================================================================
// MUZZLE FLASH — fire pose only. Bright burst at the muzzle.
// =====================================================================

function drawFlashFront() {
  const p = makeSprite();
  // Front muzzle is at (16, 25). Burst toward viewer (downward).
  set(p, 16, 25, PAL.flashCore);
  set(p, 16, 26, PAL.flashCore);
  set(p, 15, 26, PAL.flashMid);
  set(p, 17, 26, PAL.flashMid);
  set(p, 16, 27, PAL.flashMid);
  set(p, 15, 27, PAL.flashEdge);
  set(p, 17, 27, PAL.flashEdge);
  set(p, 14, 26, PAL.flashEdge);
  set(p, 18, 26, PAL.flashEdge);
  set(p, 16, 28, PAL.flashEdge);
  set(p, 15, 28, PAL.flashEdge);
  set(p, 17, 28, PAL.flashEdge);
  return p;
}

function drawFlashBack() {
  const p = makeSprite();
  // Back muzzle would be away from camera; just a small flash at top of breech.
  set(p, 16, 16, PAL.flashCore);
  set(p, 15, 16, PAL.flashMid);
  set(p, 17, 16, PAL.flashMid);
  set(p, 16, 15, PAL.flashMid);
  set(p, 16, 14, PAL.flashEdge);
  set(p, 15, 15, PAL.flashEdge);
  set(p, 17, 15, PAL.flashEdge);
  return p;
}

function drawFlashSide(muzzleDir) {
  const p = makeSprite();
  if (muzzleDir === 'east') {
    // Muzzle at x=29, y=23 — flash extends right to cell edge.
    set(p, 30, 23, PAL.flashCore);
    set(p, 31, 23, PAL.flashCore);
    set(p, 30, 22, PAL.flashMid);
    set(p, 30, 24, PAL.flashMid);
    set(p, 31, 22, PAL.flashEdge);
    set(p, 31, 24, PAL.flashEdge);
    set(p, 29, 21, PAL.flashEdge);
    set(p, 29, 25, PAL.flashEdge);
    set(p, 30, 21, PAL.flashEdge);
    set(p, 30, 25, PAL.flashEdge);
  } else {
    // Muzzle at x=2, y=23
    set(p, 1, 23, PAL.flashCore);
    set(p, 0, 23, PAL.flashCore);
    set(p, 1, 22, PAL.flashMid);
    set(p, 1, 24, PAL.flashMid);
    set(p, 0, 22, PAL.flashEdge);
    set(p, 0, 24, PAL.flashEdge);
    set(p, 2, 21, PAL.flashEdge);
    set(p, 2, 25, PAL.flashEdge);
    set(p, 1, 21, PAL.flashEdge);
    set(p, 1, 25, PAL.flashEdge);
  }
  return p;
}

function drawFlash34(muzzleCorner) {
  const p = makeSprite();
  // Muzzle pixel coordinates from drawBarrel34:
  //   SE: muzzle at (22, 27)
  //   SW: muzzle at  (8, 27)
  //   NE: muzzle at (22, 19)
  //   NW: muzzle at  (8, 19)
  let cx, cy, dx, dy;
  if (muzzleCorner === 'SE') { cx = 22; cy = 27; dx = 1; dy = 1; }
  else if (muzzleCorner === 'SW') { cx = 8; cy = 27; dx = -1; dy = 1; }
  else if (muzzleCorner === 'NE') { cx = 22; cy = 19; dx = 1; dy = -1; }
  else { cx = 8; cy = 19; dx = -1; dy = -1; }
  set(p, cx + dx, cy + dy, PAL.flashCore);
  set(p, cx, cy + dy, PAL.flashMid);
  set(p, cx + dx, cy, PAL.flashMid);
  set(p, cx + 2 * dx, cy + dy, PAL.flashMid);
  set(p, cx + dx, cy + 2 * dy, PAL.flashMid);
  set(p, cx + 2 * dx, cy + 2 * dy, PAL.flashEdge);
  set(p, cx + 2 * dx, cy, PAL.flashEdge);
  set(p, cx, cy + 2 * dy, PAL.flashEdge);
  return p;
}

// =====================================================================
// SMOKE — fire pose only. Greyish puff post-recoil. Drifts upward and
// in muzzle direction.
// =====================================================================

function drawSmokeBlob(p, cx, cy, size = 2) {
  // Layered alpha smoke puff.
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > size + 1) continue;
      const isCore = d <= 1;
      const isMid = d <= size;
      const color = isCore ? PAL.smokeHi : isMid ? PAL.smokeMid : PAL.smokeShade;
      const alpha = isCore ? 220 : isMid ? 160 : 100;
      set(p, cx + dx, cy + dy, color, alpha);
    }
  }
}

function drawSmokeFront() {
  const p = makeSprite();
  // Muzzle at (16, 25); smoke drifts toward viewer.
  drawSmokeBlob(p, 16, 29, 3);
  drawSmokeBlob(p, 12, 31, 2);
  drawSmokeBlob(p, 20, 31, 2);
  return p;
}

function drawSmokeBack() {
  const p = makeSprite();
  // Muzzle at (16, 16); smoke drifts up.
  drawSmokeBlob(p, 16, 12, 3);
  drawSmokeBlob(p, 13, 14, 2);
  drawSmokeBlob(p, 19, 14, 2);
  return p;
}

function drawSmokeSide(muzzleDir) {
  const p = makeSprite();
  if (muzzleDir === 'east') {
    // Muzzle at (29, 23); smoke drifts right and up.
    drawSmokeBlob(p, 29, 19, 3);
    drawSmokeBlob(p, 26, 17, 2);
    drawSmokeBlob(p, 31, 21, 2);
  } else {
    // Muzzle at (2, 23)
    drawSmokeBlob(p, 2, 19, 3);
    drawSmokeBlob(p, 5, 17, 2);
    drawSmokeBlob(p, 0, 21, 2);
  }
  return p;
}

function drawSmoke34(muzzleCorner) {
  const p = makeSprite();
  // Muzzle origins from drawBarrel34: SE=(22,27), SW=(8,27), NE=(22,19), NW=(8,19).
  if (muzzleCorner === 'SE') {
    drawSmokeBlob(p, 24, 25, 3);
    drawSmokeBlob(p, 27, 22, 2);
  } else if (muzzleCorner === 'SW') {
    drawSmokeBlob(p, 6, 25, 3);
    drawSmokeBlob(p, 3, 22, 2);
  } else if (muzzleCorner === 'NE') {
    drawSmokeBlob(p, 24, 16, 3);
    drawSmokeBlob(p, 27, 13, 2);
  } else {
    drawSmokeBlob(p, 6, 16, 3);
    drawSmokeBlob(p, 3, 13, 2);
  }
  return p;
}

// =====================================================================
// HANDSPIKE — make-ready pose. A wooden pole leaning into the trail to
// shift the cannon for laying. Drawn in similar style across all facings.
// =====================================================================

function drawHandspike(p, x0, y0, x1, y1) {
  // Bresenham-ish pole. Two-pixel-wide wood.
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  while (true) {
    set(p, x, y, PAL.woodHi);
    set(p, x + 1, y, PAL.woodShade);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  // Iron tip at end
  set(p, x1, y1, PAL.ironMid);
  set(p, x1 + 1, y1, PAL.outline);
}

function drawHandspikeFront() {
  const p = makeSprite();
  // Trail spade is at top (around y=17, x=16). Pole leans from upper-left.
  drawHandspike(p, 4, 6, 15, 18);
  return p;
}

function drawHandspikeBack() {
  const p = makeSprite();
  // Trail spade at bottom (y=30..31, x=16). Pole leans from upper-right toward trail.
  drawHandspike(p, 28, 18, 16, 28);
  return p;
}

function drawHandspikeSide(muzzleDir) {
  const p = makeSprite();
  if (muzzleDir === 'east') {
    // Trail extends left; spade at (~2, 27). Handspike from upper-left.
    drawHandspike(p, 2, 14, 8, 26);
  } else {
    // Trail extends right; spade at (~29, 27). Handspike from upper-right.
    drawHandspike(p, 29, 14, 23, 26);
  }
  return p;
}

function drawHandspike34(muzzleCorner) {
  const p = makeSprite();
  // Handspike is at the trail end (opposite muzzle corner).
  if (muzzleCorner === 'SE') drawHandspike(p, 4, 14, 13, 24);
  if (muzzleCorner === 'SW') drawHandspike(p, 28, 14, 19, 24);
  if (muzzleCorner === 'NE') drawHandspike(p, 4, 28, 13, 22);
  if (muzzleCorner === 'NW') drawHandspike(p, 28, 28, 19, 22);
  return p;
}

// =====================================================================
// CREW — 4 line-infantry figures around the gun. Regiment-recolored via
// primary (coat), secondary (belts/breeches), tertiary (shako/gaiters).
// Each figure is 5 wide x 7 tall.
// =====================================================================

function drawCrewFigure(p, x, y, variant) {
  // Variant pixel offsets:
  // 'idle'   — symmetric standing.
  // 'fire'   — top two rows shifted +1 px in x (lean back).
  // 'reload' — same as idle pose silhouette unless it's the rammer (drawn separately).
  const topShift = variant === 'fire' ? 1 : 0;

  // Row 0 (head outline / shako top): . k k k .
  set(p, x + 1 + topShift, y + 0, PAL.outline);
  set(p, x + 2 + topShift, y + 0, PAL.outline);
  set(p, x + 3 + topShift, y + 0, PAL.outline);

  // Row 1 (shako body, tertiary): . T T T .
  set(p, x + 1 + topShift, y + 1, PAL.tertiaryMid);
  set(p, x + 2 + topShift, y + 1, PAL.tertiaryHi);
  set(p, x + 3 + topShift, y + 1, PAL.tertiaryShade);

  // Row 2 (face): . f F f .
  set(p, x + 1, y + 2, PAL.skin);
  set(p, x + 2, y + 2, PAL.skinShadow);
  set(p, x + 3, y + 2, PAL.skin);

  // Row 3 (coat with cross-belts): S P S P S
  set(p, x + 0, y + 3, PAL.secondaryMid);
  set(p, x + 1, y + 3, PAL.primaryMid);
  set(p, x + 2, y + 3, PAL.secondaryHi);
  set(p, x + 3, y + 3, PAL.primaryMid);
  set(p, x + 4, y + 3, PAL.secondaryMid);

  // Row 4 (coat): . P P P .
  set(p, x + 1, y + 4, PAL.primaryShade);
  set(p, x + 2, y + 4, PAL.primaryMid);
  set(p, x + 3, y + 4, PAL.primaryShade);

  // Row 5 (breeches): . S S S .
  set(p, x + 1, y + 5, PAL.secondaryShade);
  set(p, x + 2, y + 5, PAL.secondaryMid);
  set(p, x + 3, y + 5, PAL.secondaryShade);

  // Row 6 (gaiters/boots): . T . T .
  set(p, x + 1, y + 6, PAL.tertiaryShade);
  set(p, x + 3, y + 6, PAL.tertiaryShade);
}

// Add a small held tool to a figure at (x, y). `tool` is one of:
//   'rammer'  — a vertical rammer rod extending up from the figure's hand
//   'sponge'  — small bucket (woodShade square) at hand
//   'lanyard' — short pull cord (1-px line)
//   'cartridge' — small woodMid square (cartridge box)
function drawCrewTool(p, x, y, tool) {
  if (tool === 'rammer') {
    // Vertical wood rod above figure's right hand.
    for (let dy = -3; dy <= 1; dy++) {
      set(p, x + 4, y + 3 + dy, PAL.woodMid);
    }
    set(p, x + 4, y - 1, PAL.outline);
  } else if (tool === 'sponge') {
    // Small bucket at left hand.
    set(p, x - 1, y + 4, PAL.woodShade);
    set(p, x - 1, y + 5, PAL.woodMid);
  } else if (tool === 'lanyard') {
    // Short cord trailing from the gunner's hand.
    set(p, x + 5, y + 4, PAL.woodShade);
    set(p, x + 6, y + 4, PAL.woodShade);
  } else if (tool === 'cartridge') {
    // Small cartridge held against torso.
    set(p, x - 1, y + 3, PAL.woodMid);
    set(p, x - 1, y + 4, PAL.woodShade);
  }
}

// Helper: draw a crew figure with an optional tool. `role` selects the tool.
function drawCrewMember(p, x, y, variant, role) {
  drawCrewFigure(p, x, y, variant);
  if (variant === 'reload') {
    if (role === 'rammer') drawCrewTool(p, x, y, 'rammer');
    else if (role === 'sponger') drawCrewTool(p, x, y, 'sponge');
    else if (role === 'gunner') drawCrewTool(p, x, y, 'lanyard');
    else if (role === 'powder') drawCrewTool(p, x, y, 'cartridge');
  } else if (variant === 'idle') {
    // light tool hint for non-idle visual interest
    if (role === 'sponger') drawCrewTool(p, x, y, 'sponge');
    else if (role === 'powder') drawCrewTool(p, x, y, 'cartridge');
  } else if (variant === 'fire') {
    if (role === 'gunner') drawCrewTool(p, x, y, 'lanyard');
  }
}

// 8 facing-specific drawers. Each draws 4 crew figures positioned for
// that facing. Crew figures are 5x7. They sit clear of the muzzle.

// SOUTH (muzzle pointing toward viewer, S). Crew above the breech (y=8..15).
function drawCrewSouth(variant) {
  const p = makeSprite();
  // 4 crew above the breech (north portion of cell), spread x≈4..28.
  drawCrewMember(p, 4, 9, variant, 'gunner');
  drawCrewMember(p, 11, 8, variant, 'sponger');
  drawCrewMember(p, 18, 8, variant, 'rammer');
  drawCrewMember(p, 25, 9, variant, 'powder');
  return p;
}

// NORTH (muzzle pointing away). Crew below the breech (south portion).
function drawCrewNorth(variant) {
  const p = makeSprite();
  drawCrewMember(p, 4, 23, variant, 'gunner');
  drawCrewMember(p, 11, 24, variant, 'sponger');
  drawCrewMember(p, 18, 24, variant, 'rammer');
  drawCrewMember(p, 25, 23, variant, 'powder');
  return p;
}

// EAST (muzzle right). Rammer between muzzle and right edge (above the muzzle line),
// sponger above muzzle, gunner at trail-end (left), powder-monkey lower-left.
function drawCrewEast(variant) {
  const p = makeSprite();
  // Gunner at trail-end (far left, near spade)
  drawCrewMember(p, 1, 15, variant, 'gunner');
  // Powder monkey lower-left
  drawCrewMember(p, 6, 9, variant, 'powder');
  // Sponger above the muzzle (clear of barrel) — y ~ 12, x ~ 22
  drawCrewMember(p, 19, 10, variant, 'sponger');
  // Rammer between muzzle (x=29) and right edge — y ~ 15, x near right edge
  drawCrewMember(p, 26, 15, variant, 'rammer');
  return p;
}

// WEST (mirror of east).
function drawCrewWest(variant) {
  const p = makeSprite();
  // Gunner at trail-end (far right, near spade)
  drawCrewMember(p, 26, 15, variant, 'gunner');
  // Powder monkey lower-right
  drawCrewMember(p, 21, 9, variant, 'powder');
  // Sponger above the muzzle area
  drawCrewMember(p, 8, 10, variant, 'sponger');
  // Rammer near left edge (muzzle side)
  drawCrewMember(p, 1, 15, variant, 'rammer');
  return p;
}

// NORTHEAST (muzzle to NE). Two crew flanking trail diagonal-rear (SW corner),
// two flanking wheels diagonal-front (NE side).
function drawCrewNortheast(variant) {
  const p = makeSprite();
  // Trail-rear flank (SW corner): gunner + powder
  drawCrewMember(p, 2, 22, variant, 'gunner');
  drawCrewMember(p, 7, 26, variant, 'powder');
  // Wheel-front flank (NE side): rammer + sponger
  drawCrewMember(p, 22, 9, variant, 'sponger');
  drawCrewMember(p, 26, 14, variant, 'rammer');
  return p;
}

// NORTHWEST (mirror of NE).
function drawCrewNorthwest(variant) {
  const p = makeSprite();
  // Trail-rear flank (SE corner)
  drawCrewMember(p, 25, 22, variant, 'gunner');
  drawCrewMember(p, 20, 26, variant, 'powder');
  // Wheel-front flank (NW side)
  drawCrewMember(p, 5, 9, variant, 'sponger');
  drawCrewMember(p, 1, 14, variant, 'rammer');
  return p;
}

// SOUTHEAST (muzzle to SE). Trail extends NW. Two crew flanking trail-rear (NW corner),
// two flanking wheels (SE side).
function drawCrewSoutheast(variant) {
  const p = makeSprite();
  // Trail-rear flank (NW corner)
  drawCrewMember(p, 2, 7, variant, 'gunner');
  drawCrewMember(p, 7, 13, variant, 'powder');
  // Wheel-front flank (SE side near muzzle corner)
  drawCrewMember(p, 22, 17, variant, 'sponger');
  drawCrewMember(p, 26, 22, variant, 'rammer');
  return p;
}

// SOUTHWEST (mirror).
function drawCrewSouthwest(variant) {
  const p = makeSprite();
  // Trail-rear flank (NE corner)
  drawCrewMember(p, 25, 7, variant, 'gunner');
  drawCrewMember(p, 20, 13, variant, 'powder');
  // Wheel-front flank (SW side)
  drawCrewMember(p, 5, 17, variant, 'sponger');
  drawCrewMember(p, 1, 22, variant, 'rammer');
  return p;
}

// =====================================================================
// FACING MAP & FILE EMISSION
// =====================================================================

// Directions: kit name -> filesystem name (lowercase compass)
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

function fsFor(kit) {
  return DIRS.find((d) => d.kit === kit).fs;
}

const CREW_VARIANTS = ['idle', 'fire', 'reload'];

const CREW_DRAWERS = {
  north: drawCrewNorth,
  northeast: drawCrewNortheast,
  east: drawCrewEast,
  southeast: drawCrewSoutheast,
  south: drawCrewSouth,
  southwest: drawCrewSouthwest,
  west: drawCrewWest,
  northwest: drawCrewNorthwest,
};

// Emit wheels for each facing.
function emitAllWheels() {
  // Front (S): muzzle at viewer
  save(drawWheelsFrontBack(), 'carriage/cannon12-wheels-south.png');
  // Back (N): muzzle away
  save(drawWheelsFrontBack(), 'carriage/cannon12-wheels-north.png');
  // Side E
  save(drawWheelsSide(false), 'carriage/cannon12-wheels-east.png');
  // Side W
  save(drawWheelsSide(true), 'carriage/cannon12-wheels-west.png');
  // 3/4
  save(drawWheels34('right'), 'carriage/cannon12-wheels-southeast.png');
  save(drawWheels34('left'),  'carriage/cannon12-wheels-southwest.png');
  save(drawWheels34('right'), 'carriage/cannon12-wheels-northeast.png');
  save(drawWheels34('left'),  'carriage/cannon12-wheels-northwest.png');
}

function emitAllTrails() {
  save(drawTrailFront(), 'carriage/cannon12-trail-south.png');
  save(drawTrailBack(),  'carriage/cannon12-trail-north.png');
  save(drawTrailSide('east'), 'carriage/cannon12-trail-east.png');
  save(drawTrailSide('west'), 'carriage/cannon12-trail-west.png');
  save(drawTrail34('SE'), 'carriage/cannon12-trail-southeast.png');
  save(drawTrail34('SW'), 'carriage/cannon12-trail-southwest.png');
  save(drawTrail34('NE'), 'carriage/cannon12-trail-northeast.png');
  save(drawTrail34('NW'), 'carriage/cannon12-trail-northwest.png');
}

function emitAllBarrels() {
  save(drawBarrelFront(), 'barrel/cannon12-barrel-south.png');
  save(drawBarrelBack(),  'barrel/cannon12-barrel-north.png');
  save(drawBarrelSide('east'), 'barrel/cannon12-barrel-east.png');
  save(drawBarrelSide('west'), 'barrel/cannon12-barrel-west.png');
  save(drawBarrel34('SE'), 'barrel/cannon12-barrel-southeast.png');
  save(drawBarrel34('SW'), 'barrel/cannon12-barrel-southwest.png');
  save(drawBarrel34('NE'), 'barrel/cannon12-barrel-northeast.png');
  save(drawBarrel34('NW'), 'barrel/cannon12-barrel-northwest.png');
}

function emitAllFlashes() {
  save(drawFlashFront(), 'barrel/cannon12-muzzle-flash-south-fire.png');
  save(drawFlashBack(),  'barrel/cannon12-muzzle-flash-north-fire.png');
  save(drawFlashSide('east'), 'barrel/cannon12-muzzle-flash-east-fire.png');
  save(drawFlashSide('west'), 'barrel/cannon12-muzzle-flash-west-fire.png');
  save(drawFlash34('SE'), 'barrel/cannon12-muzzle-flash-southeast-fire.png');
  save(drawFlash34('SW'), 'barrel/cannon12-muzzle-flash-southwest-fire.png');
  save(drawFlash34('NE'), 'barrel/cannon12-muzzle-flash-northeast-fire.png');
  save(drawFlash34('NW'), 'barrel/cannon12-muzzle-flash-northwest-fire.png');
}

function emitAllSmokes() {
  save(drawSmokeFront(), 'fx/cannon12-smoke-south-fire.png');
  save(drawSmokeBack(),  'fx/cannon12-smoke-north-fire.png');
  save(drawSmokeSide('east'), 'fx/cannon12-smoke-east-fire.png');
  save(drawSmokeSide('west'), 'fx/cannon12-smoke-west-fire.png');
  save(drawSmoke34('SE'), 'fx/cannon12-smoke-southeast-fire.png');
  save(drawSmoke34('SW'), 'fx/cannon12-smoke-southwest-fire.png');
  save(drawSmoke34('NE'), 'fx/cannon12-smoke-northeast-fire.png');
  save(drawSmoke34('NW'), 'fx/cannon12-smoke-northwest-fire.png');
}

function emitAllHandspikes() {
  save(drawHandspikeFront(), 'tools/cannon12-handspike-south-reload.png');
  save(drawHandspikeBack(),  'tools/cannon12-handspike-north-reload.png');
  save(drawHandspikeSide('east'), 'tools/cannon12-handspike-east-reload.png');
  save(drawHandspikeSide('west'), 'tools/cannon12-handspike-west-reload.png');
  save(drawHandspike34('SE'), 'tools/cannon12-handspike-southeast-reload.png');
  save(drawHandspike34('SW'), 'tools/cannon12-handspike-southwest-reload.png');
  save(drawHandspike34('NE'), 'tools/cannon12-handspike-northeast-reload.png');
  save(drawHandspike34('NW'), 'tools/cannon12-handspike-northwest-reload.png');
}

function emitAllCrew() {
  for (const { fs } of DIRS) {
    const drawer = CREW_DRAWERS[fs];
    for (const variant of CREW_VARIANTS) {
      save(drawer(variant), `crew/cannon12-crew-${fs}-${variant}.png`);
    }
  }
}

// =====================================================================
// REGISTRY (public/components/index.json) update — append cannon entries
// only if absent. Idempotent.
// =====================================================================

function registryEntries() {
  const entries = [];
  for (const { kit, fs } of DIRS) {
    entries.push({
      id: `cannon12-trail-${fs}`,
      type: 'carriage',
      category: 'trail',
      facings: [kit],
      path: `carriage/cannon12-trail-${fs}.png`,
      pivot: [16, 32],
      notes: '12-pdr cannon trail / cheeks (procedural).',
    });
    entries.push({
      id: `cannon12-wheels-${fs}`,
      type: 'carriage',
      category: 'wheels',
      facings: [kit],
      path: `carriage/cannon12-wheels-${fs}.png`,
      pivot: [16, 32],
      notes: '12-pdr cannon wheel pair (procedural).',
    });
    entries.push({
      id: `cannon12-barrel-${fs}`,
      type: 'barrel',
      category: 'barrel',
      facings: [kit],
      path: `barrel/cannon12-barrel-${fs}.png`,
      pivot: [16, 32],
      notes: '12-pdr cannon bronze barrel (procedural).',
    });
    entries.push({
      id: `cannon12-muzzle-flash-${fs}-fire`,
      type: 'fx',
      category: 'muzzle-flash',
      facings: [kit],
      path: `barrel/cannon12-muzzle-flash-${fs}-fire.png`,
      pivot: [16, 32],
      notes: '12-pdr cannon muzzle flash, fire pose only.',
    });
    entries.push({
      id: `cannon12-smoke-${fs}-fire`,
      type: 'fx',
      category: 'smoke',
      facings: [kit],
      path: `fx/cannon12-smoke-${fs}-fire.png`,
      pivot: [16, 32],
      notes: '12-pdr cannon smoke puff, fire pose only.',
    });
    entries.push({
      id: `cannon12-handspike-${fs}-reload`,
      type: 'tool',
      category: 'handspike',
      facings: [kit],
      path: `tools/cannon12-handspike-${fs}-reload.png`,
      pivot: [16, 32],
      notes: '12-pdr cannon handspike, make-ready pose only.',
    });
    for (const variant of CREW_VARIANTS) {
      entries.push({
        id: `cannon12-crew-${fs}-${variant}`,
        type: 'crew',
        category: 'crew-line',
        facings: [kit],
        path: `crew/cannon12-crew-${fs}-${variant}.png`,
        pivot: [16, 32],
        notes: '12-pdr cannon line-infantry crew (procedural).',
      });
    }
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
    console.log(`Registered ${added} cannon-12 component entries in ${REGISTRY_PATH}`);
  } else {
    console.log('Cannon-12 component registry already up to date.');
  }
}

// =====================================================================
// MAIN
// =====================================================================

console.log('Drawing cannon-12 components (8 facings):');
console.log('  Wheels:');
emitAllWheels();
console.log('  Trails:');
emitAllTrails();
console.log('  Barrels:');
emitAllBarrels();
console.log('  Muzzle flashes (fire pose):');
emitAllFlashes();
console.log('  Smoke (fire pose):');
emitAllSmokes();
console.log('  Handspikes (make-ready pose):');
emitAllHandspikes();
console.log('  Crew (line infantry, 8 facings x 3 variants):');
emitAllCrew();
console.log('Updating component registry:');
updateRegistry();
console.log('Done.');
