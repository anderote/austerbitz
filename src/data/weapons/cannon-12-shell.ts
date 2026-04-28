import type { WeaponProfile } from './types';
import { cannon12Muzzle } from './cannon-12-solid';
import { SHELL_BILLOW, SHELL_BILLOW_INDEX } from '../../puffs/profiles/shell-billow';

export const cannon12Shell: WeaponProfile = {
  id: 'cannon-12-shell',
  kind: 'shell',
  muzzle: cannon12Muzzle,
  projectile: {
    mass: 6,
    muzzleVelocity: 60,
    damage: 0,
    maxLife: 6.0,
    launchHeight: 0.7,
    fuse: 1.5,
    explosion: {
      flash: { size: 4, life: 0.16, color: [1.0, 0.9, 0.63] },
      smokeBillow: {
        profile: SHELL_BILLOW,
        profileIdx: SHELL_BILLOW_INDEX,
        count: 12,
        speed: { min: 5, max: 10 },
      },
      debris: { count: 14, speedMin: 8, speedMax: 18, life: 0.5, size: 0.22 },
      damage: 35,
      damageRadius: 4,
      impulse: 3500,
    },
  },
};
