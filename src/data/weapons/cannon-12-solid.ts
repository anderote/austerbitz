import type { MuzzleProfile, WeaponProfile } from './types';

export const cannon12Muzzle: MuzzleProfile = {
  flash: {
    size: 3.0,
    life: 0.15,
    color: [1.0, 0.86, 0.59],
  },
  smoke: {
    count: 40,
    coneAngle: 0.8,
    speed: { min: 8, max: 15 },
    life: { min: 2.5, max: 4.0 },
    sizeStart: 1.2,
    sizeGrowth: 0.6,
    upwardDrift: 0.6,
    drag: 0.985,
    color: [0.78, 0.80, 0.84],
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
