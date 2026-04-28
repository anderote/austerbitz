# Formation march (Ctrl + RMB)

**Date:** 2026-04-27
**Status:** Approved (pending spec review)

## Goal

Add a "march in formation" command, bound to **Ctrl + Right-click**, that:

1. Preserves the selection's current formation (rank/file structure derived from
   the existing `formationParams`).
2. Pivots the formation in one motion to face the click point and translates
   toward it at a reduced "march" speed.
3. Periodically halts the entire group to fire a coordinated volley when an
   enemy is in range, then resumes marching.

This is the formation-aware counterpart to the existing per-unit `attack-move`
stub. The two coexist; this spec does not modify attack-move semantics.

## Scope

In:
- New input binding: **Ctrl + RMB up** on terrain with a non-empty selection
  issues a march-formation order to the click point.
- New per-tick concept: a **march group** that owns a set of unit ids and a
  shared phase (`march` | `volley`).
- New `Order` variant: `march-formation` carrying the unit's slot destination
  plus its `groupId`.
- New `march-system` that flips group phases based on enemy proximity and a
  fixed volley duration.
- Orders-system extension to handle the new order kind.
- Slot computation that pivots the current formation around its centroid to
  face the click point, then translates so the centroid lands on the target,
  with Hungarian assignment to minimize crossings.
- Tests for dispatch, group lifecycle, phase transitions, and orders-system
  handling.

Out:
- Ctrl + RMB **drag** (custom frontage during march): falls through to normal
  RMB-drag formation behavior. Can be added later without breaking this spec.
- Replacing or merging with `attack-move`: untouched.
- Cancel-on-fire / "fire-at-will" toggles: out.
- Speed equalization across mixed-kind groups: each unit marches at its own
  kind's march speed (mixed groups stretch slightly; volleys still trigger per
  group).
- New render passes / preview overlays for march path or volley state.
- Persisting march groups across save/load (no save/load exists yet).
- Visual cursor change while Ctrl is held.

## Binding

In `selection-controller.ts onMouseUp` for `e.button === 2`:

- If `e.ctrlKey || e.metaKey` and `selection.ids.size > 0` and not in
  `attack-move` mode and `formationDrag.active === false`: dispatch
  `issueMarchFormation(world, selection, worldPoint, formationParams)`. Emit
  the same `puff` feedback as ordinary RMB.
- All existing branches (RMB-drag, RMB on enemy, plain RMB) are unchanged.
- `Ctrl + RMB on enemy unit`: treat the same as Ctrl + RMB on terrain at the
  enemy's position. The enemy gets engaged when a volley fires; we don't issue
  an `attack` order. (Avoids two-paths-into-combat ambiguity for v1.)

Reachable in `onMouseUp`'s `button === 2` block before the `formationDrag` and
`hitTestPoint` checks. Specifically: when the user *just clicked* (no drag) and
holds Ctrl, take the march path. When dragging, fall through to the existing
formation-drag commit.

## Speed

```ts
// src/sim/systems/march-system.ts (or shared constant)
export const MARCH_SPEED_FACTOR = 0.6;
```

Each unit's march velocity = `kind.baseStats.moveSpeed * MARCH_SPEED_FACTOR`.

For reference:
- Line infantry: 2.5 → 1.5 m/s.
- Cuirassier: 7.5 → 4.5 m/s.
- Cannon-12: 1.2 → 0.72 m/s.

## March group state

New module `src/sim/march-groups.ts`:

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
): MarchGroup;

/** Removes id from the group's members set; returns true if the group is now empty. */
export function removeMarchGroupMember(g: MarchGroup, id: number): boolean;
```

Storage on `World` (in `src/sim/world.ts`):

```ts
marchGroups: Map<number, MarchGroup>;   // gid -> group
nextMarchGroupId: number;               // monotonic
```

Initialized to `new Map()` and `1` (so 0 is never a valid groupId — eases
debugging / sentinels).

## Order kind

Extend the `Order` union in `src/sim/world.ts`:

```ts
| {
    kind: 'march-formation';
    targetX: number;          // unit's slot, not group target
    targetY: number;
    groupId: number;
    arrived?: boolean;        // mirrors 'move' arrival flag
  }
