# Per-pose weapon attachment with facing-share

## Goal
Each character renders its weapon (musket, saber, plunger, …) on every body pose — not only on a dedicated "weapon" pose. The weapon is **one** authored sprite per facing (with mirror/rotate sharing across the 8 facings), and each body pose × facing stores `(x, y, rot)` and optional pixel overrides for that weapon. This collapses the current 40-sprite per-pose-per-facing musket authoring into 3 base sprites + per-pose transforms + per-pose pixel-edit overlays.

## Today's state
- `public/components/kits/line-infantry.json` defines the musket twice over: once in the top-level `facings` block (8 layers, e.g. `musket-brown-bess-north`) and once as variant suffixes per body pose (e.g. `musket-brown-bess-south-fire`, `musket-brown-bess-south-make-ready`). 8 facings × 5 poses = up to 40 separately-authored musket sprites.
- The kit has a separate top-level `poses.musket` entry whose 8 facings each list a single musket layer — this is the "weapon authoring view" the editor currently exposes.
- Cuirassier and cannon-12 unit data exist (`src/data/units/`), but no kit JSONs have been authored — they have no weapons in the editor at all.

## Schema changes

### Kit JSON: top-level `weapon` block
Add to each kit that owns a weapon:

```jsonc
"weapon": {
  "layerPrefix": "musket-brown-bess",
  "facings": {
    "N":  { "src": "self" },                          // authored
    "NW": { "src": "self" },                          // authored
    "W":  { "src": "self" },                          // authored
    "S":  { "src": "N",  "transform": "flipY"  },
    "NE": { "src": "NW", "transform": "flipX"  },
    "SE": { "src": "NW", "transform": "rot180" },
    "SW": { "src": "NW", "transform": "flipY"  },
    "E":  { "src": "W",  "transform": "flipX"  }
  }
}
```

`layerPrefix` resolves to `<prefix>-<facing>` for `src: "self"` facings (e.g. `musket-brown-bess-north`). Derived facings reference an authored facing and apply `flipX`, `flipY`, or `rot180`.

`transform` enum:
- `flipX` — horizontal mirror (W ⇄ E, NW ⇄ NE, SW ⇄ SE)
- `flipY` — vertical mirror (N ⇄ S, NW ⇄ SW, NE ⇄ SE)
- `rot180` — 180° rotation (N ⇄ S, NW ⇄ SE, NE ⇄ SW, W ⇄ E)
- (none on `self` facings)

Units without a weapon (drummer, future support units) omit the block entirely.

### Kit JSON: per-pose weapon transform
Each body pose × facing stores the weapon's `(x, y, rot)`:

```jsonc
"poses": {
  "fire": {
    "S": {
      "layers": ["body-south-base", "trousers-south", "coat-line-south-fire", "shako-standard-south"],
      "weapon": { "x": -2, "y": -1, "rot": 0 }
    }
  }
}
```

Note: pose entries change shape. Today they are `"S": [layer, layer, ...]`. They become `"S": { "layers": [...], "weapon": { x, y, rot } }`. The migration removes every `musket-brown-bess-…-<pose>` from the layers list — those 40 separately-authored sprites are deleted.

**Default policy for derived facings**: if a body pose's facing entry omits `weapon`, the runtime derives `(x, y, rot)` from the facing's mirror source (e.g. fire/S inherits from fire/N with `y` mirrored and `rot` negated). Authored override always wins.

### Pixel-edits: per-pose-per-facing weapon overlay
The autosave format already supports `pixel-edits[unit][pose][facing][component]`. Add the convention that the weapon overlay component key is `weapon` (e.g. `pixel-edits["line-infantry"]["fire"]["S"]["weapon"] = [{x,y,color}, …]`). These pixels are composited on top of the resolved (and transformed) base weapon sprite at render time. They are **per pose × facing** — not shared across the mirror/rotate group, because pose-specific touchups (recoil flash, brass flash on fire, blood on hit) are by nature pose-local.

## Editor UX

### Pose dropdown
Lists all body poses (`idle`, `make-ready`, `present`, `fire`, `hit`, `dying`) and one weapon-authoring entry called `weapon` (replaces the current `musket` entry). The `weapon` view is the only place where the base weapon pixels for the 3 source facings (N, NW, W) get drawn. Selecting a body pose shows the body composited with the weapon overlaid in its current `(x, y, rot)` for that facing.

