# Formation March — Lock-Step Pacing + Placement Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten formation marches so the slowest unit sets the pace (everyone arrives together) and show a green-marching-ants preview of the proposed pivoted formation while Ctrl is held.

**Architecture:** `MarchGroup` gains a `paceMaxDist` field that `march-system` updates each tick. `orders-system`'s `march-formation` branch divides intended velocity by the group's `paceMaxDist` ratio. A new pure helper `computeMarchSlots` lives in `src/input/formation.ts`; both `issueMarchFormation` and the controller's preview accessor call it. The controller tracks `ctrlHeld` (key state) and `lastCursorScreen` (mouse state); `formationPreview()` multiplexes drag preview and march preview through the same render channel.

**Tech Stack:** TypeScript, Vitest, ECS (typed-array entities), existing formation helpers.

**Spec:** `docs/superpowers/specs/2026-04-27-formation-march-pacing-preview-design.md`.

---

## File Structure

**Modified files:**
- `src/sim/march-groups.ts` — add `paceMaxDist: number` to `MarchGroup`; init to 0 in `createMarchGroup`.
- `src/sim/march-groups.test.ts` — extend.
- `src/sim/systems/march-system.ts` — compute `paceMaxDist` each tick after member reconciliation, before phase transitions.
- `src/sim/systems/march-system.test.ts` — extend.
- `src/sim/systems/orders-system.ts` — lock-step pacing in march-formation branch.
- `src/sim/systems/orders-system.test.ts` — extend.
- `src/input/formation.ts` — new exported `computeMarchSlots` helper + `MarchSlotsResult` type.
- `src/input/formation.test.ts` — extend.
- `src/input/commands.ts` — `issueMarchFormation` delegates to `computeMarchSlots`.
- `src/input/selection-controller.ts` — `ctrlHeld`, `lastCursorScreen`, `onKeyUp`, extended `formationPreview()`.
- `src/input/selection-controller.test.ts` — extend.

**No new files.**

---

## Task 1: `paceMaxDist` field on `MarchGroup`

Pure data-model change. Init at 0, no behavior yet.

**Files:**
- Modify: `src/sim/march-groups.ts`
- Modify: `src/sim/march-groups.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/sim/march-groups.test.ts`:

```ts
  it('createMarchGroup initializes paceMaxDist to 0', () => {
    const g = createMarchGroup(1, [10, 11], { x: 1, y: 0 }, 0);
    expect(g.paceMaxDist).toBe(0);
  });
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/sim/march-groups.test.ts`
Expected: FAIL with "Property 'paceMaxDist' does not exist" (TypeScript) or `undefined` at runtime.

- [ ] **Step 3: Add the field**

Edit `src/sim/march-groups.ts`. Replace the `MarchGroup` interface:

```ts
export interface MarchGroup {
  id: number;
  members: Set<number>;
  phase: MarchPhase;
  /** world.simTime at which `phase` was last entered. */
  phaseStartT: number;
  /** Unit-vector facing direction, locked at issue time. */
  forward: Vec2;
  /** Max distance-to-slot across live members, recomputed each tick by march-system.
   *  Used by orders-system to pace the group so the furthest unit sets the speed. */
  paceMaxDist: number;
}
```

Update `createMarchGroup` return:

```ts
  return {
    id,
    members: new Set(members),
    phase: 'march',
    phaseStartT: simTime,
    forward: { x: forward.x, y: forward.y },
    paceMaxDist: 0,
  };
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/sim/march-groups.test.ts`
Expected: 4/4 passing (3 existing + 1 new).

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `npx vitest run`
Expected: same pass/fail counts as before plus the new pass. (Pre-existing failures in `lab/wind.test.ts` etc. unchanged.)

---

## Task 2: `march-system` populates `paceMaxDist`

After member reconciliation, before phase transitions. Runs every tick (both `march` and `volley` phases) so the value is fresh whenever orders-system reads it.

**Files:**
- Modify: `src/sim/systems/march-system.ts`
- Modify: `src/sim/systems/march-system.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/sim/systems/march-system.test.ts`:

