import type { System } from '../world';
import { gridQueryRect } from '../spatial/grid';
import { getUnitKindByIndex } from '../../data/units';
import { EntityState } from '../entities';

/** Multiplier on each unit's baseStats.moveSpeed during a formation march. */
export const MARCH_SPEED_FACTOR = 0.6;
/** Sim-seconds the group holds in 'volley' phase before resuming the march. */
export const VOLLEY_DURATION = 4.0;
/** Ticks between enemy-in-range scans per group, striped by gid. */
export const MARCH_SCAN_PERIOD = 8;

const candidateBuf = new Int32Array(2048);

export const marchSystem: System = (world, _dt) => {
  const e = world.entities;

  for (const [gid, group] of world.marchGroups) {
    // 1. Reconcile members: drop dead, drop those whose head order no longer
    //    references this group.
    for (const id of group.members) {
      if (e.alive[id] !== 1) { group.members.delete(id); continue; }
      const q = world.orderQueue.get(id);
      const head = q && q[0];
      if (!head || head.kind !== 'march-formation' || head.groupId !== gid) {
        group.members.delete(id);
      }
    }
    if (group.members.size === 0) {
      world.marchGroups.delete(gid);
      continue;
    }

    // 2. Phase transitions.
    if (group.phase === 'volley') {
      if (world.simTime - group.phaseStartT >= VOLLEY_DURATION) {
        group.phase = 'march';
        group.phaseStartT = world.simTime;
      }
      continue;
    }

    // phase === 'march' — gate the enemy scan to once per SCAN_PERIOD ticks per group.
    if ((world.tickCount + gid) % MARCH_SCAN_PERIOD !== 0) continue;

    // Compute group bbox + max weapon range; check there is at least one ready shooter.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let maxRange = 0;
    let team = 0;
    let anyReadyShooter = false;
    for (const id of group.members) {
      const x = e.posX[id]!, y = e.posY[id]!;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      const kind = getUnitKindByIndex(e.kindId[id]!);
      if (!kind.weapon) continue;
      if (kind.baseStats.weaponRange > maxRange) maxRange = kind.baseStats.weaponRange;
      team = e.team[id]!;
      if (e.state[id] === EntityState.Idle && e.reloadT[id]! <= 0) anyReadyShooter = true;
    }
    if (!anyReadyShooter || maxRange <= 0) continue;

    const n = gridQueryRect(
      world.grid,
      minX - maxRange, minY - maxRange,
      maxX + maxRange, maxY + maxRange,
      candidateBuf,
    );

    let triggered = false;
    for (const id of group.members) {
      if (triggered) break;
      if (e.state[id] !== EntityState.Idle) continue;
      if (e.reloadT[id]! > 0) continue;
      const kind = getUnitKindByIndex(e.kindId[id]!);
      if (!kind.weapon) continue;
      const range = kind.baseStats.weaponRange;
      const r2 = range * range;
      const px = e.posX[id]!, py = e.posY[id]!;
      for (let k = 0; k < n; k++) {
        const cid = candidateBuf[k]!;
        if (e.alive[cid] === 0) continue;
        if (e.team[cid] === team) continue;
        const cs = e.state[cid]!;
        if (cs === EntityState.Dead || cs === EntityState.Dying || cs === EntityState.Ragdoll) continue;
        const dx = e.posX[cid]! - px;
        const dy = e.posY[cid]! - py;
        if (dx * dx + dy * dy <= r2) { triggered = true; break; }
      }
    }

    if (triggered) {
      group.phase = 'volley';
      group.phaseStartT = world.simTime;
    }
  }
};
