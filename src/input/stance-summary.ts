import type { Selection } from './selection';
import type { Entities } from '../sim/entities';
import { getUnitKindByIndex } from '../data/units';

export type StanceSummary =
  | { kind: 'uniform'; stance: number }
  | { kind: 'mixed' }
  | { kind: 'none' };

/**
 * Returns the active fire-stance across the alive infantry/cavalry units in
 * the selection. Cannons are skipped — their Z/X/C keys drive ammo, not
 * stance, so they should not contribute to the stance reading shown to the
 * player. Returns `none` when the selection contains no stance-bearing units.
 */
export function computeStanceSummary(sel: Selection, e: Entities): StanceSummary {
  if (sel.ids.size === 0) return { kind: 'none' };
  let first: number | undefined;
  for (const id of sel.ids) {
    if (e.alive[id] !== 1) continue;
    const cat = getUnitKindByIndex(e.kindId[id]!).category;
    if (cat === 'artillery') continue;
    if (first === undefined) { first = e.stance[id]!; continue; }
    if (e.stance[id]! !== first) return { kind: 'mixed' };
  }
  if (first === undefined) return { kind: 'none' };
  return { kind: 'uniform', stance: first };
}
