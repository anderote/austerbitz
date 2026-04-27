# Formation drag (Total War-style move)

## Goal

Right-click + drag should let the player draw the **front rank** of a destination formation. Selected units form up into a rectangular block whose width matches the drag, with depth chosen to fit the selection size. While dragging, an outline preview shows where each unit will go.

A bare right-click (no drag) keeps the existing single-point move behavior.

## Scope

In:
- New right-mouse drag input flow.
- Geometry: drag → slot positions for each selected unit.
- Greedy nearest slot assignment.
- Per-unit `move` orders dispatched to the slot positions.
- Live drag preview: outline rectangle + per-slot pips.
- Shift-queue support (append formation to existing queue).
- Esc / blur cancellation.

Out:
- No unit facing/rotation field (sprites still face direction-of-travel).
- No collision-aware slot reshuffling (existing local steering handles overlap).
- No special waypoint visualization for queued formations beyond today's polylines.
- Attack-move (`A`) flow unchanged — formation drag is move-only.

## Input flow

`selection-controller.ts` gains a right-mouse drag handler analogous to the existing left-mouse selection drag.

1. **mousedown right-button**, not on HUD: record `formationDrag.start = clientPos`, `formationDrag.current = clientPos`, `formationDrag.active = false`. (Today, right-button only acts on mouseup.)
2. **mousemove**: update `formationDrag.current`. If `hypot(dx, dy) > 4 px` (same `DRAG_THRESHOLD_PX` as selection), set `active = true`.
3. **mouseup right-button**:
   - If selection is empty → no-op (clear pending state).
   - If `active` → compute slots from drag start/end in world space, call `issueFormationMove(...)`, with `queue: shiftKey`.
   - If not `active` → existing single-point flow: `issueAttack` if cursor over an enemy, else `issueMove` (with `queue: shiftKey`).
   - Clear `formationDrag.active`, reset `pendingClickStart`-equivalent.
4. **Esc / blur**: cancel an in-progress formation drag (set `active = false`, drop pending).

The left-mouse selection drag and the right-mouse formation drag are independent — the player can theoretically have a left-button drag in flight when a right-button event arrives. Today the controller does not gate left-drag on right-button state; we keep that and rely on the OS-level convention that users don't hold both buttons. Right-mouse-down while left-mouse selection drag is active simply starts a formation drag; mouseup on each button finishes its own gesture.

## State

`src/input/selection.ts`:

```ts
export interface FormationDrag {
  start: Vec2;     // screen
  current: Vec2;   // screen
  active: boolean;
}

export function createFormationDrag(): FormationDrag;
```

`main.ts` constructs one and passes it through `createSelectionController` and `renderer.render` alongside the existing `DragRect`.

## Geometry — `src/input/formation.ts`

New module. Pure functions, no DOM, no GL.

```ts
export interface FormationInput {
  /** Live, alive selected unit ids in dispatch order (the order commands.ts iterates). */
  units: { id: number; x: number; y: number; spacingX: number; spacingY: number }[];
  /** Drag endpoints in world space. */
  startW: Vec2;
  endW: Vec2;
}

export interface FormationSlots {
  /** One slot per unit, in the same order as `units`. */
  slots: Vec2[];
  /** The four corners of the bounding rectangle, for the preview overlay. */
  rect: { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 };
}

export function computeFormationSlots(input: FormationInput): FormationSlots;
```

### Spacing

Take `spacingX = max(units[i].spacingX)`, `spacingY = max(units[i].spacingY)`. Using max keeps mixed-kind selections coherent — a tighter unit kind doesn't cause a looser one to overlap. (Same-kind selections collapse to that kind's spacing.)

### Front rank

```
dragVec    = endW - startW
dragLen    = |dragVec|
forward    = dragVec / max(dragLen, ε)            // unit, along front rank
N          = units.length
frontCount = clamp(floor(dragLen / spacingX) + 1, 1, N)
ranks      = ceil(N / frontCount)
```

`+1` so a zero-length drag still gives `frontCount = 1` and a single-file column; a drag exactly `spacingX` long gives `frontCount = 2`.

### Depth direction

The depth axis is perpendicular to `forward`, oriented *away from the centroid of the units' current positions* — so the formation forms on the far side of the troops, never on top of them.

```
perpA      = (-forwardY, forwardX)                 // 90° left of forward
centroid   = mean(units[i].pos)
midDrag    = (startW + endW) / 2
depthDir   = perpA · sign(dot(midDrag - centroid, perpA))   // flips perpA if needed
              // if the dot is 0 (units exactly on the front line), default to perpA
```

