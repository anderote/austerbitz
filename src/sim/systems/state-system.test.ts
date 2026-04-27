import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities, EntityState } from '../entities';
import { createProjectiles } from '../projectiles';
import { createParticles } from '../../particles/particles';
import { createRng } from '../../util/rng';
import { getUnitKindByIndex, getUnitKindIndex } from '../../data/units';
import { triggerFire, tickStates, type FireOrders } from './state-system';
import { Pose } from '../../render/poses/pose-config';

function pickClipRef(id: number, tick: number, n: number): number {
  if (n <= 1) return 0;
  let h = (Math.imul(id, 2654435761) ^ Math.imul(tick, 1597334677)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) % n;
}

function setupLineInfantry() {
  const e = createEntities(8);
  const projectiles = createProjectiles(16);
  const particles = createParticles(256);
  const rng = createRng(1);
  const fireOrders: FireOrders = new Map();
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('line-infantry');
  e.posX[id] = 0;
  e.posY[id] = 0;
  e.facing[id] = 0; // east
  e.team[id] = 1;
  return { e, projectiles, particles, rng, fireOrders, id };
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
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    triggerFire(e, fireOrders, id, 50, 0);

    // One big tick that overshoots the 0.15s windup.
    tickStates(e, projectiles, particles, rng, fireOrders, 0.2, 0);

    expect(e.state[id]).toBe(EntityState.Reloading);
    expect(projectiles.count).toBe(1);
    const reload = getUnitKindByIndex(e.kindId[id]!).baseStats.weaponReload;
    // ±20% jitter is applied by tickStates; reloadT must land in that band.
    expect(e.reloadT[id]).toBeGreaterThanOrEqual(reload * 0.8);
    expect(e.reloadT[id]).toBeLessThanOrEqual(reload * 1.2);
    expect(fireOrders.has(id)).toBe(false);
  });

  it('Reloading → Idle once reloadT drains to zero', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Reloading;
    e.reloadT[id] = 0.05;

    tickStates(e, projectiles, particles, rng, fireOrders, 0.1, 0);

    expect(e.state[id]).toBe(EntityState.Idle);
    expect(e.reloadT[id]).toBe(0);
  });

  it('Flinch → Idle once stateT drains to zero', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Flinch;
    e.stateT[id] = 0.1;

    tickStates(e, projectiles, particles, rng, fireOrders, 0.2, 0);

    expect(e.state[id]).toBe(EntityState.Idle);
  });

  it('Dying → Dead once stateT drains to zero', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Dying;
    e.stateT[id] = 0.1;

    tickStates(e, projectiles, particles, rng, fireOrders, 0.2, 0);

    expect(e.state[id]).toBe(EntityState.Dead);
    // Cleanup is a separate pass — alive must still be 1 here.
    expect(e.alive[id]).toBe(1);
  });

  it('recoilT counts down toward 0 each tick regardless of state', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.recoilT[id] = 0.12;
    e.state[id] = EntityState.Idle;

    tickStates(e, projectiles, particles, rng, fireOrders, 0.05, 0);
    expect(e.recoilT[id]).toBeCloseTo(0.07, 6);

    tickStates(e, projectiles, particles, rng, fireOrders, 1.0, 0);
    expect(e.recoilT[id]).toBe(0);
  });

  it('Aiming with no fireOrder entry still transitions to Reloading without spawning anything', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Aiming;
    e.stateT[id] = 0.05;
    // Deliberately no fireOrders entry.

    tickStates(e, projectiles, particles, rng, fireOrders, 0.1, 0);

    expect(e.state[id]).toBe(EntityState.Reloading);
    expect(projectiles.count).toBe(0);
  });
});

describe('tickStates pose mapping', () => {
  it('new entity starts with idle pose, poseT=0, clipIndex=0', () => {
    const { e, id } = setupLineInfantry();
    expect(e.pose[id]).toBe(Pose.idle);
    expect(e.poseT[id]).toBe(0);
    expect(e.clipIndex[id]).toBe(0);
  });

  it('Moving + walking speed → walking pose with reset poseT and deterministic clipIndex', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Moving;
    e.velX[id] = 10;
    e.velY[id] = 0;

    const tick = 7;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.05, tick);

    expect(e.pose[id]).toBe(Pose.walking);
    expect(e.poseT[id]).toBe(0);
    expect(e.clipIndex[id]).toBe(pickClipRef(id, tick, 256) & 0xff);
  });

  it('crossing run threshold mid-Moving transitions walking → running and resets poseT', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Moving;
    e.velX[id] = 10;
    e.velY[id] = 0;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.05, 1);
    expect(e.pose[id]).toBe(Pose.walking);

    e.velX[id] = 100;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.05, 2);

    expect(e.pose[id]).toBe(Pose.running);
    expect(e.poseT[id]).toBe(0);
  });

  it('poseT accumulates dt while pose stays the same', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Moving;
    e.velX[id] = 10;
    e.velY[id] = 0;

    tickStates(e, projectiles, particles, rng, fireOrders, 0.1, 0);
    expect(e.pose[id]).toBe(Pose.walking);
    expect(e.poseT[id]).toBe(0);

    tickStates(e, projectiles, particles, rng, fireOrders, 0.1, 1);
    expect(e.pose[id]).toBe(Pose.walking);
    expect(e.poseT[id]).toBeCloseTo(0.1, 6);

    tickStates(e, projectiles, particles, rng, fireOrders, 0.1, 2);
    expect(e.poseT[id]).toBeCloseTo(0.2, 6);
  });

  it('Aiming → aiming pose', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Aiming;
    e.stateT[id] = 1;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.01, 0);
    expect(e.pose[id]).toBe(Pose.aiming);
  });

  it('Firing → firing pose', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Firing;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.01, 0);
    expect(e.pose[id]).toBe(Pose.firing);
  });

  it('Reloading → reloading pose', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Reloading;
    e.reloadT[id] = 5;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.01, 0);
    expect(e.pose[id]).toBe(Pose.reloading);
  });

  it('Flinch → flinch pose', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Flinch;
    e.stateT[id] = 1;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.01, 0);
    expect(e.pose[id]).toBe(Pose.flinch);
  });

  it('Ragdoll → ragdoll pose', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Ragdoll;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.01, 0);
    expect(e.pose[id]).toBe(Pose.ragdoll);
  });

  it('Dying → dying pose', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Dying;
    e.stateT[id] = 1;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.01, 0);
    expect(e.pose[id]).toBe(Pose.dying);
  });

  it('Dead → dead pose', () => {
    const { e, projectiles, particles, rng, fireOrders, id } = setupLineInfantry();
    e.state[id] = EntityState.Dead;
    tickStates(e, projectiles, particles, rng, fireOrders, 0.01, 0);
    expect(e.pose[id]).toBe(Pose.dead);
  });
});
