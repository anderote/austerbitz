import type { Puffs } from './puffs';
import type { PuffProfile } from './profile';
import type { Rng } from '../util/rng';

export type CoalesceGrid = Map<number, number[]>;

function key(profileIdx: number, cx: number, cy: number): number {
  // Hash with profileIdx mixed in so different profiles never collide.
  return ((profileIdx * 2654435761) ^ (cx * 73856093) ^ (cy * 19349663)) >>> 0;
}

export function buildCoalesceGrid(p: Puffs): CoalesceGrid {
  // Cell size is profile-specific. We bucket by a coarse cell of size 1m and
  // let the per-profile radius lookup handle the actual radius check.
  const grid: CoalesceGrid = new Map();
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    const cx = Math.floor(p.posX[i]!);
    const cy = Math.floor(p.posY[i]!);
    const k = key(p.profileIdx[i]!, cx, cy);
    let bucket = grid.get(k);
    if (bucket === undefined) { bucket = []; grid.set(k, bucket); }
    bucket.push(i);
  }
  return grid;
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
  if (bucket === undefined) { bucket = []; grid.set(k, bucket); }
  bucket.push(idx);
}