### Slot grid

For each `(rank r ∈ [0, ranks), file f ∈ [0, frontCount))` in row-major order, slot count `S = ranks * frontCount`. The last rank may have fewer occupied files (`N % frontCount`); we generate only the first `N` slots and leave the back rank centered.

```
fileOffset(f, count) = (f - (count - 1) / 2) * spacingX     // centers the rank on midDrag
slotCenter(r, f, count) = midDrag + forward * fileOffset(f, count) + depthDir * (r * spacingY)

for r in 0..ranks-1:
  count = (r < ranks - 1) ? frontCount : (N - r * frontCount)   // fewer in the last rank
  for f in 0..count-1:
    push slotCenter(r, f, count)
```

Result: `slots.length === N`. Each rank is centered on the drag midpoint along the front axis, ranks stack in `depthDir`.

### Bounding rectangle for preview

```
halfW = (frontCount - 1) * spacingX / 2 + spacingX / 2     // include slot footprint padding
depth = (ranks - 1) * spacingY + spacingY
tl    = midDrag - forward * halfW
tr    = midDrag + forward * halfW
br    = tr + depthDir * depth
bl    = tl + depthDir * depth
```

### Slot assignment (greedy nearest)

`computeFormationSlots` returns `slots` indexed positionally (rank, file order). The dispatcher then re-orders them per unit:

```ts
function assignSlots(units, slots): Vec2[] {
  // O(N^2). N is selection size, typically <= ~300.
  const taken = new Uint8Array(slots.length);
  const out: Vec2[] = new Array(units.length);
  // Pre-sort: units farthest from the destination get first pick. Reduces crossings.
  const cx = mean(slots.map(s => s.x));
  const cy = mean(slots.map(s => s.y));
  const d2ToCentroid = (i: number) => (units[i].x - cx) ** 2 + (units[i].y - cy) ** 2;
  const order = units.map((_, i) => i).sort((a, b) => d2ToCentroid(b) - d2ToCentroid(a));
  for (const i of order) {
    let best = -1, bestD = Infinity;
    for (let j = 0; j < slots.length; j++) {
      if (taken[j]) continue;
      const d = (units[i].x - slots[j].x) ** 2 + (units[i].y - slots[j].y) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    }
    taken[best] = 1;
    out[i] = slots[best];
  }
  return out;
}
```

This is exposed as `assignFormationSlots(units, slots): Vec2[]` and tested independently.

## Order issuance — `src/input/commands.ts`

```ts
export function issueFormationMove(
  world: World,
  sel: Selection,
  slots: Vec2[],     // one per live unit, same order as the dispatch iteration
  opts: OrderOpts = {},
): void;
```

Same dispatch core as `issueMove`, but the per-unit target is `slots[i]` instead of `spreadTarget(target, count, i)`. Pre-condition: `slots.length === liveCount` from the same `sel` snapshot. The controller is responsible for maintaining that invariant — it iterates the live selection once to gather inputs for `computeFormationSlots`, then passes slots straight through.

## Rendering — `src/render/passes/selection-pass.ts` + `selection.glsl.ts`

The selection pass already has marching-ants drag-rect rendering. We extend it.

### Inputs

`SelectionPass.draw(world, cam, sel, drag, formation)` — add a `formation: FormationDrag` argument and a parallel `formationSlots: Vec2[] | null` so the pass doesn't recompute geometry. Cleanest split: the controller computes both the `formationDrag` screen state and a parallel **preview state** (rect corners + slot positions in world space) on each mousemove, exposed via a `getFormationPreview()` accessor. The renderer reads it.

Concretely:

- Add `FormationPreview { rect: {tl,tr,br,bl}; slots: Vec2[] }` returned by `controller.formationPreview()`.
- The renderer receives `formationPreview: FormationPreview | null` and draws nothing when null.
- The controller updates the preview only when `formationDrag.active && cursorMode === 'normal'` and a selection exists; otherwise returns null.

### Outline rectangle

A 4-vertex line loop (8 vertices, drawn as `gl.LINES`) using the same `DRAG_VS` / `DRAG_FS` (marching-ants) shader as the selection drag. To distinguish the two drags visually, parameterize the existing fragment shader with a `u_color` uniform, and pass green-ish `(0.55, 1.0, 0.6, 1.0)` for the formation, white `(1.0, 1.0, 1.0, 1.0)` for the selection drag. (Single shader stays simpler than forking it.)

### Per-slot pips

