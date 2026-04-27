import type { System } from '../world';
import { triggerFire, type FireOrders } from './state-system';
import { EntityState } from '../entities';
import { gridQueryRect } from '../spatial/grid';
import { getUnitKindByIndex } from '../../data/units';

// Block firing while marching at full speed, but allow the formation
// "settle drift" (orders-system sends parked/idle units back to their rest
// anchor at baseSpeed * 0.3 ≈ 0.75 m/s for line-infantry). Without this
// allowance, any collision shove would silence a unit until it fully
// re-anchored — fine in the worktree where rest-drift didn't exist, but
// after the main-branch rest-pose-drift behavior landed it suppressed
// most subsequent volleys. 1.0 m/s clears 0.75 m/s drift but still blocks
// the 2.5 m/s line-infantry march.
const VEL_EPS_SQ = 1.0 * 1.0;
const candidateBuf = new Int32Array(2048);

export function createCombatSystem(fireOrders: FireOrders): System {
  return (world, _dt) => {
    const e = world.entities;
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

      const count = gridQueryRect(
        world.grid,
        px - range, py - range,
        px + range, py + range,
        candidateBuf,
      );

      let bestId = -1;
      let bestD2 = range * range + 1e-9;
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
        if (d2 < bestD2 || (d2 === bestD2 && (bestId === -1 || cid < bestId))) {
          bestD2 = d2;
          bestId = cid;
        }
      }

      if (bestId === -1) continue;
      triggerFire(e, fireOrders, id, e.posX[bestId]!, e.posY[bestId]!);
      e.targetId[id] = bestId;
    }
  };
}
