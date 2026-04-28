# Plan: per-pose weapon attachment

Spec: `docs/superpowers/specs/2026-04-27-per-pose-weapon-attachment-design.md`. Branch: `austerbitz-poses` (work in main working dir, no worktree).

## Step 1 — Schema types
Edit `src/render/poses/pose-config.ts` (or the nearest types file for kit JSON):
- Add `WeaponFacingTransform = 'flipX' | 'flipY' | 'rot180'`.
- Add `WeaponFacingEntry = { src: 'self' } | { src: Facing; transform: WeaponFacingTransform }`.
- Add `WeaponBlock = { layerPrefix: string; facings: Record<Facing, WeaponFacingEntry> }`.
- Add `PoseFacingEntry = { layers: string[]; weapon?: { x: number; y: number; rot: number } }`.
- Update the kit type so `poses[poseId][facing]` is `string[] | PoseFacingEntry` (string array kept for back-compat during migration; loader normalizes).
- Add optional `weapon?: WeaponBlock` to the kit type.

## Step 2 — Loader normalization
Find the kit loader (likely `src/render/poses/atlas.ts` or a sibling). Extend it to:
- Normalize each `poses[pose][facing]` to `PoseFacingEntry` shape (wrap bare arrays as `{ layers: arr }`).
- Resolve weapon facing: given `kit.weapon.facings[facing]`, return `{ spriteKey, transform }` where `spriteKey = kit.weapon.layerPrefix + '-' + (entry.src === 'self' ? facing : entry.src)` and `transform = entry.transform ?? 'none'`.
- Resolve per-pose weapon transform with mirror-source fallback: `(x, y, rot) = poses[pose][facing].weapon ?? deriveFromMirrorSource(poses[pose][src].weapon, transform)` where the derivation negates `rot` and flips `x`/`y` per the transform.

Add unit tests in `src/render/poses/atlas.test.ts` (or new file) for:
- Source facing returns its own sprite key with no transform.
- Derived facing returns source's sprite key with the right transform.
- Pose-level transform inherits from mirror source when omitted.
- Pose-level transform overrides when authored.

