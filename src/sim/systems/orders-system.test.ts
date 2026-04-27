import { describe, it, expect } from 'vitest';
import { createWorld } from '../world';
import { allocEntity, EntityState } from '../entities';
import { ordersSystem } from './orders-system';
import { getUnitKindIndex } from '../../data/units';

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
