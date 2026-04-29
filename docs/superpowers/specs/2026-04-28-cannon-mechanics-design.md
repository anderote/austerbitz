# Cannon Mechanics — Sandbox Page, Solid Shot, Shells, Canister

A focused pass on the artillery feel: a `cannon-test.html` sandbox that fires
three cannon-12 ammo types (solid, shell, canister) at a regiment, plus
mechanic upgrades — propagating shockwaves, ground-skip dirt puffs, ring/ember
flash, crater decals, camera shake, an audio hook, and outward-radial gib
scatter. Builds on the existing projectile, particle, puff, and gib systems
without inventing parallel paths.

## Why

The current explosion is a single-tick AOE: damage, impulse, gibs, and visuals
all resolve on the same frame. It works, but the moment lacks weight — there
is no expanding shockwave the player can read, no ground evidence after the
fact, no camera kick, no audio. Solid shot already ricochets through ranks and
bounces along the ground (the underlying physics is correct), but the visual
feedback on a ground skip is a sparks burst rather than a satisfying dirt
puff. Canister shot doesn't exist yet. There's no good way to compare the
three ammo types side-by-side, so tuning is guesswork.

A small sandbox page plus targeted mechanic polish addresses all of this in
one pass.

## What we're building

1. **`cannon-test.html`** — a new lab-style sandbox: 3 cannon-12s vs. a
   line-infantry regiment, hotkeys to fire each ammo type, slow-mo and
   step-frame controls, live counters.
2. **Solid shot polish** — replace the ricochet sparks burst with a dirt
   puff, add an in-flight cannonball trail puff, tune ricochet/roll for
   plausible deep-formation plowing.
3. **Shell shockwave system** — `spawnExplosion()` becomes "instant visuals
   + spawn shockwave record". A new per-tick system advances each
   shockwave's radius and delivers damage/impulse to entities the wavefront
   crosses, exactly once each. Linear-time in active shockwaves.
4. **Shell juice** — concentric ring flashes, lingering embers, charred
   ground crater decal, camera shake, audio hook (scaffold only).
5. **Explosion gib bias** — for `HitKind === 'explosion'` only, increase
   gib spawn count near center, add upward Z kick, bias heavier chunks
   outward at close range.
6. **Canister shot** — new ammo profile that batch-spawns 24 musket
   projectiles in an 18° Gaussian cone with high muzzle speed and short
   max-life.

## Architecture

### File layout

```
cannon-test.html                       # new entry
src/cannon-test/
  main.ts                              # bootstrap: world, render, input loop
  scene.ts                             # build cannons + regiment + camera
  hud.ts                               # legend, counters, side panel
src/fx/
  explosion.ts                         # MODIFIED: instant visuals + spawn record
  shockwaves.ts                        # NEW: pool + alloc/free for active waves
src/sim/systems/
  shockwave-system.ts                  # NEW: per-tick wave expansion + damage
  projectile-system.ts                 # MODIFIED: dirt puff on skip, canister hook
  debris-emit.ts                       # MODIFIED: explosion-bias for gibs
src/render/
  camera-shake.ts                      # NEW: time-decaying jitter on camera.center
src/audio/
  sfx.ts                               # NEW: lazy AudioContext, playSfx(name,x,y,cam)
  manifest.ts                          # NEW: name → URL, gain, falloff
src/data/weapons/
  cannon-12-canister.ts                # NEW: canister profile
  types.ts                             # MODIFIED: CanisterProfile, ParticleClass.Ring
src/puffs/profiles/
  dirt-skip.ts                         # NEW: short, low, brown puff for ground skips
scripts/
  draw-crater-stain.mjs                # NEW: bake charred-dirt decal
public/decals/
  crater-stain.png                     # NEW: output (procedural splotch)
vite.config.ts                         # MODIFIED: register cannon-test entry
```

### `cannon-test.html` sandbox

Mirrors `lab.html`: standalone HTML, single `<canvas id="game">`, `#ui-root`
overlay, entry script `src/cannon-test/main.ts`. Vite multi-page input
registered next to `lab` and `components`.

`scene.ts` builds:
- 3 cannon entities (cannon-12 kit) on the left at `x = -60`, spaced 4 m
  apart on Y, facing +X. Team = 1.
- A line-infantry regiment ~120 m to the right at `x = 60`: 3 ranks × 20 men,
  team = 0.
- Ground plane (already implicit at `posZ=0`).
- Camera centered between cannons and regiment, zoom-fit to show both.

`main.ts` runs the standard fixed-tick sim loop (matching `index.html`'s
loop), driving `world.step()` each tick and `render.draw()` each frame.

