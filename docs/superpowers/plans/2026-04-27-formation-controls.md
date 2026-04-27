# Formation Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a formation-controls panel (lower-left, right of minimap) and four hotkeys that let the player adjust inter-unit spacing (`[` / `]`) and rank count (`,` / `.`) for the current selection. Pressing a hotkey re-forms the selection in place. The same params bias the next right-click-drag formation.

**Architecture:** New input-layer state `FormationParams` lives on the selection-controller. Pure geometry in `formation.ts` is extended with optional `spacingMult` and `ranksOverride` that flow into the existing slot-computation. A new `syntheticFormationDrag` builds drag endpoints for re-form-in-place. UI is a thin `formation-controls-panel` reading the params each frame.

**Tech Stack:** TypeScript, Vitest, vanilla DOM (no GL).

**Spec:** `docs/superpowers/specs/2026-04-27-formation-controls-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/input/formation-params.ts` | Create | `FormationParams` type, factory, bumpers, multiplier helper, `SPACING_STEPS`. |
| `src/input/formation-params.test.ts` | Create | Unit tests for bumpers + reset. |
| `src/input/formation.ts` | Modify | Add `spacingMult`/`ranksOverride` to `FormationInput`; add `syntheticFormationDrag`; lift `liveFormationUnits` helper. |
| `src/input/formation.test.ts` | Modify | Tests for spacing multiplier, ranks override, synthetic drag. |
| `src/input/commands.ts` | Modify | Add `issueReformInPlace`. |
| `src/input/selection-controller.ts` | Modify | Own `formationParams`; hotkey handlers; selection-change reset; pass params into drag commit + preview; expose getter. |
| `src/input/selection-controller.test.ts` | Modify | Hotkey tests, reset-on-selection-change test. |
| `src/ui/formation-controls-panel.ts` | Create | Panel module mirroring `control-groups-panel.ts`. |
| `src/ui/styles.css` | Modify | `.formation-controls` styles. |
| `src/main.ts` | Modify | Instantiate panel, call `update` in frame loop. |

---

## Task 1: `FormationParams` module

**Files:**
- Create: `src/input/formation-params.ts`
- Create: `src/input/formation-params.test.ts`

- [ ] **Step 1: Implement the module**

Create `src/input/formation-params.ts`:

```ts
export interface SpacingStep {
  readonly mult: number;
  readonly label: string;
}

export const SPACING_STEPS: readonly SpacingStep[] = [
  { mult: 0.5, label: 'Tight' },
  { mult: 1.0, label: 'Close' },
  { mult: 2.0, label: 'Open' },
  { mult: 4.0, label: 'Loose' },
  { mult: 8.0, label: 'Skirmish' },
] as const;

export const DEFAULT_SPACING_INDEX = 1;
export const MIN_RANKS = 1;
export const MAX_RANKS = 16;

export type RankOverride = number | null;

export interface FormationParams {
  spacingIndex: number;
  ranks: RankOverride;
}

export function createFormationParams(): FormationParams {
  return { spacingIndex: DEFAULT_SPACING_INDEX, ranks: null };
}

export function resetFormationParams(p: FormationParams): void {
  p.spacingIndex = DEFAULT_SPACING_INDEX;
  p.ranks = null;
}

export function bumpSpacing(p: FormationParams, dir: 1 | -1): void {
  const next = p.spacingIndex + dir;
  if (next < 0 || next >= SPACING_STEPS.length) return; // clamp at ends
  p.spacingIndex = next;
}

/**
 * Cycle: `null → MIN_RANKS → … → MAX_RANKS → null` for dir=+1; reverse for dir=-1.
 */
export function bumpRanks(p: FormationParams, dir: 1 | -1): void {
  if (p.ranks == null) {
    p.ranks = dir === 1 ? MIN_RANKS : MAX_RANKS;
    return;
  }
  const next = p.ranks + dir;
  if (next < MIN_RANKS || next > MAX_RANKS) {
    p.ranks = null;
    return;
  }
  p.ranks = next;
}

export function spacingMultiplier(p: FormationParams): number {
  return SPACING_STEPS[p.spacingIndex]!.mult;
}

export function spacingLabel(p: FormationParams): string {
  return SPACING_STEPS[p.spacingIndex]!.label;
}
```

