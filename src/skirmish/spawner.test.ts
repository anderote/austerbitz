import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { createSpawnerState, tickSpawner } from './spawner';
import { SPAWN_INTERVAL_S, BLOCK_FILES, BLOCK_RANKS } from './scene';

const BLOCK_SIZE = BLOCK_FILES * BLOCK_RANKS;

function makeWorld() {
  return createWorld({ seed: 1, capacity: 1024, mapSize: 600 });
}

describe('skirmish spawner', () => {
  it('spawns one block on the first tick (initial accum = interval)', () => {
    const world = makeWorld();
    const state = createSpawnerState();
    const n = tickSpawner(state, world, 0.016);
    expect(n).toBe(1);
    expect(world.entities.count).toBe(BLOCK_SIZE);
    expect(world.marchGroups.size).toBe(1);
  });

  it('does not spawn again until SPAWN_INTERVAL_S has elapsed since the last spawn', () => {
    const world = makeWorld();
    const state = createSpawnerState();
    tickSpawner(state, world, 0.016); // first block
    expect(world.entities.count).toBe(BLOCK_SIZE);

    // Tick almost a full interval — still only the first block.
    const n2 = tickSpawner(state, world, SPAWN_INTERVAL_S - 0.5);
    expect(n2).toBe(0);
    expect(world.entities.count).toBe(BLOCK_SIZE);

    // Cross the threshold — second block spawns.
    const n3 = tickSpawner(state, world, 1.0);
    expect(n3).toBe(1);
    expect(world.entities.count).toBe(BLOCK_SIZE * 2);
    expect(world.marchGroups.size).toBe(2);
  });

  it('spawns multiple blocks when dt covers more than one interval', () => {
    const world = makeWorld();
    const state = createSpawnerState();
    // Initial accum = interval; supplying two more intervals → 3 spawns total.
    const n = tickSpawner(state, world, SPAWN_INTERVAL_S * 2);
    expect(n).toBe(3);
    expect(world.entities.count).toBe(BLOCK_SIZE * 3);
  });
});
