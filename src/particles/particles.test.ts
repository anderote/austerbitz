import { describe, it, expect } from 'vitest';
import { ParticleClass, createParticles, spawnParticle, updateParticles } from './particles';

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
    // Default drag = 0.98 applied before integration: vx becomes 9.8, posX += 9.8 * 0.1 = 0.98
    expect(p.posX[id]).toBeCloseTo(0.98, 5);
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

  it('accelY adds upward acceleration over time', () => {
    const p = createParticles(4);
    const id = spawnParticle(p, {
      x: 0, y: 0, vx: 0, vy: 0, life: 10, size: 1, r: 1, g: 1, b: 1,
      accelY: 5,
    });
    updateParticles(p, 1.0);
    // drag (default 0.98) applied first to vy=0 → 0; then vy += 5 * 1.0 = 5
    expect(p.velY[id]).toBeCloseTo(5, 5);
  });

  it('sizeGrowth scales size per second', () => {
    const p = createParticles(4);
    const id = spawnParticle(p, {
      x: 0, y: 0, vx: 0, vy: 0, life: 10, size: 1, r: 1, g: 1, b: 1,
      sizeGrowth: 1.0,
    });
    updateParticles(p, 1.0);
    // size *= 1 + 1.0 * 1.0 = 2
    expect(p.size[id]).toBeCloseTo(2, 5);
  });

  it('drag is per-tick (not per-second)', () => {
    const p = createParticles(4);
    const id = spawnParticle(p, {
      x: 0, y: 0, vx: 10, vy: 0, life: 10, size: 1, r: 1, g: 1, b: 1,
      drag: 0.5,
    });
    updateParticles(p, 0.016);
    // Per-tick multiplier ignores dt: vx *= 0.5 → 5
    expect(p.velX[id]).toBeCloseTo(5, 5);
  });

  it('klass field round-trips per spawn', () => {
    const p = createParticles(8);
    const dustId = spawnParticle(p, {
      x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1,
      klass: ParticleClass.Dust,
    });
    const smokeId = spawnParticle(p, {
      x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1,
      klass: ParticleClass.Smoke,
    });
    const flashId = spawnParticle(p, {
      x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1,
      klass: ParticleClass.Flash,
    });
    const bloodId = spawnParticle(p, {
      x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1,
      klass: ParticleClass.Blood,
    });
    const debrisId = spawnParticle(p, {
      x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1,
      klass: ParticleClass.Debris,
    });
    const defaultId = spawnParticle(p, {
      x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1,
    });
    expect(p.klass[dustId]).toBe(ParticleClass.Dust);
    expect(p.klass[smokeId]).toBe(ParticleClass.Smoke);
    expect(p.klass[flashId]).toBe(ParticleClass.Flash);
    expect(p.klass[bloodId]).toBe(ParticleClass.Blood);
    expect(p.klass[debrisId]).toBe(ParticleClass.Debris);
    // Default klass when omitted is Dust
    expect(p.klass[defaultId]).toBe(ParticleClass.Dust);
  });
});
