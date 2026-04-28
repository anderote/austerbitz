# Weapon-Pose Palette in Component Editor

## Problem

`line-infantry.json` carries a 49-entry `weaponPalette` whose ids (`nw-13`, `n-10`, ...) are arbitrary aliases for `(src, transform, x, y, rot, flipX)` tuples. Each palette entry is referenced from one or two `(pose, facing)` cells, so the indirection adds bloat without reuse benefit. The component editor at `components.html` doesn't display poses or weapons at all, so per-pose weapon orientations have to be hand-edited in JSON.

## Goal

1. **Drop the palette indirection.** Each `(pose, facing)` carries its own inline list of weapon orientations.
2. **Add a 3x3 weapon-source-facing grid** to the component editor, beside the existing facing grid, so weapon orientations can be authored visually.
3. **Author by clicking** — pick a target `(pose, facing)` cell on the left, pick a source facing on the right, then mirror / rotate / move with buttons. Save Variant adds another orientation to the same target cell. Save writes the kit JSON back to disk.

## Data model

### New schema (per `(pose, facing)`)

```ts
interface WeaponOrientation {
  src: Facing;                                 // which weapon source PNG to sample
  transform?: 'flipX' | 'flipY' | 'rot180';    // texture-space UV transform
  x: number;
  y: number;
  rot: number;                                 // degrees, +ccw
  flipX?: true;                                // additional UV horizontal flip
}

interface PoseFacingEntry {
  layers: string[] | string[][];
  weapons?: WeaponOrientation[];               // [primary, ...variants]; runtime picks index by entity.id % length
}
```

`kit.weaponPalette` is **removed**. `(pose, facing).weapon` (palette id) and `(pose, facing).weaponVariants` (palette id list) are **removed**.

`kit.weapon.layerPrefix` is **kept** — it still names the weapon's source PNG family (e.g. `musket-brown-bess`).

### Migration

A one-shot, idempotent script: for each kit JSON, walk every `(pose, facing)` entry. If it has `weapon` (id) or `weaponVariants` (ids), look the ids up in `kit.weaponPalette` and inline the entries as `weapons: WeaponOrientation[]` (stripping the `id` field). Then delete `kit.weaponPalette` and the `weapon`/`weaponVariants` id fields. The script writes the result back to disk.

We commit migrated JSONs as part of this change. The loader, atlas builder, and sprite pass switch to the new shape in the same commit. No legacy-format support — clean cut.

## Editor UX

### Layout

- **Left sidebar** (existing): facings dropdown, kit dropdown, regiment dropdown, skeleton overlay, reset, component group checkboxes.
- **Center panel** (existing): 3x3 facing grid, each cell rendering the unit at that facing. Renamed conceptually from "facing grid" to "unit-pose × facing grid" — see *Pose dropdown* below.
- **Right panel** (new): 3x3 weapon-source-facing grid, each cell rendering the kit's weapon at one of the 8 source facings, plus an edit-control strip below.

### Pose dropdown (new)

A new dropdown in the left sidebar selects the active unit pose: `idle`, `walking`, `running`, `make-ready`, `present`, `fire`, `hit`, `dying`. Defaults to `idle`. The center grid renders `kit.poses[pose][facing].layers` for each facing (falling back to `kit.facings[facing].layers` when the pose has no entry for that facing).

The weapon for each cell is composited on top using the cell's `weapons[0]` orientation. (Variants beyond [0] are not visualized in the cell — see *Variant indicator*.)

### Right-side weapon source grid

Eight cells, one per source facing, arranged 3x3 in the same compass layout as the center grid:

```
NW  N   NE
 W  ·   E
SW  S   SE
```

The center cell is empty. Each cell renders the weapon's PNG at that facing, raw (no body, no offset, no transform). The PNG is resolved as `componentsById.get(`${kit.weapon.layerPrefix}-${facing}`)`.

Clicking a source cell selects that source facing. The selected cell is highlighted.

### Edit-control strip (between the two grids)

Buttons:
- **Mirror** — toggles the standalone `flipX` field on the working orientation. Independent of `transform` (which is set only when the source choice itself was a derived UV reuse — not used in the v1 click-to-author flow, where `transform` always starts `undefined`).
- **Rotate 90** — `rot = (rot + 90) % 360`.
- **Move** — arrow keys (when the strip is focused) nudge `x` / `y` by 1px; Shift+arrow nudges by 8px. Convention: `y+` is down (canvas convention, matches existing JSON), `x+` is right. So Right arrow = `x += 1`, Down arrow = `y += 1`.
- **Save Variant** — commits the working orientation onto the target cell's `weapons[]`.
- **Save Kit** — writes the full kit JSON to disk.

The strip also shows a thumbnail of the working orientation and the live `(x, y, rot, flipX)` values.

### Authoring flow

1. Pick a kit, pose, and regiment.
2. Click a cell in the **center grid** → that `(pose, facing)` becomes the **target cell**. Highlighted.
3. Click a cell in the **right grid** → its source facing becomes the **working orientation** for the target cell, with `(x, y, rot, flipX) = (0, 0, 0, undefined)` and `transform = undefined`. The center cell live-renders the weapon overlaid on the body.
4. Use **Mirror / Rotate 90 / arrow-move** to fine-tune. The center cell updates as you edit.
5. Click **Save Variant** to commit. The working orientation is appended to the target cell's `weapons[]` (becomes `weapons[0]` if the array was empty, otherwise pushed).
6. Repeat steps 3–5 to add more variants to the same cell, or click another center cell to switch targets.
7. Click **Save Kit** when done. The kit JSON is written back to `public/components/kits/<id>.json`.