- [ ] **Step 2: Tests**

Create `src/input/formation-params.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  createFormationParams, resetFormationParams,
  bumpSpacing, bumpRanks, spacingMultiplier,
  SPACING_STEPS, DEFAULT_SPACING_INDEX, MIN_RANKS, MAX_RANKS,
} from './formation-params';

describe('formation-params', () => {
  it('starts at default Close spacing and auto ranks', () => {
    const p = createFormationParams();
    expect(p.spacingIndex).toBe(DEFAULT_SPACING_INDEX);
    expect(p.ranks).toBe(null);
    expect(spacingMultiplier(p)).toBe(1);
  });

  it('bumpSpacing clamps at both ends', () => {
    const p = createFormationParams();
    p.spacingIndex = 0;
    bumpSpacing(p, -1);
    expect(p.spacingIndex).toBe(0);
    p.spacingIndex = SPACING_STEPS.length - 1;
    bumpSpacing(p, +1);
    expect(p.spacingIndex).toBe(SPACING_STEPS.length - 1);
  });

  it('bumpRanks cycles through null → 1 … 16 → null on +1', () => {
    const p = createFormationParams();
    bumpRanks(p, +1); expect(p.ranks).toBe(MIN_RANKS);
    p.ranks = MAX_RANKS;
    bumpRanks(p, +1); expect(p.ranks).toBe(null);
  });

  it('bumpRanks cycles in reverse on -1', () => {
    const p = createFormationParams();
    bumpRanks(p, -1); expect(p.ranks).toBe(MAX_RANKS);
    p.ranks = MIN_RANKS;
    bumpRanks(p, -1); expect(p.ranks).toBe(null);
  });

  it('resetFormationParams returns to defaults', () => {
    const p = createFormationParams();
    p.spacingIndex = 4;
    p.ranks = 3;
    resetFormationParams(p);
    expect(p.spacingIndex).toBe(DEFAULT_SPACING_INDEX);
    expect(p.ranks).toBe(null);
  });
});
```

- [ ] **Step 3: Verify**
Run `npx vitest run src/input/formation-params.test.ts` — all pass.

---

## Task 2: Extend `formation.ts` with multiplier, ranks override, and synthetic drag

**Files:**
- Modify: `src/input/formation.ts`
- Modify: `src/input/formation.test.ts`

- [ ] **Step 1: Extend `FormationInput`**

In `src/input/formation.ts`, modify the interface:

```ts
export interface FormationInput {
  units: FormationUnit[];
  startW: Vec2;
  endW: Vec2;
  /** Multiplier on each unit's per-axis spacing. Default 1. */
  spacingMult?: number;
  /** When non-null, fix rank count and derive frontage from N/ranks instead of dragLen. Default null. */
  ranksOverride?: number | null;
}
```

- [ ] **Step 2: Apply multiplier and ranks override inside `computeFormationSlots`**

After the existing per-unit max spacing computation, multiply by `spacingMult ?? 1`:

```ts
const mult = input.spacingMult ?? 1;
spacingX *= mult;
spacingY *= mult;
```

Replace the `frontCount` / `ranks` calc with:

```ts
let frontCount: number;
let ranks: number;
if (input.ranksOverride != null && N > 0) {
  ranks = Math.min(Math.max(1, input.ranksOverride), N);
  frontCount = Math.ceil(N / ranks);
} else {
  frontCount = Math.max(1, Math.min(N, Math.floor(dragLen / spacingX) + 1));
  ranks = Math.ceil(N / frontCount);
}
```

The rest of `computeFormationSlots` is unchanged.

- [ ] **Step 3: Add `syntheticFormationDrag`**

