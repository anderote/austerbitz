# Formation Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click + drag forms a Total War-style rectangular formation: drag = front rank, depth auto-fills based on selection size; live preview shows the bounding rectangle + per-slot pips.

**Architecture:** Pure geometry module (`formation.ts`) computes slot positions from drag endpoints. Controller owns a `FormationDrag` screen-state and exposes a `formationPreview()` accessor that returns world-space rect corners + slot positions. Renderer reads the preview and draws marching-ants outline + instanced pips. Slot positions flow into per-unit `move` orders via a new `issueFormationMove` dispatcher.

**Tech Stack:** TypeScript, Vitest, WebGL2 (instanced quads + GLSL ES 300).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/input/selection.ts` | Modify | Export `FormationDrag` type + `createFormationDrag()`. |
| `src/input/formation.ts` | Create | Pure geometry: `computeFormationSlots`, `assignFormationSlots`. |
| `src/input/formation.test.ts` | Create | Unit tests for both pure functions. |
| `src/input/commands.ts` | Modify | Add `issueFormationMove`. |
| `src/input/commands.test.ts` | Create or extend | Tests for `issueFormationMove` (creates if absent). |
| `src/input/selection-controller.ts` | Modify | Right-mouse drag → formation orders + `formationPreview()` accessor. |
| `src/input/selection-controller.test.ts` | Modify | Right-mouse drag flow tests. |
| `src/render/shaders/selection.glsl.ts` | Modify | Add `u_color` uniform to drag-rect FS; add `PIP_VS` / `PIP_FS`. |
| `src/render/passes/selection-pass.ts` | Modify | Accept `formationPreview`, draw outline rect + pips, pass color uniforms. |
| `src/render/renderer.ts` | Modify | Thread `formationPreview` through `render()`. |
| `src/main.ts` | Modify | Construct `FormationDrag`, pass to controller, pipe preview to renderer. |

---

## Task 1: `FormationDrag` state type

**Files:**
- Modify: `src/input/selection.ts`

- [ ] **Step 1: Add the types and factory**

Append to `src/input/selection.ts` (after the existing `createDragRect`):

```ts
export interface FormationDrag {
  start: Vec2;     // screen-space
  current: Vec2;   // screen-space
  active: boolean;
}

export function createFormationDrag(): FormationDrag {
  return {
    start: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    active: false,
  };
}

