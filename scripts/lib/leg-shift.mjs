// scripts/lib/leg-shift.mjs
//
// Tiny helper: loads a 32x36 RGBA PNG, identifies the lower 12 rows as
// "legs", and returns a new RGBA buffer with those pixels translated
// vertically by `dy` rows (positive = up). Rows revealed by the shift
// become transparent.
//
// Used by scripts/seed-line-infantry-locomotion.mjs to derive walk/run
// frame variants from the existing trousers/<facing>.png baselines.

import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

export const CELL_W = 32;
export const CELL_H = 36;
export const LEG_REGION_TOP = 24;     // rows 24..35 (12 rows) are "legs"
export const LEG_REGION_HEIGHT = CELL_H - LEG_REGION_TOP;

/**
 * Shifts the lower legs region of a 32×36 RGBA buffer by `dy` rows
 * (positive = up). Returns a new Uint8ClampedArray; does not mutate input.
 */
export function shiftLegs(rgba, dy) {
  if (rgba.length !== CELL_W * CELL_H * 4) {
    throw new Error(`shiftLegs: expected ${CELL_W * CELL_H * 4} bytes, got ${rgba.length}`);
  }
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < LEG_REGION_TOP * CELL_W * 4; i++) {
    out[i] = rgba[i];
  }
  for (let y = 0; y < LEG_REGION_HEIGHT; y++) {
    const sourceY = LEG_REGION_TOP + y + dy;
    if (sourceY < LEG_REGION_TOP || sourceY >= CELL_H) continue;
    const dstY = LEG_REGION_TOP + y;
    for (let x = 0; x < CELL_W; x++) {
      const sIdx = (sourceY * CELL_W + x) * 4;
      const dIdx = (dstY * CELL_W + x) * 4;
      out[dIdx + 0] = rgba[sIdx + 0];
      out[dIdx + 1] = rgba[sIdx + 1];
      out[dIdx + 2] = rgba[sIdx + 2];
      out[dIdx + 3] = rgba[sIdx + 3];
    }
  }
  return out;
}

/**
 * Variant: shifts only the LEFT (cols 0..15) or RIGHT (cols 16..31) half
 * of the leg region. Used to alternate left/right leg lift in walk cycles.
 *
 * `side` is 'left' or 'right'. `dy` positive = up.
 */
export function shiftHalfLegs(rgba, side, dy) {
  if (side !== 'left' && side !== 'right') {
    throw new Error(`shiftHalfLegs: side must be 'left' or 'right', got '${side}'`);
  }
  if (rgba.length !== CELL_W * CELL_H * 4) {
    throw new Error(`shiftHalfLegs: expected ${CELL_W * CELL_H * 4} bytes, got ${rgba.length}`);
  }
  const out = new Uint8ClampedArray(rgba);
  const xStart = side === 'left' ? 0 : CELL_W / 2;
  const xEnd   = side === 'left' ? CELL_W / 2 : CELL_W;
  // Clear the destination region for this side first.
  for (let y = 0; y < LEG_REGION_HEIGHT; y++) {
    const dstY = LEG_REGION_TOP + y;
    for (let x = xStart; x < xEnd; x++) {
      const dIdx = (dstY * CELL_W + x) * 4;
      out[dIdx + 0] = 0;
      out[dIdx + 1] = 0;
      out[dIdx + 2] = 0;
      out[dIdx + 3] = 0;
    }
  }
  for (let y = 0; y < LEG_REGION_HEIGHT; y++) {
    const sourceY = LEG_REGION_TOP + y + dy;
    if (sourceY < LEG_REGION_TOP || sourceY >= CELL_H) continue;
    const dstY = LEG_REGION_TOP + y;
    for (let x = xStart; x < xEnd; x++) {
      const sIdx = (sourceY * CELL_W + x) * 4;
      const dIdx = (dstY * CELL_W + x) * 4;
      out[dIdx + 0] = rgba[sIdx + 0];
      out[dIdx + 1] = rgba[sIdx + 1];
      out[dIdx + 2] = rgba[sIdx + 2];
      out[dIdx + 3] = rgba[sIdx + 3];
    }
  }
  return out;
}

/** Convenience: read a PNG file and return its RGBA Uint8ClampedArray. */
export async function readRgba(path) {
  const buf = await readFile(path);
  const png = PNG.sync.read(buf);
  if (png.width !== CELL_W || png.height !== CELL_H) {
    throw new Error(`${path}: expected ${CELL_W}x${CELL_H}, got ${png.width}x${png.height}`);
  }
  return new Uint8ClampedArray(png.data);
}

/** Convenience: encode an RGBA buffer to a 32x36 PNG byte buffer. */
export function rgbaToPng(rgba) {
  const png = new PNG({ width: CELL_W, height: CELL_H });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png);
}
