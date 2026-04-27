# Volumetric Puff System

A unified, profile-driven system for soft volumetric effects — marching dust,
muzzle smoke, cannonball trails, explosion billows, and ambient sky clouds.
Replaces the per-effect smoke/dust spawn paths in `src/particles/emitters.ts`
and the smoke half of `src/fx/explosion.ts`. Sparks (flash, blood, debris,
ricochet, impact-dust) keep using the existing `Particles` pool.

## Why

The current particle pool draws every effect as a flat square with no
falloff. Combined with multiplicative size growth (`size *= 1 + rate*dt`
in `particles.ts:95`) and aggressive merge-driven life refresh in
`emitDust`, marching dust collapses into one mega-cloud whose edges
accelerate with size — visually wrong for a dust cloud, and sized at
~1.7m diameter when the user expects ~200–300 ft (60–90m) clusters.
Muzzle smoke, cannonball trails, and explosion smoke share the same
underlying primitive but are coded as separate emitters with duplicated
fields, making it hard to give each its own character (wispy musket smoke
vs. dense cannon smoke vs. slow ambient cloud).

## What we're building

One pool (`Puffs`), one renderer pass (`puff-pass`), one emit entry point
(`emitPuff` / `emitPuffBurst`), and one data type (`PuffProfile`). Each
visual variety lives as a profile under `src/puffs/profiles/`.

## Architecture

### File layout

```
src/puffs/
  puffs.ts              # SoA pool: alloc, free, update loop
  profile.ts            # PuffProfile type, profile registry
  emit.ts               # emitPuff, emitPuffBurst
  coalesce.ts           # one-shot per-frame spatial hash + merge
  ambient-clouds.ts     # ambient sky-cloud spawner
  profiles/
    dust.ts             # marching dust
    musket-smoke.ts     # wispy, fast-fading
    cannon-smoke.ts     # dense, billowing
    shell-billow.ts     # explosion smoke
    cannonball-trail.ts # thin contrail
    cloud.ts            # ambient sky cloud

src/render/passes/
  puff-pass.ts          # new pass with soft-falloff shader
src/render/shaders/
  puff.glsl.ts          # new shader strings
```

### Lifecycle

1. Sim/FX code calls `emitPuff(puffs, profile, x, y, vx, vy, rng)` or the
   burst variant.
2. Coalescence (same-profile, frame-scoped spatial hash) decides whether
   to merge into an existing puff or allocate a fresh slot.
3. `updatePuffs(puffs, dt)` integrates motion, decays life, and advances
   size at a constant edge velocity capped at `sizeMax`.
4. `puff-pass` draws every alive puff as an instanced quad with a soft
   radial falloff in the fragment shader.

### Data model

`PuffProfile` is a plain data record. Profiles are registered at module
import time so they have a small uint id usable in the SoA pool.

```ts
interface PuffProfile {
  id: string;                                  // unique key
  // Birth
  sizeStart:    { min: number; max: number };  // initial radius (m)
  life:         { min: number; max: number };  // seconds
  velScale:     number;                        // multiplier on emission velocity
  velJitter:    number;                        // ± per-axis, m/s
  // Growth
  edgeGrowth:   number;                        // m/s — additive, NOT multiplicative
  sizeMax:      number;                        // hard radius cap (m)
  // Motion
  drag:         number;                        // per-tick velocity multiplier
  buoyancy:     number;                        // m/s² (negative Y = upward in world space)
  inertiaExp:   number;                        // 1..3 typical
  inertiaWeight:number;                        // 0..1 — bigger puffs drift slower
  // Look
  color:        Color3;
  colorJitter:  number;                        // ± per channel, 0..1
  alpha:        number;                        // peak alpha (0..1)
  softness:     number;                        // 0=hard disc, 1=fully feathered
  // Coalescence
  coalesce: null | {
    radius:        number;
    sizePerMerge:  number;
    lifePerMerge:  number;
    posBlend:      number;                     // 0..1
    mergeChance:   number;                     // 0..1 — probabilistic to keep puffs distinct
  };
}
```

`Puffs` SoA columns (all `Float32Array` unless noted):

