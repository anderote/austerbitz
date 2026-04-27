import { registerProfile, type PuffProfile } from '../profile';

export const MUSKET_SMOKE: PuffProfile = {
  id: 'musket-smoke',
  sizeStart: { min: 0.25, max: 0.40 },
  life: { min: 0.9, max: 1.6 },
  velScale: 1.0, velJitter: 0.2,
  edgeGrowth: 0.7, sizeMax: 1.6,
  drag: 0.97, buoyancy: -0.4,
  inertiaExp: 2, inertiaWeight: 0.15,
  color: [0.86, 0.84, 0.82], colorJitter: 0.02,
  alpha: 0.9, softness: 0.9,
  coalesce: null,
};

export const MUSKET_SMOKE_INDEX = registerProfile(MUSKET_SMOKE);
