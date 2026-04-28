# Formation March (Ctrl+RMB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Ctrl+Right-click "march in formation" command that pivots the current selection toward the click point, marches at 0.6× speed, and halts the entire group for 4-second volleys when an enemy comes into weapon range.

**Architecture:** New `march-formation` order kind dispatched by a new `issueMarchFormation` command. A new `march-groups.ts` module owns the group state on the world (`Map<gid, MarchGroup>`). A new `march-system` runs once per tick before `ordersSystem` to flip group phases (`march` ↔ `volley`) and reconcile membership. The `ordersSystem` reads group phase to decide per-unit velocity. Selection-controller binds Ctrl+RMB-up to `issueMarchFormation`.

**Tech Stack:** TypeScript, Vitest, ECS (typed-array entities), existing formation-helpers (`computeFormationSlots`, `assignFormationSlots`, `syntheticFormationDrag`, `liveFormationUnits`, `inferRanksFromPositions`).

**Spec:** `docs/superpowers/specs/2026-04-27-formation-march-design.md`.

---

## File Structure

**New files:**
- `src/sim/march-groups.ts` — `MarchGroup` type + helpers (`createMarchGroup`, `removeMarchGroupMember`).
- `src/sim/march-groups.test.ts`
- `src/sim/systems/march-system.ts` — per-tick phase machine.
- `src/sim/systems/march-system.test.ts`

**Modified files:**
- `src/sim/world.ts` — add `march-formation` to `Order` union; add `marchGroups: Map<number, MarchGroup>` and `nextMarchGroupId: number`; initialize in `createWorld`.
- `src/sim/systems/orders-system.ts` — new handler for `kind === 'march-formation'`.
- `src/sim/systems/orders-system.test.ts` — extend with march-formation cases.
- `src/input/commands.ts` — add `issueMarchFormation`.
- `src/input/commands.test.ts` — extend.
- `src/input/selection-controller.ts` — Ctrl+RMB-up branch in `onMouseUp`.
- `src/input/selection-controller.test.ts` — extend.
- `src/main.ts` — register `marchSystem` before `ordersSystem`.

**Constants live in `src/sim/systems/march-system.ts`:**
- `MARCH_SPEED_FACTOR = 0.6`
- `VOLLEY_DURATION = 4.0` (sim seconds)
- `MARCH_SCAN_PERIOD = 8` (ticks)

---

## Task 1: Extend `Order` union and add `marchGroups` to `World`

Lays the data-model foundation. No behavior yet — just storage.

**Files:**
- Modify: `src/sim/world.ts`

- [ ] **Step 1: Add the `march-formation` variant to the `Order` union and the `marchGroups` field to `World`**

Edit `src/sim/world.ts`. Add an import line near the top of the imports:

```ts
import type { MarchGroup } from './march-groups';
```

Replace the `Order` type (around lines 16-20):

```ts
export type Order =
  | { kind: 'move'; targetX: number; targetY: number; arrived?: boolean }
  | { kind: 'attack'; targetId: number }
  | { kind: 'attack-move'; targetX: number; targetY: number; arrived?: boolean }
  | { kind: 'stop' }
  | { kind: 'march-formation'; targetX: number; targetY: number; groupId: number; arrived?: boolean };
```

Add to the `World` interface (after `bloodSplats: BloodSplats;`):

```ts
  /** Active march groups, keyed by groupId. Lifecycle managed by march-system. */
  marchGroups: Map<number, MarchGroup>;
  /** Monotonic counter for new march-group ids; never reused. Starts at 1 so 0 stays a sentinel. */
  nextMarchGroupId: number;
```

Add to the `createWorld` return object (after `bloodSplats: createBloodSplats(4096),` and before `fireSignal: createFireSignal(grid),`):

```ts
    marchGroups: new Map(),
    nextMarchGroupId: 1,
```

This file will fail to type-check until Task 2 creates `march-groups.ts`. That's expected.

- [ ] **Step 2: Run typecheck — expect failure on missing module**

