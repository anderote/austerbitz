# Terrain Features (v1) — Design

Date: 2026-04-28

## Goal

Replace the flat-green-sheet battlefield with a varied, characterful surface that reads as "rural Moravia, 1805." Ship four feature kinds in v1: **trees**, **grass-tint regions (meadows)**, **farm fields with tilled rows**, and **hedgerows** along field borders. Buildings, walls, water, roads, destructibility, and tactical effects are explicitly out of scope.

The existing `MapFeature` interface (`src/data/types.ts:61`) already declares tactical knobs (`blocksMovement`, `blocksProjectile`, `blocksSight`, `cover`, `height`). v1 fills those fields with sensible defaults but no game system reads them yet. They wire in later in their own pass.

## Non-goals

- No map editor. Features are generated procedurally from a per-map seed; the data layout is editor-friendly so an editor can be added later without a rewrite.
- No tactical gameplay impact. Trees do not block sight, fields do not slow movement, hedgerows do not provide cover. The data fields exist; nothing reads them.
- No destructibility. Trees do not fall, fields do not get trampled, hedgerows do not break under cannon fire.
- No buildings. Field borders meet at empty corners; farms read as "fields and hedges" not "farmsteads."
- No new authoring UI in `editor.html`. The seed lives in code.

## Architecture

```
WorldMap (data)
  └─ features: MapFeature[]
       ├─ tree_cluster   ← procedural; expands to N tree-instances at draw time
       ├─ field          ← polygon + crop + rowAngle
       ├─ meadow_region  ← polygon + tint
       └─ hedgerow       ← polyline (existing 'hedgerow' kind)

Renderer (src/render)
  ├─ TerrainPass      ← grass tile + meadow-tint mask + blood (extended)
  ├─ FieldsPass       ← NEW: polygon rasterizer with row-stripe shader
  ├─ HedgerowsPass    ← NEW: polyline → quad strip with hedge sprite
  ├─ TreesPass        ← NEW: per-instance tree quads, integrated with sprite y-sort
  └─ SpritePass, ...  ← existing

Procedural generation (src/map)
  └─ generateMapFeatures(seed, size) → MapFeature[]
       deterministic; called once at map load
```

**Draw order (back to front):**

1. `TerrainPass` (grass + meadow tint baked into a meadow mask, + blood)
2. `FieldsPass` (covers grass under field polygons)
3. `HedgerowsPass` (sits on top of field & grass borders)
4. Other ground passes (blood-stain, debris, dropped-items): unchanged
5. `TreesPass` + `SpritePass`: depth-sorted together by foot-Y so a soldier in front of a tree obscures the tree's trunk and a tree in front of a soldier obscures the soldier. See "Tree-sprite y-sort" below.

## Data model changes

`src/data/types.ts` — extend `MapFeature`:

```ts
export interface MapFeature {
  id: number;
  kind:
    | 'hedgerow' | 'wall' | 'building' | 'trench' | 'river'  // existing
    | 'tree_cluster' | 'field' | 'meadow_region';            // new
  shape:
    | { type: 'polyline'; points: { x: number; y: number }[] }
    | { type: 'polygon'; points: { x: number; y: number }[] }
    | { type: 'rect'; x: number; y: number; w: number; h: number }
    | { type: 'cluster'; cx: number; cy: number; radius: number;       // new
        density: number; seed: number };
  blocksMovement: boolean;
  blocksProjectile: boolean;
  blocksSight: boolean;
  cover: number;
  height: number;
  // NEW kind-specific data (optional, only populated for the matching kind):
  field?: {
    crop: 'wheat' | 'furrow' | 'stubble';
    rowAngle: number;       // radians; rows run along this axis
  };
  meadow?: {
    tint: [number, number, number];  // 0..1 RGB multiplier on the grass
    softness: number;                  // 0..1, edge feathering in world metres / 16
  };
}
```

`src/map/world-map.ts`:

- `createDefaultMap()` gains `seed?: number` (default `7`) and calls `generateMapFeatures(seed, size)` to populate `features`.
- New module `src/map/terrain-gen.ts` exports `generateMapFeatures(seed, size)`.

## Procedural generation recipe

`generateMapFeatures(seed, { w, h })` is **deterministic and stateless**. Same seed → same features.

