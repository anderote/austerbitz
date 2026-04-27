# RTS-Style Selection & Command Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Never commit at the end of a task — the user controls commit boundaries.**

**Goal:** Replace Austerbitz's minimal selection/command wiring with an SC2/Red-Alert-style scheme: own-team marquee, modifier-aware clicks, double-click select-by-type, attack-move, stop, queued orders, and 10 control groups.

**Architecture:** A new `SelectionController` module owns all click/drag/double-click/key state and modifier interpretation, and writes to a shared `Selection` and the existing `world.orderQueue`. The order data model becomes a queue per entity (front = active) so shift+RMB can append. Selection hit-tests gain priority-pick and team filtering. Render adds per-team ring color, queued waypoint markers, a cursor-mode CSS swap, and a click-feedback puff.

**Tech Stack:** TypeScript, Vite, Vitest, WebGL2. No new deps.

**Spec:** `docs/superpowers/specs/2026-04-26-rts-controls-design.md`

**Conventions for every task:**
- Tests live next to the code (`*.test.ts`) per `vitest.config.ts` (`include: ['src/**/*.test.ts']`).
- Run a single test: `npx vitest run src/path/file.test.ts`. Run all: `npm test`. Typecheck: `npm run typecheck`.
- Vitest `globals: true` is on — `describe/it/expect` are ambient. Existing tests still import them explicitly; match that style.
- Never commit. After each task, stop and report what changed; the user will commit.

---

## Task 1: Player team + order-queue refactor

**Files:**
- Create: `src/sim/player.ts`
- Modify: `src/sim/world.ts`
- Modify: `src/sim/systems/orders-system.ts`
- Modify: `src/sim/systems/movement-system.test.ts` (existing tests use the old API)
- Modify: `src/input/commands.ts` (existing `issueMoveOrder` writes to old map)
- Modify: `src/main.ts` (only if it touches `world.orders`)

This task changes the sim data model. Subsequent tasks build on it.

- [ ] **Step 1: Create `src/sim/player.ts`**

```ts
/** The team id treated as "the player's units" by selection and commands. */
export const PLAYER_TEAM = 0;
```

- [ ] **Step 2: Modify `Order` union + queue field in `src/sim/world.ts`**

Replace the `Order` union and `orders` field. Keep everything else.

```ts
// Before:
//   orders: Map<number, Order>;
//   export type Order =
//     | { kind: 'move'; targetX: number; targetY: number };
//
// After:
export type Order =
  | { kind: 'move'; targetX: number; targetY: number }
  | { kind: 'attack'; targetId: number }
  | { kind: 'attack-move'; targetX: number; targetY: number }
  | { kind: 'stop' };

export interface World {
  // ... unchanged fields ...
  /** Per-entity order queue. Front (index 0) is the active order. */
  orderQueue: Map<number, Order[]>;
}
```

In `createWorld`, initialize `orderQueue: new Map()` (and remove the old `orders` field).

- [ ] **Step 3: Update `src/sim/systems/orders-system.ts` to consume the queue**

```ts
import type { System } from '../world';
import { getUnitKindByIndex } from '../../data/units';

const ARRIVE_RADIUS = 0.1; // m

export const ordersSystem: System = (world, _dt) => {
  const e = world.entities;
  for (const [id, queue] of world.orderQueue) {
    if (e.alive[id] === 0 || queue.length === 0) {
      world.orderQueue.delete(id);
      continue;
    }
    // 'stop' should be resolved eagerly: clear queue, idle.
    if (queue[0]!.kind === 'stop') {
      e.velX[id] = 0;
      e.velY[id] = 0;
      world.orderQueue.delete(id);
      continue;
    }
    const order = queue[0]!;
    if (order.kind === 'move' || order.kind === 'attack-move') {
      const dx = order.targetX - e.posX[id]!;
      const dy = order.targetY - e.posY[id]!;
      const dist = Math.hypot(dx, dy);
      if (dist <= ARRIVE_RADIUS) {
        e.velX[id] = 0;
        e.velY[id] = 0;
        queue.shift();
        if (queue.length === 0) world.orderQueue.delete(id);
        continue;
      }
      const speed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed;
      e.velX[id] = (dx / dist) * speed;
      e.velY[id] = (dy / dist) * speed;
    } else if (order.kind === 'attack') {
      // Stub until combat lands. If the target is dead, drop the order.
      if (e.alive[order.targetId] === 0) {
        queue.shift();
        if (queue.length === 0) world.orderQueue.delete(id);
        continue;
      }
      e.velX[id] = 0;
      e.velY[id] = 0;
    }
  }
};
```

- [ ] **Step 4: Update existing call sites that reference `world.orders`**

Update `src/input/commands.ts` so `issueMoveOrder` writes to `orderQueue` (interim — Task 3 replaces this whole file):

```ts
export function issueMoveOrder(world: World, sel: Selection, target: Vec2): void {
  if (sel.ids.size === 0) return;
  const ids = Array.from(sel.ids).filter(id => world.entities.alive[id] === 1);
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  const spacing = 1.4;
  const half = (cols - 1) * spacing * 0.5;
  ids.forEach((id, i) => {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    const tx = target.x + cx * spacing - half;
    const ty = target.y + cy * spacing - half;
    world.orderQueue.set(id, [{ kind: 'move', targetX: tx, targetY: ty }]);
  });
}
```

- [ ] **Step 5: Update `src/sim/systems/movement-system.test.ts` to use the queue**

Replace the two `world.orders.set(id, { ... })` calls with `world.orderQueue.set(id, [{ ... }])`. Replace the `expect(world.orders.has(id)).toBe(false)` assertion with `expect(world.orderQueue.has(id)).toBe(false)`.

- [ ] **Step 6: Add a new test for queue dequeueing in `src/sim/systems/movement-system.test.ts`**

Add inside the existing `describe('movement + orders', ...)`:

```ts
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

it('drops an attack order whose target is dead', () => {
  const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex('line-infantry');
  world.orderQueue.set(id, [{ kind: 'attack', targetId: 999 }]);
  world.systems = [ordersSystem];
  world.systems.forEach(s => s(world, 1 / 30));
  expect(world.orderQueue.has(id)).toBe(false);
});
```

- [ ] **Step 7: Run all tests and typecheck**

```
npm test
npm run typecheck
```

Expected: all green. Both old movement tests still pass with the queue, and the two new tests pass.

- [ ] **Step 8: Pause for user review.** Do not commit.