```
alive: Uint8Array
profileIdx: Uint16Array          // index into profile registry
posX, posY, velX, velY
life, lifeMax
size, sizeMax, edgeGrowth
drag, buoyancy
inertiaExp, inertiaWeight
r, g, b, alpha, softness
```

Per-particle storage of `sizeMax`/`edgeGrowth`/`drag`/`buoyancy`/`inertiaExp`/
`inertiaWeight`/`alpha`/`softness` keeps the update loop branch-free; the
profile registry is only consulted on emit (write) and coalescence (read
for merge radius and chance).

### Pool capacity

512 puffs initial budget. The current `PARTICLE_CAPACITY` is much higher,
but volumetric puffs are fewer and longer-lived than sparks; merging
keeps the count bounded. Revisit if puff allocation fails frequently.

## Update loop

```ts
function updatePuffs(p: Puffs, dt: number) {
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    p.life[i] -= dt;
    if (p.life[i] <= 0) { p.alive[i] = 0; p.count--; continue; }
    // Per-tick drag, scaled up for larger puffs (size-proportional inertia).
    const sizeFrac = p.size[i] / p.sizeMax[i];          // 0..1
    const sizeDamp = 1 - p.inertiaWeight[i]
                       * Math.pow(sizeFrac, p.inertiaExp[i]);
    p.velX[i] *= p.drag[i] * sizeDamp;
    p.velY[i] *= p.drag[i] * sizeDamp;
    p.velY[i] += p.buoyancy[i] * dt;
    // Constant-velocity edge growth, capped.
    const grown = p.size[i] + p.edgeGrowth[i] * dt;
    p.size[i] = grown > p.sizeMax[i] ? p.sizeMax[i] : grown;
    p.posX[i] += p.velX[i] * dt;
    p.posY[i] += p.velY[i] * dt;
  }
}
```

The size-damped drag is what produces the "larger clouds drift slower"
effect: a puff at full radius experiences `drag * (1 - inertiaWeight)`
per tick (e.g., 0.99 * 0.7 = 0.693), while a small puff drifts at full
`drag`. `inertiaExp > 1` makes the slowdown kick in only as the puff
approaches `sizeMax`.

## Emission

### Single puff

```ts
emitPuff(puffs: Puffs, profile: PuffProfile,
         x: number, y: number, vx: number, vy: number,
         rng: Rng): number   // returns slot index or -1
```

Writes profile values into the chosen slot (or merges into a neighbor —
see Coalescence). Color is jittered ±`colorJitter` per channel, size
sampled in `sizeStart`, life sampled in `life`, velocity scaled by
`velScale` plus per-axis `±velJitter`.

### Burst (replaces muzzle/explosion smoke loops)

```ts
emitPuffBurst(puffs: Puffs, profile: PuffProfile,
              x: number, y: number,
              dirX: number, dirY: number,
              count: number, coneAngle: number,
              speed: { min: number; max: number },
              rng: Rng): void
```

Spawns `count` puffs in a forward cone aligned with `(dirX, dirY)`. This
is the single API used by every multi-puff effect (musket muzzle,
cannon muzzle, shell billow). The `count`, `coneAngle`, and `speed`
parameters live on the calling profile (`MuzzleProfile`,
`ExplosionProfile`) — see Migration.

## Coalescence

Built per frame as a one-shot spatial hash keyed by **(profileIdx, cellX,
cellY)** so puffs of different kinds never merge with each other.

For a candidate emission at `(x, y)` with profile `P`:

1. If `P.coalesce` is null → spawn fresh, add to hash. Done.
2. Hash lookup in 3×3 cell neighborhood (cell size = `P.coalesce.radius`).
3. Find the nearest live puff of the same profile within `radius`. Skip
   any puff whose `size` is already at `sizeMax` AND `life` at `lifeMax`
   (treat as full).
4. If a candidate is found AND `rng.next() < P.coalesce.mergeChance` →
   merge:
   - `size += sizePerMerge` clamped at `sizeMax`
   - `life += lifePerMerge` clamped at `lifeMax`
   - `pos = pos * (1 - posBlend) + emit * posBlend`
5. Otherwise spawn fresh, add new puff to the hash so later emissions in
   the same frame can coalesce with it.

