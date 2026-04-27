import { describe, it, expect } from 'vitest';
import { createPuffs, allocPuff } from './puffs';
import { applyWindToPuffs } from './wind';
import { DUST_INDEX } from './profiles/dust';
import { CANNON_SMOKE_INDEX } from './profiles/cannon-smoke';

describe('applyWindToPuffs', () => {
  it('applies acceleration scaled by buoyancy magnitude (heavier puffs drift less)', () => {
    const p = createPuffs(4);
    const dust = allocPuff(p);
    p.profileIdx[dust] = DUST_INDEX; p.velX[dust] = 0; p.buoyancy[dust] = -0.1;
    const smoke = allocPuff(p);
    p.profileIdx[smoke] = CANNON_SMOKE_INDEX; p.velX[smoke] = 0; p.buoyancy[smoke] = -0.6;
    applyWindToPuffs(p, 1.0, 1.0); // accelX = 1, dt = 1
    // Smoke (buoyancy -0.6) should drift faster than dust (buoyancy -0.1).
    expect(Math.abs(p.velX[smoke]!)).toBeGreaterThan(Math.abs(p.velX[dust]!));
  });

  it('zero acceleration is a no-op', () => {
    const p = createPuffs(2);
    const i = allocPuff(p);
    p.velX[i] = 5;
    applyWindToPuffs(p, 0, 1);
    expect(p.velX[i]).toBe(5);
  });
});
