import type { Puffs } from './puffs';

/** Applies wind acceleration to alive puffs. The effect scales with size
 *  (bigger puffs catch more wind — merged smoke clouds drift noticeably
 *  more than tiny ones) and with age (1 − lifeRatio): fresh puffs carry
 *  their muzzle momentum so wind barely touches them, aged smoke streams
 *  sideways. Saturates at size ≈ 1.7 m. */
export function applyWindToPuffs(p: Puffs, accelX: number, accelY: number, dt: number): void {
  if (accelX === 0 && accelY === 0) return;
  for (let n = 0; n < p.count; n++) {
    const i = p.aliveIds[n]!;
    const sizeFactor = Math.min(1.0, p.size[i]! * 0.6);
    const lifeRatio = p.lifeMax[i]! > 0 ? p.life[i]! / p.lifeMax[i]! : 0;
    const ageFactor = 1 - lifeRatio;
    const k = sizeFactor * ageFactor * dt;
    p.velX[i] = p.velX[i]! + accelX * k;
    p.velY[i] = p.velY[i]! + accelY * k;
  }
}

/** Stateful global wind. Each "epoch" runs for a random 20–50s with the wind
 *  smoothly easing from the previous angle/magnitude to a fresh target.
 *  Angle drifts as a random walk (delta ≤ ±π/2 per epoch) so wind can
 *  reach any compass direction over time; magnitude varies in [0.6, 1.0].
 *  Small flutter modulates magnitude. Amplitude ≈ 9 m/s² peak. */
import type { Rng } from '../util/rng';

export interface WindState {
  fromAngle: number;
  toAngle: number;
  fromMag: number;
  toMag: number;
  epochStart: number;
  epochEnd: number;
}

export function createWindState(): WindState {
  return { fromAngle: 0, toAngle: 0, fromMag: 0.7, toMag: 0.8, epochStart: 0, epochEnd: 25 };
}

const WIND_AMPLITUDE = 9.0;
const FLUTTER_AMP = 0.8;

export function tickWind(state: WindState, t: number, rng: Rng): void {
  if (t < state.epochEnd) return;
  state.fromAngle = state.toAngle;
  state.fromMag = state.toMag;
  // Random walk in angle: drift up to ±π/2 each epoch. No wrapping — cos/sin handle it.
  state.toAngle = state.fromAngle + (rng.next() - 0.5) * Math.PI;
  state.toMag = 0.6 + rng.next() * 0.4;
  state.epochStart = t;
  state.epochEnd = t + 20 + rng.next() * 30;
}

export function windAt(state: WindState, t: number): { x: number; y: number } {
  const dur = state.epochEnd - state.epochStart;
  const u = dur > 0 ? Math.min(1, Math.max(0, (t - state.epochStart) / dur)) : 1;
  // Smoothstep ease for gentle transitions.
  const ease = u * u * (3 - 2 * u);
  const angle = state.fromAngle + (state.toAngle - state.fromAngle) * ease;
  const mag = state.fromMag * (1 - ease) + state.toMag * ease;
  const flutter = FLUTTER_AMP * Math.sin(t * 0.27 + 1.8);
  const r = WIND_AMPLITUDE * mag + flutter;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}
