import type { World, Order } from '../sim/world';
import type { Selection } from './selection';
import type { Vec2 } from '../util/math';

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

export function issueMove(world: World, sel: Selection, target: Vec2, opts: OrderOpts = {}): void {
  const liveCount = Array.from(sel.ids).filter(id => world.entities.alive[id] === 1).length;
  dispatch(world, sel, (_id, i) => {
    const t = spreadTarget(target, liveCount, i);
    return { kind: 'move', targetX: t.x, targetY: t.y };
  }, opts);
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

export interface FormationAssignment {
  id: number;
  target: Vec2;
}

export function issueFormationMove(
  world: World,
  assignments: FormationAssignment[],
  opts: OrderOpts = {},
): void {
  for (const a of assignments) {
    if (world.entities.alive[a.id] !== 1) continue;
    const order: Order = { kind: 'move', targetX: a.target.x, targetY: a.target.y };
    if (opts.queue) {
      const q = world.orderQueue.get(a.id);
      if (q) q.push(order);
      else world.orderQueue.set(a.id, [order]);
    } else {
      world.orderQueue.set(a.id, [order]);
    }
  }
}