Append to `src/input/formation.ts`:

```ts
/**
 * Build a synthetic (startW, endW) for re-forming a selection in place at its
 * current centroid, facing `forwardW`, with frontage chosen so all N units
 * fit in `ranks` ranks at `spacingX * spacingMult`.
 *
 * `computeFormationSlots` interprets drag direction as the front-rank axis;
 * the perpendicular is depth. So the synthetic drag lies along perp(forwardW).
 */
export function syntheticFormationDrag(
  units: FormationUnit[],
  forwardW: Vec2,
  ranks: number,
  spacingMult: number,
): { startW: Vec2; endW: Vec2 } {
  const N = units.length;
  if (N === 0) return { startW: { x: 0, y: 0 }, endW: { x: 0, y: 0 } };

  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= N; cy /= N;

  let spacingX = 0;
  for (const u of units) if (u.spacingX > spacingX) spacingX = u.spacingX;
  if (spacingX <= 0) spacingX = 1;
  spacingX *= spacingMult;

  const r = Math.max(1, Math.min(ranks, N));
  const frontCount = Math.ceil(N / r);
  const halfFront = ((frontCount - 1) * spacingX) / 2;

  const dx = -forwardW.y;
  const dy = forwardW.x;

  // When frontCount == 1, halfFront == 0 → both endpoints collapse to the
  // centroid, and computeFormationSlots' dragLen<eps fallback would lose our
  // facing. Emit a tiny offset along dragDir to preserve `forward`.
  const eps = 1e-3;
  const off = halfFront < eps ? eps : halfFront;

  return {
    startW: { x: cx - dx * off, y: cy - dy * off },
    endW:   { x: cx + dx * off, y: cy + dy * off },
  };
}
```

- [ ] **Step 4: Lift `liveFormationUnits` helper**

Append a thin export:

```ts
import type { World } from '../sim/world';

/**
 * Materialize the alive selection into FormationUnit records, pulling per-kind
 * spacing from `data/units`. Pure read of world state.
 */
export function liveFormationUnits(world: World, ids: Iterable<number>): FormationUnit[] {
  // Lazy import to avoid a circular dep — getUnitKindByIndex lives in data/.
  // (Direct import at top is fine; circular only if data imports formation, which it doesn't.)
  return _materialize(world, ids);
}
```

Direct, no lazy import needed:

```ts
import type { World } from '../sim/world';
import { getUnitKindByIndex } from '../data/units';
import { isDead } from '../sim/entities';

export function liveFormationUnits(world: World, ids: Iterable<number>): FormationUnit[] {
  const out: FormationUnit[] = [];
  const e = world.entities;
  for (const id of ids) {
    if (e.alive[id] !== 1) continue;
    if (isDead(e, id)) continue;
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

(Use the second form. Discard the first sketch.)

- [ ] **Step 5: Update tests**

Append to `src/input/formation.test.ts`:

```ts
import { syntheticFormationDrag } from './formation';

describe('computeFormationSlots — spacingMult', () => {
  it('doubles slot spacing when spacingMult=2', () => {
    const units = Array.from({ length: 4 }, (_, i) => ({
      id: i, x: 0, y: 0, spacingX: 1, spacingY: 1,
    }));
    const a = computeFormationSlots({
      units, startW: { x: 0, y: 0 }, endW: { x: 4, y: 0 },
    });
    const b = computeFormationSlots({
      units, startW: { x: 0, y: 0 }, endW: { x: 4, y: 0 }, spacingMult: 2,
    });
    // Distance between adjacent slots in front rank doubles.
    const da = Math.hypot(a.slots[1]!.x - a.slots[0]!.x, a.slots[1]!.y - a.slots[0]!.y);
    const db = Math.hypot(b.slots[1]!.x - b.slots[0]!.x, b.slots[1]!.y - b.slots[0]!.y);
    expect(db).toBeCloseTo(da * 2);
  });
});