Run: `npx tsc --noEmit`
Expected: error pointing at `'./march-groups'` not found. (No other errors should reference march-formation yet because no consumer code exists.)

- [ ] **Step 3: Commit**

```bash
git add src/sim/world.ts
git commit -m "feat(sim): add march-formation Order variant and marchGroups field"
```

The commit is incomplete (typecheck fails) but logically self-contained. Task 2 immediately fixes it.

---

## Task 2: `march-groups` module with TDD

The data layer for groups. Pure functions over a `MarchGroup` record.

**Files:**
- Create: `src/sim/march-groups.ts`
- Create: `src/sim/march-groups.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/sim/march-groups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMarchGroup, removeMarchGroupMember } from './march-groups';

describe('march-groups', () => {
  it('createMarchGroup initializes phase=march and members from iterable', () => {
    const g = createMarchGroup(7, [1, 2, 3], { x: 1, y: 0 }, 12.5);
    expect(g.id).toBe(7);
    expect(g.phase).toBe('march');
    expect(g.phaseStartT).toBe(12.5);
    expect(g.forward).toEqual({ x: 1, y: 0 });
    expect([...g.members].sort()).toEqual([1, 2, 3]);
  });

  it('removeMarchGroupMember returns false while members remain, true on the last removal', () => {
    const g = createMarchGroup(1, [10, 11], { x: 0, y: 1 }, 0);
    expect(removeMarchGroupMember(g, 10)).toBe(false);
    expect(g.members.has(10)).toBe(false);
    expect(removeMarchGroupMember(g, 11)).toBe(true);
    expect(g.members.size).toBe(0);
  });

  it('removeMarchGroupMember on a missing id is a no-op and returns members.size === 0', () => {
    const g = createMarchGroup(1, [], { x: 1, y: 0 }, 0);
    expect(removeMarchGroupMember(g, 99)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npx vitest run src/sim/march-groups.test.ts`
