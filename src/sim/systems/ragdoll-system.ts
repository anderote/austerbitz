import { type Entities, EntityState } from '../entities';

/** Per-tick velocity multiplier applied while in ragdoll state. */
const FRICTION_PER_TICK = 0.92;
/** Speed (m/s) below which a ragdoll is considered at rest and may transition out. */
const SPEED_REST_THRESHOLD = 0.5;

const DYING_DURATION = 0.5;

/**
 * Friction + transitions for entities in `EntityState.Ragdoll`.
 *
 * Position integration is handled by `movement-system`; this system only
 * decays velocity, ticks down `ragdollT`, and transitions the entity out of
 * ragdoll once it has settled. Should run AFTER `movement-system` in the tick
 * order — that ordering is the caller's responsibility.
 */
export function tickRagdoll(e: Entities, dt: number): void {
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    if (e.state[i] !== EntityState.Ragdoll) continue;

    e.velX[i] = e.velX[i]! * FRICTION_PER_TICK;
    e.velY[i] = e.velY[i]! * FRICTION_PER_TICK;
    e.ragdollT[i] = e.ragdollT[i]! - dt;

    if (e.ragdollT[i]! <= 0) {
      const speed = Math.hypot(e.velX[i]!, e.velY[i]!);
      if (speed < SPEED_REST_THRESHOLD) {
        if (e.hp[i] === 0) {
          e.state[i] = EntityState.Dying;
          e.stateT[i] = DYING_DURATION;
        } else {
          e.state[i] = EntityState.Idle;
          e.velX[i] = 0;
          e.velY[i] = 0;
        }
      }
    }
  }
}
