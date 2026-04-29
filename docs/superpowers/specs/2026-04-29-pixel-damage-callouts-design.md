# Pixel Damage Callouts

Tiny floating numbers that pop up over a unit when it takes damage, then drift
upward and fade. Pure visual feedback — no gameplay effect. Pixel-art style
to match the rest of the in-world rendering.

## Why

Right now hits register only via blood spray, gibs, and shrinking health bars.
Players can't tell whether a volley dealt 3 damage or 30 — feedback is binary
("did I hit?") rather than quantitative ("how much did that hurt?"). Floating
damage numbers are a cheap, well-understood pattern that reads at a glance and
makes weapon-tuning decisions visible to the player without requiring them to
hold Alt for health bars.

## What we're building

A new SoA pool `DamageTexts` (parallel to `Puffs` / `Particles`), a single
spawn hook in `applyHit`, a per-frame update tick, and a new render pass that
draws each digit as an instanced quad sampling a tiny code-baked pixel-font
atlas. Out of scope: heal greens, crit/headshot variants, color-by-damage-tier.

## Architecture

### File layout

```
src/fx/damage-texts/
  damage-texts.ts        # SoA pool: alloc, free, update loop
  glyph-atlas.ts         # 5×7 pixel digits 0–9, baked once into an R8 texture
  index.ts               # re-exports

src/render/passes/
  damage-text-pass.ts    # new instanced pass

src/render/shaders/
  damage-text.glsl.ts    # VS + FS strings
```

### Data shape

```ts
interface DamageTexts {
  capacity: number;
  count: number;
  alive: Uint8Array;
  aliveIds: Int32Array;
  aliveIdx: Int32Array;
  cursor: number;
  posX: Float32Array;       // world-space center of the (whole-number) text
  posY: Float32Array;
  velY: Float32Array;       // upward drift; per-frame integrated
  life: Float32Array;       // seconds remaining
  lifeMax: Float32Array;
  value: Uint16Array;       // damage amount, clamped to 0..999 (3 digits max)
}
```

A capacity of 256 is plenty — texts live ~0.7 s, so even at 100 hits/s we
peak at ~70 live entries.

### Lifecycle

1. `applyHit` (`src/sim/systems/combat-events.ts:108`) computes `effDmg`. Right
   after that, it calls `spawnDamageText(damageTexts, px, py + h, effDmg)`
   where `h` comes from the unit kind's `placeholderSize.h`.
2. Each frame, `updateDamageTexts(damageTexts, dt)` decrements `life`,
   integrates `posY += velY * dt`, applies a small linear deceleration on
   `velY`, and frees expired slots.
3. Each frame, `damageTextPass.draw(damageTexts, cam)` flattens the live pool
   into per-digit instances (1–3 instances per text), uploads them, and draws.
4. Insertion order in `renderer.ts`: after particles (line 228), before
   trajectory preview — sits above all in-world FX.

### Glyph atlas

A single 50×7 R8 texture, generated at startup from a hardcoded
`Uint8Array[10]` table of 5×7 bitmaps. One row of 10 glyphs, packed
horizontally; each digit's UV is `[i/10 .. (i+1)/10]` in U, full V.

Bitmap shapes (each row is one digit, 1 = pixel on, in a 5-wide × 7-tall grid)
are hand-defined in TS. The atlas is uploaded once with `gl.NEAREST` filtering;
no resizing or mipmaps. This keeps glyphs crisp at any zoom.

### Render pass

