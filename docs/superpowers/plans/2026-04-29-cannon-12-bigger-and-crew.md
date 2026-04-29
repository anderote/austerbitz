# 12-Pdr Cannon: Bigger Gun + Visual Crew — Implementation Plan

Spec: `docs/superpowers/specs/2026-04-29-cannon-12-bigger-and-crew-design.md`

## Reference files

- `scripts/build-cannon-12-components.mjs` — emits per-layer 32×36 PNGs and registers them. Major rewrite target.
- `public/components/kits/cannon-12.json` — kit JSON listing layers per (pose, facing). Append crew layer ids.
- `src/data/units/cannon-12.ts` — unit declaration. Add `spriteSize` and `footYFromCenter`.
- `src/render/cannon-12-sprite.ts` — 17×14 procedural fallback. Refresh poses to match new look.
- `scripts/draw-cannon-12.mjs` — preview-PNG twin of the runtime fallback. Refresh in lockstep.
- `public/components/index.json` — component registry; appended to by the build script's `updateRegistry()`.

Build pipeline (already in `package.json`):

- `npm run build:components` → runs `build-cannon-12-components.mjs`, writing component PNGs.
- `npm run build:soldier-components` → runs `build-cannon-12-components.mjs` then `bake-weapon-edits.mjs`, then `build-soldier-components.mjs --kit cannon-12`, then `slice-component-atlas.mjs --kit cannon-12`.
- `npm run build:poses` → above + `build-pose-manifest.mjs`.

## Task 1 — Refresh gun layers in `build-cannon-12-components.mjs`

Goal: bigger, more anatomically correct 12-pdr; same layer set; same 32×36 cell.

Rewrite these layer functions to fill the cell better. Targets are silhouette sizes; exact pixel positions are at the implementer's discretion.

- `drawWheelDisc()` and the `drawWheelsFrontBack()` / `drawWheelsSide()` / `drawWheels34()` callers — move to a 9×9 wheel disc (was 7×7), with 4 visible rim spokes and a hub. For side view, the foreground wheel sits at roughly y=27 with a 9-px-tall silhouette; for front/back, two wheels splayed at x≈8 and x≈24.
- `drawTrailFront()` / `drawTrailBack()` / `drawTrailSide()` / `drawTrail34()` — make the trail beam longer for the side view (the trail should reach within 2–3 px of the cell edge opposite the muzzle). Add a triangular spade at the trail end (red primary trim). Cheeks need to be visibly two parallel beams with a center gap for the breech.
- `drawBarrelSide()` — barrel ≈14 px long with a clearly larger breech bulge at the carriage end, a reinforce ring (gold band) one third along the barrel, a trunnion shoulder where it meets the cheek, and a muzzle swell with a dark bore opening. Eastern facing puts the muzzle around x=29.
- `drawBarrelFront()` / `drawBarrelBack()` — muzzle ring (concentric) for front; breech / cascabel knob for back. Both larger than current.
- `drawBarrel34()` — diagonal foreshortened barrel with a breech bulge anchored at the carriage end.
- `drawFlash*()` — adjust muzzle-flash positions to match the new muzzle pixel coordinates.
- `drawSmoke*()` — adjust origin to the new muzzle.
- `drawHandspike*()` — adjust the rod's anchor point to the new trail position.

Acceptance criteria:

- All 8 emitted facings still pass shape sanity (no clipped pixels at cell edges; no fully-transparent layers).
- Each facing's silhouette spans at least 24 px wide for side views and 18 px tall for front/back views.
- The script remains idempotent — re-running overwrites prior PNGs cleanly.

## Task 2 — Add crew layers in `build-cannon-12-components.mjs`

Add new functions and emission entry points:

- New palette entries: tertiary (yellow) family — `tertiaryHi='#FFFF80'`, `tertiaryMid='#FFFF00'`, `tertiaryShade='#A0A000'` — and skin: `skin='#E4BC9C'`, `skinShadow='#BA8E6C'`.
- New helper `drawCrewFigure(p, x, y, variant, facing)` that paints a 5×7 mini-soldier at the given position. The figure has: 1 row outline (k), 1 row shako (T), 1 row face (f/F), 3 rows coat with cross-belts (P with S strokes), 1 row breeches (S), 1 row gaiters (T). The `variant` controls posture:
  - `'idle'` — symmetric standing, both arms at sides.
  - `'fire'` — leaning back (top row shifted ½ pixel from coat axis); for the gunner figure an extra horizontal pixel-line traces the lanyard from him to the breech of the gun.
  - `'reload'` — for one figure (the rammer), arms extended along the rammer rod; rest hold tools (sponge bucket, cartridge).
- 8 facing-specific drawers `drawCrew<Facing>(p, variant)` that call `drawCrewFigure` 4 times at the per-facing positions documented in the spec.
- New emitter `emitAllCrew()` writing to `crew/cannon12-crew-<fs>-<variant>.png` for each combination of 8 facings × 3 variants. Add a `crew/` subdir under `public/sprites/components/`.
- Extend `registryEntries()` to register all 24 new crew components with `type: 'crew'`, `category: 'crew-line'`, `pivot: [16, 32]`.

