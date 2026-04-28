import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { createProjectiles, spawnMusketBall } from '../sim/projectiles';
import { createParticles, spawnParticle, ParticleClass } from '../particles/particles';
import { getUnitKindIndex } from '../data/units';
import { setupStage, resetStage, spawnSubject } from './stage';

function makeAll() {
  const world = createWorld({ seed: 1, capacity: 64, mapSize: 200 });
  const projectiles = createProjectiles(32);
  const particles = createParticles(64);
  return { world, projectiles, particles };
}

describe('setupStage', () => {
  it('spawns 1 subject + 5 dummies; subject is team 0, dummies are team 1', () => {
    const { world, projectiles, particles } = makeAll();
    const stage = setupStage(world, projectiles, particles, 'line-infantry');

    expect(stage.subjectId).not.toBeNull();
    expect(stage.dummyIds.length).toBe(5);
    expect(world.entities.count).toBe(6);

    const subj = stage.subjectId!;
    expect(world.entities.team[subj]).toBe(0);
    expect(world.entities.kindId[subj]).toBe(getUnitKindIndex('line-infantry'));
    expect(world.entities.posX[subj]).toBe(0);
    expect(world.entities.posY[subj]).toBe(0);

    for (const d of stage.dummyIds) {
      expect(world.entities.team[d]).toBe(1);
      expect(world.entities.kindId[d]).toBe(getUnitKindIndex('line-infantry'));
      expect(world.entities.posX[d]).toBe(30);
      expect(world.entities.hp[d]).toBeGreaterThan(0);
    }
  });

  it('spawns the requested subject kind (cannon-12)', () => {
    const { world, projectiles, particles } = makeAll();
    const stage = setupStage(world, projectiles, particles, 'cannon-12');
    expect(world.entities.kindId[stage.subjectId!]).toBe(getUnitKindIndex('cannon-12'));
  });
});

describe('resetStage', () => {
  it('clears all alive entities, projectiles, and particles, then re-spawns', () => {
    const { world, projectiles, particles } = makeAll();
    const stage = setupStage(world, projectiles, particles, 'line-infantry');

    // Pollute pools.
    spawnMusketBall(projectiles, 0, 0, 1, 0, 0, 12, 400, 0.03, 0.4, -1);
    spawnMusketBall(projectiles, 0, 0, 1, 0, 0, 12, 400, 0.03, 0.4, -1);
    spawnParticle(particles, {
      x: 0, y: 0, vx: 0, vy: 0,
      life: 1, size: 0.5, r: 1, g: 1, b: 1,
      klass: ParticleClass.Smoke,
    });
    expect(projectiles.count).toBe(2);
    expect(particles.count).toBe(1);

    resetStage(world, projectiles, particles, stage);

    expect(projectiles.count).toBe(0);
    expect(particles.count).toBe(0);
    // Re-spawned: subject + 5 dummies.
    expect(world.entities.count).toBe(6);
    expect(stage.dummyIds.length).toBe(5);
    // Free-list rebuilt: a fresh allocation from the projectile pool should
    // succeed up to capacity again.
    let allocations = 0;
    for (let i = 0; i < projectiles.capacity; i++) {
      if (spawnMusketBall(projectiles, 0, 0, 1, 0, 0, 12, 400, 0.03, 0.4, -1) !== -1) allocations++;
    }
    expect(allocations).toBe(projectiles.capacity);
  });
});

describe('spawnSubject', () => {
  it('replaces the subject without disturbing the dummy row', () => {
    const { world, projectiles, particles } = makeAll();
    const stage = setupStage(world, projectiles, particles, 'line-infantry');
    const oldSubject = stage.subjectId!;
    const oldDummies = [...stage.dummyIds];

    spawnSubject(world, stage, 'cuirassier');

    // Free-list reuse may put the new subject in the old slot — that's fine.
    expect(stage.subjectKind).toBe('cuirassier');
    expect(stage.subjectId).not.toBeNull();
    expect(world.entities.alive[stage.subjectId!]).toBe(1);
    expect(world.entities.kindId[stage.subjectId!]).toBe(getUnitKindIndex('cuirassier'));
    // We should still only have one subject + same five dummies = 6 alive.
    expect(world.entities.count).toBe(6);

    // Dummies unchanged.
    expect(stage.dummyIds).toEqual(oldDummies);
    for (const d of oldDummies) {
      expect(world.entities.alive[d]).toBe(1);
      expect(world.entities.team[d]).toBe(1);
    }
    // Suppress unused-var warning: we asserted via count.
    void oldSubject;
  });
});