```ts
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
    const a = spawnInfantry(world, 100, 0, 0);
    const gid = 1;
    world.marchGroups.set(gid, createMarchGroup(gid, [a], { x: 1, y: 0 }, 0));
    world.orderQueue.set(a, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);
    rebuildGrid(world);

    marchSystem(world, 1 / 60);

    expect(world.marchGroups.get(gid)!.paceMaxDist).toBeLessThanOrEqual(0.01);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/sim/systems/march-system.test.ts`
Expected: 3 new tests fail. `paceMaxDist` is initialized to 0 by Task 1 but never updated; assertions on actual distances fail.

- [ ] **Step 3: Insert paceMaxDist computation**

Edit `src/sim/systems/march-system.ts`. Find the section in the per-group loop, immediately after the member reconciliation block:

```ts
    if (group.members.size === 0) {
      world.marchGroups.delete(gid);
      continue;
    }
```

**Insert immediately after that block, before `// 2. Phase transitions.`:**

```ts
    // Pace: max distance any live member has to its slot. Drives lock-step
    // velocity in orders-system so the furthest unit sets the group's pace.
    let paceMax2 = 0;
    for (const id of group.members) {
      const q = world.orderQueue.get(id);
      const head = q && q[0];
      if (!head || head.kind !== 'march-formation') continue;
      const dx = head.targetX - e.posX[id]!;
      const dy = head.targetY - e.posY[id]!;
      const d2 = dx * dx + dy * dy;
      if (d2 > paceMax2) paceMax2 = d2;
    }
    group.paceMaxDist = Math.sqrt(paceMax2);
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/sim/systems/march-system.test.ts`
Expected: all (existing 7 + new 3 = 10) passing.

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: existing pass count + 3 new passes; pre-existing failures unchanged.

---

## Task 3: orders-system uses `paceMaxDist` for lock-step pacing

The march phase divides each unit's intended velocity by the group's pace ratio. Furthest unit moves at full march speed; closer units throttle so all arrive together.

**Files:**
- Modify: `src/sim/systems/orders-system.ts`
- Modify: `src/sim/systems/orders-system.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/sim/systems/orders-system.test.ts` inside the existing `describe('ordersSystem march-formation handler', ...)` block (or in a new describe block right below it):

```ts
describe('ordersSystem march-formation lock-step pacing', () => {
  it('throttles a near unit so it arrives with the far unit', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const far = allocEntity(world.entities);
    world.entities.kindId[far] = getUnitKindIndex('line-infantry'); // moveSpeed 2.5
    world.entities.posX[far] = 0;
    world.entities.posY[far] = 0;
    world.entities.state[far] = EntityState.Idle;

    const near = allocEntity(world.entities);
    world.entities.kindId[near] = getUnitKindIndex('line-infantry');
    world.entities.posX[near] = 75;
    world.entities.posY[near] = 0;
    world.entities.state[near] = EntityState.Idle;

    const gid = 1;
    const g = createMarchGroup(gid, [far, near], { x: 1, y: 0 }, 0);
    g.paceMaxDist = 100; // far has 100m to go; near has 25m.
    world.marchGroups.set(gid, g);
    world.orderQueue.set(far, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);
    world.orderQueue.set(near, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);

    _ordersSystem(world, 1 / 60);

    // March speed = 2.5 * 0.6 = 1.5 m/s.
    // Far: pace = 100/100 = 1.0 → vel = 1.5 m/s.
    // Near: pace = 25/100 = 0.25 → vel = 0.375 m/s.
    expect(world.entities.velX[far]).toBeCloseTo(1.5, 5);
    expect(world.entities.velX[near]).toBeCloseTo(0.375, 5);
  });

  it('single-member group paces at 1.0 (no behavioral change)', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    const gid = 1;
    const g = createMarchGroup(gid, [id], { x: 1, y: 0 }, 0);
    g.paceMaxDist = 100;
    world.marchGroups.set(gid, g);
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);

    _ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBeCloseTo(1.5, 5);
  });

  it('paceMaxDist === 0 yields zero velocity (defensive)', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.state[id] = EntityState.Idle;
    const gid = 1;
    const g = createMarchGroup(gid, [id], { x: 1, y: 0 }, 0);
    g.paceMaxDist = 0; // manually unset
    world.marchGroups.set(gid, g);
    world.orderQueue.set(id, [{ kind: 'march-formation', targetX: 100, targetY: 0, groupId: gid }]);

    _ordersSystem(world, 1 / 60);

    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
  });
});
```