describe('computeFormationSlots — ranksOverride', () => {
  it('forces N=20, ranks=4 → frontCount=5', () => {
    const units = Array.from({ length: 20 }, (_, i) => ({
      id: i, x: 0, y: 0, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units, startW: { x: 0, y: 0 }, endW: { x: 0.5, y: 0 }, ranksOverride: 4,
    });
    expect(r.slots).toHaveLength(20);
    // First rank: 5 slots, all at depth 0; check depth groups.
    const fwd = r.forward;
    const px = -fwd.y, py = fwd.x;
    // Project each slot onto perp axis to get depth, group by depth bucket.
    const depths = new Set(r.slots.map(s => Math.round((s.x * px + s.y * py) * 1000) / 1000));
    expect(depths.size).toBe(4);
  });

  it('ranksOverride=1 yields a single line (depth=0 for all)', () => {
    const units = Array.from({ length: 6 }, (_, i) => ({
      id: i, x: 0, y: 0, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units, startW: { x: 0, y: 0 }, endW: { x: 1, y: 0 }, ranksOverride: 1,
    });
    const fwd = r.forward;
    const px = -fwd.y, py = fwd.x;
    const depths = new Set(r.slots.map(s => Math.round((s.x * px + s.y * py) * 1000) / 1000));
    expect(depths.size).toBe(1);
  });
});

describe('syntheticFormationDrag', () => {
  it('lays drag perpendicular to forward, centered on centroid', () => {
    const units = Array.from({ length: 10 }, (_, i) => ({
      id: i, x: i, y: 0, spacingX: 1, spacingY: 1,
    }));
    const { startW, endW } = syntheticFormationDrag(units, { x: 1, y: 0 }, 2, 1);
    // forward = (1,0), perp = (0,1), so drag axis is along Y.
    expect(startW.x).toBeCloseTo(endW.x); // same X
    expect((startW.y + endW.y) / 2).toBeCloseTo(4.5); // centroid Y = 0; centroid X = 4.5; drag is along Y so midX = 4.5
    // Wait: midX should equal centroid X = 4.5; midY should equal centroid Y = 0.
    expect((startW.x + endW.x) / 2).toBeCloseTo(4.5);
    expect((startW.y + endW.y) / 2).toBeCloseTo(0);
  });

  it('returns nonzero offset even when single-column to preserve facing', () => {
    const units = [{ id: 0, x: 0, y: 0, spacingX: 1, spacingY: 1 }];
    const { startW, endW } = syntheticFormationDrag(units, { x: 1, y: 0 }, 1, 1);
    expect(Math.hypot(endW.x - startW.x, endW.y - startW.y)).toBeGreaterThan(0);
  });
});
```

(The "Wait:" comment in the first test is a thinking aside — leave it out. Final version of that block:)

```ts
  it('lays drag perpendicular to forward, centered on centroid', () => {
    const units = Array.from({ length: 10 }, (_, i) => ({
      id: i, x: i, y: 0, spacingX: 1, spacingY: 1,
    }));
    const { startW, endW } = syntheticFormationDrag(units, { x: 1, y: 0 }, 2, 1);
    // forward = (1,0), perp = (0,1) → drag axis is along Y.
    // Centroid X = 4.5, Y = 0; midpoint of (startW, endW) should equal centroid.
    expect((startW.x + endW.x) / 2).toBeCloseTo(4.5);
    expect((startW.y + endW.y) / 2).toBeCloseTo(0);
    expect(startW.x).toBeCloseTo(endW.x); // same X = no movement along forward
  });
```

- [ ] **Step 6: Verify**
Run `npx vitest run src/input/formation.test.ts` — all pass.

---

## Task 3: `issueReformInPlace` command

**Files:**
- Modify: `src/input/commands.ts`

- [ ] **Step 1: Add the command**

Append to `src/input/commands.ts` (imports at top of file as needed):

```ts
import { computeFormationSlots, assignFormationSlots, liveFormationUnits, syntheticFormationDrag } from './formation';

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
  const N = units.length;
  const chosenRanks = ranks ?? Math.max(1, Math.ceil(Math.sqrt(N)));
  const { startW, endW } = syntheticFormationDrag(units, forwardW, chosenRanks, spacingMult);
  const { slots, forward } = computeFormationSlots({
    units, startW, endW, spacingMult, ranksOverride: chosenRanks,
  });
  const targets = assignFormationSlots(units, slots, forward);
  const assignments = units.map((u, i) => ({ id: u.id, target: targets[i]! }));
  issueFormationMove(world, assignments, { queue: false });
}
```

(`issueFormationMove` is already in this file.)

- [ ] **Step 2: Verify build**
Run `npx tsc --noEmit` — no errors.

---

## Task 4: Selection-controller integration

**Files:**
- Modify: `src/input/selection-controller.ts`

- [ ] **Step 1: Imports and state**

Add imports at top:

```ts
import {
  createFormationParams, resetFormationParams,
  bumpSpacing, bumpRanks, spacingMultiplier,
  type FormationParams,
} from './formation-params';
import { issueReformInPlace } from './commands';
import { liveFormationUnits as materializeUnits } from './formation';
```

(Replace the existing inline `liveFormationUnits` closure with calls to the lifted helper — or alias it as above to keep the local name.)

Add to `SelectionController` interface:

```ts
export interface SelectionController {
  // ...existing fields...
  readonly formationParams: FormationParams;
}
```

Inside `createSelectionController`, after `let cursorMode: CursorMode = 'normal';`:

```ts
const formationParams = createFormationParams();
let lastSelectionSig = 0;
```

- [ ] **Step 2: Reset on selection change**

In the existing `update(_dt)` loop, after the dead-id pruning and cursorMode demotion:

```ts
let sig = selection.ids.size;
let first = -1, last = -1;
for (const id of selection.ids) {
  if (first === -1) first = id;
  last = id;
}
sig = (sig * 2654435761) ^ first ^ (last << 1);
if (sig !== lastSelectionSig) {
  resetFormationParams(formationParams);
  lastSelectionSig = sig;
}
```

(`Set` iteration order is insertion order in JS, so first/last are stable for the same selection. Multiplier is the Knuth hash constant.)

- [ ] **Step 3: Re-form helper and hotkey handlers**

Add inside `createSelectionController`:

```ts
function averageFacing(): { x: number; y: number } {
  const e = world.entities;
  let sx = 0, sy = 0, n = 0;
  for (const id of selection.ids) {
    if (e.alive[id] !== 1) continue;
    const a = (e.restFacing[id]! * Math.PI) / 4;
    sx += Math.cos(a); sy += Math.sin(a); n++;
  }
  if (n === 0) return { x: 1, y: 0 };
  const len = Math.hypot(sx, sy);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: sx / len, y: sy / len };
}

