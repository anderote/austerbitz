# Cannon-12 + Cuirassier components — design

## Goal

Bring `cannon-12` and `cuirassier` into the line-infantry-style components +
poses pipeline, so each unit:

- Has a layered kit JSON in `public/components/kits/<id>.json` matching the
  `line-infantry.json` shape (per-facing layer arrays, per-(pose, facing)
  layer arrays + weapon offsets, optional weapon block).
- Has component PNGs under `public/sprites/components/<category>/...` per
  layer × facing.
- Renders pose frames into `public/sprites/poses/<id>/<pose>/<dir>/<clip>/<frame>.png`
  by running through `build-soldier-components.mjs` →
  `slice-component-atlas.mjs` → `build-pose-manifest.mjs`.
- Shows up in the components editor (`public/components-editor.html`) for
  per-pose, per-facing, per-component pixel edits + offsets.

Order: **cannon first**, cuirassier second.

## Non-goals

- No charge pose for cuirassier (deferred).
- No cannon crew (gun + carriage only; crew figures are a later pass).
- Don't delete the legacy `src/render/cuirassier-sprite.ts` or
  `src/render/cannon-12-sprite.ts`. They stay as fallback until the new
  pipeline is verified end-to-end. Removing them is a separate cleanup.
- Don't touch the monolithic ASCII pose lib `scripts/lib/cuirassier-poses.mjs`
  yet. The new component-layered output for cuirassier will land alongside it
  and replace its output gradually. (See "cuirassier migration" below.)
- No new pose enums (`charge`, `melee_strike`). Existing pose enum is enough.

## Cell size

Both kits use the line-infantry-style **32 × 36** component cell, same as
`build-soldier-components.mjs` constants `CELL_W=32`, `CELL_H=36`. This
slightly differs from the existing cuirassier 32×24 monolithic pose cell —
the layered kit gets headroom for plume/helmet/spear-tip artifacts. The
sliced output frames remain compatible with the runtime PoseAtlas, which
reads cell dimensions from the manifest.

Anchor convention: bottom-center of the cell aligns with ground position
(consistent with line-infantry).

## Cannon-12 kit

### Components (new, drawn by a new `scripts/build-cannon-12-components.mjs`)

Categories under `public/sprites/components/`:

- `carriage/wheels-<dir>.png` — pair of wheels per facing
- `carriage/trail-<dir>.png` — wooden trail/cheeks (carriage frame)
- `barrel/barrel-<dir>.png` — bronze barrel
- `barrel/muzzle-flash-<dir>-fire.png` — fire-pose only, three source facings
- `tools/handspike-<dir>-reload.png` — reload-pose only
- `fx/smoke-<dir>-fire.png` — fire-pose smoke puff (post-recoil)

Three source facings (`N`, `NW`, `W`) authored, plus `S`, `NE`, `E`, `SE`,
`SW` — same 8-facing set as line-infantry. Source/derived pattern is
configurable per-component but not auto-mirrored at build time for now (we
hand-author all 8 directly to keep the cannon silhouette readable from each
angle; cannons are large and asymmetric enough that mirroring is awkward).

### Kit JSON: `public/components/kits/cannon-12.json`

Top-level fields mirror `line-infantry.json`:

- `id: "cannon-12"`, `label: "12-Pounder Cannon"`
- `baseAtlas: "public/sprites/cannon-12-components.png"` (output of build)
- `outputAtlas`, `outputPreview` per convention
- `facings.<DIR>.cell` — 3×3 grid placement
- `facings.<DIR>.layers` — `["carriage-trail-<dir>", "carriage-wheels-<dir>", "barrel-<dir>"]`
  (ordered back-to-front: trail, wheels, barrel on top)

### Poses

| Pose      | Frames | Notes                                         |
|-----------|--------|-----------------------------------------------|
| `idle`    | 1      | facings layers only                           |
| `fire`    | 1      | barrel offset back +recoil; muzzle-flash + smoke layer added; uses `weapon`-block-like offset only if needed; for cannon, recoil baked into per-facing layer offset |
| `reload`  | 1      | trail tilted (small layer offset); handspike layer added (gunner pose component) |
| `hit`     | 1      | small jolt offset; spark fx layer optional   |
| `destroyed` | 1    | trail collapsed; wheel detached; smoke layer |

Pose enum mapping (per `runtimePoseToEditorPoseName` in
`src/render/poses/kit-loader.ts`):

- `firing` → `fire`
- `reloading` → `reload`
- `hit` → `hit`
- `dying`/`dead` → `destroyed` (extend the pose-name mapping)

### No `weapon` block

Cannon IS the weapon. The muzzle flash for `fire` is just a pose-specific
layer, not a weapon attachment. So the kit JSON has no `weapon` field. The
runtime weapon-pass already skips kits without `weapon` (`kit-loader.ts:40`,
"weapon pass simply skips entities whose kit is unknown or unarmed").

## Cuirassier kit

### Components

Existing under `public/sprites/components/`: only `horse-bay-<dir>` (8 files,
written by `scripts/draw-cuirassier-components.mjs`).

New components to author:

- `anatomy/rider-torso-<dir>.png` — bare torso (skin + breeches base)
- `armor/cuirass-<dir>.png` — breastplate, primary marker for regiment color
- `headgear/helmet-cuirassier-<dir>.png` — steel helmet with plume
- `anatomy/rider-legs-<dir>.png` — riding boots over saddle
- `anatomy/rider-arms-<dir>-idle.png` — neutral arms
- `anatomy/rider-arms-<dir>-saber-ready.png` — arms in saber-ready pose
- `weapon/saber-<dir>.png` — saber, 3 source facings (N, NW, W) for weapon block

