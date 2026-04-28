# Plan: weapon pose palette in component editor

Spec: `docs/superpowers/specs/2026-04-28-weapon-pose-palette-design.md`. Working in main directory (no worktree).

The work splits into a runtime/data half (steps 1–4) and an editor half (steps 5–8). Each step is its own commit — the runtime half stays internally consistent on its own, then the editor half lands on top.

## Step 1 — Schema rewrite (TDD)

Edit `src/render/poses/resolver.ts`:

- Rename `WeaponPaletteEntry` → `WeaponOrientation`. **Drop the `id: string` field**. All other fields (`src`, `transform?`, `x`, `y`, `rot`, `flipX?`) carry over verbatim.
- Drop `WeaponPalette` type alias.
- Update `PoseFacingEntry`:
  - Remove `weapon?: string` and `weaponVariants?: string[]`.
  - Add `weapons?: WeaponOrientation[]` (`[primary, ...variants]`; runtime picks `entity.id % weapons.length`).
- Drop `resolvePaletteEntry`, `resolvePoseWeaponEntry`. Their consumers move to direct array indexing.
- Rewrite `readWeaponVariantPool(poses, pose, facing): WeaponOrientation[]`: returns `(pose, facing).weapons ?? []`. Drop the palette parameter.
- `resolveWeaponSpriteKey(layerPrefix, orientation: WeaponOrientation)` survives unchanged in shape — same fields are read.

Edit `src/render/poses/kit-loader.ts`:

- Drop `weaponPalette?: WeaponPaletteEntry[]` from `KitConfig`. Update import to `WeaponOrientation`.

Update `src/render/poses/resolver.test.ts`:

- Keep `buildDirLookup` tests.
- Drop palette-resolution tests (`resolvePaletteEntry`, `resolvePoseWeaponEntry`).
- Add tests for `readWeaponVariantPool` in its new shape:
  - Returns `weapons[]` directly when set.
  - Returns `[]` for missing pose / facing / `weapons` field.
  - Order preserved (primary first).
- Update any `resolveWeaponSpriteKey` test to drop `id` from the input.

`src/render/poses/weapon-resolution.test.ts` (atlas-side `pickWeaponUv`): update only call sites that constructed test palette entries — drop `id`. UV math is unchanged.

Tests will fail at the boundaries that consume `weaponPalette` (atlas, sprite-pass) — that's expected; steps 3 + 4 fix them.

**Commit:** `refactor(weapons): inline orientations replace palette indirection (schema only)`

## Step 2 — Migration script (TDD)

Write `scripts/migrate-weapon-palette-to-inline.mjs` (Node ESM, idempotent). Tests in `scripts/migrate-weapon-palette-to-inline.test.mjs`.

Functions:

- `inlineOne(paletteEntry)`: strips `id`, returns `WeaponOrientation`.
- `migrate(kit)`:
  - If `kit.weaponPalette` is absent → return kit unchanged (idempotent).
  - Build `byId: Map<string, WeaponOrientation>` from `kit.weaponPalette`.
  - For every `(pose, facing)` entry:
    - Build `weapons[] = [...primaryIfAny, ...variantsIfAny].map(id => byId.get(id))`. Skip unknown ids (warn).
    - Set `entry.weapons = weapons` if non-empty; otherwise omit the field.
    - Delete `entry.weapon` and `entry.weaponVariants`.
  - Delete `kit.weaponPalette`.
  - Return mutated kit.

CLI: `node scripts/migrate-weapon-palette-to-inline.mjs` walks `public/components/kits/index.json`, migrates each kit, writes back with 2-space indentation. Trailing newline preserved.

Tests:

