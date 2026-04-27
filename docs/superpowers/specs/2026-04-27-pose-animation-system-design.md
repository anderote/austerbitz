# Pose & Animation System — Design

**Date:** 2026-04-27
**Status:** Approved

## Goal

Replace the current "facing-only" sprite selection with a pose-driven animation system. Each `EntityState` (idle, walking, running, aiming, firing, reloading, flinch, ragdoll, dying, dead) selects a pose. Each pose can ship with any subset of compass directions (8-way, 4-way NSWE, or omnidirectional) and any number of variant clips. Variants are picked randomly per pose-entry. Clips can be single stills or multi-frame animation cycles.

The author's surface is purely the filesystem: drop PNGs into a directory tree and the system picks them up.

## Non-Goals

- Component-compositor integration. The runtime consumes flat PNGs only. If layered anatomy/uniform/weapon composition is reintroduced, it bakes into pose PNGs offline as a separate tool.
- Pose blending or tweening. Snap cuts only.
- Per-faction sprite variation beyond the existing magenta/cyan team-color marker scheme.

## Filesystem Layout

```
public/sprites/poses/<unit-kind>/<pose>/<direction>/<clip-index>/<frame-index>.png
```

- **`unit-kind`** — `line-infantry`, `cuirassier`, `cannon-12`, …
- **`pose`** — one of: `idle`, `walking`, `running`, `aiming`, `firing`, `reloading`, `flinch`, `ragdoll`, `dying`, `dead`.
- **`direction`** — one of: `N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`, `omni`. A pose may use any non-empty subset of these. `omni` is mutually exclusive with the compass directions.
- **`clip-index`** — `0`, `1`, `2`, … Sibling clips are variants; one is picked at random when an entity enters the pose.
- **`frame-index`** — `0.png`, `1.png`, … Frames within a clip play in order.

### Examples

```
poses/line-infantry/idle/S/0/0.png                      # one S-only still
poses/line-infantry/dying/omni/0/0.png                  # three omni stills
poses/line-infantry/dying/omni/1/0.png                  # — random pick on death
poses/line-infantry/dying/omni/2/0.png
poses/line-infantry/reloading/N/0/0.png                 # 4-way reload, 1 clip per dir
poses/line-infantry/reloading/S/0/0.png
poses/line-infantry/reloading/E/0/0.png
poses/line-infantry/reloading/W/0/0.png
poses/line-infantry/walking/N/0/0.png … 3.png           # 8-way 4-frame walk cycle
poses/line-infantry/walking/NE/0/0.png … 3.png
…
```

## Manifest

A build script (`scripts/build-pose-manifest.ts`) walks `public/sprites/poses/` and writes `public/sprites/poses/manifest.json`. Runs as part of `npm run dev` and `npm run build`.

```jsonc
{
  "kinds": {
    "line-infantry": {
      "poses": {
        "idle":    { "dirs": ["S"],                                          "clips": { "S":    [["S/0/0.png"]] } },
        "dying":   { "dirs": ["omni"],                                       "clips": { "omni": [["omni/0/0.png"], ["omni/1/0.png"], ["omni/2/0.png"]] } },
        "walking": { "dirs": ["N","NE","E","SE","S","SW","W","NW"],          "clips": { "N":    [["N/0/0.png","N/0/1.png","N/0/2.png","N/0/3.png"]], "NE": [...], ... } }
      }
    }
  }
}
```

`clips[dir]` is `Clip[]`. Each `Clip` is `string[]` of frame paths in order. This unifies stills and animations: a still is a length-1 clip; multiple stills are multiple length-1 clips (= variants); a walk cycle is one length-N clip; multiple walk cycle variants are multiple length-N clips.

## Pose Configuration

`src/render/poses/pose-config.ts`:

```ts
export type PoseKind = 'static' | 'loop' | 'oneshot';

export const POSE_CONFIG: Record<Pose, { kind: PoseKind; fps?: number }> = {
  idle:      { kind: 'static' },
  walking:   { kind: 'loop',    fps: 8 },
  running:   { kind: 'loop',    fps: 12 },
  aiming:    { kind: 'static' },
  firing:    { kind: 'oneshot', fps: 16 },
  reloading: { kind: 'oneshot', fps: 6 },
  flinch:    { kind: 'oneshot', fps: 12 },
  ragdoll:   { kind: 'static' },
  dying:     { kind: 'oneshot', fps: 8 },
  dead:      { kind: 'static' },
};
```

Frame resolution given pose-elapsed-time `t` and clip frame count `N`:

| Kind      | Frame index                          |
|-----------|--------------------------------------|
| `static`  | `0`                                  |
| `loop`    | `floor(t * fps) mod N`               |
| `oneshot` | `min(floor(t * fps), N - 1)` (holds last frame) |

`fps` is reversible defaults; tweak freely.

## Runtime Atlas

At startup, fetch `manifest.json`, load every referenced PNG, pack into one runtime texture atlas using a shelf packer (existing `sprite-atlas.ts` patterns are sufficient). Build:

```ts
type CellRect = { u0: number; v0: number; u1: number; v1: number; w: number; h: number };

interface PoseAtlas {
  texture: WebGLTexture;
  // Lookup: kind → pose → dir → clipIndex → frameIndex → CellRect
  cells: Record<UnitKind, Record<Pose, Record<Direction, CellRect[][]>>>;
  // Per-(kind, pose) precomputed map: 1..8 facing → resolved direction key
  dirLookup: Record<UnitKind, Record<Pose, (Direction | null)[]>>;
}
```