Per-instance attributes:
- `pos: vec2` — world-space center of the digit (caller computes per-digit X
  offsets from the text's center using digit count and a fixed glyph spacing)
- `digit: float` — 0..9, used to index into the atlas U-range
- `alpha: float` — for fade-out (computed from `life/lifeMax`)

Vertex shader: standard quad expansion, `world = pos + corner * glyphSize`.

Fragment shader: sample the atlas at the digit's U-range; emit
`vec4(1.0, 0.95, 0.85, sample.r * alpha)` (warm-white). Hard-cutoff alpha at
`< 0.5` discarded to keep edges crisp (per pixel-art constraint).

Glyph world-size: ~0.4 m tall, ~0.3 m wide (knee-high to a soldier). Inter-digit
spacing equals glyph width (no kerning).

### Per-digit instance flattening

The pass iterates the pool's alive list and, for each text, computes:
- digit count `n` from `value` (1, 2, or 3)
- per-digit X offset: `(d - (n-1)/2) * glyphWidth` for digit index `d ∈ [0, n)`
- per-digit world position: `(text.posX + xOffset, text.posY)`
- per-digit value: `Math.floor(value / 10^(n-1-d)) % 10`

Total instances = `sum over alive texts of digitCount(value)`. Capacity for
the instance buffer = `pool.capacity * 3`.

### Spawn behavior

- `velY = 1.5 m/s` (upward).
- `life = 0.7 s`.
- A small horizontal jitter (`±0.15 m`, drawn from the world RNG) on `posX` so
  multi-hits don't perfectly stack.
- Damage clamped to `[1, 999]` for display. Damage that exceeds 999 just shows
  "999" — no edge case worth worrying about at this phase.

### Animation

- Linear rise: `posY += velY * dt`.
- Mild gravity: `velY -= 1.0 * dt` (slows but does not reverse).
- Alpha: `alpha = clamp(life / (0.3 * lifeMax), 0, 1)` — fully opaque for the
  first 70% of life, fades over the last 30%.

## Threading the pool through the codebase

- `damage-texts.ts` exports `createDamageTexts(capacity)`, `spawnDamageText`,
  `updateDamageTexts`, `freeDamageText`.
- New parameter added to `applyHit` (last position, optional with `undefined`
  default for tests). Three call sites updated:
  - `projectile-system.ts:294` — tickProjectiles signature gains `damageTexts`,
    threaded down from caller.
  - `shockwave-system.ts:79` — same.
  - `lab/actions.ts:200/212/225` — pass undefined (lab harness — already
    skipping splats/etc).
- `tickWorld` (or its caller) gains a `damageTexts` parameter, owned by
  `skirmish/main.ts` and passed in. Identical wiring to the existing
  `particles` and `puffs` pools.
- `renderer.render(...)` gains a `damageTexts` parameter; renderer factory
  creates the new pass; `damageTextPass.draw(damageTexts, cam)` runs after
  particles.
- Update tick added in `skirmish/main.ts` next to `updateParticles`:
  `profiler.time('damage-texts/update', () => updateDamageTexts(damageTexts, dt))`.

## Determinism

Damage texts are pure visual feedback and use `world.rng` for the spawn
jitter. They do not influence sim outcomes. Existing tests that assert on
RNG-derived sim state are unaffected because the jitter is drawn *after* all
sim-affecting RNG calls in the same frame (we add a single extra `rng()` call
per `applyHit`). However, any test that reproduces a frame deterministically
will now see one additional `rng()` consumption per hit.

To avoid disturbing the sim RNG stream, the spawn site will use a
**dedicated visual RNG** — created in `skirmish/main.ts`, not passed through
`tickWorld`. The pool itself is owned outside the sim. `applyHit` receives
`damageTexts` as a parameter but does *not* touch the sim RNG for jitter;
instead, jitter uses a static counter in the pool (e.g. `cursor & 7` mapped
to `[-0.15, +0.15]`). This keeps the sim deterministic.

## Testing

- `damage-texts.test.ts`: alloc/free/update — life decrement, position
  integration, free on expiry, slot reuse via cursor.
- `glyph-atlas.test.ts`: spot-check that the atlas texture has the expected
  pixel-on/off pattern at known glyph cells (e.g. corners of "0", center of
  "8").
- `damage-text-pass.test.ts`: per-digit flattening — given a pool with values
  `[7, 42, 999]`, the instance buffer should contain 1+2+3 = 6 instances with
  the right digit values and X offsets.
- Update existing `combat-events.test.ts` to pass the new `damageTexts` arg
  (or leave undefined — `applyHit` no-ops cleanly).
- Browser verify in `skirmish.html`: hit a unit with a musket and a cannon,
  confirm the numbers appear, rise, fade, and never overlap with health bars.

## Out of scope

- Crit / headshot / kill-shot variants
- Color-by-damage-tier
- Heal greens
- Block / dodge / armor "0" indicators
- Stacking / accumulation of multiple hits within a short window
- Per-team color tinting

All of these are easy follow-ups once the pipeline lands.
