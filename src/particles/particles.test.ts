import { describe, it, expect } from 'vitest';
import { createParticles, spawnParticle, updateParticles } from './particles';

describe('particle pool', () => {
  it('spawn returns a slot index and increments live count', () => {
    const p = createParticles(8);
    const id = spawnParticle(p, { x: 0, y: 0, vx: 1, vy: 0, life: 1, size: 0.5, r: 1, g: 1, b: 1 });
    expect(id).toBeGreaterThanOrEqual(0);
    expect(p.count).toBe(1);
  });

  it('returns -1 when full', () => {
    const p = createParticles(2);
    spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    const id = spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    expect(id).toBe(-1);
  });

  it('updateParticles advances position and decays life', () => {
    const p = createParticles(8);
    const id = spawnParticle(p, { x: 0, y: 0, vx: 10, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    updateParticles(p, 0.1);
    expect(p.posX[id]).toBeCloseTo(1, 5);
    expect(p.life[id]).toBeCloseTo(0.9, 5);
  });

  it('expires particles when life reaches 0 and reuses their slot', () => {
    const p = createParticles(2);
    const a = spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 0.05, size: 1, r: 1, g: 1, b: 1 });
    spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    updateParticles(p, 0.1);
    expect(p.count).toBe(1);
    const reused = spawnParticle(p, { x: 7, y: 7, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    expect(reused).toBe(a);
  });
});
