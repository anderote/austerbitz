import { freePuff, type Puffs } from './puffs';
import type { PuffProfile } from './profile';
import type { Rng } from '../util/rng';

export type CoalesceGrid = Map<number, number[]>;

function key(profileIdx: number, cx: number, cy: number): number {
  // Hash with profileIdx mixed in so different profiles never collide.
  return ((profileIdx * 2654435761) ^ (cx * 73856093) ^ (cy * 19349663)) >>> 0;
}

const SHARED_GRID: CoalesceGrid = new Map();
const BUCKET_POOL: number[][] = [];
let bucketsInUse = 0;

function acquireBucket(): number[] {
  if (bucketsInUse < BUCKET_POOL.length) {
    const b = BUCKET_POOL[bucketsInUse++]!;
    b.length = 0;
    return b;
  }
  const b: number[] = [];
  BUCKET_POOL.push(b);
  bucketsInUse++;
  return b;
}

function resetGrid(): void {
  SHARED_GRID.clear();
  bucketsInUse = 0;
}

export function buildCoalesceGrid(p: Puffs): CoalesceGrid {
  // Cell size is profile-specific. We bucket by a coarse cell of size 1m and
  // let the per-profile radius lookup handle the actual radius check.
  // Returns a shared grid + pooled buckets — callers must build, use, and
  // discard within a single function call (no retention across frames, no
  // interleaved builds).
  resetGrid();
  for (let n = 0; n < p.count; n++) {
    const i = p.aliveIds[n]!;
    const cx = Math.floor(p.posX[i]!);
    const cy = Math.floor(p.posY[i]!);
    const k = key(p.profileIdx[i]!, cx, cy);
    let bucket = SHARED_GRID.get(k);
    if (bucket === undefined) {
      bucket = acquireBucket();
      SHARED_GRID.set(k, bucket);
    }
    bucket.push(i);
  }
  return SHARED_GRID;
}

export interface MergeResult {
  merged: boolean;
  idx: number;
}

export function tryMergeOrSpawn(
  p: Puffs,
  grid: CoalesceGrid,
  profile: PuffProfile,
  profileIdx: number,
  x: number, y: number,
  rng: Rng,
): MergeResult {
  if (profile.coalesce === null) return { merged: false, idx: -1 };
  const c = profile.coalesce;

  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cells = Math.max(1, Math.ceil(c.radius));
  let bestIdx = -1;
  let bestSq = c.radius * c.radius;
  for (let dy = -cells; dy <= cells; dy++) {
    for (let dx = -cells; dx <= cells; dx++) {
      const bucket = grid.get(key(profileIdx, cx + dx, cy + dy));
      if (bucket === undefined) continue;
      for (let b = 0; b < bucket.length; b++) {
        const idx = bucket[b]!;
        // Skip saturated puffs.
        if (p.size[idx]! >= p.sizeMax[idx]! - 1e-6 &&
            p.life[idx]! >= p.lifeMax[idx]! - 1e-6) continue;
        const ddx = p.posX[idx]! - x;
        const ddy = p.posY[idx]! - y;
        const dsq = ddx * ddx + ddy * ddy;
        if (dsq < bestSq) { bestSq = dsq; bestIdx = idx; }
      }
    }
  }

  if (bestIdx === -1) return { merged: false, idx: -1 };
  if (rng.next() >= c.mergeChance) return { merged: false, idx: -1 };

  const sm = p.sizeMax[bestIdx]!;
  const newSize = p.size[bestIdx]! + c.sizePerMerge;
  p.size[bestIdx] = newSize > sm ? sm : newSize;

  const lm = p.lifeMax[bestIdx]!;
  const newLife = p.life[bestIdx]! + c.lifePerMerge;
  p.life[bestIdx] = newLife > lm ? lm : newLife;

  p.posX[bestIdx] = p.posX[bestIdx]! * (1 - c.posBlend) + x * c.posBlend;
  p.posY[bestIdx] = p.posY[bestIdx]! * (1 - c.posBlend) + y * c.posBlend;

  return { merged: true, idx: bestIdx };
}

