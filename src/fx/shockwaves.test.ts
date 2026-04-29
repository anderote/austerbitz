import { describe, it, expect } from 'vitest';
import {
  createShockwaves,
  allocShockwave,
  freeShockwave,
  setHit,
  isHit,
} from './shockwaves';

describe('Shockwaves', () => {
  it('alloc returns -1 when full and recycles after free', () => {
    const s = createShockwaves(2, 64);
    const a = allocShockwave(s);
    const b = allocShockwave(s);
    expect(allocShockwave(s)).toBe(-1);
    freeShockwave(s, a);
    const c = allocShockwave(s);
    expect(c).toBe(a);
    expect(s.alive[b]).toBe(1);
  });

  it('hitMask is per-shockwave and clears on alloc', () => {
    const s = createShockwaves(2, 64);
    const a = allocShockwave(s);
    setHit(s, a, 7);
    expect(isHit(s, a, 7)).toBe(true);
    expect(isHit(s, a, 8)).toBe(false);
    freeShockwave(s, a);
    const b = allocShockwave(s);
    expect(isHit(s, b, 7)).toBe(false);    // cleared on alloc
  });

  it('hitMask is bounds-checked: out-of-range ids are silently skipped', () => {
    const s = createShockwaves(1, 64);
    const a = allocShockwave(s);

    // Out-of-range setHit must not throw, must not corrupt adjacent storage.
    expect(() => setHit(s, a, 64)).not.toThrow();
    expect(() => setHit(s, a, -1)).not.toThrow();
    expect(() => setHit(s, a, 1_000_000)).not.toThrow();

    // Out-of-range isHit returns true — the "skip" sentinel.
    expect(isHit(s, a, 64)).toBe(true);
    expect(isHit(s, a, -1)).toBe(true);

    // OOB setHit did not bleed into any valid bit.
    for (let i = 0; i < 64; i++) {
      expect(isHit(s, a, i)).toBe(false);
    }
  });
});
