import type { Entities } from '../sim/entities';
import type { Grid } from '../sim/spatial/grid';
import { ParticleClass, spawnParticle, type Particles } from '../particles/particles';
import type { Rng } from '../util/rng';
import type { ExplosionProfile } from '../data/weapons/types';
import type { BloodSplats } from '../sim/blood-splats';
import { pushCraterSplat, type CraterSplats } from '../sim/crater-splats';
import type { Debris } from '../sim/debris';
import type { Puffs } from '../puffs/puffs';
import { emitPuffBurst } from '../puffs/emit';
import { allocShockwave, type Shockwaves } from './shockwaves';
import { pushShakeRequest, type ShakeRequests } from '../sim/shake-requests';
import { pushSfxRequest, type SfxRequests } from '../sim/sfx-requests';

const RING_COUNT = 2;
const RING_BIRTH_OFFSETS = [0, 0.08] as const;  // seconds; staggered for layered feel
const EMBER_COUNT = 20;
const WAVE_SPEED = 120;                          // m/s

/**
 * Detonate an explosion at (x, y): instant visuals (flash, rings, smoke billow,
 * debris fan, embers) plus a shockwave record advanced by shockwave-system.
 * Damage is no longer applied here — see updateShockwaves().
 *
 * `_entities`, `_grid`, `_splats`, `_debris` are kept in the signature for
 * callers' convenience and possible future use (decals, etc.); the shockwave
 * system reads them when it delivers damage on subsequent ticks.
 */
export function spawnExplosion(
  shockwaves: Shockwaves,
  _entities: Entities,
  _grid: Grid,
  puffs: Puffs,
  particles: Particles,
  rng: Rng,
  x: number,
  y: number,
  profile: ExplosionProfile,
  excludeTeam: number | undefined,
  _splats: BloodSplats | undefined,
  _debris: Debris,
  attackerId: number,
  shakeRequests?: ShakeRequests,
  craterSplats?: CraterSplats,
  sfxRequests?: SfxRequests,
): void {
  // 1. Center flash.
  spawnParticle(particles, {
    x, y, vx: 0, vy: 0,
    life: profile.flash.life,
    size: profile.flash.size,
    r: profile.flash.color[0]!, g: profile.flash.color[1]!, b: profile.flash.color[2]!,
    drag: 0.6, accelY: 0, sizeGrowth: 0,
    klass: ParticleClass.Flash,
  });

  // 2. Concentric rings — expanding annulus shells rendered by the dedicated ring-pass.
  for (let i = 0; i < RING_COUNT; i++) {
    spawnParticle(particles, {
      x, y, vx: 0, vy: 0,
      life: profile.flash.life * 1.6 + RING_BIRTH_OFFSETS[i]!,
      size: profile.flash.size * 0.5,
      r: profile.flash.color[0]! * 0.85,
      g: profile.flash.color[1]! * 0.85,
      b: profile.flash.color[2]! * 0.85,
      drag: 0,
      accelY: 0,
      sizeGrowth: profile.damageRadius * 4,
      klass: ParticleClass.Ring,
    });
  }

  // 3. Smoke billow.
  const sb = profile.smokeBillow;
  emitPuffBurst(puffs, sb.profile, sb.profileIdx, x, y, 1, 0,
                sb.count, Math.PI * 2, sb.speed, rng);

  // 4. Debris fan.
  const dp = profile.debris;
  for (let i = 0; i < dp.count; i++) {
    const angle = rng.next() * Math.PI * 2;
    const speed = rng.range(dp.speedMin, dp.speedMax);
    spawnParticle(particles, {
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: dp.life, size: dp.size,
      r: 0.55, g: 0.45, b: 0.32,
      drag: 0.92, accelY: 0, sizeGrowth: 0,
      klass: ParticleClass.Debris,
    });
  }

  // 5. Embers — small warm additive sparks.
  for (let i = 0; i < EMBER_COUNT; i++) {
    const angle = rng.next() * Math.PI * 2;
    const speed = rng.range(2, 5);
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rng.range(1, 2),
      life: rng.range(0.6, 1.2),
      size: rng.range(0.15, 0.3),
      r: 1.0, g: rng.range(0.5, 0.8), b: rng.range(0.05, 0.2),
      drag: 0.85,
      accelY: -2,
      sizeGrowth: -0.5,
      klass: ParticleClass.Ember,
    });
  }

  // 6. Camera shake — magnitude proportional to damage radius; 0.1 m per m of blast.
  if (shakeRequests) {
    const mag = 0.1 * profile.damageRadius;
    pushShakeRequest(shakeRequests, x, y, mag, 0.4);
  }

  // 7. Crater stain — persistent charred ground mark baked into the stain texture.
  if (craterSplats) {
    pushCraterSplat(craterSplats, x, y, profile.damageRadius * 0.7, 0.85);
  }

  // 8. Sfx request — queued for the render loop to play after the frame.
  if (sfxRequests) pushSfxRequest(sfxRequests, 'shell-detonate', x, y);

  // 9. Shockwave record — damage delivered over the next ~50ms by shockwave-system.
  const w = allocShockwave(shockwaves);
  if (w === -1) return;
  shockwaves.x[w] = x;
  shockwaves.y[w] = y;
  shockwaves.fullRadius[w] = profile.damageRadius;
  shockwaves.waveSpeed[w] = WAVE_SPEED;
  shockwaves.damage[w] = profile.damage;
  shockwaves.impulse[w] = profile.impulse;
  shockwaves.excludeTeam[w] = excludeTeam ?? -1;
  shockwaves.attackerId[w] = attackerId;
}