`mergeChance` is the new lever for "nucleate, don't always merge": at 0.7,
30% of emissions skip the merge and seed new puffs nearby, producing the
distribution of cloud sizes the user wants. Combined with a smaller
`coalesce.radius` than the current dust system uses, columns produce
clusters of distinct overlapping puffs rather than one mega-blob.

## Rendering

### Pass

`createPuffPass(gl, capacity)` mirrors `particle-pass.ts`: instanced
quads with per-instance position, size, color, life-ratio alpha, and
softness. Premultiplied-alpha blending (`gl.ONE, gl.ONE_MINUS_SRC_ALPHA`,
matching the existing particle pass).

### Shader

VS is identical in structure to `particle.glsl.ts`'s VS — corner * size
+ position. FS adds soft falloff:

```glsl
void main() {
  float r = length(v_local);                  // 0..1 (corner = ±1)
  if (r > 1.0) discard;
  float feather = max(1e-3, v_softness);
  float a = 1.0 - smoothstep(1.0 - feather, 1.0, r);
  a *= v_color.a;                              // life ratio
  a *= v_peakAlpha;                            // profile peak alpha
  if (a <= 0.0) discard;
  outColor = vec4(v_color.rgb * a, a);
}
```

`softness=0` gives a crisp disc; `softness=1` is a fully feathered puff.
Profiles pick per-effect: dust ≈ 0.6, smoke ≈ 0.85, cloud ≈ 0.95.

### Draw order

Same slot the current `particlesPass.draw` occupies in `renderer.ts:77`
— above sprites (so volumetric FX read as "in the air" over soldiers).
The renderer calls `puffPass.draw(...)` first, then `particlesPass.draw(...)`,
so sparks read on top of clouds.

## Profiles

Initial profile values (radii in meters, lives in seconds):

| profile | sizeStart | sizeMax | edgeGrowth | life | softness | coalesce | notes |
|---|---|---|---|---|---|---|---|
| dust | 0.6–1.0 | 4.0 | 0.6 | 3.5–6.0 | 0.6 | r=0.9, sizePer=0.05, lifePer=0.3, posBlend=0.3, chance=0.7 | many puffs per column → cluster up to ~60–90m |
| musket-smoke | 0.25–0.4 | 1.6 | 0.7 | 0.9–1.6 | 0.9 | null | wispy, count=10 in MuzzleProfile |
| cannon-smoke | 1.0–1.5 | 4.5 | 1.2 | 2.5–4.0 | 0.85 | r=1.2, sizePer=0.15, lifePer=0.5, posBlend=0.2, chance=0.6 | dense billow, count=40 |
| shell-billow | 1.2–1.8 | 6.0 | 1.6 | 2.5–5.0 | 0.85 | r=1.5, sizePer=0.2, lifePer=0.6, posBlend=0.2, chance=0.5 | explosion smoke, count=50 |
| cannonball-trail | 0.3–0.5 | 1.0 | 0.4 | 0.5–1.0 | 0.85 | null | one per tick along the ball |
| cloud | 12–25 | 45 | 0.0 | 60–180 | 0.95 | null | ambient sky cloud, no growth |

Tuning goals encoded above:

- Dust: max cluster diameter ≈ 60–90m (sizeMax 4m × tens of overlapping
  puffs produces a wide haze without any single puff being giant).
- "Edges move at constant speed": `edgeGrowth` is m/s, applied
  additively, capped at `sizeMax`. No multiplicative blow-up.
- "Larger ones drift slower": handled in update loop via `inertiaWeight`
  and `inertiaExp`. Cloud has highest weight; dust has small but nonzero.
- "Distribution of clouds": coalescence has `mergeChance < 1`, so some
  emissions seed new puffs.

## Ambient clouds

`ambient-clouds.ts` keeps roughly N cloud puffs alive at any time within
or near the camera viewport. Each tick:

- Count alive cloud-profile puffs.
- If below target (e.g., 12), spawn one along the upwind viewport edge
  with cloud profile and a slow drift (`vx`, `vy`) sampled from the
  current wind state if available (`lab/wind.ts`), else a constant
  vector.
- Old clouds expire naturally via `life`.

