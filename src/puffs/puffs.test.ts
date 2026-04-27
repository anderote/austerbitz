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

describe('updatePuffs growth and drag', () => {
  it('size grows additively (not multiplicatively) at edgeGrowth m/s', () => {
    const p = createPuffs(2);
    const i = allocPuff(p);
    p.life[i] = 10; p.lifeMax[i] = 10;
    p.size[i] = 1.0; p.sizeMax[i] = 5.0; p.edgeGrowth[i] = 0.5;
    p.drag[i] = 1; p.inertiaWeight[i] = 0; p.inertiaExp[i] = 1;
    updatePuffs(p, 1.0);
    expect(p.size[i]).toBeCloseTo(1.5, 5);
    updatePuffs(p, 1.0);
    expect(p.size[i]).toBeCloseTo(2.0, 5);
  });

  it('size growth is clamped at sizeMax', () => {
    const p = createPuffs(2);
    const i = allocPuff(p);
    p.life[i] = 10; p.lifeMax[i] = 10;
    p.size[i] = 4.5; p.sizeMax[i] = 5.0; p.edgeGrowth[i] = 10.0;
    p.drag[i] = 1;
    updatePuffs(p, 1.0);
    expect(p.size[i]).toBe(5.0);
  });

  it('larger puffs experience more drag (size-damped)', () => {
    const p = createPuffs(2);
    const small = allocPuff(p);
    p.life[small] = 10; p.lifeMax[small] = 10;
    p.size[small] = 0.1; p.sizeMax[small] = 4.0;
    p.velX[small] = 10; p.velY[small] = 0;
    p.drag[small] = 1.0;
    p.inertiaWeight[small] = 0.5; p.inertiaExp[small] = 2;
    p.edgeGrowth[small] = 0;

    const big = allocPuff(p);
    p.life[big] = 10; p.lifeMax[big] = 10;
    p.size[big] = 4.0; p.sizeMax[big] = 4.0;
    p.velX[big] = 10; p.velY[big] = 0;
    p.drag[big] = 1.0;
    p.inertiaWeight[big] = 0.5; p.inertiaExp[big] = 2;
    p.edgeGrowth[big] = 0;

    updatePuffs(p, 1.0);
    // small: drag = 1.0 * (1 - 0.5 * (0.025)^2) ≈ ~0.9997  → vel ≈ 9.997
    // big:   drag = 1.0 * (1 - 0.5 * 1) = 0.5             → vel = 5.0
    expect(p.velX[small]!).toBeGreaterThan(9.9);
    expect(p.velX[big]!).toBe(5.0);
  });
});
