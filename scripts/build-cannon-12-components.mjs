#!/usr/bin/env node
// Procedural pixel components for the 12-pounder cannon kit.
// Each call writes one 32x36 RGBA PNG with transparent background.
// Modeled on scripts/draw-cuirassier-components.mjs (named palette + helpers).
//
// Layers per facing (back-to-front draw order):
//   trail   — wooden carriage trail with red trim (primary marker)
//   wheels  — two wheels with steel-blue rims (secondary marker)
//   barrel  — bronze barrel (literal warm brass, no marker)
//
// Pose-specific layers:
//   muzzle-flash-<dir>-fire    — yellow/white burst at muzzle (fire pose)
//   smoke-<dir>-fire           — grey-white smoke puff (fire pose)
//   handspike-<dir>-reload     — wood pole leaning on trail (make-ready pose)
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
//   primary   — magenta (#ff00ff family)  — carriage red trim
//   secondary — cyan    (#00ffff family)  — wheel rims (steel-blue)
//   tertiary  — yellow  (#ffff00 family)  — unused for cannon
// Literal art colors (bronze, wood) pass through unchanged.
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
  // Primary (magenta family) — carriage red trim
  primaryHi: '#FF80FF',
  primaryMid: '#FF00FF',
  primaryShade: '#A000A0',
  // Secondary (cyan family) — steel-blue wheel rims
  secondaryHi: '#80FFFF',
  secondaryMid: '#00FFFF',
  secondaryShade: '#00A0A0',
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
// Standard wheel = 7x7 pixel disc with steel-blue rim (secondary marker)
// and dark hub. Position depends on facing: front/back show two splayed
// wheels (left + right of carriage); side views show one main wheel
// dominant with the far wheel partially occluded.
// =====================================================================

function drawWheelDisc(p, cx, cy, opts = {}) {
  const { occluded = false } = opts;
  const rim = opts.rim ?? PAL.secondaryMid;
  const rimHi = opts.rimHi ?? PAL.secondaryHi;
  // 7x7 disc centered at (cx, cy). Outline ring (k), then rim, then hub.
  // Approximate filled circle.
  // y offsets and x ranges:
  const rows = [
    [-3, -1, 1],   // top: (cx-1..cx+1) outline
    [-2, -2, 2],   // (cx-2..cx+2)
    [-1, -3, 3],   // (cx-3..cx+3)
    [0,  -3, 3],
    [1,  -3, 3],
    [2,  -2, 2],
    [3,  -1, 1],
  ];
  // Outline pass
  for (const [dy, x0, x1] of rows) {
    for (let dx = x0; dx <= x1; dx++) {
      // Only border pixels get outline; interior gets rim/hub later.
      const onTop = dy === rows[0][0];
      const onBot = dy === rows[rows.length - 1][0];
      const atL = dx === x0;
      const atR = dx === x1;
      if (onTop || onBot || atL || atR) {
        set(p, cx + dx, cy + dy, PAL.outline);
      }
    }
  }
  // Rim (one pixel inset from outline) — secondary marker
  set(p, cx - 2, cy - 2, rim);
  set(p, cx + 2, cy - 2, rim);
  set(p, cx - 2, cy + 2, rim);
  set(p, cx + 2, cy + 2, rim);
  set(p, cx - 1, cy - 2, rimHi);
  set(p, cx + 1, cy - 2, rimHi);
  // Spoke crosshair
  set(p, cx, cy - 2, rim);
  set(p, cx - 2, cy, rim);
  set(p, cx + 2, cy, rim);
  set(p, cx, cy + 2, rim);
  // Diagonal spokes
  set(p, cx - 1, cy - 1, rim);
  set(p, cx + 1, cy - 1, rim);
  set(p, cx - 1, cy + 1, rim);
  set(p, cx + 1, cy + 1, rim);
  // Hub
  set(p, cx, cy, PAL.outline);
  if (occluded) {
    // Partly occluded by carriage: fade right edge.
    set(p, cx + 3, cy, PAL.outline, 180);
    set(p, cx + 3, cy - 1, PAL.outline, 140);
    set(p, cx + 3, cy + 1, PAL.outline, 140);
  }
}