Pixel-perfect sampling rules follow the existing atlas (NEAREST filtering, half-pixel UV insets).

## Direction Resolution

Entity facing is 1–8 in compass order N→NW (existing convention).

For each `(kind, pose)`, the loader precomputes `dirLookup[1..8] → Direction`:

- If pose's `dirs = ["omni"]` → all 8 entries point to `omni`.
- Else snap each compass slot to the nearest available direction by minimum modular distance on the 8-step compass. Ties prefer the more "horizontal" axis (E/W over N/S) for visual consistency.

This lookup is O(1) at render time — no angle math per entity per frame.

## Variant Selection

When an entity transitions into a pose (state change), pick a clip index once:

```ts
entities.clipIndex[i] = hash(entityId ^ poseEntryTick) % clips[dir].length;
```

The choice is frozen until the next state transition. This avoids per-frame flicker and gives each soldier a stable "personality" within a single action.

## Entity Schema Additions

In `src/sim/entities.ts`:

```ts
pose:       Uint8Array;   // Pose enum
poseT:      Float32Array; // seconds elapsed since pose entry
clipIndex:  Uint8Array;   // selected variant (0..255)
```

`frame` and `frameTime` (currently allocated but unused) are removed — `poseT` replaces them.

## State → Pose Mapping

In `state-system.ts`, on every state transition:

```ts
function poseFor(state: EntityState, speed: number): Pose {
  switch (state) {
    case Idle:      return Pose.idle;
    case Moving:    return speed > RUN_THRESHOLD ? Pose.running : Pose.walking;
    case Aiming:    return Pose.aiming;
    case Firing:    return Pose.firing;
    case Reloading: return Pose.reloading;
    case Flinch:    return Pose.flinch;
    case Ragdoll:   return Pose.ragdoll;
    case Dying:     return Pose.dying;
    case Dead:      return Pose.dead;
  }
}
```

When `pose` changes: zero `poseT`, re-roll `clipIndex`. Each tick, increment `poseT` by dt for entities whose pose isn't `static` (cheap branchless: increment all, ignore for static at render time).

`Moving` is special: on each tick, recompute desired pose because speed can cross the run threshold without a state change. Compare to current pose; if changed, reset `poseT` and `clipIndex`.

## Render Pass Changes

`src/render/passes/sprite-pass.ts:242` currently:

```ts
const cell = facing >= 1 && facing <= meta.poseCells.length
  ? meta.poseCells[facing - 1]!
  : (kind.spriteCell ?? meta.tintCell);
```

becomes:

```ts
const dir = poseAtlas.dirLookup[kind][pose][facing];
const clip = poseAtlas.cells[kind][pose][dir]?.[clipIndex];
const frameIdx = resolveFrame(POSE_CONFIG[pose], poseT, clip.length);
const cell = clip[frameIdx];
```

Recoil wave, team-color tinting, painter's-algorithm sort, dot-zoom fallback all unchanged.

## Fallback Chain

Lookup misses cascade:

1. Same `(kind, pose)`, snap to a direction that exists.
2. `(kind, idle)` (always required), same direction.
3. Procedural baked atlas (existing `british-soldier-sprite.ts`) — only `idle/S` available.
4. Tint cell (last resort).

This means the system ships usable on day 1 with only `idle` poses defined and degrades gracefully as poses are added incrementally.

## Files Touched / Added

**New:**
- `scripts/build-pose-manifest.ts`
- `src/render/poses/loader.ts` — fetch manifest, load PNGs, pack atlas
- `src/render/poses/atlas.ts` — `PoseAtlas` type and lookup
- `src/render/poses/pose-config.ts` — `POSE_CONFIG`, `resolveFrame`
- `src/render/poses/resolver.ts` — direction snapping
- `public/sprites/poses/<kinds>/idle/...` — initial migration of existing baked sprites
- `public/sprites/poses/manifest.json` — generated artifact (gitignored or committed; default committed)

**Modified:**
- `src/sim/entities.ts` — add `pose`, `poseT`, `clipIndex`; remove `frame`, `frameTime`
- `src/sim/systems/state-system.ts` — set pose on state transition; tick `poseT`
- `src/render/passes/sprite-pass.ts:242` — replace cell selection
- `src/main.ts` — load pose atlas at startup; init pose fields on spawn
- `package.json` — add manifest-build script to dev/build

**Kept (unchanged):**
- `src/render/sprite-atlas.ts` — pattern dots and procedural fallback
- `src/render/shaders/sprite.glsl.ts`
- `src/render/british-soldier-sprite.ts` — repurposed as fallback supplier for `idle/S`

## Testing

- **Unit:** direction snapping (8 → arbitrary subset), frame resolution (static/loop/oneshot at edge times), variant selection determinism (same `(id, entryTick)` → same clip).
- **Integration:** spawn an entity, run state machine through `Idle → Moving → Aiming → Firing → Reloading → Flinch → Dying → Dead`, assert correct pose and frame at each step.
- **Manual:** load with only `idle/S` defined, confirm fallback chain renders all states without crash.

## Risks / Open Questions

- **PNG load count.** A full pose set across kinds could be hundreds of files. Mitigation: load is parallel `fetch`, packing happens once. If it becomes an issue, switch to a pre-baked atlas PNG + JSON cell-map artifact (offline tool, same data shape).
- **Hot-reload during dev.** Out of scope; manifest rebuild requires page reload.
