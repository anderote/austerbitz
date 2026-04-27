import { describe, it, expect } from 'vitest';
import { createAccumulator } from './time';

describe('createAccumulator', () => {
  it('returns 1 tick when dt equals step', () => {
    const acc = createAccumulator(1 / 30);
    expect(acc.advance(1 / 30)).toBe(1);
  });

  it('returns 3 ticks when dt is 3 steps', () => {
    const acc = createAccumulator(1 / 30);
    expect(acc.advance(3 / 30)).toBe(3);
  });

  it('accumulates remainder across calls', () => {
    const acc = createAccumulator(1 / 30);
    expect(acc.advance(0.02)).toBe(0); // 0.02 < 1/30 ≈ 0.0333
    expect(acc.advance(0.02)).toBe(1); // 0.04 total → 1 tick, 0.0067 remainder
  });

  it('clamps maximum ticks per advance to spiral-of-death cap', () => {
    const acc = createAccumulator(1 / 30, 5);
    // 1 second of dt at 30hz would be 30 ticks; cap at 5
    expect(acc.advance(1)).toBe(5);
  });

  it('returns alpha (interpolation) between 0 and 1', () => {
    const acc = createAccumulator(1 / 30);
    acc.advance(1 / 60); // half a step
    expect(acc.alpha()).toBeCloseTo(0.5, 3);
  });
});
