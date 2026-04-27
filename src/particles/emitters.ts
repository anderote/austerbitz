import type { World } from '../sim/world';
import type { Rng } from '../util/rng';
import type { MuzzleProfile } from '../data/weapons/types';
import { ParticleClass, spawnParticle, type Particles } from './particles';

const DUST_PER_SEC = 1.2;     // particles per moving unit per second

// Coalescence: when many soldiers march in the same area, new dust emissions
// merge into the nearest existing dust puff rather than spawning a new one.
// The result is a single growing, longer-lived cloud per cluster of marchers.
const DUST_MERGE_RADIUS = 1.6;
const DUST_MERGE_RADIUS_SQ = DUST_MERGE_RADIUS * DUST_MERGE_RADIUS;
const DUST_CELL = DUST_MERGE_RADIUS;
const DUST_MAX_SIZE = 0.85;
const DUST_MAX_LIFE = 18.0;
const DUST_SIZE_PER_MERGE = 0.08;
const DUST_LIFE_PER_MERGE = 0.7;

function dustCellKey(cx: number, cy: number): number {
  // Small risk of collisions across distant cells, but the radius check below
  // rejects any false neighbors — collisions only cost a few extra comparisons.
  return (cx * 73856093) ^ (cy * 19349663);
}

export function emitDust(world: World, particles: Particles, dt: number): void {
  const e = world.entities;
  const expected = DUST_PER_SEC * dt;

  // One-shot spatial hash of alive Dust particles for this frame's emissions.
  const grid = new Map<number, number[]>();
  for (let p = 0; p < particles.capacity; p++) {
    if (particles.alive[p] === 0) continue;
    if (particles.klass[p] !== ParticleClass.Dust) continue;
    const cx = Math.floor(particles.posX[p]! / DUST_CELL);
    const cy = Math.floor(particles.posY[p]! / DUST_CELL);
    const key = dustCellKey(cx, cy);
    let bucket = grid.get(key);
    if (bucket === undefined) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(p);
  }

  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    const vx = e.velX[i]!;
    const vy = e.velY[i]!;
    if (vx === 0 && vy === 0) continue;
    if (world.rng.next() > expected) continue;
    const speed = Math.hypot(vx, vy);
    const invSpeed = speed > 0 ? 1 / speed : 0;
    const dirX = vx * invSpeed;
    const dirY = vy * invSpeed;
    const jitter = () => world.rng.range(-0.4, 0.4);
    // Anchor at the soldier's feet (sprite is centered, so south-of-anchor).
    const fx = e.posX[i]! + jitter();
    const fy = e.posY[i]! + jitter() + 0.5;

    // Find the nearest alive dust within DUST_MERGE_RADIUS; if any, accrete.
    const cx = Math.floor(fx / DUST_CELL);
    const cy = Math.floor(fy / DUST_CELL);
    let mergeIdx = -1;
    let bestSq = DUST_MERGE_RADIUS_SQ;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(dustCellKey(cx + dx, cy + dy));
        if (bucket === undefined) continue;
        for (let b = 0; b < bucket.length; b++) {
          const idx = bucket[b]!;
          const ddx = particles.posX[idx]! - fx;
          const ddy = particles.posY[idx]! - fy;
          const dsq = ddx * ddx + ddy * ddy;
          if (dsq < bestSq) {
            bestSq = dsq;
            mergeIdx = idx;
          }
        }
      }
    }

    if (mergeIdx >= 0) {
      // Grow + refresh; cap so a column doesn't produce an infinite blob.
      const grown = particles.size[mergeIdx]! + DUST_SIZE_PER_MERGE;
      particles.size[mergeIdx] = grown > DUST_MAX_SIZE ? DUST_MAX_SIZE : grown;
      const refreshed = particles.life[mergeIdx]! + DUST_LIFE_PER_MERGE;
      const cappedLife = refreshed > DUST_MAX_LIFE ? DUST_MAX_LIFE : refreshed;
      particles.life[mergeIdx] = cappedLife;
      // Keep alpha (life/lifeMax) bounded in [0,1] for the renderer.
      if (cappedLife > particles.lifeMax[mergeIdx]!) particles.lifeMax[mergeIdx] = cappedLife;
      // Drift the cloud's center toward the new emission so it trails the column.
      particles.posX[mergeIdx] = particles.posX[mergeIdx]! * 0.7 + fx * 0.3;
      particles.posY[mergeIdx] = particles.posY[mergeIdx]! * 0.7 + fy * 0.3;
      continue;
    }

    const newIdx = spawnParticle(particles, {
      x: fx,
      y: fy,
      // Drift backward (opposite to motion) and gently upward (negative Y).
      vx: -dirX * 0.16 + jitter() * 0.18,
      vy: -dirY * 0.16 - world.rng.range(0.18, 0.4),
      life: 3.5 + world.rng.next() * 2.5,
      size: 0.3 + Math.min(speed * 0.04, 0.25),
      r: 0.30, g: 0.30, b: 0.34,
      drag: 0.985,
      accelY: -0.1,
      sizeGrowth: 0.5,
      klass: ParticleClass.Dust,
    });
    // Add to the grid so later emissions in the same frame can coalesce too.
    if (newIdx >= 0) {
      const ncx = Math.floor(particles.posX[newIdx]! / DUST_CELL);
      const ncy = Math.floor(particles.posY[newIdx]! / DUST_CELL);
      const nkey = dustCellKey(ncx, ncy);
      let bucket = grid.get(nkey);
      if (bucket === undefined) {
        bucket = [];
        grid.set(nkey, bucket);
      }
      bucket.push(newIdx);
    }
  }
}

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

/** Emit muzzle flash + smoke puff in the forward cone of (dirX, dirY). */
export function emitMuzzleFx(
  particles: Particles,
  profile: MuzzleProfile,
  x: number, y: number,
  dirX: number, dirY: number,
  rng: Rng,
): void {
  // Single flash particle at origin — short-lived, snaps out via high drag.
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

  // Smoke puff in a forward cone aligned with (dirX, dirY).
  const theta = Math.atan2(dirY, dirX);
  const halfCone = profile.smoke.coneAngle / 2;
  const { count, speed, life, sizeStart, sizeGrowth, drag, upwardDrift, color } = profile.smoke;
  for (let i = 0; i < count; i++) {
    const delta = rng.range(-halfCone, halfCone);
    const s = rng.range(speed.min, speed.max);
    const a = theta + delta;
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rng.range(life.min, life.max),
      size: sizeStart,
      r: color[0], g: color[1], b: color[2],
      drag,
      accelY: upwardDrift,
      sizeGrowth,
      klass: ParticleClass.Smoke,
    });
  }
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

/** Single smoke trail particle — call once per tick from the cannonball's current pos. */
export function emitCannonballTrail(
  particles: Particles,
  x: number, y: number,
  rng: Rng,
): void {
  spawnParticle(particles, {
    x, y,
    vx: rng.range(-0.5, 0.5),
    vy: rng.range(-0.5, 0.5),
    life: rng.range(0.5, 1.0),
    size: 0.4,
    r: 0.7, g: 0.7, b: 0.72,
    drag: 0.97,
    accelY: 0.6,
    sizeGrowth: 1.2,
    klass: ParticleClass.Smoke,
  });
}
