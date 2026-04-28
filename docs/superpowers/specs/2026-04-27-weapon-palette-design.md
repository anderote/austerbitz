# Weapon palette (per-kit, shared across poses)

## Goal

Replace per-`(pose, direction)` weapon authoring (`weapon: { src?, transform?, x, y, rot, flipX? }` + `weaponVariants[]` of the same shape, duplicated across every pose × direction × variant slot) with a kit-level palette of named weapon entries that each pose × direction references by id. Same id can appear in many `(pose, direction)` slots → reuse without duplication.

This supersedes the per-pose weapon attachment spec (`2026-04-27-per-pose-weapon-attachment-design.md`) — that spec's `kit.weapon.facings` block and inline `(pose, dir).weapon` placement are subsumed by the palette.

## Scope

In:
- New kit-level `weaponPalette: WeaponPaletteEntry[]` — flat array of `{ id, src, transform?, x, y, rot, flipX? }` entries.
- `kit.poses[pose][dir].weapon: string` (palette id) and `weaponVariants: string[]` (array of palette ids) replace inline placement objects.
- Drop `kit.weapon.facings`. Keep `kit.weapon.layerPrefix` only — the palette entries carry the per-entry `src` choice.
- One-shot migration script that builds a palette by deduping every existing `(pose, dir).weapon` + `weaponVariants[]` value and replacing them with palette ids.
- Editor: a new "Palette" view listing every entry as a card; per-`(pose, dir)` view replaces the inline variants UI with a reference-picker (primary slot + variant slots, both pulling from the palette).
- Resolver, atlas builder, and sprite-pass updated to look up palette entries by id.

Out:
- No new authored source PNGs (still 3 source facings per weapon: N, NW, W).
- No backwards-compat with the inline shape — the migration is one-shot and the runtime stops reading inline `(x, y, rot)` afterwards.
- No per-frame weapon variation for multi-frame poses (walking/running stay one weapon-id per `(pose, dir)`, applied across all frames).
- No bake-pipeline changes (`build-soldier-components.mjs` does not touch the weapon block today and will not after).

## Data model

```jsonc
// public/components/kits/line-infantry.json
{
  "id": "line-infantry",
  "facings": { ... },              // unchanged
  "poses": {
    "idle":    { "S": { "layers": [...], "weapon": "m0", "weaponVariants": ["m0","m4","m7"] }, ... },
    "present": { "S": { "layers": [...], "weapon": "m12" } },               // single id, no variants
    "fire":    { "S": { "layers": [...], "weapon": "m12", "weaponVariants": ["m12","m13"] } },
    "walking": { "S": { "layers": [[...],[...],[...],[...]], "weapon": "m0" } },  // multi-frame layers, single weapon id across frames
    ...
  },
  "weapon": {
    "layerPrefix": "musket-brown-bess"
  },
  "weaponPalette": [
    { "id": "m0",  "src": "S",  "x": 0,  "y": 6,  "rot": 0 },
    { "id": "m1",  "src": "S",  "x": 1,  "y": 6,  "rot": 0 },
    { "id": "m4",  "src": "S",  "x": -7, "y": 4,  "rot": 0 },
    { "id": "m12", "src": "S",  "x": 1,  "y": -1, "rot": 20 },
    { "id": "n0",  "src": "N",  "x": -7, "y": -3, "rot": 0 },
    { "id": "nw3", "src": "NW", "x": -7, "y": 2,  "rot": 0, "flipX": true },
    { "id": "w-flip", "src": "W", "transform": "flipX", "x": 2, "y": 4, "rot": 0 },
    ...
  ]
}
```

`WeaponPaletteEntry`:

