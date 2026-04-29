import { describe, it, expect } from 'vitest';
import { createProjectiles, ProjectileKind, spawnCanister } from './projectiles';
import { cannon12Canister } from '../data/weapons/cannon-12-canister';
import { createRng } from '../util/rng';

describe('spawnCanister', () => {
  it('spawns ballCount projectiles, all Musket kind, all within ±2.5σ of base angle', () => {
    const p = createProjectiles(64);
    const rng = createRng(3);
    spawnCanister(p, 0, 0, 1, 0, 0, cannon12Canister, -1, rng);

    let n = 0;
    let allMusket = true;
    let allInRange = true;
    const halfCone = (cannon12Canister.coneDeg * Math.PI / 180) / 2;
    const tolerance = halfCone * 2.5;       // 2.5x cone half-angle accommodates 2σ tail
    for (let i = 0; i < p.capacity; i++) {
      if (!p.alive[i]) continue;
      n++;
      if (p.kind[i] !== ProjectileKind.Musket) allMusket = false;
      const a = Math.atan2(p.velY[i]!, p.velX[i]!);
      if (Math.abs(a) > tolerance) allInRange = false;
    }
    expect(n).toBe(cannon12Canister.ballCount);
    expect(allMusket).toBe(true);
    expect(allInRange).toBe(true);
  });

  it('per-ball damage and mass come from profile', () => {
    const p = createProjectiles(64);
    const rng = createRng(5);
    spawnCanister(p, 0, 0, 1, 0, 0, cannon12Canister, -1, rng);
    for (let i = 0; i < p.capacity; i++) {
      if (!p.alive[i]) continue;
      expect(p.damage[i]).toBeCloseTo(cannon12Canister.ballDamage, 4);
      expect(p.mass[i]).toBeCloseTo(cannon12Canister.ballMass, 4);
    }
  });
});