---

## Task 2: Selection hit-test enrichments

**Files:**
- Modify: `src/input/selection.ts`
- Modify: `src/input/selection.test.ts`

Adds priority-pick (closest center to cursor) + team filtering + new `findSameKindInView`.

- [ ] **Step 1: Write failing tests in `src/input/selection.test.ts`**

Append inside `describe('selection', ...)`:

```ts
it('hitTestPoint returns the closest-center entity when AABBs overlap', () => {
  const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
  const a = spawnAt(world, 'line-infantry', 100, 100);
  const b = spawnAt(world, 'line-infantry', 100.4, 100);
  // Both AABBs contain (100.3, 100); b's center is closer.
  expect(hitTestPoint(world, { x: 100.3, y: 100 })).toBe(b);
  // Reverse: closer to a.
  expect(hitTestPoint(world, { x: 100.05, y: 100 })).toBe(a);
});

it('hitTestPoint with team filter ignores off-team entities', () => {
  const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
  const a = spawnAt(world, 'line-infantry', 100, 100);
  world.entities.team[a] = 1;
  expect(hitTestPoint(world, { x: 100, y: 100 }, { team: 0 })).toBe(-1);
  expect(hitTestPoint(world, { x: 100, y: 100 }, { team: 1 })).toBe(a);
});

it('hitTestRect with team filter excludes off-team entities', () => {
  const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
  const own = spawnAt(world, 'line-infantry', 50, 50);
  const enemy = spawnAt(world, 'line-infantry', 60, 60);
  world.entities.team[enemy] = 1;
  expect(hitTestRect(world, 0, 0, 100, 100, { team: 0 })).toEqual([own]);
});

it('findSameKindInView returns matching kind/team within the view rect', () => {
  const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
  const k = getUnitKindIndex('line-infantry');
  const a = spawnAt(world, 'line-infantry', 10, 10);
  const b = spawnAt(world, 'line-infantry', 20, 20);
  const farAway = spawnAt(world, 'line-infantry', 500, 500);
  const wrongKind = spawnAt(world, 'cuirassier', 15, 15);
  void farAway; void wrongKind;
  const ids = findSameKindInView(world, k, { x0: 0, y0: 0, x1: 50, y1: 50 });
  expect(ids.sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
});
```

Add the new imports at the top of the test file:

```ts
import { createSelection, hitTestPoint, hitTestRect, findSameKindInView } from './selection';
```

- [ ] **Step 2: Run tests, confirm they fail**

```
npx vitest run src/input/selection.test.ts
```

Expected: `findSameKindInView is not a function`, plus the new options-object signatures and priority-pick assertions fail.

- [ ] **Step 3: Update `src/input/selection.ts`**

Replace the file body (keep the `Selection`/`DragRect` types and creators):

```ts
import type { World } from '../sim/world';
import type { Vec2 } from '../util/math';
import { getUnitKindByIndex } from '../data/units';

export interface Selection {
  ids: Set<number>;
}

export interface DragRect {
  start: Vec2;       // screen
  current: Vec2;     // screen
  active: boolean;
}

export interface ViewRect {
  x0: number; y0: number;
  x1: number; y1: number;
}

export interface HitOpts {
  /** If provided, only entities with this team id are considered. */
  team?: number;
}

export function createSelection(): Selection {
  return { ids: new Set() };
}

export function createDragRect(): DragRect {
  return {
    start: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    active: false,
  };
}

/**
 * Returns the entity whose AABB contains `w` and whose center is closest to `w`.
 * Tie-break: lower entity id.
 */
export function hitTestPoint(world: World, w: Vec2, opts: HitOpts = {}): number {
  const e = world.entities;
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    if (opts.team !== undefined && e.team[i] !== opts.team) continue;
    const kind = getUnitKindByIndex(e.kindId[i]!);
    const dx = w.x - e.posX[i]!;
    const dy = w.y - e.posY[i]!;
    if (Math.abs(dx) > kind.placeholderSize.w / 2) continue;
    if (Math.abs(dy) > kind.placeholderSize.h / 2) continue;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 || (d2 === bestD2 && i < best)) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

export function hitTestRect(
  world: World,
  x0: number, y0: number, x1: number, y1: number,
  opts: HitOpts = {},
): number[] {
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  const out: number[] = [];
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    if (opts.team !== undefined && e.team[i] !== opts.team) continue;
    const x = e.posX[i]!;
    const y = e.posY[i]!;
    if (x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y) out.push(i);
  }
  return out;
}

export function findSameKindInView(
  world: World,
  kindId: number,
  view: ViewRect,
  opts: HitOpts = {},
): number[] {
  const out: number[] = [];
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    if (e.kindId[i] !== kindId) continue;
    if (opts.team !== undefined && e.team[i] !== opts.team) continue;
    const x = e.posX[i]!;
    const y = e.posY[i]!;
    if (x >= view.x0 && x <= view.x1 && y >= view.y0 && y <= view.y1) out.push(i);
  }
  return out;
}
```

- [ ] **Step 4: Re-run tests; expect all green**

```
npx vitest run src/input/selection.test.ts
npm run typecheck
```

- [ ] **Step 5: Pause for user review.** Do not commit.

---

## Task 3: Commands API rewrite

**Files:**
- Modify: `src/input/commands.ts`
- Create: `src/input/commands.test.ts`

Replaces `issueMoveOrder` with the four-verb API. Removes the old function entirely; later tasks call the new ones.

- [ ] **Step 1: Write failing tests in `src/input/commands.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createSelection } from './selection';
import { issueMove, issueAttack, issueAttackMove, issueStop } from './commands';

function spawn(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex('line-infantry');
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
});
```

- [ ] **Step 2: Run tests, expect failure** (`issueMove`/`issueAttack`/`issueAttackMove`/`issueStop` not exported)

```
npx vitest run src/input/commands.test.ts
```

- [ ] **Step 3: Replace `src/input/commands.ts` body**

```ts
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
```

- [ ] **Step 4: Update the import in `src/main.ts`**

Change:

```ts
import { issueMoveOrder } from './input/commands';
```

to:

```ts
import { issueMove } from './input/commands';
```

And replace the call `issueMoveOrder(world, selection, w);` with `issueMove(world, selection, w);`. (The old function is gone; this keeps the file building until Task 4 rewires it.)

- [ ] **Step 5: Run tests + typecheck**

```
npm test
npm run typecheck
```

Expected: all green, including the existing movement tests (which use the queue from Task 1).

