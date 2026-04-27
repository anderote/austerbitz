import type { Color3 } from '../data/weapons/types';

export interface PuffProfile {
  id: string;
  sizeStart: { min: number; max: number };
  life: { min: number; max: number };
  velScale: number;
  velJitter: number;
  edgeGrowth: number;
  sizeMax: number;
  drag: number;
  buoyancy: number;
  inertiaExp: number;
  inertiaWeight: number;
  color: Color3;
  colorJitter: number;
  alpha: number;
  softness: number;
  /** Decay-rate multiplier when a puff is at full sizeMax (0..1, default 1).
   *  At sizeFrac=0 puffs always decay at the full dt-rate; at sizeFrac=1
   *  they decay at this multiplier × dt. Linear interpolation between.
   *  <1 makes large/merged puffs persist much longer than fresh ones. */
  decayMulAtMaxSize?: number;
  coalesce: null | {
    radius: number;
    sizePerMerge: number;
    lifePerMerge: number;
    posBlend: number;
    mergeChance: number;
    /** If > 0, drifting same-profile puffs merge over time at this rate
     *  (probability per puff per second). Independent of spawn-time merge. */
    driftMergePerSec?: number;
    /** On drift merge, the keeper's velocity is set to the average of the
     *  two velocities, multiplied by this factor. <1 settles the cloud as
     *  it grows. Default 1.0 (no extra damping). */
    velDampOnMerge?: number;
    /** On drift merge, the keeper's buoyancy is multiplied by this factor.
     *  <1 makes accumulating clouds rise progressively slower. Default 1.0. */
    buoyancyMulOnMerge?: number;
    /** On drift merge, the keeper's lifeMax is extended by this amount in
     *  seconds (uncapped). Each merge raises the ceiling so accumulating
     *  clouds last longer than freshly spawned puffs of the same profile. */
    lifeMaxPerMerge?: number;
  };
}

const registry: PuffProfile[] = [];
const idToIndex = new Map<string, number>();

export function registerProfile(p: PuffProfile): number {
  const existing = idToIndex.get(p.id);
  if (existing !== undefined) return existing;
  const idx = registry.length;
  idToIndex.set(p.id, idx);
  registry.push(p);
  return idx;
}

export function getProfileByIndex(idx: number): PuffProfile {
  const p = registry[idx];
  if (p === undefined) throw new Error(`unknown puff profile index ${idx}`);
  return p;
}

export function profileCount(): number {
  return registry.length;
}
