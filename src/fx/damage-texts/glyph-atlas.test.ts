import { describe, it, expect } from 'vitest';
import {
  DIGIT_BITMAPS,
  GLYPH_W,
  GLYPH_H,
  GLYPH_COUNT,
} from './glyph-atlas';

/** Read pixel (x, y) from a digit bitmap (top-left origin). */
function bit(g: number, x: number, y: number): number {
  return DIGIT_BITMAPS[g]![y * GLYPH_W + x]!;
}

describe('digit bitmaps', () => {
  it('exposes 10 bitmaps', () => {
    expect(DIGIT_BITMAPS.length).toBe(GLYPH_COUNT);
    expect(GLYPH_COUNT).toBe(10);
  });

  it('each bitmap is GLYPH_W * GLYPH_H bytes', () => {
    for (let g = 0; g < GLYPH_COUNT; g++) {
      expect(DIGIT_BITMAPS[g]!.length).toBe(GLYPH_W * GLYPH_H);
    }
  });

  it('every byte is exactly 0 or 1', () => {
    for (let g = 0; g < GLYPH_COUNT; g++) {
      const bm = DIGIT_BITMAPS[g]!;
      for (let i = 0; i < bm.length; i++) {
        const v = bm[i]!;
        expect(v === 0 || v === 1).toBe(true);
      }
    }
  });

  // Spot checks — keep these few but specific so a typo in DIGIT_ART
  // surfaces immediately.

  it('"0" has the corners off and the top-middle on (closed top edge)', () => {
    // Top-left and top-right of the 5x7 cell are off (rounded corners).
    expect(bit(0, 0, 0)).toBe(0);
    expect(bit(0, 4, 0)).toBe(0);
    // Top middle row: cells 1..3 are the "XXX" of the rounded top.
    expect(bit(0, 1, 0)).toBe(1);
    expect(bit(0, 2, 0)).toBe(1);
    expect(bit(0, 3, 0)).toBe(1);
  });

  it('"0" has hollow interior cells (rows 1 and 5 at center)', () => {
    // Rows 1 and 5 are pure ring rows: X...X, so cells at x=1..3 are hollow.
    expect(bit(0, 2, 1)).toBe(0);
    expect(bit(0, 2, 5)).toBe(0);
    // The "0" carries an internal diagonal stroke across rows 2..4 to
    // distinguish it from "O", so the geometric center (2,3) is *lit*.
    expect(bit(0, 2, 3)).toBe(1);
  });

  it('"1" forms a vertical column at x=2 across the body rows', () => {
    // Rows 0..5 all have x=2 lit (the stem); row 6 is the base "XXX".
    for (let y = 0; y < 6; y++) {
      expect(bit(1, 2, y)).toBe(1);
    }
    // Base row: x=1,2,3 lit.
    expect(bit(1, 1, 6)).toBe(1);
    expect(bit(1, 2, 6)).toBe(1);
    expect(bit(1, 3, 6)).toBe(1);
  });

  it('"7" has a full top bar and no bottom bar', () => {
    // Row 0: every column lit.
    for (let x = 0; x < GLYPH_W; x++) {
      expect(bit(7, x, 0)).toBe(1);
    }
    // Row 6: only x=1 lit (the diagonal terminus); x=0 and x=4 are off.
    expect(bit(7, 0, 6)).toBe(0);
    expect(bit(7, 4, 6)).toBe(0);
  });

  it('"8" has both top and bottom corners off but a closed middle bar', () => {
    expect(bit(8, 0, 0)).toBe(0);
    expect(bit(8, 4, 0)).toBe(0);
    // Middle horizontal bar (y=3, x=1..3 lit).
    expect(bit(8, 1, 3)).toBe(1);
    expect(bit(8, 2, 3)).toBe(1);
    expect(bit(8, 3, 3)).toBe(1);
  });
});
