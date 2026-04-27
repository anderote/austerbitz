import type { World } from '../sim/world';
import type { Projectiles } from '../sim/projectiles';
import type { Particles } from '../particles/particles';
import type { Puffs } from '../puffs/puffs';
import { emitPuffBurst } from '../puffs/emit';
import type { Rng } from '../util/rng';
import type { Stage } from './stage';
import { EntityState } from '../sim/entities';
import { triggerFire, type FireOrders } from '../sim/systems/state-system';
import { applyHit } from '../sim/systems/combat-events';
import { resolveFire, RECOIL_T } from '../sim/fire-resolver';
import { spawnShell } from '../sim/projectiles';
import { barrelTip } from '../fx/barrel';
import { solveCannonLaunch } from '../fx/ballistics';
import { emitMuzzleFx } from '../particles/emitters';
import { getUnitKindByIndex } from '../data/units';
import { cannon12Shell } from '../data/weapons/cannon-12-shell';
import { writeFacingIntent } from '../sim/systems/facing-system';

const DUMMY_ROW_X = 30;
const DUMMY_ROW_Y = 0;

/** facing 0..7 → unit vector (CCW from east). */
function facingDir(facing: number): { x: number; y: number } {
  const theta = (facing * Math.PI) / 4;
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

function subject(world: World, stage: Stage): number | null {
  const id = stage.subjectId;
  if (id === null) return null;
  if (world.entities.alive[id] !== 1) return null;
  return id;
}

export function actMarch(world: World, stage: Stage): void {
  const id = subject(world, stage);
  if (id === null) return;
  const kind = getUnitKindByIndex(world.entities.kindId[id]!);
  const dir = facingDir(world.entities.facing[id]!);
  world.entities.velX[id] = dir.x * kind.baseStats.moveSpeed;
  world.entities.velY[id] = dir.y * kind.baseStats.moveSpeed;
  writeFacingIntent(world.entities, id, dir.x, dir.y);
  world.entities.state[id] = EntityState.Moving;
}

export function actHalt(world: World, stage: Stage): void {
  const id = subject(world, stage);
  if (id === null) return;
  world.entities.velX[id] = 0;
  world.entities.velY[id] = 0;
  if (world.entities.state[id] === EntityState.Moving) {
    world.entities.state[id] = EntityState.Idle;
  }
}

export function actFaceL(world: World, stage: Stage): void {
  const id = subject(world, stage);
  if (id === null) return;
  world.entities.facing[id] = 4; // west
  world.entities.facingIntentX[id] = -1;
  world.entities.facingIntentY[id] = 0;
}

export function actFaceR(world: World, stage: Stage): void {
  const id = subject(world, stage);
  if (id === null) return;
  world.entities.facing[id] = 0; // east
  world.entities.facingIntentX[id] = 1;
  world.entities.facingIntentY[id] = 0;
}

export function actFire(world: World, fireOrders: FireOrders, stage: Stage): void {
  const id = subject(world, stage);
  if (id === null) return;
  const kind = getUnitKindByIndex(world.entities.kindId[id]!);
  if (!kind.weapon) return;
  // Manual fire always re-triggers — even mid-reload — so the lab can rapid-fire
  // for inspection. Auto-fire callers gate on Idle themselves to avoid stomping.
  triggerFire(world.entities, fireOrders, id, DUMMY_ROW_X, DUMMY_ROW_Y);
  writeFacingIntent(world.entities, id, DUMMY_ROW_X - world.entities.posX[id]!, DUMMY_ROW_Y - world.entities.posY[id]!);
}

export function actReload(world: World, stage: Stage): void {
  const id = subject(world, stage);
  if (id === null) return;
  const kind = getUnitKindByIndex(world.entities.kindId[id]!);
  if (!kind.weapon) return;
  world.entities.state[id] = EntityState.Reloading;
  world.entities.reloadT[id] = kind.baseStats.weaponReload;
}

export function actSolidShot(
  world: World,
  projectiles: Projectiles,
  particles: Particles,
  puffs: Puffs,
  stage: Stage,
): void {
  const id = subject(world, stage);
  if (id === null) return;
  const kind = getUnitKindByIndex(world.entities.kindId[id]!);
  if (kind.id !== 'cannon-12') return;
  // The cannon-12 unit's default weapon is cannon12Solid, so resolveFire
  // produces solid shot already.
  resolveFire(
    world.entities,
    projectiles,
    particles,
    puffs,
    world.rng,
    id,
    DUMMY_ROW_X, DUMMY_ROW_Y,
  );
}

/**
 * Fire a 12-pdr explosive shell from the cannon-12 subject. The unit's
 * default weapon is solid shot, so we override the projectile profile here
 * instead of going through `resolveFire`.
 */
export function actExplosiveShell(
  world: World,
  projectiles: Projectiles,
  particles: Particles,
  puffs: Puffs,
  stage: Stage,
): void {
  const id = subject(world, stage);
  if (id === null) return;
  const kind = getUnitKindByIndex(world.entities.kindId[id]!);
  if (kind.id !== 'cannon-12') return;

  const tip = barrelTip(world.entities, id);
  const profile = cannon12Shell;
  const launch = solveCannonLaunch(
    tip.x, tip.y,
    DUMMY_ROW_X, DUMMY_ROW_Y,
    profile.projectile.muzzleVelocity,
  );
  if (launch === null) return;

  spawnShell(
    projectiles,
    tip.x, tip.y, profile.projectile.launchHeight ?? 0,
    launch.vx, launch.vy, launch.vz,
    world.entities.team[id]!,
    profile.projectile.damage,
    profile.projectile.mass,
    profile.projectile.maxLife,
    profile.projectile.fuse ?? 1.5,
  );

  // Direction for muzzle FX: prefer xy launch direction, fall back to facing.
  let dirX = tip.dirX;
  let dirY = tip.dirY;
  const sp = Math.hypot(launch.vx, launch.vy);
  if (sp > 0) { dirX = launch.vx / sp; dirY = launch.vy / sp; }

  if (profile.muzzle) {
    emitMuzzleFx(particles, profile.muzzle, tip.x, tip.y, dirX, dirY, world.rng);
    emitPuffBurst(
      puffs,
      profile.muzzle.smoke.profile,
      profile.muzzle.smoke.profileIdx,
      tip.x, tip.y, dirX, dirY,
      profile.muzzle.smoke.count,
      profile.muzzle.smoke.coneAngle,
      profile.muzzle.smoke.speed,
      world.rng,
    );
  }
  world.entities.recoilT[id] = RECOIL_T;
  if (profile.muzzle?.recoilFirer) {
    world.entities.recoilPeakX[id] = -dirX * profile.muzzle.recoilFirer;
    world.entities.recoilPeakY[id] = -dirY * profile.muzzle.recoilFirer;
  } else {
    world.entities.recoilPeakX[id] = 0;
    world.entities.recoilPeakY[id] = 0;
  }
}

export function actCharge(world: World, stage: Stage): void {
  const id = subject(world, stage);
  if (id === null) return;
  const kind = getUnitKindByIndex(world.entities.kindId[id]!);
  if (kind.id !== 'cuirassier') return;
  const dir = facingDir(world.entities.facing[id]!);
  const speed = kind.baseStats.moveSpeed * 2; // gallop
  world.entities.velX[id] = dir.x * speed;
  world.entities.velY[id] = dir.y * speed;
  writeFacingIntent(world.entities, id, dir.x, dir.y);
  world.entities.state[id] = EntityState.Moving;
}

export function actTakeMusketHit(
  world: World,
  particles: Particles,
  rng: Rng,
  stage: Stage,
): void {
  const id = subject(world, stage);
  if (id === null) return;
  // Impulse from the west: +X direction. mass 0.03 kg × 400 m/s = 12 N·s.
  applyHit(world.entities, particles, rng, id, 12, 12, 0, 'musket', world.bloodSplats);
}

export function actTakeCannonHit(
  world: World,
  particles: Particles,
  rng: Rng,
  stage: Stage,
): void {
  const id = subject(world, stage);
  if (id === null) return;
  // Impulse from the west: +X direction. ~1500 N·s — well above KNOCKBACK.
  applyHit(world.entities, particles, rng, id, 80, 1500, 0, 'cannon', world.bloodSplats);
}

export function actDie(
  world: World,
  particles: Particles,
  rng: Rng,
  stage: Stage,
): void {
  const id = subject(world, stage);
  if (id === null) return;
  // Drop HP to 1 then deliver a small hit so it transitions to Dying (not ragdoll).
  world.entities.hp[id] = 1;
  applyHit(world.entities, particles, rng, id, 1, 1, 0, 'musket', world.bloodSplats);
}
