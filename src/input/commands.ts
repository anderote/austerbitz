import type { World, Order } from '../sim/world';
import type { Selection } from './selection';
import type { Vec2 } from '../util/math';
import { computeFormationSlots, assignFormationSlots, liveFormationUnits, syntheticFormationDrag, inferRanksFromPositions, computeMarchSlots } from './formation';
import { createMarchGroup } from '../sim/march-groups';
import type { FormationParams } from './formation-params';

export interface OrderOpts {
  /** Append to the end of each unit's queue instead of replacing it. */
  queue?: boolean;
}

function dispatch(world: World, sel: Selection, mk: (id: number, i: number) => Order, opts: OrderOpts): void {
  if (sel.ids.size === 0) return;
  const ids = Array.from(sel.ids).filter(id => world.entities.alive[id] === 1);
  ids.forEach((id, i) => {
    const order = mk(id, i);
    if (opts.queue) {
      const q = world.orderQueue.get(id);
      if (q) q.push(order);
      else world.orderQueue.set(id, [order]);
    } else {
      world.orderQueue.set(id, [order]);
    }
  });
}

/** Spread destination into a √n×√n grid so units don't all stack at the same point. */
function spreadTarget(target: Vec2, count: number, i: number): Vec2 {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const spacing = 1.4;
  const half = (cols - 1) * spacing * 0.5;
  const cx = i % cols;
  const cy = Math.floor(i / cols);
  return { x: target.x + cx * spacing - half, y: target.y + cy * spacing - half };
}

export interface MoveAssignment { id: number; target: Vec2 }

/**
 * Issues a move that preserves the selection's current shape: each unit's
 * destination is `target + (unit.pos - centroid)`. A single click moves the
 * group as a rigid translation rather than collapsing into a stack/grid.
 * Returns the per-unit targets so callers can render a placement preview.
 */
export function issueMove(world: World, sel: Selection, target: Vec2, opts: OrderOpts = {}): MoveAssignment[] {
  const e = world.entities;
  const ids = Array.from(sel.ids).filter(id => e.alive[id] === 1);
  if (ids.length === 0) return [];
  let cx = 0, cy = 0;
  for (const id of ids) { cx += e.posX[id]!; cy += e.posY[id]!; }
  cx /= ids.length;
  cy /= ids.length;
  const out: MoveAssignment[] = new Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const t: Vec2 = { x: target.x + (e.posX[id]! - cx), y: target.y + (e.posY[id]! - cy) };
    const order: Order = { kind: 'move', targetX: t.x, targetY: t.y };
    if (opts.queue) {
      const q = world.orderQueue.get(id);
      if (q) q.push(order);
      else world.orderQueue.set(id, [order]);
    } else {
      world.orderQueue.set(id, [order]);
    }
    out[i] = { id, target: t };
  }
  return out;
}

export function issueAttackMove(world: World, sel: Selection, target: Vec2, opts: OrderOpts = {}): void {
  const liveCount = Array.from(sel.ids).filter(id => world.entities.alive[id] === 1).length;
  dispatch(world, sel, (_id, i) => {
    const t = spreadTarget(target, liveCount, i);
    return { kind: 'attack-move', targetX: t.x, targetY: t.y };
  }, opts);
}

export function issueAttack(world: World, sel: Selection, targetId: number, opts: OrderOpts = {}): void {
  dispatch(world, sel, () => ({ kind: 'attack', targetId }), opts);
}

export function issueStop(world: World, sel: Selection): void {
  if (sel.ids.size === 0) return;
  for (const id of sel.ids) {
    if (world.entities.alive[id] === 1) world.orderQueue.delete(id);
  }
}

/**
 * Cancel current orders and send each selected unit back to its rest anchor,
 * facing the saved formation direction. The drift-back path in the orders
 * system handles the actual translation; this just clears state and writes
 * the facing intent so the unit rotates correctly on arrival.
 */
export function issueRegroup(world: World, sel: Selection): void {
  if (sel.ids.size === 0) return;
  const e = world.entities;
  for (const id of sel.ids) {
    if (e.alive[id] !== 1) continue;
    world.orderQueue.delete(id);
    e.pushedT[id] = 0;
    const a = (e.restFacing[id]! * Math.PI) / 4;
    e.facingIntentX[id] = Math.cos(a);
    e.facingIntentY[id] = Math.sin(a);
  }
}

