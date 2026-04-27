# Combat Effects — FX Lab, Projectiles, Muzzle FX, Hit Reactions

**Date:** 2026-04-26
**Status:** Approved (pending spec review)

## Goal & scope

A self-contained "FX lab" page (`lab.html`) for iterating on the look and feel
of one soldier's combat moments in isolation. The lab is where we tune muzzle
flash, smoke, streaks, cannonball ballistics, hit reactions, and ragdolls
without battlefield AI, formations, or victory conditions interfering.

This slice introduces the reusable combat primitives the lab exercises:
projectile module, muzzle FX bundle, cannonball arc + ricochet + roll, musket
ball line tracer, lingering smoke, hit reactions (flinch / ragdoll / die),
explosion facade, and the projectile rendering pass. The same primitives feed
the future `combat-system` (auto-targeting), which is deliberately deferred.

### In scope

- Lab page with action buttons that trigger discrete behaviours on a chosen
  subject unit
- Reusable projectile module (sim-side SoA) for musket balls and cannonballs,
  with swept collision, ricochet, rolling, and impact resolution
- Reusable muzzle FX bundle (flash + smoke puff + barrel streak) parameterized
  per weapon
- Cannonball visuals: pixelated ball, motion streak, fake-Z arc with separated
  ground shadow
- Musket ball visuals: line/tracer rendered via the projectile pass
- Lingering smoke with mild drift, lift, and fade
- Hit reactions: musket-ball flinch, cannonball ragdoll-impulse, fall-and-die
- Particle pool sized for real Napoleonic smoke density (50 000)
- Projectile pass goes from "wired but empty" to actually drawing

### Out of scope

- Combat targeting / auto-fire AI (the harness fires manually via buttons)
- Real sprite atlas — placeholder coloured quads continue to stand in for the
  soldier's body, but a tiny **state machine** is introduced so the body
  responds to actions (recoil, slump, ragdoll)
- Pathfinding, formations, morale propagation
- Sound effects (significant gap — flagged for an immediate follow-up slice)
- Persistent decals (blood pools, scorch craters, furrows)
- Cuirassier sabre / pistol — only the firearm and the charge action are
  meaningful in this slice
- Networking determinism review of the new RNG draws (defer until lockstep
  multiplayer is on the table)

## §1 · The lab page

Vite multi-page: `lab.html` at repo root alongside `index.html`, with its own
bootstrap at `src/lab/main.ts`. Both entries import shared modules from
`src/sim`, `src/render`, `src/particles`, `src/fx` — same code paths as the
real game.

### Stage layout

A fixed camera angled on a small patch of field, ~40 m × 25 m. The **subject**
stands centre-left facing right. A row of 5 stationary **target dummies**
(placeholder line-infantry, neutral team) stand 30 m to the right of the
subject — close enough to see musket impacts, far enough that a cannonball's
arc is visible. A 1 m × 1 m grid overlay is toggleable for spatial calibration.

### Subject picker (top-left HUD)

Three radio buttons: `line-infantry`, `cuirassier`, `cannon-12`. Switching
despawns the current subject and spawns the new kind at the same anchor.

### Action panel (right-side overlay)

Buttons grouped into sections. Some are subject-kind-aware (greyed out when
irrelevant — e.g. "Charge" only for cuirassier).

| Group | Button | Effect |
|---|---|---|
| **Movement** | March | Subject walks forward at `moveSpeed` until "Halt" or off-screen |
| | Halt | Sets `velX = velY = 0` |
| | Face L / R | Sets `facing` and re-aims the barrel |
| **Fire** | Fire | Subject's weapon discharges once at the dummy row |
| | Auto-fire | Toggle: fires on the unit's `weaponReload` cadence |
| | Reload | Plays reload state for `weaponReload` seconds |
| **Cannon-only** | Solid shot | Cannon-12 fires roundshot (default ammo) |
| | Explosive shell | Cannon-12 fires a shell that explodes on impact |
| **Cavalry-only** | Charge | Cuirassier accelerates to gallop forward through the dummy row |
| **Reactions** | Take musket hit | Apply a musket-ball-equivalent impact to the subject |
| | Take cannon hit | Apply a cannonball-equivalent impulse → ragdoll |
| | Die | Drain HP, play death transition |
| **Stage** | Reset | Despawn subject + dummies, clear projectiles + particles, respawn |
| | Time scale | Slider 0.05× – 1× for slow-mo inspection |
| | Toggle grid | 1 m grid overlay |
| | Toggle wind | Light wind vector applied to smoke (off / left / right) |

