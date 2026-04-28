import { describe, it, expect, beforeEach } from 'vitest';
import { FireStance, EntityState, allocEntity } from '../entities';
import { createWorld, rebuildGrid } from '../world';
import { createCombatSystem } from './combat-system';
import { tickStates, type FireOrders } from './state-system';
import { getUnitKindIndex } from '../../data/units';
import { writeFireSignal } from '../fire-signal';
import { createProjectiles } from '../projectiles';
import { createParticles } from '../../particles/particles';
import { createPuffs } from '../../puffs/puffs';

// — local helpers (mirrored from combat-system.test.ts patterns) ——————————————

function makeWorld() {
  const world = createWorld({ seed: 1, capacity: 64, mapSize: 200, cellSize: 2 });
  return world;
}

function makeSystem(_world: ReturnType<typeof makeWorld>) {
  const fireOrders: FireOrders = new Map();
  const system = createCombatSystem(fireOrders);
  return { system, fireOrders };
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

// — tests ——————————————————————————————————————————————————————————————————

describe('combat-system — stance behaviour', () => {
  let world: ReturnType<typeof makeWorld>;
  let system: ReturnType<typeof makeSystem>['system'];
  let fireOrders: FireOrders;

  beforeEach(() => {
    world = makeWorld();
    const w = makeSystem(world);
    system = w.system;
    fireOrders = w.fireOrders;
  });

  it('At Will: fires alone immediately when target acquired and loaded', () => {
    const me = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 30, 0); // enemy within 80 m range
    world.entities.stance[me] = FireStance.AtWill;
    world.entities.stateT[me] = 999; // bypass the idle hold
    rebuildGrid(world);
    // Run enough ticks to hit `me`'s stripe (SCAN_PERIOD=8; run 16 covers it twice).
    for (let t = 0; t < 16; t++) {
      system(world, 1 / 60);
      world.tickCount++;
    }
    expect(world.entities.state[me]).toBe(EntityState.Aiming);
  });

  it('Volley: holds Idle initially, then commits to fire after maxHold', () => {
    const projectiles = createProjectiles(16);
    const particles   = createParticles(2048);
    const puffs       = createPuffs(256);

    const me = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 30, 0);
    world.entities.stance[me] = FireStance.Volley;
    rebuildGrid(world);

    // Drive enough ticks for the longest possible Volley maxHold (2.0 s = 120 ticks at 60 Hz).
    // After enough idle time, leader-fire path triggers.
    for (let t = 0; t < 200; t++) {
      system(world, 1 / 60);
      tickStates(
        world.entities, projectiles, particles, puffs,
        world.rng, fireOrders, 1 / 60, world.tickCount,
        world.fireSignal, world.grid,
      );
      world.tickCount++;
    }
    // Should have left Idle by now (Aiming / Reloading / etc.)
    expect(world.entities.state[me]).not.toBe(EntityState.Idle);
  });

  it('By Ranks: rank-0 fire signal does not pull rank-1 in', () => {
    const r0 = spawnLineInfantry(world, 0, 0, 0);
    const r1 = spawnLineInfantry(world, 0, 0, 5); // different position so rank inference doesn't merge them
    spawnLineInfantry(world, 1, 30, 0);
    spawnLineInfantry(world, 1, 30, 5);
    world.entities.stance[r0] = FireStance.ByRanks;
    world.entities.stance[r1] = FireStance.ByRanks;

    // Freeze stateT at 0 so the Idle-hold gate does NOT trigger leader-fire.
    world.entities.stateT[r0] = 0;
    world.entities.stateT[r1] = 0;

    rebuildGrid(world);

    // Run combat-system ticks. Each tick:
    //  - Re-write a fresh rank-0 fire signal in r0's cell.
    //  - Pin formationRank so combat-system doesn't overwrite them on the stripe tick.
    //  - r0 sees a rank-0 hot signal → joins → Aiming.
    //  - r1 reads rank-1 only → no matching signal → stays Idle.
    for (let t = 0; t < 8; t++) {
      writeFireSignal(world.fireSignal, world.grid, 0, 0, 0, 0, world.tickCount);
      world.entities.formationRank[r0] = 0;
      world.entities.formationRank[r1] = 1;
      system(world, 1 / 60);
      world.tickCount++;
    }
    expect(world.entities.state[r0]).toBe(EntityState.Aiming);
    expect(world.entities.state[r1]).toBe(EntityState.Idle);
  });

  it('Hold: never fires; flipping to Volley releases the loaded shot', () => {
    const projectiles = createProjectiles(16);
    const particles   = createParticles(2048);
    const puffs       = createPuffs(256);

    const me = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 30, 0);
    world.entities.stance[me] = FireStance.Hold;

    // Prime the unit into Reloading so that tickStates can complete the cycle
    // and set holdLoaded=1 once reloadT runs out. A freshly-spawned Idle unit
    // never enters Reloading on its own under Hold stance.
    world.entities.state[me] = EntityState.Reloading;
    world.entities.reloadT[me] = 1.0; // 1 s reload left

    rebuildGrid(world);

    // Drive 2 s (120 ticks) — enough to exhaust the 1 s reload and leave
    // the unit Idle with holdLoaded=1. Hold stance blocks it from firing again.
    for (let t = 0; t < 120; t++) {
      system(world, 1 / 60);
      tickStates(
        world.entities, projectiles, particles, puffs,
        world.rng, fireOrders, 1 / 60, world.tickCount,
        world.fireSignal, world.grid,
      );
      world.tickCount++;
    }
    expect(world.entities.state[me]).toBe(EntityState.Idle);
    expect(world.entities.holdLoaded[me]).toBe(1);

    // Flip to Volley — next combat-system ticks should put it into Aiming.
    world.entities.stance[me] = FireStance.Volley;
    world.entities.stateT[me] = 999; // ensure idle-hold gate fires immediately
    for (let t = 0; t < 16; t++) {
      system(world, 1 / 60);
      world.tickCount++;
    }
    expect(world.entities.state[me]).not.toBe(EntityState.Idle);
  });
});
