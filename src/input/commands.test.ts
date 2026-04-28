import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createSelection } from './selection';
import { issueMove, issueAttack, issueAttackMove, issueStop, issueRegroup, issueFormationMove, issueMarchFormation, issueHurryToSlots } from './commands';
import { createFormationParams } from './formation-params';

function spawn(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex('line-infantry');
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

function spawnWithKind(world: ReturnType<typeof createWorld>, kind: string, team: number, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex(kind);
  world.entities.team[id] = team;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

describe('commands', () => {
  it('issueMove replaces the queue by default', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(id);
    world.orderQueue.set(id, [{ kind: 'move', targetX: 999, targetY: 999 }]);
    issueMove(world, sel, { x: 10, y: 0 });
    const q = world.orderQueue.get(id)!;
    expect(q.length).toBe(1);
    expect(q[0]).toMatchObject({ kind: 'move', targetX: 10, targetY: 0 });
  });

  it('issueMove with queue: true appends', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(id);
    issueMove(world, sel, { x: 10, y: 0 });
    issueMove(world, sel, { x: 20, y: 0 }, { queue: true });
    const q = world.orderQueue.get(id)!;
    expect(q.length).toBe(2);
    expect(q[1]).toMatchObject({ kind: 'move', targetX: 20, targetY: 0 });
  });

  it('issueMove preserves the selection shape via centroid translation', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    // Two units 4 apart. Centroid is (2, 0).
    const a = spawn(world, 0, 0);
    const b = spawn(world, 4, 0);
    const sel = createSelection(); sel.ids.add(a); sel.ids.add(b);
    // Click at (10, 0). Expect targets (8, 0) and (12, 0) — same shape, translated.
    const assignments = issueMove(world, sel, { x: 10, y: 0 });
    const byId = new Map(assignments.map(x => [x.id, x.target]));
    expect(byId.get(a)).toEqual({ x: 8, y: 0 });
    expect(byId.get(b)).toEqual({ x: 12, y: 0 });
    expect(world.orderQueue.get(a)![0]).toMatchObject({ kind: 'move', targetX: 8, targetY: 0 });
    expect(world.orderQueue.get(b)![0]).toMatchObject({ kind: 'move', targetX: 12, targetY: 0 });
  });

  it('issueMove returns an empty list for an empty selection', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const sel = createSelection();
    const out = issueMove(world, sel, { x: 0, y: 0 });
    expect(out).toEqual([]);
  });

  it('issueAttack writes an attack order with the target id', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const enemy = spawn(world, 5, 5);
    const sel = createSelection(); sel.ids.add(id);
    issueAttack(world, sel, enemy);
    expect(world.orderQueue.get(id)).toEqual([{ kind: 'attack', targetId: enemy }]);
  });

  it('issueAttackMove writes an attack-move order at the target', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(id);
    issueAttackMove(world, sel, { x: 50, y: 50 });
    const q = world.orderQueue.get(id)!;
    expect(q[0]).toMatchObject({ kind: 'attack-move', targetX: 50, targetY: 50 });
  });

  it('issueStop clears each selected unit\'s queue', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(id);
    world.orderQueue.set(id, [{ kind: 'move', targetX: 1, targetY: 1 }]);
    issueStop(world, sel);
    expect(world.orderQueue.has(id)).toBe(false);
  });

  it('all commands skip dead entities in the selection', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const sel = createSelection(); sel.ids.add(42); // never alive
    issueMove(world, sel, { x: 1, y: 1 });
    issueAttack(world, sel, 0);
    issueAttackMove(world, sel, { x: 1, y: 1 });
    issueStop(world, sel);
    expect(world.orderQueue.size).toBe(0);
  });

  it('issueRegroup clears active orders, pushedT, and writes restFacing intent', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawn(world, 5, 0);
    const sel = createSelection(); sel.ids.add(id);
    world.entities.restFacing[id] = 4; // facing -X
    world.entities.facingIntentX[id] = 1; // currently facing +X (wrong)
    world.entities.facingIntentY[id] = 0;
    world.entities.pushedT[id] = 1.5;
    world.orderQueue.set(id, [{ kind: 'move', targetX: 99, targetY: 99 }]);

    issueRegroup(world, sel);

    expect(world.orderQueue.has(id)).toBe(false);
    expect(world.entities.pushedT[id]).toBe(0);
    expect(world.entities.facingIntentX[id]).toBeCloseTo(-1, 4);
    expect(world.entities.facingIntentY[id]).toBeCloseTo(0, 4);
  });
});

