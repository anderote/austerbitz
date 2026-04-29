import {
  freeDebris,
  GIB_GRAVITY,
  GIB_AIR_DRAG_XY,
  GIB_AIR_DRAG_Z,
  GIB_BOUNCE_DAMP,
  GIB_GROUND_FRICTION,
  GIB_SPIN_DRAG,
  GIB_SETTLE_BOUNCES,
  type Debris,
} from '../debris';
import type { Puffs } from '../../puffs/puffs';
import type { Rng } from '../../util/rng';
import { emitPuff } from '../../puffs/emit';
import { CANNONBALL_TRAIL, CANNONBALL_TRAIL_INDEX } from '../../puffs/profiles/cannonball-trail';

const SETTLE_VZ_EPSILON = 0.5;
/** Period between smoke-trail puffs while a from-explosion gib is airborne. */
const SMOKE_TRAIL_PERIOD = 0.08;

export function tickDebris(d: Debris, dt: number, puffs?: Puffs, rng?: Rng): void {
  // Iterate from end of packed list so freeDebris's swap-with-last is safe.
  for (let i = d.count - 1; i >= 0; i--) {
    const id = d.aliveIds[i]!;

    // Settle check. Once settled, gibs persist until evicted by the allocator
    // (so corpses pile up across the battle), so skip TTL/integration entirely.
    const settled =
      d.bounces[id]! >= GIB_SETTLE_BOUNCES ||
      (d.z[id] === 0 && Math.abs(d.velZ[id]!) < SETTLE_VZ_EPSILON && Math.hypot(d.velX[id]!, d.velY[id]!) < SETTLE_VZ_EPSILON);
    if (settled) {
      // Pin to the ground — bounce-count settle can fire mid-arc with z>0.
      d.z[id] = 0;
      d.velX[id] = 0;
      d.velY[id] = 0;
      d.velZ[id] = 0;
      d.spinRate[id] = d.spinRate[id]! * 0.2;
      d.spinDeg[id] = d.spinDeg[id]! + d.spinRate[id]! * dt;
      continue;
    }

    // In-flight TTL — only ticks for unsettled gibs, as a safety net for ones
    // that get stuck off-ground (slope edge, etc.) and never settle.
    d.ttl[id] = d.ttl[id]! - dt;
    if (d.ttl[id]! <= 0) {
      freeDebris(d, id);
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

    // Explosion-origin gibs trail smoke wisps while airborne.
    if (puffs && rng && d.fromExplosion[id] === 1 && d.z[id]! > 0) {
      let t = d.smokeT[id]! + dt;
      while (t >= SMOKE_TRAIL_PERIOD) {
        emitPuff(puffs, CANNONBALL_TRAIL, CANNONBALL_TRAIL_INDEX, d.posX[id]!, d.posY[id]!, 0, 0, rng);
        t -= SMOKE_TRAIL_PERIOD;
      }
      d.smokeT[id] = t;
    }
  }
}
