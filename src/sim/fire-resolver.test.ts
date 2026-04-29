import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities } from './entities';
import { createProjectiles, ProjectileKind } from './projectiles';
import { createParticles } from '../particles/particles';
import { createPuffs } from '../puffs/puffs';
import { createRng } from '../util/rng';
import { getUnitKindIndex } from '../data/units';
import { lineInfantry } from '../data/units/line-infantry';
import { resolveFire, RECOIL_T } from './fire-resolver';
import { Rank } from './veterancy';

describe('resolveFire', () => {
  it('line-infantry firing east: spawns one musket ball + muzzle FX, sets recoilT', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const puffs = createPuffs(64);
    const rng = createRng(42);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0; // east
    e.team[id] = 1;

    const ok = resolveFire(e, projectiles, particles, puffs, rng, id, 50, 0);

    expect(ok).toBe(true);
    expect(projectiles.count).toBe(1);
    expect(projectiles.kind[0]).toBe(ProjectileKind.Musket);
    expect(particles.count).toBeGreaterThan(0);
    expect(e.recoilT[id]).toBeCloseTo(RECOIL_T, 6);
  });

  it('cannon-12 firing 100m east: spawns one solid-shot at launchHeight = 0.7', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const puffs = createPuffs(64);
    const rng = createRng(7);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('cannon-12');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0; // east
    e.team[id] = 0;

    const ok = resolveFire(e, projectiles, particles, puffs, rng, id, 100, 0);

    expect(ok).toBe(true);
    expect(projectiles.count).toBe(1);
    expect(projectiles.kind[0]).toBe(ProjectileKind.SolidShot);
    expect(projectiles.posZ[0]).toBeCloseTo(0.7, 6);
    // Solid-shot should have positive horizontal velocity toward the target.
    expect(projectiles.velX[0]!).toBeGreaterThan(0);
    // And a positive launch vz on the lower trajectory.
    expect(projectiles.velZ[0]!).toBeGreaterThan(0);
    // cannon-12 has recoilDuration: 3.5 on its muzzle profile.
    expect(e.recoilT[id]).toBeCloseTo(3.5, 6);
    expect(e.recoilTotal[id]).toBeCloseTo(3.5, 6);
  });

  it('cuirassier (no weapon): returns false; nothing spawned', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const puffs = createPuffs(64);
    const rng = createRng(1);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('cuirassier');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0;

    const ok = resolveFire(e, projectiles, particles, puffs, rng, id, 10, 0);

    expect(ok).toBe(false);
    expect(projectiles.count).toBe(0);
    expect(particles.count).toBe(0);
    expect(e.recoilT[id]).toBe(0);
  });

  it('musket self-target (target == barrel position): returns false; nothing spawned', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const puffs = createPuffs(64);
    const rng = createRng(1);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0;

    // line-infantry barrel offset is (forward 0.4, side 0, height 1.4).
    // Aim exactly at the tip — zero horizontal range → no shot.
    const ok = resolveFire(e, projectiles, particles, puffs, rng, id, 0.4, 0);

    expect(ok).toBe(false);
    expect(projectiles.count).toBe(0);
    expect(particles.count).toBe(0);
    expect(e.recoilT[id]).toBe(0);
  });

  it('cannon out-of-range target returns false; nothing spawned', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const puffs = createPuffs(64);
    const rng = createRng(1);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('cannon-12');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0;
    e.team[id] = 0;

    // 250 m/s muzzle speed, gravity 18 → max range ≈ v²/g ≈ 3472 m. Pick way past.
    const ok = resolveFire(e, projectiles, particles, puffs, rng, id, 100_000, 0);

    expect(ok).toBe(false);
    expect(projectiles.count).toBe(0);
    expect(particles.count).toBe(0);
  });

  it('uses kind.baseStats.weaponDamage as the projectile damage', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const puffs = createPuffs(64);
    const rng = createRng(42);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0; // east
    e.team[id] = 1;

    const ok = resolveFire(e, projectiles, particles, puffs, rng, id, 50, 0);

    expect(ok).toBe(true);
    expect(projectiles.count).toBe(1);
    expect(projectiles.damage[0]).toBe(lineInfantry.baseStats.weaponDamage);
  });

  it('changing baseStats.weaponDamage flows through to the projectile', () => {
    const original = lineInfantry.baseStats.weaponDamage;
    try {
      (lineInfantry.baseStats as { weaponDamage: number }).weaponDamage = 99;

      const e = createEntities(8);
      const projectiles = createProjectiles(16);
      const particles = createParticles(256);
      const puffs = createPuffs(64);
      const rng = createRng(42);

      const id = allocEntity(e);
      e.kindId[id] = getUnitKindIndex('line-infantry');
      e.posX[id] = 0;
      e.posY[id] = 0;
      e.facing[id] = 0; // east
      e.team[id] = 1;

      const ok = resolveFire(e, projectiles, particles, puffs, rng, id, 50, 0);

      expect(ok).toBe(true);
      expect(projectiles.count).toBe(1);
      // Musket has ±33% damage variance; assert the roll is in [66, 132].
      expect(projectiles.damage[0]).toBeGreaterThanOrEqual(99 * 0.66);
      expect(projectiles.damage[0]).toBeLessThanOrEqual(99 * 1.34);
    } finally {
      (lineInfantry.baseStats as { weaponDamage: number }).weaponDamage = original;
    }
  });

  it('applies rank damage multiplier on fire', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const puffs = createPuffs(64);
    const rng = createRng(42);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0; // east
    e.team[id] = 1;
    e.rank[id] = Rank.Captain;

    const ok = resolveFire(e, projectiles, particles, puffs, rng, id, 50, 0);

    expect(ok).toBe(true);
    expect(projectiles.count).toBe(1);
    // Captain rank → 1.25× base; musket has ±33% variance on top.
    const expectedMean = lineInfantry.baseStats.weaponDamage * 1.25;
    expect(projectiles.damage[0]).toBeGreaterThanOrEqual(expectedMean * 0.66);
    expect(projectiles.damage[0]).toBeLessThanOrEqual(expectedMean * 1.34);
  });

  it('musket recoil sets a render-only peak offset opposite the shot direction; sim pos/vel untouched', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const puffs = createPuffs(64);
    const rng = createRng(1);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0; // east
    e.team[id] = 1;

    const ok = resolveFire(e, projectiles, particles, puffs, rng, id, 100, 0);
    expect(ok).toBe(true);
    // Shot is roughly east → recoil peak points west (negative X).
    expect(e.recoilPeakX[id]!).toBeLessThan(0);
    // Sim position and velocity are not perturbed — the offset is render-only.
    expect(e.posX[id]!).toBe(0);
    expect(e.posY[id]!).toBe(0);
    expect(e.velX[id]!).toBe(0);
    expect(e.velY[id]!).toBe(0);
  });
});