Reuse the existing CRC32 / PNG encode helpers — they're already in the file.

Acceptance criteria:

- 24 new component PNGs land under `public/sprites/components/crew/`.
- `public/components/index.json` gains 24 new entries (registry update is idempotent — re-running the script produces no diff after the first run).
- Each crew PNG is 32×36 with crew silhouettes only (no gun pixels — the kit composes them on top of the gun layers).

## Task 3 — Wire crew into `public/components/kits/cannon-12.json`

For each of the existing pose blocks (`facings`, `poses.fire`, `poses.make-ready`, `poses.hit`, `poses.dying`) and for each of the 8 facings (N, NE, E, SE, S, SW, W, NW):

- `facings[<F>].layers` — append `cannon12-crew-<fs>-idle` after the existing barrel layer.
- `poses.fire.<F>.layers` — insert `cannon12-crew-<fs>-fire` between the existing barrel layer and the muzzle-flash layer.
- `poses.make-ready.<F>.layers` — append `cannon12-crew-<fs>-reload` after the existing handspike layer.
- `poses.hit.<F>.layers` — append `cannon12-crew-<fs>-idle` after the existing barrel layer.
- `poses.dying.<F>.layers` — leave **untouched** (no crew on the wreck per the spec).

Where `<fs>` is the lowercase compass name matching the existing layer ids (`north`, `northeast`, `east`, `southeast`, `south`, `southwest`, `west`, `northwest`).

Acceptance criteria: JSON is valid, every non-`dying` layers array gains exactly one crew entry per facing, and the cannon-12 atlas re-bakes without errors via `npm run build:soldier-components`.

## Task 4 — Update unit data in `src/data/units/cannon-12.ts`

```ts
export const cannon12: UnitKind = {
  id: 'cannon-12',
  category: 'artillery',
  name: '12-Pounder Cannon',
  placeholderColor: [255, 255, 255],
  placeholderSize: { w: 2.2, h: 2.8 },
  spriteSize: { w: 3.6, h: 3.6 },
  footYFromCenter: 1.5,
  spriteCell: { col: 1, row: 1 },
  baseStats: { /* unchanged */ },
  bodyZ: { low: 0, high: 1.5 },
  barrelOffset: { forward: 1.6, side: 0.0, height: 0.7 },
  weapon: cannon12Solid,
};
```

`spriteSize` makes the 32×36 cell render larger on screen; `footYFromCenter` re-anchors the foot line to the wheel-line position in the new art.

Acceptance: typechecks (`tsc --noEmit`), all existing tests pass, no other unit data changes.

## Task 5 — Refresh procedural fallback `src/render/cannon-12-sprite.ts`

Update the 5 pose grids (`POSE_FRONT`, `POSE_FRONT_DIAG`, `POSE_SIDE`, `POSE_BACK`, `POSE_BACK_DIAG`) to better reflect the new gun look — bigger wheels, longer trail spade, more prominent barrel. Crew is omitted at this resolution (17×14 doesn't have room).

Sync the matching grids in `scripts/draw-cannon-12.mjs` so the static preview PNG still matches the runtime fallback.

Acceptance: the existing pose-grid validators (`if (p.length !== CANNON_CELL_H)` etc.) still pass; the sprite-atlas test in `src/render/sprite-atlas.test.ts` (if any) still passes.

## Task 6 — Regenerate artifacts and verify

Run, in order:

```sh
npm run build:components
npm run build:soldier-components
npm run build:poses
```

Then manually verify in:

- `cannon-test.html` — 3 cannons firing at line infantry; cannons should look bigger and now have crew, and crew should regiment-recolor with the cannons' team primaries/secondaries.
- `lab.html` — open with subject `cannon-12`, cycle facings, fire and reload — visually confirm crew animations switch with pose.

Run the test suite:

```sh
npm test
```

Acceptance: all tests pass, no visual regressions in soldier or cuirassier rendering.

## Task ordering and parallelism

- Tasks 1, 2, 5 all live in the build scripts and can be split across two subagents (1+2 in `build-cannon-12-components.mjs` together since they share the file; 5 in the parallel pair of fallback files).
- Task 3 (kit JSON) depends on Task 2 (the layer ids must exist when the kit references them — actually the build script will warn but not fail on missing layers, so order isn't strict, but pairing them avoids a partial state).
- Task 4 (unit data) is independent.
- Task 6 (regenerate + verify) runs last.

Recommended subagent split:

1. **Subagent A** — Tasks 1 + 2 (rewrite + extend `build-cannon-12-components.mjs`).
2. **Subagent B** — Task 3 (`cannon-12.json`) + Task 4 (`cannon-12.ts`) + Task 5 (procedural fallback in `cannon-12-sprite.ts` and `draw-cannon-12.mjs`).
3. **Main thread** — Task 6 (run the build, verify outputs, run tests).
