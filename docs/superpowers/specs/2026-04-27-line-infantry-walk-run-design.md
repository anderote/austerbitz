# Line-infantry walking + running poses — design

## Goal

Add `walking` (4-frame loop) and `running` (6-frame loop) poses for
line-infantry through the existing components pipeline. Match the
authoring/editing model of every other line-infantry pose (`fire`,
`present`, `make-ready`, `hit`, `dying`): per-component PNGs in
`public/sprites/components/`, recipe in
`public/components/kits/line-infantry.json`, composited atlases that the
slicer writes into the pose tree, picked up by the existing pose-atlas
runtime.

## Non-goals

- Kneeling-fire / kneeling poses — out of scope; deferred.
- New pose enums — `walking` and `running` already exist in
  `src/render/poses/pose-config.ts`.
- Sim changes — the sim already drives `Pose.walking`/`Pose.running` based on
  velocity. This spec only supplies the missing visuals.
- Hand-drawn final art — initial leg frames are programmatic placeholders.
  Anyone can overwrite the seeded PNGs in Aseprite later; the rest of the
  pipeline doesn't care.

## Pipeline extensions

The components pipeline today is single-frame per pose. Three small,
backwards-compatible extensions:

### 1. Kit format — multi-frame detected by structure

Today a pose entry is `string[]` per direction:

```json
"fire": {
  "S": ["body-south-base", "trousers-south", "coat-line-south-fire", "shako-standard-south", "musket-brown-bess-south-fire"]
}
```

Multi-frame uses `string[][]`:

```json
"walking": {
  "S": [
    ["body-south-base", "trousers-south-walk-0", "coat-line-south", "shako-standard-south", "musket-brown-bess-south"],
    ["body-south-base", "trousers-south-walk-1", "coat-line-south", "shako-standard-south", "musket-brown-bess-south"],
    ["body-south-base", "trousers-south-walk-2", "coat-line-south", "shako-standard-south", "musket-brown-bess-south"],
    ["body-south-base", "trousers-south-walk-3", "coat-line-south", "shako-standard-south", "musket-brown-bess-south"]
  ]
}
```

Detection rule: peek at the first array element. If it's a string → 1-frame.
If it's an array → multi-frame. No new field, no schema flag, no breakage of
existing kit entries.

### 2. Builder — emit one atlas per frame for multi-frame poses

`scripts/build-soldier-components.mjs` calls
`compositeAndWrite(poseId, layerOverrides, atlasPath, previewPath, ...)` once
per pose today. Extend the loop in `main()` so that when a pose is
multi-frame:

- Determine `frameCount` = max length across all directions for that pose.
- For each `frameIdx` in `0..frameCount-1`:
  - Build a per-direction `layerOverrides[dir] = override[dir][frameIdx]`
    (or `override[dir][last]` if that direction has fewer frames — gracefully
    handles asymmetric authoring; expected to match in practice).
  - Call `compositeAndWrite` with `atlasPath` =
    `withSuffix(outputAtlasPath, '-' + poseId + '-' + frameIdx)`.
  - Same for the preview path.

Single-frame poses keep the current `-<poseId>.png` filename.

### 3. Slicer — kit-driven, multi-frame aware

`scripts/slice-component-atlas.mjs` currently has a hardcoded `SOURCES`
array. Replace it with a kit walker:

- Read `public/components/kits/line-infantry.json`.
- Translate kit pose IDs to runtime pose IDs using a small map (kit uses
  spec names like `make-ready`/`present`/`fire`; runtime uses
  `reloading`/`aiming`/`firing`). Existing aliases:
  - `make-ready` → `reloading`
  - `present` → `aiming`
  - `fire` → `firing`
  - everything else (idle, hit, dying, walking, running, etc.) maps 1-to-1
    (and `hit` already has a runtime pose-name match — `hit` is not in the
    Pose enum but the manifest builder filters unknown poses with a warning).

- For each kit pose:
  - For each frame index (1 if single-frame, N if multi-frame):
    - Open `line-infantry-components-<poseId>[-<frameIdx>].png`.
    - For every direction the kit lists for that pose, slice that cell from
      the atlas to
      `public/sprites/poses/line-infantry/<runtimePose>/<DIR>/0/<frameIdx>.png`.

- The `idle` pose continues to slice all 8 facings from `*-components.png`
  (no `-idle` suffix today; preserve that).

The `musket` kit pose stays a 1-frame, all-facings entry — but it isn't a
runtime pose, so the slicer skips it (or is told to). Add an explicit
`SKIP_POSES = ['musket']` set.

## Component authoring — placeholder leg seeder

Only the **trousers** component animates between walk/run frames; body, coat,
shako, and musket stay at their `base`/`idle` variants.

New PNGs (32×36 each, in `public/sprites/components/uniform/lower/trousers/`):
- `<facing>-walk-0.png` … `<facing>-walk-3.png` × 8 facings = **32 PNGs**
- `<facing>-run-0.png` … `<facing>-run-5.png` × 8 facings = **48 PNGs**

Total: 80 new trouser PNGs.

A new script `scripts/seed-line-infantry-locomotion-trousers.mjs` programmatically
generates them from each existing `trousers/<facing>.png` baseline:

