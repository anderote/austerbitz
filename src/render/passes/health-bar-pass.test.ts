import { describe, it, expect } from 'vitest';
import { createWorld } from '../../sim/world';
import { allocEntity } from '../../sim/entities';
import { getUnitKind, getUnitKindIndex } from '../../data/units';
import {
  computeHealthBarInstances,
  createHealthBarInstances,
} from './health-bar-pass';

function spawn(world: ReturnType<typeof createWorld>, kindId: string, x: number, y: number, hp: number): number {
  const id = allocEntity(world.entities);
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  world.entities.hp[id] = hp;
  return id;
}

describe('computeHealthBarInstances', () => {
  it('produces no bars for an empty world', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 100 });
    const out = createHealthBarInstances(16);
    computeHealthBarInstances(world, out);
    expect(out.count).toBe(0);
  });

  it('full-hp infantry produces one bar at full width', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 100 });
    const kind = getUnitKind('line-infantry');
    spawn(world, 'line-infantry', 10, 20, kind.baseStats.hp);
    const out = createHealthBarInstances(16);
    computeHealthBarInstances(world, out);
    expect(out.count).toBe(1);
    expect(out.size[0]).toBeCloseTo(kind.placeholderSize.w, 5);
    // Center x at full hp = posX (left + halfWidth = posX - W/2 + W/2).
    expect(out.pos[0]).toBeCloseTo(10, 5);
  });

  it('half-hp produces a half-width bar anchored at the left edge', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 100 });
    const kind = getUnitKind('line-infantry');
    spawn(world, 'line-infantry', 10, 20, Math.floor(kind.baseStats.hp / 2));
    const out = createHealthBarInstances(16);
    computeHealthBarInstances(world, out);
    expect(out.count).toBe(1);
    const w = kind.placeholderSize.w;
    const expectedFrac = Math.floor(kind.baseStats.hp / 2) / kind.baseStats.hp;
    expect(out.size[0]).toBeCloseTo(w * expectedFrac, 5);
    // Left edge is posX - w/2; center of half bar = leftEdge + (w*frac)/2.
    expect(out.pos[0]).toBeCloseTo(10 - w / 2 + (w * expectedFrac) / 2, 5);
  });

  it('skips dead entities (hp = 0)', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 100 });
    spawn(world, 'line-infantry', 10, 20, 0);
    const out = createHealthBarInstances(16);
    computeHealthBarInstances(world, out);
    expect(out.count).toBe(0);
  });

  it('skips freed entities', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 100 });
    const kind = getUnitKind('line-infantry');
    const id = spawn(world, 'line-infantry', 10, 20, kind.baseStats.hp);
    world.entities.alive[id] = 0;
    const out = createHealthBarInstances(16);
    computeHealthBarInstances(world, out);
    expect(out.count).toBe(0);
  });
});
