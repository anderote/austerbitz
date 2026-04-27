import { registerProfile, type PuffProfile } from '../profile';

export const DUST: PuffProfile = {
  id: 'dust',
  sizeStart: { min: 0.25, max: 0.45 },
  life: { min: 1.5, max: 3.0 },
  velScale: 1.0, velJitter: 0.3,
  edgeGrowth: 0.20, sizeMax: 1.6,
  drag: 0.985, buoyancy: -0.1,
  inertiaExp: 2, inertiaWeight: 0.25,
  color: [0.62, 0.60, 0.58], colorJitter: 0.03,
  alpha: 0.55, softness: 0.6,
  coalesce: { radius: 0.5, sizePerMerge: 0.02, lifePerMerge: 0.12, posBlend: 0.3, mergeChance: 0.20 },
};

export const DUST_INDEX = registerProfile(DUST);
