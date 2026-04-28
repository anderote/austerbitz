# Cannon Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `cannon-test.html` sandbox plus mechanic polish — propagating shockwaves, dirt-puff ground skips, ring/ember/crater juice, camera shake, audio hook, gib bias, and canister shot.

**Architecture:** Refactor `spawnExplosion` from single-tick to "instant visuals + spawn shockwave record." A new per-tick `shockwave-system` advances each wave's radius and delivers damage exactly once per entity via a per-wave bitset. New ammo (`canister`) batches musket projectiles in a Gaussian cone. Polish is pure additions: a `dirt-skip` puff profile, a parallel `crater-stain-pass` mirroring the blood-stain pipeline, a tiny `camera-shake.ts`, and a silent-by-default `sfx.ts` audio hook.

**Tech Stack:** TypeScript, Vite (multi-page), Vitest, gl-matrix, WebGL2.

**Spec:** `docs/superpowers/specs/2026-04-28-cannon-mechanics-design.md`

---

## File Map

**New:**
- `cannon-test.html` — sandbox entry HTML
- `src/cannon-test/main.ts` — bootstrap (mirrors `src/lab/main.ts`)
- `src/cannon-test/scene.ts` — build cannons + regiment + camera
- `src/cannon-test/hud.ts` — legend, counters, side panel, hotkeys
- `src/fx/shockwaves.ts` — `Shockwaves` pool + alloc/free + hitMask helpers
- `src/sim/systems/shockwave-system.ts` — per-tick wave advance + damage
- `src/render/camera-shake.ts` — shake state + kick + apply
- `src/render/passes/crater-stain-pass.ts` — parallel to `blood-stain-pass.ts`
- `src/sim/crater-splats.ts` — parallel to `blood-splats.ts`
- `src/audio/sfx.ts`, `src/audio/manifest.ts` — audio hook (scaffold)
- `src/data/weapons/cannon-12-canister.ts` — canister profile
- `src/puffs/profiles/dirt-skip.ts` — ground-skip puff
- `scripts/draw-crater-stain.mjs` — bake crater decal texture

**Modified:**
- `src/fx/explosion.ts` — instant visuals only + spawn shockwave record
- `src/fx/explosion.test.ts` — update for two-phase shape
- `src/sim/world.ts` — add `shockwaves`, `craterSplats` to World
- `src/sim/projectiles.ts` — add `spawnCanister`
- `src/sim/systems/projectile-system.ts` — dirt-puff on skip + cannonball trail puff
- `src/sim/systems/debris-emit.ts` — explosion gib bias (counts + Z)
- `src/particles/particles.ts` — add `Ring`, `Ember` to `ParticleClass`
- `src/render/renderer.ts` — wire crater-stain pass + read camera shake
- `src/render/passes/particle-pass.ts` (or wherever flash branch lives) — render Ring as additive annulus
- `src/data/weapons/types.ts` — `CanisterProfile` interface
- `vite.config.ts` — register `cannonTest` rollup input
- `public/decals/crater-stain.png` — output of bake script (committed)

---

## Task 1: Shockwaves pool + hitMask helpers

**Files:**
- Create: `src/fx/shockwaves.ts`
- Create: `src/fx/shockwaves.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/fx/shockwaves.test.ts
import { describe, it, expect } from 'vitest';
import {
  createShockwaves,
  allocShockwave,
  freeShockwave,
  setHit,
  isHit,
} from './shockwaves';

describe('Shockwaves', () => {
  it('alloc returns -1 when full and recycles after free', () => {
    const s = createShockwaves(2, 64);
    const a = allocShockwave(s);
    const b = allocShockwave(s);
    expect(allocShockwave(s)).toBe(-1);
    freeShockwave(s, a);
    const c = allocShockwave(s);
    expect(c).toBe(a);
    expect(s.alive[b]).toBe(1);
  });

  it('hitMask is per-shockwave and clears on alloc', () => {
    const s = createShockwaves(2, 64);
    const a = allocShockwave(s);
    setHit(s, a, 7);
    expect(isHit(s, a, 7)).toBe(true);
    expect(isHit(s, a, 8)).toBe(false);
    freeShockwave(s, a);
    const b = allocShockwave(s);
    expect(isHit(s, b, 7)).toBe(false);    // cleared on alloc
  });

  it('hitMask handles out-of-range entity ids without overflow', () => {
    const s = createShockwaves(1, 64);
    const a = allocShockwave(s);
    setHit(s, a, 63);
    expect(isHit(s, a, 63)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

Run: `npm test -- shockwaves`

- [ ] **Step 3: Implement the pool**

```ts
// src/fx/shockwaves.ts
export interface Shockwaves {
  capacity: number;        // max simultaneous waves
  entityCapacity: number;  // entities supported by hitMask
  count: number;
  alive: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  fullRadius: Float32Array;
  age: Float32Array;
  waveSpeed: Float32Array;
  damage: Float32Array;
  impulse: Float32Array;
  excludeTeam: Int8Array;     // -1 = none
  attackerId: Int32Array;
  hitMaskBytesPerWave: number;
  hitMask: Uint8Array;        // capacity * hitMaskBytesPerWave
  freeListHead: number;
  freeListNext: Int32Array;
}

export function createShockwaves(capacity: number, entityCapacity: number): Shockwaves {
  const hitMaskBytesPerWave = Math.ceil(entityCapacity / 8);
  const freeListNext = new Int32Array(capacity);
  for (let i = 0; i < capacity - 1; i++) freeListNext[i] = i + 1;
  freeListNext[capacity - 1] = -1;
  return {
    capacity,
    entityCapacity,
    count: 0,
    alive: new Uint8Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    fullRadius: new Float32Array(capacity),
    age: new Float32Array(capacity),
    waveSpeed: new Float32Array(capacity),
    damage: new Float32Array(capacity),
    impulse: new Float32Array(capacity),
    excludeTeam: new Int8Array(capacity).fill(-1),
    attackerId: new Int32Array(capacity).fill(-1),
    hitMaskBytesPerWave,
    hitMask: new Uint8Array(capacity * hitMaskBytesPerWave),
    freeListHead: 0,
    freeListNext,
  };
}

export function allocShockwave(s: Shockwaves): number {
  const id = s.freeListHead;
  if (id === -1) return -1;
  s.freeListHead = s.freeListNext[id]!;
  s.alive[id] = 1;
  s.count++;
  s.age[id] = 0;
  // Zero this wave's hitMask slice.
  const off = id * s.hitMaskBytesPerWave;
  s.hitMask.fill(0, off, off + s.hitMaskBytesPerWave);
  return id;
}

export function freeShockwave(s: Shockwaves, id: number): void {
  if (!s.alive[id]) return;
  s.alive[id] = 0;
  s.count--;
  s.freeListNext[id] = s.freeListHead;
  s.freeListHead = id;
}

export function isHit(s: Shockwaves, waveId: number, entityId: number): boolean {
  if (entityId < 0 || entityId >= s.entityCapacity) return true; // treat out-of-range as already-hit (skip)
  const off = waveId * s.hitMaskBytesPerWave + (entityId >>> 3);
  return (s.hitMask[off]! & (1 << (entityId & 7))) !== 0;
}

