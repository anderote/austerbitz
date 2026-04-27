import { describe, it, expect } from 'vitest';
import { solveCannonLaunch, GAME_GRAVITY, LaunchVector } from './ballistics';

const MUZZLE = 250;

describe('solveCannonLaunch', () => {
  it('east target: vx > 0, vy ≈ 0, vz > 0; speed magnitude preserved', () => {
    const v = solveCannonLaunch(0, 0, 100, 0, MUZZLE);
    expect(v).not.toBeNull();
    const r = v as LaunchVector;
    expect(r.vx).toBeGreaterThan(0);
    expect(Math.abs(r.vy)).toBeLessThan(1e-9);
    expect(r.vz).toBeGreaterThan(0);
    const speedSq = r.vx * r.vx + r.vy * r.vy + r.vz * r.vz;
    expect(speedSq).toBeCloseTo(MUZZLE * MUZZLE, 5);
  });

  it('north target: vy > 0, vx ≈ 0, vz > 0', () => {
    const v = solveCannonLaunch(0, 0, 0, 50, MUZZLE);
    expect(v).not.toBeNull();
    const r = v as LaunchVector;
    expect(Math.abs(r.vx)).toBeLessThan(1e-9);
    expect(r.vy).toBeGreaterThan(0);
    expect(r.vz).toBeGreaterThan(0);
    const speedSq = r.vx * r.vx + r.vy * r.vy + r.vz * r.vz;
    expect(speedSq).toBeCloseTo(MUZZLE * MUZZLE, 5);
  });

  it('NE diagonal target: vx ≈ vy > 0; total speed ≈ muzzleSpeed', () => {
    // 100m diagonal NE: same range as east-100 in test 1, but split across XY.
    const v = solveCannonLaunch(0, 0, 100, 100, MUZZLE);
    expect(v).not.toBeNull();
    const r = v as LaunchVector;
    expect(r.vx).toBeGreaterThan(0);
    expect(r.vy).toBeGreaterThan(0);
    expect(r.vx).toBeCloseTo(r.vy, 9);
    expect(r.vz).toBeGreaterThan(0);
    const speed = Math.hypot(r.vx, r.vy, r.vz);
    expect(speed).toBeCloseTo(MUZZLE, 5);
  });

  it('out-of-range target returns null', () => {
    // 100km is well beyond v0²/g = 250²/18 ≈ 3472m max flat-trajectory range.
    const v = solveCannonLaunch(0, 0, 100_000, 0, MUZZLE);
    expect(v).toBeNull();
  });

  it('self-target (zero range) returns zero vector, not null', () => {
    const v = solveCannonLaunch(42, -7, 42, -7, MUZZLE);
    expect(v).not.toBeNull();
    const r = v as LaunchVector;
    expect(r.vx).toBe(0);
    expect(r.vy).toBe(0);
    expect(r.vz).toBe(0);
  });

  it('determinism: identical inputs produce identical outputs', () => {
    const a = solveCannonLaunch(10, 20, 110, 80, MUZZLE);
    const b = solveCannonLaunch(10, 20, 110, 80, MUZZLE);
    expect(a).toEqual(b);
  });

  it('trajectory verification: integrating the vector lands at the target', () => {
    const fromX = 5;
    const fromY = -3;
    const toX = 205;
    const toY = 97; // 200m east, 100m north
    const v = solveCannonLaunch(fromX, fromY, toX, toY, MUZZLE);
    expect(v).not.toBeNull();
    const r = v as LaunchVector;

    // For launch and landing at the same Z, time of flight is t = 2*vz/g.
    const t = (2 * r.vz) / GAME_GRAVITY;
    const landX = fromX + r.vx * t;
    const landY = fromY + r.vy * t;
    // Z at landing under constant gravity: vz*t - 0.5*g*t² should be 0.
    const landZ = r.vz * t - 0.5 * GAME_GRAVITY * t * t;

    expect(landX).toBeCloseTo(toX, 3);
    expect(landY).toBeCloseTo(toY, 3);
    expect(landZ).toBeCloseTo(0, 3);
  });
});
