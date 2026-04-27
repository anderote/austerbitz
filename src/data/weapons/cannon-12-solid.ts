import type { MuzzleProfile, WeaponProfile } from './types';
import { CANNON_SMOKE, CANNON_SMOKE_INDEX } from '../../puffs/profiles/cannon-smoke';

export const cannon12Muzzle: MuzzleProfile = {
  flash: { size: 3.0, life: 0.15, color: [1.0, 0.86, 0.59] },
  smoke: {
    profile: CANNON_SMOKE,
    profileIdx: CANNON_SMOKE_INDEX,
    count: 24,
    coneAngle: 0.18,
    speed: { min: 7, max: 13 },
  },
  recoilFirer: 4.0,
};

export const cannon12Solid: WeaponProfile = {
  id: 'cannon-12-solid',
  kind: 'solid-shot',
  muzzle: cannon12Muzzle,
  projectile: {
    mass: 6,
    muzzleVelocity: 250,
    damage: 80,
    maxLife: 6.0,
    launchHeight: 0.7,
    ricochetCount: 3,
    restitutionZ: 0.5,
    horizontalDampingPerRicochet: 0.7,
    groundFriction: 1.5,
    rollStopSpeed: 3,
    perHitDamageFalloff: 0.6,
    perHitVelocityFalloff: 0.85,
    freeBelowDamage: 5,
  },
};