export function setHit(s: Shockwaves, waveId: number, entityId: number): void {
  if (entityId < 0 || entityId >= s.entityCapacity) return;
  const off = waveId * s.hitMaskBytesPerWave + (entityId >>> 3);
  s.hitMask[off] = s.hitMask[off]! | (1 << (entityId & 7));
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- shockwaves`

- [ ] **Step 5: Commit**

```bash
git add src/fx/shockwaves.ts src/fx/shockwaves.test.ts
git commit -m "feat(fx): shockwaves pool + per-wave hit bitset"
```

---

## Task 2: shockwave-system — per-tick wave advance + damage

**Files:**
- Create: `src/sim/systems/shockwave-system.ts`
- Create: `src/sim/systems/shockwave-system.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/sim/systems/shockwave-system.test.ts
import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity, EntityState } from '../entities';
import { createGrid, gridRebuild } from '../spatial/grid';
import { createParticles } from '../../particles/particles';
import { createDebris } from '../debris';
import { createBloodSplats } from '../blood-splats';
import { createRng } from '../../util/rng';
import { createShockwaves, allocShockwave } from '../../fx/shockwaves';
import { updateShockwaves } from './shockwave-system';

function setupEntity(e: ReturnType<typeof createEntities>, x: number, y: number, hp: number, team = 0): number {
  const id = allocEntity(e);
  e.posX[id] = x; e.posY[id] = y;
  e.team[id] = team;
  e.hp[id] = hp;
  e.state[id] = EntityState.Standing;
  return id;
}

