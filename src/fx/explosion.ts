import type { Entities } from '../sim/entities';
import { type Grid, gridQueryRadius } from '../sim/spatial/grid';
import { ParticleClass, spawnParticle, type Particles } from '../particles/particles';
import type { Rng } from '../util/rng';
import type { ExplosionProfile } from '../data/weapons/types';
import { applyHit } from '../sim/systems/combat-events';

/**
 * Detonate an explosion at (x, y): one bright flash, a billowing smoke spray,
 * a debris fan, and area damage + impulse to entities inside `damageRadius`.
 *
 * `gridQueryRadius` returns AABB candidates, so the per-id pass re-tests the
 * true circular distance and skips anything outside it.
 *
 * If `excludeTeam` is set, entities of that team are not damaged (used to gate
 * friendly-fire on by team rather than per-shot caller logic).
 */
export function spawnExplosion(
  entities: Entities,
  grid: Grid,
  particles: Particles,
  rng: Rng,
  x: number,
  y: number,
  profile: ExplosionProfile,
  excludeTeam?: number,
): void {
  // 1. Flash — one bright additive particle at the centre, snaps out via high drag.
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

  // 2. Smoke billow — radial spray of mid-grey particles that linger and grow.
  const smoke = profile.smokeBillow;
  for (let i = 0; i < smoke.count; i++) {
    const angle = rng.next() * Math.PI * 2;
    const speed = rng.range(smoke.speedMin, smoke.speedMax);
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: rng.range(smoke.lifeMin, smoke.lifeMax),
      size: smoke.sizeStart,
      r: 0.6, g: 0.6, b: 0.62,
      drag: smoke.drag,
      accelY: smoke.upwardDrift,
      sizeGrowth: smoke.sizeGrowth,
      klass: ParticleClass.Smoke,
    });
  }

  // 3. Debris — fast, short-lived brown-grey fan.
  const debris = profile.debris;
  for (let i = 0; i < debris.count; i++) {
    const angle = rng.next() * Math.PI * 2;
    const speed = rng.range(debris.speedMin, debris.speedMax);
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: debris.life,
      size: debris.size,
      r: 0.55, g: 0.45, b: 0.32,
      drag: 0.92,
      accelY: 0,
      sizeGrowth: 0,
      klass: ParticleClass.Debris,
    });
  }

  // 4. Area damage + impulse — AABB candidates, then circle test, then applyHit.
  const radius = profile.damageRadius;
  const ids = gridQueryRadius(grid, x, y, radius);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    if (entities.alive[id] === 0) continue;
    if (excludeTeam !== undefined && entities.team[id] === excludeTeam) continue;

    const dx = entities.posX[id]! - x;
    const dy = entities.posY[id]! - y;
    const dist = Math.hypot(dx, dy);
    if (dist > radius) continue;

    const falloff = 1 - dist / radius;
    const dirX = dist > 0 ? dx / dist : 0;
    const dirY = dist > 0 ? dy / dist : 0;

    applyHit(
      entities,
      particles,
      rng,
      id,
      profile.damage * falloff,
      dirX * profile.impulse * falloff,
      dirY * profile.impulse * falloff,
      'explosion',
    );
  }
}
