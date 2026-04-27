import { describe, it, expect } from 'vitest';
import { createPuffs, allocPuff, updatePuffs } from './puffs';

describe('puffs pool', () => {
  it('alloc returns a slot and increments count', () => {
    const p = createPuffs(8);
    const i = allocPuff(p);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(p.count).toBe(1);
    expect(p.alive[i]).toBe(1);
  });

  it('returns -1 when full', () => {
    const p = createPuffs(2);
    allocPuff(p); allocPuff(p);
    expect(allocPuff(p)).toBe(-1);
  });

  it('life decays and slot frees on expiry', () => {
    const p = createPuffs(4);
    const i = allocPuff(p);
    p.life[i] = 0.05; p.lifeMax[i] = 0.05;
    p.size[i] = 1; p.sizeMax[i] = 2; p.edgeGrowth[i] = 0;
    p.drag[i] = 1; p.inertiaWeight[i] = 0;
    updatePuffs(p, 0.1);
    expect(p.alive[i]).toBe(0);
    expect(p.count).toBe(0);
  });
});