describe('updateShockwaves', () => {
  it('hits each entity in the radius exactly once across ticks', () => {
    const entities = createEntities(64);
    const grid = createGrid({ minX: 0, minY: 0, maxX: 200, maxY: 200, cellSize: 4, capacity: 64 });
    const particles = createParticles(1024);
    const debris = createDebris(64);
    const splats = createBloodSplats(64);
    const rng = createRng(1);
    const sw = createShockwaves(2, 64);

    // 3 entities at increasing radii from (100, 100): inside, mid, outside
    const aId = setupEntity(entities, 102, 100, 50);   // ~2m from center
    const bId = setupEntity(entities, 104, 100, 50);   // ~4m
    const cId = setupEntity(entities, 110, 100, 50);   // ~10m (outside r=6)
    gridRebuild(grid, entities.aliveIds, entities.count, entities.posX, entities.posY);

    const id = allocShockwave(sw);
    sw.x[id] = 100; sw.y[id] = 100;
    sw.fullRadius[id] = 6;
    sw.waveSpeed[id] = 120;
    sw.damage[id] = 60;
    sw.impulse[id] = 1000;

    // Step until wave fully resolves (~50ms).
    const dt = 1 / 60;
    for (let i = 0; i < 8; i++) {
      updateShockwaves(sw, entities, grid, particles, rng, splats, debris, dt);
    }

    expect(entities.hp[aId]).toBeLessThan(50);
    expect(entities.hp[bId]).toBeLessThan(50);
    expect(entities.hp[cId]).toBe(50);                   // never hit
    expect(entities.hp[aId]).toBeLessThan(entities.hp[bId]!); // closer = more damage (falloff)
  });

  it('respects excludeTeam', () => {
    const entities = createEntities(8);
    const grid = createGrid({ minX: 0, minY: 0, maxX: 200, maxY: 200, cellSize: 4, capacity: 8 });
    const particles = createParticles(64);
    const debris = createDebris(8);
    const splats = createBloodSplats(8);
    const rng = createRng(2);
    const sw = createShockwaves(1, 8);

    const friendly = setupEntity(entities, 102, 100, 50, 1);
    const enemy = setupEntity(entities, 102, 100, 50, 0);
    gridRebuild(grid, entities.aliveIds, entities.count, entities.posX, entities.posY);

    const id = allocShockwave(sw);
    sw.x[id] = 100; sw.y[id] = 100;
    sw.fullRadius[id] = 6; sw.waveSpeed[id] = 120;
    sw.damage[id] = 60; sw.impulse[id] = 1000;
    sw.excludeTeam[id] = 1;

    for (let i = 0; i < 8; i++) updateShockwaves(sw, entities, grid, particles, rng, splats, debris, 1/60);

    expect(entities.hp[friendly]).toBe(50);
    expect(entities.hp[enemy]).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- shockwave-system`

- [ ] **Step 3: Implement the system**

```ts
// src/sim/systems/shockwave-system.ts
import { isDead, type Entities } from '../entities';
import { type Grid, gridQueryRadius } from '../spatial/grid';
import type { Particles } from '../../particles/particles';
import type { Rng } from '../../util/rng';
import type { BloodSplats } from '../blood-splats';
import type { Debris } from '../debris';
import { type Shockwaves, freeShockwave, isHit, setHit } from '../../fx/shockwaves';
import { applyHit } from './combat-events';

const SCRATCH = new Int32Array(2048);

/** Per-tick: advance each active wave; deliver damage to entities crossed this tick. */
export function updateShockwaves(
  sw: Shockwaves,
  entities: Entities,
  grid: Grid,
  particles: Particles,
  rng: Rng,
  splats: BloodSplats | undefined,
  debris: Debris,
  dt: number,
): void {
  for (let w = 0; w < sw.capacity; w++) {
    if (sw.alive[w] === 0) continue;
    const prevR = sw.waveSpeed[w]! * sw.age[w]!;
    sw.age[w] = sw.age[w]! + dt;
    const fullR = sw.fullRadius[w]!;
    let currR = sw.waveSpeed[w]! * sw.age[w]!;
    const done = currR >= fullR;
    if (done) currR = fullR;

    const cx = sw.x[w]!;
    const cy = sw.y[w]!;
    const damageScale = sw.damage[w]!;
    const impulseScale = sw.impulse[w]!;
    const excludeTeam = sw.excludeTeam[w]!;
    const attackerId = sw.attackerId[w]!;

    const n = gridQueryRadius(grid, cx, cy, currR, SCRATCH);
    for (let i = 0; i < n; i++) {
      const id = SCRATCH[i]!;
      if (entities.alive[id] === 0) continue;
      if (isDead(entities, id)) continue;
      if (excludeTeam !== -1 && entities.team[id] === excludeTeam) continue;
      if (isHit(sw, w, id)) continue;
      const dx = entities.posX[id]! - cx;
      const dy = entities.posY[id]! - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < prevR || dist > currR) continue;

      setHit(sw, w, id);
      const t = Math.min(1, dist / fullR);
      const falloff = 1 - Math.pow(t, 1.5);
      const inv = dist > 1e-6 ? 1 / dist : 0;
      const dirX = dx * inv;
      const dirY = dy * inv;
      applyHit(
        entities, particles, rng, id,
        damageScale * falloff,
        dirX * impulseScale * falloff,
        dirY * impulseScale * falloff,
        'explosion',
        splats,
        debris,
        attackerId,
      );
    }

    if (done) freeShockwave(sw, w);
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- shockwave-system`

- [ ] **Step 5: Commit**

```bash
git add src/sim/systems/shockwave-system.ts src/sim/systems/shockwave-system.test.ts
git commit -m "feat(sim): shockwave-system — per-tick ring damage delivery"
```

---

## Task 3: Wire shockwaves into world; refactor `spawnExplosion`

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `src/fx/explosion.ts`
- Modify: `src/fx/explosion.test.ts`

- [ ] **Step 1: Add `shockwaves` to World**

In `src/sim/world.ts`, add the import and field. Use `entities` capacity as the entity-capacity arg:

```ts
import { createShockwaves, type Shockwaves } from '../fx/shockwaves';

// ...inside World interface:
  /** Active explosion shockwaves; advanced each tick by shockwave-system. */
  shockwaves: Shockwaves;

// ...inside createWorld() return object:
    shockwaves: createShockwaves(32, cfg.capacity),
```

Pool size 32 = simultaneous in-flight waves; with `waveSpeed=120 m/s` and typical `fullRadius=6 m` each wave lives ~50ms, so 32 is generous.

- [ ] **Step 2: Update `spawnExplosion` signature and behavior**

Replace `src/fx/explosion.ts`:

```ts
import { isDead, type Entities } from '../sim/entities';
import { type Grid } from '../sim/spatial/grid';
import { ParticleClass, spawnParticle, type Particles } from '../particles/particles';
import type { Rng } from '../util/rng';
import type { ExplosionProfile } from '../data/weapons/types';
import type { BloodSplats } from '../sim/blood-splats';
import type { Debris } from '../sim/debris';
import type { Puffs } from '../puffs/puffs';
import { emitPuffBurst } from '../puffs/emit';
import { allocShockwave, type Shockwaves } from './shockwaves';

const RING_COUNT = 2;
const RING_BIRTH_OFFSETS = [0, 0.08];           // seconds; staggered for layered feel
const EMBER_COUNT = 20;

/**
 * Trigger an explosion at (x, y): instant visuals (flash, rings, smoke billow,
 * debris fan, embers) plus a shockwave record advanced by shockwave-system.
 *
 * Damage is no longer applied here — see updateShockwaves().
 */
export function spawnExplosion(
  shockwaves: Shockwaves,
  _entities: Entities,    // kept for future use (decals, etc.)
  _grid: Grid,
  puffs: Puffs,
  particles: Particles,
  rng: Rng,
  x: number,
  y: number,
  profile: ExplosionProfile,
  excludeTeam: number | undefined,
  _splats: BloodSplats | undefined,
  _debris: Debris,
  attackerId: number,
): void {
  // 1. Center flash.
  spawnParticle(particles, {
    x, y, vx: 0, vy: 0,
    life: profile.flash.life,
    size: profile.flash.size,
    r: profile.flash.color[0], g: profile.flash.color[1], b: profile.flash.color[2],
    drag: 0.6, accelY: 0, sizeGrowth: 0,
    klass: ParticleClass.Flash,
  });

  // 2. Concentric rings (additive annuli). Birth offsets give a layered shockwave look.
  for (let i = 0; i < RING_COUNT; i++) {
    spawnParticle(particles, {
      x, y, vx: 0, vy: 0,
      life: profile.flash.life * 1.6 + RING_BIRTH_OFFSETS[i]!,
      size: profile.flash.size * 0.5,
      r: profile.flash.color[0] * 0.85,
      g: profile.flash.color[1] * 0.85,
      b: profile.flash.color[2] * 0.85,
      drag: 0,
      accelY: 0,
      sizeGrowth: profile.damageRadius * 4,    // grows toward fullRadius over its life
      klass: ParticleClass.Ring,
    });
  }

  // 3. Smoke billow.
  const sb = profile.smokeBillow;
  emitPuffBurst(puffs, sb.profile, sb.profileIdx, x, y, 1, 0,
                sb.count, Math.PI * 2, sb.speed, rng);

  // 4. Debris fan.
  const dp = profile.debris;
  for (let i = 0; i < dp.count; i++) {
    const angle = rng.next() * Math.PI * 2;
    const speed = rng.range(dp.speedMin, dp.speedMax);
    spawnParticle(particles, {
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: dp.life, size: dp.size,
      r: 0.55, g: 0.45, b: 0.32,
      drag: 0.92, accelY: 0, sizeGrowth: 0,
      klass: ParticleClass.Debris,
    });
  }

  // 5. Embers.
  for (let i = 0; i < EMBER_COUNT; i++) {
    const angle = rng.next() * Math.PI * 2;
    const speed = rng.range(2, 5);
    spawnParticle(particles, {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rng.range(1, 2),  // slight upward bias
      life: rng.range(0.6, 1.2),
      size: rng.range(0.15, 0.3),
      r: 1.0, g: rng.range(0.5, 0.8), b: rng.range(0.05, 0.2),
      drag: 0.85,
      accelY: -2,                                       // rise slowly
      sizeGrowth: -0.5,
      klass: ParticleClass.Ember,
    });
  }

  // 6. Shockwave record — damage delivered over the next ~50ms by shockwave-system.
  const w = allocShockwave(shockwaves);
  if (w === -1) return;                  // pool full; visuals still played
  shockwaves.x[w] = x;
  shockwaves.y[w] = y;
  shockwaves.fullRadius[w] = profile.damageRadius;
  shockwaves.waveSpeed[w] = 120;          // m/s
  shockwaves.damage[w] = profile.damage;
  shockwaves.impulse[w] = profile.impulse;
  shockwaves.excludeTeam[w] = excludeTeam ?? -1;
  shockwaves.attackerId[w] = attackerId;
}
```

- [ ] **Step 3: Update existing `explosion.test.ts`**

Read `src/fx/explosion.test.ts` first to see its current shape. Update:
- All `spawnExplosion` calls take a new first arg `shockwaves` (`createShockwaves(4, capacity)`).
- Tests that asserted damage delivery now also call `updateShockwaves` for ~8 ticks after `spawnExplosion`.
- Add an assertion that `shockwaves.count === 1` immediately after `spawnExplosion` (before the update loop), then `=== 0` after the wave fully resolves.

- [ ] **Step 4: Update all `spawnExplosion` callers**

```bash
grep -rn "spawnExplosion(" src/ --include='*.ts'
```

Update each call site (likely `src/sim/systems/projectile-system.ts`) to pass `world.shockwaves` (or the equivalent in scope) as the first argument.

- [ ] **Step 5: Wire `updateShockwaves` into the world tick**

Find where `tickProjectiles` is registered as a system. Register `updateShockwaves` immediately after it. The cannon-test page (Task 11) and main game both rely on this registration in their world setup.

If world systems are added externally (as in `src/lab/main.ts`), register there. If there's a central system list (e.g. `src/main.ts`), register there too. Search:
```bash
grep -rn "tickProjectiles" src/ --include='*.ts'
```
For each setup site, add `updateShockwaves(world.shockwaves, world.entities, world.grid, particles, world.rng, world.bloodSplats, world.debris, dt)` after `tickProjectiles`.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: all pass except the pre-existing `wind.test.ts` failure (already broken at baseline).

- [ ] **Step 7: Commit**

```bash
git add -u src/fx src/sim/world.ts src/sim/systems/projectile-system.ts src/main.ts src/lab/main.ts 2>/dev/null
git commit -m "refactor(fx): explosion = instant visuals + shockwave record"
```

---

## Task 4: ParticleClass.Ring + Ember + render branches

**Files:**
- Modify: `src/particles/particles.ts`
- Modify: render-side particle rendering (locate via grep)

- [ ] **Step 1: Add new classes**

In `src/particles/particles.ts`:

```ts
export const ParticleClass = {
  Dust: 0,
  Smoke: 1,
  Flash: 2,
  Blood: 3,
  Debris: 4,
  Ring: 5,
  Ember: 6,
} as const;
```

- [ ] **Step 2: Find the render branch for `Flash`**

```bash
grep -rn "ParticleClass.Flash\|klass.*===\s*2" src/render/ --include='*.ts'
```

You'll find a particle pass (likely `src/render/passes/particle-pass.ts` or similar) that switches blending/uniforms by class.

- [ ] **Step 3: Add `Ring` and `Ember` render branches**

- `Ember`: same blending and shader as `Flash` (additive). No code change beyond accepting the new klass into the additive bucket.
- `Ring`: additive, but the fragment shader needs to draw a hollow annulus instead of a soft disc. Two options depending on existing pass shape:
  - **(Preferred)** Add a uniform `u_isRing` (or per-particle attribute byte) and branch in the fragment shader: `float r = length(uv - 0.5) * 2.0; float ring = smoothstep(0.85, 0.95, r) - smoothstep(0.95, 1.0, r);` Multiply final alpha by `ring`.
  - If existing shader can't easily branch, write a parallel `ring-pass.ts` that draws only Ring particles. This is fine — small file, single responsibility.

Choose the option that fits the existing structure with smallest blast radius. Fall back to **soft circle for Ring** if shader changes are deeper than expected — note as a TODO and proceed (the gameplay still works without a ring shape; design accepts this risk).

- [ ] **Step 4: Verify visually**

In the cannon-test page (Task 11) you'll see rings; for now, smoke-test by adding a temp call in the lab `actExplosiveShell` and checking the page. (Skip this step if Task 11 is being done by the same engineer in the same session — the visual check happens there.)

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: still green (no test asserts on render).

- [ ] **Step 6: Commit**

```bash
git add -u src/particles/particles.ts src/render
git commit -m "feat(render): Ring + Ember particle classes"
```

---

## Task 5: dirt-skip puff + cannonball trail

**Files:**
- Create: `src/puffs/profiles/dirt-skip.ts`
- Modify: `src/sim/systems/projectile-system.ts`

- [ ] **Step 1: Read an existing puff profile to mirror its shape**

Run:
```bash
ls src/puffs/profiles/
cat src/puffs/profiles/dust.ts
cat src/puffs/profiles/cannonball-trail.ts
```

Confirm the profile interface (color, life, sizeStart/End, softness, buoyancy, drag, decay, profileIdx).

- [ ] **Step 2: Create `dirt-skip` profile**

```ts
// src/puffs/profiles/dirt-skip.ts
import type { PuffProfile } from '../profile';
// (Match the field names of the existing profiles.)

export const dirtSkipProfile: PuffProfile = {
  // ...mirror dust but bias darker, slightly larger size, low buoyancy:
  // color: brown-grey (~r 0.42, g 0.34, b 0.24)
  // life range: 0.4 .. 0.7 s
  // size start: 0.3, end: 0.9
  // softness: 0.6
  // buoyancy: -0.2 (settles)
  // drag: 0.85
  // (Use exact field names from PuffProfile interface in src/puffs/profile.ts)
};
```

Then register the profile in the profile registry alongside the others — search:
```bash
grep -rn "dustProfile\|cannonSmoke\|cannonball-trail" src/puffs/profile.ts
```
Mirror that registration pattern.

- [ ] **Step 3: Replace `emitRicochetBurst` ground-skip with dirt puff**

In `src/sim/systems/projectile-system.ts` (around line 115 per the spec — confirm with `grep -n emitRicochetBurst`), replace the call with a dirt-skip puff burst:

```ts
import { emitPuffBurst } from '../../puffs/emit';
import { dirtSkipProfile, dirtSkipProfileIdx } from '../../puffs/profiles/dirt-skip';

// (where the ricochet currently fires)
emitPuffBurst(
  puffs, dirtSkipProfile, dirtSkipProfileIdx,
  p.posX[i]!, p.posY[i]!,
  // forward direction = current vel
  p.velX[i]! / Math.max(1e-3, Math.hypot(p.velX[i]!, p.velY[i]!)),
  p.velY[i]! / Math.max(1e-3, Math.hypot(p.velX[i]!, p.velY[i]!)),
  6,                       // count
  Math.PI / 3,             // 60° forward cone
  4,                       // speed m/s
  rng,
);
// Keep emitRicochetBurst for now too — small grit particles still read well.
emitRicochetBurst(particles, p.posX[i]!, p.posY[i]!, p.velX[i]!, p.velY[i]!, rng);
```

- [ ] **Step 4: Add cannonball trail puff**

After the integration step (~step 1 of `tickProjectiles` per `projectile-system.ts:74` area), for `SolidShot` projectiles in flight (posZ > 0 OR velX/Y > some threshold), emit a `cannonball-trail` puff every 3 ticks. Use a per-projectile counter — simplest is to gate by `tickCount % 3 === 0` (introduce a module-level counter or read `world.tickCount` if accessible, otherwise just use the projectile slot id as a coarse phase: `if ((world.tickCount + i) % 3 === 0) {...}`).

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -u src/puffs src/sim/systems/projectile-system.ts
git commit -m "feat(fx): dirt-skip puff + cannonball trail"
```

---

## Task 6: camera-shake + render integration

**Files:**
- Create: `src/render/camera-shake.ts`
- Create: `src/render/camera-shake.test.ts`
- Modify: `src/render/renderer.ts` (read shake; apply transient offset to projection)
- Modify: `src/fx/explosion.ts` (kick shake)

- [ ] **Step 1: Write failing test**

```ts
// src/render/camera-shake.test.ts
import { describe, it, expect } from 'vitest';
import { createCameraShake, kickShake, advanceShake, currentOffset, MAX_SHAKE } from './camera-shake';
import { createRng } from '../util/rng';

describe('cameraShake', () => {
  it('decays magnitude to zero over duration', () => {
    const s = createCameraShake();
    const rng = createRng(7);
    kickShake(s, 1.0, 0.5);
    let any = false;
    for (let i = 0; i < 30; i++) {
      const off = currentOffset(s, rng);
      if (Math.hypot(off.x, off.y) > 0.01) any = true;
      advanceShake(s, 1 / 60);
    }
    expect(any).toBe(true);
    const off = currentOffset(s, rng);
    expect(off.x).toBe(0);
    expect(off.y).toBe(0);
  });

  it('clamps magnitude at MAX_SHAKE', () => {
    const s = createCameraShake();
    kickShake(s, MAX_SHAKE * 5, 1);
    expect(s.magnitude).toBe(MAX_SHAKE);
  });

  it('repeated kicks do not reset duration backwards', () => {
    const s = createCameraShake();
    kickShake(s, 0.2, 1.0);
    advanceShake(s, 0.5);
    kickShake(s, 0.2, 0.3);                          // shorter than remaining
    expect(s.duration).toBeGreaterThanOrEqual(0.5);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- camera-shake`

- [ ] **Step 3: Implement**

```ts
// src/render/camera-shake.ts
import type { Rng } from '../util/rng';

export const MAX_SHAKE = 1.5;     // world units (meters)

export interface CameraShake {
  magnitude: number;
  duration: number;
  total: number;
}

export function createCameraShake(): CameraShake {
  return { magnitude: 0, duration: 0, total: 0 };
}

export function kickShake(s: CameraShake, magnitude: number, duration: number): void {
  s.magnitude = Math.min(MAX_SHAKE, s.magnitude + magnitude);
  s.duration = Math.max(s.duration, duration);
  s.total = Math.max(s.total, duration);
}

export function advanceShake(s: CameraShake, dt: number): void {
  if (s.duration <= 0) return;
  s.duration -= dt;
  if (s.duration <= 0) {
    s.duration = 0;
    s.magnitude = 0;
    s.total = 0;
  }
}

export function currentOffset(s: CameraShake, rng: Rng): { x: number; y: number } {
  if (s.duration <= 0 || s.total <= 0) return { x: 0, y: 0 };
  const t = s.duration / s.total;       // 1 → 0
  const amp = s.magnitude * t * t;
  return {
    x: (rng.next() * 2 - 1) * amp,
    y: (rng.next() * 2 - 1) * amp,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- camera-shake`

- [ ] **Step 5: Wire into renderer + spawnExplosion**

- Add a `cameraShake` field on the renderer (or a separate global owned by main loop). In the renderer's `draw()` method, after the camera matrix is computed, ADD `currentOffset(...)` to the camera center *for projection only*, then call `advanceShake(s, dt)` after the frame.
- Pass `cameraShake` through to `spawnExplosion` as a new optional arg, and call:
```ts
if (shake && camera) {
  const dist = Math.hypot(camera.center.x - x, camera.center.y - y);
  const mag = 0.4 * profile.damageRadius / Math.max(1, dist / 30);
  kickShake(shake, mag, 0.4);
}
```
**Decision point**: passing `camera` and `shake` through `spawnExplosion`'s call chain is invasive. Cleaner: have `spawnExplosion` push a "shake request" onto a queue (similar to `bloodSplats`), and have the render loop consume it. Add `shakeRequests` field on World. Each request: `{x, y, magnitude}`. Renderer reads them, computes per-camera attenuation, calls `kickShake`, clears the queue.

Implement the queue approach:

```ts
// src/sim/world.ts (add):
shakeRequests: { count: number; capacity: number; x: Float32Array; y: Float32Array; magnitude: Float32Array };
// initialize: { count: 0, capacity: 16, x: new Float32Array(16), y: new Float32Array(16), magnitude: new Float32Array(16) }
```

In `spawnExplosion`, push to that queue if available (add as new optional param). Renderer drains and calls `kickShake`. Reset queue each frame.

- [ ] **Step 6: Run all tests**

Run: `npm test`

- [ ] **Step 7: Commit**

```bash
git add -u src/render src/fx/explosion.ts src/sim/world.ts
git commit -m "feat(render): camera shake on explosions via request queue"
```

---

## Task 7: crater-stain pass + decal bake script

**Files:**
- Create: `src/sim/crater-splats.ts` (mirror `blood-splats.ts`)
- Create: `src/render/passes/crater-stain-pass.ts` (mirror `blood-stain-pass.ts`)
- Create: `scripts/draw-crater-stain.mjs`
- Create: `public/decals/crater-stain.png` (output of script)
- Modify: `src/render/renderer.ts` (wire pass)
- Modify: `src/sim/world.ts` (add `craterSplats`)
- Modify: `src/fx/explosion.ts` (push splat)

- [ ] **Step 1: Author the bake script**

```js
// scripts/draw-crater-stain.mjs
import { PNG } from 'pngjs';
import fs from 'node:fs';

const W = 256, H = 256;
const png = new PNG({ width: W, height: H });
const cx = W / 2, cy = H / 2;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - cx) / cx;
    const dy = (y - cy) / cy;
    const r = Math.hypot(dx, dy);
    let v = Math.max(0, 1 - r);          // soft falloff
    v = v * v;                            // sharpen toward edges
    // Splotchy noise (cheap deterministic)
    const n = (Math.sin(x * 0.27 + y * 0.31) + Math.sin(x * 0.13 - y * 0.41) + 2) / 4;
    v *= 0.65 + 0.35 * n;
    const a = Math.round(v * 255);
    const i = (y * W + x) * 4;
    png.data[i + 0] = 30;       // dark grey-brown char
    png.data[i + 1] = 25;
    png.data[i + 2] = 18;
    png.data[i + 3] = a;
  }
}
fs.mkdirSync('public/decals', { recursive: true });
png.pack().pipe(fs.createWriteStream('public/decals/crater-stain.png'));
console.log('wrote public/decals/crater-stain.png');
```

Run it once:
```bash
node scripts/draw-crater-stain.mjs
```

- [ ] **Step 2: Mirror blood-splats for crater**

```ts
// src/sim/crater-splats.ts — copy of blood-splats.ts API, renamed:
export interface CraterSplats {
  capacity: number;
  count: number;
  posX: Float32Array;
  posY: Float32Array;
  radius: Float32Array;
  intensity: Float32Array;
}
export function createCraterSplats(capacity: number): CraterSplats { /* same as blood */ }
export function pushCraterSplat(s: CraterSplats, x: number, y: number, radius: number, intensity: number): void { /* same */ }
export function clearCraterSplats(s: CraterSplats): void { s.count = 0; }
```

Add `craterSplats: createCraterSplats(256)` to World.

- [ ] **Step 3: Mirror blood-stain-pass for crater**

Read `src/render/passes/blood-stain-pass.ts` end-to-end first. Create `crater-stain-pass.ts` as a near-copy that:
- Loads `/decals/crater-stain.png` instead of synthesizing a circular splat brush.
- Uses an `RGBA8` (or `R8`) world-space stain texture, same dims as blood.
- `splat()` and `flush()` mirror blood's API.

Wire into the renderer alongside `bloodStain` and bind the texture in the terrain pass (terrain pass needs an additional sampler; if extending terrain shader is invasive, draw the crater pass directly to the screen between terrain and sprites — slightly different look but acceptable for v1).

- [ ] **Step 4: Push crater splat from spawnExplosion**

In `spawnExplosion`, after the embers loop:
```ts
if (craterSplats) {
  pushCraterSplat(craterSplats, x, y, profile.damageRadius * 0.7, 0.85);
}
```
Add `craterSplats` as a new optional param.

In the per-frame render path: call `craterStain.flush()` and `clearCraterSplats(world.craterSplats)` parallel to the blood pipeline.

- [ ] **Step 5: Run tests + smoke test**

Run: `npm test`. Then `npm run dev`, briefly load `lab.html`, fire a shell, confirm a darker mark remains on the ground.

- [ ] **Step 6: Commit**

```bash
git add scripts/draw-crater-stain.mjs public/decals/crater-stain.png src/sim/crater-splats.ts src/render/passes/crater-stain-pass.ts
git add -u src/render/renderer.ts src/sim/world.ts src/fx/explosion.ts
git commit -m "feat(fx): crater decal pass + stain stamp on explosion"
```

---

## Task 8: explosion gib bias

**Files:**
- Modify: `src/sim/systems/debris-emit.ts`
- Modify: `src/sim/systems/debris-emit.test.ts` (add explosion-bias tests)

- [ ] **Step 1: Write failing test**

```ts
// src/sim/systems/debris-emit.test.ts (add to existing file)
import { spawnGibs } from './debris-emit';
import { createDebris } from '../debris';
import { createRng } from '../../util/rng';

it('explosion HitKind biases gib count and Z velocity', () => {
  const d = createDebris(64);
  const rng = createRng(11);
  spawnGibs(d, rng, 'explosion', 0, 0, 1, 0, 0);
  let alive = 0;
  let totalZ = 0;
  for (let i = 0; i < d.capacity; i++) {
    if (d.alive[i]) {
      alive++;
      totalZ += d.velZ[i]!;
    }
  }
  expect(alive).toBeGreaterThanOrEqual(8);            // bias raises minimum
  expect(totalZ / alive).toBeGreaterThan(6);          // higher avg Z than baseline
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Update `planGibSpawn` and `spawnGibs`**

In `src/sim/systems/debris-emit.ts`, the explosion branch already produces 4–6 chunks + 4–8 meat blobs. Bump:

```ts
case 'cannon':
case 'explosion': {
  const chunks: number[] = [CHUNK_TORSO, CHUNK_HEAD, CHUNK_HAT];
  const arms = 1 + rng.intRange(0, 3);              // 1..3 (was 1..2)
  for (let i = 0; i < arms; i++) chunks.push(CHUNK_ARM);
  if (chunks.length < 8 && rng.next() < 0.7) chunks.push(CHUNK_LEG);
  if (chunks.length < 8 && rng.next() < 0.4) chunks.push(CHUNK_LEG);
  const bloodBlobs = (kind === 'explosion' ? 6 : 4) + rng.intRange(0, 6);
  return { chunks: chunks.slice(0, 8), bloodBlobs };
}
```

In `spawnGibs`, when `kind === 'explosion'`, override the Z kick:

```ts
const upZ =
  kind === 'explosion'
    ? (light ? rng.range(8, 12) : rng.range(5, 9))   // higher arc
    : (light ? rng.range(5, 8) : rng.range(3, 5));    // existing
```

And add a horizontal speed bonus for heavier chunks:

```ts
const speedBase = light ? 18 : 11;
const speedBonus = kind === 'explosion' && !light ? 1.3 : 1.0;
const speed = rng.range(0.7, 1.2) * speedBase * speedBonus;
```

- [ ] **Step 4: Run — expect PASS, plus existing tests stay green**

Run: `npm test -- debris-emit`

- [ ] **Step 5: Commit**

```bash
git add -u src/sim/systems/debris-emit.ts src/sim/systems/debris-emit.test.ts
git commit -m "feat(gibs): explosion bias — more chunks, higher Z, heavier outward"
```

---

## Task 9: canister profile + spawnCanister

**Files:**
- Create: `src/data/weapons/cannon-12-canister.ts`
- Create: `src/sim/canister.test.ts`
- Modify: `src/data/weapons/types.ts` (add `CanisterProfile`)
- Modify: `src/sim/projectiles.ts` (add `spawnCanister`)
- Modify: `src/util/rng.ts` (add `gaussian` if missing)

- [ ] **Step 1: Confirm or add `gaussian` in rng**

```bash
grep -n "gaussian" src/util/rng.ts
```

If missing, add Box-Muller:

```ts
// src/util/rng.ts (export)
export function gaussian(rng: Rng): number {
  // Standard Box-Muller; clamp to ±3 sigma to keep tails tame.
  let u1 = 0; while (u1 === 0) u1 = rng.next();
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(-3, Math.min(3, z));
}
```

- [ ] **Step 2: Write failing test**

```ts
// src/sim/canister.test.ts
import { describe, it, expect } from 'vitest';
import { createProjectiles, ProjectileKind } from './projectiles';
import { spawnCanister } from './projectiles';
import { cannon12Canister } from '../data/weapons/cannon-12-canister';
import { createRng } from '../util/rng';

describe('spawnCanister', () => {
  it('spawns ballCount projectiles in the cone', () => {
    const p = createProjectiles(64);
    const rng = createRng(3);
    spawnCanister(p, 0, 0, 1, 0, 0, cannon12Canister, -1, rng);
    let n = 0;
    let allMusket = true;
    let allInCone = true;
    const baseAngle = 0;
    const halfCone = (cannon12Canister.coneDeg * Math.PI / 180) / 2;
    for (let i = 0; i < p.capacity; i++) {
      if (!p.alive[i]) continue;
      n++;
      if (p.kind[i] !== ProjectileKind.Musket) allMusket = false;
      const a = Math.atan2(p.velY[i]!, p.velX[i]!);
      // Allow a generous margin since spreadSigma can produce tails up to 2σ
      if (Math.abs(a - baseAngle) > halfCone * 2.5) allInCone = false;
    }
    expect(n).toBe(cannon12Canister.ballCount);
    expect(allMusket).toBe(true);
    expect(allInCone).toBe(true);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npm test -- canister`

- [ ] **Step 4: Add `CanisterProfile` to types**

```ts
// src/data/weapons/types.ts (append)
import type { PuffProfile } from '../../puffs/profile';

export interface CanisterProfile {
  ballCount: number;
  coneDeg: number;
  spreadSigmaDeg: number;
  muzzleSpeed: number;
  speedJitter: number;
  ballDamage: number;
  ballMass: number;
  ballMaxLife: number;
  muzzleSmokeProfile: PuffProfile;
  muzzleSmokeProfileIdx: number;
  muzzleSmokeCount: number;
}
```

- [ ] **Step 5: Create canister profile**

```ts
// src/data/weapons/cannon-12-canister.ts
import type { CanisterProfile } from './types';
import { cannonSmokeProfile, CANNON_SMOKE_INDEX } from '../../puffs/profiles/cannon-smoke';

export const cannon12Canister: CanisterProfile = {
  ballCount: 24,
  coneDeg: 18,
  spreadSigmaDeg: 6,
  muzzleSpeed: 280,
  speedJitter: 0.1,
  ballDamage: 9,
  ballMass: 0.05,
  ballMaxLife: 0.4,
  muzzleSmokeProfile: cannonSmokeProfile,
  muzzleSmokeProfileIdx: CANNON_SMOKE_INDEX,
  muzzleSmokeCount: 30,
};
```

(Verify the exact import path / index name for the cannon-smoke profile via `grep -rn 'cannonSmoke\|CANNON_SMOKE' src/puffs/profiles/`.)

- [ ] **Step 6: Implement `spawnCanister`**

```ts
// src/sim/projectiles.ts (append)
import { gaussian } from '../util/rng';
import type { CanisterProfile } from '../data/weapons/types';

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
  const sigma = profile.spreadSigmaDeg * Math.PI / 180;
  for (let i = 0; i < profile.ballCount; i++) {
    const j = gaussian(rng) * sigma;
    const a = baseAngle + j;
    const sp = profile.muzzleSpeed * (1 + (rng.next() * 2 - 1) * profile.speedJitter);
    spawnMusketBall(
      p, ox, oy,
      Math.cos(a), Math.sin(a),
      team,
      profile.ballDamage,
      sp,
      profile.ballMass,
      profile.ballMaxLife,
      ownerId,
    );
  }
}
```

(`Rng` may need to be imported at top of file if not already.)

- [ ] **Step 7: Run — expect PASS**

Run: `npm test -- canister`

- [ ] **Step 8: Commit**

```bash
git add src/data/weapons/cannon-12-canister.ts src/sim/canister.test.ts
git add -u src/data/weapons/types.ts src/sim/projectiles.ts src/util/rng.ts
git commit -m "feat(weapons): canister shot — 24 musket-balls in 18° gaussian cone"
```

---

## Task 10: audio scaffold (silent by default)

**Files:**
- Create: `src/audio/sfx.ts`, `src/audio/manifest.ts`
- Modify: call sites — `src/fx/explosion.ts`, cannon-fire path (Task 11), `src/sim/systems/projectile-system.ts` ground skip

- [ ] **Step 1: Manifest**

```ts
// src/audio/manifest.ts
export interface SfxConfig {
  url: string;
  gain: number;
  falloffM: number;
}
export const MANIFEST: Record<string, SfxConfig> = {
  'shell-detonate': { url: '/audio/shell-detonate.wav', gain: 1.0, falloffM: 80 },
  'cannon-fire':    { url: '/audio/cannon-fire.wav',    gain: 1.0, falloffM: 100 },
  'canister-fire':  { url: '/audio/canister-fire.wav',  gain: 1.0, falloffM: 80 },
  'solid-skip':     { url: '/audio/solid-skip.wav',     gain: 0.7, falloffM: 50 },
};
```

- [ ] **Step 2: sfx.ts**

```ts
// src/audio/sfx.ts
import { MANIFEST } from './manifest';

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer | null>();
let loadStarted = false;

export function initSfx(): void {
  if (ctx) return;
  try { ctx = new AudioContext(); } catch { return; }
  if (!loadStarted) {
    loadStarted = true;
    for (const [name, cfg] of Object.entries(MANIFEST)) {
      void loadOne(name, cfg.url);
    }
  }
}

async function loadOne(name: string, url: string): Promise<void> {
  if (!ctx) return;
  try {
    const r = await fetch(url);
    if (!r.ok) { buffers.set(name, null); return; }
    const buf = await ctx.decodeAudioData(await r.arrayBuffer());
    buffers.set(name, buf);
  } catch {
    buffers.set(name, null);
  }
}

export interface SfxCamera { center: { x: number; y: number } }

export function playSfx(name: string, x: number, y: number, camera: SfxCamera): void {
  if (!ctx) return;
  const buf = buffers.get(name);
  if (!buf) return;
  const cfg = MANIFEST[name];
  if (!cfg) return;
  const dx = x - camera.center.x;
  const dy = y - camera.center.y;
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

- [ ] **Step 3: Wire init to first user gesture**

In `src/cannon-test/main.ts` (and `src/main.ts` and `src/lab/main.ts`), add:

```ts
import { initSfx } from '../audio/sfx';
window.addEventListener('pointerdown', initSfx, { once: true });
window.addEventListener('keydown', initSfx, { once: true });
```

- [ ] **Step 4: Add call sites**

The cleanest approach (mirroring camera-shake): a queue. But since SFX is purely presentational and unaffected by the sim, simpler to just call `playSfx` directly at the point of action. However, the sim layer doesn't have `camera` in scope.

Resolve: add a `playSfx` queue similar to `bloodSplats`/`shakeRequests`. Call sites push `{name, x, y}` records; render loop drains and calls `playSfx` with its camera.

```ts
// src/sim/world.ts (add):
sfxRequests: { count: number; capacity: number; name: string[]; x: Float32Array; y: Float32Array };
// init: { count: 0, capacity: 64, name: [], x: new Float32Array(64), y: new Float32Array(64) }
```

In `spawnExplosion`, push `{'shell-detonate', x, y}`.
In `projectile-system.ts` ground-skip branch, push `{'solid-skip', posX, posY}`.
Cannon and canister fire push from the cannon-test scene controller (Task 11).

Renderer drains `sfxRequests` each frame, calls `playSfx(name, x, y, camera)`, resets count to 0.

- [ ] **Step 5: Run tests**

Run: `npm test`
(No new tests for audio — relying on smoke testing in Task 12.)

- [ ] **Step 6: Commit**

```bash
git add src/audio
git add -u src/sim/world.ts src/fx/explosion.ts src/sim/systems/projectile-system.ts
git commit -m "feat(audio): silent-by-default sfx hook + sim-side request queue"
```

---

## Task 11: cannon-test page

**Files:**
- Create: `cannon-test.html`
- Create: `src/cannon-test/main.ts`, `src/cannon-test/scene.ts`, `src/cannon-test/hud.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: HTML entry**

```html
<!-- cannon-test.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Austerbitz — Cannon Test</title>
    <link rel="stylesheet" href="/src/cannon-test/cannon-test.css" />
  </head>
  <body>
    <canvas id="game"></canvas>
    <div id="ui-root"></div>
    <script type="module" src="/src/cannon-test/main.ts"></script>
  </body>
</html>
```

(Inline the same baseline CSS as `lab.html` if a separate CSS file is overkill — copy `<style>` block.)

- [ ] **Step 2: Register vite input**

```ts
// vite.config.ts (add to rollupOptions.input)
cannonTest: resolve(__dirname, 'cannon-test.html'),
```

- [ ] **Step 3: Scene builder**

```ts
// src/cannon-test/scene.ts
import { allocEntity, type Entities, EntityState } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';

const REGIMENT_COUNT = 60;
const RANK_COUNT = 3;
const RANK_SPACING = 1.2;
const FILE_SPACING = 1.0;

export function buildCannons(entities: Entities, x: number, y: number, count: number, team: number): number[] {
  const kindIdx = getUnitKindIndex('cannon-12');
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = allocEntity(entities);
    entities.posX[id] = x;
    entities.posY[id] = y + (i - (count - 1) / 2) * 4;
    entities.team[id] = team;
    entities.kindId[id] = kindIdx;
    entities.state[id] = EntityState.Standing;
    entities.facingX[id] = 1; entities.facingY[id] = 0;
    // (set hp / facing / other defaults per how main game initializes)
    ids.push(id);
  }
  return ids;
}

export function buildRegiment(entities: Entities, cx: number, cy: number, team: number): number[] {
  const kindIdx = getUnitKindIndex('line-infantry');
  const filesPerRank = Math.ceil(REGIMENT_COUNT / RANK_COUNT);
  const ids: number[] = [];
  for (let r = 0; r < RANK_COUNT; r++) {
    for (let f = 0; f < filesPerRank && ids.length < REGIMENT_COUNT; f++) {
      const id = allocEntity(entities);
      entities.posX[id] = cx + r * RANK_SPACING;
      entities.posY[id] = cy + (f - (filesPerRank - 1) / 2) * FILE_SPACING;
      entities.team[id] = team;
      entities.kindId[id] = kindIdx;
      entities.state[id] = EntityState.Standing;
      entities.facingX[id] = -1; entities.facingY[id] = 0;
      ids.push(id);
    }
  }
  return ids;
}
```

(Field names like `kindId`, `facingX` may differ — confirm via `Read src/sim/entities.ts` first.)

- [ ] **Step 4: HUD + hotkeys**

```ts
// src/cannon-test/hud.ts
export interface HudCallbacks {
  onFireSolid: () => void;
  onFireShell: () => void;
  onFireCanister: () => void;
  onReset: () => void;
  onTogglePause: () => void;
  onStepFrame: () => void;
  onElevation: (delta: number) => void;
  onToggleSlowMo: () => void;
  onToggleShake: () => void;
}

export function installHud(root: HTMLElement, cbs: HudCallbacks) {
  // Build an overlay with key legend + counters.
  // Wire window.addEventListener('keydown', ...) for hotkeys 1/2/3/R/Space/./[/].
  // Build right-side panel buttons mirroring lab.html style.
  // Update counters on each frame (return updateCounters(stats) function).
}
```

Concrete keymap:
```ts
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  switch (e.key) {
    case '1': cbs.onFireSolid(); break;
    case '2': cbs.onFireShell(); break;
    case '3': cbs.onFireCanister(); break;
    case 'r': case 'R': cbs.onReset(); break;
    case ' ': cbs.onTogglePause(); e.preventDefault(); break;
    case '.': cbs.onStepFrame(); break;
    case '[': cbs.onElevation(-5); break;
    case ']': cbs.onElevation(+5); break;
  }
});
```

- [ ] **Step 5: main.ts**

Mirror `src/lab/main.ts` structure — bring up world, renderer, particles, puffs, projectiles. Then:

```ts
// Pseudocode (full file mirrors lab/main.ts):
const world = createWorld({ seed: 1, capacity: 256, mapSize: 200 });
const cannonIds = buildCannons(world.entities, 60, 100, 3, 1);
const regimentIds = buildRegiment(world.entities, 180, 100, 0);

let paused = false;
let elevationDeg = 12;
let shakeOn = true;
let timeScale = 1;

const fireAllSolid = () => {
  for (const id of cannonIds) {
    // mirror lab/actions.ts actSolidShot, but target a fixed point ahead of regiment center
    fireSolidFromCannon(world, projectiles, particles, puffs, id, 180, 100);
    pushSfxRequest(world, 'cannon-fire', cannonX(id), cannonY(id));
  }
};
const fireAllShell = () => { /* ditto, using cannon12Shell + elevationDeg */ };
const fireAllCanister = () => {
  for (const id of cannonIds) {
    spawnCanister(projectiles, tip.x, tip.y, dirX, dirY, 1, cannon12Canister, id, world.rng);
    pushSfxRequest(world, 'canister-fire', tip.x, tip.y);
  }
};

const reset = () => {
  // free all projectiles, debris, particles, puffs (call clear/reset methods if they exist;
  // otherwise iterate alive arrays). Re-spawn regiment.
  for (const id of regimentIds) freeEntity(world.entities, id);
  buildRegiment(world.entities, 180, 100, 0);
};

installHud(uiRoot, {
  onFireSolid: fireAllSolid,
  onFireShell: fireAllShell,
  onFireCanister: fireAllCanister,
  onReset: reset,
  onTogglePause: () => { paused = !paused; },
  onStepFrame: () => { if (paused) tick(1/60); },
  onElevation: (d) => { elevationDeg = Math.max(0, Math.min(45, elevationDeg + d)); },
  onToggleSlowMo: () => { timeScale = timeScale === 1 ? 0.25 : 1; },
  onToggleShake: () => { shakeOn = !shakeOn; },
});

function tick(dt: number) {
  tickWorld(world, dt);
  tickProjectiles(world, projectiles, particles, puffs, dt);
  updateShockwaves(world.shockwaves, world.entities, world.grid, particles, world.rng,
                   world.bloodSplats, world.debris, dt);
  // ...other systems as in lab/main
}

function frame(now: number) {
  const dt = (1 / 60) * timeScale;
  if (!paused) tick(dt);
  renderer.draw(world, camera, particles, puffs, /* shakeOn flag */);
  drainSfxRequests(world.sfxRequests, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

(The `fireSolidFromCannon` and `fireShellFromCannon` helpers should follow the same shape as `lab/actions.ts:actSolidShot` and `actExplosiveShell` — copy or extract those into a shared `src/sim/cannon-fire.ts` if natural.)

Note: existing lab `actExplosiveShell` aims at a fixed `DUMMY_ROW_X/Y`; in cannon-test, target `(180, 100)` (regiment center) so all three cannons converge fire on the formation.

- [ ] **Step 6: Smoke test**

```bash
npm run dev
# Browse to http://localhost:5173/cannon-test.html
```

Verify: 3 cannons + regiment visible; press 1/2/3 fires; 1 = solid skipping through ranks; 2 = shell with ring/embers/crater/shake; 3 = canister cone of tracers; R resets.

- [ ] **Step 7: Commit**

```bash
git add cannon-test.html src/cannon-test
git add -u vite.config.ts
git commit -m "feat(cannon-test): sandbox page — 3 cannons vs regiment, ammo hotkeys"
```

---

## Task 12: Acceptance + cleanup

- [ ] **Step 1: Full test sweep**

```bash
npm test
npm run typecheck
```
Expected: all pass except pre-existing `wind.test.ts` failure.

- [ ] **Step 2: Manual acceptance against spec**

Walk through each acceptance criterion in `docs/superpowers/specs/2026-04-28-cannon-mechanics-design.md`:

1. Visit `/cannon-test.html` — sandbox loads.
2. All hotkeys behave per spec.
3. Solid shot → dirt puffs on every skip; trail puffs in flight.
4. Shell → expanding ring, embers ~1s, crater persists, camera shakes; damage delivered over a couple of frames.
5. Canister → ~24 tracers in cone; deadly close-range, harmless past ~110m.
6. New tests + existing tests pass.

Note any deviations as follow-up issues.

- [ ] **Step 3: Final commit if anything tweaked**

```bash
git add -u
git commit -m "chore(cannon-test): acceptance pass tweaks" || echo "nothing to commit"
```

---

## Self-Review Checklist (run mentally before handing off)

- [ ] Every spec section maps to ≥1 task: cannon-test ✓ (T11), solid skip ✓ (T5), shell shockwave ✓ (T1-T3), rings/embers ✓ (T3, T4), crater ✓ (T7), shake ✓ (T6), gib bias ✓ (T8), canister ✓ (T9), audio hook ✓ (T10).
- [ ] No "TBD" / placeholder text in any task.
- [ ] Type names consistent: `Shockwaves`, `CameraShake`, `CanisterProfile`, `CraterSplats` used identically across tasks.
- [ ] Function names consistent: `spawnExplosion`, `updateShockwaves`, `kickShake`, `currentOffset`, `spawnCanister`, `playSfx`.
- [ ] Test commands all use `npm test` / `npm test -- <file>`.
- [ ] Each task's commit messages are scoped (one logical change per commit).

---

## Out-of-scope (do NOT do in this plan)

- Chain reactions / powder kegs.
- Cover & line-of-sight occlusion.
- Audio assets / 3D positional / mixer.
- Slope, water, destructible terrain.
- New gib chunk shapes.