// Pair of wheels for front/back facings: two wheels splayed left + right
// of the carriage axis, both fully visible.
function drawWheelsFrontBack() {
  const p = makeSprite();
  // Wheels centered around y=27, with x=10 (left) and x=22 (right).
  drawWheelDisc(p, 10, 27);
  drawWheelDisc(p, 22, 27);
  // Ground shadow under each wheel
  row(p, 31, 7, 13, PAL.shadow, 100);
  row(p, 31, 19, 25, PAL.shadow, 100);
  return p;
}

// Side view: single dominant wheel near foreground, optional hint of the
// far wheel partially visible behind the trail.
function drawWheelsSide(mirror = false) {
  const p = makeSprite();
  // Foreground wheel centered at (16, 27).
  drawWheelDisc(p, 16, 27);
  // Far wheel hint: only a sliver of rim peeks out behind the trail. Use
  // shaded secondary so it reads as background.
  // Draw at offset: same x but y+1 (perspective hint), partially covered.
  // Skip for clarity in chibi style — single wheel reads cleaner.
  // Ground shadow
  row(p, 31, 12, 20, PAL.shadow, 110);
  return p;
}

// 3/4 view: two wheels visible, near pair on the side opposite the muzzle.
function drawWheels34(muzzleAngle /* 'right' | 'left' */) {
  const p = makeSprite();
  if (muzzleAngle === 'right') {
    // Near wheel on right (slightly closer/larger), far wheel on left.
    drawWheelDisc(p, 19, 27);
    drawWheelDisc(p, 11, 26);
    row(p, 31, 7, 23, PAL.shadow, 100);
  } else {
    drawWheelDisc(p, 13, 27);
    drawWheelDisc(p, 21, 26);
    row(p, 31, 9, 25, PAL.shadow, 100);
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
  // Cheeks (carriage sides) — vertical wood beams flanking center.
  // Rows 22..28, x=14..15 (left cheek), x=17..18 (right cheek). Center gap
  // for the barrel breech/breech ring.
  for (let y = 22; y <= 28; y++) {
    set(p, 14, y, PAL.woodMid);
    set(p, 15, y, PAL.woodHi);
    set(p, 17, y, PAL.woodHi);
    set(p, 18, y, PAL.woodMid);
  }
  // Top of cheeks (rounded cap)
  set(p, 14, 21, PAL.woodShade);
  set(p, 15, 21, PAL.woodMid);
  set(p, 17, 21, PAL.woodMid);
  set(p, 18, 21, PAL.woodShade);
  // Outlines
  col(p, 13, 22, 28, PAL.outline);
  col(p, 19, 22, 28, PAL.outline);
  col(p, 16, 22, 28, PAL.woodDeep);
  // Cheek bottom outline
  row(p, 29, 13, 19, PAL.outline);
  // Red primary trim along upper rim of cheeks
  row(p, 21, 14, 18, PAL.primaryMid);
  set(p, 14, 21, PAL.primaryShade);
  set(p, 18, 21, PAL.primaryShade);
  set(p, 16, 21, PAL.primaryHi);
  // Trail tail extending up (away from camera) — small visible nub
  row(p, 19, 15, 17, PAL.woodMid);
  row(p, 20, 15, 17, PAL.woodShade);
  set(p, 16, 19, PAL.primaryMid);
  return p;
}

// Back-facing trail: muzzle points away (N). Trail extends toward camera
// (south). Spade end visible at bottom.
function drawTrailBack() {
  const p = makeSprite();
  // Cheeks similar to front, but trail spade extends DOWN toward viewer.
  for (let y = 18; y <= 24; y++) {
    set(p, 14, y, PAL.woodMid);
    set(p, 15, y, PAL.woodHi);
    set(p, 17, y, PAL.woodHi);
    set(p, 18, y, PAL.woodMid);
  }
  col(p, 13, 18, 24, PAL.outline);
  col(p, 19, 18, 24, PAL.outline);
  // Trail beam extending down to spade
  for (let y = 25; y <= 30; y++) {
    set(p, 15, y, PAL.woodMid);
    set(p, 16, y, PAL.woodHi);
    set(p, 17, y, PAL.woodMid);
  }
  // Spade tip (red primary marker — characteristic carriage trim)
  row(p, 30, 14, 18, PAL.primaryMid);
  set(p, 14, 30, PAL.primaryShade);
  set(p, 18, 30, PAL.primaryShade);
  // Spade outline
  set(p, 13, 30, PAL.outline);
  set(p, 19, 30, PAL.outline);
  // Trail outline
  set(p, 14, 25, PAL.outline);
  set(p, 18, 25, PAL.outline);
  col(p, 14, 26, 29, PAL.outline);
  col(p, 18, 26, 29, PAL.outline);
  // Top trim
  row(p, 17, 14, 18, PAL.primaryMid);
  return p;
}

// Side trail: long horizontal trail beam extending opposite muzzle.
// `muzzleDir`: 'east' means muzzle right, trail extends left.
function drawTrailSide(muzzleDir /* 'east' | 'west' */) {
  const p = makeSprite();
  const trailRight = muzzleDir === 'west'; // trail on right side of cell
  // Carriage cheek — vertical bar where wheels attach. Centered at x=16.
  for (let y = 22; y <= 28; y++) {
    set(p, 14, y, PAL.woodMid);
    set(p, 15, y, PAL.woodHi);
    set(p, 16, y, PAL.woodMid);
    set(p, 17, y, PAL.woodShade);
  }
  col(p, 13, 22, 28, PAL.outline);
  col(p, 18, 22, 28, PAL.outline);
  // Top trim (red)
  row(p, 21, 13, 18, PAL.primaryMid);
  set(p, 13, 21, PAL.primaryShade);
  set(p, 18, 21, PAL.primaryShade);
  // Long horizontal trail beam
  if (trailRight) {
    // Extends right from x=18 to x=29
    for (let x = 18; x <= 29; x++) {
      set(p, x, 26, PAL.woodMid);
      set(p, x, 27, PAL.woodHi);
      set(p, x, 28, PAL.woodShade);
    }
    // Outlines
    row(p, 25, 18, 29, PAL.outline);
    row(p, 29, 18, 29, PAL.outline);
    set(p, 29, 26, PAL.outline);
    set(p, 29, 27, PAL.outline);
    set(p, 29, 28, PAL.outline);
    // Spade end (red primary)
    set(p, 28, 26, PAL.primaryMid);
    set(p, 28, 27, PAL.primaryHi);
    set(p, 28, 28, PAL.primaryMid);
  } else {
    // Extends left from x=13 to x=2
    for (let x = 2; x <= 13; x++) {
      set(p, x, 26, PAL.woodMid);
      set(p, x, 27, PAL.woodHi);
      set(p, x, 28, PAL.woodShade);
    }
    row(p, 25, 2, 13, PAL.outline);
    row(p, 29, 2, 13, PAL.outline);
    set(p, 2, 26, PAL.outline);
    set(p, 2, 27, PAL.outline);
    set(p, 2, 28, PAL.outline);
    set(p, 3, 26, PAL.primaryMid);
    set(p, 3, 27, PAL.primaryHi);
    set(p, 3, 28, PAL.primaryMid);
  }
  return p;
}

// 3/4 trail: diagonal trail extending into the back-corner of the cell.
function drawTrail34(corner /* 'NE' | 'NW' | 'SE' | 'SW' */) {
  const p = makeSprite();
  // Carriage cheek block in middle (slightly compressed)
  for (let y = 22; y <= 28; y++) {
    set(p, 14, y, PAL.woodMid);
    set(p, 15, y, PAL.woodHi);
    set(p, 16, y, PAL.woodMid);
    set(p, 17, y, PAL.woodShade);
  }
  col(p, 13, 22, 28, PAL.outline);
  col(p, 18, 22, 28, PAL.outline);
  // Top trim
  row(p, 21, 13, 18, PAL.primaryMid);

  // Diagonal trail beam from the cheek toward the indicated corner.
  // SE: muzzle points NW so trail extends to lower-right (SE)
  // SW: trail to lower-left
  // NE: trail to upper-right
  // NW: trail to upper-left
  const drawDiag = (xStart, yStart, dx, dy, len) => {
    let x = xStart, y = yStart;
    for (let i = 0; i < len; i++) {
      set(p, x, y, PAL.woodMid);
      set(p, x + 1, y, PAL.woodHi);
      set(p, x, y + 1, PAL.woodShade);
      x += dx; y += dy;
    }
    // Spade end (last segment)
    set(p, x, y, PAL.primaryMid);
    set(p, x + 1, y, PAL.primaryHi);
    set(p, x, y + 1, PAL.primaryShade);
  };

  if (corner === 'SE') drawDiag(18, 25, 1, 1, 5);
  if (corner === 'SW') drawDiag(13, 25, -1, 1, 5);
  if (corner === 'NE') drawDiag(18, 22, 1, -1, 5);
  if (corner === 'NW') drawDiag(13, 22, -1, -1, 5);

  return p;
}

// =====================================================================
// BARREL — bronze cannon barrel. Position/angle depends on facing.
// =====================================================================

// Front (S): muzzle points at viewer, barrel mostly hidden, just muzzle ring.
function drawBarrelFront() {
  const p = makeSprite();
  // Muzzle ring — concentric circle at center of carriage.
  // Outer ring (3x3 hollow)
  set(p, 15, 23, PAL.bronzeShade);
  set(p, 16, 23, PAL.bronzeMid);
  set(p, 17, 23, PAL.bronzeShade);
  set(p, 14, 24, PAL.bronzeShade);
  set(p, 18, 24, PAL.bronzeShade);
  set(p, 14, 25, PAL.bronzeMid);
  set(p, 18, 25, PAL.bronzeMid);
  set(p, 14, 26, PAL.bronzeShade);
  set(p, 18, 26, PAL.bronzeShade);
  set(p, 15, 27, PAL.bronzeShade);
  set(p, 16, 27, PAL.bronzeMid);
  set(p, 17, 27, PAL.bronzeShade);
  // Inner bore (dark hole)
  row(p, 24, 15, 17, PAL.bronzeDeep);
  row(p, 25, 15, 17, PAL.outline);
  row(p, 26, 15, 17, PAL.bronzeDeep);
  // Highlight
  set(p, 15, 23, PAL.bronzeHi);
  return p;
}

// Back (N): breech of barrel + cascabel knob facing camera.
function drawBarrelBack() {
  const p = makeSprite();
  // Breech is a rounded bronze block.
  for (let y = 19; y <= 24; y++) {
    set(p, 14, y, PAL.bronzeShade);
    set(p, 15, y, PAL.bronzeMid);
    set(p, 16, y, PAL.bronzeHi);
    set(p, 17, y, PAL.bronzeMid);
    set(p, 18, y, PAL.bronzeShade);
  }
  // Outline
  col(p, 13, 19, 24, PAL.outline);
  col(p, 19, 19, 24, PAL.outline);
  row(p, 18, 14, 18, PAL.outline);
  // Cascabel knob (ball at very rear, viewer-facing)
  set(p, 16, 25, PAL.bronzeShade);
  set(p, 15, 25, PAL.bronzeMid);
  set(p, 17, 25, PAL.bronzeMid);
  set(p, 16, 26, PAL.outline);
  // Reinforce ring (gold band)
  row(p, 21, 14, 18, PAL.bronzeHi);
  return p;
}

// Side (E): barrel pointing right.
function drawBarrelSide(muzzleDir /* 'east' | 'west' */) {
  const p = makeSprite();
  const east = muzzleDir === 'east';
  // Long bronze barrel. Muzzle on right (east) or left (west).
  // Body rows 22..24, length spanning much of the width.
  if (east) {
    // Trunnion / body x=15..27
    for (let x = 15; x <= 27; x++) {
      set(p, x, 22, PAL.bronzeShade);
      set(p, x, 23, PAL.bronzeHi);
      set(p, x, 24, PAL.bronzeMid);
    }
    // Outline
    row(p, 21, 15, 27, PAL.outline);
    row(p, 25, 15, 27, PAL.outline);
    set(p, 15, 22, PAL.outline);
    set(p, 15, 23, PAL.outline);
    set(p, 15, 24, PAL.outline);
    // Breech (left, fatter)
    for (let y = 21; y <= 25; y++) {
      set(p, 14, y, PAL.bronzeMid);
    }
    set(p, 13, 22, PAL.outline);
    set(p, 13, 23, PAL.outline);
    set(p, 13, 24, PAL.outline);
    set(p, 14, 21, PAL.outline);
    set(p, 14, 25, PAL.outline);
    // Reinforce ring near breech (bronze hi band)
    col(p, 17, 22, 24, PAL.bronzeHi);
    col(p, 18, 22, 24, PAL.bronzeShade);
    // Muzzle swell at right end
    set(p, 27, 21, PAL.outline);
    set(p, 27, 25, PAL.outline);
    set(p, 28, 22, PAL.outline);
    set(p, 28, 23, PAL.bronzeMid);
    set(p, 28, 24, PAL.outline);
    set(p, 29, 23, PAL.bronzeDeep); // bore opening
  } else {
    // Mirror: muzzle on left
    for (let x = 4; x <= 16; x++) {
      set(p, x, 22, PAL.bronzeShade);
      set(p, x, 23, PAL.bronzeHi);
      set(p, x, 24, PAL.bronzeMid);
    }
    row(p, 21, 4, 16, PAL.outline);
    row(p, 25, 4, 16, PAL.outline);
    set(p, 16, 22, PAL.outline);
    set(p, 16, 23, PAL.outline);
    set(p, 16, 24, PAL.outline);
    for (let y = 21; y <= 25; y++) {
      set(p, 17, y, PAL.bronzeMid);
    }
    set(p, 18, 22, PAL.outline);
    set(p, 18, 23, PAL.outline);
    set(p, 18, 24, PAL.outline);
    set(p, 17, 21, PAL.outline);
    set(p, 17, 25, PAL.outline);
    col(p, 13, 22, 24, PAL.bronzeHi);
    col(p, 12, 22, 24, PAL.bronzeShade);
    set(p, 4, 21, PAL.outline);
    set(p, 4, 25, PAL.outline);
    set(p, 3, 22, PAL.outline);
    set(p, 3, 23, PAL.bronzeMid);
    set(p, 3, 24, PAL.outline);
    set(p, 2, 23, PAL.bronzeDeep);
  }
  return p;
}

// 3/4 barrel: diagonal foreshortened.
function drawBarrel34(muzzleCorner /* 'NE'|'NW'|'SE'|'SW' */) {
  const p = makeSprite();
  // Foreshortened barrel — short diagonal stripe.
  const drawDiag = (xStart, yStart, dx, dy, len) => {
    let x = xStart, y = yStart;
    for (let i = 0; i < len; i++) {
      set(p, x, y, PAL.bronzeShade);
      set(p, x, y + 1, PAL.bronzeHi);
      set(p, x + 1, y, PAL.bronzeMid);
      set(p, x + 1, y + 1, PAL.bronzeShade);
      x += dx; y += dy;
    }
    // Muzzle bore
    set(p, x, y, PAL.outline);
    set(p, x, y + 1, PAL.bronzeDeep);
    set(p, x + 1, y, PAL.outline);
  };
  // SE: muzzle points to lower-right (S-of-East vibe? but cannon facing SE
  // means muzzle pointing southeast)
  if (muzzleCorner === 'SE') drawDiag(16, 22, 1, 1, 5);
  if (muzzleCorner === 'SW') drawDiag(15, 22, -1, 1, 5);
  if (muzzleCorner === 'NE') drawDiag(16, 24, 1, -1, 5);
  if (muzzleCorner === 'NW') drawDiag(15, 24, -1, -1, 5);
  // Breech bulge near center
  for (let y = 22; y <= 25; y++) {
    set(p, 14, y, PAL.bronzeMid);
    set(p, 15, y, PAL.bronzeHi);
    set(p, 16, y, PAL.bronzeMid);
  }
  return p;
}

// =====================================================================
// MUZZLE FLASH — fire pose only. Bright burst at the muzzle.
// =====================================================================

function drawFlashFront() {
  const p = makeSprite();
  // Burst centered at front muzzle (16, 25). Star-shaped, mostly out of cell.
  set(p, 16, 25, PAL.flashCore);
  set(p, 15, 25, PAL.flashMid);
  set(p, 17, 25, PAL.flashMid);
  set(p, 16, 24, PAL.flashMid);
  set(p, 16, 26, PAL.flashMid);
  set(p, 14, 25, PAL.flashEdge);
  set(p, 18, 25, PAL.flashEdge);
  set(p, 15, 24, PAL.flashEdge);
  set(p, 17, 24, PAL.flashEdge);
  return p;
}

function drawFlashBack() {
  const p = makeSprite();
  // Flash bursts away from camera at top — small (occluded by breech).
  set(p, 16, 17, PAL.flashCore);
  set(p, 15, 17, PAL.flashMid);
  set(p, 17, 17, PAL.flashMid);
  set(p, 16, 16, PAL.flashEdge);
  set(p, 15, 16, PAL.flashEdge);
  set(p, 17, 16, PAL.flashEdge);
  return p;
}

function drawFlashSide(muzzleDir) {
  const p = makeSprite();
  if (muzzleDir === 'east') {
    // Muzzle at x=29, y=23 — flash extends right.
    set(p, 30, 23, PAL.flashCore);
    set(p, 31, 23, PAL.flashCore);
    set(p, 30, 22, PAL.flashMid);
    set(p, 30, 24, PAL.flashMid);
    set(p, 31, 22, PAL.flashEdge);
    set(p, 31, 24, PAL.flashEdge);
    set(p, 29, 22, PAL.flashEdge);
    set(p, 29, 24, PAL.flashEdge);
  } else {
    // Muzzle at x=2, y=23
    set(p, 1, 23, PAL.flashCore);
    set(p, 0, 23, PAL.flashCore);
    set(p, 1, 22, PAL.flashMid);
    set(p, 1, 24, PAL.flashMid);
    set(p, 0, 22, PAL.flashEdge);
    set(p, 0, 24, PAL.flashEdge);
    set(p, 2, 22, PAL.flashEdge);
    set(p, 2, 24, PAL.flashEdge);
  }
  return p;
}

function drawFlash34(muzzleCorner) {
  const p = makeSprite();
  let cx, cy;
  if (muzzleCorner === 'SE') { cx = 21; cy = 27; }
  else if (muzzleCorner === 'SW') { cx = 10; cy = 27; }
  else if (muzzleCorner === 'NE') { cx = 21; cy = 19; }
  else { cx = 10; cy = 19; }
  set(p, cx, cy, PAL.flashCore);
  set(p, cx + 1, cy, PAL.flashMid);
  set(p, cx, cy + 1, PAL.flashMid);
  set(p, cx + 1, cy + 1, PAL.flashEdge);
  set(p, cx - 1, cy, PAL.flashEdge);
  set(p, cx, cy - 1, PAL.flashEdge);
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
  drawSmokeBlob(p, 16, 22, 3);
  drawSmokeBlob(p, 12, 24, 2);
  drawSmokeBlob(p, 20, 24, 2);
  return p;
}

function drawSmokeBack() {
  const p = makeSprite();
  drawSmokeBlob(p, 16, 13, 3);
  drawSmokeBlob(p, 13, 15, 2);
  drawSmokeBlob(p, 19, 15, 2);
  return p;
}

function drawSmokeSide(muzzleDir) {
  const p = makeSprite();
  if (muzzleDir === 'east') {
    drawSmokeBlob(p, 27, 20, 3);
    drawSmokeBlob(p, 24, 18, 2);
    drawSmokeBlob(p, 29, 22, 2);
  } else {
    drawSmokeBlob(p, 4, 20, 3);
    drawSmokeBlob(p, 7, 18, 2);
    drawSmokeBlob(p, 2, 22, 2);
  }
  return p;
}

function drawSmoke34(muzzleCorner) {
  const p = makeSprite();
  if (muzzleCorner === 'SE') {
    drawSmokeBlob(p, 22, 23, 3);
    drawSmokeBlob(p, 25, 21, 2);
  } else if (muzzleCorner === 'SW') {
    drawSmokeBlob(p, 9, 23, 3);
    drawSmokeBlob(p, 6, 21, 2);
  } else if (muzzleCorner === 'NE') {
    drawSmokeBlob(p, 22, 16, 3);
    drawSmokeBlob(p, 25, 14, 2);
  } else {
    drawSmokeBlob(p, 9, 16, 3);
    drawSmokeBlob(p, 6, 14, 2);
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
  // Pole leans from upper-left to trail at (16, 22).
  drawHandspike(p, 5, 10, 16, 22);
  return p;
}

function drawHandspikeBack() {
  const p = makeSprite();
  drawHandspike(p, 27, 10, 16, 22);
  return p;
}

function drawHandspikeSide(muzzleDir) {
  const p = makeSprite();
  if (muzzleDir === 'east') {
    // Trail extends left; handspike inserted into it from upper-left.
    drawHandspike(p, 2, 12, 12, 26);
  } else {
    drawHandspike(p, 29, 12, 19, 26);
  }
  return p;
}

function drawHandspike34(muzzleCorner) {
  const p = makeSprite();
  if (muzzleCorner === 'SE') drawHandspike(p, 4, 12, 14, 25);
  if (muzzleCorner === 'SW') drawHandspike(p, 27, 12, 17, 25);
  if (muzzleCorner === 'NE') drawHandspike(p, 4, 28, 14, 22);
  if (muzzleCorner === 'NW') drawHandspike(p, 27, 28, 17, 22);
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
console.log('Updating component registry:');
updateRegistry();
console.log('Done.');
