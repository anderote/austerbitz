import { registerProfile, type PuffProfile } from '../profile';

export const DUST: PuffProfile = {
  id: 'dust',
  sizeStart: { min: 0.14, max: 0.26 },
  life: { min: 1.5, max: 3.0 },
  velScale: 1.0, velJitter: 0.3,
  edgeGrowth: 0.14, sizeMax: 0.95,
  drag: 0.985, buoyancy: -0.1,
  inertiaExp: 2, inertiaWeight: 0.25,
  color: [0.62, 0.60, 0.58], colorJitter: 0.03,
  alpha: 0.45, softness: 0.6,
  coalesce: { radius: 0.35, sizePerMerge: 0.012, lifePerMerge: 0.12, posBlend: 0.3, mergeChance: 0.20 },
};

export const DUST_INDEX = registerProfile(DUST);
