import { registerProfile, type PuffProfile } from '../profile';

export const CANNON_SMOKE: PuffProfile = {
  id: 'cannon-smoke',
  sizeStart: { min: 0.45, max: 0.75 },
  life: { min: 7.0, max: 11.0 },
  velScale: 1.0, velJitter: 0.3,
  edgeGrowth: 0.18, sizeMax: 5.0,
  drag: 0.99, buoyancy: -1.0,
  inertiaExp: 2, inertiaWeight: 0.35,
  color: [0.78, 0.80, 0.84], colorJitter: 0.03,
  alpha: 0.75, softness: 0.85,
  decayMulAtMaxSize: 0.50,
  coalesce: {
    radius: 1.8, sizePerMerge: 0.16, lifePerMerge: 0.40,
    posBlend: 0.30, mergeChance: 0.0,
    driftMergePerSec: 0.30,
    velDampOnMerge: 0.55,
    buoyancyMulOnMerge: 0.90,
    lifeMaxPerMerge: 0.45,
  },
};

export const CANNON_SMOKE_INDEX = registerProfile(CANNON_SMOKE);
