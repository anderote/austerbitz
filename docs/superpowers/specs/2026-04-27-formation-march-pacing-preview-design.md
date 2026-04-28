# Formation march — lock-step pacing + placement preview

**Date:** 2026-04-27
**Status:** Approved (pending implementation)

## Goal

Polish the Ctrl+RMB formation march in two ways:

1. **Lock-step pacing** — keep the formation tight during pivots and straight
   marches. The unit furthest from its slot moves at march speed; closer units
   throttle proportionally so all members arrive together.
2. **Placement preview** — while Ctrl is held with a non-empty selection,
   show the proposed pivoted formation footprint at the cursor (same green
   marching-ants outline + slot pips that RMB-drag uses).

## Scope

In:
- New `paceMaxDist: number` field on `MarchGroup`, written by `march-system`
  each tick.
- `orders-system`'s `march-formation` branch divides intended velocity by
  `paceMaxDist` ratio.
- New pure helper `computeMarchSlots(world, sel, target, formationParams)`
  in `src/input/formation.ts`. Both `issueMarchFormation` and the preview
  call it.
- `selection-controller` tracks `ctrlHeld` (set on keydown, cleared on keyup /
  blur) and `lastCursorScreen` (updated on every mousemove).
- `formationPreview()` extended: when `ctrlHeld && selection.ids.size > 0 &&
  !formationDrag.active && cursorMode === 'normal'`, return slots computed at
  the cursor's world point.
- Tests for: `paceMaxDist` computation, lock-step velocity in orders-system,
  preview returned from `formationPreview()` under the right conditions.

Out:
- Distinct preview color for marches vs RMB-drag (keep same green for v1).
- Suppression when cursor is over the HUD overlay (acceptable visual noise
  for v1).
- A separate `marchPreview()` channel — multiplex through the existing
  `formationPreview()` since at most one preview is visible at any moment.
- Preview while a formation drag is in progress (drag wins).
- Path-line / waypoint chevron rendering for queued marches.

## Lock-step pacing

### Data model

`MarchGroup` (in `src/sim/march-groups.ts`) gains:

```ts
export interface MarchGroup {
  id: number;
  members: Set<number>;
  phase: MarchPhase;
  phaseStartT: number;
  forward: Vec2;
  /** Max distance-to-slot across live members, recomputed each tick by march-system. 0 when group is fully arrived. */
  paceMaxDist: number;
}
```

`createMarchGroup` initializes `paceMaxDist: 0`. The first tick's
`march-system` pass populates it before `orders-system` reads it (system
ordering already places `march-system` first — see Task 7 in the parent
plan).

### march-system computation

After member reconciliation and before the volley-trigger check (so it runs
in both `march` and `volley` phases — cheap and avoids stale data when a
volley ends and we resume marching), add:

```ts
let maxDist2 = 0;
for (const id of group.members) {
  const q = world.orderQueue.get(id);
  const head = q && q[0];
  if (!head || head.kind !== 'march-formation') continue;
  const dx = head.targetX - e.posX[id]!;
  const dy = head.targetY - e.posY[id]!;
  const d2 = dx * dx + dy * dy;
  if (d2 > maxDist2) maxDist2 = d2;
}
group.paceMaxDist = Math.sqrt(maxDist2);
```

Squared-distance scan, then a single sqrt at the end. O(N) per group per
tick — negligible.

### orders-system velocity

Replace the `march` phase velocity computation in the `march-formation`
branch:

```ts
const baseSpeed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed;
const marchSpeed = baseSpeed * MARCH_SPEED_FACTOR;
const pace = group.paceMaxDist > 0 ? Math.min(1, dist / group.paceMaxDist) : 0;
const speed = marchSpeed * pace;
e.velX[id] = (dx / dist) * speed;
e.velY[id] = (dy / dist) * speed;
writeFacingIntent(e, id, dx, dy);
```

When `paceMaxDist === 0` everyone is at slot — `speed = 0`. The arrival
branch (`dist <= ARRIVE_RADIUS`) still fires first, parking the unit.

The `arrived === true` recovery-drift branch keeps its existing
`SETTLE_SPEED_FACTOR` behavior (no lock-step) — that's a per-unit shoved-then-recover
case, not formation movement.

### Why always-on (not just pivots)

A straight, single-kind march already has roughly equal distances → pace ≈ 1
for most units → behavior unchanged. Mixed-kind groups (cannon + infantry)
become coherent for free. There's no reason to special-case "is this a
pivot" detection.

## Placement preview

### Controller state

In `selection-controller.ts`:

```ts
let ctrlHeld = false;
let lastCursorScreen: { x: number; y: number } | null = null;
```

