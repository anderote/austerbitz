# Pose & Animation System — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-27-pose-animation-system-design.md`

**Goal:** Replace facing-only sprite selection with a pose-driven system. Each `EntityState` maps to a pose; each pose has any subset of 8 compass directions (or `omni`) and any number of variant clips; clips can be single frames or animation cycles. Sprite assets live in `public/sprites/poses/` as flat PNGs.

**Architecture:** Build-time script walks the poses directory and emits `manifest.json`. At startup the renderer fetches the manifest, loads referenced PNGs, packs them into a single runtime atlas texture (shelf packer), and builds `(kind, pose, dir, clipIndex, frameIndex) → CellRect` lookup tables. Direction snapping is precomputed per `(kind, pose)` into an 8-slot table. Variant selection is frozen per pose-entry on the entity. Frame index is computed each draw from `poseT` and the pose-config (`static`, `loop`, `oneshot`).

**Compatibility:** During the asset transition the existing procedural baked atlas (`british-soldier-sprite.ts` et al.) stays as a fallback for any (kind, pose, dir) the manifest doesn't supply. The system ships usable on day 1 with only `idle/S` PNGs in place.

**Tech:** WebGL2, TypeScript, Vitest, Node ESM for build script (via `pngjs`).

---

## Task 1 — Pose enum and config module

**Files:** create `src/render/poses/pose-config.ts`.

Exports:

```ts
export const Pose = {
  idle: 0, walking: 1, running: 2, aiming: 3, firing: 4,
  reloading: 5, flinch: 6, ragdoll: 7, dying: 8, dead: 9,
} as const;
export type Pose = (typeof Pose)[keyof typeof Pose];

export const POSE_NAMES: readonly string[] = [
  'idle','walking','running','aiming','firing',
  'reloading','flinch','ragdoll','dying','dead',
];

export type PoseKind = 'static' | 'loop' | 'oneshot';

export const POSE_CONFIG: Record<Pose, { kind: PoseKind; fps: number }> = {
  [Pose.idle]:      { kind: 'static',  fps: 0 },
  [Pose.walking]:   { kind: 'loop',    fps: 8 },
  [Pose.running]:   { kind: 'loop',    fps: 12 },
  [Pose.aiming]:    { kind: 'static',  fps: 0 },
  [Pose.firing]:    { kind: 'oneshot', fps: 16 },
  [Pose.reloading]: { kind: 'oneshot', fps: 6 },
  [Pose.flinch]:    { kind: 'oneshot', fps: 12 },
  [Pose.ragdoll]:   { kind: 'static',  fps: 0 },
  [Pose.dying]:     { kind: 'oneshot', fps: 8 },
  [Pose.dead]:      { kind: 'static',  fps: 0 },
};

export function resolveFrame(cfg: { kind: PoseKind; fps: number }, t: number, frames: number): number {
  if (cfg.kind === 'static' || frames <= 1) return 0;
  const i = Math.floor(t * cfg.fps);
  return cfg.kind === 'loop' ? ((i % frames) + frames) % frames : Math.min(i, frames - 1);
}

export const RUN_THRESHOLD_PX_S = 60; // movement-system uses px/s; tune later
```

Also export `Direction` type:
```ts
export const DIRECTIONS = ['N','NE','E','SE','S','SW','W','NW'] as const;
export type Direction = (typeof DIRECTIONS)[number] | 'omni';
```

## Task 2 — Direction resolver

**Files:** create `src/render/poses/resolver.ts`.

Pure function, no DOM/WebGL. Given a set of available directions, compute a `Direction[8]` lookup keyed by entity facing 1..8 → 0..7 index in `DIRECTIONS`.

