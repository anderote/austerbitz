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

  it('a musket ball with prevX=0,posX=10,prevY=0,posY=0 yields one streak: center=(5,0), len=10, rot=0', () => {
    const projectiles = createProjectiles(8);
    const id = spawnMusketBall(projectiles, 0, 0, 1, 0, 0, 5, 380, 0.025, 1.0);
    expect(id).toBeGreaterThanOrEqual(0);
    // Override pos so the integration step is simulated by us.
    projectiles.prevX[id] = 0;
    projectiles.prevY[id] = 0;
    projectiles.posX[id] = 10;
    projectiles.posY[id] = 0;

    const buckets = createProjectileInstanceBuckets(32);
    computeProjectileInstances(projectiles, buckets);

    expect(buckets.shadow.count).toBe(0);
    expect(buckets.ball.count).toBe(0);
    expect(buckets.musket.count).toBe(1);

    expect(buckets.musket.centerWorld[0]).toBeCloseTo(5);
    expect(buckets.musket.centerWorld[1]).toBeCloseTo(0);
    expect(buckets.musket.sizeOrLen[0]).toBeCloseTo(10);
    expect(buckets.musket.sizeOrLen[1]).toBeCloseTo(0.05);
    expect(buckets.musket.rotation[0]).toBeCloseTo(0);
    expect(buckets.musket.kind[0]).toBe(0);
    // Warm tracer color.
    expect(buckets.musket.color[0]).toBeCloseTo(1.0);
    expect(buckets.musket.color[1]).toBeCloseTo(0.95);
    expect(buckets.musket.color[2]).toBeCloseTo(0.7);
    expect(buckets.musket.color[3]).toBeCloseTo(1.0);
  });

  it('a stationary musket ball (prev == cur) clamps length to a small minimum', () => {
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
    expect(buckets.musket.sizeOrLen[0]).toBeCloseTo(0.05); // clamped min
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