Wiring:
- `onMouseMove`: `lastCursorScreen = { x: e.clientX, y: e.clientY };` always
  (in addition to the existing drag-tracking).
- `onKeyDown`: if `e.key === 'Control' || e.key === 'Meta'` set `ctrlHeld = true`.
- `onKeyUp` (NEW handler — controller doesn't have one yet): if
  `e.key === 'Control' || e.key === 'Meta'` clear `ctrlHeld`.
- `onBlur`: clear `ctrlHeld` along with other state.

`onKeyDown`/`onKeyUp` use `e.key` (string) rather than `e.code` because Ctrl
is a modifier key whose physical code (`ControlLeft`/`ControlRight`,
`MetaLeft`/`MetaRight`) varies and we don't care which side; `e.key` is
`'Control'` or `'Meta'` in both cases.

### Pure slot helper

Extract from `issueMarchFormation` into `src/input/formation.ts`:

```ts
export interface MarchSlotsResult {
  slots: Vec2[];
  rect: { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 };
  forward: Vec2;
  /** Per-unit Hungarian-assigned destinations, parallel to `units`. */
  targets: Vec2[];
  /** The live formation units used to build the slots, in their assignment order. */
  units: FormationUnit[];
}

export function computeMarchSlots(
  world: World,
  ids: Iterable<number>,
  target: Vec2,
  formationParams: FormationParams,
): MarchSlotsResult | null;
```

Returns `null` when there are no live formation units — both callers can use
the same null-check.

Internally:
1. `units = liveFormationUnits(world, ids)`. If empty, return null.
2. Centroid `(cx, cy)` over `units`.
3. `forward = normalize(target - centroid)`. If degenerate, fall back to
   `(1, 0)`.
4. `spacingMult = spacingMultiplier(formationParams)`.
5. `chosenRanks = formationParams.ranks ?? inferRanksFromPositions(units, forward)`.
6. `{ startW, endW } = syntheticFormationDrag(units, forward, chosenRanks, spacingMult, target)`.
7. `{ slots, rect, forward: drawnForward } = computeFormationSlots({ units, startW, endW, spacingMult, ranksOverride: chosenRanks })`.
8. `targets = assignFormationSlots(units, slots, drawnForward)`.
9. Return `{ slots, rect, forward: drawnForward, targets, units }`.

### `issueMarchFormation` simplification

The existing function shrinks to: call `computeMarchSlots`, allocate group
from `result.units` ids, write per-unit `march-formation` orders from
`result.targets`. Same observable behavior; no test changes required for
existing cases.

### Preview accessor

Extend `formationPreview()` in `selection-controller.ts`:

```ts
function formationPreview(): FormationPreview | null {
  // Existing formation-drag branch wins.
  if (formationDrag.active) {
    // ... unchanged ...
  }
  // March preview: Ctrl held, selection non-empty, idle.
  if (ctrlHeld && selection.ids.size > 0 && cursorMode === 'normal' && lastCursorScreen) {
    const w = screenToWorld(camera, lastCursorScreen);
    const r = computeMarchSlots(world, selection.ids, w, formationParams);
    if (!r) return null;
    return { rect: r.rect, slots: r.slots };
  }
  return null;
}
```

Renderer reads `formationPreview` exactly as today — outline + pips. No
render-pass changes.

## Edge cases

1. **Ctrl held + click LMB**: LMB is selection, doesn't fire a march. Preview
   stays visible; on selection change the new selection's preview is shown.
2. **Ctrl held + RMB-drag starts**: `formationDrag.active` becomes true →
   march preview suppressed; drag preview wins. On drag commit (regular RMB
   drag, not march), `formationDrag.active` clears and the march preview
   returns.
3. **Window blur with Ctrl held**: `onBlur` clears `ctrlHeld`; preview
   disappears. On refocus, the player must press Ctrl again.
4. **Ctrl held but cursor over HUD**: preview floats at last canvas-cursor
   position. Acceptable noise; not worth the suppression complexity for v1.
5. **Selection becomes empty mid-Ctrl**: `selection.ids.size === 0` →
   preview null. Good.
6. **`paceMaxDist === 0` while group has members but all are within
   `ARRIVE_RADIUS`**: orders-system's arrival branch fires per-unit before
   the velocity computation, so units already park; the velocity branch only
   runs for non-arrived units, all of whom have `dist > ARRIVE_RADIUS > 0`.
   Division safety only needed for the truly-zero edge case (handled by the
   `paceMaxDist > 0` guard).
7. **One unit much further than the rest**: that one moves at march-speed,
   everyone else creeps. Functionally desired (the rest hold position
   waiting for the laggard to catch up). If the laggard is slower than its
   own kind's march speed, the formation cohesion is preserved.
8. **`formationParams` change while Ctrl held**: preview re-evaluates each
   frame (it's recomputed live in `formationPreview()`), so adjusting
   spacing/ranks via `[]` `,.` updates the preview immediately.

## Testing

**`src/sim/march-groups.test.ts`** (extend):
- `createMarchGroup` initializes `paceMaxDist: 0`.

**`src/sim/systems/march-system.test.ts`** (extend):
- After one tick on a group with members at varied distances, `group.paceMaxDist`
  equals the maximum `dist(unit, slot)`. Use a 2-member group with positions
  (0, 0) and (10, 0), slots (50, 0) and (52, 0) — expect `paceMaxDist = 50`.
- A group whose members are all within ARRIVE_RADIUS of slot has
  `paceMaxDist` close to zero (≤ ARRIVE_RADIUS).

**`src/sim/systems/orders-system.test.ts`** (extend):
- Two-member group with one unit 100 m from slot and another 25 m from slot,
  `paceMaxDist = 100`. After one tick:
  - Far unit's velocity magnitude = `marchSpeed`.
  - Near unit's velocity magnitude = `marchSpeed * 0.25`.
- One-member group: pace = 1 (no behavioral change vs pre-pacing).
- `paceMaxDist === 0` (manually set on the group) yields zero velocity even
  if `dist > ARRIVE_RADIUS`. This is a defensive case — march-system in
  practice never sets it to 0 while non-arrived members exist.

**`src/input/formation.test.ts`** (extend):
- `computeMarchSlots` with empty selection returns null.
- `computeMarchSlots` with one alive unit returns 1 slot anchored at the
  target.
- Two-unit selection moving from (0,0)/(4,0) to target (100, 0): `forward.x ≈ 1`,
  centroid of returned slots ≈ (100, 0).

**`src/input/selection-controller.test.ts`** (extend):
- `formationPreview()` returns null when Ctrl is not held.
- After Ctrl keydown + a mousemove, `formationPreview()` returns a non-null
  result with slots positioned at the cursor world point.
- Ctrl keyup clears the preview (`formationPreview()` returns null).
- During an active formation drag with Ctrl held, the drag preview wins
  (returns the drag's slots, NOT the march preview slots).
- `onBlur` with Ctrl held clears the preview.

## Files touched

Modified:
- `src/sim/march-groups.ts` — add `paceMaxDist` field, initialize in
  `createMarchGroup`.
- `src/sim/march-groups.test.ts` — extend.
- `src/sim/systems/march-system.ts` — populate `paceMaxDist` each tick.
- `src/sim/systems/march-system.test.ts` — extend.
- `src/sim/systems/orders-system.ts` — lock-step pacing in march-formation
  velocity.
- `src/sim/systems/orders-system.test.ts` — extend.
- `src/input/formation.ts` — new `computeMarchSlots` helper + `MarchSlotsResult`
  type export.
- `src/input/formation.test.ts` — extend.
- `src/input/commands.ts` — `issueMarchFormation` rewritten to delegate to
  `computeMarchSlots`. No new tests required (existing tests cover
  observable behavior).
- `src/input/selection-controller.ts` — `ctrlHeld`, `lastCursorScreen`,
  `onKeyUp` registration, extended `formationPreview()`.
- `src/input/selection-controller.test.ts` — extend.

## Open risks

- **`computeMarchSlots` runs every frame Ctrl is held.** For 100-unit
  selections it's two passes over `units` plus a Hungarian assignment
  (O(N³) for N ≤ 256, lateral-sort O(N log N) for larger). At N=100 the
  Hungarian is ~10⁶ ops per call — well under a frame. At N=400+ the
  lateral-sort kicks in and stays cheap. No throttling needed.
- **Pace floor**: a unit very close to its slot creeps at near-zero velocity
  and may take many ticks to cross the last ARRIVE_RADIUS. The arrival
  branch fires once `dist <= ARRIVE_RADIUS`, so eventual arrival is
  guaranteed. If creep-time becomes noticeable (e.g., a 0.05 m/s creep over
  0.1 m takes 2 sim seconds), revisit by adding a min pace of e.g. 0.1.
  Skip for v1.
- **Hungarian re-shuffle frame-to-frame in the preview**: cursor jitter could
  in principle reassign which unit goes to which slot, making the preview
  pips appear to swap. In practice the cost-matrix differences are tiny
  under sub-pixel cursor moves and the assignment is stable. If flicker
  shows up, debounce or snap target to a sub-meter grid.