describe('issueFormationMove', () => {
  it('issues one move order per assignment, replacing existing queue', () => {
    const world = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const sel = createSelection();
    const a = spawnWithKind(world, 'line-infantry', 0, 0, 0);
    const b = spawnWithKind(world, 'line-infantry', 0, 1, 0);
    sel.ids.add(a); sel.ids.add(b);
    world.orderQueue.set(a, [{ kind: 'move', targetX: 99, targetY: 99 }]);

    issueFormationMove(world, [
      { id: a, target: { x: 10, y: 20 } },
      { id: b, target: { x: 11, y: 20 } },
    ]);

    const qa = world.orderQueue.get(a)!;
    const qb = world.orderQueue.get(b)!;
    expect(qa.length).toBe(1);
    expect(qa[0]).toEqual({ kind: 'move', targetX: 10, targetY: 20 });
    expect(qb[0]).toEqual({ kind: 'move', targetX: 11, targetY: 20 });
  });

  it('queue=true appends instead of replacing', () => {
    const world = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const sel = createSelection();
    const a = spawnWithKind(world, 'line-infantry', 0, 0, 0);
    sel.ids.add(a);
    world.orderQueue.set(a, [{ kind: 'move', targetX: 1, targetY: 1 }]);

    issueFormationMove(world, [{ id: a, target: { x: 5, y: 5 } }], { queue: true });

    const qa = world.orderQueue.get(a)!;
    expect(qa.length).toBe(2);
    expect(qa[1]).toEqual({ kind: 'move', targetX: 5, targetY: 5 });
  });

  it('skips dead units silently', () => {
    const world = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const a = spawnWithKind(world, 'line-infantry', 0, 0, 0);
    world.entities.alive[a] = 0;
    issueFormationMove(world, [{ id: a, target: { x: 5, y: 5 } }]);
    expect(world.orderQueue.get(a)).toBeUndefined();
  });
});

describe('issueMarchFormation', () => {
  it('empty selection is a no-op', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const sel = createSelection();
    issueMarchFormation(world, sel, { x: 100, y: 0 }, createFormationParams());
    expect(world.marchGroups.size).toBe(0);
  });

  it('creates a new march group whose members match the live selection', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    const b = spawn(world, 4, 0);
    world.entities.team[a] = 0; world.entities.team[b] = 0;
    const sel = createSelection(); sel.ids.add(a); sel.ids.add(b);

    issueMarchFormation(world, sel, { x: 100, y: 0 }, createFormationParams());

    expect(world.marchGroups.size).toBe(1);
    const [, g] = [...world.marchGroups.entries()][0]!;
    expect([...g.members].sort()).toEqual([a, b].sort());
    expect(g.phase).toBe('march');
    // Forward should be roughly +x (centroid is (2,0), target (100,0)).
    expect(g.forward.x).toBeGreaterThan(0.99);
    expect(Math.abs(g.forward.y)).toBeLessThan(0.01);
  });

  it('each member receives a march-formation order with the same groupId', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    const b = spawn(world, 4, 0);
    const sel = createSelection(); sel.ids.add(a); sel.ids.add(b);

    issueMarchFormation(world, sel, { x: 100, y: 0 }, createFormationParams());

    const [gid] = [...world.marchGroups.keys()];
    const qa = world.orderQueue.get(a)![0]!;
    const qb = world.orderQueue.get(b)![0]!;
    expect(qa.kind).toBe('march-formation');
    expect(qb.kind).toBe('march-formation');
    expect((qa as { groupId: number }).groupId).toBe(gid);
    expect((qb as { groupId: number }).groupId).toBe(gid);
  });

  it('replaces existing orders on each unit', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    world.orderQueue.set(a, [{ kind: 'move', targetX: 999, targetY: 999 }]);
    const sel = createSelection(); sel.ids.add(a);

    issueMarchFormation(world, sel, { x: 100, y: 0 }, createFormationParams());

    const q = world.orderQueue.get(a)!;
    expect(q.length).toBe(1);
    expect(q[0]!.kind).toBe('march-formation');
  });

  it('re-issuing on the same selection allocates a new groupId; prior group is reconciled out by march-system on next tick', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(a);

    issueMarchFormation(world, sel, { x: 100, y: 0 }, createFormationParams());
    const [gid1] = [...world.marchGroups.keys()];

    issueMarchFormation(world, sel, { x: 50, y: 0 }, createFormationParams());
    const gids = [...world.marchGroups.keys()];

    // Both groups exist immediately after dispatch. The old one's only member
    // now has a head order that references the NEW group, so march-system will
    // remove the member and dissolve the old group on its next tick.
    expect(gids).toContain(gid1);
    expect(gids.length).toBe(2);
    expect(world.nextMarchGroupId).toBeGreaterThan(gid1!);
  });

  it('skips dead selected units', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    const b = spawn(world, 4, 0);
    world.entities.alive[b] = 0;
    const sel = createSelection(); sel.ids.add(a); sel.ids.add(b);

    issueMarchFormation(world, sel, { x: 100, y: 0 }, createFormationParams());

    const [, g] = [...world.marchGroups.entries()][0]!;
    expect([...g.members]).toEqual([a]);
  });
});

