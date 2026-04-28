# Cannon-12 + Cuirassier components — implementation plan

Spec: `docs/superpowers/specs/2026-04-27-cannon-cuirassier-components.md`

Order: cannon first, cuirassier second. Each phase ends with a green build +
visible result so we can stop and inspect before continuing.

---

## Phase 1 — Cannon-12 (new kit, full pipeline)

### 1.1 Cannon components script

Create `scripts/build-cannon-12-components.mjs`. Pattern: copy the structure
of `scripts/draw-cuirassier-components.mjs` (procedural pixel art with named
palette + helpers + per-facing layer functions).

Output PNG files (32×36 RGBA, transparent bg):

- `public/sprites/components/carriage/cannon12-wheels-<DIR>.png` × 8
- `public/sprites/components/carriage/cannon12-trail-<DIR>.png` × 8
- `public/sprites/components/barrel/cannon12-barrel-<DIR>.png` × 8
- `public/sprites/components/barrel/cannon12-muzzle-flash-<DIR>-fire.png` × 3 (N, NW, W; rest derive at runtime via UV-flip — these are weapon-source-style)
- `public/sprites/components/fx/cannon12-smoke-<DIR>-fire.png` × 8
- `public/sprites/components/tools/cannon12-handspike-<DIR>-reload.png` × 8

Each file appended to `public/components/index.json` with appropriate
category, facings, path, pivot, anchors fields (follow line-infantry entries
as templates).

Palette: bronze barrel (warm brass), brown wood carriage, dark steel
fittings, primary marker on carriage trim (regiment color sample).

### 1.2 Cannon kit JSON

Create `public/components/kits/cannon-12.json` with:

- `id: "cannon-12"`, `label: "12-Pounder Cannon"`
- `baseAtlas: "public/sprites/cannon-12-components.png"`
- `outputAtlas: "public/sprites/cannon-12-components.png"`
- `outputPreview: "public/sprites/cannon-12-components-preview.png"`
- `facings` — all 8 directions, layers `["cannon12-trail-<dir>", "cannon12-wheels-<dir>", "cannon12-barrel-<dir>"]`
- `poses.idle.<DIR>` — empty layer override (uses base facings)
- `poses.fire.<DIR>` — adds `cannon12-muzzle-flash-<dir>-fire` + `cannon12-smoke-<dir>-fire`; barrel offset back via `offsets.json` (recoil)
- `poses.make-ready.<DIR>` — reload pose: adds `cannon12-handspike-<dir>-reload`; trail tilt via offset
- `poses.hit.<DIR>` — minor offset jolt; no extra layer
- `poses.dying.<DIR>` — wheel-detached + smoke; uses dying-variant layers

(Pose names `fire`, `make-ready`, `hit`, `dying` chosen so the existing
`runtimePoseToEditorPoseName` mapping in `kit-loader.ts:119-135` works
unchanged.)

No `weapon` block.

### 1.3 Register cannon kit

Edit `public/components/kits/index.json`:

```json
["line-infantry", "cuirassier", "cannon-12"]
```

### 1.4 Wire build scripts

Edit `package.json`:

- Add new step that runs `node scripts/build-cannon-12-components.mjs`
  before the atlas build.
- Add an atlas-build step for cannon: `node scripts/build-soldier-components.mjs --kit cannon-12`.
- Updated `build:poses` runs all 3 kits + slicer + manifest.

Confirm `build-soldier-components.mjs` accepts `--kit cannon-12` without
modification. If it has hardcoded line-infantry assumptions, generalize.

### 1.5 Pose-name mapping

If needed, extend `src/render/poses/kit-loader.ts:119` to handle the cannon
case. Default plan: stay with `fire` / `make-ready` / `hit` / `dying` so
existing mapping is enough. Verify by reading `runtimePoseToEditorPoseName`.

### 1.6 Verify cannon end-to-end

- `npm run build:poses` succeeds, creates expected files.
- `public/sprites/poses/cannon-12/idle/<DIR>/0/0.png` exists for all 8
  directions. Same for `fire`, `make-ready`, `hit`, `dying`.
- `public/sprites/poses/manifest.json` lists `cannon-12` with all 5 poses.
- `npm run typecheck` passes.
- `npm test` passes.
- Editor: open `/components-editor.html`, switch kit dropdown to `cannon-12`,
  confirm all facings + poses render with no broken-image placeholders.
- Game: `npm run dev`, drop a cannon-12 in the lab, confirm renders + fires.

**Stop point.** Commit phase 1. Inspect output before phase 2.

---

## Phase 2 — Cuirassier (extend kit + add rider components)

### 2.1 Rider components

