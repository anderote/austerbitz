import type { Puffs } from './puffs';

/** Applies horizontal wind acceleration to alive puffs. The effect scales
 *  with |buoyancy|: lighter puffs (high upward buoyancy magnitude) catch
 *  more wind. Heavy ground dust (small buoyancy) barely moves. */
export function applyWindToPuffs(p: Puffs, accelX: number, dt: number): void {
  if (accelX === 0) return;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    const factor = Math.min(1.0, Math.abs(p.buoyancy[i]!));
    p.velX[i] = p.velX[i]! + accelX * factor * dt;
  }
}
