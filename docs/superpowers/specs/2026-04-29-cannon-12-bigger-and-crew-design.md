# 12-Pdr Cannon: Bigger Gun + Visual Crew — Design

**Date:** 2026-04-29
**Status:** Approved (inline)

## Goal

Replace the small, half-empty 12-pdr cannon sprite with a fuller, more anatomically accurate 12-pdr filling the existing 32×36 component cell, and surround it with 4 visual gun-crew figures that share the regiment-recolor palette so they tint with the cannon's team. No simulation changes — crew are pure art layers, share the cannon's HP, and have no AI.

## Constraints

- Stay at the existing 32×36 component cell. Both `scripts/build-soldier-components.mjs` and `scripts/slice-component-atlas.mjs` hardcode `CELL_W=32, CELL_H=36` for every kit. Re-plumbing per-kit cell sizes is out of scope.
- Keep the existing layered component pipeline: `build-cannon-12-components.mjs` writes per-layer 32×36 PNGs → `cannon-12.json` lists which layers compose each (pose, facing) → `build-soldier-components.mjs --kit cannon-12` flattens to a 3×3 atlas → `slice-component-atlas.mjs --kit cannon-12` slices into the per-pose pose-atlas inputs.
- Existing pose set stays as-is: `idle`, `firing`, `reloading`, `flinch`, `dying`. No new poses, single frame per pose (length-1 clips).
- Selection / hitbox geometry is driven by `placeholderSize` and stays unchanged. Only `spriteSize` (which is the on-screen render footprint) changes.

## Visual scope

### Gun

Redraw all gun layer functions in `scripts/build-cannon-12-components.mjs`:

- **Barrel** — bronze 12-pdr, longer and thicker than the current art. Side view shows breech bulge + reinforce ring + trunnion shoulder + muzzle swell with bore. Front and back show muzzle ring / cascabel knob respectively. 3/4 views show foreshortened diagonal barrel with breech bulge anchored at the carriage.
- **Trail / cheeks** — wooden carriage with red primary trim along the upper edge, characteristic spade end on the rear of the trail. Side view shows the long trail extending behind the wheel; front/back/3-quarters show the cheeks framing the breech and the spade pointing toward the trailward corner.
- **Wheels** — larger spoked wheels with 4–5 visible spokes through the secondary-marker rim, dark hub. Side view shows one foreground wheel dominant with a hint of the far wheel partially behind the trail. Front/back show two splayed wheels flanking the carriage.

Each of the 8 facings is hand-authored (no runtime mirror). The scale target is: gun silhouette ≈ 26×16 px on side view; wheels ≈ 9×9 px; barrel ≈ 14 px long; trail extends to within 2–3 px of the cell edge so the gun reads "filling the cell."

### Crew (4 figures around the gun)

Crew figures are tiny 5×7 pixel silhouettes drawn directly into each (pose, facing) variant. Coats use the line-infantry P/S/T marker palette so they regiment-recolor the same way line infantry do — British crew look British, French crew look French, etc:

- **P (primary)** — coat
- **S (secondary)** — collar / cross-belts / breeches
- **T (tertiary)** — shako / gaiters
- **f / F** — literal skin / skin shadow
- **k** — outline

Crew positions per facing (right-handed gun crew of the period — gunner on the left of the trail with the lanyard, rammer at the muzzle, sponger opposite, powder-monkey at the rear):

| Facing | Crew layout |
|---|---|
| **S** muzzle at viewer | Two crew flanking the trail to the viewer-north (above the breech in the cell), two flanking the wheels (at the cell sides). |
| **N** muzzle away | Same cross arrangement, but crew rendered in front of the gun (lower in the cell) so they're not occluded by the breech. |
| **E** muzzle right | Rammer between the muzzle and the cell's right edge; sponger above the muzzle; gunner with lanyard at the trail-end (left); powder-monkey at the lower-left corner. |
| **W** | Mirror of E. |
| **NE / NW / SE / SW** | Two crew flanking the trail's diagonal-rear, two flanking the wheels' diagonal-front. |

### Per-pose crew action (single frame each)

