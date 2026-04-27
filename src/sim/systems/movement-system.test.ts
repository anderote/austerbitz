import { describe, it, expect } from 'vitest';
import { createWorld } from '../world';
import { allocEntity } from '../entities';
import { ordersSystem } from './orders-system';
import { movementSystem } from './movement-system';
import { getUnitKindIndex } from '../../data/units';

describe('movement + orders', () => {
  it('moves an entity toward its order target at unit kind speed', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orderQueue.set(id, [{ kind: 'move', targetX: 100, targetY: 0 }]);
    world.systems = [ordersSystem, movementSystem];

    // Run for 1 simulated second at 30hz
    for (let i = 0; i < 30; i++) {
      world.systems.forEach(s => s(world, 1 / 30));
    }
    // line-infantry moveSpeed = 2.5 m/s
    expect(world.entities.posX[id]).toBeCloseTo(2.5, 1);
    expect(world.entities.posY[id]).toBeCloseTo(0, 4);
  });

  it('parks at the final move target on arrival and re-engages if displaced', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orderQueue.set(id, [{ kind: 'move', targetX: 0.05, targetY: 0 }]);
    world.systems = [ordersSystem, movementSystem];

    // Arrival tick: velocity zeros, but the order stays parked so a later
    // collision push can't strand the unit off-slot.
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.orderQueue.get(id)?.length).toBe(1);
    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);

    // Simulate a collision push displacing the unit, then tick again — it
    // should re-engage toward the parked target instead of sitting idle.
    world.entities.posX[id] = 1.5;
    world.entities.posY[id] = 0.8;
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.entities.velX[id]).toBeLessThan(0);
    expect(world.entities.velY[id]).toBeLessThan(0);
  });

  it('dequeues a completed move and starts the next queued order', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orderQueue.set(id, [
      { kind: 'move', targetX: 0.05, targetY: 0 },
      { kind: 'move', targetX: 100, targetY: 0 },
    ]);
    world.systems = [ordersSystem, movementSystem];

    // First tick should snap to and dequeue the first order.
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.orderQueue.get(id)?.length).toBe(1);
    expect(world.orderQueue.get(id)?.[0]?.kind).toBe('move');

    // Second tick should now be moving toward target #2.
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.entities.velX[id]).toBeGreaterThan(0);
  });

  it('drops an attack order whose target is dead', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.orderQueue.set(id, [{ kind: 'attack', targetId: 999 }]);
    world.systems = [ordersSystem];
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.orderQueue.has(id)).toBe(false);
  });
});
