# Gun Crew Phase 2 — Animated Sequential Reload Drill

**Date:** 2026-04-29
**Status:** Approved (design-level), pending implementation plan
**Builds on:** Phase 1 spec at `docs/superpowers/specs/2026-04-29-gun-crew-sprites-design.md`

## Problem

Phase 1 shipped four independent crew entities per gun, all rendering as
identical line-infantry idle figures. Phase 2 adds:

1. **Per-role visual differentiation** — each crewman holds a role-specific
   tool (sponge / cartridge / rammer / linstock).
2. **Sequential animated reload drill** — during the gun's reload cycle, the
   four roles act in historical order (sponger → loader → rammer → gunner),
   each playing a multi-frame action animation in their assigned phase
   window.

## Non-goals

- Crew don't take damage, die separately, or get displaced. Same as Phase 1.
- No standalone crew AI. Pose state is a pure function of the parent gun's
  state + per-role timing.
- No fire-event flinch / recoil step-back animation. The gun's firing pose
  handles the kaboom; crew snap back to idle after the cycle.
- No crossfade or overlap between role windows. Strict sequential, slight
  visual gap is acceptable.
- No randomized variation between cannons. Every cannon's crew animates
  identically given the same `reloadT`.

## Architecture

### Four role kinds, not one

Phase 1's `gun-crew` `UnitKind` is replaced by four kinds:
`gun-crew-sponger`, `gun-crew-rammer`, `gun-crew-loader`, `gun-crew-gunner`.

The kit JSON format keys layers by `(pose, facing)` only — no per-role axis —
so the cleanest way to give each role a distinct tool layer and distinct
reload frames is one kind per role with one kit per role.

The four kinds share base stats verbatim (copy from Phase 1 `gunCrew`); they
differ only in `id` and `kit` reference. They live in
`src/data/units/gun-crew-<role>.ts`. The Phase 1 `gunCrew` file is removed.

`spawnCrewForGun` looks up the kind id per role:

```ts
const ROLE_KIND_ID: Record<CrewRole, string> = {
  [CrewRole.Sponger]: 'gun-crew-sponger',
  [CrewRole.Rammer]:  'gun-crew-rammer',
  [CrewRole.Loader]:  'gun-crew-loader',
  [CrewRole.Gunner]:  'gun-crew-gunner',
};
```

The `crewRole` SoA field is retained — it's still useful for `tickCrew` and
keeps the role lookup a constant-time array index.

### Sequential reload windows

Reload cycle is divided into four equal phases of 0.25 each:

| Role     | Window      | Action                                |
|----------|-------------|---------------------------------------|
| Sponger  | [0.00, 0.25] | Swab the bore (extinguish embers)     |
| Loader   | [0.25, 0.50] | Present cartridge to rammer / muzzle  |
| Rammer   | [0.50, 0.75] | Ram the charge home                   |
| Gunner   | [0.75, 1.00] | Prime the vent, take aim with linstock |

`fullProgress ∈ [0, 1]` is the fraction of reload elapsed:
`1 - reloadT / reloadInitialT`.

Within a role's window, the role plays a 4-frame `reloading` pose, advancing
linearly. Outside the window, the role's pose is `idle`. Concretely, for each
crewman each tick:

```
if parent.state == EntityState.Reloading and
   fullProgress in [role.windowStart, role.windowEnd]:
    pose = Pose.reloading
    roleProgress = (fullProgress - windowStart) / (windowEnd - windowStart)
    poseT = roleProgress * 4 / FPS_RELOADING   // map across all 4 frames
else:
    pose = Pose.idle
    poseT = 0
```

`FPS_RELOADING` is the existing fps for the `reloading` pose
(`POSE_CONFIG[Pose.reloading].fps = 6` per `pose-config.ts`). Using the
existing fps avoids touching `pose-config.ts`. The 4-frame clip plays in
`4 / 6 ≈ 0.667s` of pose-time, which we stretch across the role's actual
window in real seconds by setting `poseT` directly each tick.

### `reloadInitialT` SoA field

`reloadT` is randomized per fire (`baseReload * 0.8..1.2`) and decremented to
0. The cycle's total duration is not currently stored anywhere. To compute
`fullProgress` we need it.

Cleanest fix: a new `reloadInitialT: Float32Array` field on `Entities`, set
alongside `reloadT` in `state-system.ts` when transitioning to Reloading.
Cost: one additional Float32 per entity slot, written once per fire on guns
only. `tickCrew` reads it.

Alternative considered and rejected: estimate `fullProgress` from
`baseReload` alone. The 20% randomization causes per-cannon drift large
enough to misalign role windows visibly (a 16s reload would consume the
entire sponger window in <1s of real time). Not acceptable.

### Crew pose state ownership

`tickCrew` owns the entire crew pose state machine. It writes `pose` and
`poseT` directly each tick, ignoring whatever the standard state-system
would write for these entities. Crew entities are excluded from
`state-system.ts`'s pose-mapping logic — either by checking their kindId, or
by `tickCrew` running *after* `state-system.ts` and overwriting.

