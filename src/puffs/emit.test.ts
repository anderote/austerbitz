import { describe, it, expect } from 'vitest';
import { createPuffs } from './puffs';
import { registerProfile, type PuffProfile } from './profile';
import { emitPuff, emitPuffBurst } from './emit';
import { createRng } from '../util/rng';

const P: PuffProfile = {
  id: 'emit-test',
  sizeStart: { min: 0.4, max: 0.6 },
  life: { min: 1.0, max: 2.0 },
  velScale: 0.5, velJitter: 0.1,
  edgeGrowth: 0.3, sizeMax: 2.0,
  drag: 0.99, buoyancy: -0.2,
  inertiaExp: 2, inertiaWeight: 0.3,
  color: [0.5, 0.6, 0.7], colorJitter: 0.05,
  alpha: 0.8, softness: 0.85,
  coalesce: null,
};
const idx = registerProfile(P);

describe('emitPuff', () => {
  it('writes profile values to the chosen slot', () => {
    const p = createPuffs(4);
    const rng = createRng(1);
    const i = emitPuff(p, P, idx, 100, 200, 5, 0, rng);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(p.alive[i]).toBe(1);
    expect(p.profileIdx[i]).toBe(idx);
    expect(p.size[i]!).toBeGreaterThanOrEqual(0.4);
    expect(p.size[i]!).toBeLessThanOrEqual(0.6);
    expect(p.life[i]!).toBeGreaterThanOrEqual(1.0);
    expect(p.life[i]!).toBeLessThanOrEqual(2.0);
    expect(p.lifeMax[i]).toBe(p.life[i]);
    expect(p.sizeMax[i]).toBe(2.0);
    expect(p.edgeGrowth[i]!).toBeCloseTo(0.3, 5);
    expect(p.drag[i]!).toBeCloseTo(0.99, 5);
    expect(p.buoyancy[i]!).toBeCloseTo(-0.2, 5);
    expect(p.inertiaExp[i]).toBe(2);
    expect(p.inertiaWeight[i]!).toBeCloseTo(0.3, 5);
    expect(p.alpha[i]!).toBeCloseTo(0.8, 5);
    expect(p.softness[i]!).toBeCloseTo(0.85, 5);
    expect(p.posX[i]).toBe(100);
    expect(p.posY[i]).toBe(200);
    // velocity = (vx*scale ± jitter)
    expect(p.velX[i]!).toBeGreaterThanOrEqual(5 * 0.5 - 0.1);
    expect(p.velX[i]!).toBeLessThanOrEqual(5 * 0.5 + 0.1);
  });

  it('color jitter stays within bounds', () => {
    const p = createPuffs(32);
    const rng = createRng(7);
    for (let n = 0; n < 16; n++) {
      const i = emitPuff(p, P, idx, 0, 0, 0, 0, rng);
      expect(p.r[i]!).toBeGreaterThanOrEqual(0.5 - 0.05);
      expect(p.r[i]!).toBeLessThanOrEqual(0.5 + 0.05);
      expect(p.g[i]!).toBeGreaterThanOrEqual(0.6 - 0.05);
      expect(p.g[i]!).toBeLessThanOrEqual(0.6 + 0.05);
      expect(p.b[i]!).toBeGreaterThanOrEqual(0.7 - 0.05);
      expect(p.b[i]!).toBeLessThanOrEqual(0.7 + 0.05);
    }
  });
});

describe('emitPuffBurst', () => {
  it('emits the requested count within the cone', () => {
    const p = createPuffs(64);
    const rng = createRng(11);
    emitPuffBurst(p, P, idx, 0, 0, 1, 0, 10, 0.4, { min: 4, max: 6 }, rng);
    let n = 0;
    for (let i = 0; i < p.capacity; i++) if (p.alive[i] === 1) n++;
    expect(n).toBe(10);
    // All velocities should have positive x component (forward cone, dir = (1,0)).
    let sumVx = 0;
    for (let i = 0; i < p.capacity; i++) if (p.alive[i] === 1) sumVx += p.velX[i]!;
    expect(sumVx / 10).toBeGreaterThan(0);
  });
});