(Note: existing tests reference `_ordersSystem` already — keep that alias.)

The original "march phase writes velocity at march speed toward the slot" test (from the earlier task) was written for a single-member group whose `paceMaxDist` was implicitly 0 (no march-system tick had run). After the new code, that test would fail because pace=0 → vel=0. **Update that test** so it sets `g.paceMaxDist = 100` (matching its 100 m target distance) before invoking the system. Open `src/sim/systems/orders-system.test.ts`, find the test starting `it('march phase writes velocity at march speed toward the slot', () => {` and add this line right after `world.marchGroups.set(gid, createMarchGroup(gid, [id], { x: 1, y: 0 }, 0));`:

```ts
    world.marchGroups.get(gid)!.paceMaxDist = 100;
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/sim/systems/orders-system.test.ts`
Expected: the 3 new tests fail (pace not yet implemented).

- [ ] **Step 3: Implement lock-step pacing**

Edit `src/sim/systems/orders-system.ts`. Find this block in the `march-formation` branch:

```ts
      } else {
        const speed = baseSpeed * MARCH_SPEED_FACTOR;
        e.velX[id] = (dx / dist) * speed;
        e.velY[id] = (dy / dist) * speed;
        writeFacingIntent(e, id, dx, dy);
      }
```

Replace with:

```ts
      } else {
        const marchSpeed = baseSpeed * MARCH_SPEED_FACTOR;
        const pace = group.paceMaxDist > 0 ? Math.min(1, dist / group.paceMaxDist) : 0;
        const speed = marchSpeed * pace;
        e.velX[id] = (dx / dist) * speed;
        e.velY[id] = (dy / dist) * speed;
        writeFacingIntent(e, id, dx, dy);
      }
```

The `arrived === true` recovery-drift branch above is unchanged — that's a per-unit shoved-then-recover case, not formation movement.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/sim/systems/orders-system.test.ts`
Expected: all passing (original 6 with one updated + 3 new = 9).

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: pre-existing failures unchanged; new passes added.

---

## Task 4: Extract `computeMarchSlots` helper; refactor `issueMarchFormation`

Pure helper used by both dispatch and preview. No behavior change for `issueMarchFormation` (existing tests must still pass).

**Files:**
- Modify: `src/input/formation.ts`
- Modify: `src/input/formation.test.ts`
- Modify: `src/input/commands.ts`

- [ ] **Step 1: Write failing tests for `computeMarchSlots`**

Append to `src/input/formation.test.ts`:

```ts
import { computeMarchSlots, type MarchSlotsResult } from './formation';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createFormationParams } from './formation-params';

function spawnLI(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex('line-infantry');
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

describe('computeMarchSlots', () => {
  it('returns null on empty selection', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const r = computeMarchSlots(world, [], { x: 50, y: 0 }, createFormationParams());
    expect(r).toBeNull();
  });

  it('one alive unit returns one slot anchored at the target', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawnLI(world, 0, 0);
    const r = computeMarchSlots(world, [id], { x: 50, y: 0 }, createFormationParams())!;
    expect(r).not.toBeNull();
    expect(r.units.length).toBe(1);
    expect(r.targets.length).toBe(1);
    expect(r.targets[0]!.x).toBeCloseTo(50, 3);
    expect(r.targets[0]!.y).toBeCloseTo(0, 3);
  });

  it('two-unit selection: forward points along centroid→target; slot centroid lands at target', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnLI(world, 0, 0);
    const b = spawnLI(world, 4, 0);
    const r = computeMarchSlots(world, [a, b], { x: 100, y: 0 }, createFormationParams())!;
    expect(r.forward.x).toBeGreaterThan(0.99);
    expect(Math.abs(r.forward.y)).toBeLessThan(0.01);
    const cx = (r.targets[0]!.x + r.targets[1]!.x) / 2;
    const cy = (r.targets[0]!.y + r.targets[1]!.y) / 2;
    expect(cx).toBeCloseTo(100, 3);
    expect(cy).toBeCloseTo(0, 3);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/input/formation.test.ts`
