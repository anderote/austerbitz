import { describe, it, expect } from 'vitest';
import { createParticles, ParticleClass } from './particles';
import {
  emitDust,
  emitMuzzleFx,
  spawnBlood,
  emitRicochetBurst,
  emitImpactDust,
  emitCannonballTrail,
} from './emitters';
import { createRng } from '../util/rng';
import { musket } from '../data/weapons/musket';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';

function countByClass(p: ReturnType<typeof createParticles>, klass: number): number {
  let n = 0;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 1 && p.klass[i] === klass) n++;
  }
  return n;
}

describe('emitMuzzleFx', () => {
  it('spawns exactly 1 flash + 10 smoke particles for the musket profile', () => {
    const p = createParticles(64);
    const rng = createRng(1);
    emitMuzzleFx(p, musket.muzzle!, 0, 0, 1, 0, rng);
    expect(p.count).toBe(11);
    expect(countByClass(p, ParticleClass.Flash)).toBe(1);
    expect(countByClass(p, ParticleClass.Smoke)).toBe(10);
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

describe('emitDust merging', () => {
  it('coalesces nearby emissions into one growing, longer-lived cloud', () => {
    // 8 marching soldiers in a tight cluster — all within merge radius.
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 200 });
    for (let k = 0; k < 8; k++) {
      const id = allocEntity(world.entities);
      world.entities.posX[id] = 50 + (k % 2) * 0.1;
      world.entities.posY[id] = 50 + Math.floor(k / 2) * 0.1;
      world.entities.velX[id] = 1;
      world.entities.velY[id] = 0;
    }
    const p = createParticles(64);
    // dt=1 → expected=1.2; rng.next()∈[0,1), so every soldier emits this tick.
    emitDust(world, p, 1);
    expect(p.count).toBe(1);
    let idx = -1;
    for (let i = 0; i < p.capacity; i++) if (p.alive[i] === 1) { idx = i; break; }
    expect(p.klass[idx]).toBe(ParticleClass.Dust);
    // Base spawn size at speed=1 is ~0.34; 7 merges add 7*0.08, so > 0.7.
    expect(p.size[idx]!).toBeGreaterThan(0.7);
    // Base spawn life ≤ 3.2; 7 merges add 7*0.4, so > 3.5.
    expect(p.life[idx]!).toBeGreaterThan(3.5);
    // Renderer fades by life/lifeMax — must remain ≤ 1.
    expect(p.life[idx]!).toBeLessThanOrEqual(p.lifeMax[idx]! + 1e-6);
  });

  it('does not merge emissions far apart', () => {
    const world = createWorld({ seed: 2, capacity: 16, mapSize: 1000 });
    const a = allocEntity(world.entities);
    world.entities.posX[a] = 10; world.entities.posY[a] = 10;
    world.entities.velX[a] = 1;
    const b = allocEntity(world.entities);
    world.entities.posX[b] = 100; world.entities.posY[b] = 100;
    world.entities.velX[b] = 1;
    const p = createParticles(64);
    emitDust(world, p, 1);
    expect(p.count).toBe(2);
  });

  it('caps cloud size and life under heavy accretion', () => {
    // Many emissions at the same spot — caps must hold.
    const world = createWorld({ seed: 3, capacity: 200, mapSize: 200 });
    for (let k = 0; k < 100; k++) {
      const id = allocEntity(world.entities);
      world.entities.posX[id] = 50;
      world.entities.posY[id] = 50;
      world.entities.velX[id] = 1;
    }
    const p = createParticles(256);
    emitDust(world, p, 1);
    let idx = -1;
    for (let i = 0; i < p.capacity; i++) if (p.alive[i] === 1) { idx = i; break; }
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(p.size[idx]!).toBeLessThanOrEqual(1.0 + 1e-6);
    expect(p.life[idx]!).toBeLessThanOrEqual(12.0 + 1e-6);
    expect(p.life[idx]!).toBeLessThanOrEqual(p.lifeMax[idx]! + 1e-6);
  });
});

describe('emitCannonballTrail', () => {
  it('emits exactly 1 Smoke particle with positive sizeGrowth', () => {
    const p = createParticles(8);
    const rng = createRng(13);
    emitCannonballTrail(p, 0, 0, rng);
    expect(p.count).toBe(1);
    expect(countByClass(p, ParticleClass.Smoke)).toBe(1);
    let idx = -1;
    for (let i = 0; i < p.capacity; i++) {
      if (p.alive[i] === 1) { idx = i; break; }
    }
    expect(p.sizeGrowth[idx]).toBeGreaterThan(0);
  });
});
