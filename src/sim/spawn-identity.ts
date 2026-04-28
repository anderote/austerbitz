// Spawn-time identity assignment.
//
// Pulled out of `main.ts` so it's testable without booting the renderer.
// Given an entity slot, a team, and a seeded RNG, fills in the identity
// fields (theme, name indices, hometown index, age) on the SoA.

import type { Entities } from './entities';
import type { Rng } from '../util/rng';
import { themeIdOf, poolSizes } from '../data/name-bank';

/** Maps team number -> name-bank theme name. Single config point. */
export const FACTION_THEMES: Record<number, string> = {
  0: 'french',
  1: 'english',
};

/** Roll a Box-Muller Gaussian age, μ=24 σ=6, clamped to [16, 55]. */
function rollAge(rng: Rng): number {
  // Avoid log(0) — clamp u1 strictly above zero.
  const u1 = Math.max(rng.range(0, 1), 1e-9);
  const u2 = rng.range(0, 1);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const age = Math.round(24 + 6 * z);
  return Math.max(16, Math.min(55, age));
}

/**
 * Assign a freshly-rolled identity to entity `id`. Must be called after
 * `allocEntity()` and after `team` has been set on the entity (or just pass
 * it through here — this function does not read `e.team`, it takes `team`
 * as a parameter so it works regardless of write order).
 *
 * Defensive: unknown team falls back to the french theme; an empty pool
 * yields index 0 (the loader returns '?' for unknown indices).
 */
export function assignIdentity(e: Entities, id: number, team: number, rng: Rng): void {
  const themeName = FACTION_THEMES[team] ?? 'french';
  const tid = Math.max(0, themeIdOf(themeName));
  const sizes = poolSizes(tid);
  e.themeId[id] = tid;
  e.firstNameIdx[id] = sizes.first > 0 ? rng.intRange(0, sizes.first) : 0;
  e.lastNameIdx[id] = sizes.last > 0 ? rng.intRange(0, sizes.last) : 0;
  e.hometownIdx[id] = sizes.town > 0 ? rng.intRange(0, sizes.town) : 0;
  e.ageYears[id] = rollAge(rng);
}
