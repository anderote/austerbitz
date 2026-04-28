import { isDead, type Entities } from '../sim/entities';
import { type Grid, gridQueryRadius } from '../sim/spatial/grid';
import { ParticleClass, spawnParticle, type Particles } from '../particles/particles';
import type { Rng } from '../util/rng';
import type { ExplosionProfile } from '../data/weapons/types';
import { applyHit } from '../sim/systems/combat-events';
import type { BloodSplats } from '../sim/blood-splats';
import type { Debris } from '../sim/debris';
import type { Puffs } from '../puffs/puffs';
import { emitPuffBurst } from '../puffs/emit';

const EXPLOSION_BUF = new Int32Array(2048);

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
  puffs: Puffs,
  particles: Particles,
  rng: Rng,
  x: number,
  y: number,
  profile: ExplosionProfile,
  excludeTeam: number | undefined,
  splats: BloodSplats | undefined,
  debris: Debris,
  attackerId: number,
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

  // 2. Smoke billow — full-radius puff burst (handled by puff pass with soft falloff).
  const sb = profile.smokeBillow;
  emitPuffBurst(
    puffs,
    sb.profile,
    sb.profileIdx,
    x, y,
    1, 0,                 // dirX/dirY arbitrary; coneAngle = 2π gives full radial fan
    sb.count,
    Math.PI * 2,
    sb.speed,
    rng,
  );

  // 3. Debris — fast, short-lived brown-grey fan.
  const debrisParticleCfg = profile.debris;
  for (let i = 0; i < debrisParticleCfg.count; i++) {
    const angle = rng.next() * Math.PI * 2;
    const speed = rng.range(debrisParticleCfg.speedMin, debrisParticleCfg.speedMax);
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: debrisParticleCfg.life,
      size: debrisParticleCfg.size,
      r: 0.55, g: 0.45, b: 0.32,
      drag: 0.92,
      accelY: 0,
      sizeGrowth: 0,
      klass: ParticleClass.Debris,
    });
  }

  // 4. Area damage + impulse — AABB candidates, then circle test, then applyHit.
  const radius = profile.damageRadius;
  const nIds = gridQueryRadius(grid, x, y, radius, EXPLOSION_BUF);
  for (let i = 0; i < nIds; i++) {
    const id = EXPLOSION_BUF[i]!;
    if (entities.alive[id] === 0) continue;
    if (isDead(entities, id)) continue;
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
      splats,
      debris,
      attackerId,
    );
  }
}
