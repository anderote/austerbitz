import { describe, it, expect } from 'vitest';
import {
  RAMROD_PLUNGE_CYCLES,
  RAMROD_PLUNGE_DEPTH_PX,
  ramrodPlungePx,
  RAMROD_ANCHOR_PX_BY_FACING,
} from './reload-ramrod';

describe('ramrod plunge curve', () => {
  it('returns 0 at progress=0', () => {
    expect(ramrodPlungePx(0)).toBe(0);
  });

  it('returns 0 at progress=1 (cycle endpoint)', () => {
    expect(ramrodPlungePx(1)).toBe(0);
  });

  it('returns max depth at the first plunge bottom', () => {
    // First cycle bottom is at progress = 1 / (2 * CYCLES)
    const p = 1 / (2 * RAMROD_PLUNGE_CYCLES);
    expect(ramrodPlungePx(p)).toBe(RAMROD_PLUNGE_DEPTH_PX);
  });

  it('returns integer values for arbitrary progress', () => {
    for (let i = 0; i <= 100; i++) {
      const v = ramrodPlungePx(i / 100);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(RAMROD_PLUNGE_DEPTH_PX);
    }
  });

  it('exposes 8 facings of anchor offsets', () => {
    expect(RAMROD_ANCHOR_PX_BY_FACING.length).toBe(8);
    for (const a of RAMROD_ANCHOR_PX_BY_FACING) {
      expect(a.length).toBe(2);
      expect(Number.isFinite(a[0])).toBe(true);
      expect(Number.isFinite(a[1])).toBe(true);
    }
  });
});