```ts
type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
type WeaponFacingTransform = 'flipX' | 'flipY' | 'rot180';

interface WeaponPaletteEntry {
  id: string;                          // unique within kit; stable across edits
  src: Facing;                         // which authored source PNG to sample
  transform?: WeaponFacingTransform;   // texture-space transform on the source UV (default 'none')
  x: number;                           // pixel offset relative to body sprite center
  y: number;
  rot: number;                         // degrees, +ccw (matches today's authoring)
  flipX?: true;                        // additional UV horizontal flip on top of transform
}
```

`KitConfig.weapon`:

```ts
interface WeaponBlock {
  layerPrefix: string;                 // e.g. 'musket-brown-bess'
  // facings is GONE. Each palette entry carries its own src+transform.
}
```

`KitConfig.poses[pose][dir]` (the `PoseFacingEntry`):

```ts
interface PoseFacingEntry {
  layers: string[] | string[][];       // unchanged (single or multi-frame)
  weapon?: string;                     // palette id (was: { x, y, rot, flipX?, src?, transform? })
  weaponVariants?: string[];           // palette ids (was: array of inline placement objects)
}
```

### Why placement lives in the palette (not per-pose)

Two-part rule, agreed in design discussion:
1. **Palette holds placement.** Each entry is a complete (sprite, position, rotation) snapshot. References by id pull all of it.
2. **Editing in any view propagates.** Nudging an entry from a `(pose, dir)` preview edits the palette entry, so every `(pose, dir)` referencing that id updates at once. To author pose-specific placement, the user creates a new palette entry and points the slot at it — explicit, not implicit.

Trade-off: many palette entries (one per unique `(src, x, y, rot, flipX)` tuple ever used). Tolerable because the palette is flat and grep/scroll-able, and IDs auto-generate on first creation.

### Why no `kit.weapon.facings` fallback

Today `kit.weapon.facings[F]` lets `(pose, dir)` omit the `weapon` field and still get a sensible default (the canonical source for direction `F`). The palette removes implicit defaults: every `(pose, dir)` either explicitly references a palette id or has no weapon. The migration populates explicit ids everywhere current authoring exists, so behavior is preserved.

If a pose entry truly has no weapon (e.g. a future "drop weapon on death" frame), `weapon` is omitted and the runtime emits no overlay quad for that `(pose, dir)`.

## Migration

`scripts/migrate-to-weapon-palette.mjs` (Node ESM, idempotent):

For each kit JSON in `public/components/kits/<id>.json`:

1. Walk every `kit.poses[pose][dir].weapon` and every entry in `kit.poses[pose][dir].weaponVariants[]`.
2. For each, determine the **effective** `(src, transform, x, y, rot, flipX)`:
   - If the inline entry has explicit `src`: use it directly (`transform` defaults to `'none'`).
   - Otherwise: read `kit.weapon.facings[dir]` to get the canonical `(src, transform)` and pair it with the inline `(x, y, rot, flipX)`.
3. Dedupe by stringified `(src, transform, x, y, rot, flipX)` tuple. Each unique tuple gets a palette id, generated as `<src-lower>-<n>` (e.g. `s-0`, `s-1`, `n-0`, `nw-0`). `n` increments per `src` group.
4. Build `kit.weaponPalette` as the deduped list (sorted by id for stable output).
5. Replace each inline `(pose, dir).weapon` with the corresponding palette id (string). Replace each entry in `weaponVariants` with the array of ids.
6. Delete `kit.weapon.facings`. Keep `kit.weapon.layerPrefix`.
7. Write the kit JSON back, prettified.

Idempotent re-run: if the kit already has `weaponPalette` and string-form `weapon`/`weaponVariants`, do nothing.

After running on `line-infantry.json`, expected palette size: roughly 30–60 unique entries (the existing `weapon` + variants count is high, but many duplicate tuples will collapse).

## Resolver (`src/render/poses/resolver.ts`)

Changes:

- Add `WeaponPaletteEntry`, `WeaponPalette = WeaponPaletteEntry[]`.
- Simplify `WeaponBlock` to `{ layerPrefix: string }`. Drop `WeaponFacingEntry` (replaced by per-entry `src` on palette entries).
- New helper `resolvePaletteEntry(palette, id) → WeaponPaletteEntry | null` (Map lookup; throw warning + null on unknown id).
- New helper `resolveWeaponSpriteKey(layerPrefix, entry) → { spriteKey, transform }` where `spriteKey = '<layerPrefix>-<entry.src>'` and `transform = entry.transform ?? 'none'`.
- Replace `resolveWeaponPoseTransform(poses, pose, facing, weaponBlock)` → `resolvePoseWeaponEntry(poses, pose, facing, palette)`. Returns the `WeaponPaletteEntry` referenced by `(pose, facing).weapon`, or null. No mirror inheritance — caller decides what to do when null.
- Replace `readWeaponVariantPool` → `readWeaponVariantPool(poses, palette, pose, facing)` returns an array of `WeaponPaletteEntry` (resolves each id; drops unknown ids with a warning).
- Drop `resolveWeaponFacing` (the per-direction canonical resolver) — no longer needed.

Tests in `src/render/poses/resolver.test.ts` rewritten:
- `resolvePaletteEntry` returns the entry by id, or null on miss.
- `readWeaponVariantPool` returns `[primary, ...variants]` resolved through the palette; returns empty when `(pose, facing)` is absent or has no weapon id.
- Unknown ids in `weaponVariants` are skipped (with a warn).

## Atlas builder (`src/render/poses/atlas.ts`)

`collectWeaponRefs` today iterates `WEAPON_SOURCE_FACINGS` and packs `${layerPrefix}-${facing}` for each kit. Change:
- Iterate each kit's `weaponPalette` and collect the **set** of `(layerPrefix, src)` pairs in use.
- Pack only those — most kits will still use all 3 source facings (N, NW, W) since palette entries with `src: 'S'`/`'NE'` etc. need a transform on top of N or NW. Concretely: an entry with `src: 'S'` is invalid; the source must be one of the authored facings. The resolver/migration must ensure palette `src` is always an authored source facing (N, NW, W for line-infantry).