`hud.ts` controls:

| Key       | Action                                                      |
|-----------|-------------------------------------------------------------|
| `1`       | All cannons fire **solid shot**                             |
| `2`       | All cannons fire **shell** (current elevation)              |
| `3`       | All cannons fire **canister**                               |
| `[` / `]` | Decrease / increase shell elevation (5° steps, clamp 0–45°) |
| `R`       | Reset: respawn regiment, free all projectiles/particles     |
| `Space`   | Pause                                                       |
| `.`       | Step single frame (while paused)                            |
| Wheel     | Camera zoom                                                 |

Side panel (right side, lab-style buttons): slow-mo toggle (×0.25), grid
overlay toggle, camera-shake toggle, "fire all" group buttons, current
elevation readout.

Top-right counters: alive (regiment), live projectiles, live shockwaves, live
particles, live puffs, live debris.

### Solid shot polish

The system in `projectile-system.ts` already handles ground-bounce ricochet
+ horizontal damping + final ground-roll for `ProjectileKind.SolidShot`, and
already pierces entities with damage decay. Two tweaks:

1. **Replace `emitRicochetBurst` (sparks) on ground bounce with a dirt
   puff.** New profile `dirt-skip` in `src/puffs/profiles/dirt-skip.ts`:
   short life (~0.5 s), low to ground, brown-grey color, modest size,
   light buoyancy. On each ground ricochet, emit one puff with a small
   forward-cone particle burst for grit. Sparks profile retained for
   metal-on-metal entity hits if needed; leaving the entity-hit path
   untouched in this pass.
2. **In-flight trail puff** using the existing `cannonball-trail` profile
   already shipped in `src/puffs/profiles/`. Hook in `projectile-system.ts`:
   while a `SolidShot` is airborne, emit one trail puff every N ticks
   (rate-limited to keep counts sane).
3. **Tuning**: default `ricochets = 3`, `RICOCHET_HORIZONTAL_DAMPING ≈ 0.85`
   (current value preserved unless playtest shows shots dying too fast).
   These are reversible knobs in `projectile-system.ts` constants.

### Shockwave system

**Data model** (`src/fx/shockwaves.ts`):

```ts
export interface Shockwaves {
  capacity: number;
  count: number;
  alive: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  fullRadius: Float32Array;     // = profile.damageRadius
  age: Float32Array;            // seconds since spawn
  waveSpeed: Float32Array;      // m/s; default 120, profile-overridable
  damage: Float32Array;         // = profile.damage
  impulse: Float32Array;        // = profile.impulse
  excludeTeam: Int8Array;       // -1 = none
  attackerId: Int32Array;
  hitMask: Uint8Array;          // capacity * ceil(MAX_ENTITIES / 8) bytes, bit-packed per wave
  // free list...
}
```

`hitMask`: a per-shockwave bitset over entity IDs (one byte per 8 entities,
sized to entity capacity). Ensures each entity is hit at most once per wave.

**Spawn path** (`spawnExplosion`, refactored):

```
spawnExplosion(...):
  // Instant visuals (frame 0)
  spawn flash particle (existing)
  spawn 2 ring particles (NEW; staggered)
  emit smoke billow puff burst (existing)
  emit debris fan particles (existing)
  emit embers (NEW; ~20 small additive particles, slight upward drift)
  stamp crater decal at (x, y) (NEW)
  kickShake(camera, magnitude=f(damageRadius), duration=0.4s) (NEW)
  playSfx('shell-detonate', x, y, camera) (NEW)

  // Damage delivery now deferred to shockwave-system
  allocShockwave(...)
```

**Per-tick advance** (`shockwave-system.ts`):

```
for each alive shockwave:
  prevR = waveSpeed * age
  age += dt
  currR = waveSpeed * age
  if currR >= fullRadius: deactivate at end
  AABB-query grid at (x, y, currR) into scratch buf
  for each candidate id in buf:
    if hitMask bit set: skip
    if alive==0 or dead: skip
    if excludeTeam matches team: skip
    dx = entity.x - x; dy = entity.y - y
    dist = hypot(dx, dy)
    if dist < prevR or dist > currR: skip   # not in this ring slice
    set hitMask bit
    falloff = 1 - (dist / fullRadius) ** 1.5
    dirX = dx / max(dist, 1e-6); dirY = dy / max(dist, 1e-6)
    applyHit(entities, particles, rng, id,
             damage * falloff,
             dirX * impulse * falloff,
             dirY * impulse * falloff,
             'explosion', splats, debris, attackerId)
```

