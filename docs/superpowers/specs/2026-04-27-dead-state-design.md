# Dead State — Design

## Goal

When an entity runs out of HP it eventually reaches `EntityState.Dying` (and then `EntityState.Dead`). From the player's point of view that entity is a corpse: it should be invisible to selection, immune to firing-range previews, refuse to execute orders, refuse to move under collision pushes, and render its `Pose.dead` sprite if available. Selected units that die mid-selection are dropped from the selection set.

The state machinery already exists; this spec closes the gaps where systems still treat `Dying`/`Dead` as a normal alive entity because their guard is `alive[id] === 1` rather than something stronger.

## Out of scope

- **Ragdoll.** Ragdoll units may still recover (`ragdoll-system.ts:34` puts them back in `Idle` if HP > 0 once they settle). They keep current behavior and are not "dead". A ragdoll with HP = 0 transitions to `Dying` on settle (`ragdoll-system.ts:31`), at which point all of the new filters take effect.
- **Cleanup / freeing entities.** The `Dying → Dead` state transition already runs in `tickStates`. Entities are not `freeEntity`'d in this change — corpses persist as-is on the field.
- **Order processing while ragdolling.** Pre-existing concern (orders-system reassigns velocity for ragdolling units); not addressed here.

## Canonical predicate

Add `isDead(e, id): boolean` to `src/sim/entities.ts`, returning true iff `state === Dying || state === Dead`. Single source of truth; every gap below uses it.

## Behavior table

| Surface | Current guard | New guard |
|---|---|---|
| `hitTestPoint` / `hitTestRect` / `findSameKindInView` (selection.ts) | `alive` | `alive && !isDead` |
| `liveFormationUnits` (selection-controller.ts) | `alive` | `alive && !isDead` |
| Group recall (Shift+digit, plain digit) | `alive` | `alive && !isDead` |
| Selection auto-prune each frame | — | drop `selection.ids` entries that are dead |
| `drawDiscs` (green/yellow base discs) | `alive` | `alive && !isDead` |
| `drawTeamRange` selected-id collection | `alive` | `alive && !isDead` |
| `collectTeamRangeIds` | `alive` | `alive && !isDead` |
| `computeRangeOverlay` per-id loop | `alive` | `alive && !isDead` |
| `drawMovePreview` (selected + unselected) | `alive` | `alive && !isDead` |
| `ordersSystem` main per-id loop | `alive` | `alive && !isDead` (skip processing; queue stays so a sibling-recovery path could resume orders, but in practice Dying never recovers) |
| `movementSystem` velocity integration | `alive` | `alive && !isDead` |

## Sprite

`Pose.dead` is already mapped from `EntityState.Dead` in `state-system.ts:20`. Verify the runtime pose manifest contains a `dead` cell. If a kind lacks a `dead` cell, the existing pose-pass fallback handles it; no code changes there.

## Test plan

Extend the existing test files (TDD: red → green per gap):

- `selection.test.ts` (new or extend if present): `hitTestPoint` / `hitTestRect` / `findSameKindInView` skip a unit in `Dying` and `Dead`.
- `selection-controller.test.ts` (extend): `liveFormationUnits` skips dying/dead; group recall skips dying/dead.
- `orders-system.test.ts` (extend or add): a unit transitioning to `Dying` mid-march does not advance its move order; velocity stays zero; queue is left in place.
- `movement-system.test.ts` (extend or add): a unit in `Dying` with non-zero velocity is not integrated into a position change.
- `selection-pass.test.ts` (only if one exists; otherwise rely on visual + integration coverage).

The existing combat-system test `skips enemies in Dying / Dead / Ragdoll` already covers target acquisition.

## Implementation order

1. `isDead` helper.
2. Selection (hit-tests + controller).
3. Selection auto-prune.
4. Selection-pass overlays.
5. Orders-system gate.
6. Movement-system gate.
7. Verify pose manifest has dead frames; visual smoke test in dev.
