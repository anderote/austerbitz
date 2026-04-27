import { describe, it, expect } from 'vitest';
import { createWorld } from '../world';
import { allocEntity, EntityState } from '../entities';
import { getUnitKindIndex } from '../../data/units';
import { rebuildGrid } from '../world';
import { createCombatSystem } from './combat-system';
import type { FireOrders } from './state-system';

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
    // line-infantry moveSpeed is 2.5 m/s — well above the 0.05 m/s gate.
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
    // Below the 0.05 m/s gate.
    world.entities.velX[shooter] = 0.01;
    world.entities.velY[shooter] = 0;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(target);
    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
  });
});
