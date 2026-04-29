import { freeProjectile, ProjectileKind, type Projectiles } from '../projectiles';
import { isDead, type Entities } from '../entities';
import { gridSweptQuery, type Grid } from '../spatial/grid';
import type { Particles } from '../../particles/particles';
import type { Rng } from '../../util/rng';
import { applyHit } from './combat-events';
import type { BloodSplats } from '../blood-splats';
import type { Debris } from '../debris';
import type { Shockwaves } from '../../fx/shockwaves';
import type { ShakeRequests } from '../shake-requests';
import type { CraterSplats } from '../crater-splats';
import { pushSfxRequest, type SfxRequests } from '../sfx-requests';
import {
  emitImpactDust,
  emitRicochetBurst,
} from '../../particles/emitters';
import { emitPuff, emitPuffBurst } from '../../puffs/emit';
import type { Puffs } from '../../puffs/puffs';
import { CANNONBALL_TRAIL, CANNONBALL_TRAIL_INDEX } from '../../puffs/profiles/cannonball-trail';
import { DIRT_SKIP, DIRT_SKIP_INDEX } from '../../puffs/profiles/dirt-skip';
import { spawnExplosion } from '../../fx/explosion';
import { getUnitKindByIndex } from '../../data/units';
import { GAME_GRAVITY } from '../../fx/ballistics';
import { cannon12Shell } from '../../data/weapons/cannon-12-shell';

/** Half-width (m) of the per-entity body footprint used for swept-segment hits. */
export const PROJECTILE_HIT_RADIUS = 0.5;
const PROJECTILE_HIT_RADIUS_SQ = PROJECTILE_HIT_RADIUS * PROJECTILE_HIT_RADIUS;

/** Ground friction applied to a rolling solid shot (per-second). */
const GROUND_FRICTION = 1.5;
/** Speed (m/s) below which a rolling solid shot is freed. */
const ROLL_STOP_SPEED = 3;
const ROLL_STOP_SPEED_SQ = ROLL_STOP_SPEED * ROLL_STOP_SPEED;
/** Above this incoming angle (radians from horizontal) the ball plants instead of bouncing. */
const RICOCHET_PLANT_ANGLE_RAD = 35 * Math.PI / 180;
/** Restitution at a grazing impact (angle ≈ 0). */
const RICOCHET_REST_Z_GRAZE = 0.7;
/** Restitution at the plant threshold. */
const RICOCHET_REST_Z_STEEP = 0.15;
/** Horizontal damping at a grazing impact. */
const RICOCHET_DAMP_XY_GRAZE = 0.95;
/** Horizontal damping at the plant threshold. */
const RICOCHET_DAMP_XY_STEEP = 0.55;
/** Solid-shot damage falloff per entity it plows through. */
const SOLID_SHOT_DAMAGE_FALLOFF = 0.6;
/** Solid-shot velocity falloff per entity it plows through. */
const SOLID_SHOT_VELOCITY_FALLOFF = 0.85;
/** Solid-shot is freed once damage drops below this. */
const SOLID_SHOT_FREE_BELOW_DAMAGE = 5;

/**
 * Module-level scratch buffer for swept-grid candidate ids. `gridSweptQuery`
 * writes from index 0 each call and returns a count, so reuse across calls is
 * safe and avoids per-tick alloc. 1024 is generous: a single segment crossing
 * a tightly packed 2 m grid can't realistically yield more than a few hundred.
 */
const candidateBuf = new Int32Array(1024);

/**
 * Integrate, ground-collide, ricochet/roll, swept entity-collide, and emit
 * trails for every live projectile. Mirrors the per-tick algorithm in §3 of
 * the combat-effects design spec.
 */
