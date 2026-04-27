import type { Rng } from '../util/rng';
import type { MuzzleProfile } from '../data/weapons/types';
import { ParticleClass, spawnParticle, type Particles } from './particles';

export function emitOrderPuff(particles: Particles, x: number, y: number): void {
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    const r = 0.3;
    spawnParticle(particles, {
      x: x + Math.cos(a) * r,
      y: y + Math.sin(a) * r,
      vx: Math.cos(a) * 0.6,
      vy: Math.sin(a) * 0.6,
      life: 0.35,
      size: 0.18,
      r: 0.8, g: 0.9, b: 1.0,
    });
  }
}

/** Emit muzzle flash particle at the barrel tip. Smoke is now handled by the
 *  puff system; callers also invoke emitPuffBurst with `profile.smoke`. */
export function emitMuzzleFx(
  particles: Particles,
  profile: MuzzleProfile,
  x: number, y: number,
  _dirX: number, _dirY: number,
  _rng: Rng,
): void {
  // Flash particle only — short-lived, snaps out via high drag.
  spawnParticle(particles, {
    x, y,
    vx: 0, vy: 0,
    life: profile.flash.life,
    size: profile.flash.size,
    r: profile.flash.color[0], g: profile.flash.color[1], b: profile.flash.color[2],
    drag: 0.6,
    accelY: 0,
    sizeGrowth: 0,
    klass: ParticleClass.Flash,
  });
}

/** Single dark-red burst at impact location. Intensity scales count + size. */
export function spawnBlood(
  particles: Particles,
  x: number, y: number,
  intensity: number,
  rng: Rng,
): void {
  // Musket (~12 N·s) → 4-5; cannonball (~1500 N·s) → ~12; clamped to [4, 14].
  const raw = Math.round(4 + intensity * 0.001);
  const count = Math.max(4, Math.min(14, raw));
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const s = rng.range(0.5, 2.0);
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rng.range(0.4, 0.8),
      size: rng.range(0.08, 0.2),
      r: 0.55, g: 0.05, b: 0.05,
      drag: 0.85,
      accelY: 0,
      sizeGrowth: 0,
      klass: ParticleClass.Blood,
    });
  }
}

/** Brown-tinted forward fan aligned with horizontal velocity (cannonball ricochet). */
export function emitRicochetBurst(
  particles: Particles,
  x: number, y: number,
  vx: number, vy: number,
  rng: Rng,
): void {
  const speed = Math.hypot(vx, vy);
  if (speed === 0) return;
  const dx = vx / speed;
  const dy = vy / speed;
  const theta = Math.atan2(dy, dx);
  const count = 12 + Math.floor(rng.next() * 7); // 12-18
  for (let i = 0; i < count; i++) {
    const delta = rng.range(-0.6, 0.6);
    const a = theta + delta;
    const s = rng.range(2.0, 6.0);
    // ~70% darker dirt, ~30% lighter dust.
    const lighter = rng.next() < 0.3;
    const r = lighter ? 0.65 : 0.45;
    const g = lighter ? 0.55 : 0.32;
    const b = lighter ? 0.42 : 0.22;
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rng.range(0.3, 0.7),
      size: rng.range(0.15, 0.35),
      r, g, b,
      drag: 0.92,
      accelY: 0,
      sizeGrowth: 0,
      klass: ParticleClass.Debris,
    });
  }
}

/** Small upward-kick dust puff for a musket ball that ran out of life on the ground. */
export function emitImpactDust(
  particles: Particles,
  x: number, y: number,
  rng: Rng,
): void {
  const count = 4 + Math.floor(rng.next() * 3); // 4-6
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const s = rng.range(0.3, 1.0);
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s + rng.range(0.5, 1.5),
      life: rng.range(0.5, 0.9),
      size: rng.range(0.15, 0.3),
      r: 0.65, g: 0.55, b: 0.42,
      drag: 0.92,
      accelY: 0,
      sizeGrowth: 0,
      klass: ParticleClass.Dust,
    });
  }
}