Choice: run `tickCrew` after `state-system.ts` in the per-frame system list.
That's the minimal-touch option (no kindId-based gating in state-system).
Order in `cannon-test/main.ts` becomes:

```
movementSystem
facingSystem
combatSystem
tickStates           // sets pose for all entities including crew (gets overwritten)
tickCrew             // recomputes crew pose/poseT from parent gun state
tickProjectiles
...
```

`tickCrew`'s position update + orphan cleanup logic from Phase 1 is retained
verbatim; the new pose logic is added as a third pass within the same
function.

### Tool layer composition

Each role's kit adds one tool layer to the body / trousers / coat / shako
stack. Tool layer ids:

- `gun-crew-sponge-<dir>` (sponger)
- `gun-crew-rammer-<dir>` (rammer)
- `gun-crew-cartridge-<dir>` (loader)
- `gun-crew-linstock-<dir>` (gunner)

These are 32×36 PNGs (matching the kit canvas size, same as line-infantry
component sprites). Static — one PNG per tool per direction. Procedurally
generated by a new script `scripts/draw-gun-crew-tools.mjs`, parallel to the
existing `draw-cuirassier-components.mjs` / `build-cannon-12-components.mjs`
pattern.

The tool's pose-frame variation (held vertically vs. mid-action) is captured
in the **reload-pose body frames** below, NOT in the tool layer. The tool
layer is a single static PNG showing the tool in its action-rest position
(e.g. sponge held vertically). When a frame needs the tool moving, the
**body frame includes a baked tool**.

Why bake the tool into reload-pose body frames? Because the kit format doesn't
let us swap tool layers per-frame — only per-pose. A 4-frame reloading pose
needs 4 different tool positions, which are easiest to bake into the body
frames. The static tool layer is for the idle pose only.

Trade-off: more authoring (each role's reload pose has 32 frames with baked
tools instead of 4 base frames + 4 tool overlays). Acceptable because the
authoring is procedural.

### Reload-pose body frames

Per role: 4 frames × 8 directions = 32 PNGs.
Total for all 4 roles: 128 PNGs.

Drawn procedurally by extending the body authoring pattern. Each frame is a
32×36 RGBA composite of:
- Same body / trousers / coat / shako as line-infantry idle (regiment recolor
  markers preserved)
- Tool baked in at the correct mid-action position
- Per-frame body-position adjustments (lean, step) drawn as small offsets to
  the base body silhouette

Frame conventions per role (for east-facing; other facings rotated /
mirrored):

| Role     | Frame 0       | Frame 1            | Frame 2            | Frame 3        |
|----------|---------------|--------------------|--------------------|----------------|
| Sponger  | Standing      | Lean forward, sponge at muzzle | Lean further, sponge inserted | Step back, sponge raised |
| Loader   | At hip        | Step forward, cartridge presented | Hand-off (cartridge gone) | Step back |
| Rammer   | Standing, rammer vertical | Position rammer at muzzle | Full thrust (rammer mid-bore) | Withdrawn, rammer raised |
| Gunner   | Behind breech | Lean over breech, linstock at vent | Step clear | Linstock raised, ready |

Diagonal facings reuse the side-facing frame with appropriate offset; or are
authored if it reads wrong. Mirroring (W = mirrored E) is automatic via the
existing atlas convention.

### Authoring script

New `scripts/draw-gun-crew-poses.mjs` generates:

- 4 tools × 8 dirs = 32 static tool PNGs at
  `public/sprites/components/tools/gun-crew-<tool>-<dir>.png`.
- 4 roles × 4 frames × 8 dirs = 128 reload-pose body PNGs at
  `public/sprites/poses/gun-crew-<role>/reloading/<dir>/0/<frame>.png`.
- 4 roles × 8 dirs = 32 idle-pose body PNGs at
  `public/sprites/poses/gun-crew-<role>/idle/<dir>/0/0.png`.
  (These reuse line-infantry idle, but each role's idle has the static tool
  baked in — done in the same script for consistency.)

Total: 192 PNGs, scripted. Reuses the same palette / set / row helpers as the
existing `draw-cuirassier-poses.mjs`.

## Phasing

Phase 2 ships as a single slice — no internal phasing within Phase 2.

If the procedural authoring blows up beyond a reasonable time budget, the
fallback is to ship Phase 2 with **2 frames per role** instead of 4 (rest +
action). The architecture is identical; only the frame count differs. This is
a tweak of the authoring script, not a redesign.

## Code changes

