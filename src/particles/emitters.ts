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

/**
 * Cartoon-violent blood spray at impact. Intensity scales count + size.
 *
 * If (dirX, dirY) is non-zero, the spray is biased into a ~120° cone pointing
 * the *same* way the projectile was traveling — i.e. blood erupts out the
 * back of the soldier (exit-wound side). If both are zero, falls back to a
 * 360° radial burst.
 */
export function spawnBlood(
  particles: Particles,
  x: number, y: number,
  intensity: number,
  rng: Rng,
  dirX: number = 0,
  dirY: number = 0,
): void {
  // Musket (~12 N·s) → 8; cannonball (~1500 N·s) → ~26; clamped to [8, 30].
  const raw = Math.round(8 + intensity * 0.012);
  const count = Math.max(8, Math.min(30, raw));

  const dirMag = Math.hypot(dirX, dirY);
  const directional = dirMag > 1e-6;
  const theta = directional ? Math.atan2(dirY, dirX) : 0;
  const halfCone = Math.PI * 0.55; // ~99° → 198° full cone (nearly half-circle splay)

  for (let i = 0; i < count; i++) {
    // ~25% of droplets are "big drops" — fatter, longer-lived. The mix between
    // big drops and small spatter is what gives the cartoon-comic look.
    const big = rng.next() < 0.25;
    const a = directional
      ? theta + rng.range(-halfCone, halfCone)
      : rng.range(0, Math.PI * 2);
    const s = rng.range(2.5, 6.5);
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: big ? rng.range(1.0, 1.4) : rng.range(0.5, 1.1),
      size: big ? rng.range(0.40, 0.60) : rng.range(0.20, 0.35),
      r: 0.45, g: 0.05, b: 0.05,
      drag: 0.92,
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

/**
 * Tiny gold particles drifting upward over ~0.4 s. Cute promotion effect.
 * Reuses ParticleClass.Flash so it draws additively over sprites.
 */
export function emitPromotionSparkle(
  particles: Particles,
  x: number,
  y: number,
  rng: Rng,
): void {
  const N = 6;
  for (let i = 0; i < N; i++) {
    // Upward cone: in this codebase world-y grows downward, so upward = velY < 0.
    // Angle range [-0.6π, -0.4π] keeps sin(angle) strictly negative → vy < 0.
    const angle = rng.range(-Math.PI * 0.6, -Math.PI * 0.4);
    const speed = rng.range(0.6, 1.4);
    spawnParticle(particles, {
      x: x + rng.range(-0.15, 0.15),
      y: y + rng.range(-0.15, 0.15),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: rng.range(0.3, 0.5),
      size: 0.08,
      r: 1.0, g: 0.84, b: 0.32,
      drag: 0.7,
      accelY: 0,
      sizeGrowth: -0.05,
      klass: ParticleClass.Flash,
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

