# Pixel Damage Callouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add floating pixel-art damage numbers that pop above units when they take damage, drift up, and fade. New SoA pool, single spawn hook in `applyHit`, dedicated render pass with a code-baked 5×7 glyph atlas.

**Spec:** `docs/superpowers/specs/2026-04-29-pixel-damage-callouts-design.md`

**Tech Stack:** TypeScript, WebGL2 (matches existing passes), Vitest. No new deps.

---

## File Structure

```
# NEW
src/fx/damage-texts/
  damage-texts.ts                 # SoA pool: alloc, free, update, jitter via cursor
  damage-texts.test.ts            # alloc/free/update behavior
  glyph-atlas.ts                  # 5×7 digit bitmaps + GL texture upload
  glyph-atlas.test.ts             # bitmap correctness
  index.ts                        # re-exports

src/render/passes/
  damage-text-pass.ts             # instanced per-digit pass
  damage-text-pass.test.ts        # per-digit flattening

src/render/shaders/
  damage-text.glsl.ts             # VS + FS strings

# MODIFIED
src/sim/systems/combat-events.ts          # applyHit gains damageTexts param; spawn after effDmg
src/sim/systems/projectile-system.ts      # thread damageTexts through tickProjectiles
src/sim/systems/shockwave-system.ts       # thread damageTexts through shockwave tick
src/sim/world.ts                          # if tickWorld owns damageTexts; otherwise wire via main
src/skirmish/main.ts                      # create pool, tick update, pass to renderer
src/lab/main.ts                           # mirror wiring (lab harness)
src/lab/actions.ts                        # pass damageTexts to applyHit (or undefined)
src/render/renderer.ts                    # add pass, add param to render(), insert after particles
src/sim/systems/combat-events.test.ts     # update applyHit calls (extra param)
src/sim/veterancy-integration.test.ts     # same
```

---

## Implementation Tasks

### Task 1 — Pool

- [ ] Create `src/fx/damage-texts/damage-texts.ts` exporting:
  - `interface DamageTexts` (SoA per spec)
  - `createDamageTexts(capacity: number): DamageTexts`
  - `spawnDamageText(d: DamageTexts, x: number, y: number, value: number): number` — clamps `value` to `[1, 999]`, applies cursor-derived horizontal jitter (no RNG), seeds `velY = 1.5`, `life = lifeMax = 0.7`. Returns slot id or -1 if full.
  - `updateDamageTexts(d: DamageTexts, dt: number): void` — life decrement, free on expiry, integrate `posY`, decay `velY` by `1.0 * dt`.
  - `freeDamageText(d: DamageTexts, i: number): void`
- [ ] Mirror the `Particles` packed-alive-list pattern (`aliveIds`, `aliveIdx`, `cursor`).
- [ ] Tests in `damage-texts.test.ts`:
  - alloc → spawn → cursor advances, slot allocated
  - update integrates `posY` upward
  - update frees slot when `life <= 0`
  - capacity overflow returns -1
  - slot reuse after free
  - value clamped to `[1, 999]`

### Task 2 — Glyph atlas

- [ ] Create `src/fx/damage-texts/glyph-atlas.ts` exporting:
  - `GLYPH_W = 5`, `GLYPH_H = 7`, `GLYPH_COUNT = 10`
  - `DIGIT_BITMAPS: readonly Uint8Array[]` — 10 entries, each 35 bytes (5*7), value 0 or 1
  - `createGlyphAtlas(gl: WebGL2RenderingContext): WebGLTexture` — packs all digits horizontally into a 50×7 R8 texture, uploads with `gl.NEAREST`
- [ ] Hand-define readable bitmaps for 0–9. Reference any standard 5×7 pixel font shape; just be consistent and legible.
- [ ] Tests in `glyph-atlas.test.ts`:
  - Each `DIGIT_BITMAPS[i]` is `GLYPH_W * GLYPH_H` bytes
  - Each entry has only 0 / 1 values
  - Spot-checks: top-left of "0" is on, center of "0" is off, top of "1" forms a single column, etc. (4–6 sanity checks).

### Task 3 — Shader

- [ ] Create `src/render/shaders/damage-text.glsl.ts` exporting `DAMAGE_TEXT_VS` and `DAMAGE_TEXT_FS` strings.
  - VS: `a_corner` (-0.5..0.5), `a_pos` (vec2 world), `a_digit` (float), `a_alpha` (float). Compute world pos, transform via `u_viewProj`, pass `v_uv` (corner mapped to glyph UV range based on `a_digit`) and `v_alpha`.
  - FS: sample `u_atlas` at `v_uv`. Discard if `sample.r < 0.5`. Output `vec4(1.0, 0.95, 0.85, v_alpha)`. Hard cutoff = no smoothing.

### Task 4 — Render pass

- [ ] Create `src/render/passes/damage-text-pass.ts` modeled on `health-bar-pass.ts`:
  - `interface DamageTextInstances { pos, digit, alpha, count, capacity }`
  - `computeDamageTextInstances(d: DamageTexts, out: DamageTextInstances)` — flattens texts into per-digit instances; computes digit count via `Math.floor(Math.log10(value)) + 1` (handle value=0 just in case → 1); computes per-digit X offset and digit value as in spec.
  - `createDamageTextPass(gl, capacity)` returning `{ draw(d: DamageTexts, cam: Camera): void }`
  - VAO with corner buffer (static) + pos/digit/alpha buffers (DYNAMIC).
  - Shader uniforms: `u_viewProj`, `u_glyphSize` (vec2 world units, e.g. `[0.3, 0.4]`), `u_atlas` (sampler2D bound to texture unit 0).
