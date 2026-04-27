# South-facing soldier firing poses

## Goal
Extend the modular soldier component system with the four-stage musket firing cycle for the south (`S`) facing only. Show all four poses side-by-side with the existing composite atlas in `public/components-gallery.html`.

## Pose definitions
Stages follow British line-infantry drill, simplified for a 16×36 chibi:

1. **idle** — port arms (existing). Musket vertical at viewer-left edge of body. Both sleeves hang.
2. **make-ready** — musket lifted to vertical at body centerline, hammer cocked. Right arm crosses up to thumb the hammer at lock height; left arm grips the forestock chest-high. Stance unchanged.
3. **present** — musket angled forward-right (~30° from vertical), butt tucked under chin/right shoulder. Right elbow flared at x=11–12. Left arm extended forward at x=10. Cheats S-facing toward SE so the barrel reads as aiming downrange instead of at the camera.
4. **fire** — same skeletal layout as present, but figure shifted up 1 px (recoil hop) and a separate muzzle-flash fx layer drawn at the bayonet base.

## Components (S only)
Only the layers below change per pose. Trousers, head, shako, body (face blob), shadow are pose-invariant and reused.

| Layer | Files |
| --- | --- |
| coat-line | `uniform/coat-line/south/{base,make-ready,present,fire}.png` (`base` = idle, kept as-is) |
| musket    | `weapon/musket/south/{idle,make-ready,present,fire}.png` |
| fx        | `fx/muzzle-flash/south/fire.png` (new category) |

Pose-invariant layers stay single-file: `anatomy/body/south/base.png`, `uniform/lower/trousers/south.png`, `uniform/head/shako-standard/south.png`, `shadow/south/default.png`.

## Registry additions (`public/components/index.json`)
Add component entries:
- `coat-line-south-make-ready`, `coat-line-south-present`, `coat-line-south-fire`
- `musket-brown-bess-south-make-ready`, `musket-brown-bess-south-present`, `musket-brown-bess-south-fire`
- `muzzle-flash-south-fire` (new `type: fx`, `category: muzzle-flash`)

The existing `coat-line-south` and `musket-brown-bess-south` keep their meaning (idle).

## Kit schema extension (`public/components/kits/british-line-infantry.json`)
Add an optional top-level `poses` map. Each entry overrides `layers` for the S facing only:

```json
"poses": {
  "make-ready": { "S": ["shadow-south", "body-south-base", "trousers-south", "coat-line-south-make-ready", "shako-standard-south", "musket-brown-bess-south-make-ready"] },
  "present":    { "S": ["shadow-south", "body-south-base", "trousers-south", "coat-line-south-present", "shako-standard-south", "musket-brown-bess-south-present"] },
  "fire":       { "S": ["shadow-south", "body-south-base", "trousers-south", "coat-line-south-fire", "shako-standard-south", "musket-brown-bess-south-fire", "muzzle-flash-south-fire"] }
}
```

Default-pose composites continue using the base `facings` block unchanged.

## Build pipeline changes (`scripts/build-soldier-components.mjs`)
- After writing the base composite atlas/preview, iterate `kit.poses`. For each pose:
  - Start from a fresh copy of `baseAtlas`.
  - For each facing referenced in `kit.facings`, use the pose's override layers if present, else the base layers.
  - Write `<outputAtlas-base>-<poseId>.png` and `<outputPreview-base>-<poseId>.png` (e.g. `british-line-infantry-components-make-ready.png`).
- No changes to invocation: a single `node scripts/build-soldier-components.mjs --kit british-line-infantry` emits idle + 3 pose atlases + previews.

## Drawing pipeline changes (`scripts/redraw-components.mjs`)
- Add `drawCoatSouthMakeReady`, `drawCoatSouthPresent`, `drawCoatSouthFire` (sleeve geometry differs per pose).
- Add `drawMusketSouthMakeReady`, `drawMusketSouthPresent`, `drawMusketSouthFire`.
- Add `drawMuzzleFlashSouthFire` (3-pixel yellow/white burst + 1–2 light-gray smoke pixels at the bayonet base).
- Existing `drawSouth` orchestrator calls all of the above so re-running produces every PNG in one pass.

## Gallery additions (`public/components-gallery.html`)
In the existing `<section>` with class `composite-row`, append three more `<figure>` blocks (one per non-idle pose) that load the new `*-components-<pose>.png` and matching preview PNGs. Captions: `make-ready`, `present`, `fire`. The "preview (upscaled)" / "atlas (native)" pair structure is preserved per pose — keep the row scrollable on narrow screens via the existing `flex-wrap`.

No need to add the per-pose component PNGs to the "Component Layers" grid; they'll be visible inside each composite.

## Pixel-art rule
Per project convention, all art is pure 1-bit pixel art with no AA except the existing 2-step shadow alpha (110/70) — same as today. Muzzle flash uses solid pixels (`F5B044`/`EDE8DA` core, `B0A89A` smoke).

## Out of scope
- Other facings (N, NE, E, SE, SW, W, NW) get no firing poses in this pass.
- No runtime hookup — purely art assets and the gallery.
- No animation timing/sequencing data; just static frames.
