import { describe, it, expect } from 'vitest';
import { createParticles, ParticleClass } from './particles';
import {
  emitMuzzleFx,
  spawnBlood,
  emitRicochetBurst,
  emitImpactDust,
} from './emitters';
import { createRng } from '../util/rng';
import { musket } from '../data/weapons/musket';

function countByClass(p: ReturnType<typeof createParticles>, klass: number): number {
  let n = 0;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 1 && p.klass[i] === klass) n++;
  }
  return n;
}

describe('emitMuzzleFx', () => {
  it('spawns exactly 1 flash particle for the musket profile (smoke handled by puffs)', () => {
    const p = createParticles(64);
    const rng = createRng(1);
    emitMuzzleFx(p, musket.muzzle!, 0, 0, 1, 0, rng);
    expect(p.count).toBe(1);
    expect(countByClass(p, ParticleClass.Flash)).toBe(1);
  });

  it('flash particle has correct size, life, and color', () => {
    const p = createParticles(64);
    const rng = createRng(42);
    emitMuzzleFx(p, musket.muzzle!, 0, 0, 1, 0, rng);
    // The flash is emitted first, so it sits in slot 0.
    let flashIdx = -1;
    for (let i = 0; i < p.capacity; i++) {
      if (p.alive[i] === 1 && p.klass[i] === ParticleClass.Flash) { flashIdx = i; break; }
    }
    expect(flashIdx).toBeGreaterThanOrEqual(0);
    expect(p.size[flashIdx]).toBeCloseTo(musket.muzzle!.flash.size, 5);
    expect(p.life[flashIdx]).toBeCloseTo(musket.muzzle!.flash.life, 5);
    expect(p.r[flashIdx]).toBeCloseTo(musket.muzzle!.flash.color[0], 5);
    expect(p.g[flashIdx]).toBeCloseTo(musket.muzzle!.flash.color[1], 5);
    expect(p.b[flashIdx]).toBeCloseTo(musket.muzzle!.flash.color[2], 5);
    // Flash should have zero velocity and high drag (snaps out fast).
    expect(p.velX[flashIdx]).toBe(0);
    expect(p.velY[flashIdx]).toBe(0);
    expect(p.drag[flashIdx]).toBeCloseTo(0.6, 5);
  });
});

describe('spawnBlood', () => {
  it('produces 4 particles at the low-end clamp (intensity=12)', () => {
    const p = createParticles(64);
    const rng = createRng(7);
    spawnBlood(p, 0, 0, 12, rng);
    expect(p.count).toBe(4);
    expect(countByClass(p, ParticleClass.Blood)).toBe(4);
  });

  it('produces 14 particles at the high-end clamp (intensity=10000)', () => {
    const p = createParticles(64);
    const rng = createRng(11);
    spawnBlood(p, 0, 0, 10000, rng);
    expect(p.count).toBe(14);
    expect(countByClass(p, ParticleClass.Blood)).toBe(14);
  });
});

describe('emitRicochetBurst', () => {
  it('emits at least 12 Debris particles with positive x-velocity bias for forward fire', () => {
    const p = createParticles(64);
    const rng = createRng(3);
    emitRicochetBurst(p, 0, 0, 10, 0, rng);
    expect(p.count).toBeGreaterThanOrEqual(12);
    expect(countByClass(p, ParticleClass.Debris)).toBe(p.count);
    let sumVx = 0;
    let n = 0;
    for (let i = 0; i < p.capacity; i++) {
      if (p.alive[i] === 1) { sumVx += p.velX[i]!; n++; }
    }
    expect(n).toBeGreaterThan(0);
    expect(sumVx / n).toBeGreaterThan(0);
  });

  it('skips emission when velocity is zero', () => {
    const p = createParticles(64);
    const rng = createRng(5);
    emitRicochetBurst(p, 0, 0, 0, 0, rng);
    expect(p.count).toBe(0);
  });
});

describe('emitImpactDust', () => {
  it('emits 4-6 Dust particles', () => {
    const p = createParticles(64);
    const rng = createRng(9);
    emitImpactDust(p, 0, 0, rng);
    expect(p.count).toBeGreaterThanOrEqual(4);
    expect(p.count).toBeLessThanOrEqual(6);
    expect(countByClass(p, ParticleClass.Dust)).toBe(p.count);
  });
});


