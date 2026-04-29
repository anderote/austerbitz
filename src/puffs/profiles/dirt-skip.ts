import { registerProfile, type PuffProfile } from '../profile';

export const DIRT_SKIP: PuffProfile = {
  id: 'dirt-skip',
  sizeStart: { min: 0.30, max: 0.50 },
  life: { min: 0.4, max: 0.7 },
  velScale: 1.0, velJitter: 0.4,
  edgeGrowth: 0.30, sizeMax: 1.4,
  drag: 0.92, buoyancy: -0.2,
  inertiaExp: 2, inertiaWeight: 0.20,
  color: [0.42, 0.36, 0.28], colorJitter: 0.04,
  alpha: 0.70, softness: 0.6,
  coalesce: null,
};

export const DIRT_SKIP_INDEX = registerProfile(DIRT_SKIP);
