import { describe, it, expect } from 'vitest';
import { createSelection, hitTestPoint, hitTestRect, findSameKindInView } from './selection';
import { createWorld } from '../sim/world';
import { allocEntity, EntityState } from '../sim/entities';
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

  it('hitTestPoint returns the closest-center entity when AABBs overlap', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnAt(world, 'line-infantry', 100, 100);
    const b = spawnAt(world, 'line-infantry', 100.4, 100);
    // Both AABBs contain (100.3, 100); b's center is closer.
    expect(hitTestPoint(world, { x: 100.3, y: 100 })).toBe(b);
    // Reverse: closer to a.
    expect(hitTestPoint(world, { x: 100.05, y: 100 })).toBe(a);
  });

  it('hitTestPoint with team filter ignores off-team entities', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnAt(world, 'line-infantry', 100, 100);
    world.entities.team[a] = 1;
    expect(hitTestPoint(world, { x: 100, y: 100 }, { team: 0 })).toBe(-1);
    expect(hitTestPoint(world, { x: 100, y: 100 }, { team: 1 })).toBe(a);
  });

  it('hitTestRect with team filter excludes off-team entities', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const own = spawnAt(world, 'line-infantry', 50, 50);
    const enemy = spawnAt(world, 'line-infantry', 60, 60);
    world.entities.team[enemy] = 1;
    expect(hitTestRect(world, 0, 0, 100, 100, { team: 0 })).toEqual([own]);
  });

  it('findSameKindInView returns matching kind/team within the view rect', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const k = getUnitKindIndex('line-infantry');
    const a = spawnAt(world, 'line-infantry', 10, 10);
    const b = spawnAt(world, 'line-infantry', 20, 20);
    const farAway = spawnAt(world, 'line-infantry', 500, 500);
    const wrongKind = spawnAt(world, 'cuirassier', 15, 15);
    void farAway; void wrongKind;
    const ids = findSameKindInView(world, k, { x0: 0, y0: 0, x1: 50, y1: 50 });
    expect(ids.sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
  });

  it('hitTestPoint excludes dying/dead entities', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawnAt(world, 'line-infantry', 100, 100);
    world.entities.state[id] = EntityState.Dying;
    expect(hitTestPoint(world, { x: 100, y: 100 })).toBe(-1);
    world.entities.state[id] = EntityState.Dead;
    expect(hitTestPoint(world, { x: 100, y: 100 })).toBe(-1);
  });

  it('hitTestRect excludes dying entities inside the rect', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnAt(world, 'line-infantry', 50, 50);
    const b = spawnAt(world, 'line-infantry', 60, 60);
    world.entities.state[b] = EntityState.Dying;
    const ids = hitTestRect(world, 0, 0, 100, 100);
    expect(ids).toEqual([a]);
  });

  it('findSameKindInView excludes dead entities of the same kind', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const k = getUnitKindIndex('line-infantry');
    const a = spawnAt(world, 'line-infantry', 10, 10);
    const b = spawnAt(world, 'line-infantry', 20, 20);
    world.entities.state[b] = EntityState.Dead;
    const ids = findSameKindInView(world, k, { x0: 0, y0: 0, x1: 50, y1: 50 });
    expect(ids).toEqual([a]);
  });
});
