# Plan: weapon palette

Spec: `docs/superpowers/specs/2026-04-27-weapon-palette-design.md`. Working in main directory (no worktree).

## Step 1 — Resolver types & helpers (TDD)

Edit `src/render/poses/resolver.ts`:

- Add `WeaponPaletteEntry` interface and `WeaponPalette = readonly WeaponPaletteEntry[]` alias.
- Simplify `WeaponBlock` to `{ layerPrefix: string }`. Drop `WeaponFacingEntry` and the `facings` field.
- Update `PoseFacingEntry`:
  - `weapon?: string` (palette id; was: `WeaponPoseTransform` object).
  - `weaponVariants?: string[]` (was: `WeaponPoseTransform[]`).
- Drop `WeaponPoseTransform` interface (subsumed by `WeaponPaletteEntry`).
- Add `resolvePaletteEntry(palette: WeaponPalette, id: string): WeaponPaletteEntry | null`.
- Add `resolveWeaponSpriteKey(layerPrefix: string, entry: WeaponPaletteEntry): { spriteKey: string; transform: 'none' | WeaponFacingTransform }`. Returns `{ spriteKey: '<layerPrefix>-<src>', transform: entry.transform ?? 'none' }`.
- Replace `resolveWeaponPoseTransform` with `resolvePoseWeaponEntry(poses, pose, facing, palette): WeaponPaletteEntry | null`. Looks up `(pose, facing).weapon` id, resolves through palette. No mirror inheritance (that was tied to `kit.weapon.facings`).
- Replace `readWeaponVariantPool(poses, palette, pose, facing): WeaponPaletteEntry[]`. Pools `[primary, ...variants]`, resolves each id, drops unknowns with `console.warn`.
- Drop `resolveWeaponFacing` and `applyFacingTransform` (no longer needed — palette entries are explicit).
- Drop `normalizeWeaponPoseTransform` (no inline objects to normalize).

Rewrite `src/render/poses/resolver.test.ts`:
- Keep `buildDirLookup` tests untouched.
- Drop tests for `resolveWeaponFacing`, `resolveWeaponPoseTransform`, and `readWeaponVariantPool` in their old form.
- Add tests for:
  - `resolvePaletteEntry`: returns entry by id; returns null on miss.
  - `resolveWeaponSpriteKey`: builds `<layerPrefix>-<src>`; passes through `transform`; defaults to `'none'`.
  - `resolvePoseWeaponEntry`: returns palette entry when `(pose, facing).weapon` is set; null when absent or pose missing.
  - `readWeaponVariantPool`: returns `[primary, ...variants]` resolved; empty when no weapon id; skips unknown ids.

`src/render/poses/weapon-resolution.test.ts` covers `pickWeaponUv` (atlas-side); update only the call sites that referenced `WeaponBlock.facings` — the UV math is unchanged.

`src/render/poses/kit-loader.ts`: update `KitConfig` interface — `weaponPalette?: WeaponPaletteEntry[]`.

## Step 2 — Migration script

Write `scripts/migrate-to-weapon-palette.mjs` (Node ESM, idempotent). Tests in `scripts/migrate-to-weapon-palette.test.mjs`.

Functions:

- `effectiveSpriteSource(inlineEntry, kitFacings, dir)`: returns `{ src, transform }`.
  - If `inlineEntry.src` is set: return `{ src: inlineEntry.src, transform: inlineEntry.transform ?? 'none' }`.
  - Else, look up `kitFacings[dir]`. If `src === 'self'`, return `{ src: dir, transform: 'none' }`. Else `{ src, transform }`.
- `tupleKey(src, transform, x, y, rot, flipX)`: returns a stable string key for dedup.
- `buildPalette(kit)`: walks every `(pose, dir).weapon` and `weaponVariants[]`, resolves effective tuples, dedupes, assigns ids `<src-lower>-<n>`. Returns `{ palette, idByTuple }`.
- `rewriteKit(kit, palette, idByTuple)`: replaces inline objects with palette ids; drops `kit.weapon.facings`; sets `kit.weaponPalette`.
- `migrate(kit)`: orchestrates. Idempotent: returns kit unchanged if `weaponPalette` already exists.

Migration follows the spec's rules:
- The implicit canonical mapping (`kit.weapon.facings`) is consulted ONLY for inline entries that omit `src`. Result: every palette entry has an authored source facing (N, NW, W for line-infantry).
- Sort palette by id for deterministic output.

CLI: `node scripts/migrate-to-weapon-palette.mjs` walks `public/components/kits/index.json`, migrates each kit, writes back prettified JSON.

