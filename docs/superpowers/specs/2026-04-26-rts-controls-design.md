# Austerbitz — RTS-style Selection & Command Controls

**Date:** 2026-04-26
**Status:** Approved (pending implementation plan)

## Goal

Replace the current minimal selection/command wiring (drag-rect + click + right-click move) with a control scheme that mirrors well-established RTS idioms (StarCraft 2, Red Alert 2). The result should feel "obvious" to anyone who has played those games: marquee selection that respects ownership, modifier-aware click rules, double-click "select all of type", control groups, attack-move, stop, and queued orders.

## Non-Goals

The following are explicitly deferred and must NOT be designed in:

- Formation-aware destination spread (current √n×√n grid stays).
- Tab subgroup cycling.
- Patrol orders.
- Hold-position (functionally identical to Stop until combat lands).
- Follow-ally (RMB on own unit).
- Custom cursor sprites (CSS cursor swap is enough).
- Selection / order audio.

## Current State (audit)

- `src/input/selection.ts` — `Selection { ids: Set<number> }`, `DragRect { start, current, active }`, `hitTestPoint` (O(n), first-found, no team filter), `hitTestRect` (O(n), no team filter).
- `src/input/commands.ts` — only `issueMoveOrder`, single-slot order replacement.
- `src/sim/world.ts` — `Order = { kind: 'move'; targetX; targetY }`; `orders: Map<number, Order>`. One slot per entity, no queue.
- `src/main.ts:70-118` — selection wiring is inline window listeners (not routed through `input-manager`). Shift = additive only. RMB always issues `move`. Escape clears selection. No double-click, no Ctrl, no control groups, no attack-move, no stop.
- `src/render/passes/selection-pass.ts` — draws rings (one color) + a marquee outline in world space.
- `src/sim/entities.ts` — `team: Uint8Array` exists per entity but no `PLAYER_TEAM` constant.
- All current spawns are team 0; there are no enemies. The team filter must work correctly with a single-team world today and remain correct when enemies are added.

## Architecture

### Module boundaries

```
src/input/
  input-manager.ts          (existing — raw mouse/keys, unchanged shape)
  camera-controls.ts        (existing — middle-drag, wheel, WASD, unchanged)
  selection.ts              (data + pure hit-tests, expanded)
  selection-controller.ts   (NEW — click/drag/double-click state machine,
                             modifier rules, control groups, cursor mode)
  commands.ts               (expanded — move/attack/attack-move/stop, queue flag)
src/sim/
  world.ts                  (Order union expands; orders → orderQueue)
  player.ts                 (NEW — exports PLAYER_TEAM = 0)
  systems/orders-system.ts  (dequeues completed orders; resolves attack/attack-move)
src/render/passes/
  selection-pass.ts         (per-team ring tint; draw queued-waypoint markers)
src/ui/
  hud.ts                    (shows attack-move mode label when active)
```

`selection-controller.ts` owns all the user-facing input behavior described in this spec. `main.ts` becomes a thin wiring layer: instantiate the controller, hand it the canvas + camera + world + selection + drag, call `update(dt)` once per frame.

### Why a new controller module

The current inline listeners in `main.ts` mix concerns (raw events, drag-threshold logic, selection mutation, command dispatch) and have no internal state for double-click timing, modifier snapshots, control groups, or cursor mode. Extracting a controller gives:

1. A clear interface (DOM events in / selection + commands out).
2. Pure-state-machine testability without a DOM.
3. A single seam where future bindings (rebindable hotkeys, gamepads) can plug in.

## Data Model Changes

### `Order` union (in `src/sim/world.ts`)

```ts
export type Order =
  | { kind: 'move'; targetX: number; targetY: number }
  | { kind: 'attack'; targetId: number }
  | { kind: 'attack-move'; targetX: number; targetY: number }
  | { kind: 'stop' };       // sentinel, see Stop semantics below
```

