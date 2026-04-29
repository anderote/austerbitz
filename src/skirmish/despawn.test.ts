import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity, EntityState } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createCounters, tickDespawn, tickKillCounter, countLiveEnemies } from './despawn';
import { DESPAWN_X } from './scene';

function spawnUnit(
  world: ReturnType<typeof createWorld>,
  team: number,
  x: number,
  y: number,
  state: number = EntityState.Idle,
): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex('line-infantry');
  world.entities.team[id] = team;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  world.entities.state[id] = state;
  return id;
}

describe('tickDespawn', () => {
  it('frees a team-1 unit past DESPAWN_X and increments escaped', () => {
    const world = createWorld({ seed: 1, capacity: 64, mapSize: 600 });
    const id = spawnUnit(world, 1, DESPAWN_X - 1, 100);
    const counters = createCounters();
    const n = tickDespawn(world, counters);
    expect(n).toBe(1);
    expect(counters.escaped).toBe(1);
    expect(world.entities.alive[id]).toBe(0);
  });

  it('does not free a team-0 unit past DESPAWN_X', () => {
    const world = createWorld({ seed: 1, capacity: 64, mapSize: 600 });
    const id = spawnUnit(world, 0, DESPAWN_X - 1, 100);
    const counters = createCounters();
    tickDespawn(world, counters);
    expect(counters.escaped).toBe(0);
    expect(world.entities.alive[id]).toBe(1);
  });

  it('does not free a team-1 unit still east of DESPAWN_X', () => {
    const world = createWorld({ seed: 1, capacity: 64, mapSize: 600 });
    const id = spawnUnit(world, 1, DESPAWN_X + 5, 100);
    const counters = createCounters();
    tickDespawn(world, counters);
    expect(counters.escaped).toBe(0);
    expect(world.entities.alive[id]).toBe(1);
  });

  it('does not free a ragdolling team-1 unit even past DESPAWN_X', () => {
    const world = createWorld({ seed: 1, capacity: 64, mapSize: 600 });
    const id = spawnUnit(world, 1, DESPAWN_X - 1, 100, EntityState.Ragdoll);
    const counters = createCounters();
    tickDespawn(world, counters);
    expect(counters.escaped).toBe(0);
    expect(world.entities.alive[id]).toBe(1);
  });

  it('removes the unit from its march group on despawn', () => {
    const world = createWorld({ seed: 1, capacity: 64, mapSize: 600 });
    const id = spawnUnit(world, 1, DESPAWN_X - 1, 100);
    const gid = 42;
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: -20, targetY: 100, groupId: gid }]);
    // Stub a march group containing just this unit.
    world.marchGroups.set(gid, {
      id: gid,
      members: new Set([id]),
      phase: 'march',
      phaseStartT: 0,
      forward: { x: -1, y: 0 },
      paceMaxDist: 0,
    });
    const counters = createCounters();
    tickDespawn(world, counters);
    expect(world.marchGroups.has(gid)).toBe(false);
    expect(world.orderQueue.has(id)).toBe(false);
  });
});

describe('tickKillCounter', () => {
  it('counts a team-1 unit transitioning into Dying exactly once', () => {
    const world = createWorld({ seed: 1, capacity: 64, mapSize: 600 });
    const id = spawnUnit(world, 1, 200, 100, EntityState.Dying);
    const counters = createCounters();
    const n1 = tickKillCounter(world, counters);
    expect(n1).toBe(1);
    expect(counters.kills).toBe(1);
    // Re-tick: same dying unit, should not double-count.
    const n2 = tickKillCounter(world, counters);
    expect(n2).toBe(0);
    expect(counters.kills).toBe(1);
    void id;
  });

  it('does not count team-0 dead units', () => {
    const world = createWorld({ seed: 1, capacity: 64, mapSize: 600 });
    spawnUnit(world, 0, 300, 220, EntityState.Dead);
    const counters = createCounters();
    tickKillCounter(world, counters);
    expect(counters.kills).toBe(0);
  });
});

describe('countLiveEnemies', () => {
  it('counts only alive, non-dead/dying/ragdoll team-1 entities', () => {
    const world = createWorld({ seed: 1, capacity: 64, mapSize: 600 });
    spawnUnit(world, 1, 300, 100, EntityState.Idle);
    spawnUnit(world, 1, 310, 100, EntityState.Reloading);
    spawnUnit(world, 1, 320, 100, EntityState.Dying);   // excluded
    spawnUnit(world, 1, 330, 100, EntityState.Ragdoll); // excluded
    spawnUnit(world, 0, 300, 220, EntityState.Idle);    // wrong team
    expect(countLiveEnemies(world)).toBe(2);
  });
});