### Weapon handle (weapon-only)
When a body pose × facing is selected and the kit has a `weapon` block, a draggable handle appears over the weapon sprite:
- Mouse drag on the weapon = nudge `(x, y)` for this pose × facing.
- Arrow keys = nudge `(x, y)` for this pose × facing (replaces today's per-layer arrow nudge when the weapon is the active layer).
- `Q` / `E` = rotate `-1°` / `+1°` (with Shift = `±15°` for big jumps). **Rotation handle is weapon-only** — body/coat/shako/trousers layers do not get a rotate handle, since their per-pose appearance comes from the body pose's own layer choices.

### Per-pose weapon pixel-edit
Pixel-paint mode on the weapon while a body pose is selected writes to `pixel-edits[unit][pose][facing]["weapon"]`. Pixels are stored in **base-sprite local coordinates** (the user paints onto the sprite as if it were authored, and the runtime applies the facing transform before drawing). The "save it on the pose" semantic the user asked for: edits to the weapon while authoring `fire/S` only affect `fire/S`, not the canonical weapon sprite.

### Mirror-source badge
The 3×3 facings grid shows a small badge on derived facings indicating their source and transform (e.g. `← N flipY`, `← NW rot180`). Clicking a derived facing while a weapon edit is active jumps the user to the source facing (since pixel edits to the base sprite live there).

### Autosave
Existing autosave stays. New writes:
- Weapon `(x, y, rot)` per pose × facing → kit JSON via `POST /api/kits/<unit>` (new endpoint, parallels `/api/offsets`).
- Weapon pixel overrides → existing `POST /api/pixel-edits` with the `"weapon"` component key.

## Runtime rendering

### Pose composition
For a given (unit, pose, facing):
1. Render the body pose's `layers` in order (existing behavior, minus the now-removed per-pose musket layer).
2. If the kit has a `weapon` block:
   - Resolve the weapon facing: take `weapon.facings[facing]`. If `src: "self"`, sprite is `<layerPrefix>-<facing>`. Else, sprite is `<layerPrefix>-<src>` rendered with the named `transform`.
   - Apply per-pose `(x, y, rot)`. Resolve missing values from the mirror source (e.g. `fire/S.weapon` defaults to mirrored `fire/N.weapon`).
   - Composite the base sprite (transformed) plus any pose-local pixel overlay at the resolved offset/rotation.
3. Z-order: weapon always on top of body in v1. Per-facing "behind body" is a future flag.

### Atlas implications
The weapon sprite atlas needs only the 3 authored facings per kit (N, NW, W). The build script (`scripts/build-soldier-components.mjs`) emits these unchanged. The per-pose musket variants previously emitted (`musket-brown-bess-south-fire`, etc.) are no longer built or registered.

### Rotation pivot
v1 pivot = sprite center. If positioning becomes finicky on cavalry sabers (long offset from grip), we add a `pivot: [px, py]` in the `weapon` block later.

## Migration

### `line-infantry.json`
- Add the `weapon` block above with `layerPrefix: "musket-brown-bess"` and the 3-source / 5-derived facings map.
- Remove every `musket-brown-bess-*` layer from `facings.*.layers` and from `poses.<pose>.<facing>.layers`.
- Convert each `poses.<pose>.<facing>` from a bare array to `{ "layers": [...], "weapon": { x, y, rot } }`. Initial `(x, y, rot)` values are seeded by hand to roughly match where the old per-pose musket sprite sat.
- Delete the `poses.musket` entry (replaced by the editor's `weapon` authoring view, which reads `weapon.layerPrefix`).

### `index.json` (component registry)
Remove the `musket-brown-bess-<facing>-<pose>` entries — only the 8 base facings remain (N, NE, E, SE, S, SW, W, NW), of which only 3 are actually authored after this change (N, NW, W). The other 5 base entries can be deleted from `index.json` too if nothing else references them; otherwise leave them as orphans until cleanup.

### `pixel-edits.json`
Existing per-pose-per-facing pixel edits keyed under `musket-brown-bess-<facing>-<pose>` get migrated:
- For source facings (N, NW, W): edits become weapon overlays under `pixel-edits[unit][pose][facing]["weapon"]`.
- For derived facings (everything else): edits are dropped if they only contain pose-specific touchups; if they contain unique authored content, the migration warns and leaves them in `pixel-edits.json` for manual triage. (User authored most of the existing variants by hand, so the safe default is "warn, don't auto-discard.")

A migration script (`scripts/migrate-weapon-poses.mjs`) does this in one pass and prints a per-facing report.

### Other kits
`cuirassier` and `foot-artillery` (or whatever the gunner kit ends up named) don't exist yet — they get authored from scratch with the new schema (saber and plunger weapon blocks respectively). Stub kits with placeholder weapon sprites (3 authored facings each) are part of v1 so the system is exercised on more than one unit.

## Out of scope (future)
- Per-pose-facing `behindBody` flag for off-arm occlusion.
- Custom rotation pivots (`pivot: [px, py]`).
- Multi-weapon attachments (sidearm + primary). Today every unit has 0 or 1 weapon.
- Weapon swap mid-pose (e.g. cavalry switching from saber to pistol). The kit picks one weapon; mid-pose swaps would need a `weaponOptions` array.

## Decisions taken (no further input needed)
- Storage: kit JSON for transforms, `pixel-edits.json` for overlays.
- Pivot: sprite center, v1.
- Z-order: weapon over body, no exceptions, v1.
- 3 source facings = N, NW, W (matches user spec).
- Rotate handle is weapon-only; body layers retain only positional offset semantics.