```ts
export function buildDirLookup(available: readonly Direction[]): Direction[] {
  if (available.includes('omni')) {
    return Array(8).fill('omni') as Direction[];
  }
  const compass = available.filter((d): d is Exclude<Direction, 'omni'> => d !== 'omni');
  if (compass.length === 0) throw new Error('pose has no directions');
  // For each of the 8 compass slots (0..7 = N..NW), find the available direction
  // with minimum modular distance. Tie-break: prefer the candidate that's
  // clockwise from the slot (lower (i - j) mod 8 over (j - i) mod 8).
  const result: Direction[] = new Array(8);
  for (let i = 0; i < 8; i++) {
    let best = compass[0]!;
    let bestDist = 9, bestCw = 9;
    for (const d of compass) {
      const j = DIRECTIONS.indexOf(d);
      const cw = (i - j + 8) % 8;
      const ccw = (j - i + 8) % 8;
      const dist = Math.min(cw, ccw);
      if (dist < bestDist || (dist === bestDist && cw < bestCw)) {
        best = d; bestDist = dist; bestCw = cw;
      }
    }
    result[i] = best;
  }
  return result;
}
```

Tests in `src/render/poses/resolver.test.ts`:
- `omni` → all 8 slots map to `omni`.
- 4-way `[N,E,S,W]` → NE→E, SE→E, SW→W, NW→W (CW tie-break).
- single `[S]` → all 8 slots map to `S`.
- 8-way → identity.

## Task 3 — Build-time manifest generator

**Files:** create `scripts/build-pose-manifest.mjs`.

Walks `public/sprites/poses/<kind>/<pose>/<dir>/<clipIndex>/<frameIndex>.png` and writes `public/sprites/poses/manifest.json`.

```js
// pseudocode
const root = 'public/sprites/poses';
const out = { kinds: {} };
for (const kind of readdir(root)) {
  out.kinds[kind] = { poses: {} };
  for (const pose of readdir(`${root}/${kind}`)) {
    if (!POSE_NAMES.includes(pose)) { warn(`unknown pose: ${pose}`); continue; }
    const dirs = readdir(`${root}/${kind}/${pose}`).filter(isDir);
    const clips = {};
    for (const dir of dirs) {
      const clipDirs = readdir(`${root}/${kind}/${pose}/${dir}`)
        .filter(isDir).map(Number).filter(Number.isInteger).sort((a,b) => a-b);
      clips[dir] = clipDirs.map(ci => {
        const frames = readdir(`${root}/${kind}/${pose}/${dir}/${ci}`)
          .filter(f => f.endsWith('.png'))
          .map(f => ({ idx: Number(f.replace('.png','')), name: f }))
          .filter(x => Number.isInteger(x.idx))
          .sort((a,b) => a.idx - b.idx)
          .map(x => `${dir}/${ci}/${x.name}`);
        return frames;
      });
    }
    out.kinds[kind].poses[pose] = { dirs, clips };
  }
}
writeJson(`${root}/manifest.json`, out);
```