### Lab HUD (top-right)

FPS, live entity count, live particle count (and pool capacity), live projectile
count (and pool capacity).

### Camera

Fixed centre on the stage, but the existing pan/zoom controls remain enabled
so a single shot can be inspected up close.

### Keyboard shortcuts

None in this slice — buttons only. Shortcuts get bound once the action set
stabilizes.

## §2 · Soldier state machine & animation hooks

The current `state` field is a `Uint8` with 6 values
(`idle, moving, firing, reloading, ragdoll, dead`). It's expanded slightly and
used as the single source of truth for both visuals and FX triggers.

### State enum

| Value | State | Notes |
|---|---|---|
| 0 | `idle` | Standing |
| 1 | `moving` | Walking/running, dust kicks up |
| 2 | `aiming` | Brief pre-fire windup (~0.15 s) — gives muzzle flash a "telegraph" |
| 3 | `firing` | The single tick the shot leaves the barrel — emits muzzle FX, spawns projectile, starts reload |
| 4 | `reloading` | Counts down `reloadT` |
| 5 | `flinch` | Short hit reaction (~0.3 s) when struck by a small projectile |
| 6 | `ragdoll` | After heavy impulse (cannonball / cavalry charge); integrates with friction |
| 7 | `dying` | Falling-over transition (~0.5 s) before becoming a corpse |
| 8 | `dead` | Static corpse; eligible for cleanup pass |

The split between `aiming` and `firing` lets us hold the unit still for one
beat before the shot, which is when "fire" reads as fire. The single `firing`
tick is when the projectile spawns and the muzzle FX fires; the unit
immediately transitions to `reloading`.

### Driving placeholder visuals from state

Until real sprites land, the placeholder coloured quad reacts to state:

- `idle / moving / aiming / reloading` — quad drawn upright at full size
- `firing` — for one tick, brief horizontal recoil offset (~0.15 m opposite the
  facing) and tiny vertical hop, applied via a transient `recoilT` field
- `flinch` — quad nudged backward 0.1 m for 0.3 s
- `ragdoll` — quad rotates 90° + drifts with the impulse; this rides the
  ragdoll system
- `dying / dead` — quad rendered horizontal, darker tint

The future sprite work replaces all this without changing the state machine.

### New transient fields on `Entities`

Added to the SoA:

- `recoilT: Float32Array` — countdown from a small max (e.g. 0.12 s); used by
  render to offset the placeholder quad
- `stateT: Float32Array` — generic "time remaining in current state" timer
- `impulseX, impulseY: Float32Array` — applied impulses, integrated by ragdoll
- `ragdollT: Float32Array` — countdown while in ragdoll state

### `state-system`

Runs early each tick. Counts down `stateT` and drives transitions:

- `aiming → firing` when `stateT ≤ 0`
- `firing → reloading` (always one tick; spawns projectile + muzzle FX before
  the transition)
- `reloading → idle` when `reloadT ≤ 0`
- `flinch → idle` when `stateT ≤ 0`
- `dying → dead` when `stateT ≤ 0`
- `ragdoll → dying` when speed has decayed below threshold and HP ≤ 0, else
  `ragdoll → idle` if HP > 0

### Trigger APIs

```ts
triggerFire(world, entityId, targetX, targetY): void
applyHit(world, entityId, dmg, impulseX, impulseY, kind): void
```

`triggerFire` sets `state = aiming`, `stateT = 0.15`, stores the aim vector in
a side-table; the projectile spawn happens one tick later when `state-system`
flips the unit to `firing`. The lab Fire button calls `triggerFire`. The
future `combat-system` will too.

`applyHit` is the single funnel for *all* incoming damage. Decides flinch,
ragdoll, or instant kill based on impulse magnitude and remaining HP. The
lab's Take-hit buttons call this directly.

## §3 · Projectile module (sim)

