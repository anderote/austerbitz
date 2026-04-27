# Plan: south-facing soldier firing poses

Spec: `docs/superpowers/specs/2026-04-27-soldier-firing-poses-design.md`. Branch: `austerbitz-poses` (existing worktree).

## Step 1 — Draw new pose PNGs
Edit `scripts/redraw-components.mjs`:
- Add palette helpers for muzzle flash (`flashCore = #F5B044`, `flashHot = #EDE8DA`, `smoke = #B0A89A`).
- Add functions:
  - `drawCoatSouthMakeReady` — copy of `drawCoatSouth` but both sleeves repositioned: right sleeve diagonally up to forestock grip near `(7,15)`; left sleeve up to lock-height grip near `(9,18)`. Crossbelts and torso fill unchanged.
  - `drawCoatSouthPresent` — right sleeve crosses chest at the X-belt height with elbow flared at `(11,18)` and forearm angling up-right to `(12,15)` (butt tucked under chin/right shoulder). Left sleeve extended forward at row 17–18, hand at `(10,15)`.
  - `drawCoatSouthFire` — identical geometry to `drawCoatSouthPresent` but every drawn pixel y-coord shifted by `-1` (recoil hop). Skip pixels whose target row would fall outside the safe coat zone.
  - `drawMusketSouthMakeReady` — vertical barrel at `x=8`, rows 5–18 brown; bayonet `x=8` rows 2–4; hammer at `(7,17)` cocked back; small stock at `(8,19)` and `(8,20)`.
  - `drawMusketSouthPresent` — angled barrel along Bresenham from butt `(11,18)` to bayonet base `(2,9)`, bayonet tip `(1,7)`, brass band one mid-pixel; stock pixels at the butt end.
  - `drawMusketSouthFire` — `drawMusketSouthPresent` minus the `y -= 1` shift (recoil hop matches the coat). Optional: add a brass-flash highlight pixel near the lock.
  - `drawMuzzleFlashSouthFire` — 3-pixel cross-shape: hot core `(2,8)` `EDE8DA`, halo at `(1,8)`, `(3,8)`, `(2,7)`, `(2,9)` `F5B044`; one smoke pixel at `(0,8)` `B0A89A`.
- Update orchestrator `drawSouth()` to call every new draw fn.
- Re-run: `node scripts/redraw-components.mjs S` emits all eight new PNGs (4 coats inc. existing base, 4 muskets, 1 muzzle flash).

Do not delete or rewrite the existing `coat-line/south/base.png` or `musket/south/idle.png` — they remain the idle pose.

## Step 2 — Register components
Edit `public/components/index.json`. Append entries (keep sorted-ish near other south entries):
- `coat-line-south-make-ready`, `coat-line-south-present`, `coat-line-south-fire` — `type: uniform`, `category: upper`, `facings: ["S"]`, paths under `uniform/coat-line/south/<pose>.png`.
- `musket-brown-bess-south-make-ready`, `-present`, `-fire` — `type: weapon`, `category: primary`.
- `muzzle-flash-south-fire` — `type: fx`, `category: muzzle-flash`, `path: "fx/muzzle-flash/south/fire.png"`.

## Step 3 — Extend kit JSON
Edit `public/components/kits/british-line-infantry.json`. Add a `poses` object after `facings` per the spec. Existing `facings.S.layers` unchanged.

## Step 4 — Extend build script
Edit `scripts/build-soldier-components.mjs`:
- After the existing facings loop and atlas/preview write, if `kit.poses` exists:
  - For each `[poseId, override]` entry:
    - Build a fresh `outputAtlas` copy from `baseAtlas`.
    - Re-run the facing loop, but for each facing replace `config.layers` with `override[facing]` if present.
    - Compute output paths: `${baseOutputAtlas}-${poseId}.png` and `${baseOutputPreview}-${poseId}.png`. Implement by stripping the `.png` extension from the existing resolved paths and appending `-<pose>.png`.
    - Write atlas + preview the same way as the base case.
- Console-log `Compositing pose: <poseId>` headers so the run output stays legible.

## Step 5 — Update gallery
Edit `public/components-gallery.html`. In the `composite-row` div add three new `<figure>` blocks per pose, each with both the upscaled preview (`-<pose>-preview.png`? actually the preview path is `british-line-infantry-components-preview-<pose>.png` per Step 4 — match the build script's output exactly) and the native atlas. Captions: `make-ready · preview`, `make-ready · atlas`, etc. Order: idle, make-ready, present, fire.

(If the preview path scheme from Step 4 turns out to insert `-<pose>` before `-preview`, update Step 5 paths to match — single source of truth is what the build script writes.)

## Step 6 — Run end-to-end and verify
1. From the worktree root, run `node scripts/redraw-components.mjs S`.
2. Run `node scripts/build-soldier-components.mjs --kit british-line-infantry`.
3. Open `public/components-gallery.html` in a browser and confirm: four composites in a row (idle, make-ready, present, fire), each readable, no transparent gaps, recoil shift visible on `fire`, muzzle flash visible.
4. `npm run typecheck` — sanity check (no TS files touched, but cheap).

## Step 7 — Commit
Single focused commit with the new PNGs, registry/kit/script edits, and gallery update. Do not push.

## Notes
- All work happens in the existing `/Users/andrewcote/Documents/software/austerbitz-poses` worktree.
- Do not modify `scripts/redraw-components.mjs`'s existing `drawSouth*` functions for non-pose layers (trousers, shako, body, shadow). Pose work is additive only.
- If the present-pose musket Bresenham line lands ugly at this resolution, hand-tune the pixels rather than fighting the math.