Extend `scripts/draw-cuirassier-components.mjs` (don't fork). Add per-facing
layer-emit functions for:

- `anatomy/rider-torso-<DIR>.png`
- `armor/cuirass-<DIR>.png` (primary marker pixels for regiment color)
- `headgear/helmet-cuirassier-<DIR>.png` (with plume strands as separate
  pixels, not a child layer for now)
- `anatomy/rider-legs-<DIR>.png`
- `anatomy/rider-arms-<DIR>-idle.png` (saber sheathed, hands on reins)
- `anatomy/rider-arms-<DIR>-saber-ready.png` (saber raised across body)
- `weapon/saber-<DIR>.png` × 3 source facings (N, NW, W)

For walk/run animation, also emit:

- `anatomy/horse-bay-<DIR>-walk-<0..3>.png` × 8 dirs × 4 frames
- `anatomy/horse-bay-<DIR>-run-<0..5>.png` × 8 dirs × 6 frames

Append all new entries to `public/components/index.json`.

### 2.2 Cuirassier kit JSON

Promote `public/components/kits/cuirassier.json` from horse-only to a full
line-infantry-shaped kit:

- `facings.<DIR>.layers` — full stack: `["horse-bay-<dir>", "rider-legs-<dir>", "rider-torso-<dir>", "cuirass-<dir>", "rider-arms-<dir>-idle", "helmet-cuirassier-<dir>"]`
- `poses.idle.<DIR>` — `{ layers: [base...], weapon: { x, y, rot } }`
- `poses.walking.<DIR>` — array of 4 frames swapping `horse-bay-<dir>-walk-<n>` for the horse layer
- `poses.running.<DIR>` — array of 6 frames swapping `horse-bay-<dir>-run-<n>`
- `poses.hit.<DIR>` — slumped torso variant + `blood-<dir>-hit`
  (reuse line-infantry blood components or add cuirassier-specific ones)
- `poses.dying.<DIR>` — fallen horse + rider variants
- `weapon.layerPrefix: "saber"`, `weapon.facings`:
  - `N`, `NW`, `W` — `{ src: "self" }`
  - `NE` — `{ src: "NW", transform: "flipX" }`
  - `E` — `{ src: "W", transform: "flipX" }`
  - `S` — `{ src: "N", transform: "flipY" }`
  - `SE` — `{ src: "NW", transform: "rot180" }`
  - `SW` — `{ src: "NW", transform: "flipY" }`

### 2.3 Pose-config defaults

Update any pose-config offsets / pixel edits as needed. The components-editor
will be the long-term home for these; for the initial commit, ship sensible
defaults baked into the kit JSON.

### 2.4 Wire cuirassier into build:poses

Add `node scripts/build-soldier-components.mjs --kit cuirassier` to the
atlas-build step in `package.json`. Existing `draw-cuirassier-poses.mjs` and
its `npm run draw:cuirassier-poses` script remain (legacy fallback) but are
no longer part of `build:poses`.

### 2.5 Verify cuirassier end-to-end

- `npm run build:poses` succeeds for cuirassier; produces:
  - `public/sprites/cuirassier-components.png` + per-pose variants
  - `public/sprites/poses/cuirassier/{idle,walking,running,hit,dying}/<DIR>/0/<n>.png`
- Manifest lists cuirassier with all 5 poses.
- `npm run typecheck` + `npm test` green.
- Editor: cuirassier kit shows full layer list (horse + rider + cuirass +
  helmet + saber) per facing; pose tabs render correctly.
- Game: lab spawn cuirassier, confirms renders idle / walking / running with
  saber visible at the per-pose offset.

**Stop point.** Commit phase 2. Inspect.

---

## Phase 3 — Cleanup + tests

### 3.1 Pose-frame edits

Surface `cannon-12` in `public/components/pixel-edits.json` schema (top-level
key gets added when first edit is saved by the editor — no schema change
needed, just confirm it isn't blocked).

### 3.2 Tests

- Add an integration test under `src/render/poses/` that loads the
  `cannon-12` and `cuirassier` kits via `loadKits()` and asserts every
  pose × facing has a valid layer array (or weapon entry).
- Snapshot the `manifest.json` shape so future regressions catch missing
  poses.

### 3.3 Doc + commit

- Update `README.md` (if present) "Adding a new unit" section to mention the
  components-editor pipeline.
- Final commit. **Do not push** (per global CLAUDE.md).

---

## Subagent dispatch plan

Phase 1 (cannon) and Phase 2 (cuirassier) touch mostly disjoint files, so
they can run in parallel after Phase 1.4 (build-script wiring) is committed.
Recommended dispatch:

1. **Subagent A (sequential first)**: Phase 1 — cannon end-to-end. Write the
   draw script, kit JSON, register, wire build scripts, verify. Commits:
   - `feat(sprites): cannon-12 component pipeline (idle/fire/reload/hit/dying)`
2. **Subagent B (parallel after A.4)**: Phase 2 — cuirassier rider + saber +
   pose extension. Commits:
   - `feat(sprites): cuirassier rider + saber via component pipeline`
3. **Subagent C (sequential after A & B)**: Phase 3 — tests + cleanup.

All subagents are forbidden to push or merge. Per-subagent commits are
allowed but the user makes the final commit-boundary call (per global
CLAUDE.md "do not commit on each subagent task completion").
