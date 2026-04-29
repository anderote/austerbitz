import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity, freeEntity, isAlive, isDead, EntityState, FireStance, FORMATION_RANK_UNKNOWN } from './entities';
import { getUnitKind, getUnitKindIndex } from '../data/units';

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
    expect(e.facingIntentX).toBeInstanceOf(Float32Array);
    expect(e.facingIntentX.length).toBe(16);
    expect(e.facingIntentY).toBeInstanceOf(Float32Array);
    expect(e.facingIntentY.length).toBe(16);
    expect(e.bodyRadius).toBeInstanceOf(Float32Array);
    expect(e.bodyRadius.length).toBe(16);
    expect(e.massKg).toBeInstanceOf(Float32Array);
    expect(e.massKg.length).toBe(16);
    expect(e.aliveIds).toBeInstanceOf(Int32Array);
    expect(e.aliveIds.length).toBe(16);
    expect(e.aliveIdx).toBeInstanceOf(Int32Array);
    expect(e.aliveIdx.length).toBe(16);
  });

  it('maintains a packed aliveIds list via swap-pop', () => {
    const e = createEntities(8);
    const a = allocEntity(e); // id 0
    const b = allocEntity(e); // id 1
    const c = allocEntity(e); // id 2
    expect(e.count).toBe(3);
    // Packed [a, b, c] in some allocation order; check via aliveIdx.
    expect(e.aliveIdx[a]).toBe(0);
    expect(e.aliveIdx[b]).toBe(1);
    expect(e.aliveIdx[c]).toBe(2);
    expect(e.aliveIds[0]).toBe(a);
    expect(e.aliveIds[1]).toBe(b);
    expect(e.aliveIds[2]).toBe(c);

    // Free the middle id; swap-pop should move c into b's slot.
    freeEntity(e, b);
    expect(e.count).toBe(2);
    expect(e.aliveIdx[b]).toBe(-1);
    expect(e.aliveIdx[a]).toBe(0);
    expect(e.aliveIdx[c]).toBe(1);
    expect(e.aliveIds[0]).toBe(a);
    expect(e.aliveIds[1]).toBe(c);

    // Walking [0..count) should yield exactly the live ids, in some order.
    const seen = new Set<number>();
    for (let n = 0; n < e.count; n++) seen.add(e.aliveIds[n]!);
    expect(seen).toEqual(new Set([a, c]));
  });

  it('packed aliveIds tail removal does not need a swap', () => {
    const e = createEntities(4);
    const a = allocEntity(e);
    const b = allocEntity(e);
    freeEntity(e, b); // tail
    expect(e.count).toBe(1);
    expect(e.aliveIds[0]).toBe(a);
    expect(e.aliveIdx[a]).toBe(0);
    expect(e.aliveIdx[b]).toBe(-1);
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
    e.recoilPeakX[0] = 0.9;
    e.recoilPeakY[0] = -0.4;
    e.stateT[0] = 2.5;
    e.impulseX[0] = 7;
    e.impulseY[0] = -3;
    e.ragdollT[0] = 4;
    e.state[0] = EntityState.Ragdoll;
    const id = allocEntity(e);
    expect(id).toBe(0);
    expect(e.recoilT[id]).toBe(0);
    expect(e.recoilPeakX[id]).toBe(0);
    expect(e.recoilPeakY[id]).toBe(0);
    expect(e.stateT[id]).toBe(0);
    expect(e.impulseX[id]).toBe(0);
    expect(e.impulseY[id]).toBe(0);
    expect(e.ragdollT[id]).toBe(0);
    expect(e.state[id]).toBe(EntityState.Idle);
    expect(e.facing[id]).toBe(0);
    expect(e.facingIntentX[id]).toBe(1);
    expect(e.facingIntentY[id]).toBe(0);
  });

  it('exposes state-machine transient buffers at the expected length and type', () => {
    const e = createEntities(16);
    expect(e.recoilT).toBeInstanceOf(Float32Array);
    expect(e.recoilPeakX).toBeInstanceOf(Float32Array);
    expect(e.recoilPeakY).toBeInstanceOf(Float32Array);
    expect(e.stateT).toBeInstanceOf(Float32Array);
    expect(e.impulseX).toBeInstanceOf(Float32Array);
    expect(e.impulseY).toBeInstanceOf(Float32Array);
    expect(e.ragdollT).toBeInstanceOf(Float32Array);
    expect(e.recoilT.length).toBe(16);
    expect(e.recoilPeakX.length).toBe(16);
    expect(e.recoilPeakY.length).toBe(16);
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

describe('entities — veterancy fields', () => {
  it('initializes rank and xp to 0 on alloc', () => {
    const e = createEntities(4);
    const id = allocEntity(e);
    expect(id).not.toBe(-1);
    expect(e.rank[id]).toBe(0);
    expect(e.xp[id]).toBe(0);
  });

  it('rank is a Uint8Array, xp is a Uint16Array', () => {
    const e = createEntities(4);
    expect(e.rank).toBeInstanceOf(Uint8Array);
    expect(e.xp).toBeInstanceOf(Uint16Array);
    expect(e.rank.length).toBe(4);
    expect(e.xp.length).toBe(4);
  });
});

describe('entities — identity and lifetime stats fields', () => {
  it('initializes the new identity and lifetime-stats fields to 0 on alloc', () => {
    const e = createEntities(4);
    const id = allocEntity(e);
    expect(id).not.toBe(-1);
    expect(e.firstNameIdx[id]).toBe(0);
    expect(e.lastNameIdx[id]).toBe(0);
    expect(e.hometownIdx[id]).toBe(0);
    expect(e.themeId[id]).toBe(0);
    expect(e.ageYears[id]).toBe(0);
    expect(e.kills[id]).toBe(0);
    expect(e.damageDealt[id]).toBe(0);
  });

  it('exposes the new fields with the expected typed-array kinds and lengths', () => {
    const e = createEntities(8);
    expect(e.firstNameIdx).toBeInstanceOf(Uint16Array);
    expect(e.lastNameIdx).toBeInstanceOf(Uint16Array);
    expect(e.hometownIdx).toBeInstanceOf(Uint16Array);
    expect(e.themeId).toBeInstanceOf(Uint8Array);
    expect(e.ageYears).toBeInstanceOf(Uint8Array);
    expect(e.kills).toBeInstanceOf(Uint16Array);
    expect(e.damageDealt).toBeInstanceOf(Uint32Array);
    expect(e.firstNameIdx.length).toBe(8);
    expect(e.lastNameIdx.length).toBe(8);
    expect(e.hometownIdx.length).toBe(8);
    expect(e.themeId.length).toBe(8);
    expect(e.ageYears.length).toBe(8);
    expect(e.kills.length).toBe(8);
    expect(e.damageDealt.length).toBe(8);
  });

  it('resets the new fields to 0 on a reused slot (alloc → write → free → alloc)', () => {
    const e = createEntities(2);
    const a = allocEntity(e);
    expect(a).not.toBe(-1);
    // Simulate Phase 3 / Phase 4 writes on the live entity.
    e.firstNameIdx[a] = 123;
    e.lastNameIdx[a] = 456;
    e.hometownIdx[a] = 789;
    e.themeId[a] = 1;
    e.ageYears[a] = 42;
    e.kills[a] = 7;
    e.damageDealt[a] = 0xdeadbeef;
    freeEntity(e, a);
    // Re-alloc should hit the freed slot first (LIFO free-list).
    const reused = allocEntity(e);
    expect(reused).toBe(a);
    expect(e.firstNameIdx[reused]).toBe(0);
    expect(e.lastNameIdx[reused]).toBe(0);
    expect(e.hometownIdx[reused]).toBe(0);
    expect(e.themeId[reused]).toBe(0);
    expect(e.ageYears[reused]).toBe(0);
    expect(e.kills[reused]).toBe(0);
    expect(e.damageDealt[reused]).toBe(0);
  });
});

describe('entities — firing fields', () => {
  it('allocEntity initialises new firing fields to defaults', () => {
    const e = createEntities(8);
    const id = allocEntity(e);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(e.stance[id]).toBe(FireStance.ByRanks);
    expect(e.formationRank[id]).toBe(FORMATION_RANK_UNKNOWN);
    expect(e.holdLoaded[id]).toBe(0);
  });
});

describe('crew fields', () => {
  it('initializes parentGunId to -1 and crewRole to 0 on alloc', () => {
    const e = createEntities(8);
    const id = allocEntity(e);
    expect(id).toBe(0);
    expect(e.parentGunId[id]).toBe(-1);
    expect(e.crewRole[id]).toBe(0);
  });
});

describe('isDead', () => {
  it('returns true only for Dying and Dead', () => {
    const e = createEntities(4);
    const id = allocEntity(e);
    const liveStates: EntityState[] = [
      EntityState.Idle,
      EntityState.Moving,
      EntityState.Aiming,
      EntityState.Firing,
      EntityState.Reloading,
      EntityState.Flinch,
      EntityState.Ragdoll,
    ];
    for (const s of liveStates) {
      e.state[id] = s;
      expect(isDead(e, id)).toBe(false);
    }
    e.state[id] = EntityState.Dying;
    expect(isDead(e, id)).toBe(true);
    e.state[id] = EntityState.Dead;
    expect(isDead(e, id)).toBe(true);
  });
});

describe('gun-crew unit kind', () => {
  it('is registered and resolvable', () => {
    const k = getUnitKind('gun-crew-sponger');
    expect(k.id).toBe('gun-crew-sponger');
    expect(getUnitKindIndex('gun-crew-sponger')).toBeGreaterThanOrEqual(0);
  });
});

describe('reloadInitialT field', () => {
  it('initializes reloadInitialT to 0 on alloc', () => {
    const e = createEntities(8);
    const id = allocEntity(e);
    expect(e.reloadInitialT[id]).toBe(0);
  });
});
