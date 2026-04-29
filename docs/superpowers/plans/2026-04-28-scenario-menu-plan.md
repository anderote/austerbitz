# Scenario Menu + Skirmish Defense — Implementation Plan

Spec: `docs/superpowers/specs/2026-04-28-scenario-menu-design.md`

## Phase 1 — Routing scaffolding

### 1.1 Add `line-battles.html`

New file at repo root, copied from existing `index.html` (same canvas/ui-root
markup, same `<script>` tag pointing at `/src/main.ts`). Title: `Austerblitz —
Line Battles`.

### 1.2 Rewrite `index.html` as the menu

Strip the `<canvas>` and game script. New body: a centered `<main>` with a
title and a vertical column of `<a class="menu-button">` links to
`line-battles.html` and `skirmish.html`. Inline `<style>` block (no
external CSS dependency) using:
- Black background, white text, monospace font.
- Pixelated rendering (`image-rendering: pixelated` on the page body is
  irrelevant for text; keep it just for visual consistency).
- Hard-edged buttons: `border: 2px solid #fff`, no rounded corners, large
  padding, `text-decoration: none`, hover state inverts fg/bg.

Two buttons in v1:
1. `Line Battles` → `line-battles.html`
2. `Skirmish Defense` → `skirmish.html`

### 1.3 Register entries in `vite.config.ts`

Add `lineBattles: resolve(__dirname, 'line-battles.html')` and
`skirmish: resolve(__dirname, 'skirmish.html')` to the existing
`rollupOptions.input` object. Keep `main: index.html` so the menu still
ships at `/`.

### 1.4 Add `skirmish.html`

Mirrors `cannon-test.html`'s structure. Title: `Austerblitz — Skirmish
Defense`. Script tag points at `/src/skirmish/main.ts`. Includes the
standard `#game` canvas, `#ui-root`, and the same `.lab-*` styling block
(copied verbatim — the HUD will use those classes).

## Phase 2 — Skirmish scene module

### 2.1 `src/skirmish/scene.ts`

Exports:
- `MAP_W = 600`, `MAP_H = 300`
- `LANE_Y = 100` — enemy marching y-coordinate
- `CANNON_X = 300`, `CANNON_Y = 220` (lane y + 120)
- `CANNON_SPACING = 6`
- `SPAWN_INTERVAL_S = 12`
- `BLOCK_FILES = 5`, `BLOCK_RANKS = 4`, `BLOCK_SPACING = 0.8`
- `SPAWN_X = 620`, `MARCH_TARGET_X = -20`, `DESPAWN_X = -10`

Functions:
- `spawnCannons(world, team)` — three cannon-12 entities centered at
  `(CANNON_X, CANNON_Y)` along the y-axis, facing west (facing index 4 —
  cannons need to fire north toward the lane; review facing during
  implementation: lane is *north* of cannons, so cannons should face
  index 6 (north). Verify against `getUnitKind('cannon-12')` and
  cannon-test conventions and pick the index that makes the cannon's
  forward vector point toward (0, -1) in world space).
- `spawnEnemyBlock(world, team)` — allocates `BLOCK_FILES * BLOCK_RANKS`
  line-infantry, lays them out at `(SPAWN_X, LANE_Y)` in a rectangle (5
  files × 4 ranks), facing **W**. Builds a march group with
  `forward = { x: -1, y: 0 }` and a per-unit `march-formation` order
  whose `targetX/targetY` is the unit's lane-aligned slot at
  `(MARCH_TARGET_X, LANE_Y)` (preserve lateral file offset). Returns the
  ids array and the `groupId` for cleanup.

Reuses the entity-spawning helper pattern from `cannon-test/scene.ts` —
factor out a private `spawnEntity(...)` local to this file rather than
shared, to keep the scenarios independent.

### 2.2 `src/skirmish/spawner.ts`

Small ticker. State: `{ accum: 0 }`. `tickSpawner(state, world, dt)` adds
`dt`; while `accum >= SPAWN_INTERVAL_S`, subtracts the interval and calls
`spawnEnemyBlock`. Spawns one block immediately on first tick (initialize
`accum = SPAWN_INTERVAL_S`).

### 2.3 `src/skirmish/despawn.ts`

`tickDespawn(world, counters)` walks `world.entities.aliveIds`, frees any
unit that is **alive, not dying/dead/ragdoll, on team 1, and at
`posX[id] < DESPAWN_X`**. Increments `counters.escaped` per freed unit.
Skips ragdolls so death animations finish.