This is FX-only; no sim coupling. Wind hookup is a soft dependency — if
the lab harness is the only place wind exists today, the ambient cloud
spawner reads from a small adapter that returns a default vector when
wind isn't wired up in the main game.

## Migration

Removed:

- `emitDust` and the dust constants in `src/particles/emitters.ts`.
- The smoke spawn loop inside `emitMuzzleFx` (the flash spawn stays).
- The smoke billow spawn loop inside `src/fx/explosion.ts` (the debris
  + flash spawns stay).
- `emitCannonballTrail` in `src/particles/emitters.ts`.
- `sizeGrowth` field becomes vestigial for the remaining particle pool
  (still used by no remaining particle, but the column stays to avoid a
  ripple in `Particles` and its tests). Default value 0; the
  multiplicative path in `updateParticles` is left as-is.

Type changes:

- `MuzzleProfile.smoke`: replace inline fields with a tuple
  `{ profile: PuffProfile; count: number; coneAngle: number; speed: {min;max} }`.
- `ExplosionProfile.smokeBillow`: same shape replacement.

Call-site changes:

- `emitMuzzleFx` becomes flash-only; callers also call
  `emitPuffBurst(puffs, muzzle.smoke.profile, x, y, dx, dy, ...)`.
- `fx/explosion.ts` swaps its smoke loop for `emitPuffBurst`.
- Per-soldier dust emission (the hot loop in `emitDust`) moves to
  `src/puffs/emit-dust.ts` calling `emitPuff(puffs, dustProfile, ...)`.
  The world-walks-the-entities iteration stays identical; only the
  spawn call changes.
- Cannonball trail in `src/sim/systems/projectile-system.ts` calls
  `emitPuff(puffs, cannonballTrailProfile, ...)` once per tick per
  in-flight cannonball.

Wiring:

- `main.ts` and `lab/main.ts` create a `Puffs` pool alongside
  `Particles`, register profiles, tick `updatePuffs(puffs, dt)` after
  `updateParticles`, and pass `puffs` to the renderer.
- `Renderer.render` receives `puffs` and draws via `puffPass.draw(puffs, cam)`
  before `particlesPass.draw(particles, cam, ABOVE_SOLDIER_MASK)`.

## Testing

New:

- `puffs.test.ts`: pool alloc/free; life decay; additive edge growth
  capped at `sizeMax`; size-damped drag (large puff drifts less than
  small puff over the same dt with same input velocity).
- `coalesce.test.ts`: same-profile merging accretes size/life and blends
  position; different-profile puffs never merge; `mergeChance` controls
  the spawn-vs-merge ratio (deterministic via seeded RNG); puffs at
  saturation are not selected for merge; far-apart emissions spawn
  distinct puffs.
- `emit.test.ts`: `emitPuff` writes profile values correctly; profile
  jitter stays within bounds; `emitPuffBurst` count and cone bounds.
- `ambient-clouds.test.ts`: count converges to target; spawns on the
  upwind edge; respects wind direction.

Updated:

- `particles/emitters.test.ts`: drop the `emitDust merging` block and
  the `emitCannonballTrail` test (those move to puff tests). Keep
  `emitMuzzleFx` (now asserts only the flash; smoke is in the puff
  pool, asserted in puff tests).
- `particles/particles.test.ts`: `sizeGrowth scales size per second` —
  switch the test to use a non-Dust klass to be explicit, but otherwise
  unchanged. (Multiplicative path is kept for any future use.)

Lab integration:

- `lab/main.ts` exercises the puff system the same way it exercises
  particles today; visual smoke tests of the `solidShot` and
  `explosiveShell` actions confirm the new smoke renders.

## Out of scope

- Per-puff noise/turbulence in the FS beyond a radial falloff.
- 3D height / Z handling for clouds.
- Wind affecting puffs other than ambient clouds.
- Color gradient over life (single-color profiles only for v1).

## Risks

- Coalescence cost: hash rebuild per frame is O(alive puffs); at 512
  capacity this is negligible. If pool grows, switch to a persistent
  hash.
- Pass-order regressions: smoke now overlapping flash particles changes
  visual stacking. Acceptable: flash is short-lived and bright; reads
  fine over smoke.
- Migration footprint: ~6 call sites, ~3 test files. Tractable.