## Step 3 — Migrate `line-infantry.json`
Write `scripts/migrate-weapon-poses.mjs` (Node ESM, no deps beyond `node:fs`):
- Read `public/components/kits/line-infantry.json`.
- Add the `weapon` block (3 authored / 5 derived facings — N, NW, W are authored).
- Strip every layer matching `^musket-brown-bess-` from `facings.*.layers` and `poses.<pose>.<facing>.layers`.
- Convert each `poses.<pose>.<facing>` from `string[]` to `{ layers, weapon: { x: 0, y: 0, rot: 0 } }`. Use sensible per-pose seed offsets pulled from observation: idle/make-ready/present/fire/hit/dying — a small per-pose lookup table at the top of the migration script (e.g. `fire: { x: 0, y: -1, rot: 0 }`).
- Delete `poses.musket` (replaced by editor weapon view).
- Write back, prettified (2-space JSON).
- Migrate `public/components/pixel-edits.json`: read each `["line-infantry"][pose][facing]["musket-brown-bess-<facing>-<pose>"]` entry and rewrite as `["line-infantry"][pose][facing]["weapon"]`. Warn (don't drop) any entries whose facing is derived (NE, SE, E, SW, S) so the user can manually decide whether to discard or merge into the source facing.

Run once: `node scripts/migrate-weapon-poses.mjs`. Commit the migrated JSONs.

## Step 4 — Editor: weapon-only handle
Edit `public/components-editor.html`:
- In the layer/pose state, track `state.weapon = { x, y, rot }` per (pose, facing). Hydrate from kit JSON on load, persist via debounced autosave.
- Add a new autosave POST endpoint `POST /api/kits/<unit>` (mirror `/api/offsets`) — extend `vite.config.ts` with the route. Body: `{ weapon: { facings: { … } }, poses: { <pose>: { <facing>: { weapon: {…} } } } }`. Server overwrites only those nested keys (deep-merge on top of disk).
- Render the weapon sprite as the top-most layer when a body pose is selected and `kit.weapon` exists. Resolve per spec: facing-share + per-pose transform.
- Mouse drag on the canvas while in "weapon move" mode (new toolbar mode, default-on when a body pose is active) updates `state.weapon[pose][facing].(x, y)`. Existing per-layer drag still works for body layers via mode toggle.
- `Q` / `E` keys rotate `±1°`; `Shift+Q` / `Shift+E` rotate `±15°`. Updates `rot`. Wraps to `(-180, 180]`.
- Pixel-paint while a body pose is selected and the active layer is the weapon writes to `pixel-edits[unit][pose][facing]["weapon"]` (existing autosave path, just a new component key).
- Add the `weapon` entry to the pose dropdown (replacing `musket`); selecting it shows the 3 authored facings with no body, exactly the existing "musket" pose UX, but reading from `kit.weapon.layerPrefix`.

## Step 5 — Facings-grid mirror badges
In `public/components-editor.html`:
- For each derived facing in the 3×3 grid, render a small label inside the cell: `← N flipY` / `← NW rot180` / `← W flipX`.
- Source facings (N, NW, W) render with a subtle "source" marker (dot or border). When the user selects a derived facing while a weapon edit is active, show a one-time hint: "Pixel edits live on the source facing — switch to N to edit base sprite."

## Step 6 — Runtime weapon pass
Identify where the body pose draws today (likely `src/render/passes/pose-pass.ts` or `src/render/british-soldier-sprite.ts`). After the body draws:
- Look up the resolved weapon facing (`spriteKey`, `transform`) and per-pose `(x, y, rot)`.
- Sample the weapon sprite from the atlas. If `transform != 'none'`, apply it (UV swap for flips, rotated quad for `rot180`).
- Compose with the per-pose `(x, y, rot)` — translate by `(x, y)` then rotate by `rot` around sprite center.
- Composite the per-pose pixel overlay (`pixel-edits[unit][pose][facing]["weapon"]`) on top, in base-sprite local coords transformed the same way.

The weapon draws as one extra textured quad per soldier per frame. No new shader needed if the existing pose pass supports rotated quads; otherwise, add rotation to the vertex math.

## Step 7 — Stub kits for cuirassier + a gunner
Create `public/components/kits/cuirassier.json` and `public/components/kits/foot-artillery.json` (name to match existing unit data). Each gets:
- A `weapon` block with `layerPrefix: "saber-cuirassier"` / `"plunger-rammer"` and 3-source / 5-derived facings.
- Placeholder body layers (use existing line-infantry body if no cavalry/gunner art exists yet — flag visually with a debug tint).
- Each body pose × facing seeded with `weapon: { x: 0, y: 0, rot: 0 }`.

Add placeholder weapon sprites (just colored rectangles 4×16 px) into `public/sprites/` and register them in `index.json` under the new prefixes. The point is to exercise the system end-to-end on >1 unit, not to ship art.

Skip this step if the user says it's overkill; the core change works on line-infantry alone. Mention in the summary.

## Step 8 — Verify
1. `npm run typecheck` — no TS errors.
2. `npm test` (or `npx vitest run`) — atlas tests pass.
3. `npm run dev` — open `/components-editor.html`. For line-infantry:
   - Select `idle/S` — musket renders on the body, draggable, rotatable.
   - Drag and rotate, switch poses, switch facings, switch back — values persist.
   - Pixel-paint a fire-pose flash on the musket; switch to `make-ready/S` — flash is gone (per-pose). Switch back to `fire/S` — flash returns.
   - Select `weapon` pose — only the base musket renders, 3 authored facings paintable, derived facings show mirror badge.
4. `npm run build` — no errors.

## Step 9 — Commit
Single commit per logical chunk:
- Schema types + loader + tests
- Migration script + migrated JSONs
- Editor changes
- Runtime weapon pass
- Stub kits (if step 7 done)

Do not push.

## Notes
- Work in the existing `austerbitz-poses` worktree at `/Users/andrewcote/Documents/software/austerbitz-poses`.
- Subagent-driven: dispatch Steps 1+2 (schema/loader), Steps 3 (migration), Steps 4+5 (editor), and Step 6 (runtime) as separate subagent tasks where they don't share state. Step 8 (verify) is the main thread.
- Don't auto-stash dirty trees — commit on top.
- If the loader's mirror-source derivation gets hairy, keep it explicit (8-case lookup) instead of clever (transform composition).