1. **Meadow regions (1–2)**: pick 1 or 2 large soft-edged polygons (5–8 vertices, 200–400m radius) in random positions; tint slightly cooler-and-greener than base grass (e.g. `[0.92, 1.04, 0.95]`).
2. **Field cluster (1)**: pick a region of the map (~600×600 m), subdivide it into 6–12 rectangular fields (jittered angles ±15°, sizes 80–180m). Crop type per field is hashed from seed: ~50% wheat, ~30% furrow, ~20% stubble. Row angle is each field's own rotation plus a small jitter.
3. **Hedgerows**: walk every shared edge between adjacent fields and emit a polyline along it. Skip ~30% of edges so fields aren't fully fenced.
4. **Tree clusters (4–8)**: scatter clusters away from fields and meadows. Radius 30–80m, density 0.04–0.10 trees per m².

Generator uses a `mulberry32` PRNG seeded from `seed`. Same hash family already used in `grass-texture.ts` is fine if mulberry32 is too much; `hash32(i, j, seed)` works.

## Render: terrain (extended)

`src/render/passes/terrain-pass.ts` and `src/render/shaders/terrain.glsl.ts`:

- Add a "meadow mask" RGBA texture (low resolution, e.g. 512×512 stretched across the world).
- At map load, render meadow polygons into the mask once: each meadow's tint colour writes into RGB, alpha is feathered using `softness`.
- Fragment shader samples the mask, multiplies its RGB into the grass colour using alpha as the mix weight: `color = mix(color, color * meadowTint, meadowAlpha)`.

The mask is generated CPU-side (canvas 2d → `texSubImage2D`). Re-rendered only when the map's meadow features change (i.e. at load).

## Render: fields

New file `src/render/passes/fields-pass.ts` and `src/render/shaders/field.glsl.ts`.

- Each field is triangulated CPU-side via simple **fan triangulation** (fields are always convex in v1, so a fan from vertex 0 is correct) into a `Float32Array` of `{worldX, worldY, fieldId}`.
- Field metadata uploaded as a small UBO or as per-vertex attributes: `crop`, `rowAngle`, `rowPhase` (per-field random phase 0..1).
- Vertex shader passes world position; fragment shader:
  - Computes a "row coordinate" `r = dot(worldPos, vec2(cos(rowAngle), sin(rowAngle))) + rowPhase * 100`.
  - Quantises `r` into rows (e.g. 0.6m wide rows): `band = floor(r / 0.6)`.
  - Picks one of three colour stops per row (`crest`, `mid`, `furrow`) using a hash of `band`.
  - Adds per-pixel grain (same hash trick as `grass-texture.ts`) for pixel-art texture.
  - Crop palette per crop type:
    - **wheat**: `[#b89342, #d9b358, #a07e36]` (golden ripening grain)
    - **furrow**: `[#5a3d22, #7a5832, #4a3018]` (freshly turned earth)
    - **stubble**: `[#8b7c44, #a59755, #6f6234]` (post-harvest tan)

Triangulation runs once at map load. The pass uploads one big triangle list with per-vertex field metadata.

## Render: hedgerows

New file `src/render/passes/hedgerows-pass.ts` and `src/render/shaders/hedgerow.glsl.ts`.

- Each polyline becomes a quad strip 1.5–2m wide centred on the line.
- Procedural sprite: dense dark-green texture with subtle clump variation. Generated by `src/render/hedge-texture.ts` using the same noise/palette pattern as `grass-texture.ts`. ~256×64, tiles along the line direction.
- Two-tone: a darker base (`#1d2c10`) with a brighter clump highlight (`#3a5520`) and tiny per-pixel grain.
- Drawn before trees; no z-sort with sprites needed — hedges are short enough that occlusion of soldiers reads correctly without per-instance depth.

## Render: trees

New files:
- `src/render/tree-sprite.ts` — generates a procedural tree-sprite atlas (5 variants, 64×64 per tile, 320×64 atlas).
  - Each variant: tilted-top-down silhouette — circular canopy with subtle highlight on the upper-left, small trunk peek at the bottom (~6×8 px), short slanted shadow blob.
  - Palette: deep canopy `#2a3f17`, mid `#3d5621`, highlight `#5b7a30`, trunk `#3a2a18`, shadow `rgba(0,0,0,0.30)`.
  - Same noise/quantise approach as `grass-texture.ts` so trees feel of a piece with the ground.
- `src/render/passes/trees-pass.ts` — per-instance quad draw, instanced rendering.
  - Inputs per instance: `worldX, worldY, scale, variant, footY` (`footY = worldY + canopyOffset`, used for sprite-pass y-sort interop).
  - Uniforms: `u_viewProj, u_atlas, u_atlasGrid`.
- `src/render/shaders/tree.glsl.ts` — vertex/fragment shaders. Vertex emits a quad centred on the trunk base; fragment samples atlas with nearest-neighbour filtering.

