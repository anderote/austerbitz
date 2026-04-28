import { describe, it, expect } from 'vitest';
import { createWorld } from '../world';
import { allocEntity, EntityState } from '../entities';
import { ordersSystem } from './orders-system';
import { movementSystem } from './movement-system';
import { getUnitKind, getUnitKindIndex } from '../../data/units';

describe('movement + orders', () => {
  it('moves an entity toward its order target at unit kind speed', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orderQueue.set(id, [{ kind: 'move', targetX: 100, targetY: 0 }]);
    world.systems = [ordersSystem, movementSystem];

    // Run for 1 simulated second at 30hz
    for (let i = 0; i < 30; i++) {
      world.systems.forEach(s => s(world, 1 / 30));
    }
    // line-infantry moveSpeed = 2.5 m/s
    expect(world.entities.posX[id]).toBeCloseTo(2.5, 1);
    expect(world.entities.posY[id]).toBeCloseTo(0, 4);
  });

  it('parks at the final move target on arrival and re-engages if displaced', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orderQueue.set(id, [{ kind: 'move', targetX: 0.05, targetY: 0 }]);
    world.systems = [ordersSystem, movementSystem];

    // Arrival tick: velocity zeros, but the order stays parked so a later
    // collision push can't strand the unit off-slot.
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.orderQueue.get(id)?.length).toBe(1);
    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);

    // Simulate a collision push displacing the unit, then tick again — it
    // should re-engage toward the parked target instead of sitting idle.
    world.entities.posX[id] = 1.5;
    world.entities.posY[id] = 0.8;
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.entities.velX[id]).toBeLessThan(0);
    expect(world.entities.velY[id]).toBeLessThan(0);
  });

  it('dequeues a completed move and starts the next queued order', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orderQueue.set(id, [
      { kind: 'move', targetX: 0.05, targetY: 0 },
      { kind: 'move', targetX: 100, targetY: 0 },
    ]);
    world.systems = [ordersSystem, movementSystem];

    // First tick should snap to and dequeue the first order.
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.orderQueue.get(id)?.length).toBe(1);
    expect(world.orderQueue.get(id)?.[0]?.kind).toBe('move');

    // Second tick should now be moving toward target #2.
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.entities.velX[id]).toBeGreaterThan(0);
  });

  it('parked unit waits out pushedT, then pushes back distance-scaled', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orderQueue.set(id, [{ kind: 'move', targetX: 0.05, targetY: 0 }]);
    world.systems = [ordersSystem, movementSystem];

    // Arrival tick — order becomes parked (arrived=true).
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.orderQueue.get(id)?.[0]).toMatchObject({ arrived: true });

    // Simulate a collision push: displace + arm pushedT.
    world.entities.posX[id] = 1;
    world.entities.posY[id] = 0;
    world.entities.pushedT[id] = 2.5;

    // Mid-cooldown tick: vel must stay zero.
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
    expect(world.entities.pushedT[id]).toBeGreaterThan(0);

    // Burn cooldown to zero (74 ticks leaves pushedT just barely positive,
    // 75 zeroes it but still locks vel for the tick), then run one more
    // tick with the unit still ~1m out of place to read the recovery speed.
    for (let i = 0; i < 76; i++) world.systems.forEach(s => s(world, 1 / 30));

    // Cooldown elapsed: at ~1m displacement, settle factor =
    // min(1, 0.3 + 1*0.5) = 0.8 — meaningful push, not the old 0.3 drift.
    const baseSpeed = getUnitKind('line-infantry').baseStats.moveSpeed;
    expect(world.entities.pushedT[id]).toBe(0);
    expect(world.entities.velX[id]).toBeLessThan(0); // toward target at x=0.05
    const speed = Math.hypot(world.entities.velX[id]!, world.entities.velY[id]!);
    expect(speed).toBeGreaterThan(baseSpeed * 0.5); // pushing harder than old floor
    expect(speed).toBeLessThanOrEqual(baseSpeed); // and at or below cap
  });

  it('idle unit (no order queue entry) drifts back to its rest anchor after pushedT cooldown', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    // Spawned at (50, 50) with no orders — restPos anchors here.
    world.entities.posX[id] = 50;
    world.entities.posY[id] = 50;
    world.entities.restPosX[id] = 50;
    world.entities.restPosY[id] = 50;
    world.systems = [ordersSystem, movementSystem];

    // Shove the unit and arm pushedT (as collision-system would).
    world.entities.posX[id] = 51;
    world.entities.posY[id] = 50;
    world.entities.pushedT[id] = 2.5;

    // During cooldown it stays still.
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);

    // After cooldown, with the unit still ~1m out of place, settle factor is
    // min(1, 0.3 + 1.0*0.5) = 0.8 of base move speed.
    for (let i = 0; i < 76; i++) world.systems.forEach(s => s(world, 1 / 30));
    const baseSpeed = getUnitKind('line-infantry').baseStats.moveSpeed;
    expect(world.entities.velX[id]).toBeLessThan(0); // toward rest x=50
    const speed = Math.hypot(world.entities.velX[id]!, world.entities.velY[id]!);
    expect(speed).toBeGreaterThan(baseSpeed * 0.5);
    expect(speed).toBeLessThanOrEqual(baseSpeed);
  });

  it('initial trip ignores pushedT and uses full speed', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    // Arm pushedT but unit hasn't arrived yet — it should still march.
    world.entities.pushedT[id] = 2.5;
    world.orderQueue.set(id, [{ kind: 'move', targetX: 100, targetY: 0 }]);
    world.systems = [ordersSystem, movementSystem];

    world.systems.forEach(s => s(world, 1 / 30));
    const baseSpeed = getUnitKind('line-infantry').baseStats.moveSpeed;
    expect(world.entities.velX[id]).toBeCloseTo(baseSpeed, 4);
  });

  it('movementSystem does not integrate velocity for a Dying unit', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.velX[id] = 5;
    world.entities.velY[id] = 0;
    world.entities.state[id] = EntityState.Dying;

    movementSystem(world, 0.1);

    expect(world.entities.posX[id]).toBe(0);
    expect(world.entities.posY[id]).toBe(0);
  });

  it('movementSystem does not integrate velocity for a Dead unit', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.velX[id] = 5;
    world.entities.velY[id] = 0;
    world.entities.state[id] = EntityState.Dead;

    movementSystem(world, 0.1);

    expect(world.entities.posX[id]).toBe(0);
  });

  it('drops an attack order whose target is dead', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.orderQueue.set(id, [{ kind: 'attack', targetId: 999 }]);
    world.systems = [ordersSystem];
    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.orderQueue.has(id)).toBe(false);
  });
});
