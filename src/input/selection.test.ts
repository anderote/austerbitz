import { describe, it, expect } from 'vitest';
import { createSelection, hitTestPoint, hitTestRect } from './selection';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';

function spawnAt(world: ReturnType<typeof createWorld>, kind: string, x: number, y: number) {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex(kind);
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

describe('selection', () => {
  it('createSelection starts empty', () => {
    const sel = createSelection();
    expect(sel.ids.size).toBe(0);
  });

  it('hitTestPoint returns entity within its placeholder size', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawnAt(world, 'line-infantry', 100, 100);
    expect(hitTestPoint(world, { x: 100, y: 100 })).toBe(id);
    // Outside the unit's footprint
    expect(hitTestPoint(world, { x: 200, y: 200 })).toBe(-1);
  });

  it('hitTestRect returns all entities whose center is in the rect', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnAt(world, 'line-infantry', 50, 50);
    const b = spawnAt(world, 'line-infantry', 60, 60);
    spawnAt(world, 'line-infantry', 200, 200);
    const ids = hitTestRect(world, 0, 0, 100, 100);
    expect(ids.sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
  });
});