- [ ] Capacity for the instance buffer = `pool.capacity * 3`.
- [ ] Tests in `damage-text-pass.test.ts`:
  - Pool with `value=7` → 1 instance, digit=7, x offset = 0
  - Pool with `value=42` → 2 instances, digits=[4, 2], x offsets symmetric around center
  - Pool with `value=999` → 3 instances, digits=[9, 9, 9]
  - Mixed pool with [7, 42, 999] → 6 instances total

### Task 5 — Renderer integration

- [ ] Edit `src/render/renderer.ts`:
  - Import `createDamageTextPass`, `createGlyphAtlas`, `DamageTexts`
  - Renderer factory creates atlas + pass (after `healthBarPass` creation)
  - `Renderer.render(...)` signature gains `damageTexts: DamageTexts` parameter
  - Inside `render()`, after the particles draw at line 228 and before trajectory preview (line 232 area), add:
    ```ts
    profiler.begin('render/damage-texts');
    damageTextPass.draw(damageTexts, cam);
    profiler.end('render/damage-texts');
    ```
- [ ] Update `Renderer` interface accordingly.

### Task 6 — applyHit hook

- [ ] Edit `src/sim/systems/combat-events.ts`:
  - Import `DamageTexts`, `spawnDamageText`
  - `applyHit` gains a final parameter `damageTexts: DamageTexts | undefined`
  - After computing `effDmg` (line 108), if `damageTexts !== undefined`:
    ```ts
    const kindForText = getUnitKindByIndex(e.kindId[id]!);
    const above = py + kindForText.placeholderSize.h * 0.5 + 0.3;
    spawnDamageText(damageTexts, px, above, effDmg);
    ```
  - JSDoc updated to document the new parameter.
- [ ] Update existing `applyHit` callers:
  - `src/sim/systems/projectile-system.ts:294` — `tickProjectiles` signature gains `damageTexts?: DamageTexts`; pass through.
  - `src/sim/systems/shockwave-system.ts:79` — same: `tickShockwaves` signature gains `damageTexts?: DamageTexts`; pass through.
  - `src/lab/actions.ts:200,212,225` — pass `undefined` (lab harness skips other optional params already).

### Task 7 — Sim wiring

- [ ] Find where `tickWorld` calls `tickProjectiles` and `tickShockwaves` (likely in `src/sim/world.ts` or `src/sim/tick.ts`):
  - If those callers don't currently know about `damageTexts`, thread it through. Either add to `World` (preferred — sits next to `bloodSplats` etc.) or pass `damageTexts` as a separate `tickWorld(world, dt, damageTexts?)` arg.
  - Pick the simpler route: add `damageTexts: DamageTexts` to the tick context. If `tickWorld` already takes a context object, extend it. If it's positional args, add at the end and propagate down.
- [ ] **Important:** verify no test file constructs `tickWorld` directly without `damageTexts` — if so, make the param optional at all tick layers (only `applyHit`'s real callers need to actually pass a real pool).

### Task 8 — Skirmish main wiring

- [ ] Edit `src/skirmish/main.ts`:
  - Import `createDamageTexts`, `updateDamageTexts`, `DamageTexts`
  - Allocate pool: `const damageTexts = createDamageTexts(256);` next to existing `particles` / `puffs` setup
  - Add update tick next to `updateParticles`:
    ```ts
    profiler.time('damage-texts/update', () => updateDamageTexts(damageTexts, dt));
    ```
  - Pass `damageTexts` to `tickWorld` (per Task 7's wiring choice)
  - Pass `damageTexts` to `renderer.render(...)` call at line 310
- [ ] Mirror in `src/lab/main.ts` (lab harness uses the same pipeline).

### Task 9 — Test updates for new param

- [ ] Update `src/sim/systems/combat-events.test.ts`: existing `applyHit(...)` calls add a trailing `undefined` for `damageTexts` (or omit if optional).
- [ ] Update `src/sim/veterancy-integration.test.ts`: same.
- [ ] Run `npm run typecheck` — fix any leftover signature mismatches.
- [ ] Run `npm test` — all existing tests should pass.

### Task 10 — Browser verification

- [ ] Build with `npm run build` (or use the dev server: `npm run dev`).
- [ ] Open `skirmish.html` in a browser.
- [ ] Verify, in this order:
  1. Damage numbers appear over a unit when shot by a musket.
  2. Damage numbers appear over units in a cannon canister blast (multiple stacked hits at once).
  3. Numbers rise and fade — no flickering or sub-pixel shimmer.
  4. Numbers do not overlap with health bars (when Alt is held).
  5. Numbers stay crisp at all zoom levels (pixelation preserved).
  6. No console errors.
- [ ] Report exactly what was tested and any visual deviations from the spec.

---

## Verification commands

```bash
# typecheck
npm run typecheck

# unit tests
npm test -- --run

# build
npm run build

# dev server for browser verify
npm run dev
```

## Out of scope (do not implement)

- Crit / headshot / kill-shot styling
- Color-by-damage-tier or heal greens
- Block / dodge / "0" callouts
- Per-team tinting
- Stacking / accumulation
- Sound for damage numbers
