import type { Entities } from './entities';

export const Rank = {
  Recruit:  0,
  Veteran:  1,
  Sergeant: 2,
  SgtMajor: 3,
  Captain:  4,
} as const;
export type Rank = (typeof Rank)[keyof typeof Rank];

export const MAX_RANK = Rank.Captain;

/** XP needed to advance from rank N to rank N+1, indexed by current rank. */
export const RANK_THRESHOLDS: readonly number[] = [1, 2, 4, 8];

export const RANK_NAMES: readonly string[] = [
  'Recruit',
  'Veteran',
  'Sergeant',
  'Sgt. Major',
  'Captain',
];

const DAMAGE_MUL    = [1.00, 1.05, 1.10, 1.15, 1.25];
const ACCURACY_ADD  = [0.00, 0.05, 0.10, 0.15, 0.20];
const RELOAD_MUL    = [1.00, 0.95, 0.90, 0.85, 0.75];
const ARMOR_ADD     = [0,    0,    1,    1,    2];
// Additive crit-chance bonus by rank (atop weapon's base critChance).
// Recruit none → Captain +6 percentage points.
const CRIT_CHANCE_ADD = [0.00, 0.01, 0.02, 0.04, 0.06];

const ACCURACY_CAP = 0.99;
const RELOAD_FLOOR = 0.05;
const CRIT_CHANCE_CAP = 0.5;

export function rankDamageMul(rank: number): number     { return DAMAGE_MUL[rank]!; }
export function rankAccuracyAdd(rank: number): number   { return ACCURACY_ADD[rank]!; }
export function rankReloadMul(rank: number): number     { return RELOAD_MUL[rank]!; }
export function rankArmorAdd(rank: number): number      { return ARMOR_ADD[rank]!; }
export function rankCritChanceAdd(rank: number): number { return CRIT_CHANCE_ADD[rank]!; }

export function effectiveDamage(e: Entities, id: number, base: number): number {
  return base * DAMAGE_MUL[e.rank[id]!]!;
}

export function effectiveAccuracy(e: Entities, id: number, base: number): number {
  const v = base + ACCURACY_ADD[e.rank[id]!]!;
  return v > ACCURACY_CAP ? ACCURACY_CAP : v;
}

export function effectiveReload(e: Entities, id: number, base: number): number {
  const v = base * RELOAD_MUL[e.rank[id]!]!;
  return v < RELOAD_FLOOR ? RELOAD_FLOOR : v;
}

export function effectiveArmor(e: Entities, id: number, base: number): number {
  return base + ARMOR_ADD[e.rank[id]!]!;
}

export function effectiveCritChance(e: Entities, id: number, base: number): number {
  const v = base + CRIT_CHANCE_ADD[e.rank[id]!]!;
  return v > CRIT_CHANCE_CAP ? CRIT_CHANCE_CAP : v;
}

/** Cumulative kills required to reach a given rank from Recruit. */
export function cumulativeKillsForRank(target: Rank): number {
  let sum = 0;
  for (let r = 0; r < target; r++) sum += RANK_THRESHOLDS[r]!;
  return sum;
}

/**
 * If the entity's xp has reached the threshold for its current rank, advance
 * the rank and reset xp. Saturates at MAX_RANK. Returns true iff promoted.
 */
export function promote(e: Entities, id: number): boolean {
  const r = e.rank[id]!;
  if (r >= MAX_RANK) return false;
  if (e.xp[id]! < RANK_THRESHOLDS[r]!) return false;
  e.rank[id] = r + 1;
  e.xp[id] = 0;
  return true;
}
