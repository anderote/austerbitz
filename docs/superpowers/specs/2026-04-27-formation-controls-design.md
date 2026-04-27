# Formation controls (spacing + ranks)

## Goal

Add a small panel in the lower-left HUD (right of the minimap) that shows up whenever units are selected, and a pair of hotkey families that let the player adjust:

1. **Inter-unit spacing** — from shoulder-to-shoulder up to scattered skirmishers.
2. **Rank count** — from a single long line up to a deep block.

Pressing a hotkey **immediately** re-forms the selected units in place at their current centroid and average facing. The same params also bias the next right-click-drag formation move so the drag preview matches what the player just set.

## Scope

In:
- New per-controller `FormationParams` state (spacing-step + rank-count override). Lives on `selection-controller`, resets on selection change.
- 4 new hotkeys: `[` looser, `]` tighter, `,` fewer ranks, `.` more ranks.
- "Re-form in place" command path — given a selection + `FormationParams`, compute slots from current centroid + average facing + chosen frontage, dispatch via `issueFormationMove`.
- Spacing multiplier feed into `computeFormationSlots` (drag preview + drag commit honor it).
- Rank-count override feed into `computeFormationSlots` (override the auto frontage calc).
- New UI panel `formation-controls` showing current spacing label, rank count, and hotkey hints. Visible iff selection is non-empty.

Out:
- No persistent per-unit "stance" or formation state in the sim layer — this is purely an input-layer override applied at command-issue time.
- No mouse buttons in the panel for v1 (just a read-only display + hotkey hints).
- No new spacing/rank fields in `data/units` — multipliers wrap each unit's existing `formationSpacing.{x,y}`.
- No save/restore of formation params per control group.
- No ability to set spacing/ranks while no units are selected (panel hidden).
- Selection-panel layout is unchanged (it stays bottom-center).

## State

### `FormationParams`

Lives on `selection-controller`. New module `src/input/formation-params.ts`:

```ts
export const SPACING_STEPS = [
  { mult: 0.5, label: 'Tight' },
  { mult: 1.0, label: 'Close' },     // default
  { mult: 2.0, label: 'Open' },
  { mult: 4.0, label: 'Loose' },
  { mult: 8.0, label: 'Skirmish' },
] as const;
export const DEFAULT_SPACING_INDEX = 1;

/** null = auto (frontage derived from drag length / centroid line as today). */
export type RankOverride = number | null;
export const MIN_RANKS = 1;
export const MAX_RANKS = 16;

export interface FormationParams {
  spacingIndex: number;     // index into SPACING_STEPS
  ranks: RankOverride;      // null | 1..16
}

export function createFormationParams(): FormationParams;
export function resetFormationParams(p: FormationParams): void;
export function bumpSpacing(p: FormationParams, dir: 1 | -1): void;
export function bumpRanks(p: FormationParams, dir: 1 | -1): void;  // cycles auto → 1 → … → 16 → auto
export function spacingMultiplier(p: FormationParams): number;
```

`bumpRanks` cycle order when starting from `null`: `+1` goes `null → MIN_RANKS`; `−1` goes `null → MAX_RANKS`. From an integer it clamps then wraps to `null` past either edge.

The controller owns one `FormationParams` and resets it whenever the selection set's contents change (compared by size + a cheap "same ids" check via the controller's existing `update` loop, similar to how `cursorMode` resets when selection becomes empty).

## Geometry changes — `src/input/formation.ts`

