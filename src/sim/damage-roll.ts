import type { Rng } from '../util/rng';

export interface DamageRoll {
  damage: number;
  crit: boolean;
}

/**
 * Roll a damage value with uniform ±`varianceFrac` variance around `base`,
 * plus an independent `critChance` roll that multiplies by `critMul` when
 * triggered.
 *
 * RNG consumption: one `rng.next()` per non-zero variance, plus one per
 * non-zero critChance. Zero on both = deterministic, no RNG consumed.
 *
 * Result is clamped to a minimum of 1 to avoid 0-damage hits, and rounded
 * so damage callouts read as whole numbers.
 */
export function rollDamage(
  base: number,
  varianceFrac: number,
  critChance: number,
  critMul: number,
  rng: Rng,
): DamageRoll {
  const variance = varianceFrac > 0 ? 1 + (rng.next() - 0.5) * 2 * varianceFrac : 1;
  const crit = critChance > 0 && rng.next() < critChance;
  const mul = crit ? variance * critMul : variance;
  return { damage: Math.max(1, Math.round(base * mul)), crit };
}
