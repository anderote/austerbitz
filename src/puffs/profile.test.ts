import { describe, it, expect } from 'vitest';
import { registerProfile, getProfileByIndex, type PuffProfile } from './profile';

const sample: PuffProfile = {
  id: 'sample',
  sizeStart: { min: 0.5, max: 1.0 },
  life: { min: 1, max: 2 },
  velScale: 1, velJitter: 0,
  edgeGrowth: 0.5, sizeMax: 2.0,
  drag: 0.99, buoyancy: 0,
  inertiaExp: 2, inertiaWeight: 0.3,
  color: [0.5, 0.5, 0.5], colorJitter: 0,
  alpha: 1.0, softness: 0.8,
  coalesce: null,
};

describe('profile registry', () => {
  it('assigns a non-negative index and round-trips', () => {
    const idx = registerProfile(sample);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(getProfileByIndex(idx)).toBe(sample);
  });

  it('idempotently returns the same index for the same id', () => {
    const a = registerProfile(sample);
    const b = registerProfile(sample);
    expect(a).toBe(b);
  });
});
