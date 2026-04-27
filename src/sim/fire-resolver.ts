import type { Entities } from './entities';
import {
  spawnMusketBall,
  spawnSolidShot,
  spawnShell,
  type Projectiles,
} from './projectiles';
import type { Particles } from '../particles/particles';
import { emitMuzzleFx } from '../particles/emitters';
import type { Rng } from '../util/rng';
import { barrelTip } from '../fx/barrel';
import { solveCannonLaunch } from '../fx/ballistics';
import { getUnitKindByIndex } from '../data/units';

/**
 * Total duration of the visual recoil animation in seconds. The render-side
 * offset traces a three-phase curve over this window: a quick decelerating
 * push out (RECOIL_PUSH_END), a brief hold at peak (until RECOIL_HOLD_END),
 * and a slow ease back to the anchor.
 */
export const RECOIL_T = 0.9;
/** Fraction of `RECOIL_T` spent on the outward push (ease-out cubic). */
export const RECOIL_PUSH_END = 0.15;
/** Fraction of `RECOIL_T` at which the hold ends and the return begins. */
export const RECOIL_HOLD_END = 0.3;

/**
 * Pure resolver: turn "entity `id` is firing at (targetX, targetY)" into a
 * concrete projectile spawn + muzzle FX. Applies firer recoil. Returns true
 * iff a shot was actually spawned (false on no-weapon, zero range, or
 * out-of-range arc).
 */
export function resolveFire(
  e: Entities,
  projectiles: Projectiles,
  particles: Particles,
  rng: Rng,
  id: number,
  targetX: number,
  targetY: number,
): boolean {
  const kind = getUnitKindByIndex(e.kindId[id]!);
  const weapon = kind.weapon;
  if (!weapon) return false;

  const tip = barrelTip(e, id);
  const team = e.team[id]!;

  if (weapon.kind === 'musket') {
    const dx = targetX - tip.x;
    const dy = targetY - tip.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) return false;

    let dirX = dx / d;
    let dirY = dy / d;

    const spreadRad = weapon.projectile.accuracySpreadRad;
    if (spreadRad) {
      const spread = (rng.next() - 0.5) * 2 * spreadRad;
      const cs = Math.cos(spread);
      const sn = Math.sin(spread);
      const rx = dirX * cs - dirY * sn;
      const ry = dirX * sn + dirY * cs;
      dirX = rx;
      dirY = ry;
    }

    spawnMusketBall(
      projectiles,
      tip.x, tip.y,
      dirX, dirY,
      team,
      weapon.projectile.damage,
      weapon.projectile.muzzleVelocity,
      weapon.projectile.mass,
      weapon.projectile.maxLife,
    );

    if (weapon.muzzle) {
      emitMuzzleFx(particles, weapon.muzzle, tip.x, tip.y, dirX, dirY, rng);
    }

    e.recoilT[id] = RECOIL_T;
    if (weapon.muzzle?.recoilFirer) {
      e.recoilPeakX[id] = -dirX * weapon.muzzle.recoilFirer;
      e.recoilPeakY[id] = -dirY * weapon.muzzle.recoilFirer;
    } else {
      e.recoilPeakX[id] = 0;
      e.recoilPeakY[id] = 0;
    }
    return true;
  }

  if (weapon.kind === 'solid-shot' || weapon.kind === 'shell') {
    const launchHeight = weapon.projectile.launchHeight ?? 0;
    const launch = solveCannonLaunch(
      tip.x, tip.y,
      targetX, targetY,
      weapon.projectile.muzzleVelocity,
    );
    if (launch === null) return false;

    if (weapon.kind === 'solid-shot') {
      spawnSolidShot(
        projectiles,
        tip.x, tip.y, launchHeight,
        launch.vx, launch.vy, launch.vz,
        team,
        weapon.projectile.damage,
        weapon.projectile.mass,
        weapon.projectile.maxLife,
        weapon.projectile.ricochetCount ?? 0,
      );
    } else {
      spawnShell(
        projectiles,
        tip.x, tip.y, launchHeight,
        launch.vx, launch.vy, launch.vz,
        team,
        weapon.projectile.damage,
        weapon.projectile.mass,
        weapon.projectile.maxLife,
        weapon.projectile.fuse ?? 1.5,
      );
    }

    // Direction for muzzle FX + recoil. Prefer launch xy direction; fall
    // back to facing if the launch had no horizontal component (degenerate
    // self-target).
    let dirX = tip.dirX;
    let dirY = tip.dirY;
    const dirSpeed = Math.hypot(launch.vx, launch.vy);
    if (dirSpeed > 0) {
      dirX = launch.vx / dirSpeed;
      dirY = launch.vy / dirSpeed;
    }

    if (weapon.muzzle) {
      emitMuzzleFx(particles, weapon.muzzle, tip.x, tip.y, dirX, dirY, rng);
    }

    e.recoilT[id] = RECOIL_T;
    if (weapon.muzzle?.recoilFirer) {
      e.recoilPeakX[id] = -dirX * weapon.muzzle.recoilFirer;
      e.recoilPeakY[id] = -dirY * weapon.muzzle.recoilFirer;
    } else {
      e.recoilPeakX[id] = 0;
      e.recoilPeakY[id] = 0;
    }
    return true;
  }

  return false;
}
