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
  coalesce: null | {
    radius: number;
    sizePerMerge: number;
    lifePerMerge: number;
    posBlend: number;
    mergeChance: number;
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
