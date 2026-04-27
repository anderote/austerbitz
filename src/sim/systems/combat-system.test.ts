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
});
