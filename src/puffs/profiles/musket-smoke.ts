import { registerProfile, type PuffProfile } from '../profile';

export const MUSKET_SMOKE: PuffProfile = {
  id: 'musket-smoke',
  sizeStart: { min: 0.18, max: 0.28 },
  life: { min: 4.0, max: 7.0 },
  velScale: 1.0, velJitter: 0.15,
  edgeGrowth: 0.10, sizeMax: 2.5,
  drag: 0.985, buoyancy: -0.7,
  inertiaExp: 2, inertiaWeight: 0.20,
  color: [0.86, 0.84, 0.82], colorJitter: 0.02,
  alpha: 0.75, softness: 0.9,
  decayMulAtMaxSize: 0.55,
  coalesce: {
    radius: 1.1, sizePerMerge: 0.08, lifePerMerge: 0.30,
    posBlend: 0.30, mergeChance: 0.0,
    driftMergePerSec: 0.25,
    velDampOnMerge: 0.65,
    buoyancyMulOnMerge: 0.92,
    lifeMaxPerMerge: 0.25,
  },
};

export const MUSKET_SMOKE_INDEX = registerProfile(MUSKET_SMOKE);
