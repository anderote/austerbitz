import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities, EntityState } from '../entities';
import { createParticles } from '../../particles/particles';
import { createRng } from '../../util/rng';
import { getUnitKindIndex } from '../../data/units';
import { createBloodSplats } from '../blood-splats';
import {
  applyHit,
  enterFlinch,
  KILL_RAGDOLL_THRESHOLD,
  KNOCKBACK_THRESHOLD,
} from './combat-events';

function setupLineInfantry(hp = 60) {
  const e = createEntities(8);
  const particles = createParticles(64);
  const rng = createRng(1);
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('line-infantry');
  e.posX[id] = 0;
  e.posY[id] = 0;
  e.hp[id] = hp;
  return { e, particles, rng, id };
}

function setupCuirassier(hp = 140) {
  const e = createEntities(8);
  const particles = createParticles(64);
  const rng = createRng(1);
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('cuirassier');
  e.posX[id] = 0;
  e.posY[id] = 0;
  e.hp[id] = hp;
  return { e, particles, rng, id };
}

describe('applyHit', () => {
  it('musket hit: low impulse on a survivor flinches and emits blood', () => {
    const { e, particles, rng, id } = setupLineInfantry(60);
    applyHit(e, particles, rng, id, 12, 12, 0, 'musket');

    expect(e.state[id]).toBe(EntityState.Flinch);
    expect(e.stateT[id]).toBeCloseTo(0.3, 5);
    expect(e.hp[id]).toBe(48); // 60 − (12 − 0 armor)
    expect(particles.count).toBeGreaterThan(0);
    // Flinch zeroes velocity, no ragdoll → no impulse delta.
    expect(e.velX[id]).toBe(0);
    expect(e.velY[id]).toBe(0);
  });

  it('musket kill at low HP: enters Dying, hp clamped to 0, blood spawned', () => {
    const { e, particles, rng, id } = setupLineInfantry(5);
    applyHit(e, particles, rng, id, 12, 12, 0, 'musket');

    expect(e.state[id]).toBe(EntityState.Dying);
    expect(e.stateT[id]).toBeCloseTo(0.5, 5);
    expect(e.hp[id]).toBe(0);
    expect(particles.count).toBeGreaterThan(0);
    expect(e.velX[id]).toBe(0);
    expect(e.velY[id]).toBe(0);
  });

  it('cannon graze: survives but big impulse → Ragdoll with impulse applied', () => {
    const { e, particles, rng, id } = setupLineInfantry(60);
    const impX = 5000;
    expect(impX).toBeGreaterThan(KNOCKBACK_THRESHOLD);
    applyHit(e, particles, rng, id, 30, impX, 0, 'cannon');

    expect(e.state[id]).toBe(EntityState.Ragdoll);
    expect(e.ragdollT[id]).toBeCloseTo(2.0, 5);
    expect(e.hp[id]).toBe(30); // 60 − 30
    // Half of the impulse is applied on a non-kill ragdoll. mass = 80.
    expect(e.velX[id]).toBeGreaterThan(0);
    expect(e.velX[id]).toBeCloseTo((impX * 0.5) / 80, 5);
  });

  it('cannon kill with massive impulse → Ragdoll (will transition via ragdoll-system)', () => {
    const { e, particles, rng, id } = setupLineInfantry(30);
    const impX = 8000 + 1; // strictly greater than KILL_RAGDOLL_THRESHOLD
    expect(impX).toBeGreaterThan(KILL_RAGDOLL_THRESHOLD);
    applyHit(e, particles, rng, id, 80, impX, 0, 'cannon');

    expect(e.state[id]).toBe(EntityState.Ragdoll);
    expect(e.ragdollT[id]).toBeCloseTo(2.0, 5);
    expect(e.hp[id]).toBe(0);
    // Full impulse on kill ragdoll. mass = 80.
    expect(e.velX[id]).toBeGreaterThan(0);
    expect(e.velX[id]).toBeCloseTo(impX / 80, 5);
  });

  it('dead entity is a no-op', () => {
    const { e, particles, rng, id } = setupLineInfantry(60);
    e.alive[id] = 0;
    const stateBefore = e.state[id];
    const hpBefore = e.hp[id];
    const countBefore = particles.count;

    applyHit(e, particles, rng, id, 12, 12, 0, 'musket');

    expect(e.state[id]).toBe(stateBefore);
    expect(e.hp[id]).toBe(hpBefore);
    expect(particles.count).toBe(countBefore);
  });

  it('Dying entity is a no-op (no state reset, no blood)', () => {
    const { e, particles, rng, id } = setupLineInfantry(60);
    e.state[id] = EntityState.Dying;
    e.stateT[id] = 0.2;
    e.hp[id] = 0;
    const countBefore = particles.count;

    applyHit(e, particles, rng, id, 12, 5000, 0, 'cannon');

    expect(e.state[id]).toBe(EntityState.Dying);
    expect(e.stateT[id]).toBeCloseTo(0.2, 5);
    expect(e.hp[id]).toBe(0);
    expect(particles.count).toBe(countBefore);
  });

  it('Dead entity is a no-op (no state reset, no blood)', () => {
    const { e, particles, rng, id } = setupLineInfantry(60);
    e.state[id] = EntityState.Dead;
    e.hp[id] = 0;
    const countBefore = particles.count;

    applyHit(e, particles, rng, id, 50, 9000, 0, 'cannon');

    expect(e.state[id]).toBe(EntityState.Dead);
    expect(e.hp[id]).toBe(0);
    expect(particles.count).toBe(countBefore);
  });

  it('armor reduces damage (cuirassier armor 4)', () => {
    const { e, particles, rng, id } = setupCuirassier(140);
    applyHit(e, particles, rng, id, 10, 12, 0, 'musket');
    // 10 − 4 = 6 effective damage
    expect(e.hp[id]).toBe(134);
  });

  it('damage has a floor of 1 even when armor exceeds raw damage', () => {
    const { e, particles, rng, id } = setupCuirassier(140);
    applyHit(e, particles, rng, id, 2, 12, 0, 'musket');
    // max(1, 2 − 4) = 1
    expect(e.hp[id]).toBe(139);
  });

  // Note: applyHit no longer pushes ground-stain splats at the hit location.
  // Splats are now stamped by individual Blood particles when they expire
  // mid-flight (see updateParticles in particles.ts), so the spray itself
  // determines where blood lands. The test below verifies that integration.
  it('does not push any stain splats directly — particles are now the source', () => {
    const { e, particles, rng, id } = setupLineInfantry(5);
    const splats = createBloodSplats(64);
    applyHit(e, particles, rng, id, 12, 12, 0, 'musket', splats);
    expect(e.hp[id]).toBe(0);
    // The splats arg is accepted for API stability but unused — count stays 0.
    expect(splats.count).toBe(0);
    // …but blood particles were emitted, and they'll stamp the ground when
    // they land (verified in particles.test.ts).
    expect(particles.count).toBeGreaterThan(0);
  });

  it('omitting splats argument leaves combat behaviour untouched', () => {
    const { e, particles, rng, id } = setupLineInfantry(60);
    applyHit(e, particles, rng, id, 12, 12, 0, 'musket');
    expect(e.state[id]).toBe(EntityState.Flinch);
  });
});

describe('enterFlinch', () => {
  it('zeroes velocity and sets Flinch state', () => {
    const e = createEntities(4);
    const id = allocEntity(e);
    e.kindId[id] = getUnitKindIndex('line-infantry');
    e.velX[id] = 5;
    e.velY[id] = -3;

    enterFlinch(e, id);

    expect(e.state[id]).toBe(EntityState.Flinch);
    expect(e.stateT[id]).toBeCloseTo(0.3, 5);
    expect(e.velX[id]).toBe(0);
    expect(e.velY[id]).toBe(0);
  });
});