Projectiles live in their own SoA pool, *not* in `Entities` — they're
transient, lack HP / morale / formation, and benefit from a tighter hot loop.

### Pool fields

```
Projectiles (SoA, capacity 2048):
  alive: Uint8
  posX, posY, posZ: Float32      // posZ = height above ground (m)
  velX, velY, velZ: Float32
  prevX, prevY:    Float32       // last-tick xy, for swept collision + line render
  life: Float32                  // max-flight-time safety timer
  kind: Uint8                    // 0=musket, 1=solid-shot, 2=shell
  team: Uint8
  damage: Float32                // depletes on solid-shot hits
  mass: Float32                  // impulse = mass × velocity on hit
  ricochets: Uint8               // remaining bounces (solid shot only)
  fuseT: Float32                 // shell fuse countdown (else unused)
```

### Three projectile kinds

| Kind | posZ used? | Behaviour |
|---|---|---|
| `musket` | no (flat) | Single hit, dies on impact or end-of-life |
| `solid-shot` (roundshot) | yes (arcs) | Swept-collision plows through ranks, damage bleeds per hit; ricochets up to 3× off ground (the "skipping shot") and rolls to a stop |
| `shell` (explosive) | yes | First hit *or* fuse expiry triggers `spawnExplosion(pos, radius, force)` |

### `projectile-system` per tick

1. `prev ← pos`; integrate `pos += vel·dt`. If has Z, integrate
   `velZ -= g·dt; posZ += velZ·dt`. Game gravity `g ≈ 18 m/s²` (exaggerated for
   weight on a top-down view).
