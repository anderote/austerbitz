import type { Puffs } from './puffs';
import { allocPuff } from './puffs';
import type { PuffProfile } from './profile';
import type { Rng } from '../util/rng';
import { tryMergeOrSpawn, gridInsert, type CoalesceGrid } from './coalesce';

function jitter(rng: Rng, amt: number): number {
  return amt > 0 ? rng.range(-amt, amt) : 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function writeProfile(
  p: Puffs, i: number, profile: PuffProfile, profileIdx: number,
  x: number, y: number, vx: number, vy: number, rng: Rng,
): void {
  p.profileIdx[i] = profileIdx;
  p.posX[i] = x; p.posY[i] = y;
  p.velX[i] = vx * profile.velScale + jitter(rng, profile.velJitter);
  p.velY[i] = vy * profile.velScale + jitter(rng, profile.velJitter);
  const life = rng.range(profile.life.min, profile.life.max);
  p.life[i] = life; p.lifeMax[i] = life;
  p.size[i] = rng.range(profile.sizeStart.min, profile.sizeStart.max);
  const sizeJ = profile.sizeMaxJitter ?? 0;
  p.sizeMax[i] = profile.sizeMax * (1 + jitter(rng, sizeJ));
  p.aspectMax[i] = (profile.aspectAtMax ?? 1) + jitter(rng, profile.aspectJitter ?? 0);
  p.edgeGrowth[i] = profile.edgeGrowth;
  p.drag[i] = profile.drag;
  p.buoyancy[i] = profile.buoyancy + jitter(rng, profile.buoyancyJitter ?? 0);
  p.inertiaExp[i] = profile.inertiaExp;
  p.inertiaWeight[i] = profile.inertiaWeight;
  p.r[i] = clamp01(profile.color[0] + jitter(rng, profile.colorJitter));
  p.g[i] = clamp01(profile.color[1] + jitter(rng, profile.colorJitter));
  p.b[i] = clamp01(profile.color[2] + jitter(rng, profile.colorJitter));
  p.alpha[i] = profile.alpha;
  p.softness[i] = profile.softness;
  p.decayMul[i] = profile.decayMulAtMaxSize ?? 1;
}

/** Emit a single puff. No coalescence (use emitPuffWithCoalesce for that). */
export function emitPuff(
  p: Puffs, profile: PuffProfile, profileIdx: number,
  x: number, y: number, vx: number, vy: number, rng: Rng,
): number {
  const i = allocPuff(p);
  if (i === -1) return -1;
  writeProfile(p, i, profile, profileIdx, x, y, vx, vy, rng);
  return i;
}

/** Emit a single puff, attempting to merge into a nearby same-profile puff
 *  via the supplied per-frame grid. Inserts the new puff into the grid on
 *  fresh spawn so subsequent emissions in the same frame can coalesce. */
export function emitPuffWithCoalesce(
  p: Puffs, profile: PuffProfile, profileIdx: number,
  x: number, y: number, vx: number, vy: number,
  grid: CoalesceGrid, rng: Rng,
): number {
  const merged = tryMergeOrSpawn(p, grid, profile, profileIdx, x, y, rng);
  if (merged.merged) return merged.idx;
  const i = emitPuff(p, profile, profileIdx, x, y, vx, vy, rng);
  if (i !== -1) gridInsert(grid, p, i);
  return i;
}

/** Spawn `count` puffs in a forward cone around (dirX, dirY). Used by
 *  muzzle smoke and explosion billows. No coalescence (each burst is one
 *  emission event; coalescence is meant for streams like marching dust). */
export function emitPuffBurst(
  p: Puffs, profile: PuffProfile, profileIdx: number,
  x: number, y: number, dirX: number, dirY: number,
  count: number, coneAngle: number,
  speed: { min: number; max: number },
  rng: Rng,
): void {
  const theta = Math.atan2(dirY, dirX);
  const half = coneAngle * 0.5;
  for (let n = 0; n < count; n++) {
    const a = theta + rng.range(-half, half);
    const s = rng.range(speed.min, speed.max);
    const vx = Math.cos(a) * s;
    const vy = Math.sin(a) * s;
    emitPuff(p, profile, profileIdx, x, y, vx, vy, rng);
  }
}

/** Muzzle spray: one stationary puff hangs at the gun tip; the rest shoot out
 *  in a tight forward cone along a deterministic velocity gradient — speed.min
 *  for the puff nearest the muzzle, speed.max at the front of the trail, with
 *  the cone angle still randomized per puff. Drag handles deceleration so the
 *  spray settles into a visible string at varying distances rather than
 *  overlapping at the muzzle. No spawn-time coalesce; drift-merging happens
 *  later. */
export function emitPuffMuzzleSpray(
  p: Puffs, profile: PuffProfile, profileIdx: number,
  x: number, y: number, dirX: number, dirY: number,
  count: number, coneAngle: number,
  speed: { min: number; max: number },
  rng: Rng,
): void {
  if (count <= 0) return;
  emitPuff(p, profile, profileIdx, x, y, 0, 0, rng);
  if (count === 1) return;
  const theta = Math.atan2(dirY, dirX);
  const half = coneAngle * 0.5;
  const denom = count > 2 ? count - 2 : 1;
  for (let n = 1; n < count; n++) {
    const t = (n - 1) / denom;
    const s = speed.min + (speed.max - speed.min) * t;
    const a = theta + rng.range(-half, half);
    const vx = Math.cos(a) * s;
    const vy = Math.sin(a) * s;
    emitPuff(p, profile, profileIdx, x, y, vx, vy, rng);
  }
}
