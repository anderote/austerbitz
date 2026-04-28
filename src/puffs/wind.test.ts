import { describe, it, expect } from 'vitest';
import { createPuffs, allocPuff } from './puffs';
import { applyWindToPuffs } from './wind';
import { DUST_INDEX } from './profiles/dust';
import { CANNON_SMOKE_INDEX } from './profiles/cannon-smoke';

describe('applyWindToPuffs', () => {
  it('applies acceleration scaled by size (bigger puffs catch more wind)', () => {
    const p = createPuffs(4);
    const small = allocPuff(p);
    p.profileIdx[small] = DUST_INDEX;
    p.velX[small] = 0; p.size[small] = 0.2;
    p.lifeMax[small] = 1; p.life[small] = 0.1;
    const big = allocPuff(p);
    p.profileIdx[big] = CANNON_SMOKE_INDEX;
    p.velX[big] = 0; p.size[big] = 2.0;
    p.lifeMax[big] = 1; p.life[big] = 0.1;
    applyWindToPuffs(p, 1.0, 0, 1.0);
    expect(Math.abs(p.velX[big]!)).toBeGreaterThan(Math.abs(p.velX[small]!));
  });

  it('fresh puffs barely move; aged puffs drift much more', () => {
    const p = createPuffs(2);
    const fresh = allocPuff(p);
    p.size[fresh] = 1.0; p.lifeMax[fresh] = 1; p.life[fresh] = 1.0;  // age 0
    const aged = allocPuff(p);
    p.size[aged] = 1.0; p.lifeMax[aged] = 1; p.life[aged] = 0.05;   // age 0.95
    applyWindToPuffs(p, 1.0, 0, 1.0);
    expect(Math.abs(p.velX[aged]!)).toBeGreaterThan(Math.abs(p.velX[fresh]!) * 5);
  });

  it('zero acceleration is a no-op', () => {
    const p = createPuffs(2);
    const i = allocPuff(p);
    p.velX[i] = 5; p.velY[i] = 7; p.size[i] = 1; p.lifeMax[i] = 1; p.life[i] = 0.5;
    applyWindToPuffs(p, 0, 0, 1);
    expect(p.velX[i]).toBe(5);
    expect(p.velY[i]).toBe(7);
  });

  it('y-axis acceleration pushes velY', () => {
    const p = createPuffs(2);
    const i = allocPuff(p);
    p.velX[i] = 0; p.velY[i] = 0; p.size[i] = 1; p.lifeMax[i] = 1; p.life[i] = 0.1;
    applyWindToPuffs(p, 0, 1.0, 1.0);
    expect(p.velY[i]!).toBeGreaterThan(0);
    expect(p.velX[i]!).toBe(0);
  });
});
