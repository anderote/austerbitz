import type { System } from '../world';
import { getUnitKindByIndex } from '../../data/units';
import { writeFacingIntent, quantizeDirectionToFacing } from './facing-system';
import { isDead } from '../entities';
import { MARCH_SPEED_FACTOR } from './march-system';

const ARRIVE_RADIUS = 0.1; // m
// Once parked, units push back to their slot at full move speed regardless
// of how far they've been knocked out — formation discipline over polite
// reconvergence. The arrive-radius snap keeps them from overshooting.
function settleFactor(_dist: number): number {
  return 1.0;
}

export const ordersSystem: System = (world, dt) => {
  const e = world.entities;
  for (const [id, queue] of world.orderQueue) {
    if (e.alive[id] !== 1 || queue.length === 0) {
      world.orderQueue.delete(id);
      continue;
    }
    if (isDead(e, id)) continue;
    // 'stop' should be resolved eagerly: clear queue, idle. Re-anchor here so
    // the unit drifts back to *this* spot if jostled later.
    if (queue[0]!.kind === 'stop') {
      e.velX[id] = 0;
      e.velY[id] = 0;
      e.pushedT[id] = 0;
      e.restPosX[id] = e.posX[id]!;
      e.restPosY[id] = e.posY[id]!;
      world.orderQueue.delete(id);
      continue;
    }
    const order = queue[0]!;
    if (order.kind === 'march-formation') {
      const group = world.marchGroups.get(order.groupId);
      if (!group) {
        // Group dissolved out from under us — drop the order and idle.
        queue.shift();
        if (queue.length === 0) world.orderQueue.delete(id);
        e.velX[id] = 0;
        e.velY[id] = 0;
        continue;
      }

      if (group.phase === 'volley') {
        e.velX[id] = 0;
        e.velY[id] = 0;
        writeFacingIntent(e, id, group.forward.x, group.forward.y);
        continue;
      }

      // 'march' phase — same arrival/march logic as 'move' but at march speed.
      // Facing always tracks group.forward (the formation's intended march
      // direction) rather than each unit's individual walk-to-slot vector,
      // so a wheeling formation maintains a consistent rank/file orientation
      // and lands facing the way it marched in.
      const dx = order.targetX - e.posX[id]!;
      const dy = order.targetY - e.posY[id]!;
      const dist = Math.hypot(dx, dy);
      if (dist <= ARRIVE_RADIUS) {
        e.velX[id] = 0;
        e.velY[id] = 0;
        e.pushedT[id] = 0;
        e.restPosX[id] = order.targetX;
        e.restPosY[id] = order.targetY;
        e.restFacing[id] = quantizeDirectionToFacing(group.forward.x, group.forward.y);
        writeFacingIntent(e, id, group.forward.x, group.forward.y);
        if (queue.length > 1) {
          queue.shift();
        } else {
          order.arrived = true;
        }
        continue;
      }
      const baseSpeed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed;
      if (order.arrived) {
        if (e.pushedT[id]! > 0) {
          e.pushedT[id] = Math.max(0, e.pushedT[id]! - dt);
          e.velX[id] = 0;
          e.velY[id] = 0;
          continue;
        }
        const settle = baseSpeed * settleFactor(dist);
        e.velX[id] = (dx / dist) * settle;
        e.velY[id] = (dy / dist) * settle;
        writeFacingIntent(e, id, group.forward.x, group.forward.y);
      } else {
        const marchSpeed = baseSpeed * MARCH_SPEED_FACTOR;
        const pace = group.paceMaxDist > 0 ? Math.min(1, dist / group.paceMaxDist) : 0;
        const speed = marchSpeed * pace;
        e.velX[id] = (dx / dist) * speed;
        e.velY[id] = (dy / dist) * speed;
        writeFacingIntent(e, id, group.forward.x, group.forward.y);
      }
      continue;
    }
    if (order.kind === 'move' || order.kind === 'attack-move') {
      const dx = order.targetX - e.posX[id]!;
      const dy = order.targetY - e.posY[id]!;
      const dist = Math.hypot(dx, dy);
      if (dist <= ARRIVE_RADIUS) {
        e.velX[id] = 0;
        e.velY[id] = 0;
        e.pushedT[id] = 0;
        // The target becomes the new rest anchor. If the order carried an
        // explicit face direction (formation reforms), adopt it so the
        // formation's intended facing is preserved across the move; otherwise
        // fall back to whatever direction the unit was facing on arrival.
        e.restPosX[id] = order.targetX;
        e.restPosY[id] = order.targetY;
        if (order.kind === 'move' && order.faceX !== undefined && order.faceY !== undefined) {
          e.restFacing[id] = quantizeDirectionToFacing(order.faceX, order.faceY);
          writeFacingIntent(e, id, order.faceX, order.faceY);
        } else {
          e.restFacing[id] = e.facing[id]!;
        }
        // Keep the final move/attack-move order parked on its target so
        // collision pushes can't permanently displace the unit — it re-engages
        // next tick if it's nudged out of position. Only consume the order if
        // there's another queued behind it.
        if (queue.length > 1) {
          queue.shift();
        } else {
          order.arrived = true;
        }
        continue;
      }
      const baseSpeed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed;
      if (order.arrived) {
        // Parked unit got shoved. Wait out the recovery delay, then drift back
        // slowly so neighbours have time to clear before we re-converge.
        if (e.pushedT[id]! > 0) {
          e.pushedT[id] = Math.max(0, e.pushedT[id]! - dt);
          e.velX[id] = 0;
          e.velY[id] = 0;
          continue;
        }
        const speed = baseSpeed * settleFactor(dist);
        e.velX[id] = (dx / dist) * speed;
        e.velY[id] = (dy / dist) * speed;
        writeFacingIntent(e, id, dx, dy);
      } else {
        e.velX[id] = (dx / dist) * baseSpeed;
        e.velY[id] = (dy / dist) * baseSpeed;
        writeFacingIntent(e, id, dx, dy);
      }
    } else if (order.kind === 'attack') {
      // Stub until combat lands. If the target is dead or out of bounds, drop the order.
      if (e.alive[order.targetId] !== 1) {
        queue.shift();
        if (queue.length === 0) world.orderQueue.delete(id);
        continue;
      }
      e.velX[id] = 0;
      e.velY[id] = 0;
      const tx = world.entities.posX[order.targetId]!;
      const ty = world.entities.posY[order.targetId]!;
      writeFacingIntent(e, id, tx - e.posX[id]!, ty - e.posY[id]!);
    }
  }

  // Idle units (no order queue entry) drift back to their rest anchor after
  // being shoved. This catches freshly-spawned formation units that never
  // received an explicit move order.
  for (let n = 0; n < e.count; n++) {
    const id = e.aliveIds[n]!;
    if (world.orderQueue.has(id)) continue;
    if (e.state[id]! >= 4) continue; // ragdoll/dying/dead
    if (e.pushedT[id]! > 0) {
      e.pushedT[id] = Math.max(0, e.pushedT[id]! - dt);
      e.velX[id] = 0;
      e.velY[id] = 0;
      continue;
    }
    const dx = e.restPosX[id]! - e.posX[id]!;
    const dy = e.restPosY[id]! - e.posY[id]!;
    const distSq = dx * dx + dy * dy;
    if (distSq <= ARRIVE_RADIUS * ARRIVE_RADIUS) {
      e.velX[id] = 0;
      e.velY[id] = 0;
      continue;
    }
    const dist = Math.sqrt(distSq);
    const speed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed * settleFactor(dist);
    e.velX[id] = (dx / dist) * speed;
    e.velY[id] = (dy / dist) * speed;
    writeFacingIntent(e, id, dx, dy);
  }
};
