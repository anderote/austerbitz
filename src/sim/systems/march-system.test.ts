import { describe, it, expect } from 'vitest';
import { createWorld, rebuildGrid } from '../world';
import { allocEntity, EntityState } from '../entities';
import { getUnitKindIndex } from '../../data/units';
import { createMarchGroup } from '../march-groups';
import { marchSystem, VOLLEY_DURATION, MARCH_SCAN_PERIOD } from './march-system';

function spawnInfantry(world: ReturnType<typeof createWorld>, team: number, x: number, y: number, ready = true): number {
  const e = world.entities;
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('line-infantry'); // weaponRange 80
  e.team[id] = team;
  e.posX[id] = x;
  e.posY[id] = y;
  e.state[id] = EntityState.Idle;
  e.reloadT[id] = ready ? 0 : 5;
  return id;
}

function alignTickToScan(world: ReturnType<typeof createWorld>, gid: number): void {
  // Force (tickCount + gid) % MARCH_SCAN_PERIOD === 0.
  world.tickCount = MARCH_SCAN_PERIOD - (gid % MARCH_SCAN_PERIOD);
}

describe('marchSystem', () => {
  it('group with no enemies stays in march phase', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawnInfantry(world, 0, 0, 0);
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [id], { x: 1, y: 0 }, 0));
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);
    rebuildGrid(world);
    alignTickToScan(world, gid);

    marchSystem(world, 1 / 60);

    expect(world.marchGroups.get(gid)!.phase).toBe('march');
  });

  it('reloaded armed member with an enemy in range triggers volley', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    world.simTime = 1.5;
    const shooter = spawnInfantry(world, 0, 0, 0, true);
    spawnInfantry(world, 1, 50, 0); // enemy 50m, in 80m range
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [shooter], { x: 1, y: 0 }, 0));
    world.orderQueue.set(shooter, [{ kind: 'march-formation', targetX: 200, targetY: 0, groupId: gid }]);
    rebuildGrid(world);
    alignTickToScan(world, gid);

    marchSystem(world, 1 / 60);

    const g = world.marchGroups.get(gid)!;
    expect(g.phase).toBe('volley');
    expect(g.phaseStartT).toBe(1.5);
  });

  it('volley does NOT trigger if all candidate shooters are reloading', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const shooter = spawnInfantry(world, 0, 0, 0, false); // still reloading
    spawnInfantry(world, 1, 50, 0);
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [shooter], { x: 1, y: 0 }, 0));
    world.orderQueue.set(shooter, [{ kind: 'march-formation', targetX: 200, targetY: 0, groupId: gid }]);
    rebuildGrid(world);
    alignTickToScan(world, gid);

    marchSystem(world, 1 / 60);

    expect(world.marchGroups.get(gid)!.phase).toBe('march');
  });

  it('volley returns to march after VOLLEY_DURATION sim seconds', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    world.simTime = VOLLEY_DURATION + 1;
    const id = spawnInfantry(world, 0, 0, 0);
    const gid = 1;
    const g = createMarchGroup(gid, [id], { x: 1, y: 0 }, /* phaseStartT */ 0);
    g.phase = 'volley';
    world.marchGroups.set(gid, g);
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 200, targetY: 0, groupId: gid }]);
    rebuildGrid(world);

    marchSystem(world, 1 / 60);

    expect(world.marchGroups.get(gid)!.phase).toBe('march');
    expect(world.marchGroups.get(gid)!.phaseStartT).toBeCloseTo(VOLLEY_DURATION + 1, 5);
  });

  it('group with all-dead members is deleted', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawnInfantry(world, 0, 0, 0);
    world.entities.alive[id] = 0;
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [id], { x: 1, y: 0 }, 0));
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 200, targetY: 0, groupId: gid }]);
    rebuildGrid(world);

    marchSystem(world, 1 / 60);

    expect(world.marchGroups.has(gid)).toBe(false);
  });

  it('member whose head order no longer references this group is removed', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawnInfantry(world, 0, 0, 0);
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [id], { x: 1, y: 0 }, 0));
    // Head order is a plain move now (e.g., player issued RMB after the march).
    world.orderQueue.set(id, [{ kind: 'move', targetX: 50, targetY: 0 }]);
    rebuildGrid(world);

    marchSystem(world, 1 / 60);

    expect(world.marchGroups.has(gid)).toBe(false);
  });

  it('does not trigger volley off-stripe (tick gating)', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const shooter = spawnInfantry(world, 0, 0, 0, true);
    spawnInfantry(world, 1, 50, 0);
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [shooter], { x: 1, y: 0 }, 0));
    world.orderQueue.set(shooter, [{ kind: 'march-formation', targetX: 200, targetY: 0, groupId: gid }]);
    rebuildGrid(world);
    // Off-stripe: (tick + gid) % SCAN_PERIOD !== 0
    world.tickCount = 0; // gid=1, (0+1)%8 = 1 ≠ 0 → off-stripe

    marchSystem(world, 1 / 60);

    expect(world.marchGroups.get(gid)!.phase).toBe('march');
  });
});

describe('marchSystem paceMaxDist', () => {
  it('computes max distance from each member to its slot', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnInfantry(world, 0, 0, 0);
    const b = spawnInfantry(world, 0, 10, 0);
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [a, b], { x: 1, y: 0 }, 0));
    // Slots: a's slot at (50, 0) → distance 50; b's slot at (52, 0) → distance 42.
    world.orderQueue.set(a, [{ kind: 'march-formation', targetX: 50, targetY: 0, groupId: gid }]);
    world.orderQueue.set(b, [{ kind: 'march-formation', targetX: 52, targetY: 0, groupId: gid }]);
    rebuildGrid(world);

    marchSystem(world, 1 / 60);

    expect(world.marchGroups.get(gid)!.paceMaxDist).toBeCloseTo(50, 5);
  });

  it('reflects the live max across both march and volley phases', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnInfantry(world, 0, 0, 0);
    const gid = 1;
    const g = createMarchGroup(gid, [a], { x: 1, y: 0 }, 0);
    g.phase = 'volley';
    world.marchGroups.set(gid, g);
    world.orderQueue.set(a, [{ kind: 'march-formation', targetX: 30, targetY: 40, groupId: gid }]);
    rebuildGrid(world);

    marchSystem(world, 1 / 60);

    // Distance = sqrt(30² + 40²) = 50, even in volley phase.
    expect(world.marchGroups.get(gid)!.paceMaxDist).toBeCloseTo(50, 5);
  });

  it('paceMaxDist is ~0 when all members are at their slots', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    // Spawn at (100, 0) — exactly at the target slot.
    const a = spawnInfantry(world, 0, 100, 0);
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [a], { x: 1, y: 0 }, 0));
    world.orderQueue.set(a, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);
    rebuildGrid(world);

    marchSystem(world, 1 / 60);

    expect(world.marchGroups.get(gid)!.paceMaxDist).toBeLessThanOrEqual(0.01);
  });
});