Notes:
- `waveSpeed = 120 m/s` matches "fast but visible" — a 6 m radius wave
  fully resolves in 50 ms (~3 ticks at 60 Hz), giving the player one or
  two readable frames of the wavefront before damage is fully applied.
- `hitMask` prevents fast entities from being clipped twice if they cross
  the ring within a single tick (e.g. dt spike).
- The `(r/fullRadius)^1.5` falloff is slightly concave: full damage near
  the center, holds up at mid-range, drops off sharply near the edge.

**Wiring**: `world.ts` adds the `Shockwaves` pool to its `World`, and
`world.step()` calls `updateShockwaves(...)` after `projectile-system` and
before `combat-events` post-pass (so impulses apply before transform
integration on the next tick).

### Ring flash, embers, crater decal

**Ring particle (`ParticleClass.Ring`)**: rendered in the existing particle
pass with a new branch that draws an additive annulus. Implementation:
adopt the existing additive-flash quad shader, modify fragment to compute
`a = step(inner, r) - step(outer, r)` from the quad UV. `inner` and
`outer` are derived from the particle's `size` and a per-class thickness
constant.

Two ring particles are spawned per explosion with staggered birth (offsets
0 ms and 80 ms), expanding `size` over their lifetime via existing
`sizeGrowth`. Color uses `profile.flash.color` darkened ~15% so they read
as the wave shell rather than the white-hot core.

**Embers**: ~20 tiny additive particles, color warm orange-yellow, life
random in `[0.6 s, 1.2 s]`, initial radial velocity `[2 m/s, 5 m/s]` plus
small upward bias, gravity `accelY = -2` (rises slowly), `sizeGrowth = -0.5`
(shrinks). Renders as `ParticleClass.Flash`-ish but uses
`ParticleClass.Ember` (new entry, additive blend, soft).

**Crater decal**: a new texture `public/decals/crater-stain.png` (256×256,
procedural — soft-falloff dark splotch with noise). Baked by
`scripts/draw-crater-stain.mjs` using the existing pngjs pipeline (pattern
matches `scripts/draw-blood-stain.mjs` if it exists, else mirrors the
gib-chunks bake script). Stamping uses the existing decal pipeline that
blood splats already use, parameterized to take a different texture +
size + tint. If the existing pipeline is hardcoded to blood, this design
adds a `decalKind` field to that path so the explosion stamps a
crater-stain instead.

### Camera shake

`src/render/camera-shake.ts`:

```ts
export interface CameraShake {
  magnitude: number;   // current peak amplitude in world units
  duration: number;    // seconds remaining
  total: number;       // original duration (for decay shape)
}

export function kickShake(s: CameraShake, magnitude: number, duration: number) {
  // Add to existing rather than overwrite, but clamp peak.
  s.magnitude = Math.min(MAX_SHAKE, s.magnitude + magnitude);
  s.duration = Math.max(s.duration, duration);
  s.total = Math.max(s.total, duration);
}

export function applyShake(camera: Camera, s: CameraShake, rng: Rng, dt: number) {
  if (s.duration <= 0) return;
  const t = s.duration / s.total;          // 1 → 0
  const amp = s.magnitude * t * t;         // quadratic decay
  camera.center.x += (rng.next() * 2 - 1) * amp;
  camera.center.y += (rng.next() * 2 - 1) * amp;
  s.duration -= dt;
  if (s.duration <= 0) { s.magnitude = 0; }
}
```

`MAX_SHAKE = 1.5 m`. Magnitude per explosion: `0.4 * profile.damageRadius`,
attenuated by `1 / max(1, dist/30)` where `dist` is camera-to-blast in
world units.

The shake is applied as a *transient offset to the camera each frame*, not
a persistent mutation — `applyShake` runs in the render path and the offset
is reverted before the next sim tick reads camera position. (Or store the
jitter as a separate `camera.shakeOffset` field consumed only by the
projection matrix; this avoids any sim/render interaction.)

### Audio hook (scaffold only)

`src/audio/sfx.ts`:

```ts
let ctx: AudioContext | null = null;

export interface SfxConfig { name: string; url: string; gain: number; falloffM: number; }

const buffers = new Map<string, AudioBuffer | null>();   // null = load failed

export function initSfx() { ctx ||= new AudioContext(); }

export async function loadSfx(cfg: SfxConfig) {
  if (!ctx) return;
  try {
    const r = await fetch(cfg.url);
    if (!r.ok) { buffers.set(cfg.name, null); return; }
    const buf = await ctx.decodeAudioData(await r.arrayBuffer());
    buffers.set(cfg.name, buf);
  } catch { buffers.set(cfg.name, null); }
}

export function playSfx(name: string, x: number, y: number, camera: Camera) {
  if (!ctx) return;
  const buf = buffers.get(name);
  if (!buf) return;                 // silent if missing
  const cfg = MANIFEST[name]!;
  const dx = x - camera.center.x, dy = y - camera.center.y;
  const dist = Math.hypot(dx, dy);
  const vol = cfg.gain * Math.max(0, 1 - dist / cfg.falloffM);
  if (vol <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(ctx.destination);
  src.start();
}
```

