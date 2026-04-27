import type { System } from '../world';
import { getUnitKindByIndex } from '../../data/units';

const ARRIVE_RADIUS = 0.1; // m

export const ordersSystem: System = (world, _dt) => {
  const e = world.entities;
  for (const [id, order] of world.orders) {
    if (e.alive[id] === 0) {
      world.orders.delete(id);
      continue;
    }
    if (order.kind === 'move') {
      const dx = order.targetX - e.posX[id]!;
      const dy = order.targetY - e.posY[id]!;
      const dist = Math.hypot(dx, dy);
      if (dist <= ARRIVE_RADIUS) {
        e.velX[id] = 0;
        e.velY[id] = 0;
        world.orders.delete(id);
        continue;
      }
      const speed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed;
      e.velX[id] = (dx / dist) * speed;
      e.velY[id] = (dy / dist) * speed;
    }
  }
};
