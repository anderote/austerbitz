import type { Rng } from '../util/rng';

export const MAX_SHAKE = 1.5;     // world units (meters)

export interface CameraShake {
  magnitude: number;
  duration: number;
  total: number;
}

export function createCameraShake(): CameraShake {
  return { magnitude: 0, duration: 0, total: 0 };
}

/**
 * Accumulate a new shake impulse into the existing state.
 * Magnitude is additive (clamped to MAX_SHAKE); duration takes the maximum
 * of the incoming and remaining so a fresh hit never shortens an ongoing shake.
 */
export function kickShake(s: CameraShake, magnitude: number, duration: number): void {
  s.magnitude = Math.min(MAX_SHAKE, s.magnitude + magnitude);
  s.duration = Math.max(s.duration, duration);
  s.total = Math.max(s.total, duration);
}

/** Advance the shake timer by dt seconds. Clears state when duration expires. */
export function advanceShake(s: CameraShake, dt: number): void {
  if (s.duration <= 0) return;
  s.duration -= dt;
  if (s.duration <= 0) {
    s.duration = 0;
    s.magnitude = 0;
    s.total = 0;
  }
}

/**
 * Compute the per-frame jitter offset. Amplitude decays quadratically from
 * full magnitude at t=1 (fresh) to zero at t=0 (expired).
 * Returns { x: 0, y: 0 } when shake is inactive.
 */
export function currentOffset(s: CameraShake, rng: Rng): { x: number; y: number } {
  if (s.duration <= 0 || s.total <= 0) return { x: 0, y: 0 };
  const t = s.duration / s.total;       // 1 → 0
  const amp = s.magnitude * t * t;
  return {
    x: (rng.next() * 2 - 1) * amp,
    y: (rng.next() * 2 - 1) * amp,
  };
}