describe('issueHurryToSlots', () => {
  it('clears arrived on a parked move so the unit re-engages at full speed', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(a);
    world.orderQueue.set(a, [{ kind: 'move', targetX: 50, targetY: 0, arrived: true }]);

    issueHurryToSlots(world, sel);

    const q = world.orderQueue.get(a)!;
    expect(q.length).toBe(1);
    expect(q[0]).toMatchObject({ kind: 'move', targetX: 50, targetY: 0, arrived: false });
  });

  it('preserves the queue tail behind a move head', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(a);
    world.orderQueue.set(a, [
      { kind: 'move', targetX: 50, targetY: 0, arrived: true },
      { kind: 'move', targetX: 100, targetY: 0 },
    ]);

    issueHurryToSlots(world, sel);

    const q = world.orderQueue.get(a)!;
    expect(q.length).toBe(2);
    expect(q[1]).toMatchObject({ kind: 'move', targetX: 100, targetY: 0 });
  });

  it('rewrites a march-formation head to a move at the same slot, facing group.forward', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    const sel = createSelection(); sel.ids.add(a);
    issueMarchFormation(world, sel, { x: 100, y: 0 }, createFormationParams());
    const [gid, group] = [...world.marchGroups.entries()][0]!;
    const headBefore = world.orderQueue.get(a)![0] as { kind: string; targetX: number; targetY: number; groupId: number };
    expect(headBefore.kind).toBe('march-formation');
    expect(headBefore.groupId).toBe(gid);

    issueHurryToSlots(world, sel);

    const q = world.orderQueue.get(a)!;
    expect(q.length).toBe(1);
    const head = q[0]! as { kind: string; targetX: number; targetY: number; faceX: number; faceY: number };
    expect(head.kind).toBe('move');
    expect(head.targetX).toBeCloseTo(headBefore.targetX);
    expect(head.targetY).toBeCloseTo(headBefore.targetY);
    expect(head.faceX).toBeCloseTo(group.forward.x);
    expect(head.faceY).toBeCloseTo(group.forward.y);
  });

  it('falls back to rest anchor + restFacing for idle / non-move heads', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 5, 7);
    world.entities.restPosX[a] = 10;
    world.entities.restPosY[a] = 20;
    world.entities.restFacing[a] = 2; // PI/2 → (0, 1)
    const sel = createSelection(); sel.ids.add(a);

    issueHurryToSlots(world, sel);

    const q = world.orderQueue.get(a)!;
    expect(q.length).toBe(1);
    const head = q[0]! as { kind: string; targetX: number; targetY: number; faceX: number; faceY: number };
    expect(head.kind).toBe('move');
    expect(head.targetX).toBe(10);
    expect(head.targetY).toBe(20);
    expect(head.faceX).toBeCloseTo(0);
    expect(head.faceY).toBeCloseTo(1);
  });

  it('replaces an attack-move head with a rest-anchor move', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    world.entities.restPosX[a] = 3;
    world.entities.restPosY[a] = 4;
    world.entities.restFacing[a] = 0;
    world.orderQueue.set(a, [{ kind: 'attack-move', targetX: 999, targetY: 999 }]);
    const sel = createSelection(); sel.ids.add(a);

    issueHurryToSlots(world, sel);

    const q = world.orderQueue.get(a)!;
    expect(q.length).toBe(1);
    expect(q[0]).toMatchObject({ kind: 'move', targetX: 3, targetY: 4 });
  });

  it('skips dead selected units', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawn(world, 0, 0);
    world.entities.alive[a] = 0;
    const sel = createSelection(); sel.ids.add(a);

    issueHurryToSlots(world, sel);

    expect(world.orderQueue.get(a)).toBeUndefined();
  });
});