(The migration script enforces this: any inline `src: 'S'` etc. gets rewritten to the underlying authored source via the `kit.weapon.facings` mapping before it's added to the palette.)

## Sprite-pass (`src/render/passes/sprite-pass.ts`)

Today:
- Pre-resolved `weaponUvByPrefix: Map<layerPrefix, Array<UV>>` indexed by runtime facing 0..7.
- Per entity per frame: look up by facing, optionally override with variant pool.

After:
- Pre-resolved `weaponUvByPaletteId: Map<layerPrefix, Map<paletteId, UV>>`. Each palette entry resolves to one UV rect (using `src` + `transform`).
- Per entity per frame:
  - Read `kit.poses[pose][facing].weapon` (palette id) and `weaponVariants[]` (id array).
  - Pool ids `[primary, ...variants]`. Pick by `entity.id % pool.length`.
  - Resolve chosen id → palette entry → UV rect + `(x, y, rot, flipX)`.
  - Emit weapon instance (same as today's flow from line ~520 onward).

The "facing → weapon UV" array is replaced with a per-id Map lookup. Negligible perf delta (Map.get is O(1)).

If `weapon` id is absent on a `(pose, facing)`, no weapon overlay quad is emitted (today: same outcome via uvList[facing] returning null).

## Editor (`public/components-editor.html`)

The editor is the largest piece. Two new flows:

### Palette view

A new pose-id `WEAPON_PALETTE_ID = 'palette'` shown in the pose dropdown. Selecting it:
- Hides the body preview canvas; shows a flat grid of palette entry cards (96×108 thumbnails, same size as today's variant cards).
- Each card: weapon thumbnail (rendered from `src` + `transform` + `(x, y, rot, flipX)`), id label, and `(x, y, rot)` readout.
- "+ Add entry" button at end of grid: appends a new palette entry initialized to `{ id: <auto>, src: 'N', x: 0, y: 0, rot: 0 }`. Auto-id is `<src-lower>-<n>` where n is the smallest unused suffix in that src group.
- Selecting a card → "active palette entry" state. Nudge buttons (`←↑↓→`, `Q`/`E` for rot, `F` for flipX toggle) update that entry's `(x, y, rot, flipX)`. Source-facing picker (3×3 grid, same as today's weapon-pose grid) lets the user change `src` + `transform` on the active entry.
- Delete button per card: warns if the id is referenced from any `(pose, dir)`; on confirm, removes the entry and drops references (or replaces with the kit's first palette entry — TBD; safer to warn-and-block).

### Per `(pose, direction)` view

The today's "weapon-pose grid + variants list" UI (`renderWeaponPoseGrid` + `renderVariantsList`) is replaced with a **palette reference picker**:

- One "Primary" slot showing the currently-referenced palette entry's thumbnail + id.
- A row of "Variant" slots (one per id in `weaponVariants`), each showing thumbnail + id, with a delete button.
- "+ Add variant" button: opens a palette browser modal listing all entries; user clicks one to add its id to `weaponVariants[]`.
- Clicking the Primary slot: same browser modal; user picks a new id for `(pose, dir).weapon`.
- Clicking any slot makes that palette entry the **active palette entry** (nudge buttons start affecting it). Edits propagate to every `(pose, dir)` referencing the same id — exactly the "edit once, reuse everywhere" property.

The existing `state.selectedVariantIdx` becomes `state.activePaletteId` (the id, not an index). `state.weaponActive` stays as a "weapon edit mode" flag.

### Backwards-compat in the editor

Loading a kit with the new shape: straightforward.

Loading a kit with the OLD shape (mid-migration): the editor refuses with an error toast — "kit needs migration; run `node scripts/migrate-to-weapon-palette.mjs`". Single migration moment, no dual-shape support inside the editor.

### What gets removed from the editor

- `kit.weapon.facings` editing UI (the source-facing dot/badge rendering for the canonical mapping).
- Inline `weapon: { src, transform, x, y, rot, flipX }` authoring per `(pose, dir)`.
- The "weapon-pose grid below the main facing grid" in body-pose views (replaced by the palette picker).

### What stays

- The `WEAPON_POSE_ID = 'weapon'` view (where users author the source PNG pixel-art for `musket-brown-bess-N`/`-NW`/`-W`). Unchanged. Pixel edits there continue to flow via `pixel-edits.json` → `bake-weapon-edits.mjs`.

## Test plan

- Resolver unit tests cover: palette lookup, variant pool resolution, unknown id handling, missing pose entries.
- Migration script test: feed a synthetic kit with mixed inline+explicit weapon entries; verify palette dedup, id assignment, and reference rewrite. Re-run produces no diff (idempotency).
- Atlas test: kit with palette referencing only `src: 'N'` packs only N source PNG; kit referencing all 3 sources packs all 3.
- Sprite-pass: existing weapon-render integration tests (if any) updated to reference palette ids; otherwise smoke-tested in the lab.
- Editor: manual — load `line-infantry`, switch poses, confirm weapon thumbs match pre-migration visuals; nudge a palette entry from one pose view, switch to another pose referencing the same id, confirm the change is visible.

## Risks

- **Palette explosion.** If every `(pose, dir)` has unique placement, the palette could be ~64+ entries. Mitigated by listing flat (scrollable grid in editor) and auto-generated stable ids.
- **Migration mis-handling explicit `src` overrides.** The single existing override (`hit.W: src='E'`) plus the few `flipX: true` variants must be preserved as distinct palette entries — the migration must not collapse them with their non-overridden siblings. Test covers this.
- **Lost authoring intent.** Some inline entries today carry implicit "this slot is just a placement tweak on the canonical source"; in palette form, that intent is gone — every entry is fully explicit. The migration faithfully captures the *current visual* but loses the *authoring history*. Acceptable per design.
