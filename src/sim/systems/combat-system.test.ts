import { describe, it, expect } from 'vitest';
import { createWorld } from '../world';
import { allocEntity, EntityState } from '../entities';
import { getUnitKindIndex, getUnitKindByIndex } from '../../data/units';
import { rebuildGrid } from '../world';
import { createCombatSystem } from './combat-system';
import type { FireOrders } from './state-system';
import { tickStates } from './state-system';
import { tickProjectiles } from './projectile-system';
import { createProjectiles } from '../projectiles';
import { createParticles } from '../../particles/particles';
import { createPuffs } from '../../puffs/puffs';
import { writeFireSignal } from '../fire-signal';
import { maxHoldFor } from './combat-system';

function makeWorld() {
  const world = createWorld({ seed: 1, capacity: 64, mapSize: 200, cellSize: 2 });
  return world;
}

function spawnLineInfantry(world: ReturnType<typeof makeWorld>, team: number, x: number, y: number): number {
  const e = world.entities;
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('line-infantry');
  e.team[id] = team;
  e.posX[id] = x;
  e.posY[id] = y;
  e.hp[id] = 60;
  e.bodyRadius[id] = 0.45;
  e.massKg[id] = 80;
  e.state[id] = EntityState.Idle;
  return id;
}

describe('combatSystem', () => {
  it('fires when an idle armed unit has an enemy in weapon range', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const target  = spawnLineInfantry(world, 1, 50, 0); // 50 m, well inside 80 m range

    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(world.entities.targetId[shooter]).toBe(target);
    expect(fireOrders.get(shooter)).toEqual({ tx: 50, ty: 0 });
  });

  it('does not fire while reloading', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.state[shooter] = EntityState.Reloading;
    world.entities.reloadT[shooter] = 5;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Reloading);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not fire while aiming', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.state[shooter] = EntityState.Aiming;
    world.entities.stateT[shooter] = 0.1;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not fire while flinching', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.state[shooter] = EntityState.Flinch;
    world.entities.stateT[shooter] = 0.2;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Flinch);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not fire when the unit kind has no weapon (cuirassier)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = allocEntity(world.entities);
    world.entities.kindId[shooter] = getUnitKindIndex('cuirassier');
    world.entities.team[shooter] = 0;
    world.entities.posX[shooter] = 0;
    world.entities.posY[shooter] = 0;
    world.entities.state[shooter] = EntityState.Idle;
    spawnLineInfantry(world, 1, 1, 0); // adjacent enemy, well inside any range

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not fire on same-team units even when they are the closest', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 0, 5, 0);   // friendly, very close
    const enemy   = spawnLineInfantry(world, 1, 60, 0); // farther but enemy

    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(enemy);
    expect(fireOrders.get(shooter)).toEqual({ tx: 60, ty: 0 });
  });

  it('stays idle when no enemies are in range', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 81, 0); // 1 m beyond 80 m musket range

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not fire while marching (velocity above epsilon)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    // line-infantry moveSpeed is 2.5 m/s — well above the 1.0 m/s gate.
    world.entities.velX[shooter] = 2.5;
    world.entities.velY[shooter] = 0;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('fires once velocity decays below epsilon (e.g. arrived at destination)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const target  = spawnLineInfantry(world, 1, 50, 0);
    // Below the 1.0 m/s gate.
    world.entities.velX[shooter] = 0.01;
    world.entities.velY[shooter] = 0;

    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(target);
    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
  });

  it('fires while drifting back to rest anchor at settle speed', () => {
    // orders-system sends parked/idle units back to their rest anchor at
    // baseSpeed * 0.3 ≈ 0.75 m/s for line-infantry. Without this allowance,
    // a single collision shove silences a unit for the entire drift back.
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const target  = spawnLineInfantry(world, 1, 50, 0);
    world.entities.velX[shooter] = 0.75;
    world.entities.velY[shooter] = 0;

    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(target);
    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
  });

  it('fires at an enemy exactly at weaponRange (inclusive boundary)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const target  = spawnLineInfantry(world, 1, 80, 0); // exactly 80 m

    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(target);
  });

  it('acquires one of multiple in-range enemies (first-valid, no closest guarantee)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const a = spawnLineInfantry(world, 1, 70, 0);
    const b = spawnLineInfantry(world, 1, 30, 0);

    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    const picked = world.entities.targetId[shooter]!;
    expect(picked === a || picked === b).toBe(true);
  });

  it('skips enemies in Dying / Dead / Ragdoll and falls through to the next-nearest', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const corpseNear = spawnLineInfantry(world, 1, 20, 0);
    const aliveFar   = spawnLineInfantry(world, 1, 60, 0);
    world.entities.state[corpseNear] = EntityState.Dying;

    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(aliveFar);
  });

  it('skips a Ragdoll target and a Dead target', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const ragdoll = spawnLineInfantry(world, 1, 10, 0);
    const dead    = spawnLineInfantry(world, 1, 20, 0);
    const alive   = spawnLineInfantry(world, 1, 30, 0);
    world.entities.state[ragdoll] = EntityState.Ragdoll;
    world.entities.state[dead]    = EntityState.Dead;

    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(alive);
  });

  it('a lone idle armed soldier with a target waits and does not fire on the first tick', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;   // freshly idle

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('a lone idle soldier eventually fires once stateT >= maxHoldFor(id)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    // Force stateT past any possible maxHold so we know it fires THIS tick.
    world.entities.stateT[shooter] = 999;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(world.entities.stateT[shooter]).toBeCloseTo(0.15, 6);  // full leader windup
  });

  it('a hot same-team fireSignal in the 3x3 neighbourhood causes immediate fire with 0 windup', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;

    // Plant a fresh signal in shooter's own cell, same team, current tick.
    writeFireSignal(world.fireSignal, world.grid, 0, 0, 0, world.tickCount);

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(world.entities.stateT[shooter]).toBe(0);   // join windup
  });

  it('an out-of-radius signal does not trigger join', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;

    // 12 m away — outside the 3x3 cell neighbourhood (radius ~5–6 m).
    writeFireSignal(world.fireSignal, world.grid, 12, 0, 0, world.tickCount);

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('a fresh signal from the OTHER team is ignored', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;

    writeFireSignal(world.fireSignal, world.grid, 0, 0, 1, world.tickCount); // team 1

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('a stale signal (older than VOLLEY_WINDOW_TICKS) is ignored', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;

    // 50 ticks old at tickCount=0 — write at tick=-50.
    world.tickCount = 50;
    writeFireSignal(world.fireSignal, world.grid, 0, 0, 0, 0);  // age 50 > window

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not acquire enemies outside weaponRange; acquires + fires once they enter it', () => {
    // line-infantry weaponRange = 80. Enemy at 100 m is out of range and
    // is not acquired. After moving to 60 m, the next stripe scan picks
    // it up and fire triggers (stateT past maxHold).
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const enemy   = spawnLineInfantry(world, 1, 100, 0);

    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(-1);
    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);

    world.entities.posX[enemy] = 60;
    world.entities.stateT[shooter] = 999;
    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(enemy);
    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(fireOrders.get(shooter)).toEqual({ tx: 60, ty: 0 });
  });

  it('maxHoldFor returns a value within [MAX_HOLD_MIN_S, MAX_HOLD_MAX_S]', () => {
    for (let id = 0; id < 200; id++) {
      const v = maxHoldFor(id);
      expect(v).toBeGreaterThanOrEqual(0.20);
      expect(v).toBeLessThanOrEqual(0.60);
    }
  });
});

