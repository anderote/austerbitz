import type { World } from '../sim/world';
import { spawnEnemyBlock, SPAWN_INTERVAL_S } from './scene';

export interface SpawnerState {
  /** Sim-seconds accumulated toward the next spawn. */
  accum: number;
}

/** Initial accum = SPAWN_INTERVAL_S so the first tick spawns one block immediately. */
export function createSpawnerState(): SpawnerState {
  return { accum: SPAWN_INTERVAL_S };
}

export function tickSpawner(state: SpawnerState, world: World, dt: number): number {
  state.accum += dt;
  let spawned = 0;
  while (state.accum >= SPAWN_INTERVAL_S) {
    state.accum -= SPAWN_INTERVAL_S;
    spawnEnemyBlock(world, 1);
    spawned++;
  }
  return spawned;
}
