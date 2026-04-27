import type { WeaponProfile } from './types';

export const musket: WeaponProfile = {
  id: 'musket',
  kind: 'musket',
  muzzle: {
    flash: {
      size: 0.5,
      life: 0.06,
      color: [1.0, 0.86, 0.59],
    },
    smoke: {
      count: 10,
      coneAngle: 0.4,
      speed: { min: 4, max: 7 },
      life: { min: 1.0, max: 1.8 },
      sizeStart: 0.3,
      sizeGrowth: 0.4,
      upwardDrift: 0.4,
      drag: 0.97,
      color: [0.86, 0.84, 0.82],
    },
    recoilFirer: 0.5,
  },
  projectile: {
    mass: 0.03,
    muzzleVelocity: 400,
    damage: 12,
    accuracySpreadRad: (1.5 * Math.PI) / 180,
    maxLife: 0.4,
  },
};
