import type { System } from '../world';

export const movementSystem: System = (world, dt) => {
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    e.posX[i] += e.velX[i]! * dt;
    e.posY[i] += e.velY[i]! * dt;
  }
};
