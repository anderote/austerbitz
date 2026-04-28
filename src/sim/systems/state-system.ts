import { type Entities, EntityState } from '../entities';
import type { Projectiles } from '../projectiles';
import type { Particles } from '../../particles/particles';
import type { Puffs } from '../../puffs/puffs';
import type { Rng } from '../../util/rng';
import { resolveFire } from '../fire-resolver';
import { getUnitKindByIndex } from '../../data/units';
import { effectiveReload } from '../veterancy';
import { writeFacingIntent } from './facing-system';
import { Pose } from '../../render/poses/pose-config';
import { writeFireSignal, type FireSignal } from '../fire-signal';
import type { Grid } from '../spatial/grid';

// m/s — matches facing-system's SPEED_EPS. Below this we treat the unit as
// stationary and pick the idle pose instead of walking/running.
const SPEED_EPS_SQ = 0.05 * 0.05;

function poseFor(state: EntityState, speedSq: number, marching: boolean): Pose {
  switch (state) {
    case EntityState.Idle:
    case EntityState.Moving:
      if (speedSq <= SPEED_EPS_SQ) return Pose.idle;
      return marching ? Pose.walking : Pose.running;
    case EntityState.Aiming:    return Pose.aiming;
    case EntityState.Firing:    return Pose.firing;
    case EntityState.Reloading: return Pose.reloading;
    case EntityState.Flinch:    return Pose.flinch;
    case EntityState.Ragdoll:   return Pose.ragdoll;
    case EntityState.Dying:     return Pose.dying;
    case EntityState.Dead:      return Pose.dead;
    default:                    return Pose.idle;
  }
}

function pickClip(id: number, tick: number, n: number): number {
  if (n <= 1) return 0;
  let h = (Math.imul(id, 2654435761) ^ Math.imul(tick, 1597334677)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) % n;
}

/** Side-table mapping entity id → aim point. Populated by `triggerFire`. */
export type FireOrders = Map<number, { tx: number; ty: number }>;

/** Pre-fire windup: time held in Aiming before the shot leaves the barrel. */
const AIMING_WINDUP = 0.15;

/**
 * Begin the fire sequence for an entity. Sets state=Aiming with a brief
 * windup; the shot itself is resolved by `tickStates` once the windup elapses.
 */
export function triggerFire(
  e: Entities,
  fireOrders: FireOrders,
  id: number,
  targetX: number,
  targetY: number,
  windup: number = AIMING_WINDUP,
): void {
  e.state[id] = EntityState.Aiming;
  e.stateT[id] = windup;
  fireOrders.set(id, { tx: targetX, ty: targetY });
  writeFacingIntent(e, id, targetX - e.posX[id]!, targetY - e.posY[id]!);
}

/**
 * Drives state transitions and short-lived timers each tick:
 *   Aiming → Firing → Reloading → Idle
 *   Flinch → Idle
 *   Dying  → Dead
 *
 * Ragdoll transitions are handled by `ragdoll-system`. The `Firing` state is
 * traversed in a single tick: when Aiming runs out we resolve the shot, set
 * Reloading, and never return to the caller in the Firing state.
 */
export function tickStates(
  e: Entities,
  projectiles: Projectiles,
  particles: Particles,
  puffs: Puffs,
  rng: Rng,
  fireOrders: FireOrders,
  dt: number,
  tick: number,
  fireSignal: FireSignal,
  grid: Grid,
): void {
  for (let n = 0; n < e.count; n++) {
    const i = e.aliveIds[n]!;

    // Visual recoil timer always counts down regardless of state. When it
    // hits zero the render-only peak vector is cleared so the entity
    // settles back at its anchor position.
    if (e.recoilT[i]! > 0) {
      e.recoilT[i] = Math.max(0, e.recoilT[i]! - dt);
      if (e.recoilT[i] === 0) {
        e.recoilPeakX[i] = 0;
        e.recoilPeakY[i] = 0;
      }
    }

    const state = e.state[i]!;
    switch (state) {
      case EntityState.Aiming: {
        e.stateT[i] = e.stateT[i]! - dt;
        if (e.stateT[i]! <= 0) {
          // Logically traverse Firing for one resolve before going to Reloading.
          e.state[i] = EntityState.Firing;
          const order = fireOrders.get(i);
          if (order) {
            const fired = resolveFire(e, projectiles, particles, puffs, rng, i, order.tx, order.ty);
            if (fired) {
              writeFireSignal(fireSignal, grid, e.posX[i]!, e.posY[i]!, e.team[i]!, tick);
            }
          }
          fireOrders.delete(i);

          const kind = getUnitKindByIndex(e.kindId[i]!);
          e.state[i] = EntityState.Reloading;
          // Jitter ±20% so units don't resync into a single volley over time.
          e.reloadT[i] = effectiveReload(e, i, kind.baseStats.weaponReload) * rng.range(0.8, 1.2);
          e.stateT[i] = 0;
        }
        break;
      }
      case EntityState.Reloading: {
        e.reloadT[i] = e.reloadT[i]! - dt;
        if (e.reloadT[i]! <= 0) {
          e.state[i] = EntityState.Idle;
          e.reloadT[i] = 0;
          e.stateT[i] = 0;
        }
        break;
      }
      case EntityState.Flinch: {
        e.stateT[i] = e.stateT[i]! - dt;
        if (e.stateT[i]! <= 0) {
          e.state[i] = EntityState.Idle;
          e.stateT[i] = 0;
        }
        break;
      }
      case EntityState.Dying: {
        e.stateT[i] = e.stateT[i]! - dt;
        if (e.stateT[i]! <= 0) {
          e.state[i] = EntityState.Dead;
          e.stateT[i] = 0;
        }
        break;
      }
      default:
        // Idle, Moving, Firing (transient), Ragdoll, Dead — no transition here.
        // stateT accumulates while in Idle so combat-system can read it as
        // "time spent ready" (used by the volley maxHold watchdog).
        if (e.state[i] === EntityState.Idle) e.stateT[i] = e.stateT[i]! + dt;
        break;
    }

    // Death-drops-system owns the corpse pose: at the moment of death it
    // freezes the body in a random LIVE pose (for infantry) or sets dying for
    // others, and we want that to stick. Skip the desired-pose recompute for
    // Dying/Dead so it doesn't get overwritten back to Pose.dying/Pose.dead.
    const stateNow = e.state[i] as EntityState;
    if (stateNow !== EntityState.Dying && stateNow !== EntityState.Dead) {
      const vx = e.velX[i]!;
      const vy = e.velY[i]!;
      const speedSq = vx * vx + vy * vy;
      const desired = poseFor(stateNow, speedSq, e.isMarching[i] === 1);
      if (e.pose[i] !== desired) {
        e.pose[i] = desired;
        e.poseT[i] = 0;
        e.clipIndex[i] = pickClip(i, tick, 256) & 0xff;
      } else {
        e.poseT[i] = e.poseT[i]! + dt;
      }
    }
  }
}
