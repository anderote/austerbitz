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

// Forward-arc occlusion ("only the front 3 ranks fire"). After a soldier picks
// a target, on its stripe tick we sweep a narrow box from the soldier toward
// the target and count blocking same-team soldiers. 3+ blockers → canFire
// flips to 0 for the next SCAN_PERIOD ticks. When a front ranker dies the
// soldier behind flips back within ≤8 ticks.
//
// Forward extent scales with the unit's per-rank spacing × this slack — covers
// up to ~1.5× spacing multiplier ("Close" → "Open" range). Beyond that, the
// formation is loose enough that gating doesn't apply.
const FORWARD_RANKS_SLACK = 4.5;
const FORWARD_NEAR = 0.4;
const LATERAL_HALF = 0.4;
const LATERAL_HALF_SQ = LATERAL_HALF * LATERAL_HALF;
const BLOCKING_THRESHOLD = 3;

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
      const rangeSq = range * range;
      const team = e.team[id]!;
      const px = e.posX[id]!;
      const py = e.posY[id]!;

      // Step 1: acquire a valid target. Fast-path on prev target if still
      // alive + in weapon range; otherwise scan-throttled grid query at
      // weaponRange and take the first valid opposing-team entity. Distance
      // is checked against rangeSq because the grid rect overscans the
      // inscribed circle by ~21% at the corners.
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
          if (dx * dx + dy * dy > rangeSq) continue;
          targetId = cid;
          e.targetId[id] = cid;
          break;
        }
        if (targetId === -1) continue;
      }

      const tx = e.posX[targetId]!;
      const ty = e.posY[targetId]!;

      // Step 2: refresh canFire on the stripe tick. Forward = unit vector
      // toward target; sweep a narrow box and count same-team blockers. AABB
      // is forward-shifted to keep the grid query tight (no overscan behind
      // or far to the side of the soldier).
      if ((tick + id) % SCAN_PERIOD === 0) {
        const ddx = tx - px;
        const ddy = ty - py;
        const dlen = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dlen > 1e-6) {
          const fx = ddx / dlen;
          const fy = ddy / dlen;
          const FORWARD_FAR = kind.baseStats.formationSpacing.y * FORWARD_RANKS_SLACK;
          const cx = px + fx * FORWARD_FAR * 0.5;
          const cy = py + fy * FORWARD_FAR * 0.5;
          const halfFwd = FORWARD_FAR * 0.5;
          const aabbHalfX = Math.abs(fx) * halfFwd + Math.abs(fy) * LATERAL_HALF;
          const aabbHalfY = Math.abs(fy) * halfFwd + Math.abs(fx) * LATERAL_HALF;
          const cnt = gridQueryRect(
            grid,
            cx - aabbHalfX, cy - aabbHalfY,
            cx + aabbHalfX, cy + aabbHalfY,
            candidateBuf,
          );
          let blocking = 0;
          for (let k = 0; k < cnt; k++) {
            const cid = candidateBuf[k]!;
            if (cid === id) continue;
            if (e.alive[cid] === 0) continue;
            if (e.team[cid] !== team) continue;
            const cs = e.state[cid]!;
            if (cs === EntityState.Dying || cs === EntityState.Dead || cs === EntityState.Ragdoll) continue;
            const dx = e.posX[cid]! - px;
            const dy = e.posY[cid]! - py;
            const fwd = dx * fx + dy * fy;
            if (fwd < FORWARD_NEAR || fwd > FORWARD_FAR) continue;
            // perpendicular axis is (-fy, fx)
            const lat = -dx * fy + dy * fx;
            if (lat * lat > LATERAL_HALF_SQ) continue;
            blocking++;
            if (blocking >= BLOCKING_THRESHOLD) break;
          }
          e.canFire[id] = blocking >= BLOCKING_THRESHOLD ? 0 : 1;
        }
      }
      if (!e.canFire[id]) continue;

      // Step 3: hold-then-fire decision. Join a hot volley with 0 windup,
      // else fire alone with full windup once the per-id maxHold expires,
      // else wait (stateT keeps incrementing in tickStates).
      const hot = hasRecentFire(fireSignal, grid, px, py, team, tick, VOLLEY_WINDOW_TICKS);
      if (hot) {
        triggerFire(e, fireOrders, id, tx, ty, JOIN_WINDUP_S);
      } else if (e.stateT[id]! >= maxHoldFor(id)) {
        triggerFire(e, fireOrders, id, tx, ty, AIMING_WINDUP_S);
      }
    }
  };
}