```

`targetX, targetY` is the unit's per-slot destination. Per-unit storage means
orders-system stays dumb — it just walks toward the slot. Group state only
governs phase.

## Slot computation

Mirrors `syntheticFormationDrag` from the formation-controls spec
(`docs/superpowers/specs/2026-04-27-formation-controls-design.md` § Re-form in
place), but anchored at the click point rather than the current centroid:

1. Centroid `C` of live selected units (`liveFormationUnits()` from
   `selection-controller.ts` — already factored out in formation-controls; if
   not yet lifted, lift it as part of that work).
2. `forward = normalize(T − C)`. If `|T − C| < eps`, fall back to the
   selection's average `restFacing` (same helper as `issueReformInPlace`).
3. Build a synthetic `(startW, endW)` pair perpendicular to `forward`,
   centered at the **target** `T` (not at `C`). The midpoint of the synthetic
   drag is `T`; the drag direction is `(-forward.y, forward.x)`; length is
   chosen so all units fit at the requested frontage.
4. Call `computeFormationSlots({ units, startW, endW, spacingMult, ranksOverride })`
   passing the controller's current `formationParams`.
5. Hungarian-assign units → slots via `assignFormationSlots`.

The "swing around" effect is emergent: a unit on the far side of the pivot
travels further than a unit near the new front. With everyone at march speed,
the formation appears to wheel and march in one continuous motion. No
separate "pivot phase" is needed.

## Dispatch — `issueMarchFormation` in `commands.ts`

```ts
export function issueMarchFormation(
  world: World,
  sel: Selection,
  target: Vec2,
  formationParams: FormationParams,
): void;
```

Internally:

1. Build live formation units. If empty → return.
2. Compute slots + assignment as above.
3. Allocate `gid = world.nextMarchGroupId++`.
4. `world.marchGroups.set(gid, createMarchGroup(gid, ids, forward, world.simTime))`.
5. For each unit, **first** remove the unit from any prior march group (if
   `prevOrder.kind === 'march-formation'`, look up `prevOrder.groupId`, call
   `removeMarchGroupMember`, delete the group from the map if it became empty).
   This keeps groupId bookkeeping correct when one Ctrl+RMB replaces another.
6. Replace the unit's order queue with `[{ kind: 'march-formation', targetX,
   targetY, groupId: gid, arrived: false }]`.

Never queues. Per-leg queueing is what the user gets by Ctrl+RMB-clicking
again.

## Orders-system handling for `march-formation`

In `src/sim/systems/orders-system.ts`, alongside the `move` / `attack-move`
branch (which it closely mirrors):

```ts
if (order.kind === 'march-formation') {
  const group = world.marchGroups.get(order.groupId);
  if (!group) {
    // Group was dissolved out from under us (e.g., last member removed by
    // another path). Drop the order and idle.
    queue.shift();
    if (queue.length === 0) world.orderQueue.delete(id);
    e.velX[id] = 0;
    e.velY[id] = 0;
    continue;
  }

  if (group.phase === 'volley') {
    // Stand still; face the group's locked forward.
    e.velX[id] = 0;
    e.velY[id] = 0;
    writeFacingIntent(e, id, group.forward.x, group.forward.y);
    continue;
  }

  // phase === 'march' — same arrival/march logic as 'move' but at march speed.
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
      removeMarchGroupMember(group, id);
      if (group.members.size === 0) world.marchGroups.delete(order.groupId);
    } else {
      order.arrived = true;
    }
    continue;
  }

  const baseSpeed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed;
  const speed = baseSpeed * MARCH_SPEED_FACTOR;
  // Recovery drift behavior identical to 'move' branch when arrived === true.
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
  } else {
    e.velX[id] = (dx / dist) * speed;
    e.velY[id] = (dy / dist) * speed;
  }
  writeFacingIntent(e, id, dx, dy);
  continue;
}
```

When an order is replaced for a march-formation member by a different command
path (e.g., the player issues a plain RMB or `S`), the unit's old order is
overwritten in `orderQueue`. The march group still references the unit until
the next time orders-system or march-system iterates it. Cleanup:

- Add a guard at the **top of the orders-system per-id loop**: if the unit's
  current order's kind has changed away from `march-formation` since last
  tick, remove it from the previously-referenced group. We don't have
  per-id memory to detect this without tracking. Simpler: handle cleanup
  inside `march-system` (below) by checking each group's members against
  their current order's kind and groupId.

## March-system (new)

`src/sim/systems/march-system.ts`. Runs **after** `ordersSystem` and
**before** `combatSystem` so phase changes are visible to combat the same tick.

```ts
import type { System } from '../world';
import { gridQueryRect } from '../spatial/grid';
import { getUnitKindByIndex } from '../../data/units';
import { EntityState } from '../entities';

const VOLLEY_DURATION = 4.0;       // sim seconds
const MARCH_SCAN_PERIOD = 8;        // ticks between enemy scans per group
const candidateBuf = new Int32Array(2048);