2. **Ground impact** when `posZ ≤ 0` and `velZ < 0`:
   - `solid-shot` with ricochets remaining: clamp `posZ = 0`,
     `velZ ← −0.5·velZ`, `vel.xy ← 0.7·vel.xy`, decrement ricochet, emit a
     ground-impact dust+dirt burst
   - `solid-shot` with no ricochets: stay at `posZ = 0`, `velZ = 0`, transition
     to **rolling** (handled in same loop on subsequent ticks)
   - `shell`: detonate at `prev.xy`, free
   - `musket` (rare; muskets don't arc in practice): emit dust, free
3. **Rolling** for grounded solid shots:
   `vel.xy *= (1 − GROUND_FRICTION · dt)` with `GROUND_FRICTION = 1.5 /s`. Free
   when `‖vel.xy‖ < ROLL_STOP_SPEED = 3 m/s`. Still does swept entity collision
   while rolling, with reduced damage at low speed.
4. **Entity collision** — swept segment from `prev` to `pos` against the
   spatial grid, excluding own team. On a candidate XY hit, the second-stage
   Z-range check (see §6) decides whether the projectile is at body height. On
   a confirmed hit:
   - `applyHit(world, id, damage, vel.x·mass, vel.y·mass, kind)`
   - `musket`: free
   - `solid-shot`: `damage *= 0.6`, `vel *= 0.85`, continue. Free when
     `damage < 5`
   - `shell`: detonate at hit position, free
5. `life -= dt`; free if `≤ 0`.
6. **Trail emission** for `solid-shot` / `shell`: emit one cannon-smoke
   particle from the current position each tick.

### Swept collision against the grid

Musket balls travel ~13 m per tick at 400 m/s — far longer than entity spacing
— so per-tick point queries miss soldiers. The grid gains a swept query that
walks the cells the segment crosses and tests entities in each, returning the
nearest hit:

```ts
gridSweptQuery(grid, ax, ay, bx, by, excludeTeam, candidateBuf): number
// returns count of candidates written into candidateBuf, sorted by t along segment
```

The caller does the per-candidate Z-range check (§6) and keeps the first that
passes. This deliberately separates "XY candidate" from "true hit" so the same
query can serve future ground-only logic too.

### Spawn API

```ts
spawnMusketBall(world, ox, oy, dirX, dirY, team, damage): void
spawnSolidShot(world, ox, oy, oz, vx, vy, vz, team, damage): void
spawnShell(world, ox, oy, oz, vx, vy, vz, team, damage, fuseT): void
```

### Barrel-tip helper

```ts
barrelTip(entity, weaponKind) → { x, y, z, dirX, dirY }
```

Returns the world-space launch point and direction from the entity's position,
facing, and a per-`UnitKind` `barrelOffset: { forward, side, height }`
constant. Muzzle FX and projectile spawn both use the same call so the streak,
flash, and ball originate from a single coherent point.

### Cannon launch math

`solveCannonLaunch(from, to, muzzleVel) → { vx, vy, vz }` — given a target
position and a fixed muzzle velocity (250 m/s), solve the ballistic angle for
the lower trajectory using a closed-form quadratic. Initial elevation produces
`velZ`; horizontal `velX, velY` is `muzzleVel · cos(θ) · dirToTarget`. ~15
lines.

### Pool sizes

- Projectiles: **2 048** (peak realistic load is ≪ 100; deterministic
  preallocation)
- Particles: **50 000** (Napoleonic smoke density; the foundation spec
  anticipated this number)

## §4 · Muzzle FX (the moment of firing)

The "fire moment" is composed of three synced effects emitted from the same
`barrelTip()` point in the same tick:

| Component | What it is | Lifetime |
|---|---|---|
| **Flash** | A single bright additive particle (large, hot colour) | ~60–150 ms |
| **Smoke puff** | A burst of 10–40 particles in a forward cone, with outward velocity and upward lift | 1–4 s |
| **Streak** | *Not a separate primitive.* For muskets, the projectile renders as a line `prev → cur` and the very first rendered frame is the streak from the barrel. For cannons, the streak is the cannonball's continuous **trail particles** (one per tick). |

### `MuzzleProfile`

```ts
type MuzzleProfile = {
  flash: { size: number; life: number; color: [r: number, g: number, b: number] };
  smoke: {
    count: number;          // particles emitted per shot
    coneAngle: number;      // radians of forward spread
    speed: { min: number; max: number };
    life:  { min: number; max: number };
    sizeStart: number;      // initial particle size (m)
    sizeGrowth: number;     // size multiplier per second (smoke billows)
    upwardDrift: number;    // m/s² upward bias
    drag: number;           // per-tick velocity multiplier (smoke <1 = lingers)
    color: [r: number, g: number, b: number];
  };
  recoilFirer: number;      // m/s impulse opposite to facing on the shooter
};
```

Initial values:

| Weapon | flash size | flash life | smoke count | cone | speed | life | sizeStart | drift | drag | colour | recoil |
|---|---|---|---|---|---|---|---|---|---|---|---|
| musket | 0.5 m | 0.06 s | 10 | 0.4 rad | 4–7 m/s | 1.0–1.8 s | 0.3 m | 0.4 | 0.97 | warm grey | 0.5 m/s |
| cannon-12 | 3.0 m | 0.15 s | 40 | 0.8 rad | 8–15 m/s | 2.5–4.0 s | 1.2 m | 0.6 | 0.985 | cool grey | 4 m/s |

Cannon recoil is large enough to visibly roll the carriage backward over
~0.4 s.

### New per-particle fields

```
drag:       Float32   // velocity multiplier per tick; 0.97-0.99 smoke, 0.98 dust, 0.6 flash
accelY:     Float32   // m/s² upward bias; positive for smoke
sizeGrowth: Float32   // size multiplier per second; positive for billowing smoke
class:      Uint8     // 0=dust 1=smoke 2=flash 3=blood 4=debris (wind affects only smoke)
```

`updateParticles` becomes:

```
vx *= drag
vy *= drag
vy += accelY · dt
size *= 1 + sizeGrowth · dt
posX += vx · dt
posY += vy · dt
```

### Emit function

```ts
emitMuzzleFx(particles, profile, ox, oy, dirX, dirY, rng): void
```

Called from `state-system` on the firing tick, immediately before (or after —
same tick) the projectile spawn.

### Wind

When toggled in the lab, adds a small constant horizontal acceleration
(0.5 m/s²) to all particles tagged `class = smoke`. Flash, dust, and blood are
unaffected.

### Tuning loop

Profiles live in `src/data/weapons/`, one file per profile (`musket.ts`,
`cannon-12-solid.ts`, `cannon-12-shell.ts`). Vite's HMR reflects edits in the
next shot.

## §5 · Hit detection, damage & reactions

End-to-end flow when a projectile is in flight:

```
projectile-system (per tick, per live projectile)
   ├── prev ← pos;  pos ← pos + vel·dt
   ├── gridSweptQuery(prev → pos, excludeTeam=p.team)  ──► candidates
   ├── for each candidate sorted by distance:
   │       if Z-range overlaps soldier body: hit ← candidate; break
   └── if hit:
         applyHit(world, hit, p.damage, p.vel.x · p.mass, p.vel.y · p.mass, p.kind)
         …continue or free per the kind's rules
```

### `applyHit`

Single funnel for *all* incoming damage — projectiles today, melee / charge /
explosion tomorrow.

```
function applyHit(world, id, dmg, impX, impY, kind):
  e ← world.entities
  if e.alive[id] === 0: return

  k ← getUnitKind(e.kindId[id])
  effDmg ← max(1, dmg − k.baseStats.armor)
  e.hp[id] -= effDmg

  impMag ← hypot(impX, impY)

  if e.hp[id] <= 0:
    if impMag > KILL_RAGDOLL_THRESHOLD:           # cannonball, charge
      enterRagdoll(e, id, impX, impY)
    else:                                          # musket kill
      enterDying(e, id)
    spawnBlood(e.posX[id], e.posY[id], impMag)
    return

  if impMag > KNOCKBACK_THRESHOLD:                 # cannonball graze, charge bump
    enterRagdoll(e, id, impX·0.5, impY·0.5)
  else:                                            # musket flinch
    enterFlinch(e, id)
  spawnBlood(e.posX[id], e.posY[id], impMag · 0.4)
```

### Thresholds (initial)

| Constant | Value | Meaning |
|---|---|---|
| `KILL_RAGDOLL_THRESHOLD` | 8 000 N·s | Below this on a kill → fall in place; above → fly back |
| `KNOCKBACK_THRESHOLD` | 4 000 N·s | Below this on a non-kill → flinch; above → ragdoll |

Sanity check:

- Musket ball: `mass 0.03 kg × vel 400 m/s = 12 N·s` → always flinch (or kill
  at low HP)
- 12-pdr roundshot: `mass 6 kg × vel 250 m/s = 1500 N·s` per hit, accumulating
  → always ragdoll

### `enterRagdoll(e, id, impX, impY)`

Sets `state = ragdoll`, `ragdollT = 2.0 s`, applies
`velX += impX / mass; velY += impY / mass`. The existing `movement-system`
integrates position; a new `ragdoll-system` adds friction (`vel *= 0.92` per
tick) and decrements `ragdollT`. When `ragdollT ≤ 0` and speed below
threshold, the soldier transitions to `dying` (HP ≤ 0) or back to `idle`.

### `spawnBlood(x, y, intensity)`

Emits 4–12 dark-red particles in a small radial burst with high drag (settles
fast). Quantity scales with intensity. Tagged `class = blood` so wind doesn't
move them.

## §6 · Z, height, and the 2D grid

Three layers, cleanly separated:

| Concern | Coordinates | Notes |
|---|---|---|
| Spatial grid (combat queries, hit-tests, area queries) | XY only | The grid indexes soldiers' ground footprints. No grid changes for Z. |
| Physics (projectile arc, ricochet, rolling) | XY + Z, but Z lives **only on the projectile** | Soldiers don't have a Z field. The cannonball's `posZ / velZ` live in the projectile SoA. |
| Rendering (the look of arc + shadow) | Screen position is `(posX, posY − posZ)`; shadow is `(posX, posY)` | The trick that makes height visible without a 3D camera. |

### Hit detection — two stages

Soldiers have an implicit body height range baked into their `UnitKind` —
e.g. `bodyZ: { low: 0, high: 1.8 }`. The swept collision is two stages:

1. **2D swept query** against the grid for entities whose XY footprint the
   projectile crossed.
2. **Z-range check** for each candidate: does the projectile's Z, interpolated
   along the segment, fall inside `[bodyZ.low, bodyZ.high]`?

This gives:

- A cannonball at `posZ = 5 m` mid-arc passes **over** a line of infantry —
  XY overlap, Z too high → no hit. (The pixelated ball visibly clears their
  heads on screen, because rendering offsets it upward.)
- A cannonball at `posZ ≈ 1.2 m` (ascending or descending) plows through the
  line — XY overlap, Z in body range → hit each soldier in turn.
- A musket ball has no Z (`posZ = 0` always) — Z range trivially passes.
- A rolling solid shot (post-ricochet, `posZ = 0`, low velocity) still
  collides at the soldier's feet — `Z = 0` falls inside `[0, 1.8]`.

### Why the grid stays 2D

Things that carry meaningful Z in the foreseeable game (cannonballs in flight,
shells, eventually ragdolled bodies launched by an explosion, eventually
trench / hill terrain) all carry their Z **on themselves**, and only the
relevant systems consult that Z. The grid keeps doing what it does well:
cheap XY neighbourhood lookups.

## §7 · Projectile rendering

The projectile pass currently has zero instances. We extend it to handle three
visual styles using one shader program and one VAO/VBO. Inside the pass, three
`drawArraysInstanced` calls (one per blend-mode bucket) flip blend mode between
draws. The shader branches on a per-instance `kind` attribute.

### Three styles

| Kind | Style | Render math |
|---|---|---|
| `musket-ball` | Bright oriented streak | Quad: centre = midpoint(`prev`, `cur`), length = `‖cur − prev‖`, width = 0.05 m, rotation = `atan2(dy, dx)`. FS gives a hot-white head fading to transparent along local x. |
| `cannonball` (airborne or rolling) | Pixelated dark ball | Quad: centre = `(posX, posY − posZ)`, size = 0.18 m. Solid dark sphere with a 1-pixel highlight rim. |
| `cannonball-shadow` | Soft ground ellipse | Centre = `(posX, posY)` (Z=0), size = 0.18 m × 0.10 m flattened. Multiplicative blend, dark grey. |

### Fake-Z

A cannonball's screen position is `(posX, posY − posZ)`. The shadow stays at
`(posX, posY)`. As the ball arcs up the visual ball separates upward from its
shadow; as it descends they meet again. This is the one rendering trick that
gives the top-down view a sense of weight and elevation without any actual 3D.

### Render order

```
… terrain, decals, map features, corpses
shadows (per-unit)                    ← existing
cannonball-shadows                    ← NEW
units (sprites)
projectiles (cannonballs + musket-balls)   ← NEW: above units, balls fly over heads
particles                              ← smoke / flash / blood / dust on top
selection FX
```

### Shader sketch

Per-instance attributes: `vec2 a_centerWorld`, `vec2 a_sizeOrLen`,
`float a_rotation`, `uint a_kind`, `vec4 a_color`.

```glsl
// VS
mat2 R = rotMat(a_rotation);
vec2 wp = a_centerWorld + R * (a_corner * a_sizeOrLen);
gl_Position = ...;
v_local = a_corner;
v_kind = a_kind;
v_color = a_color;
```

```glsl
// FS
if (v_kind == MUSKET) {
  float t = clamp(0.5 + v_local.x, 0.0, 1.0);   // 0=tail, 1=head
  float a = pow(t, 2.0) * smoothstep(1.0, 0.0, abs(v_local.y) * 2.0);
  outColor = vec4(v_color.rgb * a, a);
}
else if (v_kind == BALL) {
  float d = length(v_local);
  if (d > 0.5) discard;
  float rim = smoothstep(0.45, 0.5, d);
  outColor = vec4(v_color.rgb + rim * 0.5, 1.0);
}
else { // SHADOW
  vec2 e = v_local * vec2(1.0, 1.7);
  float d = length(e);
  if (d > 0.5) discard;
  outColor = vec4(0.0, 0.0, 0.0, 0.4 * smoothstep(0.5, 0.3, d));
}
```

### Per-tick CPU work

For all live projectiles, write into three scratch buffers (one per visual
kind), upload each via a single `bufferSubData`, and do three
`drawArraysInstanced` calls — same VBO, same VAO, blend mode flipped between.
Identical pattern to `particle-pass`.

## §8 · Impact effects

Each impact event spawns a tuned particle burst at the impact point. All
bursts go through the same particle pool with `class` tags so the wind toggle
behaves correctly.

| Event | Trigger | Visual burst |
|---|---|---|
| Musket-ball hits soldier | `applyHit` | 6–10 dark-red particles, small radial spread, high drag — fades in ~0.6 s |
| Musket-ball hits ground (end-of-life) | `projectile-system` | 4–6 small light-brown particles, brief upward kick — fades in ~0.8 s |
| Solid shot hits soldier | `applyHit` (ragdoll branch) | 8–14 dark-red particles, larger spread aligned with shot vector + 2–4 cloth-grey shred particles |
| Solid shot ricochets off ground | `projectile-system` | 12–18 dirt/dust particles in a forward fan aligned with horizontal velocity, brown-tinted; small flat dust puff parallel to ground |
| Shell detonates | `projectile-system` shell branch → `spawnExplosion` | See below |

### `spawnExplosion`

```ts
spawnExplosion(world, particles, x, y, profile: ExplosionProfile): void

type ExplosionProfile = {
  flash: { size: number; life: number; color: [r: number, g: number, b: number] };
  smokeBillow: {
    count: number; speedMin: number; speedMax: number;
    lifeMin: number; lifeMax: number;
    sizeStart: number; sizeGrowth: number;
    drag: number; upwardDrift: number;
  };
  debris: { count: number; speedMin: number; speedMax: number; life: number; size: number };
  damage: number;          // base, falls off with distance
  damageRadius: number;    // m
  impulse: number;         // base N·s on a target at impact centre
};
```

Steps:

1. **Flash** — one big bright particle (5 m, 0.18 s, hot orange-white) at the
   centre, additive, `accelY = 0`.
2. **Smoke billow** — 50 particles in a radial spray, mid-grey, large
   `sizeStart` with strong `sizeGrowth`, lifts upward (`accelY ≈ 1.5 m/s²`),
   drag 0.985 — these *linger*.
3. **Debris** — 20 small brown-grey particles in a radial fan with high
   outward speed, short life (0.6 s), high drag.
4. **Area damage + impulse** — `gridQueryRadius(x, y, damageRadius) → ids[]`.
   For each id (excluding firing team if friendly-fire is off):
   - distance `d`, falloff `f = 1 − d / damageRadius`
   - `applyHit(world, id, damage·f, dirX·impulse·f, dirY·impulse·f, 'explosion')`
     where `dir` is the unit vector from centre to entity.

### 12-pdr shell profile (initial)

| Field | Value |
|---|---|
| flash size / life / colour | 5 m, 0.18 s, `(255, 230, 160)` |
| smoke count / speed / life | 50, 6–14 m/s, 2.5–5.0 s |
| smoke sizeStart / growth | 1.4 m, 1.6 ×/s |
| smoke drag / upwardDrift | 0.985, 1.5 m/s² |
| debris count / speed / life / size | 20, 10–22 m/s, 0.6 s, 0.25 m |
| damage / radius / impulse | 60, 6 m, 6 000 N·s |

## §9 · File layout

### Files added

```
lab.html                                 NEW (Vite multi-page entry)
vite.config.ts                           UPDATED (rollupOptions.input adds 'lab')

src/lab/
  main.ts                                bootstrap for the lab page
  stage.ts                               spawn subject + 5-dummy row, reset
  actions.ts                             button handlers wiring into sim primitives
  lab-ui.ts                              right-side action panel, subject picker, time-scale slider, lab HUD

src/sim/
  projectiles.ts                         SoA pool: create / alloc / free
  systems/
    state-system.ts                      drives state transitions, recoil timer
    projectile-system.ts                 integrate, swept-collide, ricochet, roll, free
    ragdoll-system.ts                    friction + transitions out of ragdoll
    combat-events.ts                     applyHit / enterFlinch / enterRagdoll / enterDying
  spatial/
    grid.ts                              ADD: gridSweptQuery, gridQueryRadius

src/fx/
  barrel.ts                              barrelTip(entity, weaponKind) → world-space launch point
  ballistics.ts                          solveCannonLaunch(from, to, muzzleVel) → vx, vy, vz
  explosion.ts                           spawnExplosion(world, particles, x, y, profile)

src/data/weapons/
  musket.ts                              MuzzleProfile + projectile params
  cannon-12-solid.ts                     MuzzleProfile + ricochet/rolling params
  cannon-12-shell.ts                     ExplosionProfile + fuse

src/render/
  passes/projectile-pass.ts              EXTENDED (was zero-instance) — three sub-draws
  shaders/projectile.glsl.ts             NEW: instanced-quad with kind branch
```

### Files modified

- `src/data/types.ts` — `UnitKind` gains `bodyZ: { low, high }`,
  `barrelOffset: { forward, side, height }`, optional `weapon: WeaponRef`
- `src/data/units/*.ts` — fill those fields
- `src/sim/entities.ts` — add `recoilT`, `stateT`, `impulseX`, `impulseY`,
  `ragdollT` SoA arrays; expand state values to 0–8
- `src/sim/world.ts` — own a `Projectiles` pool; register new systems in
  order: `orders → state → movement → projectile → ragdoll`
- `src/particles/particles.ts` — add per-instance `drag`, `accelY`,
  `sizeGrowth`, `class: Uint8`
- `src/render/renderer.ts` — wire projectile pass instances; render order
  updated for cannonball shadows
- `src/main.ts` — unchanged for now (the lab is a separate page)

## §10 · Parameter tables (initial values)

| Group | Param | Value |
|---|---|---|
| **Musket projectile** | ball mass | 0.03 kg |
| | muzzle velocity | 400 m/s |
| | accuracy spread | 1.5° @ 80 m |
| | max-flight life | 0.4 s |
| **Cannon-12 solid shot** | ball mass | 6 kg |
| | muzzle velocity | 250 m/s |
| | launch height | 0.7 m |
| | game gravity | 18 m/s² |
| | ricochet count | 3 |
| | restitution (Z) | 0.5 |
| | horizontal damping per ricochet | 0.7 |
| | ground friction (rolling) | 1.5 /s |
| | roll-stop speed | 3 m/s |
| | per-hit damage falloff | × 0.6 |
| | per-hit velocity falloff | × 0.85 |
| | free below damage | 5 |
| **Cannon-12 shell** | fuse | 1.5 s (or first impact) |
| | explosion damage / radius / impulse | 60, 6 m, 6 000 N·s |
| **Hit reaction** | KILL_RAGDOLL_THRESHOLD | 8 000 N·s |
| | KNOCKBACK_THRESHOLD | 4 000 N·s |
| | armor reduction | `dmg − armor`, floor 1 |
| **Soldier body** | line-infantry bodyZ | 0 → 1.8 m |
| | line-infantry barrel | fwd 0.4 m, side 0, height 1.4 m |
| | cuirassier bodyZ | 0 → 2.2 m (mounted) |
| | cannon-12 bodyZ | 0 → 1.5 m |
| | cannon-12 barrel | fwd 1.6 m, side 0, height 0.7 m |
| **Pools** | entities | 4 096 (existing) |
| | projectiles | 2 048 |
| | particles | 50 000 |
| **Wind (lab toggle)** | acceleration | 0.5 m/s² horizontal |
| | applies to | particles with `class = smoke` only |

All numbers are first-pass values to seed the lab's tuning loop — they're
explicitly meant to be changed by saving a `.ts` file and watching HMR
reflect the next shot.

## Success criteria

- `lab.html` builds and serves under `vite dev`
- Subject picker swaps between line-infantry, cuirassier, cannon-12 cleanly
- Fire button on a line-infantry produces a visible muzzle flash, smoke puff,
  and musket-ball line that lands on a dummy and produces flinch + blood
- Solid-shot button on a cannon-12 produces an arcing ball (visibly separated
  from its shadow), plows through multiple dummies in the row, ricochets at
  least once, rolls to a stop
- Explosive-shell button produces a flash, billowing smoke, debris, and area
  damage to dummies inside the radius
- Take-musket-hit and take-cannon-hit buttons demonstrate flinch and ragdoll
  reactions on the subject without firing anything
- Particle counter does not exceed 50 000 in worst-case usage
- Time-scale slider down to 0.05× allows frame-by-frame inspection of a single
  shot
- Toggle wind drifts smoke clouds horizontally without affecting flash, blood,
  or dust
- Reset clears all projectiles and particles in one click
