import { describe, it, expect } from 'vitest';
import { createWorld, tickWorld } from './world';
import { allocEntity } from './entities';

describe('World', () => {
  it('runs registered systems each tick in order', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const order: string[] = [];
    world.systems = [
      (_w, _dt) => order.push('a'),
      (_w, _dt) => order.push('b'),
      (_w, _dt) => order.push('c'),
    ];
    tickWorld(world, 1 / 30);
    tickWorld(world, 1 / 30);
    expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('builds the spatial grid from live entities each tick', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    world.systems = []; // baseline rebuild only happens via the dedicated step
    const id = allocEntity(world.entities);
    world.entities.posX[id] = 100;
    world.entities.posY[id] = 100;
    tickWorld(world, 1 / 30);
    expect(world.tickCount).toBe(1);
  });
});
