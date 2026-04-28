import {
  freeDebris,
  GIB_GRAVITY,
  GIB_AIR_DRAG_XY,
  GIB_AIR_DRAG_Z,
  GIB_BOUNCE_DAMP,
  GIB_GROUND_FRICTION,
  GIB_SPIN_DRAG,
  type Debris,
} from '../debris';

const SETTLE_BOUNCES = 3;
const SETTLE_VZ_EPSILON = 0.5;

export function tickDebris(d: Debris, dt: number): void {
  // Iterate from end of packed list so freeDebris's swap-with-last is safe.
  for (let i = d.count - 1; i >= 0; i--) {
    const id = d.aliveIds[i]!;

    // TTL expiration.
    d.ttl[id] = d.ttl[id]! - dt;
    if (d.ttl[id]! <= 0) {
      freeDebris(d, id);
      continue;
    }

    // Settle check.
    const settled =
      d.bounces[id]! >= SETTLE_BOUNCES ||
      (d.z[id] === 0 && Math.abs(d.velZ[id]!) < SETTLE_VZ_EPSILON && Math.hypot(d.velX[id]!, d.velY[id]!) < SETTLE_VZ_EPSILON);
    if (settled) {
      d.velX[id] = 0;
      d.velY[id] = 0;
      d.velZ[id] = 0;
      d.spinRate[id] = d.spinRate[id]! * 0.2;
      d.spinDeg[id] = d.spinDeg[id]! + d.spinRate[id]! * dt;
      continue;
    }

    // Integrate position.
    d.posX[id] = d.posX[id]! + d.velX[id]! * dt;
    d.posY[id] = d.posY[id]! + d.velY[id]! * dt;
    d.z[id] = d.z[id]! + d.velZ[id]! * dt;

    // Gravity + drag.
    d.velZ[id] = d.velZ[id]! - GIB_GRAVITY * dt;
    d.velX[id] = d.velX[id]! * Math.max(0, 1 - dt * GIB_AIR_DRAG_XY);
    d.velY[id] = d.velY[id]! * Math.max(0, 1 - dt * GIB_AIR_DRAG_XY);
    d.velZ[id] = d.velZ[id]! * Math.max(0, 1 - dt * GIB_AIR_DRAG_Z);

    // Ground bounce.
    if (d.z[id]! < 0) {
      d.z[id] = 0;
      d.velZ[id] = -d.velZ[id]! * GIB_BOUNCE_DAMP;
      d.velX[id] = d.velX[id]! * GIB_GROUND_FRICTION;
      d.velY[id] = d.velY[id]! * GIB_GROUND_FRICTION;
      d.bounces[id] = d.bounces[id]! + 1;
    }

    // Spin.
    d.spinDeg[id] = d.spinDeg[id]! + d.spinRate[id]! * dt;
    d.spinRate[id] = d.spinRate[id]! * Math.max(0, 1 - dt * GIB_SPIN_DRAG);
  }
}
