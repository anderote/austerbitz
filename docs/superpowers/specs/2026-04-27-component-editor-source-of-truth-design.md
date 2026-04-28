# Component editor as source of truth + generic gibs

## Goal
Make the component editor the **single source of truth** for in-game unit sprites: anything you build/preview in `components.html` is what appears in the game. Then layer a small **gib system** on top, where exploded units burst into a few generic chunk sprites with simple physics — independent of the editor's component pipeline.

## Today's split (the bug the user reported)
- **Editor** (`components.html` → `src/dev/component-preview.ts`) reads `public/components/index.json` + `public/components/kits/*.json` and composites layers from `public/sprites/components/<type>/...png`. Preview-only — no save/export.
- **Game body sprites** are loaded by the pose-atlas runtime from `public/sprites/poses/<kind>/<pose>/<facing>/<clip>/<frame>.png`. Those PNGs were originally seeded from legacy combined atlases (`scripts/seed-poses.mjs`) and have since drifted — some were hand-edited via the `redraw-*.mjs` scripts.
- **Game weapons** are already runtime-composited from the kit JSON (per `2026-04-27-per-pose-weapon-attachment-design.md`). That part is already correct.

The split: editor body composition ≠ game body PNGs. The editor's layer changes (`coat-line-south-fire`, `trousers-south-walk-2`, etc.) never reach the game because the game reads pre-baked flat PNGs.

## Design — Phase 1: kit-bake script
A build-time compositor that reads each kit JSON and writes the per-pose body PNGs the game already consumes. The renderer changes nothing — it just sees regenerated PNGs whose pixels now match what the editor shows.

### Inputs
- `public/components/kits/<unit>.json` — already encodes `facings` (idle layers per facing) and `poses[poseName][facing]` (per-pose layer override, single-frame as `{ layers, weapon? }` or multi-frame as `string[][]`).
- `public/components/index.json` — maps each layer ID to its source PNG path.
- `public/sprites/components/<type>/...png` — the layer PNGs.

### Outputs
`public/sprites/poses/<runtime-pose>/<kind>/<facing>/<clipIdx>/<frameIdx>.png` (matching the directory shape that `build-pose-manifest.mjs` already walks).

### Editor-pose ↔ runtime-pose mapping
The kit JSON uses *editor* pose names; the runtime expects *runtime* pose folder names. The mapping already exists in `src/render/poses/kit-loader.ts:runtimePoseToEditorPoseName`. For the bake script, an inverted mapping is needed:

| Runtime folder | Source in kit |
|---|---|
| `idle` | `kit.facings[F].layers` (top-level idle definition) |
| `walking` | `kit.poses.walking[F]` (multi-frame, array of layer arrays) |
| `running` | `kit.poses.running[F]` |
| `aiming` | `kit.poses.present[F].layers` |
| `firing` | `kit.poses.fire[F].layers` |
| `reloading` | `kit.poses["make-ready"][F].layers` |
| `flinch` | `kit.poses.hit[F].layers` |
| `dying` | `kit.poses.dying[F].layers` (also seeds `ragdoll`, `dead` if present) |

Multi-frame poses (walking, running) preserve their frames as `<clip=0>/<frame=N>.png`. Single-frame poses write `<clip=0>/<frame=0>.png`.

