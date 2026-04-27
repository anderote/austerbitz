import { ParticleClass, type Particles } from '../particles/particles';

/**
 * Adds a horizontal acceleration to alive smoke particles only.
 *
 * Per spec §4: wind affects only `class = smoke`. Flash, dust, blood, and
 * debris are deliberately untouched so impact bursts and muzzle flashes
 * remain crisp regardless of wind state.
 */
export function applyWind(particles: Particles, accelX: number, dt: number): void {
  if (accelX === 0) return;
  const p = particles;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    if (p.klass[i] !== ParticleClass.Smoke) continue;
    p.velX[i] += accelX * dt;
  }
}
