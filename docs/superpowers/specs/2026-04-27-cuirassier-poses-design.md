# Cuirassier pose-pipeline migration — design

## Goal

Move cuirassier from the procedural 15×20 single-frame combined-atlas sheet to
the `public/sprites/poses/` pipeline, with a Tier-1 pose set (`idle` +
`walking` + `running`) at a larger 32×24 cell size. Match the line-infantry
authoring/editing model: PNGs on disk, manifest auto-built by
`scripts/build-pose-manifest.mjs`, runtime resolves via the existing
`PoseAtlas`. The procedural runtime path stays as a fallback.

## Non-goals

- `aiming` / `firing` / `reloading` — cuirassier is melee (`weaponRange = 2`),
  these will fall back to `idle` and that is fine.
- `melee_strike` — would need a new pose enum + consumer changes; out of scope.
- `flinch` / `dying` / `dead` — Tier 2; same authoring path when needed.
- Hand-drawn upgrades — generator output is the baseline; users can overwrite
  any frame later in Aseprite/etc. without touching the generator.
- Retiring `src/render/cuirassier-sprite.ts` and the `cuirassier.png` combined
  atlas — they remain as a fallback. Removing them is a separate cleanup.

## Sprite size

- Cell: **32 wide × 24 tall** (was 15×20).
  - Wider than tall to fit the horse + rider in side and diagonal facings (a
    horse silhouette is ~2× as long as it is tall).
  - Tall enough for a vertical view (rider torso/head above horse back).
- All 8 facings share the same cell size.
- Anchor convention: same as line-infantry — bottom-center of the cell aligns
  with the unit's ground position.

## Pose set & frame counts

| Pose      | Frames per dir | Source dirs | Mirrored dirs       | fps | Kind   |
|-----------|----------------|-------------|---------------------|-----|--------|
| `idle`    | 1              | N,NE,E,SE,S | NW(=NE), W(=E), SW(=SE) | —   | static |
| `walking` | 4              | N,NE,E,SE,S | NW, W, SW           | 8   | loop   |
| `running` | 6              | N,NE,E,SE,S | NW, W, SW           | 12  | loop   |

- Totals: `8 × 1 + 8 × 4 + 8 × 6 = 88` frames.
- fps values match `POSE_CONFIG` in `src/render/poses/pose-config.ts`.
- Mirroring: only N, NE, E, SE, S are authored; W = mirror(E), SW = mirror(SE),
  NW = mirror(NE). N and S are self-symmetric so no mirroring needed. This is
  the same convention the procedural cuirassier sheet already uses.
- Walking gait: 4-beat cycle (LF–RH–RF–LH contact pattern → 4 keyframes).
- Galloping: 6-key cycle (collected → suspension → extended-front → extended
  contact → collected → suspension-extended). Standard pixel-art horse cycle.

## Architecture

### File layout

```
src/sprite-gen/
  cuirassier.ts            # ASCII pose grids + palette, exported as data
  cuirassier.test.ts       # validates grid shapes, palette, frame counts

scripts/
  draw-cuirassier-poses.mjs  # imports the grids, writes per-frame PNGs

public/sprites/poses/cuirassier/
  idle/<DIR>/0/0.png       # 8 dirs × 1 frame
  walking/<DIR>/0/<0..3>.png  # 8 dirs × 4 frames
  running/<DIR>/0/<0..5>.png  # 8 dirs × 6 frames
```

### Why a new module instead of editing `src/render/cuirassier-sprite.ts`

`cuirassier-sprite.ts` is wired into the procedural combined-atlas runtime
path; modifying its grid sizes or pose set would risk regressions in the
fallback. We leave it alone. The new `src/sprite-gen/cuirassier.ts` is a
data-only module (no runtime imports) consumed by:

1. `scripts/draw-cuirassier-poses.mjs` (the seeder), and
2. `src/sprite-gen/cuirassier.test.ts` (shape/palette validation).

This keeps the sprite-gen stage cleanly separable from the renderer.

### Data flow

```
ASCII grids (src/sprite-gen/cuirassier.ts)
    │
    ├─→ draw-cuirassier-poses.mjs
    │     └─→ public/sprites/poses/cuirassier/<pose>/<dir>/0/<frame>.png
    │           │
    │           ├─→ build-pose-manifest.mjs (via npm run dev / build)
    │           │     └─→ public/sprites/poses/manifest.json
    │           │
    │           └─→ loadPoseAtlas() (runtime)
    │                 └─→ pickPoseUv() → sprite-pass uses these UVs
    │
    └─→ cuirassier.test.ts (vitest, shape & palette guard)
```

The procedural fallback (`src/render/cuirassier-sprite.ts` →
`generateCombinedAtlas` → `KIND_ATLAS['cuirassier']`) continues to seed the
combined sheet for any pose missing from the pose-atlas. With Tier 1 shipped,
the fallback only matters for combat poses we deliberately skipped, all of
which `pickPoseUv` already redirects to `idle` (which is now pose-atlas
backed).

## Palette & color encoding

Palette mirrors the existing `cuirassier-sprite.ts` glyph set, kept stable so
hand-edits stay coherent across the project's pixel-art style:

| Char | Role                          |
|------|-------------------------------|
| `.`  | transparent                   |
| `k`  | outline / hooves (near-black) |
| `h`  | horse coat                    |
| `H`  | horse coat shadow             |
| `f`  | rider skin                    |
| `F`  | rider skin shadow             |
| `g`  | steel (sabre, helmet)         |
| `m`  | saddle leather                |
| `w`  | belts / breeches / blanket    |
| `s`  | ground shadow (semi-alpha)    |
| `P`  | primary marker (rider coat)   |
| `S`  | secondary marker (cuirass / plume) |

The runtime sprite-pass swaps `P`/`S` per-instance for team primary/secondary
colors, same as today. The seeder script bakes British defaults (red coat,
blue facings) into the on-disk PNGs so the unbaked PNGs already look like a
real unit.

## Frame authoring approach

Each pose × direction × frame is a 32×24 ASCII grid in the new module. To keep
the file readable, frames are grouped:

```ts
export const CUIRASSIER_RUNNING_E: readonly Frame[] = [FRAME_0, FRAME_1, ...];
```

A `Frame` is `readonly string[]` with `length === CELL_H` and each row of
length `CELL_W`. Tests assert these shape invariants for every frame.

## Mirroring

Mirroring is performed at PNG-emit time in `draw-cuirassier-poses.mjs`. For
each mirrored direction (`NW`, `W`, `SW`), the script reads the source
direction (`NE`, `E`, `SE`) and flips the row horizontally before writing.
This keeps the ASCII module to authored frames only and removes any chance of
mirror drift between source and mirror.

The runtime does **not** know about mirroring — every direction has a real
on-disk PNG.

## Mirrored helmet plume direction

The cuirassier's helmet plume falls to one side. When mirroring E → W, the
plume swaps sides too — the design accepts this: visually consistent within
each facing, and the alternative (per-facing plume side authoring) doubles
art workload for negligible gain.

## Manifest

`scripts/build-pose-manifest.mjs` already walks the poses tree and emits the
manifest. It runs via `npm run build:poses` which is wired into both
`npm run dev` and `npm run build`. After running `draw-cuirassier-poses.mjs`,
re-running `build:poses` (or `dev`/`build`) updates the manifest. No manifest
code changes needed.

## Runtime integration

No source changes to:
- `src/render/poses/atlas.ts` — pose-atlas already supports multi-frame clips.
- `src/render/poses/pose-config.ts` — `walking` and `running` already in the
  enum + config.
- `src/render/passes/sprite-pass.ts` — already prefers `pickPoseUv` over
  `KIND_ATLAS` cells.
- `src/render/sprite-atlas.ts` — fallback path stays.

The only runtime-visible change is more PNGs on disk + a fatter manifest.

## Testing

### Unit tests

`src/sprite-gen/cuirassier.test.ts`:

1. Each `Frame` array is `CELL_H` rows of `CELL_W` chars.
2. Every glyph used appears in the palette.
3. `idle` has 1 frame per source dir; `walking` has 4; `running` has 6.
4. Source dirs `{N, NE, E, SE, S}` are present for every pose.

### Determinism check

`scripts/draw-cuirassier-poses.mjs` exits with non-zero if its second run
produces different bytes than its first run (re-emit + byte-compare against
existing on-disk PNGs). This catches non-determinism in PNG encoding.

### Visual smoke test

Run `npm run dev`, place a cuirassier formation in the lab, watch it walk and
run. Frame count is correct (4-beat walk visibly distinct from 6-beat
gallop), no flicker on direction transitions, no missing-frame red squares
from `pickPoseUv` returning null.

### What is not tested

- Render-pipeline integration: pose-atlas pipeline already has tests in
  `src/render/poses/atlas.test.ts` and `pose-config.test.ts` covering frame
  resolution, mirroring not applicable (we mirror at emit time), and clip
  fallback. New cuirassier PNGs go through that same path.

## Risks & open questions

- **Cell-size mismatch with procedural fallback.** Pose-atlas cells are 32×24,
  procedural fallback is 15×20. They are not blitted into the same cell grid
  — pose-atlas is shelf-packed independently. The sprite-pass selects per
  entity. So the mismatch is harmless. (Verified by reading
  `sprite-atlas.ts` + `passes/sprite-pass.ts`.)
- **Lab/inspector visual scaling.** A 2×-larger cuirassier may look outsized
  vs. line-infantry on screen. If so, scale the cuirassier draw size in
  `lab-ui.ts` or the sprite-pass per-kind. Defer until visible.
- **`seed-poses.mjs` cuirassier entry.** Now obsolete. Remove the cuirassier
  block from that script in this same change to prevent it from re-seeding
  15×20 PNGs over our 32×24 ones.
- **Frame counts are an art-quality choice.** 4-frame walk and 6-frame gallop
  are the floor for readable horse locomotion in pixel art. Lower would
  jitter; higher costs more authoring effort with diminishing returns.

## Out-of-band follow-ups (not in this change)

- Hand-drawn frame upgrades.
- Tier 2 / Tier 3 poses.
- Retiring the procedural runtime path entirely.