Manifest:

```ts
// src/audio/manifest.ts
export const MANIFEST = {
  'shell-detonate': { name: 'shell-detonate', url: '/audio/shell-detonate.wav', gain: 1.0, falloffM: 80 },
  'cannon-fire':    { name: 'cannon-fire',    url: '/audio/cannon-fire.wav',    gain: 1.0, falloffM: 100 },
  'canister-fire':  { name: 'canister-fire',  url: '/audio/canister-fire.wav',  gain: 1.0, falloffM: 80 },
  'solid-skip':     { name: 'solid-skip',     url: '/audio/solid-skip.wav',     gain: 0.7, falloffM: 50 },
};
```

`initSfx()` is called from `main.ts` on first user input gesture (browser
autoplay policy). `loadSfx` is called for each manifest entry — if files
are missing, `buffers.set(name, null)` and `playSfx` returns silently. No
console errors, no warnings beyond a single dev-mode log on first miss.

Call sites added:
- `spawnExplosion` → `playSfx('shell-detonate', x, y, camera)`
- Cannon fire (in `cannon-test.ts` scene controller) →
  `playSfx('cannon-fire' | 'canister-fire', x, y, camera)`
- `projectile-system.ts` ground-skip → `playSfx('solid-skip', x, y, camera)`

The cannon-test page wires `camera` through to these calls; the main game
`world.step()` paths get a `null`-tolerant overload (or the camera comes
from a render-side context, since SFX is presentation-layer).

### Explosion gib bias

In `debris-emit.ts`, `spawnGibs(... kind ...)` already branches on
`HitKind`. For `'explosion'` only:

- Increase chunk count: torsos 1, hats 1, arms 1–3, legs 1–2, meat blobs
  6–12 (current: 4–8).
- Add Z kick: each chunk's initial `velZ` set to a random value in
  `[5, 12]` m/s (current: 0). Existing `GIB_GRAVITY = 18` brings them
  back down naturally.
- Speed bias: heavier chunks (torso/leg) get +30% horizontal speed when
  the victim is within `0.5 * fullRadius` of center; meat blobs get +50%
  spread angle. Read center distance from `applyHit`'s impulse magnitude
  (already proportional to falloff, so this is zero-cost).

The radial direction is already correct because explosion impulse is
already radial — no change needed there.

### Canister shot

**Profile** (`src/data/weapons/cannon-12-canister.ts`):

```ts
export interface CanisterProfile {
  ballCount: number;
  coneDeg: number;          // total cone width
  spreadSigmaDeg: number;   // gaussian sigma for jitter
  muzzleSpeed: number;      // m/s
  speedJitter: number;      // ±fraction
  ballDamage: number;
  ballMass: number;
  ballMaxLife: number;      // seconds
  muzzleSmokeProfile: PuffProfile;
  muzzleSmokeCount: number;
}

export const cannon12Canister: CanisterProfile = {
  ballCount: 24,
  coneDeg: 18,
  spreadSigmaDeg: 6,
  muzzleSpeed: 280,
  speedJitter: 0.1,
  ballDamage: 9,            // tuned ~musket-equivalent
  ballMass: 0.05,           // a hair heavier than a musket ball
  ballMaxLife: 0.4,         // ~110 m at full speed
  muzzleSmokeProfile: cannonSmokeProfile,
  muzzleSmokeCount: 30,     // bigger billow than solid/shell
};
```

**Spawn helper** (`src/sim/projectiles.ts`):

```ts
export function spawnCanister(
  p: Projectiles,
  ox: number, oy: number,
  dirX: number, dirY: number,
  team: number,
  profile: CanisterProfile,
  ownerId: number,
  rng: Rng,
): void {
  const baseAngle = Math.atan2(dirY, dirX);
  for (let i = 0; i < profile.ballCount; i++) {
    const j = gaussian(rng) * (profile.spreadSigmaDeg * Math.PI / 180);
    const a = baseAngle + j;
    const sp = profile.muzzleSpeed * (1 + (rng.next() * 2 - 1) * profile.speedJitter);
    const dx = Math.cos(a), dy = Math.sin(a);
    spawnMusketBall(p, ox, oy, dx, dy, team,
                    profile.ballDamage,
                    sp,
                    profile.ballMass,
                    profile.ballMaxLife,
                    ownerId);
  }
}
```

