import { describe, it, expect } from 'vitest';
import { createPuffs } from './puffs';
import { emitDustForFrame } from './emit-dust';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';

describe('emitDustForFrame', () => {
  it('emits at least one dust puff for moving soldiers over a full second', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 200 });
    for (let k = 0; k < 8; k++) {
      const id = allocEntity(world.entities);
      world.entities.posX[id] = 50 + (k % 2) * 0.1;
      world.entities.posY[id] = 50 + Math.floor(k / 2) * 0.1;
      world.entities.velX[id] = 1; world.entities.velY[id] = 0;
    }
    const puffs = createPuffs(64);
    emitDustForFrame(world, puffs, 1.0);
    expect(puffs.count).toBeGreaterThan(0);
  });

  it('does not emit for stationary soldiers', () => {
    const world = createWorld({ seed: 2, capacity: 4, mapSize: 200 });
    const id = allocEntity(world.entities);
    world.entities.posX[id] = 10; world.entities.posY[id] = 10;
    world.entities.velX[id] = 0; world.entities.velY[id] = 0;
    const puffs = createPuffs(8);
    emitDustForFrame(world, puffs, 1.0);
    expect(puffs.count).toBe(0);
  });

  it('produces a distribution of distinct puffs (not one mega-cloud)', () => {
    // Many overlapping marchers; mergeChance=0.7 means ~30% spawn fresh.
    const world = createWorld({ seed: 3, capacity: 200, mapSize: 200 });
    for (let k = 0; k < 100; k++) {
      const id = allocEntity(world.entities);
      world.entities.posX[id] = 50;
      world.entities.posY[id] = 50;
      world.entities.velX[id] = 1; world.entities.velY[id] = 0;
    }
    const puffs = createPuffs(256);
    emitDustForFrame(world, puffs, 1.0);
    // Expect more than a single puff (would be 1 if everything merged).
    expect(puffs.count).toBeGreaterThan(2);
  });
});
