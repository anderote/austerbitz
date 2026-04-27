import type { System } from '../world';
import { triggerFire, type FireOrders } from './state-system';
import { EntityState } from '../entities';
import { gridQueryRect } from '../spatial/grid';
import { getUnitKindByIndex } from '../../data/units';
import { hasRecentFire } from '../fire-signal';

// Block firing while marching at full speed, but allow the formation
// "settle drift" (orders-system sends parked/idle units back to their rest
// anchor at baseSpeed * 0.3 ≈ 0.75 m/s for line-infantry). 1.0 m/s clears
// 0.75 m/s drift but still blocks the 2.5 m/s line-infantry march.
const VEL_EPS_SQ = 1.0 * 1.0;
const candidateBuf = new Int32Array(2048);

// Stripe scans across this many ticks. Each entity does at most one full
// gridQueryRect every SCAN_PERIOD ticks (offset by id). The fast-path target
// cache below bypasses this entirely once a unit has locked onto an enemy.
const SCAN_PERIOD = 8;

// Volley contagion tunables.
const VOLLEY_WINDOW_TICKS = 9;          // ~0.15 s at 60 Hz
const JOIN_WINDUP_S = 0.0;              // joiners fire on the very next state-system tick
const AIMING_WINDUP_S = 0.15;           // mirror state-system's AIMING_WINDUP for leader fire
export const MAX_HOLD_MIN_S = 0.20;
export const MAX_HOLD_MAX_S = 0.60;

/**
 * Per-soldier hold ceiling: time a `Idle` armed soldier waits for a nearby
 * volley signal before firing alone. Stable across ticks (id-derived hash),
 * spread across [MAX_HOLD_MIN_S, MAX_HOLD_MAX_S]. Some soldiers always lead;
 * others always follow.
 */
export function maxHoldFor(id: number): number {
  let h = Math.imul(id, 2654435761) | 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  const u = (h >>> 0) / 0x100000000;
  return MAX_HOLD_MIN_S + (MAX_HOLD_MAX_S - MAX_HOLD_MIN_S) * u;
}

export function createCombatSystem(fireOrders: FireOrders): System {
  return (world, _dt) => {
    const e = world.entities;
    const grid = world.grid;
    const fireSignal = world.fireSignal;
    const tick = world.tickCount;
    for (let n = 0; n < e.count; n++) {
      const id = e.aliveIds[n]!;
      if (e.state[id] !== EntityState.Idle) continue;
      const vx = e.velX[id]!;
      const vy = e.velY[id]!;
      if (vx * vx + vy * vy > VEL_EPS_SQ) continue;
      const kind = getUnitKindByIndex(e.kindId[id]!);
      const weapon = kind.weapon;
      if (!weapon) continue;

      const range = kind.baseStats.weaponRange;
      const team = e.team[id]!;
      const px = e.posX[id]!;
      const py = e.posY[id]!;
      const rangeSq = range * range;

      // Step 1: acquire a valid target. Fast-path on prev target if still
      // alive + in range; otherwise scan-throttled grid query (closest pick).
      let targetId = -1;
      const prev = e.targetId[id]!;
      if (prev !== -1 && e.alive[prev] === 1 && e.team[prev] !== team) {
        const ps = e.state[prev]!;
        if (
          ps !== EntityState.Dead &&
          ps !== EntityState.Dying &&
          ps !== EntityState.Ragdoll
        ) {
          const dxp = e.posX[prev]! - px;
          const dyp = e.posY[prev]! - py;
          if (dxp * dxp + dyp * dyp <= rangeSq) {
            targetId = prev;
          }
        }
      }
      if (targetId === -1) {
        if ((tick + id) % SCAN_PERIOD !== 0) continue;
        const count = gridQueryRect(
          grid,
          px - range, py - range,
          px + range, py + range,
          candidateBuf,
        );
        let bestId = -1;
        let bestD2 = Infinity;
        for (let k = 0; k < count; k++) {
          const cid = candidateBuf[k]!;
          if (e.alive[cid] === 0) continue;
          if (e.team[cid] === team) continue;
          const cs = e.state[cid]!;
          if (
            cs === EntityState.Dead ||
            cs === EntityState.Dying ||
            cs === EntityState.Ragdoll
          ) continue;
          const dx = e.posX[cid]! - px;
          const dy = e.posY[cid]! - py;
          const d2 = dx * dx + dy * dy;
          if (d2 > rangeSq) continue;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestId = cid;
          }
        }
        if (bestId === -1) continue;
        targetId = bestId;
        e.targetId[id] = bestId;
      }

      // Step 2: hold-then-fire decision. Join a hot volley with 0 windup,
      // else fire alone with full windup once the per-id maxHold expires,
      // else wait (stateT keeps incrementing in tickStates).
      const tx = e.posX[targetId]!;
      const ty = e.posY[targetId]!;
      const hot = hasRecentFire(fireSignal, grid, px, py, team, tick, VOLLEY_WINDOW_TICKS);
      if (hot) {
        triggerFire(e, fireOrders, id, tx, ty, JOIN_WINDUP_S);
      } else if (e.stateT[id]! >= maxHoldFor(id)) {
        triggerFire(e, fireOrders, id, tx, ty, AIMING_WINDUP_S);
      }
    }
  };
}