describe('combat pipeline integration', () => {
  it('idle → aiming → reloading transitions and projectile is spawned', () => {
    const world = makeWorld();
    const projectiles = createProjectiles(16);
    const particles = createParticles(2048);
    const puffs = createPuffs(256);
    const fireOrders: FireOrders = new Map();
    const combat = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);

    const dt = 1 / 60;

    world.entities.stateT[shooter] = 999;
    // Tick 1: combat picks the target and triggers Aiming. State-system advances stateT.
    rebuildGrid(world);
    combat(world, dt);
    tickStates(world.entities, projectiles, particles, puffs, world.rng, fireOrders, dt, 0, world.fireSignal, world.grid);
    tickProjectiles(projectiles, world.entities, world.grid, puffs, particles, world.rng, world.debris, dt, world.bloodSplats);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(projectiles.count).toBe(0);

    // Run enough ticks to outlast the 0.15 s aiming windup. After Aiming
    // expires, state-system resolves the shot (spawning a projectile via
    // fire-resolver) and transitions to Reloading.
    let peakProjectiles = 0;
    for (let i = 0; i < 12; i++) {
      rebuildGrid(world);
      combat(world, dt);
      tickStates(world.entities, projectiles, particles, puffs, world.rng, fireOrders, dt, 0, world.fireSignal, world.grid);
      tickProjectiles(projectiles, world.entities, world.grid, puffs, particles, world.rng, world.debris, dt, world.bloodSplats);
      peakProjectiles = Math.max(peakProjectiles, projectiles.count);
    }

    expect(world.entities.state[shooter]).toBe(EntityState.Reloading);

    // Projectile may have hit, missed, or still be in flight by the end of
    // the loop — but we know at least one was spawned along the way.
    expect(peakProjectiles).toBeGreaterThanOrEqual(1);

    // Reload countdown is in progress. Upper bound covers the ±20% reload
    // jitter applied by state-system at the firing transition.
    const reloadTotal = getUnitKindByIndex(world.entities.kindId[shooter]!).baseStats.weaponReload;
    expect(world.entities.reloadT[shooter]).toBeGreaterThan(0);
    expect(world.entities.reloadT[shooter]).toBeLessThanOrEqual(reloadTotal * 1.2);
  });
});
