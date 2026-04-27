import { registerProfile, type PuffProfile } from '../profile';

export const CANNON_SMOKE: PuffProfile = {
  id: 'cannon-smoke',
  sizeStart: { min: 1.0, max: 1.5 },
  life: { min: 2.5, max: 4.0 },
  velScale: 1.0, velJitter: 0.5,
  edgeGrowth: 1.2, sizeMax: 4.5,
  drag: 0.985, buoyancy: -0.6,
  inertiaExp: 2, inertiaWeight: 0.30,
  color: [0.78, 0.80, 0.84], colorJitter: 0.03,
  alpha: 0.9, softness: 0.85,
  coalesce: { radius: 1.2, sizePerMerge: 0.15, lifePerMerge: 0.5, posBlend: 0.2, mergeChance: 0.6 },
};

export const CANNON_SMOKE_INDEX = registerProfile(CANNON_SMOKE);
