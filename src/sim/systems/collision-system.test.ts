import { describe, it, expect } from 'vitest';
import { createWorld, rebuildGrid } from '../world';
import { allocEntity } from '../entities';
import { collisionSystem } from './collision-system';
import { getUnitKind, getUnitKindIndex } from '../../data/units';

function spawnAt(world: ReturnType<typeof createWorld>, kindId: string, x: number, y: number): number {
  const id = allocEntity(world.entities);
  const kind = getUnitKind(kindId);
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  world.entities.bodyRadius[id] = kind.baseStats.bodyRadius;
  world.entities.massKg[id] = kind.baseStats.massKg;
  return id;
}

/** Run one collision tick the way `tickWorld` would: rebuild the grid first. */
function step(world: ReturnType<typeof createWorld>, dt: number): void {
  rebuildGrid(world);
  collisionSystem(world, dt);
}

describe('collisionSystem', () => {
  it('separates two overlapping equal-mass bodies symmetrically', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnAt(world, 'line-infantry', 100, 100);
    const b = spawnAt(world, 'line-infantry', 100.1, 100); // heavily overlapping
    for (let i = 0; i < 30; i++) step(world, 1 / 30);
    const dx = world.entities.posX[b]! - world.entities.posX[a]!;
    const r = getUnitKind('line-infantry').baseStats.bodyRadius;
    expect(dx).toBeGreaterThanOrEqual(2 * r - 1e-3);
    // symmetry: midpoint should still be ≈ 100.05
    const mid = (world.entities.posX[a]! + world.entities.posX[b]!) / 2;
    expect(mid).toBeCloseTo(100.05, 4);
    // y untouched (initially equal)
    expect(world.entities.posY[a]).toBeCloseTo(100, 4);
    expect(world.entities.posY[b]).toBeCloseTo(100, 4);
  });

  it('heavier body is pushed less than lighter when they overlap', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    // cuirassier (600kg) vs line-infantry (80kg) overlapping
    const heavy = spawnAt(world, 'cuirassier', 100, 100);
    const light = spawnAt(world, 'line-infantry', 100.2, 100);
    const heavyStart = world.entities.posX[heavy]!;
    const lightStart = world.entities.posX[light]!;
    for (let i = 0; i < 30; i++) step(world, 1 / 30);
    const heavyMoved = Math.abs(world.entities.posX[heavy]! - heavyStart);
    const lightMoved = Math.abs(world.entities.posX[light]! - lightStart);
    expect(lightMoved).toBeGreaterThan(heavyMoved * 5);
  });

  it('does not move bodies that are already separated', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const r = getUnitKind('line-infantry').baseStats.bodyRadius;
    const a = spawnAt(world, 'line-infantry', 100, 100);
    const b = spawnAt(world, 'line-infantry', 100 + 2 * r + 0.5, 100);
    const ax = world.entities.posX[a]!;
    const bx = world.entities.posX[b]!;
    step(world, 1 / 30);
    expect(world.entities.posX[a]).toBe(ax);
    expect(world.entities.posX[b]).toBe(bx);
  });

  it('resolves perfectly coincident bodies (no NaN, ends up separated)', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnAt(world, 'line-infantry', 100, 100);
    const b = spawnAt(world, 'line-infantry', 100, 100);
    for (let i = 0; i < 60; i++) step(world, 1 / 30);
    const dx = world.entities.posX[b]! - world.entities.posX[a]!;
    const dy = world.entities.posY[b]! - world.entities.posY[a]!;
    const dist = Math.hypot(dx, dy);
    const r = getUnitKind('line-infantry').baseStats.bodyRadius;
    expect(Number.isFinite(dist)).toBe(true);
    expect(dist).toBeGreaterThanOrEqual(2 * r - 1e-3);
  });

  it('arms pushedT on both bodies when a meaningful push lands', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnAt(world, 'line-infantry', 100, 100);
    const b = spawnAt(world, 'line-infantry', 100.1, 100); // overlapping
    expect(world.entities.pushedT[a]).toBe(0);
    expect(world.entities.pushedT[b]).toBe(0);
    step(world, 1 / 30);
    expect(world.entities.pushedT[a]).toBeGreaterThan(0);
    expect(world.entities.pushedT[b]).toBeGreaterThan(0);
  });

  it('skips dead/ragdoll bodies', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnAt(world, 'line-infantry', 100, 100);
    const b = spawnAt(world, 'line-infantry', 100.1, 100);
    world.entities.state[a] = 5; // dead
    const ax = world.entities.posX[a]!;
    const bx = world.entities.posX[b]!;
    step(world, 1 / 30);
    expect(world.entities.posX[a]).toBe(ax);
    expect(world.entities.posX[b]).toBe(bx);
  });
});
