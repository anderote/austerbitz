import type { WeaponProfile } from './types';
import { MUSKET_SMOKE, MUSKET_SMOKE_INDEX } from '../../puffs/profiles/musket-smoke';

export const musket: WeaponProfile = {
  id: 'musket',
  kind: 'musket',
  muzzle: {
    flash: { size: 0.5, life: 0.06, color: [1.0, 0.86, 0.59] },
    smoke: {
      profile: MUSKET_SMOKE,
      profileIdx: MUSKET_SMOKE_INDEX,
      count: 9,
      coneAngle: 0.14,
      speed: { min: 0, max: 6 },
    },
    recoilFirer: 0.5,
  },
  projectile: {
    mass: 0.03,
    muzzleVelocity: 50,
    damage: 12,
    damageVarianceFrac: 0.33,
    critChance: 0.05,
    critMul: 2.0,
    accuracySpreadRad: (4 * Math.PI) / 180,
    maxLife: 2.0,
  },
};