### 2.4 Kill counter

The march system + projectile system already kill enemies via the regular
combat loop. Easiest detector: each frame, count team-1 entities whose
state is **`Dead` and have not yet been counted**. Track via a `Set<number>`
of already-counted ids (cheap because the set only grows during a run).
Increment `counters.kills` when an id transitions into `Dead` (or `Dying`
if we want earlier), then add it to the seen set so re-counting can't
happen. On reset, clear the set.

Alternative if simpler: count entities whose `state === Dead` minus
`counters.escaped` minus the despawn-while-ragdolling case. The set-based
approach is more direct; use it.

## Phase 3 — Skirmish entry point

### 3.1 `src/skirmish/main.ts`

Lift the structure from `src/main.ts` but:
- Replace `createDefaultMap()` with `{ size: { w: MAP_W, h: MAP_H }, features: [] }`.
- Reduce capacities: `CAPACITY = 4096`, `PARTICLE_CAPACITY = 30000`,
  `PUFF_CAPACITY = 16384`, `PROJECTILE_CAPACITY = 1024`.
- Remove the `spawnArmy` block; replace with `spawnCannons(world, 0)` and
  the spawner state.
- Keep all systems wired identically, **including** `marchSystem` (which is
  already first in the array — the enemy stream relies on it).
- Camera: `center = (CANNON_X, CANNON_Y - 40)`, `zoom = 8` (tight on the
  cannons but lane is in view).
- Wire the standard player-control stack (`selectionController`,
  `formationControlsPanel`, `selectionPanel`, `statsCard`, `placementInfo`,
  `movePreview`, `groupBadges`, etc.) so cannons are commandable. Drop the
  `buildMenu`, `controlGroupsPanel`, `minimap`, and `windIndicator` for v1
  to keep the HUD clean — cannons are a fixed roster, not buildable.

### 3.2 Frame loop additions

After `tickWorld(world, dt)`:
1. `tickSpawner(spawnerState, world, dt)`.
2. `tickDespawn(world, counters)`.
3. Update HUD with current counters and live enemy count.

`R` keydown: call `resetScene()` which frees all alive entities, clears
projectiles/particles/marchGroups/orderQueue, zeros counters, and
re-spawns cannons. Pattern adapted from `cannon-test/main.ts`'s
`resetScene`, plus `world.marchGroups.clear()` and `world.orderQueue.clear()`.

### 3.3 `src/skirmish/hud.ts`

Adapt from `src/cannon-test/hud.ts`. Counters: FPS, kills, escaped,
in-play (live team-1 count), projectiles, particles. One reset button.

## Phase 4 — Tests

### 4.1 `src/skirmish/spawner.test.ts`

- Spawns one block on first tick (initial accum = interval).
- Spawns again after exactly `SPAWN_INTERVAL_S` more sim-seconds.
- Doesn't spawn before that.

### 4.2 `src/skirmish/despawn.test.ts`

- Frees a team-1 unit at `posX < DESPAWN_X` and increments escaped count.
- Does **not** free a team-0 unit (cannon would never reach the lane, but
  guard anyway).
- Does **not** free a unit currently in `Ragdoll` state.

### 4.3 `src/skirmish/scene.test.ts`

- `spawnCannons` produces 3 entities of kind `cannon-12`, team 0, at
  expected coords.
- `spawnEnemyBlock` produces `FILES * RANKS` entities, all team 1, kind
  `line-infantry`, all enrolled in the same march group, all with a
  `march-formation` head order pointing west.

These follow the test conventions in
`src/cannon-test/`-style sibling tests (where they exist) and the
broader repo style (`vitest`, no DOM, sim-only).

## Phase 5 — Verify

- `npm run typecheck`
- `npm run test` (existing tests must still pass; new tests must pass)
- `npm run build` (confirms all 3 + 2 = 5 entry points roll up cleanly)
- Manual smoke: `npm run dev`, load `/`, click each link, confirm both
  scenarios load and behave as designed.

## Out of scope for this plan

- Visual polish on the menu (custom font, pixel-art logo). Plain text +
  borders is fine for v1.
- Persistent high score, settings, or save state.
- Wave / round structure for skirmish.
- Returning from a scenario back to the menu in-app (the browser back
  button covers it).
