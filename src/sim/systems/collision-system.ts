import type { System } from '../world';
import { rebuildGrid } from '../world';
import { gridQueryRadius } from '../spatial/grid';
import { getUnitKindByIndex, unitKinds } from '../../data/units';

const PUSH_STRENGTH = 0.5;

let MAX_BODY_RADIUS = 0;
for (const k of unitKinds) {
  if (k.baseStats.bodyRadius > MAX_BODY_RADIUS) MAX_BODY_RADIUS = k.baseStats.bodyRadius;
}

export const collisionSystem: System = (world, _dt) => {
  rebuildGrid(world);
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] !== 1) continue;
    if (e.state[i]! >= 4) continue; // ragdoll/dead bodies don't push
    const ki = getUnitKindByIndex(e.kindId[i]!);
    const ri = ki.baseStats.bodyRadius;
    const mi = ki.baseStats.massKg;
    const xi = e.posX[i]!;
    const yi = e.posY[i]!;
    const neighbors = gridQueryRadius(world.grid, xi, yi, ri + MAX_BODY_RADIUS);
    for (let n = 0; n < neighbors.length; n++) {
      const j = neighbors[n]!;
      if (j <= i) continue;
      if (e.alive[j] !== 1) continue;
      if (e.state[j]! >= 4) continue;
      const kj = getUnitKindByIndex(e.kindId[j]!);
      const rj = kj.baseStats.bodyRadius;
      const sumR = ri + rj;
      const dx = e.posX[j]! - e.posX[i]!;
      const dy = e.posY[j]! - e.posY[i]!;
      const distSq = dx * dx + dy * dy;
      if (distSq >= sumR * sumR) continue;
      const dist = Math.sqrt(distSq);
      let nx: number, ny: number;
      if (dist < 1e-5) {
        // Coincident: pick a deterministic direction from the id pair.
        const a = ((i * 12.9898 + j * 78.233) % (Math.PI * 2));
        nx = Math.cos(a);
        ny = Math.sin(a);
      } else {
        nx = dx / dist;
        ny = dy / dist;
      }
      const penetration = sumR - dist;
      const totalM = mi + kj.baseStats.massKg;
      const wi = kj.baseStats.massKg / totalM;
      const wj = mi / totalM;
      const corr = penetration * PUSH_STRENGTH;
      e.posX[i] = e.posX[i]! - nx * corr * wi;
      e.posY[i] = e.posY[i]! - ny * corr * wi;
      e.posX[j] = e.posX[j]! + nx * corr * wj;
      e.posY[j] = e.posY[j]! + ny * corr * wj;
    }
  }
};