export function tickProjectiles(
  projectiles: Projectiles,
  entities: Entities,
  grid: Grid,
  puffs: Puffs,
  particles: Particles,
  rng: Rng,
  shockwaves: Shockwaves,
  debris: Debris,
  dt: number,
  splats?: BloodSplats,
  shakeRequests?: ShakeRequests,
  craterSplats?: CraterSplats,
  sfxRequests?: SfxRequests,
): void {
  const p = projectiles;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;

    const kind = p.kind[i]! as ProjectileKind;

    // Spent solid shot: planted on the ground with no velocity. Skip all
    // simulation (gravity, collision, life decay) so the ball just sits
    // there for the rest of the session, still rendered by projectile-pass.
    if (
      kind === ProjectileKind.SolidShot
      && p.posZ[i]! === 0
      && p.velX[i]! === 0
      && p.velY[i]! === 0
      && p.velZ[i]! === 0
    ) {
      continue;
    }

    // 1. Snapshot prev pos and write it back into the SoA for renderers/tests.
    const pX0 = p.posX[i]!;
    const pY0 = p.posY[i]!;
    const pZ0 = p.posZ[i]!;
    p.prevX[i] = pX0;
    p.prevY[i] = pY0;

    // 2. Integrate XY position.
    p.posX[i] = pX0 + p.velX[i]! * dt;
    p.posY[i] = pY0 + p.velY[i]! * dt;

    // 3. Z integration (musket stays flat at posZ=0).
    if (kind !== ProjectileKind.Musket) {
      p.velZ[i] = p.velZ[i]! - GAME_GRAVITY * dt;
      p.posZ[i] = pZ0 + p.velZ[i]! * dt;
    }

    // 4. Shell fuse — detonate in flight when the timer expires.
    if (kind === ProjectileKind.Shell) {
      p.fuseT[i] = p.fuseT[i]! - dt;
      if (p.fuseT[i]! <= 0) {
        spawnExplosion(
          shockwaves,
          entities, grid, puffs, particles, rng,
          p.posX[i]!, p.posY[i]!,
          cannon12Shell.projectile.explosion!,
          undefined,                           // friendly-fire on: shells damage all teams in radius
          splats,
          debris,
          p.ownerId[i]!,
          shakeRequests,
          craterSplats,
          sfxRequests,
        );
        freeProjectile(p, i);
        continue;
      }
    }

    // 5. Ground impact. After step 3 posZ may have crossed zero; bounce, pin,
    // detonate, or kick up dust depending on kind.
    if (p.posZ[i]! <= 0 && p.velZ[i]! < 0) {
      if (kind === ProjectileKind.SolidShot) {
        // Angle-dependent bounce: shallow impacts skip with most energy
        // intact; steep impacts plant the ball. The `ricochets` counter
        // is a safety cap on consecutive skips.
        const speedXY = Math.hypot(p.velX[i]!, p.velY[i]!);
        const impactAngle = Math.atan2(-p.velZ[i]!, Math.max(speedXY, 1e-3));
        const planted = impactAngle >= RICOCHET_PLANT_ANGLE_RAD;
        if (!planted && p.ricochets[i]! > 0) {
          // Quality 1 at angle 0 (perfect graze), 0 at the plant threshold.
          const q = 1 - impactAngle / RICOCHET_PLANT_ANGLE_RAD;
          const restZ = RICOCHET_REST_Z_STEEP + (RICOCHET_REST_Z_GRAZE - RICOCHET_REST_Z_STEEP) * q;
          const dampXY = RICOCHET_DAMP_XY_STEEP + (RICOCHET_DAMP_XY_GRAZE - RICOCHET_DAMP_XY_STEEP) * q;
          p.posZ[i] = 0;
          p.velZ[i] = -restZ * p.velZ[i]!;
          p.velX[i] = p.velX[i]! * dampXY;
          p.velY[i] = p.velY[i]! * dampXY;
          p.ricochets[i] = p.ricochets[i]! - 1;
          const speedMag = Math.hypot(p.velX[i]!, p.velY[i]!);
          const dirX = speedMag > 1e-3 ? p.velX[i]! / speedMag : 1;
          const dirY = speedMag > 1e-3 ? p.velY[i]! / speedMag : 0;
          emitPuffBurst(
            puffs,
            DIRT_SKIP, DIRT_SKIP_INDEX,
            p.posX[i]!, p.posY[i]!,
            dirX, dirY,
            6,
            Math.PI / 3,
            { min: 3, max: 5 },
            rng,
          );
          emitRicochetBurst(particles, p.posX[i]!, p.posY[i]!, p.velX[i]!, p.velY[i]!, rng);
          if (sfxRequests) pushSfxRequest(sfxRequests, 'solid-skip', p.posX[i]!, p.posY[i]!);
        } else {
          // Pin to the ground; rolling proceeds in step 6 on subsequent ticks.
          p.posZ[i] = 0;
          p.velZ[i] = 0;
        }
      } else if (kind === ProjectileKind.Shell) {
        // Detonate at the impact point before clamping.
        spawnExplosion(
          shockwaves,
          entities, grid, puffs, particles, rng,
          p.prevX[i]!, p.prevY[i]!,
          cannon12Shell.projectile.explosion!,
          undefined,                           // friendly-fire on: shells damage all teams in radius
          splats,
          debris,
          p.ownerId[i]!,
          shakeRequests,
          craterSplats,
          sfxRequests,
        );
        freeProjectile(p, i);
        continue;
      } else {
        // Musket — flat-flight, but if it does hit the ground emit dust + free.
        emitImpactDust(particles, p.posX[i]!, p.posY[i]!, rng);
        freeProjectile(p, i);
        continue;
      }
    }

    // 6. Rolling — grounded solid shot decays horizontally and stops below
    // the threshold.
    if (
      kind === ProjectileKind.SolidShot &&
      p.posZ[i]! === 0 &&
      p.ricochets[i]! === 0
    ) {
      const fric = 1 - GROUND_FRICTION * dt;
      p.velX[i] = p.velX[i]! * fric;
      p.velY[i] = p.velY[i]! * fric;
      const vxR = p.velX[i]!;
      const vyR = p.velY[i]!;
      const speedSq = vxR * vxR + vyR * vyR;
      if (speedSq < ROLL_STOP_SPEED_SQ) {
        // Plant the ball at rest. Next tick the early-out skip kicks in
        // and the ball just sits there visually until the user resets.
        p.velX[i] = 0;
        p.velY[i] = 0;
        p.velZ[i] = 0;
        continue;
      }
    }

    // 7. Swept entity collision. Walk the grid cells the segment crosses, then
    // do per-candidate point-vs-segment + Z-range refinement.
    const nCandidates = gridSweptQuery(grid, p.prevX[i]!, p.prevY[i]!, p.posX[i]!, p.posY[i]!, candidateBuf);

    if (nCandidates > 0) {
      const ax = p.prevX[i]!;
      const ay = p.prevY[i]!;
      const bx = p.posX[i]!;
      const by = p.posY[i]!;
      const sdx = bx - ax;
      const sdy = by - ay;
      const segLenSq = sdx * sdx + sdy * sdy;
      const zMin = Math.min(pZ0, p.posZ[i]!);
      const zMax = Math.max(pZ0, p.posZ[i]!);

      let freed = false;
      for (let k = 0; k < nCandidates; k++) {
        const id = candidateBuf[k]!;
        if (entities.alive[id] === 0) continue;
        if (isDead(entities, id)) continue;
        if (entities.team[id] === p.team[i]) continue;

        // Point-vs-segment: project entity onto segment, clamp, distance.
        const ex = entities.posX[id]!;
        const ey = entities.posY[id]!;
        let t: number;
        if (segLenSq > 0) {
          t = ((ex - ax) * sdx + (ey - ay) * sdy) / segLenSq;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
        } else {
          t = 0;
        }
        const closestX = ax + t * sdx;
        const closestY = ay + t * sdy;
        const dCloseX = ex - closestX;
        const dCloseY = ey - closestY;
        const distSq = dCloseX * dCloseX + dCloseY * dCloseY;
        if (distSq > PROJECTILE_HIT_RADIUS_SQ) continue;

        // Z-range: tick range must overlap the entity's body height.
        const body = getUnitKindByIndex(entities.kindId[id]!).bodyZ;
        if (zMax < body.low || zMin > body.high) continue;

        // Hit confirmed — branch by kind.
        if (kind === ProjectileKind.Shell) {
          // Detonate at the candidate's xy; the explosion handles damage.
          spawnExplosion(
            shockwaves,
            entities, grid, puffs, particles, rng,
            ex, ey,
            cannon12Shell.projectile.explosion!,
            undefined,                           // friendly-fire on: shells damage all teams in radius
            splats,
            debris,
            p.ownerId[i]!,
            shakeRequests,
            craterSplats,
            sfxRequests,
          );
          freeProjectile(p, i);
          freed = true;
          break;
        }

        const impX = p.velX[i]! * p.mass[i]!;
        const impY = p.velY[i]! * p.mass[i]!;
        const hitKind = kind === ProjectileKind.Musket ? 'musket' : 'cannon';
        applyHit(entities, particles, rng, id, p.damage[i]!, impX, impY, hitKind, splats, debris, p.ownerId[i]!);

        if (kind === ProjectileKind.Musket) {
          freeProjectile(p, i);
          freed = true;
          break;
        }

        // SolidShot — bleed damage + velocity, free if too weak, else plow on.
        p.damage[i] = p.damage[i]! * SOLID_SHOT_DAMAGE_FALLOFF;
        p.velX[i] = p.velX[i]! * SOLID_SHOT_VELOCITY_FALLOFF;
        p.velY[i] = p.velY[i]! * SOLID_SHOT_VELOCITY_FALLOFF;
        if (p.damage[i]! < SOLID_SHOT_FREE_BELOW_DAMAGE) {
          freeProjectile(p, i);
          freed = true;
          break;
        }
        // continue inspecting next candidate
      }
      if (freed) continue;
    }

    // 8. Life timer.
    p.life[i] = p.life[i]! - dt;
    if (p.life[i]! <= 0) {
      freeProjectile(p, i);
      continue;
    }

    // 9. Trail — solid shots and shells drop an occasional wispy puff. Most
    // of the smoke comes from the muzzle spray at fire time; the trail just
    // adds a faint thread along the arc, not a continuous plume.
    if (kind === ProjectileKind.SolidShot || kind === ProjectileKind.Shell) {
      if (rng.next() < 0.12) {
        emitPuff(puffs, CANNONBALL_TRAIL, CANNONBALL_TRAIL_INDEX, p.posX[i]!, p.posY[i]!, 0, 0, rng);
      }
    }
  }
}
