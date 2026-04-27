import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { createProjectiles, ProjectileKind } from '../sim/projectiles';
import { createParticles } from '../particles/particles';
import { createPuffs } from '../puffs/puffs';
import { EntityState } from '../sim/entities';
import { type FireOrders } from '../sim/systems/state-system';
import { setupStage } from './stage';
import {
  actFire,
  actCharge,
  actTakeMusketHit,
  actExplosiveShell,
} from './actions';

function harness(kind: string) {
  const world = createWorld({ seed: 1, capacity: 64, mapSize: 200 });
  const projectiles = createProjectiles(32);
  const particles = createParticles(512);
  const puffs = createPuffs(64);
  const stage = setupStage(world, projectiles, particles, kind);
  const fireOrders: FireOrders = new Map();
  return { world, projectiles, particles, puffs, stage, fireOrders };
}

describe('actFire', () => {
  it('pushes a line-infantry subject into Aiming + adds a fire order', () => {
    const { world, projectiles, particles, stage, fireOrders } = harness('line-infantry');
    void projectiles; void particles;

    actFire(world, fireOrders, stage);

    const id = stage.subjectId!;
    expect(world.entities.state[id]).toBe(EntityState.Aiming);
    expect(fireOrders.has(id)).toBe(true);
    const order = fireOrders.get(id)!;
    expect(order.tx).toBe(30);
    expect(order.ty).toBe(0);
  });

  it('interrupts an in-flight reload and re-enters Aiming', () => {
    const { world, stage, fireOrders } = harness('line-infantry');
    const id = stage.subjectId!;
    world.entities.state[id] = EntityState.Reloading;
    world.entities.reloadT[id] = 5;

    actFire(world, fireOrders, stage);

    expect(world.entities.state[id]).toBe(EntityState.Aiming);
    expect(fireOrders.has(id)).toBe(true);
  });
});

describe('actTakeMusketHit', () => {
  it('drops subject HP', () => {
    const { world, particles, stage } = harness('line-infantry');
    const id = stage.subjectId!;
    const hp0 = world.entities.hp[id]!;
    actTakeMusketHit(world, particles, world.rng, stage);
    expect(world.entities.hp[id]).toBeLessThan(hp0);
  });
});

describe('actCharge', () => {
  it('cuirassier subject gets non-zero forward velocity', () => {
    const { world, stage } = harness('cuirassier');
    const id = stage.subjectId!;
    expect(world.entities.velX[id]).toBe(0);

    actCharge(world, stage);

    // facing east, gallop = moveSpeed * 2.
    expect(world.entities.velX[id]!).toBeGreaterThan(0);
    expect(Math.hypot(world.entities.velX[id]!, world.entities.velY[id]!))
      .toBeGreaterThan(0);
  });

  it('is a no-op for non-cavalry subjects', () => {
    const { world, stage } = harness('line-infantry');
    const id = stage.subjectId!;
    actCharge(world, stage);
    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
  });
});

describe('actExplosiveShell', () => {
  it('cannon-12 subject spawns one Shell projectile', () => {
    const { world, projectiles, particles, puffs, stage } = harness('cannon-12');
    expect(projectiles.count).toBe(0);

    actExplosiveShell(world, projectiles, particles, puffs, stage);

    expect(projectiles.count).toBe(1);
    // Find the alive shell.
    let foundShell = -1;
    for (let i = 0; i < projectiles.capacity; i++) {
      if (projectiles.alive[i] === 1) { foundShell = i; break; }
    }
    expect(foundShell).not.toBe(-1);
    expect(projectiles.kind[foundShell]).toBe(ProjectileKind.Shell);
    expect(projectiles.fuseT[foundShell]).toBeGreaterThan(0);
  });

  it('is a no-op when subject is not cannon-12', () => {
    const { world, projectiles, particles, puffs, stage } = harness('line-infantry');
    actExplosiveShell(world, projectiles, particles, puffs, stage);
    expect(projectiles.count).toBe(0);
  });
});
