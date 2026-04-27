import { describe, it, expect } from 'vitest';
import {
  createProjectiles,
  spawnMusketBall,
  spawnSolidShot,
  spawnShell,
} from '../../sim/projectiles';
import {
  computeProjectileInstances,
  createProjectileInstanceBuckets,
} from './projectile-pass';

describe('computeProjectileInstances', () => {
  it('empty pool produces empty buckets', () => {
    const projectiles = createProjectiles(8);
    const buckets = createProjectileInstanceBuckets(32);
    computeProjectileInstances(projectiles, buckets);
    expect(buckets.shadow.count).toBe(0);
    expect(buckets.ball.count).toBe(0);
    expect(buckets.musket.count).toBe(0);
  });

  it('a solid-shot at (10, 5, 2) produces one shadow at (10,5) and one ball at (10, 3)', () => {
    const projectiles = createProjectiles(8);
    const id = spawnSolidShot(
      projectiles,
      10, 5, 2,        // pos
      0, 0, 0,         // vel
      0,               // team
      100,             // damage
      4.5,             // mass
      5.0,             // maxLife
      0,               // ricochets
    );
    expect(id).toBeGreaterThanOrEqual(0);

    const buckets = createProjectileInstanceBuckets(32);
    computeProjectileInstances(projectiles, buckets);

    expect(buckets.shadow.count).toBe(1);
    expect(buckets.ball.count).toBe(1);
    expect(buckets.musket.count).toBe(0);

    // Shadow centered at (posX, posY) with squashed-ellipse size.
    expect(buckets.shadow.centerWorld[0]).toBeCloseTo(10);
    expect(buckets.shadow.centerWorld[1]).toBeCloseTo(5);
    expect(buckets.shadow.sizeOrLen[0]).toBeCloseTo(0.18);
    expect(buckets.shadow.sizeOrLen[1]).toBeCloseTo(0.10);
    expect(buckets.shadow.kind[0]).toBe(2);
    expect(buckets.shadow.color[3]).toBeCloseTo(0.4);

    // Ball lifted by Z: (posX, posY - posZ) = (10, 3).
    expect(buckets.ball.centerWorld[0]).toBeCloseTo(10);
    expect(buckets.ball.centerWorld[1]).toBeCloseTo(3);
    expect(buckets.ball.sizeOrLen[0]).toBeCloseTo(0.18);
    expect(buckets.ball.sizeOrLen[1]).toBeCloseTo(0.18);
    expect(buckets.ball.kind[0]).toBe(1);
    expect(buckets.ball.color[3]).toBeCloseTo(1.0);
  });

  it('a shell also produces a shadow + a ball', () => {
    const projectiles = createProjectiles(8);
    spawnShell(projectiles, 0, 0, 1, 0, 0, 0, 0, 50, 5, 1.0, 1.5);
    const buckets = createProjectileInstanceBuckets(32);
    computeProjectileInstances(projectiles, buckets);
    expect(buckets.shadow.count).toBe(1);
    expect(buckets.ball.count).toBe(1);
    expect(buckets.musket.count).toBe(0);
  });

  it('a musket ball renders as a small light-grey 4px square at its current position', () => {
    const projectiles = createProjectiles(8);
    const id = spawnMusketBall(projectiles, 0, 0, 1, 0, 0, 5, 380, 0.025, 1.0);
    expect(id).toBeGreaterThanOrEqual(0);
    projectiles.prevX[id] = 0;
    projectiles.prevY[id] = 0;
    projectiles.posX[id] = 10;
    projectiles.posY[id] = 0;

    const buckets = createProjectileInstanceBuckets(32);
    computeProjectileInstances(projectiles, buckets);

    expect(buckets.shadow.count).toBe(0);
    expect(buckets.ball.count).toBe(0);
    expect(buckets.musket.count).toBe(1);

    expect(buckets.musket.centerWorld[0]).toBeCloseTo(10);
    expect(buckets.musket.centerWorld[1]).toBeCloseTo(0);
    expect(buckets.musket.sizeOrLen[0]).toBeCloseTo(4 / 12);
    expect(buckets.musket.sizeOrLen[1]).toBeCloseTo(4 / 12);
    expect(buckets.musket.rotation[0]).toBeCloseTo(0);
    expect(buckets.musket.kind[0]).toBe(0);
    // Light-grey color.
    expect(buckets.musket.color[0]).toBeCloseTo(0.78);
    expect(buckets.musket.color[1]).toBeCloseTo(0.78);
    expect(buckets.musket.color[2]).toBeCloseTo(0.78);
    expect(buckets.musket.color[3]).toBeCloseTo(1.0);
  });

  it('a moving musket ball emits a translucent white streak oriented along velocity', () => {
    const projectiles = createProjectiles(8);
    // Direction +x, muzzle 380 → velX=380, velY=0.
    const id = spawnMusketBall(projectiles, 0, 0, 1, 0, 0, 5, 380, 0.025, 1.0);
    projectiles.posX[id] = 10;
    projectiles.posY[id] = 0;

    const buckets = createProjectileInstanceBuckets(32);
    computeProjectileInstances(projectiles, buckets);

    expect(buckets.streak.count).toBe(1);
    // Streak is 1 px wide, 8 px long, oriented along +x → rotation 0.
    expect(buckets.streak.sizeOrLen[0]).toBeCloseTo(8 / 12);
    expect(buckets.streak.sizeOrLen[1]).toBeCloseTo(1 / 12);
    expect(buckets.streak.rotation[0]).toBeCloseTo(0);
    expect(buckets.streak.kind[0]).toBe(3);
    // Trails behind the ball: center shifted back by half-length along -x.
    expect(buckets.streak.centerWorld[0]).toBeCloseTo(10 - (8 / 12) * 0.5);
    expect(buckets.streak.centerWorld[1]).toBeCloseTo(0);
    // White, transparent.
    expect(buckets.streak.color[0]).toBeCloseTo(1.0);
    expect(buckets.streak.color[1]).toBeCloseTo(1.0);
    expect(buckets.streak.color[2]).toBeCloseTo(1.0);
    expect(buckets.streak.color[3]).toBeCloseTo(0.4);
  });

  it('a stationary musket ball still renders as a square at its position', () => {
    const projectiles = createProjectiles(8);
    const id = spawnMusketBall(projectiles, 3, 4, 1, 0, 0, 5, 380, 0.025, 1.0);
    projectiles.prevX[id] = 3;
    projectiles.prevY[id] = 4;
    projectiles.posX[id] = 3;
    projectiles.posY[id] = 4;

    const buckets = createProjectileInstanceBuckets(32);
    computeProjectileInstances(projectiles, buckets);

    expect(buckets.musket.count).toBe(1);
    expect(buckets.musket.centerWorld[0]).toBeCloseTo(3);
    expect(buckets.musket.centerWorld[1]).toBeCloseTo(4);
    expect(buckets.musket.sizeOrLen[0]).toBeCloseTo(4 / 12);
    expect(buckets.musket.sizeOrLen[1]).toBeCloseTo(4 / 12);
  });

  it('three projectiles of different kinds populate all three buckets', () => {
    const projectiles = createProjectiles(8);
    spawnMusketBall(projectiles, 0, 0, 1, 0, 0, 5, 380, 0.025, 1.0);
    spawnSolidShot(projectiles, 1, 1, 0.5, 0, 0, 0, 0, 100, 4.5, 5.0, 0);
    spawnShell(projectiles, 2, 2, 1.0, 0, 0, 0, 0, 50, 5, 1.0, 1.5);

    const buckets = createProjectileInstanceBuckets(32);
    computeProjectileInstances(projectiles, buckets);

    // Each cannonball-style projectile contributes one shadow + one ball.
    expect(buckets.shadow.count).toBe(2);
    expect(buckets.ball.count).toBe(2);
    expect(buckets.musket.count).toBe(1);
  });

  it('counts reset on subsequent calls (mutable bucket reuse)', () => {
    const projectiles = createProjectiles(8);
    spawnMusketBall(projectiles, 0, 0, 1, 0, 0, 5, 380, 0.025, 1.0);
    const buckets = createProjectileInstanceBuckets(32);

    computeProjectileInstances(projectiles, buckets);
    expect(buckets.musket.count).toBe(1);

    // Re-running with the same alive set must not double-count.
    computeProjectileInstances(projectiles, buckets);
    expect(buckets.musket.count).toBe(1);
  });
});
