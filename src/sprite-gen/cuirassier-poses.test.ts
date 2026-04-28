import { describe, expect, it } from 'vitest';
import {
  CELL_W,
  CELL_H,
  PALETTE,
  POSES,
  SOURCE_DIRS,
  ALL_DIRS,
  FRAME_COUNTS,
  validateFrame,
  renderFrame,
  mirrorFrame,
} from '../../scripts/lib/cuirassier-poses.mjs';

const SOLID_BLANK = Array.from({ length: CELL_H }, () => '.'.repeat(CELL_W));

describe('cuirassier-poses helpers', () => {
  it('exports correct cell dimensions', () => {
    expect(CELL_W).toBe(32);
    expect(CELL_H).toBe(24);
  });

  it('palette has every expected glyph and all colors are 4-byte', () => {
    const expected = ['.', 'k', 'h', 'H', 'f', 'F', 'g', 'm', 'w', 's', 'P', 'S'];
    for (const ch of expected) {
      expect(PALETTE[ch]).toBeDefined();
      const rgba = PALETTE[ch];
      expect(rgba).toHaveLength(4);
      for (const c of rgba) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });

  it('source dirs are 5 and all dirs are 8', () => {
    expect(SOURCE_DIRS).toEqual(['N', 'NE', 'E', 'SE', 'S']);
    expect(ALL_DIRS).toHaveLength(8);
  });

  it('frame counts match the design', () => {
    expect(FRAME_COUNTS).toEqual({ idle: 1, walking: 4, running: 6 });
  });

  it('validateFrame accepts a blank frame', () => {
    expect(() => validateFrame(SOLID_BLANK, 'blank')).not.toThrow();
  });

  it('validateFrame rejects wrong row count', () => {
    expect(() => validateFrame(SOLID_BLANK.slice(0, 5), 'short')).toThrow(/24 rows/);
  });

  it('validateFrame rejects wrong column count', () => {
    const bad = [...SOLID_BLANK];
    bad[0] = '.'.repeat(CELL_W - 1);
    expect(() => validateFrame(bad, 'narrow')).toThrow(/32 cols/);
  });

  it('validateFrame rejects unknown glyph', () => {
    const bad = [...SOLID_BLANK];
    bad[0] = 'X' + '.'.repeat(CELL_W - 1);
    expect(() => validateFrame(bad, 'glyph')).toThrow(/unknown glyph 'X'/);
  });

  it('renderFrame emits CELL_W*CELL_H*4 bytes of zero alpha for blank', () => {
    const buf = renderFrame(SOLID_BLANK);
    expect(buf).toHaveLength(CELL_W * CELL_H * 4);
    for (let i = 3; i < buf.length; i += 4) expect(buf[i]).toBe(0);
  });

  it('mirrorFrame is involutive on a blank frame', () => {
    const m = mirrorFrame(mirrorFrame(SOLID_BLANK));
    expect(m).toEqual(SOLID_BLANK);
  });

  it('mirrorFrame flips a single asymmetric pixel', () => {
    const f = [...SOLID_BLANK];
    f[10] = 'h' + '.'.repeat(CELL_W - 1);
    const m = mirrorFrame(f);
    expect(m[10]).toBe('.'.repeat(CELL_W - 1) + 'h');
  });
});

describe('cuirassier-poses idle', () => {
  it('has all 5 source directions populated', () => {
    for (const dir of SOURCE_DIRS) {
      expect(POSES.idle[dir]).toBeDefined();
      expect(POSES.idle[dir]).toHaveLength(FRAME_COUNTS.idle);
    }
  });

  it('every idle frame validates', () => {
    for (const dir of SOURCE_DIRS) {
      for (let i = 0; i < POSES.idle[dir].length; i++) {
        validateFrame(POSES.idle[dir][i], `idle.${dir}[${i}]`);
      }
    }
  });

  it('idle frames have ground shadow on the bottom row', () => {
    for (const dir of SOURCE_DIRS) {
      const lastRow = POSES.idle[dir][0][CELL_H - 1];
      expect(lastRow).toMatch(/s/);
    }
  });
});

describe('cuirassier-poses walking', () => {
  it('has all 5 source directions with 4 frames each', () => {
    for (const dir of SOURCE_DIRS) {
      expect(POSES.walking[dir]).toBeDefined();
      expect(POSES.walking[dir]).toHaveLength(FRAME_COUNTS.walking);
    }
  });

  it('every walking frame validates', () => {
    for (const dir of SOURCE_DIRS) {
      for (let i = 0; i < POSES.walking[dir].length; i++) {
        validateFrame(POSES.walking[dir][i], `walking.${dir}[${i}]`);
      }
    }
  });

  it('walking frames are not all identical (animation is non-trivial)', () => {
    for (const dir of SOURCE_DIRS) {
      const first = POSES.walking[dir][0].join('\n');
      const lastDifferent = POSES.walking[dir].slice(1).some((f) => f.join('\n') !== first);
      expect(lastDifferent, `walking.${dir} all frames identical`).toBe(true);
    }
  });
});

describe('cuirassier-poses running', () => {
  it('has all 5 source directions with 6 frames each', () => {
    for (const dir of SOURCE_DIRS) {
      expect(POSES.running[dir]).toBeDefined();
      expect(POSES.running[dir]).toHaveLength(FRAME_COUNTS.running);
    }
  });

  it('every running frame validates', () => {
    for (const dir of SOURCE_DIRS) {
      for (let i = 0; i < POSES.running[dir].length; i++) {
        validateFrame(POSES.running[dir][i], `running.${dir}[${i}]`);
      }
    }
  });

  it('running frames are not all identical', () => {
    for (const dir of SOURCE_DIRS) {
      const first = POSES.running[dir][0].join('\n');
      const lastDifferent = POSES.running[dir].slice(1).some((f) => f.join('\n') !== first);
      expect(lastDifferent, `running.${dir} all frames identical`).toBe(true);
    }
  });
});
