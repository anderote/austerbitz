import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createSelection } from './selection';
import { issueMove, issueAttack, issueAttackMove, issueStop } from './commands';

function spawn(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex('line-infantry');
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
