import { describe, it, expect } from 'vitest';
import { rangeFalloffMul } from './range-falloff';

describe('rangeFalloffMul', () => {
  it('decayK = 0 disables falloff (always 1, regardless of distance)', () => {
    expect(rangeFalloffMul(0, 8, 0, 0.05)).toBe(1);
    expect(rangeFalloffMul(50, 8, 0, 0.05)).toBe(1);
    expect(rangeFalloffMul(1000, 0, 0, 0.05)).toBe(1);
  });

  it('distance <= nearM returns 1 regardless of decayK', () => {
    expect(rangeFalloffMul(0, 8, 0.035, 0.05)).toBe(1);
    expect(rangeFalloffMul(5, 8, 0.035, 0.05)).toBe(1);
    expect(rangeFalloffMul(8, 8, 0.035, 0.05)).toBe(1);
  });

  it('matches the musket curve sample points', () => {
    // Tuned in spec: nearM=8, decayK=0.035, minMul=0.05.
    // 8 m → 1.0; 25 m → ~exp(-0.035*17) ≈ 0.552; 60 m → ~exp(-0.035*52) ≈ 0.161;
    // 100 m → exp(-0.035*92) ≈ 0.040 → floored at 0.05.
    expect(rangeFalloffMul(8, 8, 0.035, 0.05)).toBeCloseTo(1.0, 5);
    expect(rangeFalloffMul(25, 8, 0.035, 0.05)).toBeCloseTo(0.552, 2);
    expect(rangeFalloffMul(60, 8, 0.035, 0.05)).toBeCloseTo(0.161, 2);
    expect(rangeFalloffMul(100, 8, 0.035, 0.05)).toBeCloseTo(0.05, 5);
  });

  it('huge distance never goes below minMul', () => {
    expect(rangeFalloffMul(1e6, 8, 0.035, 0.05)).toBe(0.05);
    expect(rangeFalloffMul(1e6, 0, 0.5, 0.2)).toBe(0.2);
  });

  it('is monotonic non-increasing in distance', () => {
    let prev = Infinity;
    for (let d = 0; d <= 200; d += 1) {
      const m = rangeFalloffMul(d, 8, 0.035, 0.05);
      expect(m).toBeLessThanOrEqual(prev);
      prev = m;
    }
  });
});