Reuse pattern from `draw-cuirassier-components.mjs` (procedural pixel art
with named palette + helper functions). Add to that script (don't fork).

### Kit JSON: extend `public/components/kits/cuirassier.json`

Promote from horse-only to full line-infantry-shaped:

- `facings.<DIR>.layers`: `["horse-bay-<dir>", "rider-legs-<dir>", "rider-torso-<dir>", "cuirass-<dir>", "rider-arms-<dir>-idle", "helmet-cuirassier-<dir>"]`
- `poses.idle.<DIR>` — `{ layers: [...], weapon: { x, y, rot } }` like line-infantry idle.
- `poses.walking.<DIR>` — array of 4 frames, animated horse-bay-<dir>-walk-<n>
  (new variants drawn) + same rider layers.
- `poses.running.<DIR>` — array of 6 frames with run cycle.
- `poses.hit.<DIR>` — body slumped; blood layer.
- `poses.dying.<DIR>` — rider unhorsed / horse fallen.
- `weapon.layerPrefix: "saber"`, `weapon.facings` — N/NW/W authored, others
  derived (NE=flipX(NW), E=flipX(W), SE=rot180(NW), S=flipY(N), SW=flipY(NW)).

The horse-bay walk/run frame variants (e.g. `horse-bay-N-walk-0`,
`horse-bay-N-walk-1`, ...) need to be added to the components script. Each
horse component already exists for idle; walking/running need 4 / 6 leg
positions per facing.

### Cuirassier migration

- The new layered output is produced by `build-soldier-components.mjs --kit cuirassier`,
  which already handles arbitrary kits.
- The legacy `scripts/draw-cuirassier-poses.mjs` (monolithic ASCII frames)
  stays in place but is no longer wired into `npm run build:poses`. The
  `package.json` `build:poses` script needs to add a `--kit cuirassier`
  build pass after the line-infantry pass.

## Editor wiring

- Add `"cannon-12"` to `public/components/kits/index.json`. Editor loads kits
  from this index automatically.
- No editor code changes required — the editor reads kit JSONs through
  `loadKits()` in `kit-loader.ts`. Both kits use the same shape so existing
  pose tabs / weapon handle / pixel-paint tools just work.

## Runtime wiring

- `src/render/poses/kit-loader.ts:119` `runtimePoseToEditorPoseName` —
  extend so cannon's `firing` → `fire`, `reloading` → `reload`,
  `hit` → `hit`, `dying`/`dead` → `destroyed`. The current mapping already
  covers these for line-infantry (which uses `make-ready` / `present` / etc.
  instead). Cannon and cuirassier use `fire` / `reload` directly so a small
  branch on kit id (or a registry-keyed map) is needed.
  - Simpler: rename cannon poses to match the existing mapping
    (`make-ready` instead of `reload`, `fire` already matches). I'll do that
    — keeps the runtime mapping unchanged.
- `src/data/units/cuirassier.ts` and `cannon-12.ts` already point at the
  pose pipeline indirectly via the kit-loader. No changes there unless
  `spriteCell` lookups need adjusting (verify during implementation).

## Build-script wiring

`package.json` currently:

```json
"build:soldier-components": "node scripts/build-soldier-components.mjs --kit line-infantry && node scripts/slice-component-atlas.mjs",
"build:poses": "npm run build:soldier-components && node scripts/build-pose-manifest.mjs",
```

Update to:

```json
"build:components": "node scripts/build-cannon-12-components.mjs && node scripts/draw-cuirassier-components.mjs && node scripts/redraw-components.mjs",
"build:atlas": "node scripts/build-soldier-components.mjs --kit line-infantry && node scripts/build-soldier-components.mjs --kit cuirassier && node scripts/build-soldier-components.mjs --kit cannon-12 && node scripts/slice-component-atlas.mjs",
"build:poses": "npm run build:components && npm run build:atlas && node scripts/build-pose-manifest.mjs",
```

(Names refined during implementation; the goal is one command produces every
unit's components + atlases + sliced poses + manifest.)

## Validation

- `npm run build:poses` succeeds, produces:
  - `public/sprites/cannon-12-components.png` and per-pose variants
  - `public/sprites/cuirassier-components.png` and per-pose variants
  - `public/sprites/poses/cannon-12/{idle,fire,make-ready,hit,dying}/<dir>/0/0.png`
  - `public/sprites/poses/cuirassier/{idle,walking,running,hit,dying}/<dir>/0/<n>.png`
- `public/sprites/poses/manifest.json` lists both kits.
- `npm run typecheck` passes.
- `npm test` passes (atlas tests in `src/render/poses/atlas.test.ts`,
  resolver tests, etc.).
- Editor (`/components.html` or `/components-editor.html`) shows both kits in
  the dropdown; pose tabs render for each; pixel-paint + offset tools work.
- In-game: `npm run dev`, drop a cannon and a cuirassier into the lab via
  the editor / unit-inspector, confirm sprites render in all 8 facings and
  fire/idle poses transition correctly.

## Open questions resolved

- Cuirassier weapon: **saber**.
- Cannon crew: **deferred**.
- Charge pose: **deferred**.
- Order: **cannon first**.