- [ ] **Step 6: Pause for user review.** Do not commit.

---

## Task 4: SelectionController scaffold (parity with current behavior)

**Files:**
- Create: `src/input/selection-controller.ts`
- Modify: `src/main.ts`

This task builds the controller's public shape and migrates the existing behavior into it. Behavior is unchanged at the end of this task — every later task layers on new rules.

- [ ] **Step 1: Create `src/input/selection-controller.ts`**

```ts
import type { Camera } from '../render/camera';
import { screenToWorld } from '../render/camera';
import type { World } from '../sim/world';
import { PLAYER_TEAM } from '../sim/player';
import { hitTestPoint, hitTestRect, type Selection, type DragRect } from './selection';
import { issueMove } from './commands';

export type CursorMode = 'normal' | 'attack-move';

export interface SelectionControllerDeps {
  canvas: HTMLCanvasElement;
  overlayRoot: HTMLElement;
  camera: Camera;
  world: World;
  selection: Selection;
  drag: DragRect;
}

export interface SelectionController {
  readonly cursorMode: CursorMode;
  /** Called once per frame. Currently a no-op; reserved for per-frame work. */
  update(dt: number): void;
  destroy(): void;
  /** Test seam — exposes pure handlers for unit tests. Do not use from app code. */
  readonly _internals: ControllerInternals;
}

interface ControllerInternals {
  onMouseDown(e: { button: number; clientX: number; clientY: number; target: EventTarget | null }): void;
  onMouseMove(e: { clientX: number; clientY: number }): void;
  onMouseUp(e: { button: number; clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void;
  onKeyDown(e: { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void;
  onBlur(): void;
  getCursorMode(): CursorMode;
}

const DRAG_THRESHOLD_PX = 4;

export function createSelectionController(deps: SelectionControllerDeps): SelectionController {
  const { overlayRoot, camera, world, selection, drag } = deps;

  let cursorMode: CursorMode = 'normal';
  let pendingClickStart: { x: number; y: number } | null = null;

  function isOnHud(target: EventTarget | null): boolean {
    return target instanceof Node && overlayRoot.contains(target);
  }

  function onMouseDown(e: { button: number; clientX: number; clientY: number; target: EventTarget | null }): void {
    if (e.button !== 0) return;
    if (isOnHud(e.target)) return;
    pendingClickStart = { x: e.clientX, y: e.clientY };
    drag.start = { x: e.clientX, y: e.clientY };
    drag.current = { x: e.clientX, y: e.clientY };
    drag.active = false;
  }

  function onMouseMove(e: { clientX: number; clientY: number }): void {
    if (!pendingClickStart) return;
    drag.current = { x: e.clientX, y: e.clientY };
    const dx = e.clientX - pendingClickStart.x;
    const dy = e.clientY - pendingClickStart.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.active = true;
  }

  function onMouseUp(e: { button: number; clientX: number; clientY: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    if (e.button === 0) {
      if (!pendingClickStart) return;
      const additive = e.shiftKey;
      if (drag.active) {
        const a = screenToWorld(camera, drag.start);
        const b = screenToWorld(camera, drag.current);
        const ids = hitTestRect(world, a.x, a.y, b.x, b.y, { team: PLAYER_TEAM });
        if (!additive) selection.ids.clear();
        for (const id of ids) selection.ids.add(id);
      } else {
        const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
        const id = hitTestPoint(world, w);
        if (!additive) selection.ids.clear();
        if (id !== -1) selection.ids.add(id);
      }
      drag.active = false;
      pendingClickStart = null;
      return;
    }
    if (e.button === 2) {
      const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      issueMove(world, selection, w);
      return;
    }
  }

  function onKeyDown(e: { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
    if (e.key === 'Escape') {
      if (cursorMode !== 'normal') {
        cursorMode = 'normal';
        return;
      }
      selection.ids.clear();
    }
  }

  function onBlur(): void {
    pendingClickStart = null;
    drag.active = false;
    cursorMode = 'normal';
  }

  // DOM bindings — narrow event types pass through to the pure handlers above.
  const md = (e: MouseEvent) => onMouseDown({ button: e.button, clientX: e.clientX, clientY: e.clientY, target: e.target });
  const mm = (e: MouseEvent) => onMouseMove({ clientX: e.clientX, clientY: e.clientY });
  const mu = (e: MouseEvent) => onMouseUp({ button: e.button, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
  const kd = (e: KeyboardEvent) => onKeyDown({ key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
  const bl = () => onBlur();

  window.addEventListener('mousedown', md);
  window.addEventListener('mousemove', mm);
  window.addEventListener('mouseup', mu);
  window.addEventListener('keydown', kd);
  window.addEventListener('blur', bl);

  return {
    get cursorMode() { return cursorMode; },
    update(_dt) { /* reserved */ },
    destroy() {
      window.removeEventListener('mousedown', md);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', mu);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('blur', bl);
    },
    _internals: { onMouseDown, onMouseMove, onMouseUp, onKeyDown, onBlur, getCursorMode: () => cursorMode },
  };
}
```

- [ ] **Step 2: Rewire `src/main.ts` to use the controller**

Replace the imports for `hitTestPoint`, `hitTestRect`, and `issueMove` (the controller now imports them) and delete the manual listener block (lines that handle LMB selection, Escape, and RMB move). Add:

```ts
import { createSelectionController } from './input/selection-controller';
// ...
const controller = createSelectionController({
  canvas, overlayRoot: overlay, camera, world, selection, drag,
});
```

In the frame loop, add `controller.update(dt);` next to the other per-frame updates.

Concretely, the lines to delete in `src/main.ts` are everything from the comment `// Selection input handlers (left mouse button)` down to the closing brace of the second `mouseup` handler (the RMB block) — i.e. the block currently around lines 69–118. Also remove the keydown handler that calls `selection.ids.clear()` on Escape; the controller handles it.

