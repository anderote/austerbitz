import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity, freeEntity, isAlive, EntityState } from './entities';

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

  it('resets state-machine transient fields to zero on alloc', () => {
    const e = createEntities(4);
    // Pre-poison the slot so alloc must clear it.
    e.recoilT[0] = 1.5;
    e.stateT[0] = 2.5;
    e.impulseX[0] = 7;
    e.impulseY[0] = -3;
    e.ragdollT[0] = 4;
    e.state[0] = EntityState.Ragdoll;
    const id = allocEntity(e);
    expect(id).toBe(0);
    expect(e.recoilT[id]).toBe(0);
    expect(e.stateT[id]).toBe(0);
    expect(e.impulseX[id]).toBe(0);
    expect(e.impulseY[id]).toBe(0);
    expect(e.ragdollT[id]).toBe(0);
    expect(e.state[id]).toBe(EntityState.Idle);
  });

  it('exposes state-machine transient buffers at the expected length and type', () => {
    const e = createEntities(16);
    expect(e.recoilT).toBeInstanceOf(Float32Array);
    expect(e.stateT).toBeInstanceOf(Float32Array);
    expect(e.impulseX).toBeInstanceOf(Float32Array);
    expect(e.impulseY).toBeInstanceOf(Float32Array);
    expect(e.ragdollT).toBeInstanceOf(Float32Array);
    expect(e.recoilT.length).toBe(16);
    expect(e.stateT.length).toBe(16);
    expect(e.impulseX.length).toBe(16);
    expect(e.impulseY.length).toBe(16);
    expect(e.ragdollT.length).toBe(16);
  });
});

describe('EntityState enum', () => {
  it('matches the spec numbering', () => {
    expect(EntityState.Idle).toBe(0);
    expect(EntityState.Moving).toBe(1);
    expect(EntityState.Aiming).toBe(2);
    expect(EntityState.Firing).toBe(3);
    expect(EntityState.Reloading).toBe(4);
    expect(EntityState.Flinch).toBe(5);
    expect(EntityState.Ragdoll).toBe(6);
    expect(EntityState.Dying).toBe(7);
    expect(EntityState.Dead).toBe(8);
  });
});