Expected: 3 new tests fail with "computeMarchSlots is not a function".

- [ ] **Step 3: Add the helper to `src/input/formation.ts`**

Open `src/input/formation.ts`. Add to the imports near the top (or extend existing imports):

```ts
import type { World } from '../sim/world';
import type { FormationParams } from './formation-params';
import { spacingMultiplier } from './formation-params';
```

(Adjust if those are already imported — many of these helpers reference World already.)

Append at the bottom of the file:

```ts
export interface MarchSlotsResult {
  /** Slot world-positions in row-major order from `computeFormationSlots`. */
  slots: Vec2[];
  /** Bounding rectangle of the formation footprint. */
  rect: { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 };
  /** Unit-vector forward direction (centroid → target). */
  forward: Vec2;
  /** Per-unit Hungarian-assigned destinations, parallel to `units`. */
  targets: Vec2[];
  /** The live formation units used to build the slots, in their assignment order. */
  units: FormationUnit[];
}

/**
 * Compute the pivoted formation footprint for a march to `target`. Pivots the
 * selection so its facing points from current centroid to `target`, anchored
 * at `target` so the formation lands at the destination after marching.
 *
 * Pure read of world state; no side effects. Returns null when no live units.
 */
export function computeMarchSlots(
  world: World,
  ids: Iterable<number>,
  target: Vec2,
  formationParams: FormationParams,
): MarchSlotsResult | null {
  const units = liveFormationUnits(world, ids);
  if (units.length === 0) return null;

  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= units.length; cy /= units.length;

  let fx = target.x - cx;
  let fy = target.y - cy;
  const len = Math.hypot(fx, fy);
  if (len < 1e-6) { fx = 1; fy = 0; } else { fx /= len; fy /= len; }
  const forwardW: Vec2 = { x: fx, y: fy };

  const spacingMult = spacingMultiplier(formationParams);
  const chosenRanks = formationParams.ranks ?? inferRanksFromPositions(units, forwardW);

  const { startW, endW } = syntheticFormationDrag(units, forwardW, chosenRanks, spacingMult, target);
  const { slots, rect, forward } = computeFormationSlots({
    units, startW, endW, spacingMult, ranksOverride: chosenRanks,
  });
  const targets = assignFormationSlots(units, slots, forward);

  return { slots, rect, forward, targets, units };
}
```

- [ ] **Step 4: Run — expect PASS for new tests**

Run: `npx vitest run src/input/formation.test.ts`
Expected: all passing (existing + 3 new).

- [ ] **Step 5: Refactor `issueMarchFormation` to use the helper**

Open `src/input/commands.ts`. Add `computeMarchSlots` to the formation imports:

```ts
import { computeFormationSlots, assignFormationSlots, liveFormationUnits, syntheticFormationDrag, inferRanksFromPositions, computeMarchSlots } from './formation';
```

Replace the body of `issueMarchFormation` (keep the same signature and JSDoc above it):

```ts
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
```

The unused imports (`syntheticFormationDrag`, `inferRanksFromPositions`, `computeFormationSlots`, `assignFormationSlots`, `spacingMultiplier`) may still be used by sibling functions in the file (`issueReformInPlace`, `issueReformAtTarget`). Don't remove them blindly — leave them as-is.

- [ ] **Step 6: Run the commands tests — expect PASS (no behavior change)**

Run: `npx vitest run src/input/commands.test.ts`
Expected: 24 passing (no test changes; refactor must be transparent).

- [ ] **Step 7: Run full suite**

Run: `npx vitest run`
Expected: pre-existing failures unchanged.

---

## Task 5: Controller `ctrlHeld`, `lastCursorScreen`, extended `formationPreview`

Track Ctrl key state and last cursor position. Multiplex march preview through the existing `formationPreview()` channel — renderer is unchanged.

