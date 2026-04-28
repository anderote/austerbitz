import { registerProfile, type PuffProfile } from '../profile';

export const CANNONBALL_TRAIL: PuffProfile = {
  id: 'cannonball-trail',
  sizeStart: { min: 0.30, max: 0.50 },
  life: { min: 0.5, max: 1.0 },
  velScale: 0.0, velJitter: 0.5,
  edgeGrowth: 0.4, sizeMax: 1.0,
  drag: 0.97, buoyancy: -0.6,
  inertiaExp: 2, inertiaWeight: 0.10,
  color: [0.7, 0.7, 0.72], colorJitter: 0.02,
  alpha: 0.55, softness: 0.85,
  coalesce: null,
};

export const CANNONBALL_TRAIL_INDEX = registerProfile(CANNONBALL_TRAIL);