- **idle** — all four standing at attention by their stations.
- **fire** — gunner crouched/leaned with lanyard cord taut; rammer holds rod vertically off to one side; sponger and powder-monkey lean back from the muzzle. Composes with the existing `cannon12-muzzle-flash-*-fire` and `cannon12-smoke-*-fire` overlay layers; crew are added below the muzzle-flash layer so the flash still reads bright.
- **reloading (`make-ready`)** — rammer mid-shove with the rammer rod aligned with the bore; sponger holds the sponge bucket aside; gunner thumb-blocks the vent; powder-monkey holds a cartridge. Composes with the existing `cannon12-handspike-*-reload` overlay (handspike layer is rendered behind crew so the rammer's rod sits on top).
- **flinch / dying** — reuses the **idle** crew sprite (no new variant); the gun layers handle the pose's own state.

Crew is therefore authored as 8 facings × 2 action variants (`idle`, `fire`, `reload`) = 16 component PNGs, plus the 5 facings × `idle` are reused for `flinch` and `dying` poses.

## File changes

### `scripts/build-cannon-12-components.mjs` (major rewrite)

- Tighten existing layer functions to the new gun proportions (barrel, trail, wheels, muzzle-flash, smoke, handspike). All 8 facings authored.
- Add `drawCrew<Facing><Variant>(p)` helpers that paint 4 crew figures at the right positions per (facing, variant).
- Add `emitAllCrew()` writing PNGs to `public/sprites/components/crew/cannon12-crew-<facing>-<variant>.png` for `<facing>` in {north, northeast, east, southeast, south, southwest, west, northwest} and `<variant>` in {idle, fire, reload}.
- Extend `registryEntries()` to register every new crew component with type `crew`, category `crew-line`, pivot `[16, 32]`.

### `public/components/kits/cannon-12.json`

- For each pose's per-facing `layers` array, append the matching crew layer between the gun layers and the FX overlays:
  - `idle` and `hit` and `dying` poses → append `cannon12-crew-<facing>-idle`.
  - `fire` pose → append `cannon12-crew-<facing>-fire` *between* the existing barrel and muzzle-flash entries (so flash + smoke draw on top of crew).
  - `make-ready` pose → append `cannon12-crew-<facing>-reload` after the existing handspike entry (so the crew's rammer rod reads on top of the handspike).
- The `facings` block (used for the unit's static placeholder render) gets `cannon12-crew-<facing>-idle` appended after the barrel layer.

### `src/data/units/cannon-12.ts`

- Add `spriteSize: { w: 3.6, h: 3.6 }` so the 32×36 cell renders ~60% larger on screen.
- Add `footYFromCenter: 1.5` so the gun's wheel-line — which sits near the bottom of the 32×36 cell — anchors against the ground rather than the sprite's center.
- `placeholderSize` and all other stats unchanged (selection/hitbox/ai stay the same).

### `src/render/cannon-12-sprite.ts`

- Refresh the 17×14 procedural fallback palette and pose grids so the small lab/preview render reads as the new gun. Crew is omitted at this resolution — there's not enough room. The fallback is rarely hit at runtime (the pose atlas wins) but keeps the lab/preview consistent.

### Build-pipeline scripts

No edits expected. Adding new component PNGs and registry entries is enough; `build-soldier-components.mjs --kit cannon-12` already iterates per-pose layer arrays, and `slice-component-atlas.mjs --kit cannon-12` already produces the per-pose pose PNGs.

## Layer-order invariant

Per facing in the `fire` pose's `layers` array, draw order (back to front) must be:

1. `cannon12-trail-<facing>`
2. `cannon12-wheels-<facing>`
3. `cannon12-barrel-<facing>`
4. **`cannon12-crew-<facing>-fire`**
5. `cannon12-muzzle-flash-<facing>-fire`
6. `cannon12-smoke-<facing>-fire`

The crew sits behind FX so the muzzle flash and smoke still pop visually, but in front of the gun so a crew figure standing close to the breech overlaps the gun rather than disappearing behind it.

For `make-ready`:

1. trail, wheels, barrel
2. `cannon12-handspike-<facing>-reload`
3. `cannon12-crew-<facing>-reload`

For `idle` / `hit` / `dying`:

1. trail, wheels, barrel
2. `cannon12-crew-<facing>-idle` for `idle` and `hit`; **omitted entirely from `dying`** — the dying pose composes only `trail + wheels + barrel + smoke` so the wreck reads as "abandoned smoking gun, no crew."

## Test plan

1. Run `npm run build:components` (writes new component PNGs).
2. Run `npm run build:soldier-components` (composites kit JSON layer lists into `public/sprites/cannon-12-components.png` and re-slices to `public/sprites/poses/cannon-12/<pose>/<dir>/0/0.png`).
3. Run `npm run build:poses` (regenerates `manifest.json`).
4. Open `cannon-test.html` and `lab.html` and visually verify:
   - Gun reads bigger on screen.
   - Crew positions don't occlude the muzzle.
   - All 8 facings look right.
   - Regiment recolor still works (`lab.html` lets you flip teams).
5. Run `npm test` — no behavior changes are expected; sprite-atlas tests, pose-resolver tests, etc. should all still pass since cell sizes and pose names are unchanged.

## Out of scope (YAGNI)

- Real ECS crew entities, AI, individual hitpoints, crew-loss-disables-gun.
- Multi-frame animation (crew animation cycles, gun recoil tween).
- New pose names beyond what the cannon already has.
- Per-kit cell-size override in the build pipeline.
- Crew uniform variants (artillery blue, cavalry crew, etc.) — single line-infantry pattern recolored by team.

## Risks / unknowns

- 5×7-pixel crew may read mushy at low zoom. Mitigation: drawn as silhouettes-with-shako-and-coat-pop colors, anchored against the gun's outline so they don't dissolve into the carriage. If they really don't read, fallback is to drop to 3 crew or omit them at the smallest zoom level (no zoom-aware rendering exists yet — would be a follow-up).
- The cannon's existing `placeholderSize` (2.2×2.8) is smaller than the new `spriteSize` (3.6×3.6). Selection click-tests use the placeholder, so users will visually see crew that aren't part of the click target. This is the correct trade-off — the click target should hug the gun, not the surrounding crew.