**Tree-sprite y-sort:** v1 ships the simple scheme — `TreesPass` runs **after** `SpritePass`, and within the trees pass instances are drawn back-to-front by `footY` so trees occlude each other correctly. Cross-pass occlusion (a soldier in front of a tree) is **not** handled in v1: a soldier with lower footY than the tree behind them will still be covered by the tree's canopy where they overlap. For tilted-top-down trees this artefact is mostly invisible because the canopy footprint is small and the trunk peek is tiny. If it reads wrong in playtest, escalate to integrating trees into the existing sprite-pass y-sort as a new sprite group; that work is explicitly out of v1.

**Cluster expansion:** at map load (or pass init), each `tree_cluster` feature is expanded to N instances using its `seed`:
- `N = ceil(density * π * radius²)`
- For each instance, sample `(rx, ry)` in a disc using rejection or polar sampling with seeded jitter.
- Pick a sprite variant by hashing `(seed, i)`.
- Pick a scale in `[0.85, 1.15]`.
- Persist the expanded instance list; only re-expand if the cluster mutates (it doesn't in v1).

## Tile sizes & memory budget

- Tree atlas: 320×64×4 = ~80 KB. One-time, GPU-resident.
- Hedge tile: 256×64×4 = ~64 KB.
- Meadow mask: 512×512×4 = 1 MB. Per-world.
- Field triangles: ~12 fields × 6 verts × 24 bytes ≈ 1.7 KB. Negligible.
- Tree instances: ~6 clusters × ~250 trees × 32 bytes ≈ 48 KB. Easy.

Total new GPU memory: ~1.2 MB. Well within budget.

## Aesthetic constraints

Per the user's standing rule: **all in-world rendering must be pixelated with hard edges.** Every new texture and shader uses `gl.NEAREST` filtering; no sub-pixel smoothing on canopies, hedges, or row stripes. The grass texture is already pixelated; trees and hedges follow the same construction (procedural noise → quantised palette → per-pixel grain).

## Testing

Unit tests live next to the source files they test, matching the existing convention.

- `src/map/terrain-gen.test.ts` — generator is deterministic (same seed → identical features); reasonable bounds (no features outside map; no overlapping fields; cluster radii in expected range).
- `src/render/tree-sprite.test.ts` — atlas has the right dimensions, alpha is non-zero in the canopy region, fully transparent outside.
- `src/render/hedge-texture.test.ts` — same shape checks.
- `src/render/passes/fields-pass.test.ts` — triangulation of a known polygon produces the right vertex count.

`src/sanity.test.ts` should keep passing without modification.

No visual regression tests in v1 — they'd be valuable but the existing project has none, and adding a screenshot pipeline is out of scope.

## File map

**New files:**

```
src/map/terrain-gen.ts
src/map/terrain-gen.test.ts
src/render/tree-sprite.ts
src/render/tree-sprite.test.ts
src/render/hedge-texture.ts
src/render/hedge-texture.test.ts
src/render/passes/fields-pass.ts
src/render/passes/fields-pass.test.ts
src/render/passes/hedgerows-pass.ts
src/render/passes/trees-pass.ts
src/render/shaders/field.glsl.ts
src/render/shaders/hedgerow.glsl.ts
src/render/shaders/tree.glsl.ts
```

**Modified files:**

```
src/data/types.ts                         — extend MapFeature
src/map/world-map.ts                      — createDefaultMap takes seed
src/render/grass-texture.ts               — no change (kept for reference)
src/render/passes/terrain-pass.ts         — meadow mask sampler
src/render/shaders/terrain.glsl.ts        — meadow tint mix
src/render/renderer.ts                    — wire new passes into draw order
```

## Risks and mitigations

- **Field triangulation complexity.** Mitigation: v1 generator only emits convex polygons (rectangles with a rotation), so a simple fan triangulation from vertex 0 is correct. Concave fields would need ear-clipping; explicitly out of v1.
- **Tree-sprite occlusion artefacts.** v1 ships the simpler "trees after sprites" path; if the artefact reads wrong in playtest, escalate to integrating trees into the sprite-pass y-sort.
- **Hedgerow miter joints.** Mitigation: emit two triangles per polyline segment with no joint smoothing; pixel-art aesthetic forgives the tiny gaps.
- **Procedural fields overlapping wooded clusters.** Mitigation: in `generateMapFeatures`, place fields first, then bias tree-cluster placement away from any existing field bbox.

## Open questions

None for v1. Editor support, gameplay effects, buildings, destructibility, and walls are deliberate v2+ work and don't need to be answered now.