function reformNow(): void {
  const fwd = averageFacing();
  issueReformInPlace(world, selection, fwd, spacingMultiplier(formationParams), formationParams.ranks);
}
```

In `onKeyDown`, after the digit handler block (so digits still take priority), and before the `KeyR`/`KeyF` block:

```ts
if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
  const ae = (typeof document !== 'undefined') ? document.activeElement : null;
  const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (selection.ids.size === 0) return;
  bumpSpacing(formationParams, e.code === 'BracketLeft' ? -1 : +1);
  reformNow();
  return;
}
if (e.code === 'Comma' || e.code === 'Period') {
  const ae = (typeof document !== 'undefined') ? document.activeElement : null;
  const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (selection.ids.size === 0) return;
  bumpRanks(formationParams, e.code === 'Comma' ? -1 : +1);
  reformNow();
  return;
}
```

- [ ] **Step 4: Pass params into drag preview + commit**

In `formationPreview()`, change the `computeFormationSlots` call to:

```ts
const { slots, rect } = computeFormationSlots({
  units, startW, endW,
  spacingMult: spacingMultiplier(formationParams),
  ranksOverride: formationParams.ranks,
});
```

In `onMouseUp` (right button, formation drag commit), change the call to:

```ts
const { slots, forward } = computeFormationSlots({
  units, startW, endW,
  spacingMult: spacingMultiplier(formationParams),
  ranksOverride: formationParams.ranks,
});
```

- [ ] **Step 5: Replace inline `liveFormationUnits` closure**

Delete the local `liveFormationUnits` function inside `createSelectionController`. Replace its two call sites (once in `onMouseUp`, once in `formationPreview`) with `materializeUnits(world, selection.ids)`.

- [ ] **Step 6: Expose `formationParams`**

In the returned object:

```ts
return {
  get cursorMode() { return cursorMode; },
  get formationParams() { return formationParams; },
  // ...rest unchanged
};
```

- [ ] **Step 7: Tests**

Add to `src/input/selection-controller.test.ts`. Look at existing tests for the harness shape; reuse it. New test cases:

```ts
describe('formation hotkeys', () => {
  it('] bumps spacing index up; [ bumps it down', () => {
    const { controller, world, selection } = setup(); // existing helper
    // Seed one alive selectable unit
    const id = spawnUnit(world, { kind: 'line-infantry', team: 0, x: 0, y: 0 });
    selection.ids.add(id);

    controller._internals.onKeyDown({ key: ']', code: 'BracketRight', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(controller.formationParams.spacingIndex).toBe(2); // default 1 → 2

    controller._internals.onKeyDown({ key: '[', code: 'BracketLeft', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(controller.formationParams.spacingIndex).toBe(1);
  });

  it(', and . cycle ranks', () => {
    const { controller, world, selection } = setup();
    const id = spawnUnit(world, { kind: 'line-infantry', team: 0, x: 0, y: 0 });
    selection.ids.add(id);

    controller._internals.onKeyDown({ key: '.', code: 'Period', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(controller.formationParams.ranks).toBe(1);

    controller._internals.onKeyDown({ key: ',', code: 'Comma', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(controller.formationParams.ranks).toBe(null);
  });

  it('hotkeys are no-op when selection is empty', () => {
    const { controller } = setup();
    controller._internals.onKeyDown({ key: ']', code: 'BracketRight', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(controller.formationParams.spacingIndex).toBe(1); // unchanged
  });

  it('issues a move order on hotkey press with non-empty selection', () => {
    const { controller, world, selection } = setup();
    const id = spawnUnit(world, { kind: 'line-infantry', team: 0, x: 0, y: 0 });
    selection.ids.add(id);
    expect(world.orderQueue.has(id)).toBe(false);
    controller._internals.onKeyDown({ key: ']', code: 'BracketRight', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(world.orderQueue.has(id)).toBe(true);
    expect(world.orderQueue.get(id)![0]!.kind).toBe('move');
  });

  it('selection change resets formation params', () => {
    const { controller, world, selection } = setup();
    const id1 = spawnUnit(world, { kind: 'line-infantry', team: 0, x: 0, y: 0 });
    const id2 = spawnUnit(world, { kind: 'line-infantry', team: 0, x: 5, y: 0 });
    selection.ids.add(id1);
    controller.update(0);                     // bind initial signature

    controller._internals.onKeyDown({ key: ']', code: 'BracketRight', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(controller.formationParams.spacingIndex).toBe(2);

    selection.ids.clear();
    selection.ids.add(id2);
    controller.update(0);                     // detect change → reset
    expect(controller.formationParams.spacingIndex).toBe(1);
  });
});
```

Adapt `setup()` and `spawnUnit` to the existing test helpers in `selection-controller.test.ts` — names may differ; preserve the existing patterns.

- [ ] **Step 8: Verify**
Run `npx vitest run src/input/selection-controller.test.ts` and `npx tsc --noEmit` — all pass.

---

## Task 5: UI panel

**Files:**
- Create: `src/ui/formation-controls-panel.ts`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Panel module**

Create `src/ui/formation-controls-panel.ts`:

```ts
import { panel } from './overlay';
import type { Selection } from '../input/selection';
import {
  type FormationParams, SPACING_STEPS,
} from '../input/formation-params';

export interface FormationControlsPanel {
  update(sel: Selection, params: FormationParams): void;
}

export function createFormationControlsPanel(root: HTMLElement): FormationControlsPanel {
  const el = panel('formation-controls');
  el.style.display = 'none';
  root.appendChild(el);

  const spacingRow = document.createElement('div');
  spacingRow.className = 'fc-row';
  const spacingKey = document.createElement('span'); spacingKey.className = 'fc-key'; spacingKey.textContent = '[ ]';
  const spacingLabel = document.createElement('span'); spacingLabel.className = 'fc-label'; spacingLabel.textContent = 'Spacing';
  const spacingVal = document.createElement('span'); spacingVal.className = 'fc-val';
  spacingRow.append(spacingKey, spacingLabel, spacingVal);

  const ranksRow = document.createElement('div');
  ranksRow.className = 'fc-row';
  const ranksKey = document.createElement('span'); ranksKey.className = 'fc-key'; ranksKey.textContent = ', .';
  const ranksLabel = document.createElement('span'); ranksLabel.className = 'fc-label'; ranksLabel.textContent = 'Ranks';
  const ranksVal = document.createElement('span'); ranksVal.className = 'fc-val';
  ranksRow.append(ranksKey, ranksLabel, ranksVal);

  el.append(spacingRow, ranksRow);

  let lastSpacing = -1;
  let lastRanks: number | null | undefined = undefined;

  return {
    update(sel, params) {
      if (sel.ids.size === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      if (params.spacingIndex !== lastSpacing) {
        spacingVal.textContent = SPACING_STEPS[params.spacingIndex]!.label;
        lastSpacing = params.spacingIndex;
      }
      if (params.ranks !== lastRanks) {
        ranksVal.textContent = params.ranks == null ? 'auto' : String(params.ranks);
        lastRanks = params.ranks;
      }
    },
  };
}
```

- [ ] **Step 2: Styles**

Append to `src/ui/styles.css`:

```css
#ui-root .formation-controls {
  position: absolute;
  bottom: 8px;
  left: 196px;
  padding: 6px 8px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 140px;
  font-size: 11px;
  line-height: 1.2;
}
#ui-root .formation-controls .fc-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 8px;
  align-items: baseline;
}
#ui-root .formation-controls .fc-key {
  color: var(--ui-accent);
  font-weight: bold;
}
#ui-root .formation-controls .fc-label { color: #9ca3af; }
#ui-root .formation-controls .fc-val   { text-align: right; }
```

---

## Task 6: Wire into `main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Import + instantiate**

Add to imports:

```ts
import { createFormationControlsPanel } from './ui/formation-controls-panel';
```

After the other panel constructions:

```ts
const fcPanel = createFormationControlsPanel(overlay);
```

- [ ] **Step 2: Update each frame**

In the `frame()` function, near `cgPanel.update(...)`:

```ts
fcPanel.update(selection, controller.formationParams);
```

---

## Task 7: Final verification

- [ ] Run `npx tsc --noEmit` — no errors.
- [ ] Run `npx vitest run` — all tests green.
- [ ] Run `npx vite` (dev server). In the browser:
  - Drag-select a regiment.
  - Confirm the panel appears at lower-left, right of minimap, showing `Spacing: Close`, `Ranks: auto`.
  - Press `]` repeatedly — units spread out, panel cycles `Open → Loose → Skirmish`. Press `[` to bring them back.
  - Press `.` — formation collapses to single-rank line; press again to add ranks; `,` to remove.
  - Right-click-drag a new formation while ranks/spacing are non-default — drag preview honors the params.
  - Click empty area to deselect — panel hides.
  - Re-select a different group — params reset to defaults.
- [ ] Report manual-verification results.
