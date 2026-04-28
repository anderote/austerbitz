import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities, EntityState } from '../entities';
import { createProjectiles } from '../projectiles';
import { createParticles } from '../../particles/particles';
import { createPuffs } from '../../puffs/puffs';
import { createRng } from '../../util/rng';
import { getUnitKindByIndex, getUnitKindIndex } from '../../data/units';
import { triggerFire, tickStates, type FireOrders } from './state-system';
import { createGrid } from '../spatial/grid';
import { createFireSignal } from '../fire-signal';
import { Rank } from '../veterancy';
import { lineInfantry } from '../../data/units/line-infantry';

function makeFireSignalGrid() {
  const grid = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 2, capacity: 8 });
  return { grid, fs: createFireSignal(grid) };
}

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
  const { grid, fs } = makeFireSignalGrid();
  return { e, projectiles, particles, puffs, rng, fireOrders, id, grid, fs };
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
    const { e, projectiles, particles, puffs, rng, fireOrders, id, grid, fs } = setupLineInfantry();
    triggerFire(e, fireOrders, id, 50, 0);

    // One big tick that overshoots the 0.15s windup.
    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.2, 0, fs, grid);

    expect(e.state[id]).toBe(EntityState.Reloading);
    expect(projectiles.count).toBe(1);
    const reload = getUnitKindByIndex(e.kindId[id]!).baseStats.weaponReload;
    // ±20% jitter is applied by tickStates; reloadT must land in that band.
    expect(e.reloadT[id]).toBeGreaterThanOrEqual(reload * 0.8);
    expect(e.reloadT[id]).toBeLessThanOrEqual(reload * 1.2);
    expect(fireOrders.has(id)).toBe(false);
  });

  it('Reloading → Idle once reloadT drains to zero', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id, grid, fs } = setupLineInfantry();
    e.state[id] = EntityState.Reloading;
    e.reloadT[id] = 0.05;

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.1, 0, fs, grid);

    expect(e.state[id]).toBe(EntityState.Idle);
    expect(e.reloadT[id]).toBe(0);
  });

  it('Flinch → Idle once stateT drains to zero', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id, grid, fs } = setupLineInfantry();
    e.state[id] = EntityState.Flinch;
    e.stateT[id] = 0.1;

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.2, 0, fs, grid);

    expect(e.state[id]).toBe(EntityState.Idle);
  });

  it('Dying → Dead once stateT drains to zero', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id, grid, fs } = setupLineInfantry();
    e.state[id] = EntityState.Dying;
    e.stateT[id] = 0.1;

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.2, 0, fs, grid);

    expect(e.state[id]).toBe(EntityState.Dead);
    // Cleanup is a separate pass — alive must still be 1 here.
    expect(e.alive[id]).toBe(1);
  });

  it('recoilT counts down toward 0 each tick regardless of state', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id, grid, fs } = setupLineInfantry();
    e.recoilT[id] = 0.12;
    e.state[id] = EntityState.Idle;

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.05, 0, fs, grid);
    expect(e.recoilT[id]).toBeCloseTo(0.07, 6);

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 1.0, 0, fs, grid);
    expect(e.recoilT[id]).toBe(0);
  });

  it('applies rank reload multiplier on reload restart', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id, grid, fs } = setupLineInfantry();
    e.state[id] = EntityState.Aiming;
    e.stateT[id] = 0;
    e.rank[id] = Rank.Captain;

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 1.0, 0, fs, grid);

    expect(e.state[id]).toBe(EntityState.Reloading);
    // Captain reload multiplier is 0.75; ±20% jitter applied on top.
    // baseStats.weaponReload = 10 → range [10 * 0.75 * 0.8, 10 * 0.75 * 1.2] = [6.0, 9.0]
    const baseReload = lineInfantry.baseStats.weaponReload;
    expect(e.reloadT[id]).toBeGreaterThanOrEqual(baseReload * 0.75 * 0.8);
    expect(e.reloadT[id]).toBeLessThanOrEqual(baseReload * 0.75 * 1.2);
  });

  it('Aiming with no fireOrder entry still transitions to Reloading without spawning anything', () => {
    const { e, projectiles, particles, puffs, rng, fireOrders, id, grid, fs } = setupLineInfantry();
    e.state[id] = EntityState.Aiming;
    e.stateT[id] = 0.05;
    // Deliberately no fireOrders entry.

    tickStates(e, projectiles, particles, puffs, rng, fireOrders, 0.1, 0, fs, grid);

    expect(e.state[id]).toBe(EntityState.Reloading);
    expect(projectiles.count).toBe(0);
  });
});

function allocLineInfantry(e: ReturnType<typeof createEntities>, team: number, x: number, y: number): number {
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('line-infantry');
  e.team[id] = team;
  e.posX[id] = x;
  e.posY[id] = y;
  e.hp[id] = 60;
  e.bodyRadius[id] = 0.45;
  e.massKg[id] = 80;
  return id;
}

describe('tickStates — Idle stateT', () => {
  it('stateT accumulates while in Idle', () => {
    const e = createEntities(8);
    const proj = createProjectiles(4);
    const par = createParticles(4);
    const puff = createPuffs(4);
    const rng = createRng(1);
    const orders: FireOrders = new Map();
    const { grid, fs } = makeFireSignalGrid();

    const id = allocLineInfantry(e, 0, 0, 0);
    e.state[id] = EntityState.Idle;
    e.stateT[id] = 0;

    tickStates(e, proj, par, puff, rng, orders, 1/60, 0, fs, grid);
    expect(e.stateT[id]).toBeCloseTo(1/60, 6);

    tickStates(e, proj, par, puff, rng, orders, 1/60, 1, fs, grid);
    expect(e.stateT[id]).toBeCloseTo(2/60, 6);
  });

  it('stateT resets to 0 on Reloading → Idle transition', () => {
    const e = createEntities(8);
    const proj = createProjectiles(4);
    const par = createParticles(4);
    const puff = createPuffs(4);
    const rng = createRng(1);
    const orders: FireOrders = new Map();
    const { grid, fs } = makeFireSignalGrid();

    const id = allocLineInfantry(e, 0, 0, 0);
    e.state[id] = EntityState.Reloading;
    e.reloadT[id] = 1/120;     // half a tick — drains this tick
    e.stateT[id] = 999;        // stale value to prove the reset

    tickStates(e, proj, par, puff, rng, orders, 1/60, 0, fs, grid);

    expect(e.state[id]).toBe(EntityState.Idle);
    expect(e.stateT[id]).toBe(0);    // reset on the transition tick
  });

  it('writes a fireSignal entry at the firer cell on a successful resolve', () => {
    const e = createEntities(8);
    const proj = createProjectiles(4);
    const par = createParticles(4);
    const puff = createPuffs(4);
    const rng = createRng(1);
    const orders: FireOrders = new Map();
    const { grid, fs } = makeFireSignalGrid();

    const id = allocLineInfantry(e, 0, 50, 50);
    e.team[id] = 0;
    e.state[id] = EntityState.Aiming;
    e.stateT[id] = 0;             // windup elapsed; will resolve this tick
    orders.set(id, { tx: 60, ty: 50 });

    const tick = 17;
    tickStates(e, proj, par, puff, rng, orders, 1/60, tick, fs, grid);

    // Cell at (50,50): cellSize 2 → cx=25, cy=25, cellIndex = 25*50 + 25 = 1275.
    const idx = 1275 * 2 + 0;
    expect(fs.tickByCellTeam[idx]).toBe(tick);
  });
});
