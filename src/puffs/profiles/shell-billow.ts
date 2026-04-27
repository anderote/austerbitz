import { registerProfile, type PuffProfile } from '../profile';

export const SHELL_BILLOW: PuffProfile = {
  id: 'shell-billow',
  sizeStart: { min: 1.2, max: 1.8 },
  life: { min: 2.5, max: 5.0 },
  velScale: 1.0, velJitter: 0.5,
  edgeGrowth: 1.6, sizeMax: 6.0,
  drag: 0.985, buoyancy: -1.5,
  inertiaExp: 2, inertiaWeight: 0.30,
  color: [0.60, 0.60, 0.62], colorJitter: 0.04,
  alpha: 0.9, softness: 0.85,
  coalesce: { radius: 1.5, sizePerMerge: 0.20, lifePerMerge: 0.6, posBlend: 0.2, mergeChance: 0.5 },
};

export const SHELL_BILLOW_INDEX = registerProfile(SHELL_BILLOW);