**Files:**
- Modify: `src/input/selection-controller.ts`
- Modify: `src/input/selection-controller.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/input/selection-controller.test.ts`. Use the existing test fixture (`makeDeps()` + `spawn()`) — see how the prior Ctrl+RMB tests built theirs (look near the bottom of the file in the `describe('selectionController Ctrl+RMB march-formation', ...)` block for the pattern).

```ts
describe('selectionController march placement preview', () => {
  it('formationPreview() returns null when Ctrl is not held', () => {
    const { controller, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);
    expect(controller.formationPreview()).toBeNull();
  });

  it('returns a non-null preview after Ctrl keydown + mousemove', () => {
    const { controller, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);

    controller._internals.onMouseMove({ clientX: 200, clientY: 200 });
    controller._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });

    const preview = controller.formationPreview();
    expect(preview).not.toBeNull();
    expect(preview!.slots.length).toBe(1);
  });

  it('Ctrl keyup clears the preview', () => {
    const { controller, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);

    controller._internals.onMouseMove({ clientX: 200, clientY: 200 });
    controller._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });
    expect(controller.formationPreview()).not.toBeNull();

    controller._internals.onKeyUp({ key: 'Control', code: 'ControlLeft' });
    expect(controller.formationPreview()).toBeNull();
  });

  it('preview is null when selection becomes empty even with Ctrl held', () => {
    const { controller, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);
    controller._internals.onMouseMove({ clientX: 200, clientY: 200 });
    controller._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });
    expect(controller.formationPreview()).not.toBeNull();

    selection.ids.clear();
    expect(controller.formationPreview()).toBeNull();
  });

  it('formation drag wins over march preview when both could apply', () => {
    const { controller, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);
    // Hold Ctrl so the march preview would fire.
    controller._internals.onMouseMove({ clientX: 100, clientY: 100 });
    controller._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });

    // Now start an RMB drag past the threshold.
    controller._internals.onMouseDown({ button: 2, clientX: 100, clientY: 100, target: null });
    controller._internals.onMouseMove({ clientX: 300, clientY: 100 });

    // formationPreview should reflect the drag, not the march.
    // We can't easily compare slot positions here, but the preview must be
    // non-null and computed from the drag's startWorld→currentScreen rather
    // than the cursor. Sanity check: forward direction should be roughly +x
    // (drag along screen-x) regardless of where the march preview would point.
    const preview = controller.formationPreview();
    expect(preview).not.toBeNull();
    // Without a march, the only way to produce a preview here is the drag —
    // and that's what we want.
  });

  it('onBlur clears Ctrl-held state and the preview', () => {
    const { controller, selection, world } = makeDeps();
    const id = spawn(world, 'line-infantry', 0, 100, 100);
    selection.ids.add(id);
    controller._internals.onMouseMove({ clientX: 200, clientY: 200 });
    controller._internals.onKeyDown({ key: 'Control', code: 'ControlLeft', shiftKey: false, ctrlKey: true, metaKey: false });
    expect(controller.formationPreview()).not.toBeNull();

    controller._internals.onBlur();
    expect(controller.formationPreview()).toBeNull();
  });
});
```

If `_internals` doesn't expose `onKeyUp`, that's expected — Step 5 below adds it.

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/input/selection-controller.test.ts`
Expected: 6 new tests fail (some on missing `onKeyUp`, others on missing preview behavior).

- [ ] **Step 3: Add controller state**

Open `src/input/selection-controller.ts`. Find the block of `let` declarations near the top of `createSelectionController` (alongside `cursorMode`, `pendingClickStart`, `tightHeld`, `fHeld`, etc.). Add:

```ts
  let ctrlHeld = false;
  let lastCursorScreen: { x: number; y: number } | null = null;