`stop` is processed by `orders-system` as "clear queue and idle"; it never sits at the head of a queue (it's resolved immediately). It exists in the union so `commands.issueStop` can flow through the same dispatch path as the others, but the system consumes it eagerly.

### `orderQueue` replaces `orders`

```ts
// Was: orders: Map<number, Order>
// Now:
orderQueue: Map<number, Order[]>;   // front = active
```

- `commands.issueX(world, sel, target, { queue: false })` replaces the entire queue with `[order]`.
- `commands.issueX(world, sel, target, { queue: true })` appends to the existing queue (creates one if missing).
- `orders-system` always reads `queue[0]`. When the active order completes, it shifts the front off; if the queue empties, the entry is deleted from the map.

### `PLAYER_TEAM`

```ts
// src/sim/player.ts
export const PLAYER_TEAM = 0;
```

Centralized so future scenario code can override per-game.

## Selection Hit-Tests (in `src/input/selection.ts`)

```ts
hitTestPoint(world, w, opts?: { team?: number }): number
hitTestRect(world, x0, y0, x1, y1, opts?: { team?: number }): number[]
findSameKindInView(world, kindId, viewRect, opts?: { team?: number }): number[]
```

### Priority pick on overlap

`hitTestPoint` must return the entity whose center is *closest to the cursor* among all entities whose AABB contains the cursor. Tie-break by lower entity id (deterministic). Today's first-found behavior is replaced.

### Team filter

When `opts.team` is provided, only entities with `entities.team[id] === opts.team` are considered. Omitting the option preserves "any team" behavior (used by single-click for inspection).

### Same-kind-in-view

Used by Ctrl+click and double-click. `viewRect` is in world coordinates (computed from camera + viewport). Returns ids where `kindId` matches and (when team supplied) `team` matches. Caller decides whether to also filter visible region.

## User-Facing Behaviors

### Selection rules

| Input | Behavior |
|---|---|
| LMB press → release without exceeding drag threshold (4 px) on unit | Replace selection with closest-center unit under cursor (any team). |
| LMB press → release on empty | Clear selection. |
| LMB press → drag past 4 px → release | Marquee. Select all units in box with `team === PLAYER_TEAM`. **Fallback:** if zero own-team units in box and ≥1 non-own-team units in box, select the closest single non-own-team unit to box center. |
| Shift + LMB click on unit | Toggle that unit in selection. If selected → remove. If not → add. |
| Shift + LMB drag | Additive marquee: add own-team units in box to selection. Toggle behavior is NOT applied to drag (matches SC2). |
| Ctrl + LMB click on unit | Replace selection with all units of same `kindId` currently in the viewport rect (computed from `camera.center`, `camera.zoom`, and `camera.viewport`), filtered to the team of the clicked unit (so Ctrl-clicking an enemy selects all of that enemy kind in view). |
| Double-click on unit | Two LMB-up events on the same `id` within 300 ms and 6 px. Behaves identically to Ctrl+click on that unit. |
| Esc | If cursor mode != normal, return to normal. Else clear selection. |
| Mousedown whose `event.target` is inside the HUD overlay (`#overlay`) | Controller ignores it entirely — no marquee starts, no selection mutates. |

### Command rules

| Input | Behavior |
|---|---|
| RMB up on enemy unit (any team ≠ PLAYER_TEAM, hit by `hitTestPoint`) | `issueAttack(targetId)`. |
| RMB up on empty / own unit / terrain | `issueMove(point)`. |
| Shift + RMB | Same as above but with `{ queue: true }`. |
| `A` key (when something is selected) | Enter `attack-move` cursor mode. Canvas cursor → `crosshair`. HUD shows "Attack-move" label. |
| In attack-move mode → LMB up | `issueAttackMove(point, { queue: shiftHeld })`. Returns to normal mode. |
| In attack-move mode → RMB up | Cancel mode (no order issued). |
| `S` key | `issueStop`. Clears each selected unit's queue. |

### Control groups

| Input | Behavior |
|---|---|
| Ctrl + `1..9` or `0` | Assign current selection ids to that group slot (0–9). Replaces any prior contents. Empty selection clears the slot. |
| `1..9` / `0` (no modifier, only when no text input is focused) | Replace current selection with the group's ids (filtered for `entities.alive`). |
| Shift + `1..9` / `0` | Add group's ids (filtered for alive) to current selection. |

Control groups are stored as `Set<number>[]` of length 10. They are NOT persisted across sessions — pure runtime state.

## Cursor Mode State Machine

```
states: 'normal' | 'attack-move'
initial: 'normal'

normal:
  on 'A' (selection non-empty)        → attack-move
  on Esc                              → clear selection (no state change)

attack-move:
  on LMB up                           → issueAttackMove + → normal
  on RMB up                           → → normal (no order)
  on Esc                              → → normal
  on selection becoming empty         → → normal
```

When entering `attack-move`, the controller sets `canvas.style.cursor = 'crosshair'`. When leaving, restores `'default'`. The HUD's update loop reads `controller.cursorMode` and shows/hides a label.

## Selection Controller Interface

```ts
export interface SelectionController {
  /** Called once per frame from the main loop. */
  update(dt: number): void;
  /** Cursor mode for HUD/render to read. */
  readonly cursorMode: 'normal' | 'attack-move';
  /** Tear down DOM listeners. */
  destroy(): void;
}

export interface SelectionControllerDeps {
  canvas: HTMLCanvasElement;
  overlayRoot: HTMLElement;       // for HUD-target suppression
  camera: Camera;
  world: World;
  selection: Selection;
  drag: DragRect;
}

export function createSelectionController(deps: SelectionControllerDeps): SelectionController;
```

Internal state (private to module):

```ts
{
  cursorMode: 'normal' | 'attack-move',
  pendingClickStart: { x: number; y: number; t: number } | null,
  lastClick: { id: number; t: number; x: number; y: number } | null,  // for double-click
  controlGroups: Set<number>[],   // 10 slots
}
```

The controller registers its own DOM listeners on `window` for mouse and key events (so a press-on-canvas / release-outside-canvas marquee still completes), and uses `event.target` + `overlayRoot.contains(target)` to suppress mousedowns that begin on a HUD element. RMB context-menu suppression already lives in `input-manager`; the controller does not duplicate it.

The controller writes to the shared `Selection` and `DragRect` objects passed in — both are mutated in place so the renderer (which reads them every frame) sees updates without a separate event channel.

`pendingClickStart.t` is used to ignore stale presses if the press is interrupted by `blur` (controller resets state on `window.blur`).

## Commands API (in `src/input/commands.ts`)

```ts
export interface OrderOpts { queue?: boolean }

export function issueMove(world, sel, target: Vec2, opts?: OrderOpts): void;
export function issueAttack(world, sel, targetId: number, opts?: OrderOpts): void;
export function issueAttackMove(world, sel, target: Vec2, opts?: OrderOpts): void;
export function issueStop(world, sel): void;
```

- `issueMove` keeps the current √n×√n target spread (not in scope to change).
- `issueAttack` issues the SAME `targetId` to every selected unit (no per-unit retargeting yet).
- `issueAttackMove` keeps the same √n×√n spread as `issueMove`.
- All four filter `sel.ids` to alive entities before dispatching.
- `queue: true` appends; falsy replaces (`orderQueue.set(id, [order])`).
- `issueStop` does `orderQueue.delete(id)` for each selected, alive id.

## Orders System Changes

`src/sim/systems/orders-system.ts` currently consumes `world.orders` (single slot). Updates:

1. Read `world.orderQueue.get(id)?.[0]` as the active order.
2. When `move` reaches its target (existing completion check), shift the front. If the queue is empty, delete the map entry.
3. `attack` order: if `targetId` is dead, shift; else (combat not implemented yet) the entity holds position next to it. **Stub** for this slice — full attack resolution is out of scope.
4. `attack-move`: behaves like `move` until combat exists. (Stub, same as `attack`.)

The stubs are explicit so the controller, commands, and render layer can ship without combat. Combat can replace the stubs without touching input.

## Render Additions

### Per-team ring color (`selection-pass.ts`)

Rings already render via instanced quads with per-instance position/radius. Add a per-instance color attribute. The pass populates it by reading `entities.team[id]`:

- `PLAYER_TEAM` → blue `(0.4, 0.7, 1.0)`.
- Other → red `(1.0, 0.4, 0.4)`.

Shader uniform / attribute layout change:
- `selection.glsl` gets an `in vec3 a_ringColor;` and uses it for the fragment color.

### Queued waypoint markers

For each id in `selection.ids` with a non-empty queue:

- Draw a chevron (small triangle) at each waypoint of `move`/`attack-move` orders.
- Draw a polyline from the entity's current position through each waypoint.
- Faint alpha (0.4). Same color as ring.
- Implementation: a separate draw call inside `selection-pass.ts` using lines + small triangles, batched. (No new pass.)

### RMB click-feedback puff

When `commands.issueMove`, `issueAttack`, or `issueAttackMove` is dispatched from the controller, the controller calls `emitDust` (or a new tiny `emitOrderMarker`) at the world point. Reuse particles infrastructure; no new pass.

### Cursor

`canvas.style.cursor` toggles between `'default'` and `'crosshair'`. Nothing more.

## HUD Update

`src/ui/hud.ts` reads `controller.cursorMode`. When `'attack-move'`, the HUD shows a small label "Attack-move target". When `'normal'`, the label is hidden.

## main.ts changes

```ts
const controller = createSelectionController({
  canvas, overlayRoot: overlay, camera, world, selection, drag,
});
// In the frame loop:
controller.update(dt);
// renderer.render and HUD update unchanged signatures, except HUD reads controller.cursorMode.
```

The big inline listener block (lines 70–118 today) is deleted; the `Escape` handler moves into the controller.

## Edge Cases & Invariants

1. **Dead entity ids in selection / control groups** — every read must filter by `entities.alive[id] === 1`. The selection set is NOT proactively pruned; a once-per-frame compaction inside the controller is sufficient. Control groups are filtered on recall.
2. **Marquee fallback** — "if zero own-team in box, pick closest enemy" is computed only when the box has positive area (drag was active). A bare click never triggers fallback.
3. **Modifier snapshot at mouseup, not mousedown** — Shift/Ctrl state at the moment of the *release* determines behavior. (SC2/RA do this; pressing Shift mid-drag still adds.)
4. **A-key while attack-move is already active** — no-op.
5. **A-key with empty selection** — no-op.
6. **Double-click timing** — uses `performance.now()`. The 300 ms / 6 px window is measured from the *previous LMB-up* whose hit was the same id.
7. **Queueing when queue is empty** — `issueX(..., { queue: true })` with no existing queue creates `[order]` (functionally same as replace).
8. **Stop with empty selection** — no-op.
9. **HUD-target suppression** — checked via `event.target instanceof Node && overlayRoot.contains(event.target as Node)`.
10. **Window blur** — controller clears `pendingClickStart`, ends any active drag (sets `drag.active = false`), and resets cursor mode to `normal`. Selection persists.
11. **Numbers via numeric keypad** — controller listens for `event.code` matching `Digit0..9` AND `Numpad0..9`. So both rows work.
12. **Text input focus** — control-group recalls are gated on `document.activeElement` being the canvas or `body`. Currently the project has no text inputs, but this guard is cheap and prevents future regressions.
13. **Order queue size bound** — no hard cap. (RTS games typically don't cap; trust user.)

## Test Plan

### `selection.test.ts` (extended)

- `hitTestPoint` returns the entity with center closest to cursor when two AABBs overlap.
- `hitTestPoint` with `team` option excludes off-team entities.
- `hitTestRect` with `team` option excludes off-team entities.
- `findSameKindInView` returns only entities of the given kind whose center is in the view rect; team filter applies.

### `selection-controller.test.ts` (NEW)

Tests construct a fake `Camera`, `World`, `Selection`, `DragRect`. The controller's event handlers are implemented as named inner functions and re-exported as a `_internals` object on the returned controller (gated behind `if (import.meta.env.MODE === 'test')` or always-exported but underscore-prefixed). Tests drive the state machine by calling these directly with plain objects shaped like `MouseEvent`/`KeyboardEvent` — no jsdom needed.

- LMB click on unit replaces selection with that unit.
- LMB click on empty clears selection.
- LMB drag on N own units selects all N.
- LMB drag with own + enemy in box selects only own.
- LMB drag with only enemies in box selects the closest single enemy.
- Shift+LMB click toggles unit in/out of selection.
- Shift+LMB drag adds own-team units to selection.
- Ctrl+LMB click selects all of same kind in viewport on the clicked team.
- Two LMB clicks on the same id within 300 ms behave like Ctrl+click.
- RMB on enemy issues `attack` to all selected units.
- RMB on empty issues `move` to all selected units.
- Shift+RMB appends instead of replacing.
- `A` then LMB issues `attack-move`; cursor mode returns to normal.
- `A` then RMB cancels mode without issuing an order.
- `Esc` in attack-move mode returns to normal without clearing selection.
- `Esc` in normal mode clears selection.
- `Ctrl+1` assigns; `1` recalls; `Shift+1` merges.
- Mousedown on element inside `overlayRoot` is ignored by the controller.
- Recall of a control group filters out dead entities.

### `commands.test.ts` (NEW)

- `issueMove(replace)` overwrites prior queue.
- `issueMove(queue)` appends to existing queue.
- `issueAttack` sets `attack` order with given `targetId`.
- `issueStop` clears queue.

### `orders-system.test.ts` (extended)

- Active `move` order completes → front is shifted; next order in queue becomes active.
- Empty queue after shift → entry removed from `orderQueue`.

## Migration / Rollout

This change replaces the existing selection wiring atomically. There is no feature flag; the old code path is removed in the same change set. The user controls commit boundaries (per global CLAUDE.md), so the work will land as a sequence of focused commits authored by the user from subagent output.

## Open Decisions Resolved (for the record)

- Marquee fallback to single enemy when only enemies in box: **yes** (SC2 rule).
- Double-click and Ctrl+click both ship and are equivalent: **yes**.
- Same-kind selection scope: **viewport only**, not whole map.
- `Hold` order: **deferred** (≈ Stop until combat).
- Controller is a new module, not enriched inline in main.ts: **yes**.
- Order queue model: **`Map<id, Order[]>`** (front = active).
- Player team constant: `PLAYER_TEAM = 0` exported from `src/sim/player.ts`.