Validation: reject if a pose has both `omni` and any compass direction (mutually exclusive). Warn (don't fail) on unknown pose names so authors can stash WIP folders without breaking the build.

Wire into `package.json`:
```json
"scripts": {
  "build:poses": "node scripts/build-pose-manifest.mjs",
  "dev": "npm run build:poses && vite",
  "build": "npm run build:poses && tsc --noEmit && vite build"
}
```

Commit `manifest.json` to git (deterministic output, easy to diff).

## Task 4 — Runtime atlas loader

**Files:** create `src/render/poses/atlas.ts`.

Async function that fetches `manifest.json`, loads every referenced PNG via `createImageBitmap(await (await fetch(url)).blob())`, packs into a single RGBA `OffscreenCanvas` using a simple shelf packer, and uploads as a WebGL texture.

```ts
export interface PoseCellRect { u0: number; v0: number; u1: number; v1: number; w: number; h: number; }

export interface PoseAtlas {
  texture: WebGLTexture;
  width: number;
  height: number;
  // Indexed by Pose enum (0..9), then dir (string), then clipIndex, then frameIndex
  cells: Map<string /* kind */, Array<Record<string /* Direction */, PoseCellRect[][]> | undefined>>;
  dirLookup: Map<string, Array<Direction[] | undefined>>; // [kind][pose] = 8-slot lookup
}

export async function loadPoseAtlas(
  gl: WebGL2RenderingContext,
  manifestUrl = '/sprites/poses/manifest.json',
): Promise<PoseAtlas | null>
```

Behavior:
- If fetch 404s, return `null`. Caller falls back entirely to procedural atlas.
- Shelf packer: sort sprites by descending height, lay out left-to-right wrapping rows, grow texture height as needed; texture width capped at 1024px (sufficient for hundreds of small sprites; bump if needed later).
- Pixel-perfect: half-texel UV inset like existing `cellUv`. Each rect stores `u0, v0, u1, v1` already inset.
- For each `(kind, pose)`, call `buildDirLookup(manifest.kinds[kind].poses[pose].dirs)` and store.
- WebGL texture: NEAREST filter, CLAMP_TO_EDGE (matches existing convention).

Tests (`src/render/poses/atlas.test.ts`):
- Mock `fetch` and `createImageBitmap`; supply a tiny 2-sprite manifest; assert packing is correct (rects don't overlap, all sprites placed, UVs in [0,1]).
- Manifest with omni + compass for same pose → throws.
- Empty manifest → returns valid atlas with empty maps.

## Task 5 — Entity schema changes

**Files:** modify `src/sim/entities.ts`.

- Replace `frame: Uint8Array` and `frameTime: Float32Array` with:
  ```ts
  pose:      Uint8Array;   // Pose enum 0..9
  poseT:     Float32Array; // seconds since pose entry
  clipIndex: Uint8Array;   // selected variant
  ```
- Update `createEntities` allocation and `allocEntity` reset block accordingly:
  ```ts
  e.pose[id] = 0;          // Pose.idle
  e.poseT[id] = 0;
  e.clipIndex[id] = 0;
  ```
- Search for any reads of `frame` / `frameTime` in the codebase (grep) — there are none currently per the spec, but verify.

## Task 6 — State → pose mapping in state-system

**Files:** modify `src/sim/systems/state-system.ts`.

Add a helper:
```ts
function poseFor(state: EntityState, speed: number): Pose {
  switch (state) {
    case EntityState.Idle:      return Pose.idle;
    case EntityState.Moving:    return speed > RUN_THRESHOLD_PX_S ? Pose.running : Pose.walking;
    case EntityState.Aiming:    return Pose.aiming;
    case EntityState.Firing:    return Pose.firing;
    case EntityState.Reloading: return Pose.reloading;
    case EntityState.Flinch:    return Pose.flinch;
    case EntityState.Ragdoll:   return Pose.ragdoll;
    case EntityState.Dying:     return Pose.dying;
    case EntityState.Dead:      return Pose.dead;
    default:                    return Pose.idle;
  }
}
```

Add a deterministic per-entity hash for variant selection (don't import; inline):
```ts
function pickClip(id: number, poseEnterTick: number, n: number): number {
  if (n <= 1) return 0;
  let h = id * 2654435761 ^ poseEnterTick * 1597334677;
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) % n;
}
```

In `tickStates`, after the existing switch, add an unconditional pose-update tail:
```ts
const speed = Math.hypot(e.velX[i]!, e.velY[i]!);
const desired = poseFor(e.state[i]!, speed);
if (e.pose[i] !== desired) {
  e.pose[i] = desired;
  e.poseT[i] = 0;
  // Re-roll clip variant. We don't know clip count here (lives in render atlas);
  // instead pick a stable index 0..255 from id+frameTick — render uses (idx % nClips).
  e.clipIndex[i] = pickClip(i, world.tick, 256) & 0xff;  // see note below
} else {
  e.poseT[i] = e.poseT[i]! + dt;
}
```

**Note on `world.tick`:** state-system currently doesn't take `world` directly. Two options:
1. Thread `tick` through `tickStates(... , dt, tick)` (clean, small change).
2. Use `e.poseT[i] === 0 ? Math.random() : ...` for variant pick (sim-determinism violation — reject).

Choose option 1: bump signature of `tickStates` to accept `tick: number` and update its single caller in `main.ts:62` to pass `world.tick`. If `world.tick` doesn't exist yet, add it: a monotonic frame counter incremented in `tickWorld`.

Variant index stored as 0..255; render pass does `clip = clips[clipIndex % clips.length]`.

## Task 7 — Sprite-pass: pose-driven cell selection

**Files:** modify `src/render/passes/sprite-pass.ts`.

Augment `createSpritePass` to accept an optional `poseAtlas: PoseAtlas | null`. When non-null, consult it first; otherwise fall back to current procedural atlas behavior.

Cell selection (replacing lines 242–250):

```ts
const facing = e.facing[i]!;
const pose = e.pose[i]!;
const poseT = e.poseT[i]!;
const clipIdx = e.clipIndex[i]!;

let uv: [number, number, number, number] | null = null;
if (poseAtlas) {
  uv = pickPoseCell(poseAtlas, kind.id, pose, facing, clipIdx, poseT);
}
if (!uv) {
  // Fallback: use existing procedural atlas via `meta.poseCells[facing-1]`.
  const cell = facing >= 1 && facing <= meta.poseCells.length
    ? meta.poseCells[facing - 1]!
    : (kind.spriteCell ?? meta.tintCell);
  uv = cellUv(meta, cell.col, cell.row);
}
scratchUv[k * 4 + 0] = uv[0];
scratchUv[k * 4 + 1] = uv[1];
scratchUv[k * 4 + 2] = uv[2];
scratchUv[k * 4 + 3] = uv[3];
```

`pickPoseCell` (in `atlas.ts`):
```ts
export function pickPoseCell(
  atlas: PoseAtlas, kind: string, pose: Pose, facing: number,
  clipIdx: number, poseT: number,
): [number, number, number, number] | null {
  const kindPoses = atlas.cells.get(kind);
  if (!kindPoses) return null;
  const poseEntry = kindPoses[pose];
  if (!poseEntry) {
    // Fallback within atlas: try idle.
    return pose === Pose.idle ? null : pickPoseCell(atlas, kind, Pose.idle, facing, clipIdx, poseT);
  }
  const lookup = atlas.dirLookup.get(kind)![pose]!;
  const dir = lookup[(facing - 1) & 7];
  const clips = poseEntry[dir];
  if (!clips || clips.length === 0) return null;
  const clip = clips[clipIdx % clips.length]!;
  const frame = resolveFrame(POSE_CONFIG[pose], poseT, clip.length);
  const cell = clip[frame]!;
  return [cell.u0, cell.v0, cell.u1 - cell.u0, cell.v1 - cell.v0];
}
```

**Critical**: the pose atlas has its own texture distinct from the procedural one. Two options:
1. Bind whichever atlas owns the cell (stalls instancing — bad).
2. Pack pose atlas as a *second region* into the existing combined atlas at startup (clean — single texture bind).

Choose option 2. Extend `sprite-atlas.ts` to optionally splice the loaded pose-atlas image into the bottom of the combined sheet, growing `COMBINED_SHEET_H`. Pose UVs are then offset by that splice y. Implementation detail: do this as a post-load step in `main.ts` after `loadPoseAtlas` resolves and before `createSpritePass` is constructed; the sprite-pass receives a single atlas and pose-rect lookup.

Simpler alternative for v1: keep two textures, accept an extra texture bind per frame (one full pass with procedural cells, one with pose cells). Reject — breaks painter's-algorithm sort.

Actual chosen path: **single texture, single bind**. The pose loader builds an in-memory RGBA buffer; the procedural atlas is generated as before; in `main.ts` we compose both into one larger RGBA buffer and feed that to `createSpritePass`. Pose-cell UVs are computed against the combined dimensions. This requires the pose atlas to be loaded (or known empty) before sprite-pass init.

**Consequence:** `main.ts` becomes async at startup (already wraps init in a function — small refactor).

## Task 8 — Wire it all up in main.ts

**Files:** modify `src/main.ts`.

- Make startup async: wrap top-level code in `async function start() { ... } start();`.
- Before `createRenderer` (which constructs sprite-pass), `await loadPoseAtlas(gl)`. Pass the result through to the renderer / sprite-pass.
- `createRenderer` and `createSpritePass` signatures grow a `poseAtlas: PoseAtlas | null` parameter.
- `world.tick` if not present: add to `World` type and increment in `tickWorld`. Pass to `stateSystem` closure.

In `spawn()` (line 82+): no changes needed — `allocEntity` already initializes pose fields.

## Task 9 — Seed initial pose sprites

**Files:** populate `public/sprites/poses/`.

The procedural baked atlas already produces 8-direction `idle` sprites for `line-infantry`, `cuirassier`, `cannon-12`. Write a one-shot script `scripts/seed-poses.mjs` that:

1. Generates the procedural atlas for each kind (importing the runtime modules via dynamic import).
2. Slices each cell out into individual PNGs.
3. Writes them to `public/sprites/poses/<kind>/idle/<DIR>/0/0.png`.

Uses `pngjs` (already a devDependency). Once these exist, `npm run build:poses` produces a real manifest and the runtime renders from the pose atlas for idle in all 8 directions. Other states still fall back to the procedural atlas (which only has idle anyway, so visually identical until new sprites are authored).

Dimensions match the procedural cells (soldier 11×18, cuirassier 15×20, cannon 17×14).

## Task 10 — Tests

**Files:**
- `src/render/poses/resolver.test.ts` — covered in Task 2.
- `src/render/poses/atlas.test.ts` — covered in Task 4.
- `src/render/poses/pose-config.test.ts` — `resolveFrame` boundaries: t=0, t=1/fps, looping past N frames, oneshot holding last frame, static always returning 0.
- `src/sim/systems/state-system.test.ts` (extend if exists, else create) — given an entity transitioning Idle→Moving→Aiming→Firing→Reloading→Idle, assert pose updates and `poseT` resets at each transition; assert `clipIndex` is deterministic given (id, tick).

## Task 11 — Verify

Run sequentially:
- `npm run build:poses` — exits 0, writes `manifest.json`.
- `npm run typecheck` — passes.
- `npm test` — all pass.
- `npm run dev` — open browser, spawn line-infantry, confirm:
  - Idle units render correctly (pose atlas path).
  - Marching units still render (walking falls back to idle).
  - Firing/reloading still render (fall back to idle facing).
  - No console errors about missing manifest entries.

Manual smoke test: delete `manifest.json` → confirm everything still renders via procedural fallback (no crashes).

---

## Implementation Order & Parallelism

Tasks 1–4 are independent and can run in parallel (config/resolver/manifest-script/atlas-loader). Tasks 5–8 depend on 1–4. Task 9 depends on 3 (script integration) but is otherwise independent. Tasks 10 are written alongside their corresponding implementation tasks.

Recommended subagent split:
- **Agent A:** Tasks 1, 2, 10a (pose-config + resolver + their tests) — pure functions, easy to verify.
- **Agent B:** Task 3, 9 (manifest builder + seed script) — Node ESM, no GL.
- **Agent C:** Task 4, 7, 8 (atlas loader + sprite-pass changes + main.ts wiring) — needs GL context familiarity.
- **Agent D:** Tasks 5, 6, 10b (entity schema + state-system + state tests).

After all agents land: run Task 11 manually.