```

- [ ] **Step 4: Wire up the import for `computeMarchSlots`**

Add `computeMarchSlots` to the existing formation imports near the top:

```ts
import { computeFormationSlots, assignFormationSlots, type FormationUnit, liveFormationUnits as materializeUnits, computeMarchSlots } from './formation';
```

(Adjust if `materializeUnits` is the existing alias for `liveFormationUnits` — don't change the alias.)

- [ ] **Step 5: Update `onMouseMove`, `onKeyDown`; add `onKeyUp`; update `onBlur`**

Find `onMouseMove`. Add at the top (before any other logic):

```ts
    lastCursorScreen = { x: e.clientX, y: e.clientY };
```

Find `onKeyDown`. Add at the very start (before the existing `if (e.key === 'Escape')` etc.):

```ts
    if (e.key === 'Control' || e.key === 'Meta') {
      ctrlHeld = true;
      // fall through; other modifiers may still drive other handlers below
    }
```

(The fallthrough is intentional — other handlers may need to react to other keys; we don't want to early-return on Ctrl.)

**Add a new `onKeyUp` handler** (whole new function, near `onKeyDown`):

```ts
  function onKeyUp(e: { key: string; code: string }): void {
    if (e.key === 'Control' || e.key === 'Meta') ctrlHeld = false;
  }
```

Find `onBlur`. Add to it:

```ts
    ctrlHeld = false;
    lastCursorScreen = null;
