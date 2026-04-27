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
    world.orders.set(id, { kind: 'move', targetX: 100, targetY: 0 });
    world.systems = [ordersSystem, movementSystem];

    // Run for 1 simulated second at 30hz
    for (let i = 0; i < 30; i++) {
      world.systems.forEach(s => s(world, 1 / 30));
    }
    // line-infantry moveSpeed = 2.5 m/s
    expect(world.entities.posX[id]).toBeCloseTo(2.5, 1);
    expect(world.entities.posY[id]).toBeCloseTo(0, 4);
  });

  it('clears order and stops when arrived (within snap distance)', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orders.set(id, { kind: 'move', targetX: 0.05, targetY: 0 });
    world.systems = [ordersSystem, movementSystem];

    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.orders.has(id)).toBe(false);
    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
  });
});