Tests:
- Synthetic kit with one inline `weapon: { x: 0, y: 6, rot: 0 }` for `idle.S` (no explicit `src`): migration consults `kit.weapon.facings.S = { src: 'N', transform: 'flipY' }`, produces palette entry `{ id: 'n-0', src: 'N', transform: 'flipY', x: 0, y: 6, rot: 0 }` and rewrites `idle.S.weapon = 'n-0'`.
- Two distinct `(pose, dir)` slots with identical effective tuples → one palette entry, both reference the same id.
- Inline entry with explicit `src: 'E', transform: 'none'` (the existing `hit.W` case) → palette entry with `src: 'E'` (which the editor/atlas need to handle — see Step 3 note).
- Re-run on a migrated kit → no diff.

> Note on `hit.W` `src: "E"`: the W facing's canonical source is `W` (self), so this override pulls from a non-canonical facing. We have two options:
> 1. Honor the override as-is (palette entry gets `src: 'E'`). Atlas builder must then know to pack the E source PNG.
> 2. Re-resolve the override via `kit.weapon.facings.E = { src: 'W', transform: 'flipX' }` to get the underlying authored source: `{ src: 'W', transform: 'flipX' }`. Equivalent visual, palette stays in authored sources only.
>
> Plan goes with option 2 — keeps the atlas concerned only with authored sources (N, NW, W). Migration applies this resolution recursively in `effectiveSpriteSource`.

## Step 3 — Run migration on `line-infantry.json`

Run `node scripts/migrate-to-weapon-palette.mjs`. Inspect the diff:
- `kit.weaponPalette` populated with the deduped entries (~30–60 expected).
- Every `(pose, dir).weapon` is a string id.
- `kit.weapon.facings` removed; only `layerPrefix` remains in `kit.weapon`.

Commit the migrated JSON in the same change as the runtime updates so `main` is never in a partially-migrated state.

## Step 4 — Atlas builder

Edit `src/render/poses/atlas.ts:collectWeaponRefs`:

- Replace the iteration over `WEAPON_SOURCE_FACINGS` with: walk every kit's `weaponPalette`, collect a `Set<Facing>` of `entry.src` values.
- Use that set to pull the source PNGs (`<layerPrefix>-<facingToComponentSuffix(src)>`).
- Dedup across kits sharing the same `layerPrefix` (existing behavior).

Existing tests in `src/render/poses/weapon-resolution.test.ts` should still pass — the UV math is unchanged. Add a kit-loader fixture test if there isn't already one covering palette-driven source collection.

## Step 5 — Sprite-pass runtime

Edit `src/render/passes/sprite-pass.ts`:

- Replace the `weaponUvByPrefix: Map<layerPrefix, Array<UV>>` (indexed by runtime facing 0..7) with `weaponUvByPaletteId: Map<layerPrefix, Map<paletteId, UV>>`.
  - Build by iterating each kit's `weaponPalette`: for each entry, compute UV via `pickWeaponUv(poseAtlas, layerPrefix, entry.src, entry.transform ?? 'none', ...)`.
- In the per-entity loop (around line 487):
  - Look up `kit.poses[editorPose][facingLetter].weapon` (palette id) and `weaponVariants[]` (id array). Use the existing `runtimePoseToEditorPoseName(pose)` helper.
  - Build pool `[primaryId, ...variantIds]`, resolve each via the kit's palette → `WeaponPaletteEntry`. Drop unknowns.
  - If pool empty → emit no weapon quad (skip this entity).
  - Pick `chosenEntry = pool[entity.id % pool.length]`.
  - UV = `weaponUvByPaletteId.get(layerPrefix).get(chosenEntry.id)`.
  - Use `chosenEntry.x`, `.y`, `.rot`, `.flipX` for the quad placement (replaces the current `offset.x` etc).

The `RUNTIME_FACING_IS_BEHIND` table is unchanged — still indexed by facing.

## Step 6 — Editor: drop deprecated UI

Edit `public/components-editor.html`:

- Remove `kit.weapon.facings` rendering (mirror badges, source dots, the source-facing assignment click handler).
- Remove the inline `weapon` authoring path: today's `setActiveWeaponXform`, `nudge`, `rotateWeapon`, `resetSelected` all act on `state.kit.poses[poseId][facing].weapon` as an object. Repoint these to act on the active palette entry (`state.kit.weaponPalette[idx]` where `state.activePaletteId` selects the entry).
- Strip `composeBase`'s old per-pose-source override path (`readWeaponPoseSourceOverride`) — replaced by palette lookup. The body-pose preview now: look up `(pose, dir).weapon` id → palette entry → render the weapon at that entry's `(x, y, rot, flipX)`.
- `compositeWeaponOverlay` and `compositeVariantWeaponOverlay` collapse into one `compositePaletteEntryOverlay(destCtx, paletteEntry)` that takes a palette entry directly.

