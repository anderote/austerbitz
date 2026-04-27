import { registerProfile, type PuffProfile } from '../profile';

export const DUST: PuffProfile = {
  id: 'dust',
  sizeStart: { min: 0.6, max: 1.0 },
  life: { min: 3.5, max: 6.0 },
  velScale: 1.0, velJitter: 0.3,
  edgeGrowth: 0.6, sizeMax: 4.0,
  drag: 0.985, buoyancy: -0.1,
  inertiaExp: 2, inertiaWeight: 0.25,
  color: [0.30, 0.30, 0.34], colorJitter: 0.03,
  alpha: 0.75, softness: 0.6,
  coalesce: { radius: 0.9, sizePerMerge: 0.05, lifePerMerge: 0.3, posBlend: 0.3, mergeChance: 0.7 },
};

export const DUST_INDEX = registerProfile(DUST);
