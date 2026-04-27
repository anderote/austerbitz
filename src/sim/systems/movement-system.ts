import type { System } from '../world';
import { isDead } from '../entities';

export const movementSystem: System = (world, dt) => {
  const e = world.entities;
  for (let n = 0; n < e.count; n++) {
    const i = e.aliveIds[n]!;
    if (isDead(e, i)) continue;
    e.posX[i] += e.velX[i]! * dt;
    e.posY[i] += e.velY[i]! * dt;
  }
};
