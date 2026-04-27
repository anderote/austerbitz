import { describe, it, expect } from 'vitest';
import { vec2, vAdd, vSub, vScale, vLen, vDist, vNormalize, clamp, lerp } from './math';

describe('vec2 helpers', () => {
  it('vec2 creates {x,y}', () => {
    expect(vec2(3, 4)).toEqual({ x: 3, y: 4 });
  });
  it('vAdd adds component-wise', () => {
    expect(vAdd(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
  });
  it('vSub subtracts component-wise', () => {
    expect(vSub(vec2(5, 7), vec2(2, 3))).toEqual({ x: 3, y: 4 });
  });
  it('vScale scales by scalar', () => {
    expect(vScale(vec2(2, 3), 2)).toEqual({ x: 4, y: 6 });
  });
  it('vLen returns euclidean length', () => {
    expect(vLen(vec2(3, 4))).toBe(5);
  });
  it('vDist returns distance between two points', () => {
    expect(vDist(vec2(0, 0), vec2(3, 4))).toBe(5);
  });
  it('vNormalize returns unit vector', () => {
    const n = vNormalize(vec2(3, 4));
    expect(n.x).toBeCloseTo(0.6, 5);
    expect(n.y).toBeCloseTo(0.8, 5);
  });
  it('vNormalize on zero returns zero', () => {
    expect(vNormalize(vec2(0, 0))).toEqual({ x: 0, y: 0 });
  });
});

describe('scalar helpers', () => {
  it('clamp clamps to range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
  it('lerp linearly interpolates', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});
