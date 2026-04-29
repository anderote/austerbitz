# Scenario Menu + Skirmish Defense Map — Design

Date: 2026-04-28

## Goal

Replace the implicit single-scenario entry point with an explicit **menu**
that lets the player pick between scenarios. Add a second scenario — a
**Skirmish Defense** map where a continuous stream of enemy infantry marches
across the map and the player commands three cannons positioned 120 m to the
south.

## Routing

Vite already builds multiple HTML entry points. We add two more and reshape `/`.

| URL                   | Purpose                                  |
|-----------------------|------------------------------------------|
| `/`                   | Menu page (new). Links to scenarios.     |
| `/line-battles.html`  | Existing main game, moved from `/`.      |
| `/skirmish.html`      | New: 3 cannons vs. continuous enemy stream. |
| `/cannon-test.html`   | Unchanged dev sandbox (not linked).      |
| `/lab.html`, `/components.html` | Unchanged dev tools.            |

`vite.config.ts`'s `rollupOptions.input` gets two new keys; nothing else in
the build pipeline changes.

## Menu page (`/`, `index.html`)

Static HTML — no game canvas, no `src/main.ts`. Plain page with a vertical
stack of large pixelated buttons, one per scenario, each an `<a href>` to
the scenario's URL.

- Black background, hard-edged borders, monospace label font.
- Buttons are anchors (`<a>`), not `<button>` elements — keeps it
  dependency-free, native back/forward navigation works automatically.
- No JS required. The script tag is dropped from this page.

Initial scenarios shown:
1. **Line Battles** → `line-battles.html`
2. **Skirmish Defense** → `skirmish.html`

## Skirmish Defense scenario

### Map

- 600 m × 300 m, landscape orientation.
- Enemy march lane runs along **y = 100** (north strip).
- Cannons sit at **y = 220** — 120 m due south of the lane.
- Camera initial center at the cannons; default zoom comparable to
  `cannon-test`.

### Cannons

- 3 × `cannon-12`, team 0, centered at `x = 300`, spaced ~6 m apart along
  the y-axis (matching `cannon-test`'s pattern).
- Player-controlled — same selection / manual-aim / fire UX as the main
  game. Wire the same `selectionController`, `formationControlsPanel`, and
  related panels used in `src/main.ts`.

### Enemy stream

- Spawner ticks every **12 sim-seconds**.
- Each spawn produces one block of `line-infantry`: **5 files × 4 ranks =
  20 men**, team 1, facing **W** (facing index 4).
- Block spawns at `x = 620, y = 100` (just east of the map edge).
- Block is enrolled in a **march group** with target `x = -20, y = 100` —
  reuses the existing `marchSystem`. The march system already handles
  volley behavior when in range, so the block will stop and shoot the
  cannons opportunistically (this is fine and adds flavor).
- A unit despawns (entity freed, counted as **escaped**) once it crosses
  `x = -10`.

### HUD

Reuse `cannon-test`'s HUD chrome. Replace its body with:
- FPS, projectiles, particles (existing counters).
- **Kills** — total enemy units the cannons have destroyed.
- **Escaped** — total enemy units that crossed off-screen west.
- **In play** — currently alive enemy units.
- Reset button + `R` hotkey: clears entities, projectiles, particles,
  resets the spawn timer and kill/escape counters.

### Lifecycle

Endless. No formal win/lose condition in this iteration. The
kills/escaped counters are the score; if we want defeat conditions (e.g.
"50 escapes = game over") we can layer that on later without changing the
architecture.

## File layout

```
index.html                     — menu page (rewrite)
line-battles.html              — main game entry (new, points at src/main.ts)
skirmish.html                  — new scenario entry

src/main.ts                    — unchanged (still the line-battles entry)
src/skirmish/
  main.ts                      — entry: GL/world init, system wiring, frame loop
  scene.ts                     — map dims, cannon spawn, enemy block spawner
  hud.ts                       — counters + reset button (cannon-test-derived)
```

The skirmish entry's frame loop is closer to `src/main.ts` than to
`src/cannon-test/main.ts` because we need the full player-control stack
(selection, formation controls, move preview, etc.). We'll lift the
relevant scaffolding from `src/main.ts` rather than the auto-fire-only
`cannon-test`. Where there is meaningful overlap (renderer construction,
particle/puff/projectile pool sizing) we accept some duplication for now —
extracting a shared "scenario host" can come later if a third scenario
proves the pattern.

## Risks / open items

- **Map size mismatch.** The renderer takes a `WorldMap` with `size.{w,h}`.
  Skirmish uses 600×300, not the default 2000×2000 — confirm renderer
  paths handle non-square maps. (`cannon-test` uses 300×300 successfully,
  so non-square should also work, but worth a quick sanity check during
  implementation.)
- **March system on small map.** The march group's target sits *outside*
  the map bounds (`x = -20`). The march system targets a point and units
  pursue it; nothing in `marchSystem` requires the target to be in-bounds.
  If anything balks, we can place the despawn line slightly inside the
  map and let the march target be `x = 0`.
- **Despawn timing.** Need to free entities cleanly without breaking
  ragdoll/death-drop systems. Plan: only despawn units in `Idle` /
  `Reloading` / `Marching` states (i.e. still alive and walking) — let
  ragdolls play out where they fall.

## Out of scope

- Wave/round structure, difficulty scaling, score persistence.
- Different unit kits in the stream (cavalry, etc.).
- Decorative map features (trees, walls, terrain).
- Mobile / touch controls for the menu.
