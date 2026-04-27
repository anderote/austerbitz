import { describe, it, expect } from 'vitest';
import { createParticles, spawnParticle, ParticleClass } from '../particles/particles';
import { applyWind } from './wind';

describe('applyWind', () => {
  it('only modifies smoke particles velX; leaves dust/blood/flash/debris untouched', () => {
    const p = createParticles(16);

    const smokeId = spawnParticle(p, {
      x: 0, y: 0, vx: 1, vy: 0,
      life: 1, size: 0.5, r: 0.8, g: 0.8, b: 0.8,
      klass: ParticleClass.Smoke,
    });
    const dustId = spawnParticle(p, {
      x: 0, y: 0, vx: 1, vy: 0,
      life: 1, size: 0.5, r: 0.6, g: 0.5, b: 0.4,
      klass: ParticleClass.Dust,
    });
    const flashId = spawnParticle(p, {
      x: 0, y: 0, vx: 1, vy: 0,
      life: 1, size: 0.5, r: 1, g: 1, b: 1,
      klass: ParticleClass.Flash,
    });
    const bloodId = spawnParticle(p, {
      x: 0, y: 0, vx: 1, vy: 0,
      life: 1, size: 0.5, r: 0.5, g: 0, b: 0,
      klass: ParticleClass.Blood,
    });
    const debrisId = spawnParticle(p, {
      x: 0, y: 0, vx: 1, vy: 0,
      life: 1, size: 0.5, r: 0.5, g: 0.4, b: 0.3,
      klass: ParticleClass.Debris,
    });

    const accel = 0.5; // m/s²
    const dt = 0.5;
    applyWind(p, accel, dt);

    expect(p.velX[smokeId]).toBeCloseTo(1 + accel * dt, 6);
    // Non-smoke kinds untouched.
    expect(p.velX[dustId]).toBe(1);
    expect(p.velX[flashId]).toBe(1);
    expect(p.velX[bloodId]).toBe(1);
    expect(p.velX[debrisId]).toBe(1);
    // velY is never touched, even on smoke.
    expect(p.velY[smokeId]).toBe(0);
  });

  it('does nothing when accel is 0 (early-out)', () => {
    const p = createParticles(4);
    const id = spawnParticle(p, {
      x: 0, y: 0, vx: 2, vy: 3,
      life: 1, size: 0.5, r: 1, g: 1, b: 1,
      klass: ParticleClass.Smoke,
    });
    applyWind(p, 0, 1.0);
    expect(p.velX[id]).toBe(2);
    expect(p.velY[id]).toBe(3);
  });

  it('skips dead particles', () => {
    const p = createParticles(4);
    const id = spawnParticle(p, {
      x: 0, y: 0, vx: 1, vy: 0,
      life: 1, size: 0.5, r: 1, g: 1, b: 1,
      klass: ParticleClass.Smoke,
    });
    p.alive[id] = 0; // simulate death
    applyWind(p, 1.0, 1.0);
    expect(p.velX[id]).toBe(1);
  });
});
