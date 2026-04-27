import { describe, it, expect } from 'vitest';
import { createPuffs, allocPuff } from '../puffs/puffs';
import { applyWind } from './wind';
import { DUST_INDEX } from '../puffs/profiles/dust';
import { CANNON_SMOKE_INDEX } from '../puffs/profiles/cannon-smoke';

describe('lab applyWind', () => {
  it('lighter puffs (high |buoyancy|) drift faster than heavier ones', () => {
    const p = createPuffs(4);
    const dust = allocPuff(p);
    p.profileIdx[dust] = DUST_INDEX; p.velX[dust] = 0; p.buoyancy[dust] = -0.1;
    const smoke = allocPuff(p);
    p.profileIdx[smoke] = CANNON_SMOKE_INDEX; p.velX[smoke] = 0; p.buoyancy[smoke] = -0.6;
    applyWind(p, 1.0, 1.0);
    expect(Math.abs(p.velX[smoke]!)).toBeGreaterThan(Math.abs(p.velX[dust]!));
  });

  it('zero acceleration leaves velocities unchanged', () => {
    const p = createPuffs(2);
    const i = allocPuff(p);
    p.velX[i] = 5;
    applyWind(p, 0, 1);
    expect(p.velX[i]).toBe(5);
  });
});
