import { freeEntity, EntityState } from '../sim/entities';
import type { World } from '../sim/world';
import { DESPAWN_X } from './scene';

export interface SkirmishCounters {
  kills: number;
  escaped: number;
  /** Set of entity ids already counted as killed (cleared on reset). */
  seenDead: Set<number>;
}

export function createCounters(): SkirmishCounters {
  return { kills: 0, escaped: 0, seenDead: new Set() };
}

/** Frees alive, non-dying/dead/ragdoll team-1 units that crossed `DESPAWN_X`.
 *  Increments `counters.escaped` per freed unit. */
export function tickDespawn(world: World, counters: SkirmishCounters): number {
  const e = world.entities;
  let escaped = 0;
  // Walk a snapshot — freeEntity mutates aliveIds via swap-pop.
  const ids: number[] = [];
  for (let i = 0; i < e.count; i++) ids.push(e.aliveIds[i]!);
  for (const id of ids) {
    if (e.alive[id] !== 1) continue;
    if (e.team[id] !== 1) continue;
    const s = e.state[id]!;
    if (s === EntityState.Dead || s === EntityState.Dying || s === EntityState.Ragdoll) continue;
    if (e.posX[id]! >= DESPAWN_X) continue;
    // Detach from any march group.
    const q = world.orderQueue.get(id);
    const head = q && q[0];
    if (head && head.kind === 'march-formation') {
      const g = world.marchGroups.get(head.groupId);
      if (g) {
        g.members.delete(id);
        if (g.members.size === 0) world.marchGroups.delete(head.groupId);
      }
    }
    world.orderQueue.delete(id);
    counters.seenDead.delete(id);
    freeEntity(e, id);
    escaped++;
  }
  counters.escaped += escaped;
  return escaped;
}

/** Walks team-1 alive entities; counts any that have entered Dead/Dying since
 *  the last call. Once counted, an id is added to `seenDead` to prevent double
 *  counting. Returns the number of new kills this tick. */
export function tickKillCounter(world: World, counters: SkirmishCounters): number {
  const e = world.entities;
  let added = 0;
  for (let i = 0; i < e.count; i++) {
    const id = e.aliveIds[i]!;
    if (e.team[id] !== 1) continue;
    const s = e.state[id]!;
    if (s !== EntityState.Dead && s !== EntityState.Dying) continue;
    if (counters.seenDead.has(id)) continue;
    counters.seenDead.add(id);
    added++;
  }
  counters.kills += added;
  return added;
}

/** Counts team-1 entities still considered "in play" (alive, not dead/dying/ragdoll). */
export function countLiveEnemies(world: World): number {
  const e = world.entities;
  let n = 0;
  for (let i = 0; i < e.count; i++) {
    const id = e.aliveIds[i]!;
    if (e.team[id] !== 1) continue;
    const s = e.state[id]!;
    if (s === EntityState.Dead || s === EntityState.Dying || s === EntityState.Ragdoll) continue;
    n++;
  }
  return n;
}