- **Frame 0** of any cycle == idle (copy the base, no edits).
- **Walk frames 1–3**: shift right-leg pixels up by 1 px on frames 1+3,
  shift left-leg pixels up by 1 px on frame 2 (4-beat alternation).
- **Run frames 1–5**: tighter cycle. Frame 0 = gather (no shift), frame 1 =
  push (one leg up 1), frame 2 = suspension (both legs up 1), frame 3 =
  landing (other leg up 1), frame 4 = rolling-contact, frame 5 = re-gather.
- Pixel-shift identifies "leg pixels" by isolating the lower ~⅓ of opaque
  pixels in the source PNG and translating them in-place. Saves nothing
  about color — same palette as input.

The seeder is **idempotent** and **opt-in**: re-running overwrites existing
PNGs. To preserve a hand-edited frame, simply remove its corresponding kit
reference (no, simpler: don't re-run the seeder). The component `index.json`
gets new entries for all 80 PNGs (auto-generated by the seeder via a JSON
patch step, OR maintained manually — see *Component registry* below).

The cycle phasing matches `POSE_CONFIG`: walking @ 8 fps × 4 frames =
500 ms loop; running @ 12 fps × 6 frames = 500 ms loop.

## Component registry (`public/components/index.json`)

Today this file lists every component with `id`, `type`, `category`,
`facings`, `path`, `pivot`, `anchors`. The builder reads it to resolve layer
ids in the kit.

Extending it for 80 new entries is mechanical. Two options:

1. **Seeder also patches `index.json`.** It reads the existing trousers
   entries, derives `walk-<i>`/`run-<i>` siblings copying `pivot`/`anchors`
   verbatim, writes the merged file. Pro: one command produces a working
   pipeline. Con: the seeder writes JSON; less hand-friendly diffs.

2. **Maintain `index.json` by hand.** Add 80 entries as a one-time edit.
   Pro: explicit. Con: tedious.

Choosing **option 1**. It's a generated artifact with a clear regeneration
path (`npm run seed:line-infantry-walk-run` or similar), and we already have
similar autogenerated artifacts (`manifest.json`, the slicer outputs).

## Kit additions

Append two pose entries to `public/components/kits/line-infantry.json`:

```json
"walking": {
  "N":  [...4 frame layer-arrays...],
  "NE": [...],
  "E":  [...],
  "SE": [...],
  "S":  [...],
  "SW": [...],
  "W":  [...],
  "NW": [...]
},
"running": { ... 6 frames per dir ... }
```

The layer arrays per frame are mechanical: each just swaps the trousers id
to the frame-specific variant. To keep the JSON readable, I'll write a tiny
helper in the seeder that emits the kit fragment to stdout, so the human
copy-paste is one block per pose.

## Build & runtime

- `npm run build:soldier-components` runs the builder + slicer, both now
  multi-frame aware.
- `npm run build:poses` invokes the above + manifest builder.
- The pose-atlas runtime already supports multi-frame clips (cuirassier
  walking/running uses it).

## Tests

- `scripts/build-soldier-components.test.mjs` (small): assert that a
  multi-frame pose entry produces N atlas files (N = frame count) with
  correct names. Use a fixture kit + minimal components.
- `scripts/slice-component-atlas.test.mjs`: assert that a multi-frame pose
  entry produces the expected `<pose>/<dir>/0/<i>.png` paths and content.
  Use a 96×108 fixture atlas.
- Visual smoke: run `npm run dev`, place a line-infantry company, watch
  walking + running cycles.

## What does not change

- `src/render/poses/*` — already supports multi-frame.
- `src/render/poses/pose-config.ts` — `walking` and `running` already
  enumerated.
- `src/render/passes/sprite-pass.ts` — already prefers `pickPoseUv` over the
  procedural fallback; no per-pass logic change.
- The procedural `src/render/british-soldier-sprite.ts` and combined-atlas
  fallback — untouched.
- The cuirassier pose pipeline — independent, untouched.
- Other kits (`cannon-12` etc.) — untouched. The kit-walker in the slicer
  is line-infantry-specific by way of the `--kit` arg already passed to the
  builder; the slicer reads the same kit it was paired with.

## Risks & open questions

- **Hand-edited PNGs vs. seeder re-run.** If someone hand-edits a frame and
  the seeder is re-run later, the edit is overwritten. Mitigation: the
  seeder is opt-in (it has its own npm script); `npm run dev`/`build` does
  not invoke it. Same trade-off as `scripts/draw-cuirassier-poses.mjs`.
- **Placeholder quality.** Programmatic leg-pixel shifts will look stilted
  vs. real animation keyframes. That's the explicit "placeholder" deal —
  cycle reads as motion, refinement is hand-authored later.
- **`hit` is not a runtime Pose enum value.** Pre-existing concern:
  `manifest.json` filters unknown poses with a warning. Out of scope for
  this change.
- **Slicer rewrite fragility.** Replacing the hardcoded `SOURCES` array
  with kit-driven logic is the riskiest single change. Mitigation: keep
  the slicer's contract identical (same output paths) and unit-test the
  rewrite against a fixture.

## Out-of-band follow-ups

- Hand-drawn refinement of the seeded leg PNGs.
- Kneeling-fire pose (deferred from this scope).
- Removing the procedural `british-soldier-sprite.ts` fallback once all
  poses are component-backed.