## Step 7 — Editor: palette view

Add a new pose option `WEAPON_PALETTE_ID = 'palette'` to the pose dropdown.

When `state.poseId === WEAPON_PALETTE_ID`:
- Body preview canvas hides (or shows a placeholder).
- A flat grid of palette cards renders in the existing variants section (or a new dedicated div). Each card:
  - 96×108 thumbnail rendered via `compositePaletteEntryOverlay`.
  - Id label.
  - `(x, y, rot)` readout.
  - Click selects → `state.activePaletteId = entry.id`. Selected card border highlights.
  - Hover delete button: warn-and-block if any `(pose, dir)` references this id (count references, list the first few).
- "+ Add entry" tile at the end: appends `{ id: autoId('n'), src: 'N', x: 0, y: 0, rot: 0 }`. Selects the new entry.
- A 3×3 source-facing picker (same widget as today's weapon-pose grid, but shown ALWAYS in palette view, not just per-pose) lets the active palette entry's `src` change. Click `S` → entry's `src = 'S'`. Atlas picker decides whether the click rewrites `src` or `transform` (e.g., picking S when only N/NW/W are authored → migration-style rewrite to `{ src: 'N', transform: 'flipY' }`). Use the current `kit.weapon.facings`-derivation logic, but stored only at runtime (not persisted on the kit).
- Nudge keyboard handlers (`←↑↓→`, `Q`/`E`, `F` for flipX) act on the active palette entry.

`scheduleKitAutoSave` continues to persist the entire kit, including `weaponPalette`.

## Step 8 — Editor: per-pose palette picker

In a body-pose view (any `state.poseId !== WEAPON_PALETTE_ID && !== WEAPON_POSE_ID`):

Replace `renderWeaponPoseGrid` + `renderVariantsList` with `renderPaletteRefPicker`:

- "Primary" slot: thumb + id of `kit.poses[poseId][facing].weapon`. "Change" button opens a palette-browser modal.
- "Variants" row: one slot per id in `weaponVariants[]`, each with thumb + id + delete button. "+ Add variant" button opens the palette-browser modal.
- Clicking a slot sets `state.activePaletteId` to that id → nudge buttons start affecting that palette entry. Renders propagate to all `(pose, dir)` referencing it.
- Palette-browser modal: simple grid of all palette entries; click to select; "Cancel" closes without changes.

Same autosave path persists `weapon` and `weaponVariants` as id strings/string arrays.

## Step 9 — Cleanup

Remove now-dead code:

- `scripts/strip-weapon-overrides.mjs` (subsumed by the palette migration).
- `WeaponFacingEntry`, `WeaponPoseTransform`, `applyFacingTransform`, `normalizeWeaponPoseTransform`, `resolveWeaponFacing`, `resolveWeaponPoseTransform` exports from `resolver.ts` if nothing else imports them after Step 1.
- Any editor helpers that operated on inline `weapon` objects (`readWeaponPoseSourceOverride`, etc.) if they have no remaining callers.

## Step 10 — Smoke test

- `npm run lint && npm run typecheck && npm test` (or whatever the project runs).
- Open the editor, load `line-infantry`:
  - Confirm palette view shows entries; nudge one and switch to a body pose to see propagation.
  - Cycle through `idle`/`present`/`fire`/`make-ready`/`hit`/`dying` — primary weapon thumb visible per facing, matching the pre-migration look.
  - Switch to `walking` and `running` — multi-frame body, single weapon id reused across frames.
- `npm run dev` → open the lab, march a regiment, fire it. Confirm muskets render in formation with the same visual variety as before (variants picked by entity-id mod pool length).

## Notes

- The `bake-weapon-edits.mjs` flow (pixel edits on source musket PNGs) is untouched. It still keys edits by component id (`musket-brown-bess-<facing>`), independent of the palette.
- The `slice-component-atlas.mjs` flow is untouched. Body atlases don't carry the weapon.
- Keep `public/components/index.json`'s pose-suffixed musket entries (`musket-brown-bess-south-fire`, etc.) for now — unused, but removing them is a separate cleanup. Note in PR description.
