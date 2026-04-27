import type { WeaponProfile } from './types';
import { cannon12Muzzle } from './cannon-12-solid';

export const cannon12Shell: WeaponProfile = {
  id: 'cannon-12-shell',
  kind: 'shell',
  muzzle: cannon12Muzzle,
  projectile: {
    mass: 6,
    muzzleVelocity: 250,
    damage: 0,
    maxLife: 6.0,
    launchHeight: 0.7,
    fuse: 1.5,
    explosion: {
      flash: {
        size: 5,
        life: 0.18,
        color: [1.0, 0.9, 0.63],
      },
      smokeBillow: {
        count: 50,
        speedMin: 6,
        speedMax: 14,
        lifeMin: 2.5,
        lifeMax: 5.0,
        sizeStart: 1.4,
        sizeGrowth: 1.6,
        drag: 0.985,
        upwardDrift: 1.5,
      },
      debris: {
        count: 20,
        speedMin: 10,
        speedMax: 22,
        life: 0.6,
        size: 0.25,
      },
      damage: 60,
      damageRadius: 6,
      impulse: 6000,
    },
  },
};