`FormationInput` gains two optional fields (no breaking changes — both default to today's behavior):

```ts
export interface FormationInput {
  units: FormationUnit[];
  startW: Vec2;
  endW: Vec2;
  spacingMult?: number;          // default 1.0
  ranksOverride?: number | null; // default null = auto
}
```

Inside `computeFormationSlots`:

- After computing `spacingX`, `spacingY` from the per-unit max, multiply both by `spacingMult ?? 1`.
- If `ranksOverride != null`: `ranks = clamp(ranksOverride, 1, N)`, `frontCount = ceil(N / ranks)`.
  - Else: keep the existing `frontCount = max(1, min(N, floor(dragLen / spacingX) + 1))`, `ranks = ceil(N / frontCount)`.

Slot layout, bounding rect, and assignment logic are otherwise unchanged.

## Re-form in place

New helper in `src/input/formation.ts`:

```ts
/**
 * Build a synthetic (startW, endW) for re-forming a selection in place.
 * Centroid stays put; the line is laid out perpendicular to `forwardW`,
 * with frontage chosen so all N units fit in `ranks` ranks at `spacingX`.
 */
export function syntheticFormationDrag(
  units: FormationUnit[],
  forwardW: Vec2,
  ranks: number,
  spacingMult: number,
): { startW: Vec2; endW: Vec2 };
```

In `computeFormationSlots`, **drag direction is the front-rank axis** and depth grows perpendicular to it (`forward = (endW - startW) / |endW - startW|`, `perp = (-fy, fx)`). So to make units face the desired forward vector `W`, the synthetic drag must lie along `perp(W) = (-W.y, W.x)`.

Implementation:
- Centroid `(cx, cy)` of `units`.
- `dragDir = (-forwardW.y, forwardW.x)`.
- `spacingX = max(units[i].spacingX) * spacingMult`.
- `frontCount = ceil(N / ranks)`.
- `halfFront = ((frontCount - 1) * spacingX) / 2`.
- `startW = (cx - dragDir.x * halfFront, cy - dragDir.y * halfFront)`.
- `endW = (cx + dragDir.x * halfFront, cy + dragDir.y * halfFront)`.

When `frontCount == 1` (single column), `halfFront == 0` and `startW == endW`. `computeFormationSlots` already handles `dragLen < eps` by falling back to forward `(1, 0)`. To preserve the desired facing, callers detect this case and substitute a tiny offset along `dragDir` (e.g. `1e-3` metres) before calling — handled inside `syntheticFormationDrag`.

### Average facing

New tiny helper in selection-controller (or inline):

```ts
function averageFacing(world: World, ids: Iterable<number>): Vec2 {
  let sx = 0, sy = 0, n = 0;
  for (const id of ids) {
    if (world.entities.alive[id] !== 1) continue;
    const a = (world.entities.restFacing[id]! * Math.PI) / 4;
    sx += Math.cos(a); sy += Math.sin(a); n++;
  }
  if (n === 0) return { x: 1, y: 0 };
  const len = Math.hypot(sx, sy);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: sx / len, y: sy / len };
}
```

Uses `restFacing` (the unit's saved formation facing) rather than the live `facing` field, since live facing wobbles during movement and we want the formation's intended direction.

## Reformation command

New function in `src/input/commands.ts` (thin wrapper — keeps `selection-controller.ts` from growing):

```ts
export function issueReformInPlace(
  world: World,
  sel: Selection,
  forwardW: Vec2,
  spacingMult: number,
  ranks: number | null,
): void;
```

Internally:
1. Build `liveFormationUnits()` — extract `{id, x, y, spacingX, spacingY}` for each alive selected id (same shape as `selection-controller` already uses; we'll lift this helper).
2. If 0 units → return.
3. Choose a frontage:
   - If `ranks` is null → use the auto rule but seeded by *current selection bounding-box width* projected onto the perpendicular axis. (Concretely: pick `ranks = ceil(sqrt(N))` as a sensible fallback when no explicit override exists. This is a one-shot choice — drags still use the auto-by-drag-length rule.)
   - Else use `ranks` directly.
4. Build a synthetic drag via `syntheticFormationDrag`.
5. Call `computeFormationSlots({ units, startW, endW, spacingMult, ranksOverride: chosenRanks })`.
6. Call `assignFormationSlots(units, slots, forward)` — Hungarian for ≤256 units, lateral-sort otherwise. Same as drag flow.
7. Call `issueFormationMove(world, assignments, { queue: false })`.

`liveFormationUnits()` currently lives inside `selection-controller.ts` as a closure; lift it to a module-level helper exported from `selection-controller.ts` (or move to `formation.ts`). Plan: move to `formation.ts` since it's pure-data and `formation.ts` already owns the `FormationUnit` type.

## Hotkey wiring

In `selection-controller.ts onKeyDown`, after the digit/letter blocks:

```ts
if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
  if (selection.ids.size === 0) return;
  bumpSpacing(formationParams, e.code === 'BracketLeft' ? -1 : +1);
  reformNow();
  return;
}
if (e.code === 'Comma' || e.code === 'Period') {
  if (selection.ids.size === 0) return;
  bumpRanks(formationParams, e.code === 'Comma' ? -1 : +1);
  reformNow();
  return;
}
```

`reformNow()` is a controller-private helper that:
- Computes `forwardW = averageFacing(world, selection.ids)`.
- Calls `issueReformInPlace(world, selection, forwardW, spacingMultiplier(formationParams), formationParams.ranks)`.

Same INPUT/TEXTAREA guard as the digit handler.

Convention — **direction = direction the visible value moves**:
- `]` = looser / larger spacing (`bumpSpacing(+1)`, multiplier goes up).
- `[` = tighter / smaller spacing (`bumpSpacing(-1)`, multiplier goes down).
- `.` = more ranks (`bumpRanks(+1)`).
- `,` = fewer ranks (`bumpRanks(-1)`).

We document the four hotkeys directly in the panel itself so the player doesn't have to remember.

## Drag flow integration

`selection-controller.ts` formation-drag commit and `formationPreview()` both call `computeFormationSlots`. Pass the controller's current `FormationParams`:

```ts
computeFormationSlots({
  units, startW, endW,
  spacingMult: spacingMultiplier(formationParams),
  ranksOverride: formationParams.ranks,
});
```

If `ranks == null`, the existing drag-based frontage rule applies (current behavior). If set, the drag's *width* is ignored for frontage and the player gets fixed `ranks` ranks regardless of drag length. That's the right behavior — the player explicitly opted in.

## Selection-change reset

Today the controller's `update()` loop prunes dead units from the selection and demotes `cursorMode` when selection becomes empty. We add a check there:

```ts
const sigNow = selectionSignature(selection);
if (sigNow !== lastSelectionSig) {
  resetFormationParams(formationParams);
  lastSelectionSig = sigNow;
}
```

`selectionSignature` is `size + first-id + last-id` (XORed) — cheap and good enough; false collisions just mean an occasional missed reset, which is harmless (params stay at previous values). We don't iterate the whole set every frame.

## UI — `src/ui/formation-controls-panel.ts`

New module mirroring `control-groups-panel.ts`:

```ts
export interface FormationControlsPanel {
  update(sel: Selection, params: FormationParams): void;
}

export function createFormationControlsPanel(root: HTMLElement): FormationControlsPanel;
```

Markup:

```html
<div class="formation-controls panel">
  <div class="fc-row"><span class="fc-key">[ ]</span><span class="fc-label">Spacing</span><span class="fc-val">Close</span></div>
  <div class="fc-row"><span class="fc-key">, .</span><span class="fc-label">Ranks</span><span class="fc-val">auto</span></div>
</div>
```

`update`:
- If `sel.ids.size === 0` → `el.style.display = 'none'`; return.
- Else display, update `.fc-val` for spacing (label from `SPACING_STEPS[params.spacingIndex].label`) and ranks (`params.ranks ?? 'auto'`).

CSS (`src/ui/styles.css`):

```css
#ui-root .formation-controls {
  position: absolute;
  bottom: 8px;
  left: 196px;       /* minimap is 180px wide + 8px left + 8px gap */
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

Wired into `main.ts` next to other panels:

```ts
const fcPanel = createFormationControlsPanel(overlay);
// in frame():
fcPanel.update(selection, controller.formationParams);
```

The controller exposes `formationParams` via a getter alongside `cursorMode`.

## Testing

Unit tests (vitest) — added to existing test files where natural, new files where not:

`src/input/formation-params.test.ts` (new):
- `bumpSpacing` clamps at both ends (doesn't go below 0 or above SPACING_STEPS.length-1).
- `bumpRanks` cycles `null → 1 → 2 → … → 16 → null` for `+1`; reverse for `-1`.
- `resetFormationParams` returns to defaults.

`src/input/formation.test.ts` (extend):
- `computeFormationSlots` with `spacingMult: 2` doubles distance between adjacent slots in the same rank and between adjacent ranks.
- `computeFormationSlots` with `ranksOverride: 4` and N=20 yields `frontCount = 5`, `ranks = 4`.
- `computeFormationSlots` with `ranksOverride: 1` yields a single-rank line.
- `syntheticFormationDrag`: for `forwardW = (1,0)` and N=10, ranks=2, spacingMult=1, returns `startW`/`endW` perpendicular to forward (along Y), centered on centroid.

`src/input/selection-controller.test.ts` (extend):
- Pressing `]` with a non-empty selection bumps `formationParams.spacingIndex` by +1.
- Pressing `[` decreases by -1.
- Pressing `,`/`.` adjusts ranks per the cycle.
- Pressing `]` with empty selection is a no-op (no exception, no params change).
- Pressing a hotkey while an INPUT is focused is ignored (use the existing test pattern that mocks `document.activeElement`).
- Pressing `]` with non-empty selection issues a formation move (orderQueue gets `move` orders for selected units).
- Selection change resets `formationParams` to defaults.

No browser tests — UI panel just renders the params text; trust the binding given how thin the panel module is.

## Manual verification (golden path)

1. Run dev server.
2. Drag-select a regiment.
3. Confirm the panel appears at lower-left, right of the minimap, showing `Spacing: Close`, `Ranks: auto`.
4. Press `]` repeatedly — units spread out, panel updates `Open → Loose → Skirmish`. Press `[` to bring them back.
5. Press `.` — they re-form into a single deep block; press again to add ranks; `,` to remove.
6. Right-click-drag a new formation while ranks/spacing are non-default — the dragged formation honors the params.
7. Click an empty area to deselect — panel disappears.
8. Re-select — panel shows defaults again.

## Files touched

New:
- `src/input/formation-params.ts`
- `src/input/formation-params.test.ts`
- `src/ui/formation-controls-panel.ts`

Modified:
- `src/input/formation.ts` — add `spacingMult`/`ranksOverride` to `FormationInput`; add `syntheticFormationDrag`; lift `liveFormationUnits` helper here (exported).
- `src/input/commands.ts` — add `issueReformInPlace`.
- `src/input/selection-controller.ts` — add `formationParams`, hotkey handlers, selection-change reset, expose getter, pass params through to `computeFormationSlots` in drag commit + `formationPreview`.
- `src/input/selection-controller.test.ts` — new tests.
- `src/input/formation.test.ts` — new tests.
- `src/ui/styles.css` — `.formation-controls` styles.
- `src/main.ts` — instantiate `formationControlsPanel` and call `update` in frame loop.

## Open risks

- **`restFacing` may be stale or inconsistent** after combat shuffling. If `averageFacing` returns garbage, the re-form could face a weird direction. Mitigation: fall back to `(1, 0)` when the averaged vector length is < 1e-6 (already in the design). Acceptable for v1; can revisit by snapshotting facing on selection.
- **Pressing rank-up with N=1** is meaningless — re-form computes one slot at the centroid and fires a no-op move. Harmless; no special case needed.
- **Mixed-kind selections**: spacing uses the *max* per-unit spacing across the selection (existing behavior). Multiplier applies on top, so `Skirmish` for cuirassiers + cannon means cannon-spacing × 8. Loud but correct — players can deselect non-line-infantry to fix.