Expected: FAIL with "Failed to resolve import" (module doesn't exist).

- [ ] **Step 3: Implement the module**

Create `src/sim/march-groups.ts`:

```ts
import type { Vec2 } from '../util/math';

export type MarchPhase = 'march' | 'volley';

export interface MarchGroup {
  id: number;
  members: Set<number>;
  phase: MarchPhase;
  /** world.simTime at which `phase` was last entered. */
  phaseStartT: number;
  /** Unit-vector facing direction, locked at issue time. */
  forward: Vec2;
}

export function createMarchGroup(
  id: number,
  members: Iterable<number>,
  forward: Vec2,
  simTime: number,
): MarchGroup {
  return {
    id,
    members: new Set(members),
    phase: 'march',
    phaseStartT: simTime,
    forward: { x: forward.x, y: forward.y },
  };
}

/** Removes `id` from the group's members. Returns true iff `members` is now empty. */
export function removeMarchGroupMember(g: MarchGroup, id: number): boolean {
  g.members.delete(id);
  return g.members.size === 0;
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npx vitest run src/sim/march-groups.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Run typecheck — expect clean**

Run: `npx tsc --noEmit`
Expected: no errors. (world.ts now resolves its import.)

- [ ] **Step 6: Commit**

```bash
git add src/sim/march-groups.ts src/sim/march-groups.test.ts
git commit -m "feat(sim): MarchGroup type and helpers"
```

---

## Task 3: Handle `march-formation` in `orders-system` (TDD)

Velocity / facing for marchers, plus dropping orders whose group has been deleted. Group bookkeeping (member add/remove) lives in `march-system`, not here.

**Files:**
- Modify: `src/sim/systems/orders-system.ts`
- Modify: `src/sim/systems/orders-system.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/sim/systems/orders-system.test.ts` (after the existing `describe`):

```ts
import { ordersSystem as _ordersSystem } from './orders-system';
import { createMarchGroup } from '../march-groups';
import { writeFacingIntent } from './facing-system';

describe('ordersSystem march-formation handler', () => {
  it('march phase writes velocity at march speed toward the slot', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry'); // moveSpeed 2.5
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [id], { x: 1, y: 0 }, 0));
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);

    _ordersSystem(world, 1 / 60);

    // March speed = 2.5 * 0.6 = 1.5 m/s along +x.
    expect(world.entities.velX[id]).toBeCloseTo(1.5, 5);
    expect(world.entities.velY[id]).toBeCloseTo(0, 5);
  });

  it('volley phase zeroes velocity and writes facing intent toward group.forward', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    const gid = 1;
    const g = createMarchGroup(gid, [id], { x: 0, y: 1 }, 0);
    g.phase = 'volley';
    world.marchGroups.set(gid, g);
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);

    _ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
    expect(world.entities.facingIntentX[id]).toBeCloseTo(0, 5);
    expect(world.entities.facingIntentY[id]).toBeCloseTo(1, 5);
  });

  it('arrival at slot parks the unit, updates rest, and sets arrived=true (queue length 1)', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 99.95; // within ARRIVE_RADIUS=0.1 of (100, 0)
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    world.entities.facing[id] = 2;
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [id], { x: 1, y: 0 }, 0));
    const order = { kind: 'march-formation' as const, targetX: 100, targetY: 0, groupId: gid };
    world.orderQueue.set(id, [order]);

    _ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
    expect(world.entities.restPosX[id]).toBe(100);
    expect(world.entities.restPosY[id]).toBe(0);
    expect(world.entities.restFacing[id]).toBe(2);
    expect(order.arrived).toBe(true);
    // Order stays parked; group untouched at this layer.
    expect(world.orderQueue.get(id)?.length).toBe(1);
    expect(world.marchGroups.has(gid)).toBe(true);
  });

  it('missing group: order is shifted off and unit idles', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    // No entry in world.marchGroups for groupId 99.
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: 99 }]);

    _ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
    expect(world.orderQueue.has(id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new tests — expect failure**

Run: `npx vitest run src/sim/systems/orders-system.test.ts`
Expected: 4 new tests fail (existing ones still pass). Failure mode: orders-system has no march-formation branch, so velocity stays 0 (or at whatever it was) and arrival never fires.

- [ ] **Step 3: Add the handler in `orders-system.ts`**

Open `src/sim/systems/orders-system.ts`. Inside the per-id loop, find the `if (order.kind === 'move' || order.kind === 'attack-move')` block. **Add a new branch immediately before it** (so the existing branches stay intact):

```ts
if (order.kind === 'march-formation') {
  const group = world.marchGroups.get(order.groupId);
  if (!group) {
    // Group dissolved out from under us — drop the order and idle.
    queue.shift();
    if (queue.length === 0) world.orderQueue.delete(id);
    e.velX[id] = 0;
    e.velY[id] = 0;
    continue;
  }

  if (group.phase === 'volley') {
    e.velX[id] = 0;
    e.velY[id] = 0;
    writeFacingIntent(e, id, group.forward.x, group.forward.y);
    continue;
  }

  // 'march' phase — same arrival/march logic as 'move' but at march speed.
  const dx = order.targetX - e.posX[id]!;
  const dy = order.targetY - e.posY[id]!;
  const dist = Math.hypot(dx, dy);
  if (dist <= ARRIVE_RADIUS) {
    e.velX[id] = 0;
    e.velY[id] = 0;
    e.pushedT[id] = 0;
    e.restPosX[id] = order.targetX;
    e.restPosY[id] = order.targetY;
    e.restFacing[id] = e.facing[id]!;
    if (queue.length > 1) {
      queue.shift();
    } else {
      order.arrived = true;
    }
    continue;
  }
  const baseSpeed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed;
  if (order.arrived) {
    if (e.pushedT[id]! > 0) {
      e.pushedT[id] = Math.max(0, e.pushedT[id]! - dt);
      e.velX[id] = 0;
      e.velY[id] = 0;
      continue;
    }
    const settle = baseSpeed * SETTLE_SPEED_FACTOR;
    e.velX[id] = (dx / dist) * settle;
    e.velY[id] = (dy / dist) * settle;
    writeFacingIntent(e, id, dx, dy);
  } else {
    const speed = baseSpeed * MARCH_SPEED_FACTOR;
    e.velX[id] = (dx / dist) * speed;
    e.velY[id] = (dy / dist) * speed;
    writeFacingIntent(e, id, dx, dy);
  }
  continue;
}
```

Add the import for the constant at the top of the file (alongside the existing imports):

```ts
import { MARCH_SPEED_FACTOR } from './march-system';
```

(`MARCH_SPEED_FACTOR` will exist after Task 4. Tests for this task will run before that file exists — see Step 4 — so add it now and resolve the cyclic dependency by hoisting the constant.)

- [ ] **Step 4: Hoist `MARCH_SPEED_FACTOR` so it's importable without march-system existing yet**

Create `src/sim/systems/march-system.ts` as a stub now, containing only the constant:

```ts
import type { System } from '../world';

/** Multiplier on each unit's baseStats.moveSpeed during a formation march. */
export const MARCH_SPEED_FACTOR = 0.6;
/** Sim-seconds the group holds in 'volley' phase before resuming the march. */
export const VOLLEY_DURATION = 4.0;
/** Ticks between enemy-in-range scans per group, striped by gid. */
export const MARCH_SCAN_PERIOD = 8;

// Real implementation lands in Task 4; this stub keeps things compilable.
export const marchSystem: System = (_world, _dt) => {};
```

- [ ] **Step 5: Run the orders-system tests — expect PASS**

Run: `npx vitest run src/sim/systems/orders-system.test.ts`
Expected: all tests pass (original 2 + new 4 = 6).

- [ ] **Step 6: Run the full vitest suite — expect no regressions**

Run: `npx vitest run`
Expected: all green. (The `marchSystem` stub is registered nowhere yet, so no regressions possible.)

- [ ] **Step 7: Commit**

```bash
git add src/sim/systems/orders-system.ts src/sim/systems/orders-system.test.ts src/sim/systems/march-system.ts
git commit -m "feat(sim): orders-system handles march-formation orders"
```

---

## Task 4: `march-system` real implementation (TDD)

Phase machine + member reconciliation. Replaces the stub from Task 3.

**Files:**
- Modify: `src/sim/systems/march-system.ts`
- Create: `src/sim/systems/march-system.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/sim/systems/march-system.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npx vitest run src/sim/systems/march-system.test.ts`
Expected: all 7 tests fail. The stub doesn't do anything.

- [ ] **Step 3: Implement `march-system`**

Replace the contents of `src/sim/systems/march-system.ts`:

```ts
import type { System } from '../world';
import { gridQueryRect } from '../spatial/grid';
import { getUnitKindByIndex } from '../../data/units';
import { EntityState } from '../entities';

/** Multiplier on each unit's baseStats.moveSpeed during a formation march. */
export const MARCH_SPEED_FACTOR = 0.6;
/** Sim-seconds the group holds in 'volley' phase before resuming the march. */
export const VOLLEY_DURATION = 4.0;
/** Ticks between enemy-in-range scans per group, striped by gid. */
export const MARCH_SCAN_PERIOD = 8;

const candidateBuf = new Int32Array(2048);

export const marchSystem: System = (world, _dt) => {
  const e = world.entities;

  for (const [gid, group] of world.marchGroups) {
    // 1. Reconcile members: drop dead, drop those whose head order no longer
    //    references this group.
    for (const id of group.members) {
      if (e.alive[id] !== 1) { group.members.delete(id); continue; }
      const q = world.orderQueue.get(id);
      const head = q && q[0];
      if (!head || head.kind !== 'march-formation' || head.groupId !== gid) {
        group.members.delete(id);
      }
    }
    if (group.members.size === 0) {
      world.marchGroups.delete(gid);
      continue;
    }

    // 2. Phase transitions.
    if (group.phase === 'volley') {
      if (world.simTime - group.phaseStartT >= VOLLEY_DURATION) {
        group.phase = 'march';
        group.phaseStartT = world.simTime;
      }
      continue;
    }

    // phase === 'march' — gate the enemy scan to once per SCAN_PERIOD ticks per group.
    if ((world.tickCount + gid) % MARCH_SCAN_PERIOD !== 0) continue;

    // Compute group bbox + max weapon range; check there is at least one ready shooter.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let maxRange = 0;
    let team = 0;
    let anyReadyShooter = false;
    for (const id of group.members) {
      const x = e.posX[id]!, y = e.posY[id]!;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      const kind = getUnitKindByIndex(e.kindId[id]!);
      if (!kind.weapon) continue;
      if (kind.baseStats.weaponRange > maxRange) maxRange = kind.baseStats.weaponRange;
      team = e.team[id]!;
      if (e.state[id] === EntityState.Idle && e.reloadT[id]! <= 0) anyReadyShooter = true;
    }
    if (!anyReadyShooter || maxRange <= 0) continue;

    const n = gridQueryRect(
      world.grid,
      minX - maxRange, minY - maxRange,
      maxX + maxRange, maxY + maxRange,
      candidateBuf,
    );

    let triggered = false;
    for (const id of group.members) {
      if (triggered) break;
      if (e.state[id] !== EntityState.Idle) continue;
      if (e.reloadT[id]! > 0) continue;
      const kind = getUnitKindByIndex(e.kindId[id]!);
      if (!kind.weapon) continue;
      const range = kind.baseStats.weaponRange;
      const r2 = range * range;
      const px = e.posX[id]!, py = e.posY[id]!;
      for (let k = 0; k < n; k++) {
        const cid = candidateBuf[k]!;
        if (e.alive[cid] === 0) continue;
        if (e.team[cid] === team) continue;
        const cs = e.state[cid]!;
        if (cs === EntityState.Dead || cs === EntityState.Dying || cs === EntityState.Ragdoll) continue;
        const dx = e.posX[cid]! - px;
        const dy = e.posY[cid]! - py;
        if (dx * dx + dy * dy <= r2) { triggered = true; break; }
      }
    }

    if (triggered) {
      group.phase = 'volley';
      group.phaseStartT = world.simTime;
    }
  }
};
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npx vitest run src/sim/systems/march-system.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Run the full vitest suite — expect no regressions**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/sim/systems/march-system.ts src/sim/systems/march-system.test.ts
git commit -m "feat(sim): march-system phase machine and member reconciliation"
```

---

## Task 5: `issueMarchFormation` in `commands.ts` (TDD)

Allocates a march group, builds pivoted slots, dispatches `march-formation` orders.

**Files:**
- Modify: `src/input/commands.ts`
- Modify: `src/input/commands.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/input/commands.test.ts`:

```ts
import { issueMarchFormation } from './commands';
import { createFormationParams } from './formation-params';

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
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npx vitest run src/input/commands.test.ts`
Expected: 6 new tests fail with "issueMarchFormation is not a function".

- [ ] **Step 3: Implement `issueMarchFormation`**

Open `src/input/commands.ts`. Add to the imports (modify the existing import line):

```ts
import { computeFormationSlots, assignFormationSlots, liveFormationUnits, syntheticFormationDrag, inferRanksFromPositions } from './formation';
import { createMarchGroup } from '../sim/march-groups';
import { spacingMultiplier, type FormationParams } from './formation-params';
```

Append at the bottom of the file:

```ts
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
  const units = liveFormationUnits(world, sel.ids);
  if (units.length === 0) return;

  // Centroid of the live selection.
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= units.length; cy /= units.length;

  // Forward = direction from centroid to target. Fall back to +x if degenerate.
  let fx = target.x - cx;
  let fy = target.y - cy;
  const len = Math.hypot(fx, fy);
  if (len < 1e-6) { fx = 1; fy = 0; } else { fx /= len; fy /= len; }
  const forwardW: Vec2 = { x: fx, y: fy };

  const spacingMult = spacingMultiplier(formationParams);
  const chosenRanks = formationParams.ranks ?? inferRanksFromPositions(units, forwardW);

  // Synthetic drag anchored at the TARGET (not the centroid) so slots land at
  // the destination after the march.
  const { startW, endW } = syntheticFormationDrag(units, forwardW, chosenRanks, spacingMult, target);
  const { slots, forward } = computeFormationSlots({
    units, startW, endW, spacingMult, ranksOverride: chosenRanks,
  });
  const targets = assignFormationSlots(units, slots, forward);

  // Allocate the group and dispatch orders.
  const gid = world.nextMarchGroupId++;
  const memberIds = units.map(u => u.id);
  world.marchGroups.set(gid, createMarchGroup(gid, memberIds, forwardW, world.simTime));

  for (let i = 0; i < units.length; i++) {
    const id = units[i]!.id;
    const t = targets[i]!;
    world.orderQueue.set(id, [{
      kind: 'march-formation',
      targetX: t.x,
      targetY: t.y,
      groupId: gid,
    }]);
  }
}
```

- [ ] **Step 4: Run the commands tests — expect PASS**

Run: `npx vitest run src/input/commands.test.ts`
Expected: all passing (existing + 6 new).

- [ ] **Step 5: Run the full vitest suite — expect no regressions**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/input/commands.ts src/input/commands.test.ts
git commit -m "feat(input): issueMarchFormation builds pivoted slots and a march group"
```

---

## Task 6: Bind Ctrl + RMB-up in `selection-controller` (TDD)

Wire the controller to dispatch `issueMarchFormation` when the player Ctrl+right-clicks on terrain. Skip the binding when in attack-move mode or during a formation drag.

**Files:**
- Modify: `src/input/selection-controller.ts`
- Modify: `src/input/selection-controller.test.ts`

- [ ] **Step 1: Locate the test pattern in `selection-controller.test.ts`**

Look at the existing RMB-related tests for the existing patterns (selection setup, world fixture, calling `_internals.onMouseUp`). Mirror those.

- [ ] **Step 2: Add failing tests**

Append a new `describe` block near the bottom of `src/input/selection-controller.test.ts`. Adapt selectors/imports to match what's already imported in that file:

```ts
describe('selectionController Ctrl+RMB march-formation', () => {
  it('Ctrl+RMB up with non-empty selection on terrain creates a march group', () => {
    // Use the existing test fixture function (e.g., makeController / makeWorld)
    // already established at the top of this file. The pattern below shows
    // intent — adapt parameter names to the existing helpers.
    const { world, controller, selection } = makeControllerFixture();
    const id = spawnAt(world, 100, 100);
    selection.ids.add(id);

    controller._internals.onMouseUp({
      button: 2, clientX: 200, clientY: 200,
      shiftKey: false, ctrlKey: true, metaKey: false,
    });

    expect(world.marchGroups.size).toBe(1);
    const head = world.orderQueue.get(id)![0]!;
    expect(head.kind).toBe('march-formation');
  });

  it('Ctrl+RMB up with empty selection is a no-op', () => {
    const { world, controller, selection } = makeControllerFixture();
    expect(selection.ids.size).toBe(0);

    controller._internals.onMouseUp({
      button: 2, clientX: 200, clientY: 200,
      shiftKey: false, ctrlKey: true, metaKey: false,
    });

    expect(world.marchGroups.size).toBe(0);
  });

  it('Ctrl+Shift+RMB behaves the same as Ctrl+RMB (Shift ignored, no queueing)', () => {
    const { world, controller, selection } = makeControllerFixture();
    const id = spawnAt(world, 100, 100);
    selection.ids.add(id);

    controller._internals.onMouseUp({
      button: 2, clientX: 200, clientY: 200,
      shiftKey: true, ctrlKey: true, metaKey: false,
    });

    // One queue entry (replace, not append).
    expect(world.orderQueue.get(id)!.length).toBe(1);
    expect(world.orderQueue.get(id)![0]!.kind).toBe('march-formation');
    expect(world.marchGroups.size).toBe(1);
  });

  it('Ctrl+RMB during a formation drag falls through to the drag commit', () => {
    const { world, controller, selection } = makeControllerFixture();
    const id = spawnAt(world, 100, 100);
    selection.ids.add(id);
    // Start an RMB drag past the threshold so formationDrag.active becomes true.
    controller._internals.onMouseDown({
      button: 2, clientX: 100, clientY: 100, target: null,
    });
    controller._internals.onMouseMove({ clientX: 200, clientY: 100 });

    controller._internals.onMouseUp({
      button: 2, clientX: 200, clientY: 100,
      shiftKey: false, ctrlKey: true, metaKey: false,
    });

    // Drag commit produces 'move' orders via issueFormationMove, not march-formation.
    expect(world.marchGroups.size).toBe(0);
    expect(world.orderQueue.get(id)![0]!.kind).toBe('move');
  });
});
```

If `makeControllerFixture` and `spawnAt` don't exist in the test file, look at the existing tests in this file for the equivalent setup and inline that pattern. The intent is: a real `SelectionController` over a real `World` with one alive entity, then call `_internals.onMouseUp` directly.

- [ ] **Step 3: Run the new tests — expect failure**

Run: `npx vitest run src/input/selection-controller.test.ts`
Expected: 4 new tests fail. The existing Ctrl+RMB path is unhandled — Ctrl is currently only meaningful for LMB-click ("select same kind"). RMB ignores `ctrlKey` today, so Ctrl+RMB falls into the regular RMB branch and issues a plain `move`.

- [ ] **Step 4: Add the binding**

Open `src/input/selection-controller.ts`. Find the `if (e.button === 2) { ... }` block in `onMouseUp`. The first three guards are: attack-move mode, formation-drag commit, regular RMB. Insert a Ctrl-check **after** the formation-drag commit (so dragging beats Ctrl) and **before** the regular RMB attack/move dispatch.

Update the imports near the top of the file to include `issueMarchFormation`:

```ts
import { issueMove, issueAttack, issueAttackMove, issueStop, issueRegroup, issueFormationMove, issueReformAtTarget, issueMarchFormation } from './commands';
```

(Keep all existing items; just add `issueMarchFormation` to the list. Verify no duplicate after edit.)

Then in `onMouseUp`'s `e.button === 2` branch, find this section:

```ts
      pendingFormationStart = null;
      formationDrag.active = false;

      const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
      const hit = hitTestPoint(world, w);
      if (hit !== -1 && world.entities.team[hit] !== PLAYER_TEAM) {
        issueAttack(world, selection, hit, opts);
        ...
```

**Insert before `const hit = hitTestPoint(...)`:**

```ts
      // Ctrl + RMB: march in formation. Skips queueing (Shift is ignored here).
      if ((e.ctrlKey || e.metaKey) && selection.ids.size > 0) {
        issueMarchFormation(world, selection, w, formationParams);
        puff(w.x, w.y);
        return;
      }
```

- [ ] **Step 5: Run the controller tests — expect PASS**

Run: `npx vitest run src/input/selection-controller.test.ts`
Expected: all passing.

- [ ] **Step 6: Run the full vitest suite — expect no regressions**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/input/selection-controller.ts src/input/selection-controller.test.ts
git commit -m "feat(input): Ctrl+RMB up issues a formation march"
```

---

## Task 7: Wire `marchSystem` into `main.ts`

Insert before `ordersSystem` so phase changes are visible the same tick.

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the import**

Near the other system imports in `src/main.ts` (around lines 10-17), add:

```ts
import { marchSystem } from './sim/systems/march-system';
```

- [ ] **Step 2: Insert into the system list**

Find the `world.systems = [...]` block. Insert `marchSystem` as the FIRST entry:

```ts
world.systems = [
  marchSystem,
  ordersSystem,
  combatSystem,
  movementSystem,
  facingSystem,
  collisionSystem,
  stateSystem,
  projectileSystem,
  ragdollSystem,
];
```

- [ ] **Step 3: Run typecheck — expect clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full vitest suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): register marchSystem ahead of ordersSystem"
```

---

## Task 8: Manual verification

Code is complete. Validate the feel in the browser before declaring done.

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open the URL printed in the terminal.

- [ ] **Step 2: Off-axis pivot test**

1. Drag-select the friendly army (or pick one regiment with double-click).
2. Ctrl + Right-click on a point ~150 m away **off-axis** (e.g., 90° to the army's current facing).
3. Confirm:
   - Pace is visibly slower than a plain RMB move (1.5 m/s vs 2.5 m/s for line infantry).
   - The formation pivots toward the click direction as it begins marching — units across the line travel further than units near the new front, producing an emergent "wheel".

- [ ] **Step 3: Volley-during-march test**

1. With the friendly army selected, Ctrl + Right-click a point on the far side of the enemy line.
2. As the front rank crosses ~80 m range:
   - The whole group halts.
   - Front rank fires a volley (muzzle flash + smoke + projectiles).
   - After ~4 s, the group resumes marching.
3. Watch reload: ~18 s later, the next halt occurs (only fully-reloaded shooters can re-trigger).

- [ ] **Step 4: Cancel test**

1. During an active march, plain RMB to a different point.
2. Confirm: units accelerate to full move speed (no formation, no volley pause). On the next tick the prior march group should be gone (verify by checking that no "halt at range" behavior persists — if you Ctrl+RMB again and immediately plain-RMB-cancel, the group is dropped).

- [ ] **Step 5: Stop test**

1. Issue a march, then press `Backspace` (issueStop).
2. Confirm: units halt; no further volleys triggered from the cancelled group.

- [ ] **Step 6: No-shooter group**

If the project has cuirassier units handy, select only cavalry, Ctrl+RMB across the map. Confirm: they march at march-speed but never halt (no volley triggers).

- [ ] **Step 7: Document any issues**

If any of the above behave unexpectedly, file the surprise as a follow-up rather than patching live. The plan's TDD coverage should have caught logic bugs; visual/feel issues are tuning, not failures.

---

## Self-Review

**Spec coverage check:**
- Binding (Ctrl+RMB up on terrain, Shift ignored, drag falls through, attack-move ignored) → Task 6.
- Slot computation (centroid → target forward, syntheticFormationDrag anchored at target, Hungarian assignment) → Task 5 `issueMarchFormation`.
- March group state (`MarchGroup`, `createMarchGroup`, `removeMarchGroupMember`) → Task 2.
- World additions (`marchGroups`, `nextMarchGroupId`) → Task 1.
- Order kind extension → Task 1.
- Orders-system handler (volley=halt+facing, march=walk-at-march-speed, arrival, missing-group) → Task 3.
- March-system phase machine (volley trigger, VOLLEY_DURATION, scan striping, member reconciliation, group dissolution) → Task 4.
- main.ts wiring (marchSystem before ordersSystem) → Task 7.
- Manual verification (golden path) → Task 8.
- All `Files touched` entries from the spec are covered above.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "appropriate error handling" anywhere. All test bodies and implementation bodies are fully written.

**Type consistency:** `MarchGroup`, `MarchPhase`, `createMarchGroup`, `removeMarchGroupMember` defined in Task 2 and used by Tasks 3-5 with matching signatures. `MARCH_SPEED_FACTOR`, `VOLLEY_DURATION`, `MARCH_SCAN_PERIOD` defined in Task 3 stub and finalized in Task 4 — same names. `issueMarchFormation` signature defined in Task 5 and called in Task 6 with matching args. `Order` union extension in Task 1 matches the order shape dispatched in Task 5 and read in Tasks 3 and 4.

**Known gaps that the spec acknowledged and that the plan does not address (intentional):**
- Slot-computation duplication with `issueReformAtTarget` is acceptable for v1; dedupe is a follow-up.
- Cannon firing while marching at 0.72 m/s (under the combat-system velocity gate) — known quirk, not a v1 bug.
- No on-screen affordance for the Ctrl modifier — discoverability deferred.