/** World-space preview shown during an active formation drag. */
export interface FormationPreview {
  rect: { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 };
  slots: Vec2[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/input/selection.ts
git commit -m "feat(input): add FormationDrag state type"
```

---

## Task 2: `computeFormationSlots` — geometry

**Files:**
- Create: `src/input/formation.ts`
- Create: `src/input/formation.test.ts`

- [ ] **Step 1: Write the failing test for a single-unit zero-length drag**

Create `src/input/formation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeFormationSlots } from './formation';

describe('computeFormationSlots', () => {
  it('single unit, zero-length drag → one slot at midDrag', () => {
    const r = computeFormationSlots({
      units: [{ id: 0, x: 10, y: 10, spacingX: 1, spacingY: 1 }],
      startW: { x: 50, y: 50 },
      endW: { x: 50, y: 50 },
    });
    expect(r.slots.length).toBe(1);
    expect(r.slots[0]!.x).toBeCloseTo(50);
    expect(r.slots[0]!.y).toBeCloseTo(50);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/input/formation.test.ts`
Expected: FAIL with "Cannot find module './formation'".

- [ ] **Step 3: Create the module skeleton (still failing)**

Create `src/input/formation.ts`:

```ts
import type { Vec2 } from '../util/math';

export interface FormationUnit {
  id: number;
  x: number;
  y: number;
  spacingX: number;
  spacingY: number;
}

export interface FormationInput {
  units: FormationUnit[];
  startW: Vec2;
  endW: Vec2;
}

export interface FormationSlots {
  slots: Vec2[];
  rect: { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 };
}

export function computeFormationSlots(input: FormationInput): FormationSlots {
  throw new Error('not implemented');
}
```

- [ ] **Step 4: Implement the function**

Replace the body of `computeFormationSlots`:

```ts
export function computeFormationSlots(input: FormationInput): FormationSlots {
  const { units, startW, endW } = input;
  const N = units.length;

  // Spacing: max across selection so mixed kinds don't overlap.
  let spacingX = 0, spacingY = 0;
  for (const u of units) {
    if (u.spacingX > spacingX) spacingX = u.spacingX;
    if (u.spacingY > spacingY) spacingY = u.spacingY;
  }
  if (spacingX <= 0) spacingX = 1;
  if (spacingY <= 0) spacingY = 1;

  // Forward = drag direction, perpA = 90° left of forward.
  const dx = endW.x - startW.x;
  const dy = endW.y - startW.y;
  const dragLen = Math.hypot(dx, dy);
  const eps = 1e-6;
  const fx = dragLen > eps ? dx / dragLen : 1;
  const fy = dragLen > eps ? dy / dragLen : 0;
  const px = -fy;
  const py = fx;

  // Front rank size and depth.
  const frontCount = Math.max(1, Math.min(N, Math.floor(dragLen / spacingX) + 1));
  const ranks = Math.ceil(N / frontCount);

  // Centroid of unit positions; flip perpendicular if it points toward units.
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  if (N > 0) { cx /= N; cy /= N; }
  const midX = (startW.x + endW.x) / 2;
  const midY = (startW.y + endW.y) / 2;
  const sideDot = (midX - cx) * px + (midY - cy) * py;
  const sign = sideDot >= 0 ? 1 : -1;
  const dpx = px * sign;
  const dpy = py * sign;

  // Slots: row-major, last rank centered if partial.
  const slots: Vec2[] = [];
  for (let r = 0; r < ranks; r++) {
    const remaining = N - r * frontCount;
    const count = Math.min(frontCount, remaining);
    for (let f = 0; f < count; f++) {
      const fileOff = (f - (count - 1) / 2) * spacingX;
      const depthOff = r * spacingY;
      slots.push({
        x: midX + fx * fileOff + dpx * depthOff,
        y: midY + fy * fileOff + dpy * depthOff,
      });
    }
  }

  // Bounding rectangle (covers full frontCount × ranks even if last rank short).
  const halfW = (frontCount - 1) * spacingX / 2 + spacingX / 2;
  const depth = (ranks - 1) * spacingY + spacingY;
  const tl = { x: midX - fx * halfW, y: midY - fy * halfW };
  const tr = { x: midX + fx * halfW, y: midY + fy * halfW };
  const br = { x: tr.x + dpx * depth, y: tr.y + dpy * depth };
  const bl = { x: tl.x + dpx * depth, y: tl.y + dpy * depth };

  return { slots, rect: { tl, tr, br, bl } };
}
```

- [ ] **Step 5: Run the test, expect PASS**

Run: `npx vitest run src/input/formation.test.ts`
Expected: PASS.

- [ ] **Step 6: Add front-rank arithmetic tests**

Append to `src/input/formation.test.ts`:

```ts
  it('drag length spans 2x spacingX with 9 units → frontCount=3, ranks=3', () => {
    const units = Array.from({ length: 9 }, (_, i) => ({
      id: i, x: 0, y: -10, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units,
      startW: { x: -1, y: 0 },
      endW: { x: 1, y: 0 }, // dragLen = 2 → frontCount = floor(2/1)+1 = 3
    });
    expect(r.slots.length).toBe(9);
    // Front rank = first 3 slots, x-coords centered on midDrag (0,0).
    expect(r.slots[0]!.x).toBeCloseTo(-1);
    expect(r.slots[1]!.x).toBeCloseTo(0);
    expect(r.slots[2]!.x).toBeCloseTo(1);
  });

  it('partial last rank is centered', () => {
    const units = Array.from({ length: 10 }, (_, i) => ({
      id: i, x: 0, y: -10, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units,
      startW: { x: -1, y: 0 },
      endW: { x: 1, y: 0 }, // frontCount = 3, ranks = ceil(10/3) = 4
    });
    expect(r.slots.length).toBe(10);
    // Slot 9 is the 10th (only one in rank 3) — centered on midDrag x.
    expect(r.slots[9]!.x).toBeCloseTo(0);
  });

  it('depth direction points away from unit centroid', () => {
    // Units below the drag line (y = -10). depthDir should point downward (-y) so
    // formation forms above the units... wait — units below → centroid below midDrag.
    // midDrag - centroid points UP (+y). perpA for forward=(1,0) is (0,1). dot > 0 → +y.
    // So formation extends in +y. Slots should have y >= 0.
    const units = Array.from({ length: 4 }, (_, i) => ({
      id: i, x: 0, y: -10, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units,
      startW: { x: -1, y: 0 },
      endW: { x: 1, y: 0 },
    });
    for (const s of r.slots) expect(s.y).toBeGreaterThanOrEqual(0);
  });

  it('mixed-kind spacing uses max', () => {
    const units = [
      { id: 0, x: 0, y: -10, spacingX: 1, spacingY: 1 },
      { id: 1, x: 0, y: -10, spacingX: 3, spacingY: 1 },
    ];
    const r = computeFormationSlots({
      units,
      startW: { x: -2, y: 0 },
      endW: { x: 2, y: 0 }, // dragLen=4, spacingX=3 → frontCount = floor(4/3)+1 = 2
    });
    expect(r.slots.length).toBe(2);
    expect(r.slots[1]!.x - r.slots[0]!.x).toBeCloseTo(3); // max spacingX
  });
```

- [ ] **Step 7: Run all formation tests**

Run: `npx vitest run src/input/formation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add src/input/formation.ts src/input/formation.test.ts
git commit -m "feat(input): computeFormationSlots — Total War-style rectangle geometry"
```

---

## Task 3: `assignFormationSlots` — greedy nearest

**Files:**
- Modify: `src/input/formation.ts`
- Modify: `src/input/formation.test.ts`

- [ ] **Step 1: Write a failing test**

Append to `src/input/formation.test.ts`:

```ts
import { assignFormationSlots } from './formation';

describe('assignFormationSlots', () => {
  it('linear units → linear slots produces monotonic mapping', () => {
    const units = [
      { id: 10, x: 0, y: 0, spacingX: 1, spacingY: 1 },
      { id: 11, x: 1, y: 0, spacingX: 1, spacingY: 1 },
      { id: 12, x: 2, y: 0, spacingX: 1, spacingY: 1 },
      { id: 13, x: 3, y: 0, spacingX: 1, spacingY: 1 },
    ];
    const slots = [
      { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 },
    ];
    const out = assignFormationSlots(units, slots);
    expect(out.length).toBe(4);
    // Each unit goes to the slot directly above it.
    expect(out[0]).toEqual({ x: 0, y: 5 });
    expect(out[1]).toEqual({ x: 1, y: 5 });
    expect(out[2]).toEqual({ x: 2, y: 5 });
    expect(out[3]).toEqual({ x: 3, y: 5 });
  });

  it('returns one slot per unit, all distinct', () => {
    const units = Array.from({ length: 5 }, (_, i) => ({
      id: i, x: i, y: i, spacingX: 1, spacingY: 1,
    }));
    const slots = Array.from({ length: 5 }, (_, i) => ({ x: i + 10, y: i + 10 }));
    const out = assignFormationSlots(units, slots);
    expect(out.length).toBe(5);
    const seen = new Set(out.map(s => `${s.x},${s.y}`));
    expect(seen.size).toBe(5);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/input/formation.test.ts`
Expected: FAIL with "assignFormationSlots is not a function" (or import error).

- [ ] **Step 3: Implement**

Append to `src/input/formation.ts`:

```ts
export function assignFormationSlots(units: FormationUnit[], slots: Vec2[]): Vec2[] {
  if (units.length !== slots.length) {
    throw new Error(`assignFormationSlots: length mismatch (${units.length} vs ${slots.length})`);
  }
  const N = units.length;
  const taken = new Uint8Array(N);
  const out: Vec2[] = new Array(N);

  // Pre-sort indices: units farthest from slot centroid pick first.
  let cx = 0, cy = 0;
  for (const s of slots) { cx += s.x; cy += s.y; }
  if (N > 0) { cx /= N; cy /= N; }
  const order = units.map((_, i) => i).sort((a, b) => {
    const da = (units[a]!.x - cx) ** 2 + (units[a]!.y - cy) ** 2;
    const db = (units[b]!.x - cx) ** 2 + (units[b]!.y - cy) ** 2;
    return db - da; // descending
  });

  for (const i of order) {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < N; j++) {
      if (taken[j]) continue;
      const dx = units[i]!.x - slots[j]!.x;
      const dy = units[i]!.y - slots[j]!.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = j; }
    }
    taken[best] = 1;
    out[i] = slots[best]!;
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/input/formation.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/input/formation.ts src/input/formation.test.ts
git commit -m "feat(input): assignFormationSlots — greedy nearest with far-first tiebreak"
```

---

## Task 4: `issueFormationMove` order dispatcher

**Files:**
- Modify: `src/input/commands.ts`
- Create: `src/input/commands.test.ts`

- [ ] **Step 1: Write a failing test**

Create `src/input/commands.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createSelection } from './selection';
import { issueFormationMove } from './commands';

function spawn(world: ReturnType<typeof createWorld>, kind: string, team: number, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex(kind);
  world.entities.team[id] = team;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

describe('issueFormationMove', () => {
  it('issues one move order per assignment, replacing existing queue', () => {
    const world = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const sel = createSelection();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    const b = spawn(world, 'line-infantry', 0, 1, 0);
    sel.ids.add(a); sel.ids.add(b);
    // Pre-existing queue should be replaced.
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
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    sel.ids.add(a);
    world.orderQueue.set(a, [{ kind: 'move', targetX: 1, targetY: 1 }]);

    issueFormationMove(world, [{ id: a, target: { x: 5, y: 5 } }], { queue: true });

    const qa = world.orderQueue.get(a)!;
    expect(qa.length).toBe(2);
    expect(qa[1]).toEqual({ kind: 'move', targetX: 5, targetY: 5 });
  });

  it('skips dead units silently', () => {
    const world = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    world.entities.alive[a] = 0;
    issueFormationMove(world, [{ id: a, target: { x: 5, y: 5 } }]);
    expect(world.orderQueue.get(a)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/input/commands.test.ts`
Expected: FAIL with "issueFormationMove is not a function" or import error.

- [ ] **Step 3: Implement**

Append to `src/input/commands.ts`:

```ts
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
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/input/commands.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full input test suite**

Run: `npx vitest run src/input/`
Expected: PASS (all existing + new tests).

- [ ] **Step 6: Commit**

```bash
git add src/input/commands.ts src/input/commands.test.ts
git commit -m "feat(input): issueFormationMove dispatcher"
```

---

## Task 5: Controller — right-mouse drag flow + preview accessor

**Files:**
- Modify: `src/input/selection-controller.ts`

- [ ] **Step 1: Add deps + state, expose accessor (compile only — wired in step 2)**

Edit `src/input/selection-controller.ts`. Add imports near top:

```ts
import { computeFormationSlots, assignFormationSlots, type FormationUnit } from './formation';
import { issueMove, issueAttack, issueAttackMove, issueStop, issueFormationMove } from './commands';
import type { FormationDrag, FormationPreview } from './selection';
import { getUnitKindByIndex } from '../data/units';
```

(Note: `issueMove`/`issueAttack`/`issueAttackMove`/`issueStop` are already imported — just add `issueFormationMove`. `getUnitKindByIndex` may already be imported — keep one copy.)

Add to `SelectionControllerDeps`:

```ts
export interface SelectionControllerDeps {
  canvas: HTMLCanvasElement;
  overlayRoot: HTMLElement;
  camera: Camera;
  world: World;
  selection: Selection;
  drag: DragRect;
  formationDrag: FormationDrag;
  particles?: Particles;
}
```

Add to `SelectionController` interface:

```ts
export interface SelectionController {
  readonly cursorMode: CursorMode;
  update(dt: number): void;
  destroy(): void;
  /** Live preview of the formation being drawn, or null when no drag is active. */
  formationPreview(): FormationPreview | null;
  readonly _internals: ControllerInternals;
}
```

(`FormationPreview` is imported from `./selection` above. `Vec2` is not needed in this file unless already present.)

- [ ] **Step 2: Add right-mouse drag state + handlers**

Modify the existing destructuring inside `createSelectionController` to include `formationDrag`:

```ts
// Before:
const { canvas, overlayRoot, camera, world, selection, drag } = deps;
// After:
const { canvas, overlayRoot, camera, world, selection, drag, formationDrag } = deps;
```

Add a sibling state variable next to `pendingClickStart`:

```ts
let pendingFormationStart: { x: number; y: number } | null = null;
```

Replace the existing `onMouseDown` with:

```ts
function onMouseDown(e: { button: number; clientX: number; clientY: number; target: EventTarget | null }): void {
  if (isOnHud(e.target)) return;
  if (e.button === 0) {
    pendingClickStart = { x: e.clientX, y: e.clientY };
    drag.start = { x: e.clientX, y: e.clientY };
    drag.current = { x: e.clientX, y: e.clientY };
    drag.active = false;
    return;
  }
  if (e.button === 2) {
    pendingFormationStart = { x: e.clientX, y: e.clientY };
    formationDrag.start = { x: e.clientX, y: e.clientY };
    formationDrag.current = { x: e.clientX, y: e.clientY };
    formationDrag.active = false;
  }
}
```

Replace the existing `onMouseMove` with:

```ts
function onMouseMove(e: { clientX: number; clientY: number }): void {
  if (pendingClickStart) {
    drag.current = { x: e.clientX, y: e.clientY };
    const dx = e.clientX - pendingClickStart.x;
    const dy = e.clientY - pendingClickStart.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.active = true;
  }
  if (pendingFormationStart) {
    formationDrag.current = { x: e.clientX, y: e.clientY };
    const dx = e.clientX - pendingFormationStart.x;
    const dy = e.clientY - pendingFormationStart.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) formationDrag.active = true;
  }
}
```

- [ ] **Step 3: Modify right-button mouseup branch**

Replace the existing `if (e.button === 2) { ... }` block at the end of `onMouseUp` with:

```ts
  if (e.button === 2) {
    if (cursorMode === 'attack-move') {
      cursorMode = 'normal';
      pendingFormationStart = null;
      formationDrag.active = false;
      return;
    }
    const opts = { queue: e.shiftKey };

    if (formationDrag.active && pendingFormationStart) {
      // Formation drag → per-unit moves to slot positions.
      const startW = screenToWorld(camera, formationDrag.start);
      const endW = screenToWorld(camera, formationDrag.current);
      const units = liveFormationUnits();
      if (units.length > 0) {
        const { slots } = computeFormationSlots({ units, startW, endW });
        const targets = assignFormationSlots(units, slots);
        const assignments = units.map((u, i) => ({ id: u.id, target: targets[i]! }));
        issueFormationMove(world, assignments, opts);
        // Single puff at the front-rank midpoint as visual feedback.
        const mx = (startW.x + endW.x) / 2;
        const my = (startW.y + endW.y) / 2;
        puff(mx, my);
      }
      pendingFormationStart = null;
      formationDrag.active = false;
      return;
    }

    pendingFormationStart = null;
    formationDrag.active = false;

    // Bare right-click: existing single-point flow.
    const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const hit = hitTestPoint(world, w);
    if (hit !== -1 && world.entities.team[hit] !== PLAYER_TEAM) {
      issueAttack(world, selection, hit, opts);
      puff(w.x, w.y);
    } else {
      issueMove(world, selection, w, opts);
      puff(w.x, w.y);
    }
    return;
  }
```

Add the `liveFormationUnits` helper above `onMouseDown`:

```ts
function liveFormationUnits(): FormationUnit[] {
  const out: FormationUnit[] = [];
  const e = world.entities;
  for (const id of selection.ids) {
    if (e.alive[id] !== 1) continue;
    const kind = getUnitKindByIndex(e.kindId[id]!);
    out.push({
      id,
      x: e.posX[id]!,
      y: e.posY[id]!,
      spacingX: kind.baseStats.formationSpacing.x,
      spacingY: kind.baseStats.formationSpacing.y,
    });
  }
  return out;
}
```

- [ ] **Step 4: Wire Esc + blur cancellation**

In `onKeyDown`, the `Escape` branch already clears selection. Add a formation cancel before the existing logic:

```ts
if (e.key === 'Escape') {
  if (formationDrag.active) {
    pendingFormationStart = null;
    formationDrag.active = false;
    return;
  }
  if (cursorMode !== 'normal') {
    cursorMode = 'normal';
    return;
  }
  selection.ids.clear();
  return;
}
```

In `onBlur`, add formation cleanup:

```ts
function onBlur(): void {
  pendingClickStart = null;
  drag.active = false;
  pendingFormationStart = null;
  formationDrag.active = false;
  cursorMode = 'normal';
}
```

- [ ] **Step 5: Implement `formationPreview()`**

Add at the bottom of `createSelectionController`, just before the return statement:

```ts
function formationPreview(): FormationPreview | null {
  if (!formationDrag.active) return null;
  if (cursorMode !== 'normal') return null;
  const units = liveFormationUnits();
  if (units.length === 0) return null;
  const startW = screenToWorld(camera, formationDrag.start);
  const endW = screenToWorld(camera, formationDrag.current);
  const { slots, rect } = computeFormationSlots({ units, startW, endW });
  return { rect, slots };
}
```

Add `formationPreview` to the returned object:

```ts
return {
  get cursorMode() { return cursorMode; },
  formationPreview,
  update(_dt) { /* unchanged */ },
  destroy() { /* unchanged */ },
  _internals: { onMouseDown, onMouseMove, onMouseUp, onKeyDown, onBlur, getCursorMode: () => cursorMode },
};
```

- [ ] **Step 6: Update existing test setup to pass `formationDrag`**

Edit `src/input/selection-controller.test.ts`. Replace:

```ts
import { createSelection, createDragRect } from './selection';
```

with:

```ts
import { createSelection, createDragRect, createFormationDrag } from './selection';
```

In `makeDeps()`, add the formationDrag:

```ts
function makeDeps() {
  const camera = createCamera();
  camera.viewport = { w: 800, h: 600 };
  camera.center = { x: 0, y: 0 };
  camera.zoom = 1;
  const world = createWorld({ seed: 1, capacity: 32, mapSize: 1000 });
  const selection = createSelection();
  const drag = createDragRect();
  const formationDrag = createFormationDrag();
  const overlayRoot = { contains: (_n: Node) => false } as unknown as HTMLElement;
  const canvas = {} as unknown as HTMLCanvasElement;
  const ctrl = createSelectionController({ canvas, overlayRoot, camera, world, selection, drag, formationDrag });
  return { ctrl, world, selection, drag, formationDrag, camera };
}
```

- [ ] **Step 7: Run existing controller tests, expect PASS**

Run: `npx vitest run src/input/selection-controller.test.ts`
Expected: PASS — all existing tests still green.

- [ ] **Step 8: Add right-mouse drag tests**

Append to `src/input/selection-controller.test.ts` (inside the file, after the existing `describe` blocks):

```ts
describe('selection-controller — formation drag (RMB)', () => {
  it('RMB drag past threshold issues per-unit move orders to slot positions', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, -10);
    const b = spawn(world, 'line-infantry', 0, 1, -10);
    selection.ids.add(a); selection.ids.add(b);
    // Drag from screen (380,300) to (420,300) — world (-20,0)→(20,0).
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    ctrl._internals.onMouseUp({ button: 2, clientX: 420, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    const qa = world.orderQueue.get(a)!;
    const qb = world.orderQueue.get(b)!;
    expect(qa[0]?.kind).toBe('move');
    expect(qb[0]?.kind).toBe('move');
    // Slots are above the units (y >= 0); units were at y=-10.
    expect((qa[0] as { kind: 'move'; targetY: number }).targetY).toBeGreaterThanOrEqual(0);
    expect((qb[0] as { kind: 'move'; targetY: number }).targetY).toBeGreaterThanOrEqual(0);
  });

  it('RMB click below threshold uses single-point move (existing behavior)', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, 0);
    selection.ids.add(a);
    ctrl._internals.onMouseDown({ button: 2, clientX: 500, clientY: 300, target: null });
    ctrl._internals.onMouseUp({ button: 2, clientX: 501, clientY: 301, shiftKey: false, ctrlKey: false, metaKey: false });
    const qa = world.orderQueue.get(a)!;
    expect(qa.length).toBe(1);
    expect(qa[0]?.kind).toBe('move');
  });

  it('Shift + RMB drag queues formation orders', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, -10);
    selection.ids.add(a);
    world.orderQueue.set(a, [{ kind: 'move', targetX: 99, targetY: 99 }]);
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    ctrl._internals.onMouseUp({ button: 2, clientX: 420, clientY: 300, shiftKey: true, ctrlKey: false, metaKey: false });
    const qa = world.orderQueue.get(a)!;
    expect(qa.length).toBe(2);
    expect(qa[0]).toEqual({ kind: 'move', targetX: 99, targetY: 99 });
  });

  it('Esc cancels in-progress formation drag', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, -10);
    selection.ids.add(a);
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    ctrl._internals.onKeyDown({ key: 'Escape', code: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(ctrl.formationPreview()).toBeNull();
    ctrl._internals.onMouseUp({ button: 2, clientX: 420, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    // After Esc the drag is reset; mouseup falls back to single-point at (420,300) → world (20,0).
    // The unit gets a move order to (20,0)-ish, NOT to a formation slot.
    const qa = world.orderQueue.get(a)!;
    expect(qa.length).toBe(1);
    expect((qa[0] as { kind: 'move'; targetX: number; targetY: number }).targetY).toBeCloseTo(0);
  });

  it('formationPreview() is null when not dragging', () => {
    const { ctrl } = makeDeps();
    expect(ctrl.formationPreview()).toBeNull();
  });

  it('formationPreview() returns rect + slots during active drag', () => {
    const { ctrl, world, selection } = makeDeps();
    const a = spawn(world, 'line-infantry', 0, 0, -10);
    selection.ids.add(a);
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    const p = ctrl.formationPreview();
    expect(p).not.toBeNull();
    expect(p!.slots.length).toBe(1);
    expect(p!.rect.tl).toBeDefined();
  });

  it('empty selection + RMB drag does nothing', () => {
    const { ctrl, world } = makeDeps();
    ctrl._internals.onMouseDown({ button: 2, clientX: 380, clientY: 300, target: null });
    ctrl._internals.onMouseMove({ clientX: 420, clientY: 300 });
    ctrl._internals.onMouseUp({ button: 2, clientX: 420, clientY: 300, shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.size).toBe(0);
  });
});
```

- [ ] **Step 9: Run controller tests, expect PASS**

Run: `npx vitest run src/input/selection-controller.test.ts`
Expected: PASS (all old + 7 new tests).

- [ ] **Step 10: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/input/selection-controller.ts src/input/selection-controller.test.ts
git commit -m "feat(input): right-mouse formation drag + formationPreview() accessor"
```

---

## Task 6: Add `u_color` to drag-rect shader + new pip shader

**Files:**
- Modify: `src/render/shaders/selection.glsl.ts`

- [ ] **Step 1: Add `u_color` to `DRAG_FS`**

Edit `src/render/shaders/selection.glsl.ts`. Replace the existing `DRAG_FS` with:

```ts
export const DRAG_FS = `#version 300 es
precision highp float;
uniform float u_time;
uniform vec3 u_color;
out vec4 outColor;
void main() {
  float p = gl_FragCoord.x + gl_FragCoord.y;
  float phase = mod(p - u_time * 24.0, 8.0);
  if (phase >= 4.0) discard;
  outColor = vec4(u_color, 1.0);
}
`;
```

- [ ] **Step 2: Add pip shaders**

Append to `src/render/shaders/selection.glsl.ts`:

```ts
// Per-slot formation pip — small hollow square, instanced.
// a_corner is a quad corner in [-0.5, 0.5]; a_pos is the slot center in world space.
// a_size is the world-space half-extent (filled by the JS side).
export const PIP_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
out vec2 v_local;
uniform mat3 u_viewProj;
uniform float u_size;
void main() {
  vec2 wp = a_pos + a_corner * u_size;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0; // -1..1
}
`;

// Hollow square outline using fwidth for screen-stable 1px edges across zoom.
export const PIP_FS = `#version 300 es
precision highp float;
in vec2 v_local;
out vec4 outColor;
uniform vec3 u_color;
void main() {
  vec2 d = abs(v_local);
  float edge = max(d.x, d.y);
  float w = fwidth(edge);
  // Outline near edge=1.0, fading over fwidth.
  float a = smoothstep(1.0 - w * 1.5, 1.0 - w * 0.5, edge) - smoothstep(1.0 - w * 0.5, 1.0 + w * 0.5, edge);
  if (a <= 0.0) discard;
  outColor = vec4(u_color, a);
}
`;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/render/shaders/selection.glsl.ts
git commit -m "feat(render): add u_color to drag-rect FS + new pip shaders"
```

---

## Task 7: Selection pass — accept formation preview, draw outline + pips

**Files:**
- Modify: `src/render/passes/selection-pass.ts`

- [ ] **Step 1: Update interface and imports**

Edit the top of `src/render/passes/selection-pass.ts`:

```ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { SELECTION_VS, SELECTION_FS, WAYPOINT_VS, WAYPOINT_FS, DRAG_VS, DRAG_FS, PIP_VS, PIP_FS } from '../shaders/selection.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import type { Selection, DragRect, FormationPreview } from '../../input/selection';
import { getUnitKindByIndex } from '../../data/units';
import { screenToWorld } from '../camera';
import { PLAYER_TEAM } from '../../sim/player';
```

Update the `SelectionPass` interface:

```ts
export interface SelectionPass {
  drawDiscs(world: World, cam: Camera, sel: Selection): void;
  draw(world: World, cam: Camera, sel: Selection, drag: DragRect, formation: FormationPreview | null): void;
}
```

- [ ] **Step 2: Update `dragU` uniforms list and add pip program**

Replace the existing dragU/dragVao block with:

```ts
// Drag rectangle: dedicated program + VAO; marching-ants animated 1px lines.
const dragProg = linkProgram(gl, DRAG_VS, DRAG_FS);
const dragU = getUniforms(gl, dragProg, ['u_viewProj', 'u_time', 'u_color'] as const);
const dragVao = createVertexArray(gl);
gl.bindVertexArray(dragVao);
const dragBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
gl.bufferData(gl.ARRAY_BUFFER, 8 * 2 * 4, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

// Formation pips: instanced 6-vert quad, one instance per slot.
const pipProg = linkProgram(gl, PIP_VS, PIP_FS);
const pipU = getUniforms(gl, pipProg, ['u_viewProj', 'u_size', 'u_color'] as const);
const pipVao = createVertexArray(gl);
gl.bindVertexArray(pipVao);
const pipCornersBuf = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([
  -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
  -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const pipPosBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
gl.bindVertexArray(null);
const pipScratch = new Float32Array(capacity * 2);
void pipCornersBuf;
```

- [ ] **Step 3: Update `draw` signature and drag-rect uniform**

Change `draw(world, cam, sel, drag) {` to `draw(world, cam, sel, drag, formation) {`.

Replace the existing drag-rect overlay block with:

```ts
// Drag-rect overlay: 1px marching-ants in world space.
if (drag.active) {
  const a = screenToWorld(cam, drag.start);
  const b = screenToWorld(cam, drag.current);
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const verts = new Float32Array([
    x0, y0,  x1, y0,
    x1, y0,  x1, y1,
    x1, y1,  x0, y1,
    x0, y1,  x0, y0,
  ]);
  gl.useProgram(dragProg);
  gl.bindVertexArray(dragVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
  gl.uniformMatrix3fv(dragU.u_viewProj, false, viewProjection(cam));
  gl.uniform1f(dragU.u_time, performance.now() * 0.001);
  gl.uniform3f(dragU.u_color, 1.0, 1.0, 1.0); // white — selection drag
  gl.drawArrays(gl.LINES, 0, 8);
  gl.bindVertexArray(null);
}
```

Add the formation overlay block immediately after the drag-rect block (still inside `draw`):

```ts
// Formation preview: marching-ants outline + per-slot pips.
if (formation) {
  const { rect, slots } = formation;
  const verts = new Float32Array([
    rect.tl.x, rect.tl.y,  rect.tr.x, rect.tr.y,
    rect.tr.x, rect.tr.y,  rect.br.x, rect.br.y,
    rect.br.x, rect.br.y,  rect.bl.x, rect.bl.y,
    rect.bl.x, rect.bl.y,  rect.tl.x, rect.tl.y,
  ]);
  gl.useProgram(dragProg);
  gl.bindVertexArray(dragVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
  gl.uniformMatrix3fv(dragU.u_viewProj, false, viewProjection(cam));
  gl.uniform1f(dragU.u_time, performance.now() * 0.001);
  gl.uniform3f(dragU.u_color, 0.55, 1.0, 0.6); // green — formation
  gl.drawArrays(gl.LINES, 0, 8);
  gl.bindVertexArray(null);

  // Pips
  const m = Math.min(slots.length, capacity);
  if (m > 0) {
    for (let i = 0; i < m; i++) {
      pipScratch[i * 2 + 0] = slots[i]!.x;
      pipScratch[i * 2 + 1] = slots[i]!.y;
    }
    gl.useProgram(pipProg);
    gl.bindVertexArray(pipVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pipPosBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pipScratch.subarray(0, m * 2));
    gl.uniformMatrix3fv(pipU.u_viewProj, false, viewProjection(cam));
    gl.uniform1f(pipU.u_size, 1.2); // world units; ~1m square pip
    gl.uniform3f(pipU.u_color, 0.55, 1.0, 0.6);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, m);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/passes/selection-pass.ts
git commit -m "feat(render): selection pass — formation outline + per-slot pips"
```

---

## Task 8: Renderer + main wiring

**Files:**
- Modify: `src/render/renderer.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Update renderer interface + impl**

Edit `src/render/renderer.ts`. Replace the file with:

```ts
import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import { createSelectionPass } from './passes/selection-pass';
import { createParticlePass } from './passes/particle-pass';
import type { World } from '../sim/world';
import type { Selection, DragRect, FormationPreview } from '../input/selection';
import type { Particles } from '../particles/particles';

export interface Renderer {
  render(
    world: World,
    particles: Particles,
    cam: Camera,
    sel: Selection,
    drag: DragRect,
    formation: FormationPreview | null,
  ): void;
  resize(): void;
}

export function createRenderer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  capacity: number,
  particleCapacity: number,
): Renderer {
  const terrain = createTerrainPass(gl);
  const sprites = createSpritePass(gl, capacity);
  const selectionPass = createSelectionPass(gl, capacity);
  const particles = createParticlePass(gl, particleCapacity);

  return {
    resize() {
      resizeToDisplay(gl, canvas);
    },
    render(world, particlePool, cam, sel, drag, formation) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
      sprites.draw(world, cam);
      particles.draw(particlePool, cam);
      selectionPass.draw(world, cam, sel, drag, formation);
    },
  };
}
```

(Note: this assumes the current renderer doesn't call `selectionPass.drawDiscs`. If after a recent change it does, preserve that call — the formation argument only affects `draw`.)

- [ ] **Step 2: Wire in `main.ts`**

Edit `src/main.ts`:

Find the import line for selection types and replace with:

```ts
import { createSelection, createDragRect, createFormationDrag } from './input/selection';
```

Find the line `const drag = createDragRect();` (or wherever `drag` is constructed). Add immediately after:

```ts
const formationDrag = createFormationDrag();
```

Find the controller construction:

```ts
const controller = createSelectionController({
  canvas, overlayRoot: overlay, camera, world, selection, drag,
  particles,
});
```

Change to:

```ts
const controller = createSelectionController({
  canvas, overlayRoot: overlay, camera, world, selection, drag, formationDrag,
  particles,
});
```

Find the render call:

```ts
renderer.render(world, particles, camera, selection, drag);
```

Change to:

```ts
renderer.render(world, particles, camera, selection, drag, controller.formationPreview());
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/renderer.ts src/main.ts
git commit -m "feat: thread formation preview through renderer + main"
```

---

## Task 9: Manual smoke test

**Files:** none

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Open the printed URL in a browser.

- [ ] **Step 2: Verify the existing selection drag still works**

LMB drag over a few of your own units. White marching-ants box appears. On release, the units are selected.

- [ ] **Step 3: Verify bare right-click still issues a single-point move**

With units selected, right-click (no drag) on empty terrain. Units move to that point with the existing puff.

- [ ] **Step 4: Verify the formation drag**

With several own-team units selected (5+), right-click and **drag** along a line.
- A green marching-ants outline rectangle appears.
- Small green hollow squares appear at each slot inside the rectangle.
- The rectangle is on the far side of the units from the cursor — i.e., units don't have to walk through the rectangle to reach it.
- On release, units begin moving toward their assigned slots.

- [ ] **Step 5: Verify shift queues**

With units already moving from a formation drag, shift+right-drag elsewhere. The new formation appends to the queue (waypoint polylines visible).

- [ ] **Step 6: Verify Esc cancellation**

Start a right-drag, press Esc before releasing the button. The green preview disappears. Releasing the button does not issue any order beyond a fall-through single-point move at the current position. (This is acceptable — Esc resets the drag state; the eventual mouseup falls into the bare-right-click branch.)

- [ ] **Step 7: Verify edge cases**

- 1 unit selected, right-drag → single slot at drag midpoint.
- 0 units selected, right-drag → no preview, no orders.
- Long drag (100+ world units) with 4 units → wide single rank.
- Mixed-kind selection (line infantry + cuirassier) → spacing matches the looser kind.

- [ ] **Step 8: No commit needed for smoke test**

If issues are found, fix in a follow-up commit. If all pass, you're done.

---

## Notes for the executing engineer

- **Vec2 import path** is `../util/math` (already used by `commands.ts`).
- **Set iteration order** is insertion order in JS, so `selection.ids` iterated in the controller and in `liveFormationUnits()` produces the same order each call.
- **WebGL state**: each draw block above leaves blending disabled at exit (matching existing code style). Pip drawing enables alpha blending and disables again.
- **No new external deps** — pure TS + existing GL helpers.
- **Order types**: `Order` and `OrderOpts` are already in scope inside `commands.ts`; the new `issueFormationMove` reuses both without exporting anything new there.
