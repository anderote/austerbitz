# Firing Mechanism Rework — Design

**Date:** 2026-04-28

## Problem

Two related issues with the current firing system:

1. **Diagonal-blocking bug.** Today's "front 3 ranks fire" rule builds a corridor from firer toward target, with a fixed 0.4 m lateral half-width. Line infantry rank spacing is 1.2 m. When firing on a diagonal, the friend in the rank directly ahead in formation has lateral offset relative to the target line that exceeds 0.4 m at any meaningful angle, so they aren't counted as a blocker. Rank 3 freely fires through ranks 1–2 on diagonals.

2. **No tactical control over fire.** All units fire autonomously with a single volley-contagion window. The player has no way to express "save the volley" or "rolling fire by rank."

## Goals

1. Fix rank-blocking so it works on every angle.
2. Introduce **four firing stances** issued per selection: At Will, Volley, By Ranks (default), Hold.
3. Make ranks fire as **independent groups** when the stance is By Ranks, by splitting the volley fire signal by rank.

## Non-Goals

- Persistent regiment/formation entities. Stance and rank live per-unit.
- Manual "Fire!" trigger or reserve-volley mechanics.
- Reload-rank-swap (front kneels, back fires over) — out of scope; the visual is achieved via rank 2 firing "over" rank 1, no animation special-case.
- Cannons (artillery). Cannons retain today's autonomous per-unit fire and ignore stance.

## Design Overview

The architecture is **per-unit fields, no new container** ("Approach A" from brainstorming):

- Each entity gains three new fields: `stance`, `formationRank`, `holdLoaded`.
- Rank is **inferred** lazily on the existing combat-system stripe tick from each unit's `restPos` and `restFacing`. `restFacing` defines the formation forward axis; rank-blocking and rank-keyed fire signal both use it.
- Stance is **per-unit** but always set selection-wide via UI, so a regiment behaves uniformly in practice.
- Fire signal is widened by a rank dimension; reads filter by own-rank when stance is By Ranks, any-rank otherwise.
- The blocking corridor's geometry is **replaced** by a direct rank check (`canFire = formationRank ≤ 1`), eliminating the diagonal bug structurally.

## Data Model

Three new fields on `Entities` (`src/sim/entities.ts`):

```ts
stance:        Uint8Array  // FireStance (0..3); default ByRanks (2)
formationRank: Uint8Array  // 0=front; 255=unknown/uninitialized
holdLoaded:    Uint8Array  // 1 = currently in Hold and has a loaded shot
```

```ts
export const FireStance = {
  AtWill:  0,
  Volley:  1,
  ByRanks: 2,
  Hold:    3,
} as const;
export type FireStance = (typeof FireStance)[keyof typeof FireStance];

export const FORMATION_RANK_UNKNOWN = 255;
export const MAX_TRACKED_RANKS = 3; // ranks 0,1,2; rank 2+ blocked from firing
```

`createEntities` allocates these arrays; `spawnEntity` initializes:
- `stance[id] = FireStance.ByRanks`
- `formationRank[id] = FORMATION_RANK_UNKNOWN`
- `holdLoaded[id] = 0`

### Fire signal

`src/sim/fire-signal.ts` gains a rank dimension:

```ts
// Index = (cellIndex * 2 + team) * MAX_TRACKED_RANKS + rank
tickByCellTeamRank: Int32Array;
```

API:

```ts
writeFireSignal(fs, grid, x, y, team, rank, tick): void
hasRecentFire(fs, grid, x, y, team, rank, tick, windowTicks): boolean
hasRecentFireAnyRank(fs, grid, x, y, team, tick, windowTicks): boolean
```