export const marchSystem: System = (world, _dt) => {
  const e = world.entities;

  for (const [gid, group] of world.marchGroups) {
    // 1. Filter members: dead, or current order no longer references this group.
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

    // phase === 'march' — check volley trigger every SCAN_PERIOD ticks (striped by gid).
    if ((world.tickCount + gid) % MARCH_SCAN_PERIOD !== 0) continue;

    // Compute group bbox + max weapon range, then a single grid query.
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

    // 3. Volley triggers when at least one ready shooter has at least one
    //    eligible enemy within its own weaponRange.
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

Re-trigger throttling falls out for free: the next volley requires a member
with `reloadT == 0`, which only happens 18 s after the last shot for muskets.

## main.ts wiring

In the system list:

```
ordersSystem → marchSystem → combatSystem → movementSystem → ...
```

`marchSystem` runs after `ordersSystem` (so per-id velocities have been
written this tick) and before `combatSystem` (so phase=volley → vel=0 is
visible when combat decides whether to fire).

Wait — orders-system writes velocity from `march-formation` orders by reading
the *current* group phase. So march-system needs to update the phase
**before** orders-system, or orders-system uses last tick's phase. Order:

```
marchSystem (phase update) → ordersSystem (uses fresh phase) → combatSystem → movementSystem → ...
```

This is the correct ordering. Update the spec's previous "after ordersSystem"
line accordingly: **march-system runs before orders-system**.

## Edge cases

1. **Group with no shooters** (e.g., pure cuirassier): volley never triggers,
   group simply marches. Fine.
2. **Cannon at march speed (0.72 m/s)**: combat-system's velocity gate is
   `1 m/s` so cannon can fire while marching. Group volley logic still works,
   but cannons may also fire mid-march independently. Acceptable for v1.
3. **Mixed-kind group**: each unit at its own kind's march speed. Group
   stretches; volley still triggers from any ready shooter. Acceptable.
4. **Last member of group dies/leaves mid-volley**: march-system filters
   members at top of loop, deletes empty group, no further transitions.
5. **Re-issuing Ctrl+RMB on the same group's members**: dispatch step 5 above
   removes them from the old group, allocates a new group. Old group dies if
   it becomes empty.
6. **Order replaced by plain RMB / Stop / Regroup**: march-system detects on
   its next tick that the unit's head order no longer references the group,
   removes the member.
7. **`group.forward` locked at issue time**: if the group drifts laterally
   from its target during march, the volley facing stays as set. Prevents
   twitchy facing changes. (If the user wants a different facing, they re-issue.)
8. **`groupId` stale after group deletion**: orders-system handles a missing
   group by shifting the order off and idling the unit (see above).
9. **Selection contains units already in another march group**: same as #5 —
   the dispatch removes them from prior groups before creating the new one.
10. **Esc / Stop / Backspace cancellation**: `issueStop` clears the queue;
    march-system removes the member on its next pass. No special path needed.
11. **Window blur mid-Ctrl-press**: controller already resets `pendingClickStart`
    on blur. The Ctrl modifier is only read at mouseup, so a stale Ctrl
    state isn't an issue.
12. **All members arrived at slots**: the group is **not** dissolved. Arrived
    members keep their `march-formation` order parked at slot
    (`arrived: true`), so march-system continues to manage them and volleys
    still trigger at the destination. This gives the player a "march to
    point and hold there, firing as needed" idiom for free. The group only
    dissolves when its last live member's order is replaced or the unit dies.

## Testing

`commands.test.ts` (extend):
- `issueMarchFormation` with empty selection is a no-op.
- `issueMarchFormation` populates `marchGroups` with one new entry whose
  members match the live selected ids.
- Each member's order is `{ kind: 'march-formation', groupId: gid, ... }`.
- Re-issuing on the same selection removes the prior group entry and creates
  a new one (`marchGroups.size === 1` after the second issue).
- `issueMarchFormation` then `issueMove` on the same selection: orders are
  replaced; the prior group is **not** auto-removed by `issueMove` (cleanup
  happens in march-system on the next tick — verify by ticking once and
  observing the group is gone).

`march-groups.test.ts` (new):
- `createMarchGroup` initializes phase=march, phaseStartT, forward.
- `removeMarchGroupMember` returns true when the set becomes empty.

`march-system.test.ts` (new):
- Group with no enemies in range stays in `march` phase indefinitely.
- Group with a reloaded armed member and an enemy in range transitions to
  `volley` (verify `phase === 'volley'`, `phaseStartT === simTime`).
- After `VOLLEY_DURATION` sim seconds, phase returns to `march`.
- Group with all members dead is deleted from `world.marchGroups`.
- Group whose members' orders no longer reference it (replaced by `move`)
  loses those members and is deleted when empty.
- Volley does NOT trigger if all candidate shooters are still reloading
  (`reloadT > 0`).
- Striping: a group's enemy scan only runs on `(tick + gid) % SCAN_PERIOD === 0`;
  off-stripe ticks don't trigger a transition even with an enemy in range.

`orders-system.test.ts` (extend):
- `march-formation` order with group phase=`march` writes velocity at
  `baseSpeed * MARCH_SPEED_FACTOR` toward the slot.
- Same order with group phase=`volley` writes zero velocity and a facingIntent
  toward `group.forward`.
- Arrival within `ARRIVE_RADIUS` parks the unit (sets `restPos*`, `restFacing`),
  flips `arrived = true`, and removes the member from the group **only when
  the queue advances** (i.e., when there's a follow-on order). Solo arrived
  order: member stays in group, idle at slot.
- Missing group (deleted) → order shifted off, velocity zeroed.

`selection-controller.test.ts` (extend):
- `Ctrl + RMB up` with a non-empty selection on terrain dispatches a march
  (verify `marchGroups.size === 1` after the event).
- `Ctrl + RMB up` with empty selection is a no-op.
- `Ctrl + Shift + RMB up`: behaves the same as plain `Ctrl + RMB`. Shift is
  ignored for this binding (no queueing of marches in v1).
- `Ctrl + RMB up` while in `attack-move` mode: ignored (existing attack-move
  branch wins).
- `Ctrl + RMB up` during a formation drag: ignored (drag commit wins).

## Manual verification

1. `npm run dev`. Load the page; both armies in their starting positions.
2. Drag-select the friendly army.
3. Ctrl + RMB on a point ~150 m away **off-axis** (e.g., 90° to the army's
   current facing). Confirm:
   - The formation pivots smoothly toward the click direction as it begins
     marching (units near the new front move less, units across the line move
     more — emergent "wheel" motion).
   - Pace is visibly slower than a plain RMB move.
4. Issue Ctrl + RMB toward the enemy line. As the front rank crosses ~80 m
   range:
   - The whole group halts.
   - Front rank fires a volley (muzzle flash + smoke + projectiles).
   - After ~4 s, the group resumes marching.
   - Reload countdown elapses (~18 s); next halt occurs.
5. During a march, plain RMB to a different point: the march cancels; units
   move to the new point at full speed (no formation, no volley).
6. During a march, press `S` (Backspace): units halt; the group dissolves on
   the next tick.
7. Two separate selections issued separately: each gets its own group; volleys
   trigger independently.

## Files touched

New:
- `src/sim/march-groups.ts`
- `src/sim/march-groups.test.ts`
- `src/sim/systems/march-system.ts`
- `src/sim/systems/march-system.test.ts`

Modified:
- `src/sim/world.ts` — extend `Order` union with `march-formation`; add
  `marchGroups: Map<number, MarchGroup>`, `nextMarchGroupId: number`;
  initialize in `createWorld`.
- `src/sim/systems/orders-system.ts` — handle `march-formation` order kind.
- `src/sim/systems/orders-system.test.ts` — new tests per above.
- `src/input/commands.ts` — add `issueMarchFormation`. Reuses
  `liveFormationUnits` (lifted by formation-controls work) and
  `syntheticFormationDrag` patterns.
- `src/input/commands.test.ts` — new tests per above.
- `src/input/selection-controller.ts` — Ctrl+RMB-up branch in `onMouseUp`.
- `src/input/selection-controller.test.ts` — new tests per above.
- `src/main.ts` — register `marchSystem` between selection of pre-orders and
  `ordersSystem` (see ordering note in march-system section).

## Open risks

- **Slot-computation duplication with `issueReformInPlace`**: both build a
  synthetic drag and Hungarian-assign. Once the formation-controls spec lands,
  factor a shared helper (`pivotedFormationSlots(units, anchor, forwardW,
  formationParams)`) used by both. If formation-controls hasn't landed when
  this work begins, duplicate the code locally and leave a TODO to dedupe.
  Same dependency for the `averageFacing` helper used as the fallback when
  `|T − C|` is sub-eps.
- **Stretching in mixed-kind groups**: cannon + cavalry + infantry will pull
  apart at different speeds. v1 ships with this; if it becomes annoying we
  can clamp the group to its slowest member's march speed.
- **Volley facing vs. enemy direction**: `group.forward` is the march
  direction, not the enemy direction. If enemies appear off-axis, units fire
  while facing forward (the existing combat-system uses the target's actual
  position for projectile origin/direction; only the visible facing is
  affected). Acceptable for v1.
- **No on-screen affordance for Ctrl modifier**: discoverability relies on
  documentation. Acceptable; can add a HUD hint later.
