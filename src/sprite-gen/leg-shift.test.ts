import { describe, expect, it } from 'vitest';
import {
  CELL_W,
  CELL_H,
  shiftLegs,
  shiftHalfLegs,
} from '../../scripts/lib/leg-shift.mjs';

function makeRgba(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CELL_W * CELL_H * 4);
  // All transparent by default.
  return out;
}

function paintRow(rgba: Uint8ClampedArray, y: number, color: [number, number, number, number]) {
  for (let x = 0; x < CELL_W; x++) {
    const i = (y * CELL_W + x) * 4;
    rgba[i + 0] = color[0]!;
    rgba[i + 1] = color[1]!;
    rgba[i + 2] = color[2]!;
    rgba[i + 3] = color[3]!;
  }
}

describe('leg-shift helpers', () => {
  it('shiftLegs(0) is identity for the leg region', () => {
    const src = makeRgba();
    paintRow(src, CELL_H - 1, [255, 0, 0, 255]);
    const out = shiftLegs(src, 0);
    expect(Array.from(out.slice((CELL_H - 1) * CELL_W * 4, (CELL_H - 1) * CELL_W * 4 + 4)))
      .toEqual([255, 0, 0, 255]);
  });

  it('shiftLegs(1) translates the bottom row up by 1 (was at H-1, now at H-2)', () => {
    const src = makeRgba();
    paintRow(src, CELL_H - 1, [255, 0, 0, 255]);
    const out = shiftLegs(src, 1);
    expect(Array.from(out.slice((CELL_H - 2) * CELL_W * 4, (CELL_H - 2) * CELL_W * 4 + 4)))
      .toEqual([255, 0, 0, 255]);
    expect(Array.from(out.slice((CELL_H - 1) * CELL_W * 4, (CELL_H - 1) * CELL_W * 4 + 4)))
      .toEqual([0, 0, 0, 0]);
  });

  it('shiftLegs preserves the upper region (rows 0..LEG_REGION_TOP-1)', () => {
    const src = makeRgba();
    paintRow(src, 5, [128, 128, 128, 255]);
    const out = shiftLegs(src, 1);
    expect(Array.from(out.slice(5 * CELL_W * 4, 5 * CELL_W * 4 + 4)))
      .toEqual([128, 128, 128, 255]);
  });

  it('shiftHalfLegs("left", 1) moves only the left half of the leg region', () => {
    const src = makeRgba();
    paintRow(src, CELL_H - 1, [200, 0, 0, 255]);
    const out = shiftHalfLegs(src, 'left', 1);
    const lhsIdx = ((CELL_H - 2) * CELL_W + 0) * 4;
    expect(out[lhsIdx + 0]).toBe(200);
    expect(out[lhsIdx + 3]).toBe(255);
    const rhsIdx = ((CELL_H - 2) * CELL_W + (CELL_W / 2)) * 4;
    expect(out[rhsIdx + 3]).toBe(0);
    const rhsBotIdx = ((CELL_H - 1) * CELL_W + (CELL_W / 2)) * 4;
    expect(out[rhsBotIdx + 0]).toBe(200);
  });

  it('throws on a buffer with the wrong size', () => {
    expect(() => shiftLegs(new Uint8ClampedArray(100), 0)).toThrow();
  });
});