export function gridInsert(grid: CoalesceGrid, p: Puffs, idx: number): void {
  const cx = Math.floor(p.posX[idx]!);
  const cy = Math.floor(p.posY[idx]!);
  const k = key(p.profileIdx[idx]!, cx, cy);
  let bucket = grid.get(k);
  if (bucket === undefined) {
    bucket = acquireBucket();
    grid.set(k, bucket);
  }
  bucket.push(idx);
}

/** Per-frame drift-merge: same-profile puffs that have drifted near each
 *  other gradually consume one another. The keeper grows + gains life; the
 *  partner is freed. Rate is `driftMergePerSec` from the profile coalesce
 *  config (probability per puff per second). */
export function coalesceStep(
  p: Puffs,
  dt: number,
  rng: Rng,
  profileLookup: (idx: number) => PuffProfile,
): void {
  if (dt <= 0) return;
  const grid = buildCoalesceGrid(p);
  for (let n = 0; n < p.count; n++) {
    const i = p.aliveIds[n]!;
    const profile = profileLookup(p.profileIdx[i]!);
    const c = profile.coalesce;
    if (c === null) continue;
    const rate = c.driftMergePerSec ?? 0;
    if (rate <= 0) continue;
    if (rng.next() >= rate * dt) continue;

    // Find the closest same-profile partner within radius (excluding self).
    const cx = Math.floor(p.posX[i]!);
    const cy = Math.floor(p.posY[i]!);
    const cells = Math.max(1, Math.ceil(c.radius));
    let bestIdx = -1;
    let bestSq = c.radius * c.radius;
    for (let dy = -cells; dy <= cells; dy++) {
      for (let dx = -cells; dx <= cells; dx++) {
        const bucket = grid.get(key(p.profileIdx[i]!, cx + dx, cy + dy));
        if (bucket === undefined) continue;
        for (let b = 0; b < bucket.length; b++) {
          const j = bucket[b]!;
          if (j === i) continue;
          if (p.alive[j] === 0) continue;
          const ddx = p.posX[j]! - p.posX[i]!;
          const ddy = p.posY[j]! - p.posY[i]!;
          const dsq = ddx * ddx + ddy * ddy;
          if (dsq < bestSq) { bestSq = dsq; bestIdx = j; }
        }
      }
    }
    if (bestIdx === -1) continue;

    // Keeper = whichever is older (more life remaining); the other is freed.
    const keeper = p.life[i]! >= p.life[bestIdx]! ? i : bestIdx;
    const eaten = keeper === i ? bestIdx : i;

    const sm = p.sizeMax[keeper]!;
    const atSizeCap = p.size[keeper]! >= sm - 1e-6;
    if (!atSizeCap) {
      const newSize = p.size[keeper]! + c.sizePerMerge;
      p.size[keeper] = newSize > sm ? sm : newSize;

      const lifeMaxBump = c.lifeMaxPerMerge ?? 0;
      if (lifeMaxBump > 0) p.lifeMax[keeper] = p.lifeMax[keeper]! + lifeMaxBump;

      const lm = p.lifeMax[keeper]!;
      const newLife = p.life[keeper]! + c.lifePerMerge;
      p.life[keeper] = newLife > lm ? lm : newLife;
    }

    p.posX[keeper] = p.posX[keeper]! * (1 - c.posBlend) + p.posX[eaten]! * c.posBlend;
    p.posY[keeper] = p.posY[keeper]! * (1 - c.posBlend) + p.posY[eaten]! * c.posBlend;

    const velDamp = c.velDampOnMerge ?? 1.0;
    p.velX[keeper] = (p.velX[keeper]! + p.velX[eaten]!) * 0.5 * velDamp;
    p.velY[keeper] = (p.velY[keeper]! + p.velY[eaten]!) * 0.5 * velDamp;

    const buoyMul = c.buoyancyMulOnMerge ?? 1.0;
    if (buoyMul !== 1.0) p.buoyancy[keeper] = p.buoyancy[keeper]! * buoyMul;

    freePuff(p, eaten);
    if (eaten === i) n--;
  }
}
