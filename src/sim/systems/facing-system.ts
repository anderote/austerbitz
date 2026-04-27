import type { System } from '../world';
import type { Entities } from '../entities';

const SPEED_EPS = 0.05;          // m/s — ignore jitter below this speed
const SPEED_EPS_SQ = SPEED_EPS * SPEED_EPS;
const HYSTERESIS_RAD = (10 * Math.PI) / 180; // (≈10°) prevents flicker between neighboring octants

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
      const prevAngle = (prevFacing * Math.PI) / 4;
      const newAngle = (newFacing * Math.PI) / 4;
      if (angleDifference(newAngle, prevAngle) > HYSTERESIS_RAD) {
        e.facing[id] = newFacing;
      }
    }
  }
};
