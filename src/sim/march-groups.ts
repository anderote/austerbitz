import type { Vec2 } from '../util/math';

export type MarchPhase = 'march' | 'volley';

export interface MarchGroup {
  id: number;
  members: Set<number>;
  phase: MarchPhase;
  /** world.simTime at which `phase` was last entered. */
  phaseStartT: number;
  /** Unit-vector facing direction, locked at issue time. */
  forward: Vec2;
}

export function createMarchGroup(
  id: number,
  members: Iterable<number>,
  forward: Vec2,
  simTime: number,
): MarchGroup {
  return {
    id,
    members: new Set(members),
    phase: 'march',
    phaseStartT: simTime,
    forward: { x: forward.x, y: forward.y },
  };
}

/** Removes `id` from the group's members. Returns true iff `members` is now empty. */
export function removeMarchGroupMember(g: MarchGroup, id: number): boolean {
  g.members.delete(id);
  return g.members.size === 0;
}