`writeFireSignal` clamps rank to `MAX_TRACKED_RANKS - 1` (rank 2+ all share the same slot — irrelevant since they don't fire).

## Algorithms

### Rank inference

Done on the existing `combat-system` stripe (`(tick + id) % SCAN_PERIOD === 0`), before the current target-acquisition step. For each unit `i`:

1. Convert `restFacing[i]` (0..7 octant) to a unit vector `(fx, fy)`.
2. `gridQueryRect` around `restPos[i]` at radius `2 × spacing.y` (per-kind value).
3. For each candidate `j` with `team[j] === team[i]`, `restFacing[j] === restFacing[i]`, and `j !== i`:
   - `dx = restPosX[j] - restPosX[i]`, `dy = restPosY[j] - restPosY[i]`
   - `fwd = dx*fx + dy*fy`
   - `lat = -dx*fy + dy*fx`
   - If `fwd > 0.5 × spacing.y` AND `|lat| ≤ 0.6 × spacing.x` → count as "rank ahead."
4. Distinct rank levels ahead = `floor((fwd - 0.5*spacing.y) / spacing.y) + 1`, taking the *minimum* across all qualifying neighbors. Save as `formationRank[i]`, capped at `min(254, MAX_TRACKED_RANKS - 1)` for indexing simplicity.
5. No qualifying neighbors → `formationRank[i] = 0`.

When a front-ranker dies, units behind recompute on their next stripe tick (≤ 8 ticks ≈ 130 ms at 60 Hz), unblocking responsively.

### Blocking decision

Replaces the existing forward-arc occlusion in `combat-system.ts`:

```ts
e.canFire[id] = e.formationRank[id]! <= 1 ? 1 : 0;
```

- Rank 0 (front) and rank 1 ("over the front rank's heads") fire.
- Rank 2+ blocked.

The lateral / forward / threshold constants and the per-tick AABB sweep are removed. The `FORWARD_RANKS_SLACK`, `FORWARD_NEAR`, `LATERAL_HALF`, `LATERAL_HALF_SQ`, `BLOCKING_THRESHOLD` constants are deleted.

### Stance behavior

Stance is read after `canFire` but before `triggerFire`:

| Stance | Fire condition | Aiming windup | maxHold range |
|---|---|---|---|
| **At Will** | `canFire && hasTarget && state===Idle` (no volley wait) | 0.15 s | n/a |
| **Volley** | `hasRecentFireAnyRank(...)` OR `stateT >= maxHold` | 0.40 s leader / 0 joiner | 0.5–2.0 s |
| **By Ranks** | `hasRecentFire(...own rank)` OR `stateT >= maxHold` | 0.25 s leader / 0 joiner | 0.3–1.2 s |
| **Hold** | never; on entering Idle with reload done, set `holdLoaded=1` and skip | n/a | n/a |

`maxHoldFor(id)` becomes `maxHoldFor(id, stance)` — same hash-derived deterministic spread, just into a stance-specific range.

`AIMING_WINDUP_S` becomes a stance-keyed lookup. Joiner windup is always 0.

A stance toggle from Hold → anything else with `holdLoaded[id]===1` lets the unit fire on its very next stripe tick (no reload needed); switching from anything → Hold lets the current shot resolve normally if already in Aiming.

### Reload

Unchanged. `effectiveReload(...) * rng.range(0.8, 1.2)` jitter still applies. Hold doesn't shorten or extend reload — once reloaded, the unit just sits in Idle with `holdLoaded=1`.

## UI

`src/ui/formation-controls-panel.ts` gains a stance row with four buttons: **At Will / Volley / By Ranks / Hold**.

- Click writes `stance[id]` for every alive selected unit.
- Highlight tracks the **modal** stance across the selection. If non-uniform, all four buttons render in a "mixed" muted style (or show a small "Mixed" badge) and the next click resolves to the chosen stance for everyone.
- No keyboard binding in v1.
- No per-unit stance glyph in the world view in v1.

## Tests

New / extended Vitest files:

1. **`src/sim/systems/formation-rank.test.ts`** *(new)*
   - Synthetic 5-wide × 3-deep regiment, axis-aligned: ranks 0/1/2 inferred correctly.
   - Same regiment rotated to 8 different `restFacing` octants: rank inference matches.
   - Diagonal regiment (off-axis `restFacing`): rank inference correct (regression vector for the bug).
   - Lone soldier: rank 0.
   - Mixed teams in same area: opposing-team neighbors don't contribute.

2. **`src/sim/fire-signal.test.ts`** *(extended)*
   - Rank-keyed write/read: rank-0 read does not see rank-1 signal.
   - `hasRecentFireAnyRank` returns true for any rank's signal.

3. **`src/sim/systems/combat-system.test.ts`** *(extended)*
   - Rank-2 unit with rank-0/1 same-team in front → `canFire = 0`.
   - Diagonal regiment, rank-2 unit → `canFire = 0` (regression).
   - Rank-0 unit, no friends ahead → `canFire = 1`.

4. **`src/sim/systems/combat-system.stance.test.ts`** *(new)*
   - **At Will:** unit fires alone immediately when target acquired and loaded; volley signal ignored.
   - **Volley:** unit holds until `maxHold`; another team-mate firing (any rank) triggers join.
   - **By Ranks:** unit only joins same-rank fires; rank-0 fires don't pull rank-1 in.
   - **Hold:** unit never fires; flipping to Volley lets the loaded unit fire on next tick without reload.

## Migration

- New fields are added with defaults; existing units initialize to `ByRanks`, `formationRank=255`, `holdLoaded=0` on the next entity reset/spawn.
- No save format exists yet; no migration code needed.
- Removed constants in `combat-system.ts` (`FORWARD_RANKS_SLACK`, `FORWARD_NEAR`, `LATERAL_HALF`, `LATERAL_HALF_SQ`, `BLOCKING_THRESHOLD`) — delete cleanly. The entity field `canFire` keeps its meaning (1 = clear forward arc), only its derivation changes.

## Out of Scope (Future Work)

- **Persistent regiment entity** with a regiment-level "fire by ranks" ticker. The current per-rank fire-signal achieves rolling fire emergently; promote to explicit ticker only if the emergent feel is too ragged.
- **Manual "Fire!" trigger / reserve volley.** Hold + stance flip covers most of the gameplay.
- **Visual stance indicator** above units in world view.
- **Stance for cannons.** They keep autonomous fire; if needed later, add a per-unit-kind `supportsStance` flag on `UnitKind`.
- **Animation:** rank 2 firing "over" rank 1 today uses the same firing pose as rank 0; if it looks wrong, a kneel pose for rank 0 is a separate art task.
