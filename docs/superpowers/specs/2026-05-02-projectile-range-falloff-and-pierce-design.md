# Projectile Range Falloff & Pierce — Design

## Motivation

Muskets currently deal a fixed (rolled-once) damage that ignores how far the
ball has flown, and free on the first hit. The result: a max-range pot-shot is
mechanically identical to a 5 m point-blank volley — neither stack depth nor
range discipline matter. We want:

- **Steep damage falloff with range.** At 5–10 m a musket should be brutal; at
  max range it should hardly do meaningful damage.
- **Close-range pierce.** A ball fired at point-blank should be able to plow
  through one or two ranks before being spent.

The existing angular spread (4°) already widens the miss circle naturally with
distance, so misses scale automatically — the new mechanic targets **damage**,
not aim accuracy.

The same mechanic generalizes cleanly to cannon solid-shot (which already has
unused `perHitDamageFalloff`/`perHitVelocityFalloff`/`freeBelowDamage` fields
on its weapon profile, currently ignored in favor of hardcoded module
constants). Shells don't need it (explosions resolve damage at the impact
point, not by ball travel).

## Mechanic

### Range falloff (per hit)

At hit time, compute the XY distance from the projectile's spawn position to
the hit position. Apply an exponential decay multiplier:

```
mul = clamp(minMul, 1.0, exp(-decayK * max(0, dist - nearM)))
```

- `nearM`: distance under which the projectile deals full damage.
- `decayK`: 1/m exponent; higher = steeper falloff.
- `minMul`: floor multiplier at long range.

Three closed-form parameters give us a smooth, monotonic curve that's flat
near the muzzle, drops fast in the mid range, and floors at long range —
matching the desired feel without storing a points array.

For musket the target shape is roughly:
- ≤8 m → 100%
- ~25 m → ~55%
- ~60 m → ~16%
- ~100 m → floor (5%)

Fit by `nearM=8, decayK=0.035, minMul=0.05`.

For solid shot the falloff is much gentler (cannonballs retain energy over
longer distances): something like `nearM=40, decayK=0.005, minMul=0.5` —
tunable, but explicitly milder than musket.

Falloff is applied **at each hit**, not stored on the projectile. A pierce
shot's second target gets re-evaluated against current range from spawn.

### Pierce

Each weapon optionally declares pierce parameters:

- `minDamageFrac`: free the projectile once its carried damage drops below
  `baseRolledDamage * minDamageFrac`.
- `perTargetMul`: multiplier applied to the projectile's carried damage after
  each hit.
- `velocityMul` (optional, default 1.0): per-pierce velocity multiplier.

The carried damage decays independently of range falloff (decay is
"penetration energy lost," falloff is "ball energy lost in flight"). Both
multiply together at hit time:

```
appliedDamage = p.damage * falloffMul(distance)
applyHit(target, appliedDamage)
p.damage *= perTargetMul
p.velX *= velocityMul; p.velY *= velocityMul
if (p.damage < pierceMinDamage) free()
```

For musket `perTargetMul=0.55, minDamageFrac=0.35` naturally caps at ~2 hits
(0.55 → 0.30 < 0.35). No explicit max-pierce-count is needed.

For solid shot the existing module constants (0.6 / 0.85 / 5 absolute) become
weapon-profile values: `perTargetMul=0.6, velocityMul=0.85, minDamageFrac=5/baseDamage`.

A weapon with no `pierce` block free-on-first-hit (current behavior).

## Data model

Six new fields on the `Projectiles` SoA, all `Float32Array`:

| Field | Purpose |
|---|---|
| `spawnX, spawnY` | Original spawn position; falloff distance is `hypot(hitX - spawnX, hitY - spawnY)`. |
| `falloffNearM, falloffDecayK, falloffMinMul` | Falloff curve params. `falloffDecayK == 0` ⇒ no falloff (mul = 1). |
| `pierceMinDamage, piercePerTargetMul, pierceVelMul` | Pierce config. `piercePerTargetMul == 0` ⇒ free-on-first-hit (current behavior). `pierceVelMul` defaults 1.0. |

That's 8 new floats per projectile. At current ~1024-projectile capacity that
is 32 KB — negligible.

### Weapon profile additions (`WeaponProfile.projectile`)

```ts
rangeFalloff?: { nearM: number; decayK: number; minMul: number };
pierce?: { minDamageFrac: number; perTargetMul: number; velocityMul?: number };
```

The existing `perHitDamageFalloff`, `perHitVelocityFalloff`, `freeBelowDamage`
fields are **deprecated and removed**: solid-shot uses the new `pierce` block
instead. The hardcoded `SOLID_SHOT_*` module constants in
`projectile-system.ts` are removed.

### Spawn signature

`spawnMusketBall` / `spawnSolidShot` / `spawnShell` gain a single optional
trailing `BallisticsParams` argument, an interface holding the six numbers.
Callers in `fire-resolver.ts` and `spawnCanister` build it from the weapon
profile.

## Hit-time logic (projectile-system.ts)

For Musket and SolidShot kinds (Shell handled separately by explosion):

```
const dist = hypot(p.posX - p.spawnX, p.posY - p.spawnY);
const fmul = falloff(dist, p.falloffNearM, p.falloffDecayK, p.falloffMinMul);
const dmg = p.damage * fmul;
applyHit(target, dmg, ...);

if (p.piercePerTargetMul > 0) {
  p.damage *= p.piercePerTargetMul;
  p.velX *= p.pierceVelMul;
  p.velY *= p.pierceVelMul;
  if (p.damage < p.pierceMinDamage) freeProjectile();
  // else continue inspecting next candidate (same loop as solid-shot today)
} else {
  freeProjectile();
}
```

The Musket / SolidShot branches converge on this single path. The current
free-on-musket-hit and the current solid-shot bleed loop both become the same
code, parameterized by the projectile's pierce config.

## Tuning targets

| Weapon | `rangeFalloff` (near, k, min) | `pierce` (minFrac, perMul, velMul) |
|---|---|---|
| musket | `8, 0.035, 0.05` | `0.35, 0.55, 1.0` |
| canister ball | `5, 0.06, 0.05` (steeper, shorter) | none |
| cannon-12-solid | `40, 0.005, 0.5` | `5/80, 0.6, 0.85` |
| cannon-12-shell | none | none |

Tuning numbers are starting points; the parametric curve makes them easy to
adjust.

## Tradeoffs / risks

- **Stack depth becomes meaningful.** Two-rank musket pierce makes deep
  formations more vulnerable head-on; this is the desired effect but may
  require a balance pass on AI spacing or formation defaults.
- **Long-range volleys feel weaker.** Players used to muskets working at any
  range may need a UI hint (range ring? color cue?) — out of scope here, but
  worth flagging.
- **Per-hit branch adds a `hypot` and an `exp`.** Negligible against the
  existing per-tick swept-grid query cost.
- **`spawnX/spawnY` are stored even for shells** (which never use them).
  Cheaper than branching the SoA layout by kind.

## Out of scope

- Distance-based **accuracy** scaling (extra spread at long range). The
  existing 4° angular cone naturally widens with distance; if we still want
  more long-range whiff, that is a follow-up.
- UI affordances showing falloff zones to the player.
- Per-target armor / cover modifiers.