Also remove now-unused imports: `hitTestPoint`, `hitTestRect`, `screenToWorld`, `issueMove` (they're only used inside the controller now). Keep `createSelection` and `createDragRect`.

- [ ] **Step 3: Manual smoke test**

```
npm run dev
```

Open the printed URL. Verify:
- LMB click on a unit selects it (ring appears).
- LMB drag selects multiple units.
- Shift+click adds to selection.
- Esc clears selection.
- RMB issues a move order (units walk to point).
- Middle-drag pan / wheel-zoom still work.

- [ ] **Step 4: Run tests + typecheck**

```
npm test
npm run typecheck
```

Expected: all green. No tests target the controller yet — Task 5 starts that.

- [ ] **Step 5: Pause for user review.** Do not commit.

---

## Task 5: Modifier rules — Shift toggle, Shift drag, marquee fallback, own-team filter

**Files:**
- Modify: `src/input/selection-controller.ts`
- Create: `src/input/selection-controller.test.ts`

Implements the SC2-style click rules from the spec's "Selection rules" table.

- [ ] **Step 1: Set up `src/input/selection-controller.test.ts` with helpers**

```ts
import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createSelection, createDragRect } from './selection';
import { createSelectionController } from './selection-controller';
import { createCamera } from '../render/camera';

function makeDeps() {
  const camera = createCamera();
  camera.viewport = { w: 800, h: 600 };
  camera.center = { x: 0, y: 0 };
  camera.zoom = 1;
  const world = createWorld({ seed: 1, capacity: 32, mapSize: 1000 });
  const selection = createSelection();
  const drag = createDragRect();
  // Detached HUD root (nothing inside it) so isOnHud is always false in tests.
  const overlayRoot = { contains: (_n: Node) => false } as unknown as HTMLElement;
  const canvas = {} as unknown as HTMLCanvasElement;
  // Don't actually attach DOM listeners — the controller calls window.addEventListener,
  // which works in node only because we never dispatch real events; we use _internals.
  const ctrl = createSelectionController({ canvas, overlayRoot, camera, world, selection, drag });
  return { ctrl, world, selection, drag, camera };
}

function spawn(world: ReturnType<typeof createWorld>, kind: string, team: number, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex(kind);
  world.entities.team[id] = team;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

/** Helper: simulate a click (mousedown + immediate mouseup, no movement). */
function click(ctrl: ReturnType<typeof createSelectionController>, x: number, y: number, mods: { shift?: boolean; ctrl?: boolean; button?: number } = {}) {
  const button = mods.button ?? 0;
  ctrl._internals.onMouseDown({ button, clientX: x, clientY: y, target: null });
  ctrl._internals.onMouseUp({ button, clientX: x, clientY: y, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, metaKey: false });
}

/** Helper: simulate a drag (mousedown, move, mouseup). */
function drag(ctrl: ReturnType<typeof createSelectionController>, x0: number, y0: number, x1: number, y1: number, mods: { shift?: boolean } = {}) {
  ctrl._internals.onMouseDown({ button: 0, clientX: x0, clientY: y0, target: null });
  ctrl._internals.onMouseMove({ clientX: x1, clientY: y1 });
  ctrl._internals.onMouseUp({ button: 0, clientX: x1, clientY: y1, shiftKey: !!mods.shift, ctrlKey: false, metaKey: false });
}
```

The camera is set so that screen coords equal world coords (center 0,0; zoom 1). Screen `(400, 300)` is world `(0, 0)`; screen `(410, 300)` is world `(10, 0)`.

Wait — actually `screenToWorld` returns `cam.center.x + (s.x - cam.viewport.w / 2) / cam.zoom`. With viewport `{w: 800, h: 600}` and center `(0, 0)`, screen `(400, 300)` is world `(0, 0)`. Correct.

- [ ] **Step 2: Add failing tests**

Append:

```ts
describe('selection-controller — modifier rules', () => {
  it('LMB click on own unit replaces selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0); // PLAYER_TEAM = 0
    const b = spawn(world, 'line-infantry', 0, 100, 0);
    selection.ids.add(b);
    click(ctrl, 400, 300); // world (0, 0)
    expect(Array.from(selection.ids)).toEqual([a]);
  });

  it('LMB click on empty clears selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(a);
    click(ctrl, 700, 500); // world (300, 200) — no unit
    expect(selection.ids.size).toBe(0);
  });

  it('LMB drag selects only own-team units in box', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);  // world (0, 0)
    const enemy = spawn(world, 'line-infantry', 1, 5, 0); // world (5, 0)
    void enemy;
    drag(ctrl, 380, 280, 420, 320); // world rect (-20,-20)..(20,20)
    expect(Array.from(selection.ids)).toEqual([own]);
  });

  it('LMB drag with only enemies in box selects the closest enemy', () => {
    const { ctrl, world, selection } = makeDeps();
    const e1 = spawn(world, 'line-infantry', 1, -5, 0);  // world (-5, 0)
    const e2 = spawn(world, 'line-infantry', 1, 8, 0);   // world (8, 0)
    void e2;
    drag(ctrl, 380, 280, 420, 320); // world rect (-20,-20)..(20,20), center (0,0)
    // Closest to box center (0,0) is e1.
    expect(Array.from(selection.ids)).toEqual([e1]);
  });

  it('Shift + LMB click on unit toggles it in selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    click(ctrl, 400, 300, { shift: true });
    expect(selection.ids.has(a)).toBe(true);
    click(ctrl, 400, 300, { shift: true });
    expect(selection.ids.has(a)).toBe(false);
  });

  it('Shift + LMB drag adds own-team units to selection (no toggle)', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    selection.ids.add(b);
    drag(ctrl, 380, 280, 420, 320, { shift: true });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests, expect failures** for the toggle and fallback assertions.

```
npx vitest run src/input/selection-controller.test.ts
```

- [ ] **Step 4: Update the LMB-up branch in `src/input/selection-controller.ts`**

Replace the `if (e.button === 0)` block of `onMouseUp` with:

```ts
if (e.button === 0) {
  if (!pendingClickStart) return;
  const additive = e.shiftKey;
  if (drag.active) {
    const a = screenToWorld(camera, drag.start);
    const b = screenToWorld(camera, drag.current);
    const own = hitTestRect(world, a.x, a.y, b.x, b.y, { team: PLAYER_TEAM });
    let picked = own;
    if (own.length === 0) {
      // Fallback: closest single non-own-team unit to the box center.
      const all = hitTestRect(world, a.x, a.y, b.x, b.y);
      const enemies = all.filter(id => world.entities.team[id] !== PLAYER_TEAM);
      if (enemies.length > 0) {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        let bestId = enemies[0]!;
        let bestD2 = Infinity;
        for (const id of enemies) {
          const dx = world.entities.posX[id]! - cx;
          const dy = world.entities.posY[id]! - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; bestId = id; }
        }
        picked = [bestId];
      }
    }
    if (!additive) selection.ids.clear();
    for (const id of picked) selection.ids.add(id);
  } else {
    const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const id = hitTestPoint(world, w);
    if (additive) {
      if (id !== -1) {
        if (selection.ids.has(id)) selection.ids.delete(id);
        else selection.ids.add(id);
      }
    } else {
      selection.ids.clear();
      if (id !== -1) selection.ids.add(id);
    }
  }
  drag.active = false;
  pendingClickStart = null;
  return;
}
```

- [ ] **Step 5: Re-run tests; expect all green.**

```
npx vitest run src/input/selection-controller.test.ts
npm test
```

- [ ] **Step 6: Pause for user review.** Do not commit.

---

## Task 6: Ctrl+click and double-click — select-same-kind-in-view

**Files:**
- Modify: `src/input/selection-controller.ts`
- Modify: `src/input/selection-controller.test.ts`

- [ ] **Step 1: Add failing tests**

Append to the `describe('selection-controller — modifier rules', ...)` block (or a new `describe`):

```ts
describe('selection-controller — same-kind selection', () => {
  it('Ctrl + LMB click selects all of same kind in viewport', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    const cav = spawn(world, 'cuirassier', 0, -5, 0);
    void cav;
    click(ctrl, 400, 300, { ctrl: true }); // clicks unit a
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
    expect(selection.ids.has(cav)).toBe(false);
  });

  it('Ctrl + LMB on enemy selects all of that enemy kind in view', () => {
    const { ctrl, world, selection } = makeDeps();
    const e1 = spawn(world, 'line-infantry', 1, 0, 0);
    const e2 = spawn(world, 'line-infantry', 1, 5, 0);
    const own = spawn(world, 'line-infantry', 0, -5, 0);
    void own;
    click(ctrl, 400, 300, { ctrl: true });
    expect(selection.ids.has(e1)).toBe(true);
    expect(selection.ids.has(e2)).toBe(true);
    expect(selection.ids.has(own)).toBe(false);
  });

  it('Two LMB clicks within 300ms on the same unit behave like Ctrl+click', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    click(ctrl, 400, 300);
    click(ctrl, 400, 300);
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, expect failures.**

- [ ] **Step 3: Add same-kind helpers + state to `selection-controller.ts`**

Add the import: `import { findSameKindInView } from './selection';`

Add to the controller's local state:

```ts
let lastClick: { id: number; t: number; x: number; y: number } | null = null;
const DOUBLE_CLICK_MS = 300;
const DOUBLE_CLICK_PX = 6;

function viewRect() {
  const halfW = camera.viewport.w / (2 * camera.zoom);
  const halfH = camera.viewport.h / (2 * camera.zoom);
  return {
    x0: camera.center.x - halfW, y0: camera.center.y - halfH,
    x1: camera.center.x + halfW, y1: camera.center.y + halfH,
  };
}

function selectSameKindAs(id: number) {
  const e = world.entities;
  const team = e.team[id]!;
  const kind = e.kindId[id]!;
  const ids = findSameKindInView(world, kind, viewRect(), { team });
  selection.ids.clear();
  for (const x of ids) selection.ids.add(x);
}
```

- [ ] **Step 4: Wire Ctrl+click and double-click into LMB-up**

In the LMB-up branch (the non-drag click path), insert at the very top:

```ts
const wPoint = screenToWorld(camera, { x: e.clientX, y: e.clientY });
const idAtPoint = hitTestPoint(world, wPoint);

// Ctrl-click: select all of same kind in viewport.
if (e.ctrlKey && idAtPoint !== -1) {
  selectSameKindAs(idAtPoint);
  lastClick = { id: idAtPoint, t: performance.now(), x: e.clientX, y: e.clientY };
  drag.active = false;
  pendingClickStart = null;
  return;
}

// Double-click: same as Ctrl-click on the same id within the timing window.
if (idAtPoint !== -1 && lastClick && lastClick.id === idAtPoint) {
  const dt = performance.now() - lastClick.t;
  const dx = e.clientX - lastClick.x;
  const dy = e.clientY - lastClick.y;
  if (dt <= DOUBLE_CLICK_MS && Math.hypot(dx, dy) <= DOUBLE_CLICK_PX) {
    selectSameKindAs(idAtPoint);
    lastClick = { id: idAtPoint, t: performance.now(), x: e.clientX, y: e.clientY };
    drag.active = false;
    pendingClickStart = null;
    return;
  }
}
lastClick = idAtPoint !== -1 ? { id: idAtPoint, t: performance.now(), x: e.clientX, y: e.clientY } : null;
```

Then keep the existing replace/toggle logic as the fallback path.

(Reminder: the "drag" path in this same branch already returns early before this code runs.)

- [ ] **Step 5: Re-run tests; expect green.**

```
npx vitest run src/input/selection-controller.test.ts
npm test
```

- [ ] **Step 6: Pause for user review.** Do not commit.

---

## Task 7: Context-aware RMB + Shift-RMB queueing

**Files:**
- Modify: `src/input/selection-controller.ts`
- Modify: `src/input/selection-controller.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('selection-controller — RMB commands', () => {
  it('RMB on enemy issues attack to all selected', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    const enemy = spawn(world, 'line-infantry', 1, 5, 0);
    selection.ids.add(own);
    ctrl._internals.onMouseUp({ button: 2, clientX: 405, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.get(own)).toEqual([{ kind: 'attack', targetId: enemy }]);
  });

  it('RMB on terrain issues a move', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onMouseUp({ button: 2, clientX: 500, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    const q = world.orderQueue.get(own)!;
    expect(q[0]?.kind).toBe('move');
  });

  it('Shift + RMB queues a move instead of replacing', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    world.orderQueue.set(own, [{ kind: 'move', targetX: 1, targetY: 1 }]);
    ctrl._internals.onMouseUp({ button: 2, clientX: 500, clientY: 300, shiftKey: true, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.get(own)?.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests, expect failures.**

- [ ] **Step 3: Replace the RMB branch of `onMouseUp`**

```ts
if (e.button === 2) {
  const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
  const opts = { queue: e.shiftKey };
  // Look for an enemy under the cursor (any non-PLAYER_TEAM unit).
  const hit = hitTestPoint(world, w);
  if (hit !== -1 && world.entities.team[hit] !== PLAYER_TEAM) {
    issueAttack(world, selection, hit, opts);
  } else {
    issueMove(world, selection, w, opts);
  }
  return;
}
```

Update the `commands` import to include `issueAttack`:

```ts
import { issueMove, issueAttack } from './commands';
```

- [ ] **Step 4: Re-run tests, expect green.**

- [ ] **Step 5: Pause for user review.** Do not commit.

---

## Task 8: Attack-move mode + Stop + Esc semantics

**Files:**
- Modify: `src/input/selection-controller.ts`
- Modify: `src/input/selection-controller.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('selection-controller — attack-move + stop + esc', () => {
  it('A key with non-empty selection enters attack-move mode', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'a', code: 'KeyA', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('attack-move');
  });

  it('A key with empty selection is a no-op', () => {
    const { ctrl } = makeDeps();
    ctrl._internals.onKeyDown({ key: 'a', code: 'KeyA', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('normal');
  });

  it('LMB in attack-move mode issues attack-move and returns to normal', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'a', code: 'KeyA', shiftKey: false, ctrlKey: false, metaKey: false });
    click(ctrl, 500, 300);
    expect(world.orderQueue.get(own)?.[0]?.kind).toBe('attack-move');
    expect(ctrl._internals.getCursorMode()).toBe('normal');
  });

  it('RMB in attack-move mode cancels mode without issuing an order', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'a', code: 'KeyA', shiftKey: false, ctrlKey: false, metaKey: false });
    ctrl._internals.onMouseUp({ button: 2, clientX: 500, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('normal');
    expect(world.orderQueue.has(own)).toBe(false);
  });

  it('Esc in attack-move returns to normal without clearing selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 'a', code: 'KeyA', shiftKey: false, ctrlKey: false, metaKey: false });
    ctrl._internals.onKeyDown({ key: 'Escape', code: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('normal');
    expect(selection.ids.has(own)).toBe(true);
  });

  it('S key issues stop to all selected', () => {
    const { ctrl, world, selection } = makeDeps();
    const own = spawn(world, 'line-infantry', 0, 0, 0);
    world.orderQueue.set(own, [{ kind: 'move', targetX: 1, targetY: 1 }]);
    selection.ids.add(own);
    ctrl._internals.onKeyDown({ key: 's', code: 'KeyS', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.has(own)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, expect failures.**

- [ ] **Step 3: Wire attack-move + stop in the controller**

Update the `commands` import to include `issueAttackMove` and `issueStop`:

```ts
import { issueMove, issueAttack, issueAttackMove, issueStop } from './commands';
```

Update `onKeyDown`:

```ts
function onKeyDown(e: { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
  if (e.key === 'Escape') {
    if (cursorMode !== 'normal') {
      cursorMode = 'normal';
      return;
    }
    selection.ids.clear();
    return;
  }
  // Letter hotkeys — guard with code so they're layout-independent and not affected by Shift.
  if (e.code === 'KeyA') {
    if (selection.ids.size > 0 && cursorMode === 'normal') cursorMode = 'attack-move';
    return;
  }
  if (e.code === 'KeyS') {
    issueStop(world, selection);
    return;
  }
}
```

Update `onMouseUp`'s LMB branch to short-circuit when in attack-move mode. At the very top of `if (e.button === 0) { ... }`:

```ts
if (cursorMode === 'attack-move') {
  if (!pendingClickStart) return;
  // Bare click in attack-move mode (drag intentionally treated as click for simplicity).
  const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
  issueAttackMove(world, selection, w, { queue: e.shiftKey });
  cursorMode = 'normal';
  drag.active = false;
  pendingClickStart = null;
  return;
}
```

Update `onMouseUp`'s RMB branch to cancel attack-move first:

```ts
if (e.button === 2) {
  if (cursorMode === 'attack-move') {
    cursorMode = 'normal';
    return;
  }
  // ... existing context-aware RMB code from Task 7 ...
}
```

Also: when selection becomes empty, the cursor mode should snap back. Add a small per-frame check inside `update`:

```ts
update(_dt) {
  if (cursorMode === 'attack-move' && selection.ids.size === 0) cursorMode = 'normal';
},
```

- [ ] **Step 4: Re-run tests, expect green.**

- [ ] **Step 5: Pause for user review.** Do not commit.

---

## Task 9: Control groups (assign / recall / merge)

**Files:**
- Modify: `src/input/selection-controller.ts`
- Modify: `src/input/selection-controller.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('selection-controller — control groups', () => {
  it('Ctrl+1 assigns selection to group 1; "1" recalls it', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    selection.ids.add(a); selection.ids.add(b);
    ctrl._internals.onKeyDown({ key: '1', code: 'Digit1', shiftKey: false, ctrlKey: true, metaKey: false });
    selection.ids.clear();
    ctrl._internals.onKeyDown({ key: '1', code: 'Digit1', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
  });

  it('Shift+digit merges group into current selection', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    const c = spawn(world, 'line-infantry', 0, 10, 0);
    selection.ids.add(a);
    ctrl._internals.onKeyDown({ key: '2', code: 'Digit2', shiftKey: false, ctrlKey: true, metaKey: false }); // group 2 = {a}
    selection.ids.clear();
    selection.ids.add(b); selection.ids.add(c);
    ctrl._internals.onKeyDown({ key: '2', code: 'Digit2', shiftKey: true, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(true);
    expect(selection.ids.has(c)).toBe(true);
  });

  it('Recall filters out dead entities', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 5, 0);
    selection.ids.add(a); selection.ids.add(b);
    ctrl._internals.onKeyDown({ key: '3', code: 'Digit3', shiftKey: false, ctrlKey: true, metaKey: false });
    world.entities.alive[b] = 0;
    selection.ids.clear();
    ctrl._internals.onKeyDown({ key: '3', code: 'Digit3', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
    expect(selection.ids.has(b)).toBe(false);
  });

  it('Numpad digits work too', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(a);
    ctrl._internals.onKeyDown({ key: '4', code: 'Numpad4', shiftKey: false, ctrlKey: true, metaKey: false });
    selection.ids.clear();
    ctrl._internals.onKeyDown({ key: '4', code: 'Numpad4', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(selection.ids.has(a)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, expect failures.**

- [ ] **Step 3: Implement control groups in `selection-controller.ts`**

Add to local state:

```ts
const groups: Set<number>[] = Array.from({ length: 10 }, () => new Set<number>());
```

Add a helper:

```ts
function digitFromCode(code: string): number | null {
  if (code.startsWith('Digit')) {
    const n = Number(code.slice(5));
    return Number.isInteger(n) ? n : null;
  }
  if (code.startsWith('Numpad')) {
    const n = Number(code.slice(6));
    return Number.isInteger(n) ? n : null;
  }
  return null;
}
```

Extend `onKeyDown`, before the letter-hotkey block:

```ts
const digit = digitFromCode(e.code);
if (digit !== null) {
  // Ignore if a text input is focused (gate against future regressions).
  const ae = (typeof document !== 'undefined') ? document.activeElement : null;
  const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.ctrlKey || e.metaKey) {
    // Assign current selection to the group.
    groups[digit] = new Set(selection.ids);
    return;
  }
  if (e.shiftKey) {
    // Merge group into current selection (alive only).
    for (const id of groups[digit]!) {
      if (world.entities.alive[id] === 1) selection.ids.add(id);
    }
    return;
  }
  // Recall: replace selection with group (alive only).
  selection.ids.clear();
  for (const id of groups[digit]!) {
    if (world.entities.alive[id] === 1) selection.ids.add(id);
  }
  return;
}
```

(`document` may be undefined in node tests — the typeof guard handles that.)

- [ ] **Step 4: Re-run tests, expect green.**

- [ ] **Step 5: Pause for user review.** Do not commit.

---

## Task 10: HUD-target suppression and window-blur reset

**Files:**
- Modify: `src/input/selection-controller.test.ts`

The behavior is already implemented in Tasks 4 (HUD suppression) and 4/8 (blur). This task adds tests so it stays correct.

- [ ] **Step 1: Add tests**

```ts
describe('selection-controller — input suppression', () => {
  it('mousedown over a HUD element does not start a marquee or change selection', () => {
    const camera = createCamera();
    camera.viewport = { w: 800, h: 600 };
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = allocEntity(world.entities);
    world.entities.kindId[a] = getUnitKindIndex('line-infantry');
    world.entities.team[a] = 0;
    world.entities.posX[a] = 0; world.entities.posY[a] = 0;
    const selection = createSelection();
    const drag = createDragRect();
    const fakeNode = {} as Node;
    const overlayRoot = { contains: (n: Node) => n === fakeNode } as unknown as HTMLElement;
    const ctrl = createSelectionController({
      canvas: {} as HTMLCanvasElement, overlayRoot, camera, world, selection, drag,
    });
    ctrl._internals.onMouseDown({ button: 0, clientX: 400, clientY: 300, target: fakeNode });
    ctrl._internals.onMouseUp({ button: 0, clientX: 400, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(selection.ids.size).toBe(0);
    expect(drag.active).toBe(false);
  });

  it('blur cancels pending drag and resets attack-move mode', () => {
    const { ctrl, world, selection, drag } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(a);
    ctrl._internals.onMouseDown({ button: 0, clientX: 400, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 500, clientY: 400 });
    expect(drag.active).toBe(true);
    ctrl._internals.onKeyDown({ key: 'a', code: 'KeyA', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl._internals.getCursorMode()).toBe('attack-move');
    ctrl._internals.onBlur();
    expect(drag.active).toBe(false);
    expect(ctrl._internals.getCursorMode()).toBe('normal');
    expect(selection.ids.has(a)).toBe(true); // selection persists
  });
});
```

- [ ] **Step 2: Run tests, expect green** (no implementation changes needed).

```
npx vitest run src/input/selection-controller.test.ts
```

- [ ] **Step 3: Pause for user review.** Do not commit.

---

## Task 11: Per-team ring color (selection-pass + shader)

**Files:**
- Modify: `src/render/shaders/selection.glsl.ts`
- Modify: `src/render/passes/selection-pass.ts`

- [ ] **Step 1: Add a per-instance color attribute to the shader**

Replace `SELECTION_VS` and `SELECTION_FS`:

```ts
export const SELECTION_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
layout(location = 2) in float a_radius;
layout(location = 3) in vec3 a_color;
out vec2 v_local;
out vec3 v_color;

uniform mat3 u_viewProj;

void main() {
  vec2 wp = a_pos + a_corner * a_radius * 2.0;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0;
  v_color = a_color;
}
`;

export const SELECTION_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec3 v_color;
out vec4 outColor;

void main() {
  float d = length(v_local);
  float a = smoothstep(0.85, 0.9, d) - smoothstep(0.98, 1.0, d);
  if (a <= 0.0) discard;
  outColor = vec4(v_color, a);
}
`;
```

- [ ] **Step 2: Add a color buffer in `src/render/passes/selection-pass.ts`**

After the `radBuf` declaration block, add:

```ts
const colBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(3);
gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(3, 1);
```

Add a scratch float array for colors next to the others:

```ts
const scratchCol = new Float32Array(capacity * 3);
```

Add the import:

```ts
import { PLAYER_TEAM } from '../../sim/player';
```

In the per-frame ring loop, populate `scratchCol`:

```ts
const isOwn = e.team[id] === PLAYER_TEAM;
scratchCol[n * 3 + 0] = isOwn ? 0.4 : 1.0;
scratchCol[n * 3 + 1] = isOwn ? 0.7 : 0.4;
scratchCol[n * 3 + 2] = isOwn ? 1.0 : 0.4;
```

In the `if (n > 0)` block, add a `bufferSubData` call for `colBuf` next to the other two:

```ts
gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchCol.subarray(0, n * 3));
```

- [ ] **Step 3: Manual smoke test**

```
npm run dev
```

In `src/main.ts`, temporarily set one of the spawned units' `team` to `1` (e.g. `world.entities.team[someId] = 1`) and confirm its ring renders red instead of blue when selected. Revert the test change before moving on.

- [ ] **Step 4: Run tests + typecheck**

```
npm test
npm run typecheck
```

- [ ] **Step 5: Pause for user review.** Do not commit.

---

## Task 12: Queued waypoint markers

**Files:**
- Modify: `src/render/shaders/selection.glsl.ts`
- Modify: `src/render/passes/selection-pass.ts`

Adds a faint polyline + chevron at each queued `move`/`attack-move` waypoint for selected units.

- [ ] **Step 1: Add a tiny solid-color line shader**

Append to `src/render/shaders/selection.glsl.ts`:

```ts
export const WAYPOINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;

uniform mat3 u_viewProj;

void main() {
  vec3 clip = u_viewProj * vec3(a_pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const WAYPOINT_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }
`;
```

- [ ] **Step 2: Build the waypoint pass inside `selection-pass.ts`**

At the top of `createSelectionPass`, after the existing program/VAO setup, add:

```ts
const wpProg = linkProgram(gl, WAYPOINT_VS, WAYPOINT_FS);
const wpU = getUniforms(gl, wpProg, ['u_viewProj', 'u_color'] as const);
const wpVao = createVertexArray(gl);
gl.bindVertexArray(wpVao);
const WP_MAX_VERTS = capacity * 32; // rough cap: 8 segments × 4 verts × N selected
const wpBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
gl.bufferData(gl.ARRAY_BUFFER, WP_MAX_VERTS * 2 * 4, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);
const wpScratch = new Float32Array(WP_MAX_VERTS * 2);
```

Add the imports:

```ts
import { WAYPOINT_VS, WAYPOINT_FS } from '../shaders/selection.glsl';
```

After the rings draw call (and before the drag-rect draw), insert:

```ts
// Waypoint chains for selected units that have a queue
let wpN = 0;
for (const id of sel.ids) {
  if (e.alive[id] === 0) continue;
  const queue = world.orderQueue.get(id);
  if (!queue || queue.length === 0) continue;
  let prevX = e.posX[id]!;
  let prevY = e.posY[id]!;
  for (const o of queue) {
    if (o.kind !== 'move' && o.kind !== 'attack-move') continue;
    if (wpN + 2 > WP_MAX_VERTS) break;
    wpScratch[wpN * 2 + 0] = prevX;
    wpScratch[wpN * 2 + 1] = prevY;
    wpScratch[wpN * 2 + 2] = o.targetX;
    wpScratch[wpN * 2 + 3] = o.targetY;
    wpN += 2;
    prevX = o.targetX;
    prevY = o.targetY;
  }
}
if (wpN > 0) {
  gl.useProgram(wpProg);
  gl.bindVertexArray(wpVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, wpBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, wpScratch.subarray(0, wpN * 2));
  gl.uniformMatrix3fv(wpU.u_viewProj, false, viewProjection(cam));
  gl.uniform4f(wpU.u_color, 0.4, 0.7, 1.0, 0.4);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.LINES, 0, wpN);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
  gl.useProgram(prog); // restore for downstream draws
}
```

(Chevron triangles are intentionally omitted — segments alone are enough for MVP and keep this task contained. Add chevrons later if the user wants them.)

- [ ] **Step 3: Manual smoke test**

```
npm run dev
```

Select units, hold Shift, right-click two or three times on different points. Confirm faint blue lines connect the unit's current position through each waypoint.

- [ ] **Step 4: Run tests + typecheck**

```
npm test
npm run typecheck
```

- [ ] **Step 5: Pause for user review.** Do not commit.

---

## Task 13: Cursor mode CSS + HUD label + RMB click-feedback puff

**Files:**
- Modify: `src/input/selection-controller.ts`
- Modify: `src/ui/hud.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Update `update()` in the controller to drive the canvas cursor**

Replace `update`:

```ts
update(_dt) {
  if (cursorMode === 'attack-move' && selection.ids.size === 0) cursorMode = 'normal';
  deps.canvas.style.cursor = cursorMode === 'attack-move' ? 'crosshair' : 'default';
},
```

(`deps` is already in scope.)

- [ ] **Step 2: Show a HUD label when in attack-move mode**

Update `src/ui/hud.ts`:

```ts
import { panel } from './overlay';
import type { World } from '../sim/world';

export interface Hud {
  update(fps: number, world: World, cursorMode: 'normal' | 'attack-move'): void;
}

export function createHud(root: HTMLElement): Hud {
  const el = panel('hud');
  root.appendChild(el);
  return {
    update(fps, world, cursorMode) {
      const mode = cursorMode === 'attack-move' ? '\nMODE   Attack-move' : '';
      el.textContent =
        `FPS    ${fps.toFixed(0).padStart(4)}\n` +
        `Units  ${world.entities.count.toString().padStart(4)}\n` +
        `Tick   ${world.tickCount}` +
        mode;
    },
  };
}
```

In `src/main.ts`, update the `hud.update` call:

```ts
hud.update(smoothedFps, world, controller.cursorMode);
```

- [ ] **Step 3: Add a point-based emitter to `src/particles/emitters.ts`**

`emitDust` is world-velocity-driven and not reusable for click feedback. Add a sibling helper:

```ts
export function emitOrderPuff(particles: Particles, x: number, y: number): void {
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    const r = 0.3;
    spawnParticle(particles, {
      x: x + Math.cos(a) * r,
      y: y + Math.sin(a) * r,
      vx: Math.cos(a) * 0.6,
      vy: Math.sin(a) * 0.6,
      life: 0.35,
      size: 0.18,
      r: 0.8, g: 0.9, b: 1.0,
    });
  }
}
```

(`ParticleSpawn` uses separate `r/g/b` fields, not a `color` tuple — match the existing schema.)

- [ ] **Step 4: Wire the puff into the controller**

In `src/input/selection-controller.ts`, add to `SelectionControllerDeps`:

```ts
import type { Particles } from '../particles/particles';
import { emitOrderPuff } from '../particles/emitters';

export interface SelectionControllerDeps {
  // ... existing fields ...
  /** Optional — when present, a small puff is emitted at each issued world point. */
  particles?: Particles;
}
```

Add the helper inside `createSelectionController`:

```ts
function puff(x: number, y: number) {
  if (deps.particles) emitOrderPuff(deps.particles, x, y);
}
```

Call `puff(w.x, w.y)` immediately after `issueAttack`, `issueMove`, and `issueAttackMove` (both the RMB branch and the attack-move LMB branch).

- [ ] **Step 5: Wire the particle pool through in `src/main.ts`**

```ts
const controller = createSelectionController({
  canvas, overlayRoot: overlay, camera, world, selection, drag,
  particles,
});
```

- [ ] **Step 6: Manual smoke test**

```
npm run dev
```

Verify:
- Pressing `A` while units are selected switches the cursor to crosshair and shows "MODE   Attack-move" in the HUD.
- Clicking issues an attack-move order; cursor and HUD return to normal.
- A small puff appears at each RMB / attack-move target.
- Pressing `S` halts selected units.
- Ctrl+1 / 1 / Shift+1 control-group cycle works in-game.

- [ ] **Step 7: Run full tests + typecheck**

```
npm test
npm run typecheck
```

- [ ] **Step 8: Pause for user review.** Do not commit.

---

## Done

At this point all spec sections are implemented. The user controls the commit boundaries — they will decide whether to land this as one commit or several focused commits before merging.
