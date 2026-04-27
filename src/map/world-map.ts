import type { MapFeature } from '../data/types';

export interface WorldMap {
  size: { w: number; h: number }; // world units (meters)
  features: MapFeature[];
}

export function createDefaultMap(): WorldMap {
  return {
    size: { w: 2000, h: 2000 },
    features: [],
  };
}
