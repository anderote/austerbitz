import type { System } from '../world';
import type { Entities } from '../entities';

const SPEED_EPS = 0.05;          // m/s — ignore jitter below this speed
const SPEED_EPS_SQ = SPEED_EPS * SPEED_EPS;
const HALF_OCTANT = Math.PI / 8; // 22.5° — distance from an octant center to its boundary
// (≈10°) — extra margin past the octant boundary an intent must travel before
// a transition fires. Without this the facing flips on every tick where the
// intent angle wobbles across a boundary.
const HYSTERESIS_RAD = (10 * Math.PI) / 180;
const SWITCH_THRESHOLD_RAD = HALF_OCTANT + HYSTERESIS_RAD;

export function writeFacingIntent(e: Entities, id: number, dirX: number, dirY: number): void {
  const lenSq = dirX * dirX + dirY * dirY;
  if (lenSq < 1e-6) return;
  const inv = 1 / Math.sqrt(lenSq);
  e.facingIntentX[id] = dirX * inv;
  e.facingIntentY[id] = dirY * inv;
}

export function quantizeDirectionToFacing(dirX: number, dirY: number): number {
  const lenSq = dirX * dirX + dirY * dirY;
  if (lenSq < 1e-12) return 0;
  const angle = Math.atan2(dirY, dirX);
  const wrapped = angle < 0 ? angle + Math.PI * 2 : angle;
  const oct = Math.floor((wrapped + Math.PI / 8) / (Math.PI / 4)) & 7;
  return oct;
}

/** Octant (0..7) → unit vector (CCW from east). */
export function facingToVec(facing: number): { x: number; y: number } {
  const theta = (facing * Math.PI) / 4;
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

function angleDifference(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export const facingSystem: System = (world, _dt) => {
  const e = world.entities;
  for (let i = 0; i < e.count; i++) {
    const id = e.aliveIds[i]!;
    const vx = e.velX[id]!;
    const vy = e.velY[id]!;

    let ix = e.facingIntentX[id]!;
    let iy = e.facingIntentY[id]!;

    const speedSq = vx * vx + vy * vy;
    if (speedSq > SPEED_EPS_SQ) {
      const inv = 1 / Math.sqrt(speedSq);
      ix = vx * inv;
      iy = vy * inv;
      e.facingIntentX[id] = ix;
      e.facingIntentY[id] = iy;
    } else if (ix * ix + iy * iy < 1e-6) {
      ix = 1;
      iy = 0;
      e.facingIntentX[id] = 1;
      e.facingIntentY[id] = 0;
    }

    const newFacing = quantizeDirectionToFacing(ix, iy);
    const prevFacing = e.facing[id]!;
    if (prevFacing !== newFacing) {
      // Compare the actual intent angle to the *current* octant's center: only
      // switch once the intent has crossed the boundary by more than the
      // hysteresis margin. Comparing octant centers (the old behaviour) was a
      // no-op because adjacent centers are always 45° apart.
      const intentAngle = Math.atan2(iy, ix);
      const prevAngle = (prevFacing * Math.PI) / 4;
      if (angleDifference(intentAngle, prevAngle) > SWITCH_THRESHOLD_RAD) {
        e.facing[id] = newFacing;
      }
    }
  }
};
