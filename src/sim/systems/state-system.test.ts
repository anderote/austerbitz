import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities, EntityState } from '../entities';
import { createProjectiles } from '../projectiles';
import { createParticles } from '../../particles/particles';
import { createPuffs } from '../../puffs/puffs';
import { createRng } from '../../util/rng';
import { getUnitKindByIndex, getUnitKindIndex } from '../../data/units';
import { triggerFire, tickStates, type FireOrders } from './state-system';

function setupLineInfantry() {
  const e = createEntities(8);
  const projectiles = createProjectiles(16);
  const particles = createParticles(256);
  const puffs = createPuffs(64);
  const rng = createRng(1);
  const fireOrders: FireOrders = new Map();
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('line-infantry');
  e.posX[id] = 0;
  e.posY[id] = 0;
  e.facing[id] = 0; // east
  e.team[id] = 1;
  return { e, projectiles, particles, puffs, rng, fireOrders, id };
}

describe('triggerFire', () => {
  it('sets state=Aiming, stateT=0.15, and stores the aim vector in fireOrders', () => {
    const { e, fireOrders, id } = setupLineInfantry();
    triggerFire(e, fireOrders, id, 50, 0);

    expect(e.state[id]).toBe(EntityState.Aiming);
    expect(e.stateT[id]).toBeCloseTo(0.15, 6);
    expect(fireOrders.get(id)).toEqual({ tx: 50, ty: 0 });
  });
});

describe('tickStates', () => {
  it('Aiming → Reloading after windup elapses; resolves the shot exactly once', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id } = setupLineInfantry();
    triggerFire(e, fireOrders, id, 50, 0);

    // One big tick that overshoots the 0.15s windup.
    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.2);

    expect(e.state[id]).toBe(EntityState.Reloading);
    expect(projectiles.count).toBe(1);
    const reload = getUnitKindByIndex(e.kindId[id]!).baseStats.weaponReload;
    expect(e.reloadT[id]).toBeCloseTo(reload, 6);
    expect(fireOrders.has(id)).toBe(false);
  });

  it('Reloading → Idle once reloadT drains to zero', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Reloading;
    e.reloadT[id] = 0.05;

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.1);

    expect(e.state[id]).toBe(EntityState.Idle);
    expect(e.reloadT[id]).toBe(0);
  });

  it('Flinch → Idle once stateT drains to zero', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Flinch;
    e.stateT[id] = 0.1;

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.2);

    expect(e.state[id]).toBe(EntityState.Idle);
  });

  it('Dying → Dead once stateT drains to zero', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Dying;
    e.stateT[id] = 0.1;

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.2);

    expect(e.state[id]).toBe(EntityState.Dead);
    // Cleanup is a separate pass — alive must still be 1 here.
    expect(e.alive[id]).toBe(1);
  });

  it('recoilT counts down toward 0 each tick regardless of state', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id } = setupLineInfantry();
    e.recoilT[id] = 0.12;
    e.state[id] = EntityState.Idle;

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.05);
    expect(e.recoilT[id]).toBeCloseTo(0.07, 6);

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 1.0);
    expect(e.recoilT[id]).toBe(0);
  });

  it('Aiming with no fireOrder entry still transitions to Reloading without spawning anything', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Aiming;
    e.stateT[id] = 0.05;
    // Deliberately no fireOrders entry.

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.1);

    expect(e.state[id]).toBe(EntityState.Reloading);
    expect(projectiles.count).toBe(0);
  });
});
