import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities } from './entities';
import { createProjectiles, ProjectileKind } from './projectiles';
import { createParticles } from '../particles/particles';
import { createRng } from '../util/rng';
import { getUnitKindIndex } from '../data/units';
import { resolveFire } from './fire-resolver';

describe('resolveFire', () => {
  it('line-infantry firing east: spawns one musket ball + muzzle FX, sets recoilT', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const rng = createRng(42);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0; // east
    e.team[id] = 1;

    const ok = resolveFire(e, projectiles, particles, rng, id, 50, 0);

    expect(ok).toBe(true);
    expect(projectiles.count).toBe(1);
    expect(projectiles.kind[0]).toBe(ProjectileKind.Musket);
    expect(particles.count).toBeGreaterThan(0);
    expect(e.recoilT[id]).toBeCloseTo(0.12, 6);
  });

  it('cannon-12 firing 100m east: spawns one solid-shot at launchHeight = 0.7', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const rng = createRng(7);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('cannon-12');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0; // east
    e.team[id] = 0;

    const ok = resolveFire(e, projectiles, particles, rng, id, 100, 0);

    expect(ok).toBe(true);
    expect(projectiles.count).toBe(1);
    expect(projectiles.kind[0]).toBe(ProjectileKind.SolidShot);
    expect(projectiles.posZ[0]).toBeCloseTo(0.7, 6);
    // Solid-shot should have positive horizontal velocity toward the target.
    expect(projectiles.velX[0]!).toBeGreaterThan(0);
    // And a positive launch vz on the lower trajectory.
    expect(projectiles.velZ[0]!).toBeGreaterThan(0);
    expect(e.recoilT[id]).toBeCloseTo(0.12, 6);
  });

  it('cuirassier (no weapon): returns false; nothing spawned', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const rng = createRng(1);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('cuirassier');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0;

    const ok = resolveFire(e, projectiles, particles, rng, id, 10, 0);

    expect(ok).toBe(false);
    expect(projectiles.count).toBe(0);
    expect(particles.count).toBe(0);
    expect(e.recoilT[id]).toBe(0);
  });

  it('musket self-target (target == barrel position): returns false; nothing spawned', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const rng = createRng(1);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0;

    // line-infantry barrel offset is (forward 0.4, side 0, height 1.4).
    // Aim exactly at the tip — zero horizontal range → no shot.
    const ok = resolveFire(e, projectiles, particles, rng, id, 0.4, 0);

    expect(ok).toBe(false);
    expect(projectiles.count).toBe(0);
    expect(particles.count).toBe(0);
    expect(e.recoilT[id]).toBe(0);
  });

  it('cannon out-of-range target returns false; nothing spawned', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const rng = createRng(1);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('cannon-12');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0;
    e.team[id] = 0;

    // 250 m/s muzzle speed, gravity 18 → max range ≈ v²/g ≈ 3472 m. Pick way past.
    const ok = resolveFire(e, projectiles, particles, rng, id, 100_000, 0);

    expect(ok).toBe(false);
    expect(projectiles.count).toBe(0);
    expect(particles.count).toBe(0);
  });

  it('musket recoil applies a velocity nudge opposite the shot direction', () => {
    const e = createEntities(8);
    const projectiles = createProjectiles(16);
    const particles = createParticles(256);
    const rng = createRng(1);

    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0; // east
    e.team[id] = 1;

    const ok = resolveFire(e, projectiles, particles, rng, id, 100, 0);
    expect(ok).toBe(true);
    // Musket recoilFirer = 0.5 m/s; shot is roughly east → recoil pushes velX negative.
    expect(e.velX[id]!).toBeLessThan(0);
  });
});