### Compositing rules
- Sprite cell size is per-kit (line-infantry uses 11×18; cuirassier 15×20; cannon-12 17×14). Pulled from the kit JSON's `cell` width if present, else read from the first layer PNG's intrinsic size.
- Layers composite **bottom-up** in the order listed (first = bottom).
- Each layer PNG is drawn at `(0, 0)` of the cell — the layer PNGs already encode pivot/anchor offsets internally. (Components use the canonical anchor pivots in `index.json`, but for the bake we treat each layer PNG as already aligned — same assumption the editor's preview makes.)
- Output PNG is exactly the cell size, RGBA, transparent background.
- Weapon layers are **stripped**: any layer whose ID matches `kit.weapon.layerPrefix + '-*'` is excluded from the bake. The runtime weapon-attachment system already draws weapons on top.

### Where the script slots in
- New file: `scripts/build-pose-pngs.mjs` (uses `pngjs` if already a dep, else `sharp`; check `package.json` and pick what's there).
- Wired into `npm run dev` and `npm run build` as `npm run build:pose-pngs`, run **before** `build:poses` (which builds the manifest from the resulting PNG tree).

### Retiring obsolete inputs
- `scripts/seed-poses.mjs` becomes obsolete (was bootstrapping pose PNGs from legacy combined atlases). Mark deprecated; keep for reference.
- `scripts/redraw-*.mjs` (redraw-components, redraw-e-w, redraw-n, redraw-ne-nw, redraw-se-sw) — these draw individual *component* PNGs (in `sprites/components/...`), not pose PNGs, so they remain useful as the "draw a layer" entry point. The bake takes their output and composites it into pose PNGs.
- The `outputAtlas` / `outputPreview` keys in kit JSONs (e.g. `public/sprites/line-infantry-components.png`) are unrelated to runtime — they're authoring aids. Leave alone.

### Idempotency & determinism
- Running the bake twice produces byte-identical PNGs (no timestamps, no nondeterministic ordering).
- The bake clears stale outputs: before writing, delete any pose PNGs under `public/sprites/poses/<kind>/` that aren't going to be re-baked from the kit (so a renamed or removed pose doesn't leave orphan files).

### What this does NOT do
- Doesn't change the game runtime (no new render paths).
- Doesn't change weapon attachment (already runtime, already kit-driven).
- Doesn't change the editor (still preview-only — but the preview is now real).
- Doesn't add per-soldier customization (color tints, regiment palettes, etc.) — that's separate.

## Design — Phase 2: generic gib chunks
A small standalone system. Decoupled from the kit/component pipeline by design — gib chunks are *not* the unit's actual layers, they're stylized stand-ins from a shared library.

### Asset library
- New folder: `public/sprites/gibs/`.
- ~6–10 hand-drawn chunks: `head.png`, `arm.png`, `leg.png`, `torso-piece.png`, `hat.png`, `meat-blob.png`, plus a few small `blood-speck-*.png`. Each ~6×6 to 10×10 pixels, RGBA, hard-edged pixel art.
- A manifest `public/sprites/gibs/manifest.json` listing the chunk IDs and their metadata: `{ id, path, partType: "head"|"arm"|"leg"|"torso"|"hat"|"misc", mass: "light"|"medium" }`. Used to weight spawn distributions (e.g. always 1 head, 2 arms, 2 legs, 1 torso when a soldier is fully gibbed).

### Entity model
New entity type `Debris`:
```ts
type Debris = {
  pos: { x: number; y: number };       // world units, pixel-snapped at render
  vel: { x: number; y: number };       // velocity in world units / sec
  z: number;                           // vertical offset above ground
  vz: number;                          // vertical velocity
  spinDeg: number;                     // current rotation in degrees
  spinRate: number;                    // deg/sec
  chunkId: string;                     // key into gibs manifest
  tint?: [number, number, number];     // optional faction-color tint
  ttlSec: number;                      // remaining lifetime
  bounces: number;                     // for damping
};
```

### Spawn trigger
On unit death where the cause is **explosive** (cannon-12 round impact, future grenades). Non-explosive deaths (musket, saber) use the existing dying/dead state, no gibs.

- Spawn count: 4–6 chunks per unit, drawn from the manifest weighted by part presence. Plus 3–8 blood specks.
- Initial conditions per chunk:
  - `pos`: unit's current world pos.
  - Outward direction = vector from blast center to unit, normalized; randomized ±30°.
  - Speed = `clamp(blastRadius / distance, 0.3, 1.0) * MAX_SPEED` (close → fast; edge → tumbling).
  - `vz` = small upward kick (unit cells per sec).
  - `spinRate` = random ±360°/sec.
  - `ttlSec` = random 4–8s.

### Physics tick
- `pos += vel * dt`
- `z += vz * dt; vz -= GRAVITY * dt`
- On `z < 0`: `z = 0; vz = -vz * BOUNCE_DAMP; vel *= GROUND_FRICTION; bounces++`
- After 2–3 bounces or when `|vz| < threshold`, `vz = 0` and chunk slides briefly then stops (becomes a static decal).
- `spinDeg += spinRate * dt`; `spinRate *= AIR_DRAG`.
- `ttlSec -= dt`; despawn at zero, OR convert to a permanent decal in a separate decal layer (TBD — start with despawn).

### Rendering
- Render in the same pass as units (so depth ordering by `y` is correct). Chunk sprite at `(pos.x, pos.y - z)`.
- **Pixel-art constraint**: pixel-snap position. Rotation snapped to **8 buckets** (0/45/90/135/180/225/270/315°) — pre-rotated variants in the gibs folder, OR a runtime nearest-neighbor rotation. Start with no rotation at all (just positional tumble) and add 8-bucket rotation if it looks too static.
- Optional faction tint: multiply chunk color by faction primary color. Skip for v1 — ship pre-colored chunks (red-coat-arm, blue-coat-arm, etc.) and pick by unit's faction.

### Tuning knobs (single config file)
- `GIB_MAX_SPEED`, `GIB_GRAVITY`, `GIB_BOUNCE_DAMP`, `GIB_GROUND_FRICTION`, `GIB_AIR_DRAG`, `GIB_TTL_RANGE`, `CHUNKS_PER_DEATH`. Tune by feel.

### What this does NOT do
- Doesn't simulate true rigid-body collisions (no chunk-vs-chunk, no chunk-vs-formation).
- Doesn't pull from the unit's actual layer composition (gibs are generic).
- Doesn't tie into the editor (editor doesn't know about gibs).
- Doesn't bleed onto terrain (decal layer is a future thing).

## Acceptance
**Phase 1**:
- `npm run dev` runs the bake; line-infantry's idle/walking/firing/etc. PNGs in `public/sprites/poses/line-infantry/` are regenerated from the kit. Pixel-diff against current PNGs may differ — that's expected, the kit is now authoritative.
- In-game line-infantry visually matches what `components.html` shows for the same unit/pose/facing.
- Weapon overlay still draws correctly on every pose (weapon path unchanged).
- Cuirassier and cannon-12 either bake from their kits (if those exist) or fall through gracefully.

**Phase 2**:
- Cannon round impact on a line-infantry stand spawns a burst of chunks that arc, bounce, and settle within ~5 seconds.
- Chunks render at integer pixel positions, hard-edged.
- No regressions to non-explosive deaths (musket kills still play dying animation, no gibs).

## Open questions / deferred
- **Per-frame per-facing weapon offsets for walking**: walking is multi-frame; the current weapon-attachment spec gives one `(x, y, rot)` per pose × facing. Per-frame walking weapon transforms are a follow-up if needed.
- **Decal persistence**: do gib chunks fade or persist as decals? Start with fade.
- **Gib audio**: a wet thump on each ground bounce is begging to exist. Out of scope for v1.
- **Multi-unit explosions**: if N units in blast radius all gib at once, that's 4-6×N debris entities. Verify perf at N=20+ before shipping; cap chunks per blast if needed.
