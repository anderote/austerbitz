import { ParticleClass, type Particles } from '../particles/particles';

// Dust is heavier and lower than smoke, so it drifts more sluggishly.
const DUST_WIND_FACTOR = 0.35;

/**
 * Adds a horizontal acceleration to alive smoke and dust particles.
 *
 * Smoke takes the full accel; dust takes a damped fraction so heavy ground
 * clouds drift gently rather than streak. Flash, blood, and debris are left
 * alone so impact bursts and muzzle flashes stay crisp.
 */
export function applyWind(particles: Particles, accelX: number, dt: number): void {
  if (accelX === 0) return;
  const p = particles;
  const smokeDelta = accelX * dt;
  const dustDelta = accelX * DUST_WIND_FACTOR * dt;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    const k = p.klass[i];
    if (k === ParticleClass.Smoke) p.velX[i] += smokeDelta;
    else if (k === ParticleClass.Dust) p.velX[i] += dustDelta;
  }
}
