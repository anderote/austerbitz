import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity, freeEntity, isAlive } from './entities';

describe('Entities SoA', () => {
  it('allocates entities with monotonically increasing ids until capacity', () => {
    const e = createEntities(4);
    const a = allocEntity(e);
    const b = allocEntity(e);
    const c = allocEntity(e);
    const d = allocEntity(e);
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(c).toBe(2);
    expect(d).toBe(3);
    expect(allocEntity(e)).toBe(-1); // capacity exhausted
  });

  it('marks freed slots as not alive and reuses them', () => {
    const e = createEntities(4);
    const a = allocEntity(e);
    const b = allocEntity(e);
    expect(isAlive(e, a)).toBe(true);
    expect(isAlive(e, b)).toBe(true);
    freeEntity(e, a);
    expect(isAlive(e, a)).toBe(false);
    expect(isAlive(e, b)).toBe(true);
    const reused = allocEntity(e);
    expect(reused).toBe(a);
    expect(isAlive(e, reused)).toBe(true);
  });

  it('exposes typed-array buffers at the expected length', () => {
    const e = createEntities(16);
    expect(e.posX).toBeInstanceOf(Float32Array);
    expect(e.posX.length).toBe(16);
    expect(e.team.length).toBe(16);
    expect(e.kindId.length).toBe(16);
  });

  it('count tracks live entities', () => {
    const e = createEntities(4);
    expect(e.count).toBe(0);
    allocEntity(e);
    allocEntity(e);
    expect(e.count).toBe(2);
    freeEntity(e, 0);
    expect(e.count).toBe(1);
  });
});
