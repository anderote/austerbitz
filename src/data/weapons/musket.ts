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
      count: 10,
      coneAngle: 0.10,
      speed: { min: 6, max: 11 },
    },
    recoilFirer: 0.5,
  },
  projectile: {
    mass: 0.03,
    muzzleVelocity: 200,
    damage: 12,
    accuracySpreadRad: (1.5 * Math.PI) / 180,
    maxLife: 0.8,
  },
};
