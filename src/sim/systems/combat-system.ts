import type { System } from '../world';
import { triggerFire, type FireOrders } from './state-system';
import { EntityState, FireStance } from '../entities';
import { gridQueryRect } from '../spatial/grid';
import { getUnitKindByIndex } from '../../data/units';
import { hasRecentFire, hasRecentFireAnyRank } from '../fire-signal';
import { inferFormationRank } from '../formation-rank';

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

// Per-stance volley/aim tunables. Index = FireStance value.
//   leaderWindup : Aiming time when this unit fires alone
//   joinerWindup : always 0; preserved for symmetry with state-system
//   maxHoldMin/Max : range for maxHoldFor(id, stance)
const STANCE_TUNABLES = [
  // AtWill
  { leaderWindup: 0.15, joinerWindup: 0.0, maxHoldMin: 0.0, maxHoldMax: 0.0 },
  // Volley
  { leaderWindup: 0.40, joinerWindup: 0.0, maxHoldMin: 0.5, maxHoldMax: 2.0 },
  // ByRanks
  { leaderWindup: 0.25, joinerWindup: 0.0, maxHoldMin: 0.3, maxHoldMax: 1.2 },
  // Hold
  { leaderWindup: 0.0,  joinerWindup: 0.0, maxHoldMin: 0.0, maxHoldMax: 0.0 },
] as const;

/**
 * Per-soldier hold ceiling: time an Idle armed soldier waits for a nearby
 * volley signal before firing alone. Stable across ticks (id-derived hash),
 * spread across [maxHoldMin, maxHoldMax] for the given stance.
 */
export function maxHoldFor(id: number, stance: number): number {
  const t = STANCE_TUNABLES[stance] ?? STANCE_TUNABLES[2]!; // default ByRanks
  if (t.maxHoldMax <= 0) return 0;
  let h = Math.imul(id, 2654435761) | 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  const u = (h >>> 0) / 0x100000000;
  return t.maxHoldMin + (t.maxHoldMax - t.maxHoldMin) * u;
}

export function createCombatSystem(fireOrders: FireOrders): System {
  return function combatSystem(world, _dt) {
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

      // Refresh formationRank on this entity's stripe tick. Cheap: a single
      // grid query at restPos. Decoupled from target acquisition.
      if ((tick + id) % SCAN_PERIOD === 0) {
        e.formationRank[id] = inferFormationRank(
          e, grid, id,
          kind.baseStats.formationSpacing.x,
          kind.baseStats.formationSpacing.y,
        );
      }

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

      // canFire is purely rank-based now: front rank fires forward, rank 1
      // fires "over" rank 0, rank 2+ blocked. formationRank was refreshed
      // earlier on this stripe tick.
      e.canFire[id] = e.formationRank[id]! <= 1 ? 1 : 0;
      if (!e.canFire[id]) continue;

      // Step 3: stance-driven fire decision.
      const stance = e.stance[id]!;
      if (stance === FireStance.Hold) continue;

      const tun = STANCE_TUNABLES[stance] ?? STANCE_TUNABLES[FireStance.ByRanks]!;

      if (stance === FireStance.AtWill) {
        triggerFire(e, fireOrders, id, tx, ty, tun.leaderWindup);
        continue;
      }

      // Loaded-during-Hold short-circuit: if the unit reloaded while held
      // and the player just flipped stance, release the shot on the very
      // next stripe tick — no maxHold wait, no volley signal needed.
      if (e.holdLoaded[id]) {
        triggerFire(e, fireOrders, id, tx, ty, tun.joinerWindup);
        continue;
      }

      // Volley + ByRanks: join hot fire if any, else fire alone after maxHold.
      const myRank = e.formationRank[id]!;
      const hot = stance === FireStance.Volley
        ? hasRecentFireAnyRank(fireSignal, grid, px, py, team, tick, VOLLEY_WINDOW_TICKS)
        : hasRecentFire(fireSignal, grid, px, py, team, myRank, tick, VOLLEY_WINDOW_TICKS);
      if (hot) {
        triggerFire(e, fireOrders, id, tx, ty, tun.joinerWindup);
      } else if (e.stateT[id]! >= maxHoldFor(id, stance)) {
        triggerFire(e, fireOrders, id, tx, ty, tun.leaderWindup);
      }
    }
  };
}
