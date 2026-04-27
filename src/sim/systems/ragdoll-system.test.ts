import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities, EntityState } from '../entities';
import { getUnitKindIndex } from '../../data/units';
import { tickRagdoll } from './ragdoll-system';

const FRICTION_PER_TICK = 0.92;

function setupRagdoll({
  hp,
  velX,
  velY,
  ragdollT,
}: {
  hp: number;
  velX: number;
  velY: number;
  ragdollT: number;
}) {
  const e = createEntities(8);
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('line-infantry');
  e.posX[id] = 0;
  e.posY[id] = 0;
  e.hp[id] = hp;
  e.velX[id] = velX;
  e.velY[id] = velY;
  e.state[id] = EntityState.Ragdoll;
  e.ragdollT[id] = ragdollT;
  return { e, id };
}

describe('tickRagdoll', () => {
  it('applies per-tick friction to a fast-moving ragdoll', () => {
    const { e, id } = setupRagdoll({ hp: 50, velX: 20, velY: -10, ragdollT: 2.0 });
    const dt = 1 / 30;

    tickRagdoll(e, dt);

    expect(e.state[id]).toBe(EntityState.Ragdoll);
    expect(e.velX[id]).toBeCloseTo(20 * FRICTION_PER_TICK, 5);
    expect(e.velY[id]).toBeCloseTo(-10 * FRICTION_PER_TICK, 5);
    expect(e.ragdollT[id]).toBeCloseTo(2.0 - dt, 5);
  });

  it('hp=0, ragdollT expired, slow velocity → transitions to Dying with stateT=0.5', () => {
    const { e, id } = setupRagdoll({ hp: 0, velX: 0.1, velY: 0.1, ragdollT: 1 / 60 });
    // dt larger than remaining ragdollT so it crosses zero.
    tickRagdoll(e, 1 / 30);

    expect(e.state[id]).toBe(EntityState.Dying);
    expect(e.stateT[id]).toBeCloseTo(0.5, 5);
  });

  it('hp>0, ragdollT expired, slow velocity → transitions to Idle with velocity zeroed', () => {
    const { e, id } = setupRagdoll({ hp: 30, velX: 0.2, velY: -0.2, ragdollT: 1 / 60 });
    tickRagdoll(e, 1 / 30);

    expect(e.state[id]).toBe(EntityState.Idle);
    expect(e.velX[id]).toBe(0);
    expect(e.velY[id]).toBe(0);
  });

  it('non-ragdoll entity (Idle) is untouched', () => {
    const e = createEntities(8);
    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.hp[id] = 50;
    e.velX[id] = 5;
    e.velY[id] = 7;
    e.state[id] = EntityState.Idle;
    e.ragdollT[id] = 1.0;

    tickRagdoll(e, 1 / 30);

    expect(e.state[id]).toBe(EntityState.Idle);
    expect(e.velX[id]).toBe(5);
    expect(e.velY[id]).toBe(7);
    expect(e.ragdollT[id]).toBe(1.0);
  });

  it('does not transition while still moving fast even after ragdollT expires', () => {
    const { e, id } = setupRagdoll({ hp: 0, velX: 10, velY: 0, ragdollT: 1 / 60 });
    tickRagdoll(e, 1 / 30);

    // ragdollT is past zero, but speed (10 * 0.92 = 9.2) is well above the
    // 0.5 m/s rest threshold, so the entity stays in Ragdoll.
    expect(e.state[id]).toBe(EntityState.Ragdoll);
    expect(e.velX[id]).toBeCloseTo(10 * FRICTION_PER_TICK, 5);
  });
});