- A kit with one `(pose, facing).weapon = "n-0"` referencing `weaponPalette[{ id: 'n-0', src: 'N', x: -7, y: -3, rot: 0 }]` → produces `(pose, facing).weapons = [{ src: 'N', x: -7, y: -3, rot: 0 }]` and no `weaponPalette`.
- A kit with `weapon` + `weaponVariants: ['a', 'b']` → produces `weapons = [primary, a, b]` in that order.
- Unknown id in `weaponVariants` → skipped, console.warn called once.
- Idempotence: re-run on migrated kit → no change.
- `transform` and `flipX` fields round-trip correctly.

**Commit:** `feat(weapons): migration script — palette → inline orientations`

## Step 3 — Run migration on real kits

```
node scripts/migrate-weapon-palette-to-inline.mjs
```

Inspect the diff against `line-infantry.json`, `cuirassier.json`, `cannon-12.json` (the index). Verify:

- `weaponPalette` is gone.
- A spot-check (e.g. line-infantry.json `idle.S`): pick the cell, look up the previous `weapon` id in the original palette (via git show `HEAD~`), confirm the inlined `weapons[0]` matches.

**Commit:** `chore(kits): migrate to inline weapon orientations (no behavior change)`

## Step 4 — Atlas + sprite-pass rewrites

Edit `src/render/poses/atlas.ts`:

- Replace the `kit.weaponPalette` walk in the source-UV-packing pass with a walk of `kit.poses[*][*].weapons[]`.
- Dedupe on `(layerPrefix, src, transform)` — pack each combo once. Use a `Set<string>` keyed `${layerPrefix}|${src}|${transform ?? 'none'}`.

Edit `src/render/passes/sprite-pass.ts`:

- The per-kit weapon offset map (currently keyed by palette id) becomes keyed by `(pose, facing, variantIdx)`. Build it by walking `kit.poses[pose][facing].weapons[]` and storing the orientation's `(x, y, rot, flipX)` plus its resolved sprite-key + transform.
- The dying-pose lookup (currently looks up the palette entry referenced by `kit.poses.dying[<facing>].weapon`) becomes `kit.poses.dying[<facing>].weapons?.[0]` — same idea, no palette indirection.
- `readWeaponVariantPool` call sites lose the palette argument.

Run all unit tests + the sanity test. Manual smoke: `npm run dev`, load the main scene, confirm soldiers render with their weapons in the same positions as before the migration. Tolerance: identical rendering (this is a refactor, not a behavior change).

**Commit:** `refactor(weapons): atlas + sprite-pass read inline orientations`

## Step 5 — Save-kit Vite plugin (TDD)

Write `src/dev/save-kit-plugin.ts` exporting `saveKitPlugin(): Plugin`. The plugin:

- Hooks `configureServer(server)`.
- Adds middleware on `POST /api/save-kit/:id`:
  - Read JSON body. If parse fails → 400 with `{ error: 'invalid json' }`.
  - If `body.id !== params.id` → 400 with `{ error: 'id mismatch' }`.
  - Resolve target path: `<projectRoot>/public/components/kits/${params.id}.json`. Reject if `params.id` contains `/`, `\`, or `..` → 400.
  - Write file with 2-space indent and trailing newline.
  - Respond 200 `{ ok: true }`.
  - On any unexpected error → 500 `{ error: <message> }`.

Tests in `src/dev/save-kit-plugin.test.ts` using a mock Connect-style middleware harness:

- Happy path writes file with correct contents.
- Id mismatch returns 400, no file written.
- Path traversal in param returns 400, no file written.
- Invalid JSON body returns 400.

Edit `vite.config.ts`: import and register `saveKitPlugin()` (in `plugins` array). Vite's plugin system runs `configureServer` only in `vite serve`, so this is dev-only by construction.

**Commit:** `feat(dev): save-kit endpoint Vite plugin`

## Step 6 — Editor: pose dropdown + pose-aware rendering

Edit `components.html`:

- Add a pose `<select id="pose-select">` to the left sidebar, labeled "Pose". Options: `idle`, `walking`, `running`, `make-ready`, `present`, `fire`, `hit`, `dying`. Default `idle`.

Edit `src/dev/component-preview.ts`:

- Add `currentPose: string = 'idle'`.
- Add `kit.poses` to the editor's `KitConfig` type (currently only `facings` is typed).
- Modify `layersForFacing(facing)`: if a pose is selected and `kit.poses?.[currentPose]?.[facing]?.layers` exists, use that. Otherwise fall back to `kit.facings[facing].layers` (current behavior).
- Wire the dropdown's `change` event to update `currentPose` and `void renderPreview()`.

Manual verification: change pose dropdown, observe the body sprites on the center grid update to the correct pose layers.

**Commit:** `feat(editor): pose dropdown + pose-aware layer rendering`

## Step 7 — Editor: weapon overlay rendering

Write `src/dev/weapon-rendering.ts` exporting:

```ts
export interface WeaponOrientation { src, transform?, x, y, rot, flipX? }
export async function paintWeaponInto(
  target: CanvasRenderingContext2D,
  weaponPath: string,           // PNG URL
  orientation: WeaponOrientation,
  options: { applyOffset: boolean; bodyCenter?: [number, number] },
): Promise<void>
```

Behavior:

- Load PNG (via existing `loadImage` helper, exported from component-preview or duplicated here — refactor below).
- If `applyOffset`:
  - Translate to `bodyCenter` (defaults to canvas center).
  - Translate by `(orientation.x, orientation.y)`.
  - Rotate by `orientation.rot` degrees.
  - Apply `transform` (flipX/flipY/rot180) and standalone `flipX` via canvas scale().
  - Draw image centered.
- Else (raw, used by right-side source grid):
  - Just `drawImage(img, 0, 0)` — no offset, no transform.

Refactor: hoist `loadImage` and `getRecoloredCanvas` into `src/dev/image-cache.ts`, re-exported from `component-preview.ts` and consumed by `weapon-rendering.ts`. Single shared cache.

Edit `component-preview.ts`:

- After painting body layers in each center-grid cell, look up `kit.poses?.[currentPose]?.[facing]?.weapons?.[0]`. If set, also call `paintWeaponInto` with the weapon's PNG path resolved via `componentsById.get(`${kit.weapon.layerPrefix}-${weapon.src}`).path`.

Tests for `weapon-rendering.ts` are skipped in this step (canvas-based rendering is a pain to unit-test without a headless renderer; covered by the existing sanity + visual inspection).

Manual verification: select line-infantry, switch through poses, verify the weapon appears on each cell at the right position. Compare visually against a `npm run dev` runtime view of the same poses.

**Commit:** `feat(editor): weapon overlay on center-grid cells`

## Step 8 — Editor: 3x3 source grid + edit-control strip + authoring flow

Edit `components.html`:

- New right-side panel `<div id="weapon-source-panel">` containing:
  - `<div id="weapon-source-grid">` with eight `<button class="weapon-source-cell" data-facing="...">` cells laid out 3x3 (compass layout, center empty), each holding a `<canvas>`.
  - `<div id="weapon-edit-strip">` with:
    - A working-orientation thumbnail `<canvas>`.
    - Read-only spans for `x`, `y`, `rot`, `flipX`.
    - Buttons: `Mirror`, `Rotate 90°`, `Save Variant`, `Save Kit`.
    - A help line: "Arrow keys: nudge 1px · Shift+Arrow: nudge 8px".

CSS: position the new panel to the right of the existing center grid; reuse the `lab-panel` styling.

Edit `src/dev/component-preview.ts`:

- New module-level state:
  - `targetCell: { pose: string; facing: string } | null = null`
  - `workingOrientation: WeaponOrientation | null = null`
- `renderWeaponSourceGrid()`: paints each source cell's canvas with the raw weapon PNG for that facing (`paintWeaponInto` with `applyOffset: false`). Re-runs on kit change.
- Center-grid click handler: clicking a cell sets `targetCell = { pose: currentPose, facing }`, highlights it, and resets `workingOrientation = null`. (We may want this to NOT reset a working orientation if one is in progress — see "Refinement" below.)
- Source-grid click handler: clicking a cell sets `workingOrientation = { src: facing, x: 0, y: 0, rot: 0 }` (no transform, no flipX). If `targetCell` is set, immediately re-render that center cell with the weapon overlaid (using the working orientation, not the saved one).
- Keyboard handler attached to the editor body when `workingOrientation` is set:
  - ArrowLeft/Right: `x ∓ 1` (Shift: 8).
  - ArrowUp/Down: `y ∓ 1` (Shift: 8).
- Mirror button: `workingOrientation.flipX = !workingOrientation.flipX || undefined`.
- Rotate 90 button: `workingOrientation.rot = (workingOrientation.rot + 90) % 360`.
- Save Variant button: appends a deep clone of `workingOrientation` to `kit.poses[targetCell.pose][targetCell.facing].weapons` (creating the array and pose entries as needed). Re-renders the affected cell. Clears `workingOrientation = null` (next click on a source starts a new working orientation).
- Save Kit button: POST `JSON.stringify(kit)` to `/api/save-kit/${kit.id}` (in `import.meta.env.DEV`); else trigger a download via a Blob URL. Surfaces a brief toast on success/failure.

**Variant indicator**: in the center grid cell render path, after painting, draw a small badge (e.g. white-on-black `×N`) in the bottom-right when `weapons.length >= 2`.

**Refinement (not refactor — actual fix):** the click-to-target-then-click-to-source flow risks confusing state. UX rule: clicking a center cell sets target and clears working. Clicking a source cell sets working (requires target — show a hint if no target is selected). Mirror/Rotate/arrow only operate when working is set.

Manual verification:

1. `npm run dev`, open `components.html`.
2. Select line-infantry, pose `present`, facing S in the center grid.
3. Click S in the source grid. Weapon appears on the body at offset (0,0), rot 0.
4. Press Right arrow 5 times, then Down arrow 3 times. Weapon translates.
5. Click Rotate 90°. Weapon rotates.
6. Click Mirror. Weapon flips horizontally.
7. Click Save Variant. Variant indicator updates.
8. Click another source facing → new working orientation. Save Variant. Indicator now shows `×2`.
9. Click Save Kit. Verify the file on disk is updated (`git diff public/components/kits/line-infantry.json`).
10. Reload the page. The saved orientations are still there.

**Commit:** `feat(editor): 3x3 weapon source grid + click-to-author flow`

## Step 9 — End-to-end runtime check

Run `npm run dev` for the main scene (`index.html`). Confirm:

- Soldiers render with weapons identical to pre-migration.
- Newly-authored variants from Step 8 appear in the runtime when the variant index for an entity selects them.

If any visible regression vs. the pre-migration baseline: fix in the relevant runtime file (atlas / sprite-pass). The migration is supposed to be a 1:1 data transformation — any visual difference is a bug.

**No commit unless a fix is needed.**

## Risk register / fallbacks

- **Migration corrupts kits.** Mitigation: idempotent script + the round-trip test in Step 2; commit migrated kits in their own commit so a single revert undoes the data change.
- **Atlas dedup miscounts.** Mitigation: unit test in `atlas.test.ts` (or wherever the source-UV pack is tested) — feed a synthetic kit with two `weapons[]` entries sharing `(layerPrefix, src, transform)` and assert the packed count.
- **Save-kit endpoint security.** Mitigation: dev-only by construction (Vite plugin); plus path traversal guard and id-match check.
- **Editor state confusion** (target + working both partially set). Mitigation: the explicit hint when no target is selected; arrows / mirror / rotate are no-ops without working.

## What's intentionally not in this plan

- Delete-variant button. Add later if needed.
- Per-soldier variant override.
- Editing a previously-saved orientation in place (must append + manually edit JSON).
- Drag-and-drop in the editor.
- Headgear authoring changes.
