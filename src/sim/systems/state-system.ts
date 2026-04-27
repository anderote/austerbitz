import { type Entities, EntityState } from '../entities';
import type { Projectiles } from '../projectiles';
import type { Particles } from '../../particles/particles';
import type { Rng } from '../../util/rng';
import { resolveFire } from '../fire-resolver';
import { getUnitKindByIndex } from '../../data/units';

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
): void {
  e.state[id] = EntityState.Aiming;
  e.stateT[id] = AIMING_WINDUP;
  fireOrders.set(id, { tx: targetX, ty: targetY });
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
  rng: Rng,
  fireOrders: FireOrders,
  dt: number,
): void {
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;

    // Visual recoil timer always counts down regardless of state.
    if (e.recoilT[i]! > 0) {
      e.recoilT[i] = Math.max(0, e.recoilT[i]! - dt);
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
            resolveFire(e, projectiles, particles, rng, i, order.tx, order.ty);
          }
          fireOrders.delete(i);

          const kind = getUnitKindByIndex(e.kindId[i]!);
          e.state[i] = EntityState.Reloading;
          e.reloadT[i] = kind.baseStats.weaponReload;
          e.stateT[i] = 0;
        }
        break;
      }
      case EntityState.Reloading: {
        e.reloadT[i] = e.reloadT[i]! - dt;
        if (e.reloadT[i]! <= 0) {
          e.state[i] = EntityState.Idle;
          e.reloadT[i] = 0;
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
        break;
    }
  }
}