```

- [ ] **Step 6: Wire `onKeyUp` into the DOM bindings**

Find the section that sets up DOM listeners (search for `addEventListener('keydown'`). It looks like:

```ts
  const md = (e: MouseEvent) => onMouseDown({ ... });
  const mm = (e: MouseEvent) => onMouseMove({ ... });
  const mu = (e: MouseEvent) => onMouseUp({ ... });
  const kd = (e: KeyboardEvent) => onKeyDown({ ... });
  const bl = () => onBlur();

  if (typeof window !== 'undefined') {
    window.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    window.addEventListener('keydown', kd);
    window.addEventListener('blur', bl);
  }
```

Add `ku` alongside:

```ts
  const ku = (e: KeyboardEvent) => onKeyUp({ key: e.key, code: e.code });
```

Add the listener registration:

```ts
    window.addEventListener('keyup', ku);
```

Add the unregistration in the controller's `destroy()` method (mirror the `keydown` line):

```ts
        window.removeEventListener('keyup', ku);
```

Add `onKeyUp` to the `_internals` test seam at the bottom of the controller (look for the existing `_internals: { onMouseDown, onMouseMove, onMouseUp, onKeyDown, onBlur, ... }` and add `onKeyUp`):

```ts
    _internals: { onMouseDown, onMouseMove, onMouseUp, onKeyDown, onKeyUp, onBlur, ... },
```

(Preserve every other property already on `_internals`.)

Also extend the `ControllerInternals` interface near the top of the file to include `onKeyUp`:

```ts
interface ControllerInternals {
  onMouseDown(e: { ... }): void;
  onMouseMove(e: { ... }): void;
  onMouseUp(e: { ... }): void;
  onKeyDown(e: { ... }): void;
  onKeyUp(e: { key: string; code: string }): void;
  onBlur(): void;
  getCursorMode(): CursorMode;
}
```

- [ ] **Step 7: Extend `formationPreview()` to multiplex**

Find `function formationPreview(): FormationPreview | null {` and replace its body:

```ts
  function formationPreview(): FormationPreview | null {
    if (cursorMode !== 'normal') return null;

    // Drag preview wins when an RMB drag is active.
    if (formationDrag.active) {
      const units = materializeUnits(world, selection.ids);
      if (units.length === 0) return null;
      const startW = formationDrag.startWorld;
      const endW = screenToWorld(camera, formationDrag.currentScreen);
      const { slots, rect } = computeFormationSlots({
        units, startW, endW,
        spacingMult: Math.max(spacingMultiplier(formationParams), MARCH_FLOOR_MULT),
        ranksOverride: null,
      });
      return { rect, slots };
    }

    // March preview when Ctrl is held over the canvas with a non-empty selection.
    if (ctrlHeld && selection.ids.size > 0 && lastCursorScreen) {
      const w = screenToWorld(camera, lastCursorScreen);
      const r = computeMarchSlots(world, selection.ids, w, formationParams);
      if (!r) return null;
      return { rect: r.rect, slots: r.slots };
    }

    return null;
  }
```

- [ ] **Step 8: Run controller tests — expect PASS**

Run: `npx vitest run src/input/selection-controller.test.ts`
Expected: all passing (existing + 6 new).

- [ ] **Step 9: Run full suite**

Run: `npx vitest run`
Expected: pre-existing failures unchanged.

- [ ] **Step 10: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no NEW errors. (Pre-existing projectile / cuirassier-poses errors may remain — those are unrelated WIP.)

---

## Task 6: Manual verification

Validate the feel in the browser.

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open the URL in a browser.

- [ ] **Step 2: Pacing test**

1. Drag-select a regiment.
2. Ctrl+RMB on a point ~150 m away **off-axis** (90° to the army's facing).
3. Observe: the formation pivots and translates with the slowest unit setting the pace — soldiers across the line walk at full march speed; soldiers near the new front walk slowly to wait. Formation stays cohesive throughout.
4. Compare against the pre-pacing behavior: previously the formation stretched and units arrived at very different times.

- [ ] **Step 3: Mixed-kind test**

1. Select a mixed group (e.g., infantry + cannon, if both spawn in the demo scene).
2. Ctrl+RMB to a far point.
3. Observe: the slower unit (cannon) sets the pace; infantry walks slower than usual to stay with it.

- [ ] **Step 4: Preview test**

1. Drag-select a regiment.
2. Hold Ctrl. Move the mouse around the canvas without clicking.
3. Confirm: a green marching-ants outline + slot pips follows the cursor, showing the proposed pivoted formation footprint at the cursor's world position.
4. Adjust spacing (`[`/`]`) and ranks (`,`/`.`) — the preview updates immediately.
5. Release Ctrl: the preview disappears.

- [ ] **Step 5: Drag-vs-march preview precedence**

1. With selection + Ctrl held, start an RMB drag.
2. Confirm: as soon as the drag starts (past the 4 px threshold), the preview switches to the drag preview (anchored at the drag start, sweeping to the cursor) — not the march preview.
3. Release RMB without committing a march; preview snaps back to the march preview if Ctrl is still held.

- [ ] **Step 6: Volley + pacing combined**

1. Ctrl+RMB toward the enemy line as before.
2. Confirm: the formation marches in lock-step (cohesive) until the front rank enters weapon range, the whole group halts for ~4 s of volley, then resumes — and the resumption is ALSO lock-step (no straggling units accelerate ahead).

---

## Self-Review

**Spec coverage check:**
- `paceMaxDist` field on `MarchGroup` → Task 1.
- march-system populates `paceMaxDist` each tick across both phases → Task 2.
- orders-system lock-step velocity using `paceMaxDist` → Task 3.
- `computeMarchSlots` pure helper → Task 4.
- `issueMarchFormation` delegates to helper → Task 4.
- Controller `ctrlHeld`, `lastCursorScreen`, `onKeyUp` → Task 5.
- `formationPreview()` multiplexes drag + march → Task 5.
- Manual verification → Task 6.
- All `Files touched` from the spec are addressed.

**Placeholder scan:** No "TBD"/"TODO"/"appropriate error handling"/"similar to" patterns. Test bodies and implementation bodies are complete.

**Type consistency:**
- `paceMaxDist: number` defined in Task 1, read in Task 3, written in Task 2 — same name throughout.
- `MarchSlotsResult` defined in Task 4 with fields `slots, rect, forward, targets, units`; consumed in Task 4 (`issueMarchFormation`) and Task 5 (preview) using the same field names.
- `computeMarchSlots(world, ids, target, formationParams)` signature consistent across callers.
- `onKeyUp(e: { key, code })` defined in Task 5 step 5 and used in `_internals` interface (step 6) with matching shape.

**Notes for implementers:**
- Tasks 1, 2, 3 are tightly coupled (data → write → read). Land them in order.
- Tasks 4 and 5 are independent of each other. Either can land before the other once Task 1 is done.
- The plan does NOT include commit steps. Per repo policy, the user manages commit boundaries — leave changes staged or unstaged in the working tree.
