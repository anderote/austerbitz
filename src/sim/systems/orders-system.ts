import type { System } from '../world';
import { getUnitKindByIndex } from '../../data/units';

const ARRIVE_RADIUS = 0.1; // m

export const ordersSystem: System = (world, _dt) => {
  const e = world.entities;
  for (const [id, queue] of world.orderQueue) {
    if (e.alive[id] !== 1 || queue.length === 0) {
      world.orderQueue.delete(id);
      continue;
    }
    // 'stop' should be resolved eagerly: clear queue, idle.
    if (queue[0]!.kind === 'stop') {
      e.velX[id] = 0;
      e.velY[id] = 0;
      world.orderQueue.delete(id);
      continue;
    }
    const order = queue[0]!;
    if (order.kind === 'move' || order.kind === 'attack-move') {
      const dx = order.targetX - e.posX[id]!;
      const dy = order.targetY - e.posY[id]!;
      const dist = Math.hypot(dx, dy);
      if (dist <= ARRIVE_RADIUS) {
        e.velX[id] = 0;
        e.velY[id] = 0;
        queue.shift();
        if (queue.length === 0) world.orderQueue.delete(id);
        continue;
      }
      const speed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed;
      e.velX[id] = (dx / dist) * speed;
      e.velY[id] = (dy / dist) * speed;
    } else if (order.kind === 'attack') {
      // Stub until combat lands. If the target is dead or out of bounds, drop the order.
      if (e.alive[order.targetId] !== 1) {
        queue.shift();
        if (queue.length === 0) world.orderQueue.delete(id);
        continue;
      }
      e.velX[id] = 0;
      e.velY[id] = 0;
    }
  }
};
