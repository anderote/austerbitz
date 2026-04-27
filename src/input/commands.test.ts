import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createSelection } from './selection';
import { issueMove, issueAttack, issueAttackMove, issueStop, issueFormationMove } from './commands';

function spawn(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex('line-infantry');
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

function spawnWithKind(world: ReturnType<typeof createWorld>, kind: string, team: number, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex(kind);
  world.entities.team[id] = team;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

describe('commands', () => {
  it('issueMove replaces the queue by default', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(id);
    world.orderQueue.set(id, [{ kind: 'move', targetX: 999, targetY: 999 }]);
    issueMove(world, sel, { x: 10, y: 0 });
    const q = world.orderQueue.get(id)!;
    expect(q.length).toBe(1);
    expect(q[0]).toMatchObject({ kind: 'move', targetX: 10, targetY: 0 });
  });

  it('issueMove with queue: true appends', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(id);
    issueMove(world, sel, { x: 10, y: 0 });
    issueMove(world, sel, { x: 20, y: 0 }, { queue: true });
    const q = world.orderQueue.get(id)!;
    expect(q.length).toBe(2);
    expect(q[1]).toMatchObject({ kind: 'move', targetX: 20, targetY: 0 });
  });

  it('issueAttack writes an attack order with the target id', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const enemy = spawn(world, 5, 5);
    const sel = createSelection(); sel.ids.add(id);
    issueAttack(world, sel, enemy);
    expect(world.orderQueue.get(id)).toEqual([{ kind: 'attack', targetId: enemy }]);
  });

  it('issueAttackMove writes an attack-move order at the target', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(id);
    issueAttackMove(world, sel, { x: 50, y: 50 });
    const q = world.orderQueue.get(id)!;
    expect(q[0]).toMatchObject({ kind: 'attack-move', targetX: 50, targetY: 50 });
  });

  it('issueStop clears each selected unit\'s queue', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(id);
    world.orderQueue.set(id, [{ kind: 'move', targetX: 1, targetY: 1 }]);
    issueStop(world, sel);
    expect(world.orderQueue.has(id)).toBe(false);
  });

  it('all commands skip dead entities in the selection', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const sel = createSelection(); sel.ids.add(42); // never alive
    issueMove(world, sel, { x: 1, y: 1 });
    issueAttack(world, sel, 0);
    issueAttackMove(world, sel, { x: 1, y: 1 });
    issueStop(world, sel);
    expect(world.orderQueue.size).toBe(0);
  });
});

describe('issueFormationMove', () => {
  it('issues one move order per assignment, replacing existing queue', () => {
    const world = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const sel = createSelection();
    const a = spawnWithKind(world, 'line-infantry', 0, 0, 0);
    const b = spawnWithKind(world, 'line-infantry', 0, 1, 0);
    sel.ids.add(a); sel.ids.add(b);
    world.orderQueue.set(a, [{ kind: 'move', targetX: 99, targetY: 99 }]);

    issueFormationMove(world, [
      { id: a, target: { x: 10, y: 20 } },
      { id: b, target: { x: 11, y: 20 } },
    ]);

    const qa = world.orderQueue.get(a)!;
    const qb = world.orderQueue.get(b)!;
    expect(qa.length).toBe(1);
    expect(qa[0]).toEqual({ kind: 'move', targetX: 10, targetY: 20 });
    expect(qb[0]).toEqual({ kind: 'move', targetX: 11, targetY: 20 });
  });

  it('queue=true appends instead of replacing', () => {
    const world = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const sel = createSelection();
    const a = spawnWithKind(world, 'line-infantry', 0, 0, 0);
    sel.ids.add(a);
    world.orderQueue.set(a, [{ kind: 'move', targetX: 1, targetY: 1 }]);

    issueFormationMove(world, [{ id: a, target: { x: 5, y: 5 } }], { queue: true });

    const qa = world.orderQueue.get(a)!;
    expect(qa.length).toBe(2);
    expect(qa[1]).toEqual({ kind: 'move', targetX: 5, targetY: 5 });
  });

  it('skips dead units silently', () => {
    const world = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const a = spawnWithKind(world, 'line-infantry', 0, 0, 0);
    world.entities.alive[a] = 0;
    issueFormationMove(world, [{ id: a, target: { x: 5, y: 5 } }]);
    expect(world.orderQueue.get(a)).toBeUndefined();
  });
});