| File | Change |
|------|--------|
| `src/sim/entities.ts` | Add `reloadInitialT: Float32Array`; init in `createEntities`, reset in `allocEntity` |
| `src/sim/systems/state-system.ts` | When transitioning to Reloading, set `reloadInitialT[i] = reloadT[i]` |
| `src/data/units/gun-crew.ts` | DELETE |
| `src/data/units/gun-crew-sponger.ts` | NEW |
| `src/data/units/gun-crew-rammer.ts` | NEW |
| `src/data/units/gun-crew-loader.ts` | NEW |
| `src/data/units/gun-crew-gunner.ts` | NEW |
| `src/data/units/index.ts` | Replace `gunCrew` export with the four role kinds |
| `src/data/units/index.test.ts` | Update expected kind list |
| `src/sim/crew.ts` | `spawnCrewForGun` chooses kindId per role; `tickCrew` adds pose-driving logic |
| `src/sim/crew.test.ts` | New tests for sequential pose driving |
| `public/components/kits/gun-crew.json` | DELETE |
| `public/components/kits/gun-crew-sponger.json` | NEW |
| `public/components/kits/gun-crew-rammer.json` | NEW |
| `public/components/kits/gun-crew-loader.json` | NEW |
| `public/components/kits/gun-crew-gunner.json` | NEW |
| `public/components/kits/index.json` | Replace `gun-crew` entry with the four role kits |
| `public/components/index.json` | Add 32 tool component entries |
| `public/sprites/components/tools/gun-crew-*-<dir>.png` | NEW (32 files) |
| `public/sprites/poses/gun-crew/` | DELETE the old single-kind folder |
| `public/sprites/poses/gun-crew-<role>/idle/<dir>/0/0.png` | NEW (32 files) |
| `public/sprites/poses/gun-crew-<role>/reloading/<dir>/0/<frame>.png` | NEW (128 files) |
| `public/sprites/poses/manifest.json` | Regenerated by build-pose-manifest pipeline |
| `scripts/draw-gun-crew-poses.mjs` | NEW authoring script |
| `package.json` | Wire `draw-gun-crew-poses` into the `build:poses` chain |

The `manifest.json` is regenerated automatically by
`scripts/build-pose-manifest.mjs` from the on-disk pose folder structure (this
was confirmed during Phase 1 — the build pipeline overwrote our hand-edited
manifest, and `gun-crew/idle/...` PNGs were correctly picked up).

## Testing

- **Unit tests for `tickCrew`** at minimum:
  - Outside reloading state, all four crew are in idle pose.
  - At reload start (`fullProgress = 0`), only sponger is in reloading pose.
  - At `fullProgress = 0.4`, only loader is in reloading pose; sponger is back
    to idle.
  - At `fullProgress = 0.95`, only gunner is in reloading pose; the previous
    three are idle.
  - `poseT` advances linearly within a role's window (frame 0 → frame 3).
  - When parent gun is freed mid-reload, all four crew are freed (regression
    test from Phase 1).

- **Visual smoke test in `cannon-test.html`**:
  - Each crewman holds the correct tool in idle.
  - During reload, the sponger acts first, then loader, then rammer, then
    gunner — visible by watching one cannon's crew through a full reload.
  - The four roles return to idle after the gun fires.

- **Console silence**: no `[pose-atlas]` warnings about missing
  `gun-crew-<role>` poses or directions.

## Risks

- **Procedural authoring quality.** A 4-frame ramming animation drawn in JS
  pixel grids may read poorly. Mitigation: keep frames close to the existing
  body silhouette with small offsets. If a frame reads badly, drop to a
  2-frame stub for that role and ship; iterate later.
- **Frame count vs reload duration mismatch.** A 16s reload divided by 4 roles
  × 4 frames = 1 frame per second per role — slow. Each frame visible for ~1s
  is on the edge of looking janky. Mitigation: this matches the slow,
  deliberate feel of artillery drill. If it looks too slow, reduce frames
  to 2 per role (2s per frame is fine for an artillery action).
- **Atlas size growth.** 192 new PNGs at 32×36 RGBA add ~700KB to the pose
  atlas. Should fit comfortably in WebGL2 texture limits, but watch for
  oversized atlas warnings in `pose-atlas.ts`.
- **`reloadInitialT` leak.** If a gun re-enters Reloading without
  `state-system.ts` being updated to set the initial value, `tickCrew` would
  divide by zero or stale data. Mitigation: set `reloadInitialT` in the
  exact same code path that sets `reloadT`, in one commit.

## Decisions taken without further consultation

- 4 frames per role for reload (with 2-frame stub as fallback if authoring is
  too costly).
- Equal-length 0.25 windows per role; no overlap; no anticipation/recovery
  beyond the 4 frames.
- Tools baked into reload-pose body frames (per-frame tool overlays would
  require atlas-loader changes).
- `reloadInitialT` stored as a new SoA field; not derived from `baseReload`.
- `tickCrew` runs after `state-system.ts` and overwrites crew pose; no
  kindId-based gating inside state-system.
- Deleted Phase 1 `gun-crew` kind / kit / pose folder; not retained as a
  fallback. Crew always render as one of the 4 role-specific kinds.
