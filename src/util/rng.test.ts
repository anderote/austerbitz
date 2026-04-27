import { describe, it, expect } from 'vitest';
import { createRng } from './rng';

describe('createRng', () => {
  it('produces deterministic sequence for same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() === b.next()) same++;
    }
    expect(same).toBeLessThan(5);
  });

  it('next() returns values in [0, 1)', () => {
    const r = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('range(lo, hi) returns values in [lo, hi)', () => {
    const r = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const x = r.range(10, 20);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThan(20);
    }
  });

  it('intRange(lo, hi) returns integers in [lo, hi)', () => {
    const r = createRng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const x = r.intRange(0, 5);
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(5);
      seen.add(x);
    }
    expect(seen.size).toBe(5);
  });
});
