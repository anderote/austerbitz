import { describe, it, expect } from 'vitest';
import { createWorld, type Order } from '../world';
import { allocEntity, EntityState } from '../entities';
import { ordersSystem } from './orders-system';
import { ordersSystem as _ordersSystem } from './orders-system';
import { getUnitKindIndex } from '../../data/units';
import { createMarchGroup } from '../march-groups';

describe('ordersSystem dead/dying gating', () => {
  it('skips a Dying unit with a queued move order — no velocity, queue intact', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Dying;
    world.orderQueue.set(id, [{ kind: 'move', targetX: 50, targetY: 0 }]);

    ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
    expect(world.orderQueue.get(id)?.length).toBe(1);
  });

  it('skips a Dead unit with a queued move order — no velocity, queue intact', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Dead;
    world.orderQueue.set(id, [{ kind: 'move', targetX: 50, targetY: 0 }]);

    ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
    expect(world.orderQueue.get(id)?.length).toBe(1);
  });
});

describe('ordersSystem march-formation handler', () => {
  it('march phase writes velocity at march speed toward the slot', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry'); // moveSpeed 2.5
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [id], { x: 1, y: 0 }, 0));
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);

    _ordersSystem(world, 1 / 60);

    // March speed = 2.5 * 0.6 = 1.5 m/s along +x.
    expect(world.entities.velX[id]).toBeCloseTo(1.5, 5);
    expect(world.entities.velY[id]).toBeCloseTo(0, 5);
  });

  it('volley phase zeroes velocity and writes facing intent toward group.forward', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    const gid = 1;
    const g = createMarchGroup(gid, [id], { x: 0, y: 1 }, 0);
    g.phase = 'volley';
    world.marchGroups.set(gid, g);
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);

    _ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
    expect(world.entities.facingIntentX[id]).toBeCloseTo(0, 5);
    expect(world.entities.facingIntentY[id]).toBeCloseTo(1, 5);
  });

  it('arrival at slot parks the unit, updates rest, and sets arrived=true (queue length 1)', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 99.95; // within ARRIVE_RADIUS=0.1 of (100, 0)
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    world.entities.facing[id] = 2;
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [id], { x: 1, y: 0 }, 0));
    const order: Extract<Order, { kind: 'march-formation' }> = { kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid };
    world.orderQueue.set(id, [order]);

    _ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
    expect(world.entities.restPosX[id]).toBe(100);
    expect(world.entities.restPosY[id]).toBe(0);
    expect(world.entities.restFacing[id]).toBe(2);
    expect(order.arrived).toBe(true);
    // Order stays parked; group untouched at this layer.
    expect(world.orderQueue.get(id)?.length).toBe(1);
    expect(world.marchGroups.has(gid)).toBe(true);
  });

  it('missing group: order is shifted off and unit idles', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    // No entry in world.marchGroups for groupId 99.
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: 99 }]);

    _ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
    expect(world.orderQueue.has(id)).toBe(false);
  });
});
