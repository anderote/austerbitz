import type { Puffs } from './puffs';

/** Applies horizontal wind acceleration to alive puffs. The effect scales
 *  with size (bigger puffs catch more wind — merged smoke clouds drift
 *  noticeably more than tiny ones) and with age (1 − lifeRatio): fresh
 *  puffs carry their muzzle momentum so wind barely touches them, aged
 *  smoke streams sideways. Saturates at size ≈ 1.7 m. */
export function applyWindToPuffs(p: Puffs, accelX: number, dt: number): void {
  if (accelX === 0) return;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    const sizeFactor = Math.min(1.0, p.size[i]! * 0.6);
    const lifeRatio = p.lifeMax[i]! > 0 ? p.life[i]! / p.lifeMax[i]! : 0;
    const ageFactor = 1 - lifeRatio;
    p.velX[i] = p.velX[i]! + accelX * sizeFactor * ageFactor * dt;
  }
}

/** Stateful global wind. Each "epoch" runs for a random 15–45s with the wind
 *  smoothly easing from the previous direction to a freshly-picked target
 *  (always in the opposite half-plane, magnitude 0.6–1.0). Small flutter on
 *  top. Amplitude ≈ 6 m/s² peak — strong enough that aged clouds visibly
 *  stream sideways. */
import type { Rng } from '../util/rng';

export interface WindState {
  fromDir: number;
  toDir: number;
  epochStart: number;
  epochEnd: number;
}

export function createWindState(): WindState {
  return { fromDir: 0, toDir: 1, epochStart: 0, epochEnd: 20 };
}

const WIND_AMPLITUDE = 9.0;
const FLUTTER_AMP = 0.8;

export function tickWind(state: WindState, t: number, rng: Rng): void {
  if (t < state.epochEnd) return;
  state.fromDir = state.toDir;
  // Flip half-plane: pick a magnitude in [0.6, 1.0] with sign opposite to current.
  const sign = state.fromDir > 0 ? -1 : 1;
  state.toDir = sign * (0.6 + rng.next() * 0.4);
  state.epochStart = t;
  state.epochEnd = t + 15 + rng.next() * 30;
}

export function windAt(state: WindState, t: number): number {
  const dur = state.epochEnd - state.epochStart;
  const u = dur > 0 ? Math.min(1, Math.max(0, (t - state.epochStart) / dur)) : 1;
  // Smoothstep ease for gentle direction changes.
  const ease = u * u * (3 - 2 * u);
  const dir = state.fromDir * (1 - ease) + state.toDir * ease;
  const flutter = FLUTTER_AMP * Math.sin(t * 0.27 + 1.8);
  return WIND_AMPLITUDE * dir + flutter;
}
