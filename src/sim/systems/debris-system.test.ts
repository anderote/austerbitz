import { describe, expect, it } from 'vitest';
import { createDebris, allocDebris } from '../debris';
import { tickDebris } from './debris-system';

function spawnAt(d: ReturnType<typeof createDebris>, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0) {
  const id = allocDebris(d);
  if (id < 0) throw new Error('alloc failed');
  d.posX[id] = x; d.posY[id] = y; d.z[id] = z;
  d.velX[id] = vx; d.velY[id] = vy; d.velZ[id] = vz;
  d.ttl[id] = 5;
  d.spinDeg[id] = 0;
  d.spinRate[id] = 0;
  d.bounces[id] = 0;
  return id;
}

describe('tickDebris', () => {
  it('integrates position by velocity', () => {
    const d = createDebris(4);
    const id = spawnAt(d, 10, 20, 5, 1, 2, 0);
    tickDebris(d, 0.5);
    expect(d.posX[id]).toBeCloseTo(10.5, 5);
    expect(d.posY[id]).toBeCloseTo(21.0, 5);
  });

  it('applies gravity to velZ', () => {
    const d = createDebris(4);
    const id = spawnAt(d, 0, 0, 100, 0, 0, 0);
    tickDebris(d, 1);
    // velZ = 0 - GIB_GRAVITY * dt = -18 (modulo air drag z = 0.05).
    expect(d.velZ[id]).toBeLessThan(-15);
    expect(d.velZ[id]).toBeGreaterThan(-19);
  });

  it('bounces off ground when z dips below 0', () => {
    const d = createDebris(4);
    const id = spawnAt(d, 0, 0, 0.1, 0, 0, -10);
    tickDebris(d, 0.05);
    // z should clamp to 0 and velZ should flip with damping.
    expect(d.z[id]).toBe(0);
    expect(d.velZ[id]).toBeGreaterThan(0); // upward post-bounce
    expect(d.bounces[id]).toBe(1);
  });

  it('frees debris when ttl reaches zero', () => {
    const d = createDebris(4);
    const id = spawnAt(d, 0, 0, 0);
    d.ttl[id] = 0.1;
    tickDebris(d, 0.2);
    expect(d.alive[id]).toBe(0);
    expect(d.count).toBe(0);
  });

  it('settles after multiple bounces', () => {
    const d = createDebris(4);
    const id = spawnAt(d, 0, 0, 0, 5, 0, 0);
    // Force bounces=3 to trigger settle path.
    d.bounces[id] = 3;
    d.z[id] = 0;
    tickDebris(d, 0.05);
    expect(d.velX[id]).toBe(0);
    expect(d.velY[id]).toBe(0);
    expect(d.velZ[id]).toBe(0);
  });
});