### Variant indicator

A small badge in the bottom-right of each center grid cell shows the count of `weapons[]` for that cell (e.g. `×3`). No badge if the count is 0 or 1.

### What's not in v1

- No drag-and-drop. Click-only.
- No editing of an already-committed orientation in place — to revise, append a new variant and (manually) remove the old one in JSON. (A "delete variant" button is a fast follow-up if needed.)
- No multi-cell selection.
- No undo/redo.
- No re-ordering of variants. New variants append.
- No new weapon source PNGs added through the editor.

## Save endpoint

A Vite dev plugin (`src/dev/save-kit-plugin.ts`) installs a middleware that handles `POST /api/save-kit/<id>`:
- Body: the full kit JSON.
- Behavior: validate `body.id === <id>`, then write to `public/components/kits/<id>.json` with 2-space indentation. Respond `200` on success, `400` on validation failure, `500` on write error.
- Dev-only — registered only in `vite serve`, not `vite build`. The editor's Save Kit button POSTs to this endpoint and surfaces a toast on failure.

In built/preview mode, the Save Kit button falls back to triggering a JSON download with the kit's filename — no server write. Detected by checking `import.meta.env.DEV`.

## Render path changes

### Editor (component-preview.ts)

- New module `src/dev/weapon-rendering.ts` exports a function to draw a `WeaponOrientation` onto a 2D canvas: load the source PNG, apply the texture-space `transform` (flipX/flipY/rot180), apply optional extra `flipX`, then translate by `(x, y)` and rotate by `rot` degrees about the body center. Used by both the center grid (with offset) and the right grid (no offset, raw source).
- `paintLayersInto` is extended (or wrapped) to call this helper after the body layers when a `WeaponOrientation` is supplied.

### Runtime (sprite-pass.ts, atlas.ts)

The atlas builder currently walks `kit.weaponPalette` to pack source UVs. After migration, it walks `kit.poses[*][*].weapons[]` instead, deduplicating on `(layerPrefix, src, transform)` so each source × transform combo is packed once. The sprite pass's per-kit weapon offset map keys on `(pose, facing, variantIdx)` instead of palette id.

`resolver.ts` loses `resolvePaletteEntry`, `resolvePoseWeaponEntry`, `WeaponPaletteEntry`, `WeaponPalette`, and the palette warning. `readWeaponVariantPool` becomes a direct read of `(pose, facing).weapons[]`. `resolveWeaponSpriteKey` survives, taking a `WeaponOrientation` instead of a palette entry (same shape minus `id`).

## Files touched

| Path | Change |
|---|---|
| `public/components/kits/*.json` | Migrate: drop `weaponPalette`, inline `weapons[]` per `(pose, facing)`. |
| `src/render/poses/resolver.ts` | Remove palette types/helpers; rename `WeaponPaletteEntry → WeaponOrientation` (drop `id`); rewrite `readWeaponVariantPool` to read inline `weapons[]`. |
| `src/render/poses/kit-loader.ts` | Drop `weaponPalette` from `KitConfig`. Update `PoseFacingEntry` reference. |
| `src/render/poses/atlas.ts` | Walk inline `weapons[]` instead of `weaponPalette`; dedupe on `(layerPrefix, src, transform)`. |
| `src/render/passes/sprite-pass.ts` | Per-kit weapon offset map keys on `(pose, facing, variantIdx)` from inline orientations. |
| `scripts/migrate-weapon-palette.ts` | New one-shot migration script. |
| `components.html` | Add right-side 3x3 panel + edit-control strip + pose dropdown. |
| `src/dev/component-preview.ts` | Pose dropdown wiring; target cell selection; working-orientation state; edit ops; save flow; weapon overlay rendering on center grid. |
| `src/dev/weapon-rendering.ts` | New: 2D canvas weapon-orientation drawing helper. |
| `src/dev/save-kit-plugin.ts` | New: Vite middleware for `POST /api/save-kit/<id>`. |
| `vite.config.ts` | Register `save-kit-plugin` in dev mode. |

## Risks

- **Migration accuracy.** A wrong migration silently breaks every kit's authored poses. The migration script must round-trip-test: for each `(pose, facing)`, the inlined orientation must equal the palette entry the id pointed at. We add a quick unit test that runs the migration on `line-infantry.json`'s in-memory contents and verifies orientations match.
- **Atlas dedup.** With inline orientations there's no longer a stable id for the source — the atlas builder must dedupe on `(layerPrefix, src, transform)` to avoid packing the same UV multiple times. Add a unit test asserting dedup for a kit with several pose entries sharing the same source.
- **Editor scope creep.** The editor was previously rest-pose-only. Adding pose-aware rendering and weapon overlay is a meaningful expansion. We keep the new code in a separate module (`weapon-rendering.ts`) so `component-preview.ts` doesn't blow up.

## Out of scope

- No new weapon kinds.
- No per-soldier variant override — variant pick is still `entity.id % weapons.length`.
- No headgear authoring changes (head block stays as it is).
- No editor undo/redo, drag-drop, or multi-select.
