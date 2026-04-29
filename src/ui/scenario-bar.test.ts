import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity, EntityState } from '../sim/entities';
import { countAliveByTeam } from './scenario-bar';

function spawnAt(world: ReturnType<typeof createWorld>, team: number, state: number): number {
  const id = allocEntity(world.entities);
  if (id === -1) throw new Error('out of capacity');
  world.entities.team[id] = team;
  world.entities.state[id] = state;
  return id;
}

describe('countAliveByTeam', () => {
  it('returns zeroes for an empty world', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 100 });
    expect(countAliveByTeam(world)).toEqual({ blue: 0, red: 0 });
  });

  it('counts alive Idle/Moving/Aiming/Firing/Reloading/Flinch entities by team', () => {
    const world = createWorld({ seed: 1, capacity: 32, mapSize: 100 });
    spawnAt(world, 0, EntityState.Idle);
    spawnAt(world, 0, EntityState.Moving);
    spawnAt(world, 0, EntityState.Aiming);
    spawnAt(world, 0, EntityState.Firing);
    spawnAt(world, 0, EntityState.Reloading);
    spawnAt(world, 1, EntityState.Idle);
    spawnAt(world, 1, EntityState.Flinch);
    spawnAt(world, 1, EntityState.Moving);
    expect(countAliveByTeam(world)).toEqual({ blue: 5, red: 3 });
  });

  it('excludes Ragdoll/Dying/Dead entities', () => {
    const world = createWorld({ seed: 1, capacity: 32, mapSize: 100 });
    spawnAt(world, 0, EntityState.Idle); // counted
    spawnAt(world, 0, EntityState.Ragdoll); // excluded
    spawnAt(world, 0, EntityState.Dying); // excluded
    spawnAt(world, 0, EntityState.Dead); // excluded
    spawnAt(world, 1, EntityState.Idle); // counted
    spawnAt(world, 1, EntityState.Dying); // excluded
    expect(countAliveByTeam(world)).toEqual({ blue: 1, red: 1 });
  });

  it('ignores entities on teams other than 0 and 1', () => {
    const world = createWorld({ seed: 1, capacity: 32, mapSize: 100 });
    spawnAt(world, 0, EntityState.Idle);
    spawnAt(world, 1, EntityState.Idle);
    spawnAt(world, 2, EntityState.Idle);
    spawnAt(world, 3, EntityState.Idle);
    expect(countAliveByTeam(world)).toEqual({ blue: 1, red: 1 });
  });
});