export interface FormationAssignment {
  id: number;
  target: Vec2;
  /** Optional unit facing to adopt on arrival; preserved across the move. */
  face?: Vec2;
}

export function issueFormationMove(
  world: World,
  assignments: FormationAssignment[],
  opts: OrderOpts = {},
): void {
  for (const a of assignments) {
    if (world.entities.alive[a.id] !== 1) continue;
    const order: Order = a.face
      ? { kind: 'move', targetX: a.target.x, targetY: a.target.y, faceX: a.face.x, faceY: a.face.y }
      : { kind: 'move', targetX: a.target.x, targetY: a.target.y };
    if (opts.queue) {
      const q = world.orderQueue.get(a.id);
      if (q) q.push(order);
      else world.orderQueue.set(a.id, [order]);
    } else {
      world.orderQueue.set(a.id, [order]);
    }
  }
}

/**
 * Re-form the current selection in place: keep centroid, face `forwardW`,
 * lay out into `ranks` ranks (or sqrt-N if null) at the given spacing.
 * Always replaces the unit's order queue (queue=false), since this is an
 * immediate reposition.
 */
export function issueReformInPlace(
  world: World,
  sel: Selection,
  forwardW: Vec2,
  spacingMult: number,
  ranks: number | null,
): void {
  const units = liveFormationUnits(world, sel.ids);
  if (units.length === 0) return;
  const chosenRanks = ranks ?? inferRanksFromPositions(units, forwardW);
  const { startW, endW } = syntheticFormationDrag(units, forwardW, chosenRanks, spacingMult);
  const { slots, forward } = computeFormationSlots({
    units, startW, endW, spacingMult, ranksOverride: chosenRanks,
  });
  const targets = assignFormationSlots(units, slots, forward);
  const face: Vec2 = { x: forwardW.x, y: forwardW.y };
  const assignments = units.map((u, i) => ({ id: u.id, target: targets[i]!, face }));
  issueFormationMove(world, assignments, { queue: false });
}

/**
 * Re-form the current selection at a target world point: face `forwardW`,
 * lay out into `ranks` ranks (or inferred from current positions if null) at
 * the given spacing. Anchored at `target` rather than the selection centroid.
 */
export function issueReformAtTarget(
  world: World,
  sel: Selection,
  target: Vec2,
  forwardW: Vec2,
  spacingMult: number,
  ranks: number | null,
  opts: OrderOpts = {},
): MoveAssignment[] {
  const units = liveFormationUnits(world, sel.ids);
  if (units.length === 0) return [];
  const chosenRanks = ranks ?? inferRanksFromPositions(units, forwardW);
  const { startW, endW } = syntheticFormationDrag(units, forwardW, chosenRanks, spacingMult, target);
  const { slots, forward } = computeFormationSlots({
    units, startW, endW, spacingMult, ranksOverride: chosenRanks,
  });
  const targets = assignFormationSlots(units, slots, forward);
  const face: Vec2 = { x: forwardW.x, y: forwardW.y };
  const assignments: (MoveAssignment & { face: Vec2 })[] = units.map((u, i) => ({ id: u.id, target: targets[i]!, face }));
  issueFormationMove(world, assignments, opts);
  return assignments;
}

/**
 * March the current selection toward `target` in formation. Pivots the group's
 * facing to point at `target`, lays out pivoted slots anchored at `target`,
 * and dispatches `march-formation` orders. Allocates a fresh march group on
 * the world; the prior group (if any) is reconciled out by march-system on
 * its next tick when each unit's head order no longer references it.
 *
 * Always replaces the queue (no queue option) — repeated Ctrl+RMB is the way
 * to chain marches.
 */
export function issueMarchFormation(
  world: World,
  sel: Selection,
  target: Vec2,
  formationParams: FormationParams,
): void {
  const r = computeMarchSlots(world, sel.ids, target, formationParams);
  if (!r) return;

  const gid = world.nextMarchGroupId++;
  const memberIds = r.units.map(u => u.id);
  world.marchGroups.set(gid, createMarchGroup(gid, memberIds, r.forward, world.simTime));

  for (let i = 0; i < r.units.length; i++) {
    const id = r.units[i]!.id;
    const t = r.targets[i]!;
    world.orderQueue.set(id, [{
      kind: 'march-formation',
      targetX: t.x,
      targetY: t.y,
      groupId: gid,
    }]);
  }
}