Reuse the disc instancing pipeline pattern: instanced 6-vertex quad, one instance per slot. New small program `PIP_VS` / `PIP_FS` in `selection.glsl.ts` — fragment shader draws a hollow 2×2-world-unit square (1px outline using `fwidth` for stable edges across zoom). Color matches the outline rectangle.

A separate `pipVao` + `pipPosBuf` (capacity = `selection capacity`, `Float32Array * 2`) lives in the selection pass alongside `dragVao` and `wpVao`.

### Frame ordering

Existing draw order in `renderer.render`: terrain → sprites → particles → selectionPass.draw. Formation overlay draws inside `selectionPass.draw` after the drag-rect, so it sits on top of the world but below HUD overlays.

## Wiring through `main.ts`

```
const formationDrag = createFormationDrag();
const controller = createSelectionController({ ..., formationDrag });
...
renderer.render(world, particles, camera, selection, drag, controller.formationPreview());
```

`renderer` and `selectionPass` interfaces grow a `formationPreview: FormationPreview | null` argument.

## Error / edge cases

- **Empty selection on drag end**: do nothing (no orders, no preview was shown anyway).
- **Drag length below 1e-3 world units** (degenerate / zero-distance): treat as a non-drag, fall back to single-point move at `endW`.
- **Single unit selected**: `frontCount = 1`, `ranks = 1`, slot is at `midDrag`. Drag still works as a precise placement.
- **Very large selection** (> capacity): selection capacity already gates ids; renderer pip buffer caps at the same capacity. Slot count = N, no overflow.
- **Mixed kinds**: max spacing as described; preview rectangle covers the worst-case footprint.
- **Esc during drag**: discard preview, no order issued.
- **Right-click on enemy** with a drag past threshold: this is a formation move, NOT an attack. (Single-point right-click on enemy → attack remains. The drag intent supersedes the click target.)
- **Shift-drag**: queue per-unit `move` orders to each slot, appended to existing queue. Each unit's queue gets exactly one new order.

## Testing

`src/input/formation.test.ts`:
- Front-rank arithmetic: zero-length drag → `frontCount=1`, single column.
- Drag length crossing `spacingX` boundary → `frontCount` increments.
- 9 units, drag length = `2 * spacingX` → `frontCount=3, ranks=3`.
- 10 units, `frontCount=3` → ranks `[3, 3, 3, 1]` with the last rank centered.
- Depth direction: centroid on left of midDrag → `depthDir` points right (formation on the right side); centroid on right → points left.
- Mixed kinds: max spacing chosen; verify both axes.
- `assignFormationSlots`: 4 units at `(0,0),(1,0),(2,0),(3,0)` with slots at `(0,5),(1,5),(2,5),(3,5)` produces a 1:1 monotonic mapping.

`src/input/selection-controller.test.ts` extensions:
- Right-mousedown + mousemove past threshold + mouseup → `issueFormationMove` called with N slots; live `formationPreview()` returns non-null mid-drag.
- Right-click below threshold → existing single-point move behavior preserved.
- Shift+formation drag → orders are queued, not replacing.
- Esc mid-drag → preview cleared, no order issued on subsequent mouseup.
- Empty selection + right-drag → no order, no error.

## File-by-file summary

| File | Change |
|---|---|
| `src/input/selection.ts` | Add `FormationDrag` type + `createFormationDrag()`. |
| `src/input/formation.ts` | New module: `computeFormationSlots`, `assignFormationSlots`. |
| `src/input/formation.test.ts` | New tests for the geometry and assignment. |
| `src/input/commands.ts` | Add `issueFormationMove`. |
| `src/input/selection-controller.ts` | Right-mouse drag handlers; `formationPreview()` accessor; pass `formationDrag` from deps. |
| `src/input/selection-controller.test.ts` | New tests for the formation drag flow. |
| `src/render/shaders/selection.glsl.ts` | Add `u_color` to drag-rect fragment shader; add `PIP_VS` / `PIP_FS`. |
| `src/render/passes/selection-pass.ts` | Accept `formationPreview`; draw outline rect + slot pips. |
| `src/render/renderer.ts` | Thread `formationPreview` through `render()`. |
| `src/main.ts` | Construct `FormationDrag`, pass to controller, supply `controller.formationPreview()` each frame. |

## Non-goals (worth restating)

- No new entity field, no new order kind. Just `move` orders to computed slot positions.
- No facing rotation. Visual orientation matches movement direction as today.
- No collision-aware slot resolution. Local steering keeps soldiers from stacking.
