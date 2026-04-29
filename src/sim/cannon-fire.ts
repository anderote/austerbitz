import { barrelTip } from '../fx/barrel';
import { spawnSolidShot, spawnShell, spawnCanister, type Projectiles } from './projectiles';
import { cannon12Solid } from '../data/weapons/cannon-12-solid';
import { cannon12Shell } from '../data/weapons/cannon-12-shell';
import { cannon12Canister } from '../data/weapons/cannon-12-canister';
import { emitMuzzleFx } from '../particles/emitters';
import { emitPuffMuzzleSpray } from '../puffs/emit';
import type { Entities } from './entities';
import type { Particles } from '../particles/particles';
import type { Puffs } from '../puffs/puffs';
import type { Rng } from '../util/rng';
import { RECOIL_T } from './fire-resolver';
import { rollDamage } from './damage-roll';
import { pushSfxRequest, type SfxRequests } from './sfx-requests';

function applyMuzzleFxAndRecoil(
  e: Entities,
  particles: Particles,
  puffs: Puffs,
  rng: Rng,
  cannonId: number,
  tipX: number,
  tipY: number,
  dirX: number,
  dirY: number,
): void {
  const muzzle = cannon12Solid.muzzle;
  if (muzzle) {
    emitMuzzleFx(particles, muzzle, tipX, tipY, dirX, dirY, rng);
    emitPuffMuzzleSpray(
      puffs,
      muzzle.smoke.profile,
      muzzle.smoke.profileIdx,
      tipX, tipY, dirX, dirY,
      muzzle.smoke.count,
      muzzle.smoke.coneAngle,
      muzzle.smoke.speed,
      rng,
    );
  }
  const recoilDur = muzzle?.recoilDuration ?? RECOIL_T;
  e.recoilT[cannonId] = recoilDur;
  e.recoilTotal[cannonId] = recoilDur;
  if (muzzle?.recoilFirer) {
    e.recoilPeakX[cannonId] = -dirX * muzzle.recoilFirer;
    e.recoilPeakY[cannonId] = -dirY * muzzle.recoilFirer;
  } else {
    e.recoilPeakX[cannonId] = 0;
    e.recoilPeakY[cannonId] = 0;
  }
}

export function fireCannonSolid(
  entities: Entities,
  projectiles: Projectiles,
  particles: Particles,
  puffs: Puffs,
  rng: Rng,
  cannonId: number,
  elevationDeg: number,
  sfxRequests?: SfxRequests,
): void {
  const tip = barrelTip(entities, cannonId);
  const muz = cannon12Solid.projectile.muzzleVelocity;
  const elev = elevationDeg * Math.PI / 180;
  const vh = muz * Math.cos(elev);
  const vv = muz * Math.sin(elev);
  const solidRoll = rollDamage(
    cannon12Solid.projectile.damage,
    cannon12Solid.projectile.damageVarianceFrac ?? 0,
    cannon12Solid.projectile.critChance ?? 0,
    cannon12Solid.projectile.critMul ?? 1.5,
    rng,
  );
  spawnSolidShot(
    projectiles,
    tip.x, tip.y, cannon12Solid.projectile.launchHeight ?? 0,
    vh * tip.dirX, vh * tip.dirY, vv,
    entities.team[cannonId]!,
    solidRoll.damage,
    cannon12Solid.projectile.mass,
    cannon12Solid.projectile.maxLife,
    cannon12Solid.projectile.ricochetCount ?? 0,
    cannonId,
    solidRoll.crit ? 1 : 0,
  );
  applyMuzzleFxAndRecoil(
    entities, particles, puffs, rng, cannonId,
    tip.x, tip.y, tip.dirX, tip.dirY,
  );
  if (sfxRequests) pushSfxRequest(sfxRequests, 'cannon-fire', tip.x, tip.y);
}

export function fireCannonShell(
  entities: Entities,
  projectiles: Projectiles,
  particles: Particles,
  puffs: Puffs,
  rng: Rng,
  cannonId: number,
  elevationDeg: number,
  sfxRequests?: SfxRequests,
): void {
  const tip = barrelTip(entities, cannonId);
  const muz = cannon12Shell.projectile.muzzleVelocity;
  const elev = elevationDeg * Math.PI / 180;
  const vh = muz * Math.cos(elev);
  const vv = muz * Math.sin(elev);
  const shellRoll = rollDamage(
    cannon12Shell.projectile.damage,
    cannon12Shell.projectile.damageVarianceFrac ?? 0,
    cannon12Shell.projectile.critChance ?? 0,
    cannon12Shell.projectile.critMul ?? 1.5,
    rng,
  );
  spawnShell(
    projectiles,
    tip.x, tip.y, cannon12Shell.projectile.launchHeight ?? 0,
    vh * tip.dirX, vh * tip.dirY, vv,
    entities.team[cannonId]!,
    shellRoll.damage,
    cannon12Shell.projectile.mass,
    cannon12Shell.projectile.maxLife,
    cannon12Shell.projectile.fuse ?? 1.5,
    cannonId,
    shellRoll.crit ? 1 : 0,
  );
  applyMuzzleFxAndRecoil(
    entities, particles, puffs, rng, cannonId,
    tip.x, tip.y, tip.dirX, tip.dirY,
  );
  if (sfxRequests) pushSfxRequest(sfxRequests, 'cannon-fire', tip.x, tip.y);
}

export function fireCannonCanister(
  entities: Entities,
  projectiles: Projectiles,
  puffs: Puffs,
  rng: Rng,
  cannonId: number,
  sfxRequests?: SfxRequests,
): void {
  const tip = barrelTip(entities, cannonId);
  spawnCanister(
    projectiles,
    tip.x, tip.y,
    tip.dirX, tip.dirY,
    entities.team[cannonId]!,
    cannon12Canister,
    cannonId,
    rng,
  );
  // Canister muzzle smoke using the profile embedded in the canister data
  emitPuffMuzzleSpray(
    puffs,
    cannon12Canister.muzzleSmokeProfile,
    cannon12Canister.muzzleSmokeProfileIdx,
    tip.x, tip.y, tip.dirX, tip.dirY,
    cannon12Canister.muzzleSmokeCount,
    0.18,
    { min: 7, max: 13 },
    rng,
  );
  // Recoil — reuse cannon12Solid muzzle values (shared by all cannon-12 ammo)
  const muzzle = cannon12Solid.muzzle;
  const recoilDur = muzzle?.recoilDuration ?? RECOIL_T;
  entities.recoilT[cannonId] = recoilDur;
  entities.recoilTotal[cannonId] = recoilDur;
  if (muzzle?.recoilFirer) {
    entities.recoilPeakX[cannonId] = -tip.dirX * muzzle.recoilFirer;
    entities.recoilPeakY[cannonId] = -tip.dirY * muzzle.recoilFirer;
  } else {
    entities.recoilPeakX[cannonId] = 0;
    entities.recoilPeakY[cannonId] = 0;
  }
  if (sfxRequests) pushSfxRequest(sfxRequests, 'cannon-fire', tip.x, tip.y);
}
