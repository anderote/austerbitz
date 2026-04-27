import { registerProfile, type PuffProfile } from '../profile';

export const CLOUD: PuffProfile = {
  id: 'cloud',
  sizeStart: { min: 12, max: 25 },
  life: { min: 60, max: 180 },
  velScale: 1.0, velJitter: 0.0,
  edgeGrowth: 0.0, sizeMax: 45,
  drag: 1.0, buoyancy: 0.0,
  inertiaExp: 2, inertiaWeight: 0.5,
  color: [0.92, 0.94, 0.96], colorJitter: 0.03,
  alpha: 0.5, softness: 0.95,
  coalesce: null,
};

export const CLOUD_INDEX = registerProfile(CLOUD);
