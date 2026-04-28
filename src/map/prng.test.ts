import { describe, it, expect } from 'vitest';
import { mulberry32, randRange, randInt, randInDisc } from './prng';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 16; i++) expect(a()).toBe(b());
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds produce different first values', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('helpers', () => {
  it('randRange respects bounds', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = randRange(r, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('randInt is integral and in range', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = randInt(r, 5, 9); // inclusive both ends
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it('randInDisc returns points within the disc', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const p = randInDisc(r, 5);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(5);
    }
  });
});
