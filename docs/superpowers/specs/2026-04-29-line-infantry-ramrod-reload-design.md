# Line Infantry — Plunging Ramrod Reload Animation

**Date:** 2026-04-29
**Status:** Approved (design-level), proceeding to implementation

## Problem

Line infantry currently snap directly between aiming/firing/idle visuals during the reload cycle. The Reloading state lasts ~10s but produces no animated visual — players cannot tell at a glance whether a unit is reloading vs. idle. We want a clearly readable "this man is loading his musket" cue without authoring 30+ multi-frame sprites.

## Non-goals

- Not a faithful 12-step manual-of-arms reload (cast about, prime, return ramrod, etc.). Stylized visual abstraction is the goal.
- No body-pose animation (arms pumping, head down). Body keeps the existing single-frame `make-ready` sprite for the duration of reloading.
- No new audio. No smoke/particle effects.
- No effect on sim — `reloadT`, accuracy, damage, weapon-state are all unchanged.
- No other unit kinds. Cuirassier and gun-crew are out of scope (cuirassier has no reload-state body pose authored; gun-crew Phase 2 has its own animation system).

## Visual concept

While a line-infantry soldier is in `EntityState.Reloading`:

1. Body holds the existing `make-ready` pose (rifle tipped forward across the body — already authored).
2. A thin steel **ramrod** appears anchored above the rifle's barrel mouth.
3. The ramrod plunges down into the barrel and back up rapidly — **4 plunge cycles** spread across the soldier's reload duration.
4. Motion uses an eased curve (`(1 - cos)/2`) so the ramrod doesn't tick uniformly — it dips, holds at the bottom briefly, and lifts.
5. Y-position is **snapped to integer source pixels** so the motion stays crisp (per the project's pixel-art aesthetic memory).
6. Ramrod is hidden in every other state — emit only when `e.state[i] === EntityState.Reloading` AND the soldier kit specifies a ramrod anchor.

## Architecture

### Data flow

```
state-system.ts (existing) → sets state=Reloading, reloadT, reloadInitialT
sprite-pass.ts             → for each entity, if state=Reloading, emit one ramrod instance
                             with a UV that points at a 1×N steel block in the atlas
                             and a Y-offset computed from reloadT/reloadInitialT
```

No sim changes. All inputs already exist.

### Atlas

The ramrod sprite is **one steel-colored pixel column**, packed as a 1×5 px sub-region appended to the bottom of the combined atlas. Procedurally generated (matches `british-soldier-sprite.ts` style — palette `'g'` color `(180, 188, 200, 255)`).

A new module `src/render/ramrod-sprite.ts` exports:

- `RAMROD_SHEET_W = 1`, `RAMROD_SHEET_H = 5`
- `generateRamrodSheet(): Uint8Array` — single column of opaque steel pixels
- A `RAMROD` entry added to `KIND_ATLAS` (or a sibling `RAMROD_REGION` constant) with the y-offset where it lives in the combined sheet

`generateCombinedAtlas` is extended to blit the ramrod sheet at the bottom; `COMBINED_SHEET_H` grows by `RAMROD_SHEET_H`.

### Per-facing anchor table

The ramrod's resting position depends on the soldier's facing — for a south-facing soldier (front view) the rifle is tipped forward to the soldier's right, so the ramrod hovers above-right of the body's torso. For other facings the anchor mirrors / shifts.

Anchor offsets are authored by hand once, in source-pixel units relative to the body sprite center, indexed by runtime facing 0..7 (`E, SE, S, SW, W, NW, N, NE`):

```ts
// (x, y) in source-cell pixels (32-cell coords). Positive y = downward.
const RAMROD_ANCHOR_PX_BY_FACING: ReadonlyArray<readonly [number, number]> = [
  [+5,  -5], // E
  [+5,  -5], // SE
  [+4,  -5], // S
  [-4,  -5], // SW
  [-5,  -5], // W
  [-5,  -7], // NW
  [+0,  -7], // N
  [+5,  -7], // NE
];
```

These constants live at the top of the new emitter (`reload-ramrod.ts` or as constants in `sprite-pass.ts` next to the existing `WEAPON_BOB_*` constants). They are **tunable visuals** — the design accepts that a few iteration passes may be needed once it renders. **The numeric values above are placeholders to be eyeballed at runtime; actual values will be picked by visual inspection of the running game.**

### Plunge curve

```ts
const RAMROD_PLUNGE_CYCLES = 4;
const RAMROD_PLUNGE_DEPTH_PX = 5; // peak-to-peak motion in source pixels

const progress = initial > 0 ? 1 - reloadT / initial : 0; // 0..1
const phase = (progress * RAMROD_PLUNGE_CYCLES) % 1;       // sawtooth 0→1, 0→1, ...
const eased = (1 - Math.cos(phase * 2 * Math.PI)) * 0.5;   // 0→1→0 per cycle
const plungePx = Math.round(eased * RAMROD_PLUNGE_DEPTH_PX);
```

`plungePx` adds to the anchor's Y (positive = downward), so the ramrod descends into the barrel and rises back. Snapping with `Math.round` is required for crisp pixel-art motion (per memory).

### Render-pass integration

The existing weapon-overlay path (sprite-pass.ts:709–816) emits one weapon instance per soldier per frame, into either the `scratchWeaponPos[]` (front) or `scratchWeaponBehindPos[]` (behind) instance group, then issues a `drawArraysInstanced` with the same shader as the body.

The ramrod emission is **a third instance group, parallel and independent**:

- `scratchRamrodPos[]`, `scratchRamrodSize[]`, `scratchRamrodUv[]`, etc. (sized to `capacity`).
- One emission per entity satisfying: `kind.id === 'line-infantry' && state === EntityState.Reloading`.
- UV: the 1×5 atlas cell from `RAMROD_REGION`.
- Z-order: rendered AFTER bodies, BEFORE the front-weapon group (visually, the ramrod is "in" the rifle barrel; if the rifle overlay covers the barrel, the ramrod should still poke out the top — front-of-body, not behind). For simplicity it's drawn **just before the existing front-weapon group**, so any rifle overlay drawn after will correctly cover the lower portion of the ramrod where it disappears into the barrel.
- Color: white passthrough (color buffer = `[1,1,1,1]`), so the steel pixels in the atlas come through directly. No team tint.

### Why the line-infantry ID gate

Other infantry kinds don't have a `make-ready` body pose with a forward-tipped rifle and don't carry ramrods (cavalry don't reload mid-saddle in our timeframe; gun-crew use rammers). Hard-coding the kind id here is acceptable — when a second ramrod-using kind is added, this gate becomes a `kind.usesRamrod === true` flag on `UnitKind`. We're not adding the flag now (YAGNI).

## Tests

1. **`ramrod-sprite.test.ts`** — `generateRamrodSheet()` returns a `1×5×4` buffer with all 5 pixels at the steel color and full alpha.
2. **`reload-ramrod-curve.test.ts`** — pure function `ramrodPlungePx(progress)`:
   - `progress=0` → 0
   - `progress=1` → 0 (cycle complete)
   - `progress=1/(2*CYCLES)` → max depth (first plunge bottom)
   - Output is an integer for any input in [0, 1].
3. **`sprite-atlas.test.ts`** (existing) — assertion that `COMBINED_SHEET_H` includes the ramrod region; ramrod region pixels are non-zero.
4. **No render-time test for the emission gate** — sprite-pass currently has no test harness; emission correctness will be verified by running the game in a browser (per the CLAUDE.md UI-testing rule, dev server + visual check is the verification step for render changes).

## Tunable knobs (final)

```ts
RAMROD_PLUNGE_CYCLES        = 4    // visible up-down cycles per reload
RAMROD_PLUNGE_DEPTH_PX      = 5    // peak-to-peak Y motion in source pixels
RAMROD_LENGTH_PX            = 5    // sprite height (= sheet height)
RAMROD_ANCHOR_PX_BY_FACING  = [..] // resting offset per facing
```

## Out-of-scope iterations (Phase 2 ideas, not now)

- Multi-frame body poses showing arm motion during reload.
- Smoke puff at firing → reloading transition.
- Cartridge-bite frame at start of reload.
- Per-veterancy-tier reload-speed visual (faster plunges for veterans).