`gaussian(rng)`: standard Box-Muller, clamped to ±2σ to keep all balls
inside the cone. Lives in `src/util/rng.ts` if not already present.

The cone orientation is derived from `(dirX, dirY)` so the cannon-test
scene controller passes the cannon's facing.

Canister hits use the existing musket-ball entity-hit path in
`projectile-system.ts` — no new branching.

## Out of scope

- **Chain reactions / powder kegs** — no in-world explosive cargo today.
- **Cover & line-of-sight occlusion** — terrain doesn't block shockwaves.
- **Audio assets / mixer / 3D positional** — only the hook; assets are a
  separate content drop.
- **Slope, water, or destructible terrain interactions.**
- **New gib chunk shapes for explosion** — uses existing chunk types with
  count/velocity bias only.

## Testing

Unit tests:
- `src/fx/shockwaves.test.ts`:
  - Wave expanding from 0 to fullRadius hits each entity in radius exactly
    once; entities outside `fullRadius` are never hit.
  - `excludeTeam` filter respected.
  - Two entities at increasing distances are hit in order across ticks.
  - Falloff: damage delivered to a center-adjacent entity > damage to an
    edge entity.
- `src/sim/canister.test.ts`:
  - `spawnCanister` produces `ballCount` projectiles.
  - All ball directions lie within `±coneDeg/2` of `(dirX, dirY)`.
  - Per-ball stats match profile fields.
- `src/render/camera-shake.test.ts`:
  - Magnitude decays to zero by `duration`.
  - Repeated `kickShake` clamps at `MAX_SHAKE`.
  - Duration extends but doesn't reset.
- `src/sim/systems/debris-emit.test.ts` (extend existing):
  - Explosion `HitKind` produces ≥6 chunks at center; all chunks have
    `velZ > 0`.

Existing tests to update:
- `src/fx/explosion.test.ts`:
  - Assert instant visuals fire (flash + 2 rings + smoke billow + embers +
    debris fan).
  - Assert one shockwave is allocated; damage arrives via shockwave-system,
    not inside `spawnExplosion` itself. New test step calls
    `updateShockwaves` to drive damage delivery.

Manual acceptance:
- `cannon-test.html` loads, camera frames cannons + regiment.
- `1` fires solid: cannonballs visibly skip on the ground (dirt puffs),
  plow through ranks.
- `2` fires shell: visible expanding ring, lingering embers, crater
  decal remains, screen shakes briefly. Damage delivered over a couple
  of frames as the ring crosses ranks.
- `3` fires canister: cone of musket-ball tracers, devastating at close
  range, mostly harmless past ~120 m.
- `R` resets cleanly; counters return to baseline.

## Risks & mitigations

- **Decal pipeline coupling**: blood splats may currently be hardcoded
  rather than parameterized. If so, the spec adds a `decalKind` field.
  Risk: implementation discovers the pipeline is harder to extend than
  expected. Mitigation: the design is robust to having explosion
  *not* leave a crater in v1 if that path proves expensive — strip and
  log a follow-up.
- **Audio autoplay policy**: browsers block `AudioContext` until first
  user gesture. `initSfx()` must be called from the first input event,
  not eagerly at module load. Already accounted for.
- **Shockwave bitset memory**: `capacity * MAX_ENTITIES / 8` bytes. For
  `capacity = 32` waves and `MAX_ENTITIES = 4096`, that's 16 KB total —
  fine. If entity capacity grows, revisit.
- **Two-phase explosion test compatibility**: existing tests assert
  damage on the same call as `spawnExplosion`. Updating these is part of
  the plan, not a separate fix.

## Acceptance criteria

1. `npm run dev` and navigating to `/cannon-test.html` shows the sandbox
   with cannons, regiment, and HUD.
2. Hotkeys `1`, `2`, `3`, `R`, `[`, `]`, Space, `.` all behave as
   specified.
3. Solid shot dirt puff appears on every ground skip; trail puffs visible
   in flight.
4. Shell explosion produces visible expanding ring, embers persist for
   ~1 s, crater decal persists, camera shakes briefly. Damage delivered
   over a couple of frames as the ring crosses entities.
5. Canister produces ~24 visible tracers in a cone; deadly at close
   range, harmless past `~muzzleSpeed * maxLife = ~110 m`.
6. All new and updated tests pass; existing test suite remains green
   (excluding the pre-existing `wind.test.ts` failure).
