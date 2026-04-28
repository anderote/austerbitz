/**
 * Per-frame queue of camera-shake requests pushed by the sim (e.g. explosions).
 * Drained each frame by the renderer, which attenuates by camera distance and
 * feeds the result into the render-side CameraShake accumulator.
 * Mirrors the blood-splats queue pattern.
 */
export interface ShakeRequests {
  capacity: number;
  count: number;
  x: Float32Array;
  y: Float32Array;
  magnitude: Float32Array;
  duration: Float32Array;
}

export function createShakeRequests(capacity: number): ShakeRequests {
  return {
    capacity,
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    magnitude: new Float32Array(capacity),
    duration: new Float32Array(capacity),
  };
}

export function pushShakeRequest(
  s: ShakeRequests,
  x: number,
  y: number,
  magnitude: number,
  duration: number,
): void {
  if (s.count >= s.capacity) return;
  const i = s.count;
  s.x[i] = x;
  s.y[i] = y;
  s.magnitude[i] = magnitude;
  s.duration[i] = duration;
  s.count++;
}

export function clearShakeRequests(s: ShakeRequests): void {
  s.count = 0;
}
