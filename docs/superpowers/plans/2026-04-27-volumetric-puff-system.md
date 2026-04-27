# Volumetric Puff System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified, profile-driven puff pool for soft volumetric effects (marching dust, muzzle smoke, cannonball trails, explosion billows, ambient clouds), replacing scattered emitter code in `src/particles/emitters.ts` and `src/fx/explosion.ts`.

**Architecture:** New SoA pool `Puffs` under `src/puffs/`, parallel to the existing `Particles` pool. Six data-only profiles drive every variety. A new render pass (`puff-pass`) draws each puff as an instanced quad with a soft radial falloff. Sparks (flash, blood, debris, ricochet, impact-dust) keep using the existing `Particles` pool — no migration there.

**Tech Stack:** TypeScript, WebGL2 (no shader frameworks), Vitest for tests, no external deps.

**Spec:** `docs/superpowers/specs/2026-04-27-volumetric-puff-system-design.md`

---

## File Structure

```
src/puffs/                            # NEW
  profile.ts                          # PuffProfile type + registry
  puffs.ts                            # SoA pool + updatePuffs
  coalesce.ts                         # frame-scoped spatial hash + merge
  emit.ts                             # emitPuff + emitPuffBurst
  emit-dust.ts                        # per-soldier dust emission (replaces emitDust)
  ambient-clouds.ts                   # sky-cloud spawner
  wind.ts                             # applyWindToPuffs
  profiles/
    dust.ts
    musket-smoke.ts
    cannon-smoke.ts
    shell-billow.ts
    cannonball-trail.ts
    cloud.ts
  index.ts                            # re-exports for callers

src/render/shaders/puff.glsl.ts       # NEW — VS/FS strings
src/render/passes/puff-pass.ts        # NEW — instanced soft-disc pass

# Modified
src/render/renderer.ts                # add puff pass + draw call
src/main.ts                           # create pool, tick, ambient clouds, wind
src/lab/main.ts                       # same wiring (lab harness)
src/lab/wind.ts                       # apply wind to puffs (drop particle path)
src/sim/fire-resolver.ts              # emitMuzzleFx → flash-only + emitPuffBurst
src/lab/actions.ts                    # same swap as fire-resolver
src/sim/systems/projectile-system.ts  # emitCannonballTrail → emitPuff
src/fx/explosion.ts                   # smoke billow → emitPuffBurst
src/particles/emitters.ts             # remove emitDust + emitCannonballTrail; trim emitMuzzleFx to flash-only
src/data/weapons/types.ts             # MuzzleProfile.smoke + ExplosionProfile.smokeBillow shape
src/data/weapons/musket.ts            # update smoke section to new shape
src/data/weapons/cannon-12-solid.ts   # same
src/data/weapons/cannon-12-shell.ts   # same

# Test files (new + updated)
src/puffs/profile.test.ts
src/puffs/puffs.test.ts
src/puffs/coalesce.test.ts
src/puffs/emit.test.ts
src/puffs/emit-dust.test.ts
src/puffs/ambient-clouds.test.ts
src/puffs/wind.test.ts
src/particles/emitters.test.ts        # drop dust + trail blocks
src/lab/wind.test.ts                  # update to puff path
```

Each task below produces self-contained changes — types defined before use, tests written first, commits frequent.

---

## Task 1: Profile registry

**Files:**
- Create: `src/puffs/profile.ts`
- Test: `src/puffs/profile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/puffs/profile.test.ts
import { describe, it, expect } from 'vitest';
import { registerProfile, getProfileByIndex, type PuffProfile } from './profile';

const sample: PuffProfile = {
  id: 'sample',
  sizeStart: { min: 0.5, max: 1.0 },
  life: { min: 1, max: 2 },
  velScale: 1, velJitter: 0,
  edgeGrowth: 0.5, sizeMax: 2.0,
  drag: 0.99, buoyancy: 0,
  inertiaExp: 2, inertiaWeight: 0.3,
  color: [0.5, 0.5, 0.5], colorJitter: 0,
  alpha: 1.0, softness: 0.8,
  coalesce: null,
};

describe('profile registry', () => {
  it('assigns a non-negative index and round-trips', () => {
    const idx = registerProfile(sample);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(getProfileByIndex(idx)).toBe(sample);
  });

  it('idempotently returns the same index for the same id', () => {
    const a = registerProfile(sample);
    const b = registerProfile(sample);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/puffs/profile.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/puffs/profile.ts
import type { Color3 } from '../data/weapons/types';

export interface PuffProfile {
  id: string;
  sizeStart: { min: number; max: number };
  life: { min: number; max: number };
  velScale: number;
  velJitter: number;
  edgeGrowth: number;
  sizeMax: number;
  drag: number;
  buoyancy: number;
  inertiaExp: number;
  inertiaWeight: number;
  color: Color3;
  colorJitter: number;
  alpha: number;
  softness: number;
  coalesce: null | {
    radius: number;
    sizePerMerge: number;
    lifePerMerge: number;
    posBlend: number;
    mergeChance: number;
  };
}

const registry: PuffProfile[] = [];
const idToIndex = new Map<string, number>();

export function registerProfile(p: PuffProfile): number {
  const existing = idToIndex.get(p.id);
  if (existing !== undefined) return existing;
  const idx = registry.length;
  idToIndex.set(p.id, idx);
  registry.push(p);
  return idx;
}

export function getProfileByIndex(idx: number): PuffProfile {
  const p = registry[idx];
  if (p === undefined) throw new Error(`unknown puff profile index ${idx}`);
  return p;
}

export function profileCount(): number {
  return registry.length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/puffs/profile.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/puffs/profile.ts src/puffs/profile.test.ts
git commit -m "feat(puffs): profile type and registry"
```

---

## Task 2: Pool struct + lifecycle (alloc, free, life decay)

**Files:**
- Create: `src/puffs/puffs.ts`
- Test: `src/puffs/puffs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/puffs/puffs.test.ts
import { describe, it, expect } from 'vitest';
import { createPuffs, allocPuff, updatePuffs } from './puffs';

describe('puffs pool', () => {
  it('alloc returns a slot and increments count', () => {
    const p = createPuffs(8);
    const i = allocPuff(p);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(p.count).toBe(1);
    expect(p.alive[i]).toBe(1);
  });

  it('returns -1 when full', () => {
    const p = createPuffs(2);
    allocPuff(p); allocPuff(p);
    expect(allocPuff(p)).toBe(-1);
  });

  it('life decays and slot frees on expiry', () => {
    const p = createPuffs(4);
    const i = allocPuff(p);
    p.life[i] = 0.05; p.lifeMax[i] = 0.05;
    p.size[i] = 1; p.sizeMax[i] = 2; p.edgeGrowth[i] = 0;
    p.drag[i] = 1; p.inertiaWeight[i] = 0;
    updatePuffs(p, 0.1);
    expect(p.alive[i]).toBe(0);
    expect(p.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/puffs/puffs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement pool and update loop**

```ts
// src/puffs/puffs.ts
export interface Puffs {
  capacity: number;
  count: number;
  alive: Uint8Array;
  profileIdx: Uint16Array;
  posX: Float32Array; posY: Float32Array;
  velX: Float32Array; velY: Float32Array;
  life: Float32Array; lifeMax: Float32Array;
  size: Float32Array; sizeMax: Float32Array; edgeGrowth: Float32Array;
  drag: Float32Array; buoyancy: Float32Array;
  inertiaExp: Float32Array; inertiaWeight: Float32Array;
  r: Float32Array; g: Float32Array; b: Float32Array;
  alpha: Float32Array; softness: Float32Array;
}

export function createPuffs(capacity: number): Puffs {
  return {
    capacity, count: 0,
    alive: new Uint8Array(capacity),
    profileIdx: new Uint16Array(capacity),
    posX: new Float32Array(capacity), posY: new Float32Array(capacity),
    velX: new Float32Array(capacity), velY: new Float32Array(capacity),
    life: new Float32Array(capacity), lifeMax: new Float32Array(capacity),
    size: new Float32Array(capacity), sizeMax: new Float32Array(capacity), edgeGrowth: new Float32Array(capacity),
    drag: new Float32Array(capacity), buoyancy: new Float32Array(capacity),
    inertiaExp: new Float32Array(capacity), inertiaWeight: new Float32Array(capacity),
    r: new Float32Array(capacity), g: new Float32Array(capacity), b: new Float32Array(capacity),
    alpha: new Float32Array(capacity), softness: new Float32Array(capacity),
  };
}

export function allocPuff(p: Puffs): number {
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) {
      p.alive[i] = 1;
      p.count++;
      return i;
    }
  }
  return -1;
}

export function updatePuffs(p: Puffs, dt: number): void {
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    p.life[i]! -= dt;
    if (p.life[i]! <= 0) {
      p.alive[i] = 0;
      p.count--;
      continue;
    }
    const sm = p.sizeMax[i]!;
    const sizeFrac = sm > 0 ? p.size[i]! / sm : 0;
    const sizeDamp = 1 - p.inertiaWeight[i]! * Math.pow(sizeFrac, p.inertiaExp[i]!);
    const tickMul = p.drag[i]! * sizeDamp;
    p.velX[i]! *= tickMul;
    p.velY[i]! *= tickMul;
    p.velY[i]! += p.buoyancy[i]! * dt;
    const grown = p.size[i]! + p.edgeGrowth[i]! * dt;
    p.size[i] = grown > sm ? sm : grown;
    p.posX[i]! += p.velX[i]! * dt;
    p.posY[i]! += p.velY[i]! * dt;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/puffs/puffs.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/puffs/puffs.ts src/puffs/puffs.test.ts
git commit -m "feat(puffs): SoA pool with life decay update loop"
```

---

## Task 3: Update loop — additive edge growth + size-damped drag

**Files:**
- Test: `src/puffs/puffs.test.ts` (append)

- [ ] **Step 1: Write failing tests for growth and drag**

Append to `src/puffs/puffs.test.ts`:

```ts
describe('updatePuffs growth and drag', () => {
  it('size grows additively (not multiplicatively) at edgeGrowth m/s', () => {
    const p = createPuffs(2);
    const i = allocPuff(p);
    p.life[i] = 10; p.lifeMax[i] = 10;
    p.size[i] = 1.0; p.sizeMax[i] = 5.0; p.edgeGrowth[i] = 0.5;
    p.drag[i] = 1; p.inertiaWeight[i] = 0; p.inertiaExp[i] = 1;
    updatePuffs(p, 1.0);
    expect(p.size[i]).toBeCloseTo(1.5, 5);
    updatePuffs(p, 1.0);
    expect(p.size[i]).toBeCloseTo(2.0, 5);
  });

  it('size growth is clamped at sizeMax', () => {
    const p = createPuffs(2);
    const i = allocPuff(p);
    p.life[i] = 10; p.lifeMax[i] = 10;
    p.size[i] = 4.5; p.sizeMax[i] = 5.0; p.edgeGrowth[i] = 10.0;
    p.drag[i] = 1;
    updatePuffs(p, 1.0);
    expect(p.size[i]).toBe(5.0);
  });

  it('larger puffs experience more drag (size-damped)', () => {
    const p = createPuffs(2);
    const small = allocPuff(p);
    p.life[small] = 10; p.lifeMax[small] = 10;
    p.size[small] = 0.1; p.sizeMax[small] = 4.0;
    p.velX[small] = 10; p.velY[small] = 0;
    p.drag[small] = 1.0;
    p.inertiaWeight[small] = 0.5; p.inertiaExp[small] = 2;
    p.edgeGrowth[small] = 0;

    const big = allocPuff(p);
    p.life[big] = 10; p.lifeMax[big] = 10;
    p.size[big] = 4.0; p.sizeMax[big] = 4.0;
    p.velX[big] = 10; p.velY[big] = 0;
    p.drag[big] = 1.0;
    p.inertiaWeight[big] = 0.5; p.inertiaExp[big] = 2;
    p.edgeGrowth[big] = 0;

    updatePuffs(p, 1.0);
    // small: drag = 1.0 * (1 - 0.5 * (0.025)^2) ≈ ~0.9997  → vel ≈ 9.997
    // big:   drag = 1.0 * (1 - 0.5 * 1) = 0.5             → vel = 5.0
    expect(p.velX[small]!).toBeGreaterThan(9.9);
    expect(p.velX[big]!).toBe(5.0);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/puffs/puffs.test.ts`
Expected: PASS — 6 tests total. (Implementation from Task 2 already covers this; this task asserts the contract.)

- [ ] **Step 3: Commit**

```bash
git add src/puffs/puffs.test.ts
git commit -m "test(puffs): additive edge growth and size-damped drag"
```

---

## Task 4: Coalescence — same-profile spatial hash and merge

**Files:**
- Create: `src/puffs/coalesce.ts`
- Test: `src/puffs/coalesce.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/puffs/coalesce.test.ts
import { describe, it, expect } from 'vitest';
import { createPuffs, allocPuff } from './puffs';
import { registerProfile, type PuffProfile } from './profile';
import { buildCoalesceGrid, tryMergeOrSpawn } from './coalesce';
import { createRng } from '../util/rng';

const A: PuffProfile = {
  id: 'a',
  sizeStart: { min: 1, max: 1 }, life: { min: 4, max: 4 },
  velScale: 0, velJitter: 0,
  edgeGrowth: 0, sizeMax: 4,
  drag: 1, buoyancy: 0, inertiaExp: 1, inertiaWeight: 0,
  color: [1, 1, 1], colorJitter: 0, alpha: 1, softness: 0.8,
  coalesce: { radius: 1.5, sizePerMerge: 0.1, lifePerMerge: 0.5, posBlend: 0.3, mergeChance: 1.0 },
};
const B: PuffProfile = { ...A, id: 'b', coalesce: { ...A.coalesce!, mergeChance: 1.0 } };
const aIdx = registerProfile(A);
const bIdx = registerProfile(B);

function seedPuff(p: ReturnType<typeof createPuffs>, profileIdx: number, x: number, y: number) {
  const i = allocPuff(p);
  p.profileIdx[i] = profileIdx;
  p.posX[i] = x; p.posY[i] = y;
  p.size[i] = 1; p.sizeMax[i] = 4;
  p.life[i] = 4; p.lifeMax[i] = 4;
  return i;
}

describe('coalesce', () => {
  it('merges nearby same-profile puffs (size and life accrete)', () => {
    const p = createPuffs(8);
    const i = seedPuff(p, aIdx, 10, 10);
    const grid = buildCoalesceGrid(p);
    const rng = createRng(1);
    const result = tryMergeOrSpawn(p, grid, A, aIdx, 10.5, 10.0, rng);
    expect(result.merged).toBe(true);
    expect(result.idx).toBe(i);
    expect(p.size[i]).toBeCloseTo(1.1, 5);
    expect(p.life[i]).toBeCloseTo(4.5, 5);
  });

  it('does not merge across different profiles', () => {
    const p = createPuffs(8);
    seedPuff(p, aIdx, 10, 10);
    const grid = buildCoalesceGrid(p);
    const rng = createRng(2);
    const result = tryMergeOrSpawn(p, grid, B, bIdx, 10.0, 10.0, rng);
    expect(result.merged).toBe(false);
  });

  it('mergeChance < 1 makes some emissions skip the merge', () => {
    const p = createPuffs(64);
    seedPuff(p, aIdx, 10, 10);
    // Profile with mergeChance = 0 should never merge.
    const C: PuffProfile = { ...A, id: 'c', coalesce: { ...A.coalesce!, mergeChance: 0 } };
    const cIdx = registerProfile(C);
    seedPuff(p, cIdx, 10, 10);
    const grid = buildCoalesceGrid(p);
    const rng = createRng(3);
    const result = tryMergeOrSpawn(p, grid, C, cIdx, 10.0, 10.0, rng);
    expect(result.merged).toBe(false);
  });

  it('skips puffs already saturated (size and life at max)', () => {
    const p = createPuffs(8);
    const i = seedPuff(p, aIdx, 10, 10);
    p.size[i] = 4; p.sizeMax[i] = 4; p.life[i] = 4; p.lifeMax[i] = 4;
    const grid = buildCoalesceGrid(p);
    const rng = createRng(4);
    const result = tryMergeOrSpawn(p, grid, A, aIdx, 10.0, 10.0, rng);
    expect(result.merged).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/puffs/coalesce.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement coalescence**

```ts
// src/puffs/coalesce.ts
import type { Puffs } from './puffs';
import type { PuffProfile } from './profile';
import type { Rng } from '../util/rng';

export type CoalesceGrid = Map<number, number[]>;

function key(profileIdx: number, cx: number, cy: number): number {
  // Hash with profileIdx mixed in so different profiles never collide.
  return ((profileIdx * 2654435761) ^ (cx * 73856093) ^ (cy * 19349663)) >>> 0;
}

export function buildCoalesceGrid(p: Puffs): CoalesceGrid {
  // Cell size is profile-specific. We bucket by a coarse cell of size 1m and
  // let the per-profile radius lookup handle the actual radius check.
  const grid: CoalesceGrid = new Map();
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    const cx = Math.floor(p.posX[i]!);
    const cy = Math.floor(p.posY[i]!);
    const k = key(p.profileIdx[i]!, cx, cy);
    let bucket = grid.get(k);
    if (bucket === undefined) { bucket = []; grid.set(k, bucket); }
    bucket.push(i);
  }
  return grid;
}

export interface MergeResult {
  merged: boolean;
  idx: number;
}

export function tryMergeOrSpawn(
  p: Puffs,
  grid: CoalesceGrid,
  profile: PuffProfile,
  profileIdx: number,
  x: number, y: number,
  rng: Rng,
): MergeResult {
  if (profile.coalesce === null) return { merged: false, idx: -1 };
  const c = profile.coalesce;

  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cells = Math.max(1, Math.ceil(c.radius));
  let bestIdx = -1;
  let bestSq = c.radius * c.radius;
  for (let dy = -cells; dy <= cells; dy++) {
    for (let dx = -cells; dx <= cells; dx++) {
      const bucket = grid.get(key(profileIdx, cx + dx, cy + dy));
      if (bucket === undefined) continue;
      for (let b = 0; b < bucket.length; b++) {
        const idx = bucket[b]!;
        // Skip saturated puffs.
        if (p.size[idx]! >= p.sizeMax[idx]! - 1e-6 &&
            p.life[idx]! >= p.lifeMax[idx]! - 1e-6) continue;
        const ddx = p.posX[idx]! - x;
        const ddy = p.posY[idx]! - y;
        const dsq = ddx * ddx + ddy * ddy;
        if (dsq < bestSq) { bestSq = dsq; bestIdx = idx; }
      }
    }
  }

  if (bestIdx === -1) return { merged: false, idx: -1 };
  if (rng.next() >= c.mergeChance) return { merged: false, idx: -1 };

  const sm = p.sizeMax[bestIdx]!;
  const newSize = p.size[bestIdx]! + c.sizePerMerge;
  p.size[bestIdx] = newSize > sm ? sm : newSize;

  const lm = p.lifeMax[bestIdx]!;
  const newLife = p.life[bestIdx]! + c.lifePerMerge;
  p.life[bestIdx] = newLife > lm ? lm : newLife;

  p.posX[bestIdx] = p.posX[bestIdx]! * (1 - c.posBlend) + x * c.posBlend;
  p.posY[bestIdx] = p.posY[bestIdx]! * (1 - c.posBlend) + y * c.posBlend;

  return { merged: true, idx: bestIdx };
}

export function gridInsert(grid: CoalesceGrid, p: Puffs, idx: number): void {
  const cx = Math.floor(p.posX[idx]!);
  const cy = Math.floor(p.posY[idx]!);
  const k = key(p.profileIdx[idx]!, cx, cy);
  let bucket = grid.get(k);
  if (bucket === undefined) { bucket = []; grid.set(k, bucket); }
  bucket.push(idx);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/puffs/coalesce.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/puffs/coalesce.ts src/puffs/coalesce.test.ts
git commit -m "feat(puffs): per-profile spatial-hash coalescence"
```

---

## Task 5: emitPuff + emitPuffBurst

**Files:**
- Create: `src/puffs/emit.ts`
- Test: `src/puffs/emit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/puffs/emit.test.ts
import { describe, it, expect } from 'vitest';
import { createPuffs } from './puffs';
import { registerProfile, type PuffProfile } from './profile';
import { emitPuff, emitPuffBurst } from './emit';
import { createRng } from '../util/rng';

const P: PuffProfile = {
  id: 'emit-test',
  sizeStart: { min: 0.4, max: 0.6 },
  life: { min: 1.0, max: 2.0 },
  velScale: 0.5, velJitter: 0.1,
  edgeGrowth: 0.3, sizeMax: 2.0,
  drag: 0.99, buoyancy: -0.2,
  inertiaExp: 2, inertiaWeight: 0.3,
  color: [0.5, 0.6, 0.7], colorJitter: 0.05,
  alpha: 0.8, softness: 0.85,
  coalesce: null,
};
const idx = registerProfile(P);

describe('emitPuff', () => {
  it('writes profile values to the chosen slot', () => {
    const p = createPuffs(4);
    const rng = createRng(1);
    const i = emitPuff(p, P, idx, 100, 200, 5, 0, rng);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(p.alive[i]).toBe(1);
    expect(p.profileIdx[i]).toBe(idx);
    expect(p.size[i]!).toBeGreaterThanOrEqual(0.4);
    expect(p.size[i]!).toBeLessThanOrEqual(0.6);
    expect(p.life[i]!).toBeGreaterThanOrEqual(1.0);
    expect(p.life[i]!).toBeLessThanOrEqual(2.0);
    expect(p.lifeMax[i]).toBe(p.life[i]);
    expect(p.sizeMax[i]).toBe(2.0);
    expect(p.edgeGrowth[i]).toBe(0.3);
    expect(p.drag[i]).toBe(0.99);
    expect(p.buoyancy[i]).toBe(-0.2);
    expect(p.inertiaExp[i]).toBe(2);
    expect(p.inertiaWeight[i]).toBe(0.3);
    expect(p.alpha[i]).toBe(0.8);
    expect(p.softness[i]).toBe(0.85);
    expect(p.posX[i]).toBe(100);
    expect(p.posY[i]).toBe(200);
    // velocity = (vx*scale ± jitter)
    expect(p.velX[i]!).toBeGreaterThanOrEqual(5 * 0.5 - 0.1);
    expect(p.velX[i]!).toBeLessThanOrEqual(5 * 0.5 + 0.1);
  });

  it('color jitter stays within bounds', () => {
    const p = createPuffs(32);
    const rng = createRng(7);
    for (let n = 0; n < 16; n++) {
      const i = emitPuff(p, P, idx, 0, 0, 0, 0, rng);
      expect(p.r[i]!).toBeGreaterThanOrEqual(0.5 - 0.05);
      expect(p.r[i]!).toBeLessThanOrEqual(0.5 + 0.05);
      expect(p.g[i]!).toBeGreaterThanOrEqual(0.6 - 0.05);
      expect(p.g[i]!).toBeLessThanOrEqual(0.6 + 0.05);
      expect(p.b[i]!).toBeGreaterThanOrEqual(0.7 - 0.05);
      expect(p.b[i]!).toBeLessThanOrEqual(0.7 + 0.05);
    }
  });
});

describe('emitPuffBurst', () => {
  it('emits the requested count within the cone', () => {
    const p = createPuffs(64);
    const rng = createRng(11);
    emitPuffBurst(p, P, idx, 0, 0, 1, 0, 10, 0.4, { min: 4, max: 6 }, rng);
    let n = 0;
    for (let i = 0; i < p.capacity; i++) if (p.alive[i] === 1) n++;
    expect(n).toBe(10);
    // All velocities should have positive x component (forward cone, dir = (1,0)).
    let sumVx = 0;
    for (let i = 0; i < p.capacity; i++) if (p.alive[i] === 1) sumVx += p.velX[i]!;
    expect(sumVx / 10).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/puffs/emit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement emit functions**

```ts
// src/puffs/emit.ts
import type { Puffs } from './puffs';
import { allocPuff } from './puffs';
import type { PuffProfile } from './profile';
import type { Rng } from '../util/rng';
import { tryMergeOrSpawn, gridInsert, type CoalesceGrid } from './coalesce';

function jitter(rng: Rng, amt: number): number {
  return amt > 0 ? rng.range(-amt, amt) : 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function writeProfile(
  p: Puffs, i: number, profile: PuffProfile, profileIdx: number,
  x: number, y: number, vx: number, vy: number, rng: Rng,
): void {
  p.profileIdx[i] = profileIdx;
  p.posX[i] = x; p.posY[i] = y;
  p.velX[i] = vx * profile.velScale + jitter(rng, profile.velJitter);
  p.velY[i] = vy * profile.velScale + jitter(rng, profile.velJitter);
  const life = rng.range(profile.life.min, profile.life.max);
  p.life[i] = life; p.lifeMax[i] = life;
  p.size[i] = rng.range(profile.sizeStart.min, profile.sizeStart.max);
  p.sizeMax[i] = profile.sizeMax;
  p.edgeGrowth[i] = profile.edgeGrowth;
  p.drag[i] = profile.drag;
  p.buoyancy[i] = profile.buoyancy;
  p.inertiaExp[i] = profile.inertiaExp;
  p.inertiaWeight[i] = profile.inertiaWeight;
  p.r[i] = clamp01(profile.color[0] + jitter(rng, profile.colorJitter));
  p.g[i] = clamp01(profile.color[1] + jitter(rng, profile.colorJitter));
  p.b[i] = clamp01(profile.color[2] + jitter(rng, profile.colorJitter));
  p.alpha[i] = profile.alpha;
  p.softness[i] = profile.softness;
}

/** Emit a single puff. No coalescence (use emitPuffWithCoalesce for that). */
export function emitPuff(
  p: Puffs, profile: PuffProfile, profileIdx: number,
  x: number, y: number, vx: number, vy: number, rng: Rng,
): number {
  const i = allocPuff(p);
  if (i === -1) return -1;
  writeProfile(p, i, profile, profileIdx, x, y, vx, vy, rng);
  return i;
}

/** Emit a single puff, attempting to merge into a nearby same-profile puff
 *  via the supplied per-frame grid. Inserts the new puff into the grid on
 *  fresh spawn so subsequent emissions in the same frame can coalesce. */
export function emitPuffWithCoalesce(
  p: Puffs, profile: PuffProfile, profileIdx: number,
  x: number, y: number, vx: number, vy: number,
  grid: CoalesceGrid, rng: Rng,
): number {
  const merged = tryMergeOrSpawn(p, grid, profile, profileIdx, x, y, rng);
  if (merged.merged) return merged.idx;
  const i = emitPuff(p, profile, profileIdx, x, y, vx, vy, rng);
  if (i !== -1) gridInsert(grid, p, i);
  return i;
}

/** Spawn `count` puffs in a forward cone around (dirX, dirY). Used by
 *  muzzle smoke and explosion billows. No coalescence (each burst is one
 *  emission event; coalescence is meant for streams like marching dust). */
export function emitPuffBurst(
  p: Puffs, profile: PuffProfile, profileIdx: number,
  x: number, y: number, dirX: number, dirY: number,
  count: number, coneAngle: number,
  speed: { min: number; max: number },
  rng: Rng,
): void {
  const theta = Math.atan2(dirY, dirX);
  const half = coneAngle * 0.5;
  for (let n = 0; n < count; n++) {
    const a = theta + rng.range(-half, half);
    const s = rng.range(speed.min, speed.max);
    const vx = Math.cos(a) * s;
    const vy = Math.sin(a) * s;
    emitPuff(p, profile, profileIdx, x, y, vx, vy, rng);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/puffs/emit.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/puffs/emit.ts src/puffs/emit.test.ts
git commit -m "feat(puffs): emitPuff, emitPuffBurst, emitPuffWithCoalesce"
```

---

## Task 6: Profile data files

**Files:**
- Create: `src/puffs/profiles/dust.ts`, `musket-smoke.ts`, `cannon-smoke.ts`, `shell-billow.ts`, `cannonball-trail.ts`, `cloud.ts`
- Create: `src/puffs/index.ts`

These are pure data — no test required beyond the type-check that registration succeeds at module import.

- [ ] **Step 1: Write the profile files**

```ts
// src/puffs/profiles/dust.ts
import { registerProfile, type PuffProfile } from '../profile';

export const DUST: PuffProfile = {
  id: 'dust',
  sizeStart: { min: 0.6, max: 1.0 },
  life: { min: 3.5, max: 6.0 },
  velScale: 1.0, velJitter: 0.3,
  edgeGrowth: 0.6, sizeMax: 4.0,
  drag: 0.985, buoyancy: -0.1,
  inertiaExp: 2, inertiaWeight: 0.25,
  color: [0.30, 0.30, 0.34], colorJitter: 0.03,
  alpha: 0.75, softness: 0.6,
  coalesce: { radius: 0.9, sizePerMerge: 0.05, lifePerMerge: 0.3, posBlend: 0.3, mergeChance: 0.7 },
};

export const DUST_INDEX = registerProfile(DUST);
```

```ts
// src/puffs/profiles/musket-smoke.ts
import { registerProfile, type PuffProfile } from '../profile';

export const MUSKET_SMOKE: PuffProfile = {
  id: 'musket-smoke',
  sizeStart: { min: 0.25, max: 0.40 },
  life: { min: 0.9, max: 1.6 },
  velScale: 1.0, velJitter: 0.2,
  edgeGrowth: 0.7, sizeMax: 1.6,
  drag: 0.97, buoyancy: -0.4,
  inertiaExp: 2, inertiaWeight: 0.15,
  color: [0.86, 0.84, 0.82], colorJitter: 0.02,
  alpha: 0.9, softness: 0.9,
  coalesce: null,
};

export const MUSKET_SMOKE_INDEX = registerProfile(MUSKET_SMOKE);
```

```ts
// src/puffs/profiles/cannon-smoke.ts
import { registerProfile, type PuffProfile } from '../profile';

export const CANNON_SMOKE: PuffProfile = {
  id: 'cannon-smoke',
  sizeStart: { min: 1.0, max: 1.5 },
  life: { min: 2.5, max: 4.0 },
  velScale: 1.0, velJitter: 0.5,
  edgeGrowth: 1.2, sizeMax: 4.5,
  drag: 0.985, buoyancy: -0.6,
  inertiaExp: 2, inertiaWeight: 0.30,
  color: [0.78, 0.80, 0.84], colorJitter: 0.03,
  alpha: 0.9, softness: 0.85,
  coalesce: { radius: 1.2, sizePerMerge: 0.15, lifePerMerge: 0.5, posBlend: 0.2, mergeChance: 0.6 },
};

export const CANNON_SMOKE_INDEX = registerProfile(CANNON_SMOKE);
```

```ts
// src/puffs/profiles/shell-billow.ts
import { registerProfile, type PuffProfile } from '../profile';

export const SHELL_BILLOW: PuffProfile = {
  id: 'shell-billow',
  sizeStart: { min: 1.2, max: 1.8 },
  life: { min: 2.5, max: 5.0 },
  velScale: 1.0, velJitter: 0.5,
  edgeGrowth: 1.6, sizeMax: 6.0,
  drag: 0.985, buoyancy: -1.5,
  inertiaExp: 2, inertiaWeight: 0.30,
  color: [0.60, 0.60, 0.62], colorJitter: 0.04,
  alpha: 0.9, softness: 0.85,
  coalesce: { radius: 1.5, sizePerMerge: 0.20, lifePerMerge: 0.6, posBlend: 0.2, mergeChance: 0.5 },
};

export const SHELL_BILLOW_INDEX = registerProfile(SHELL_BILLOW);
```

```ts
// src/puffs/profiles/cannonball-trail.ts
import { registerProfile, type PuffProfile } from '../profile';

export const CANNONBALL_TRAIL: PuffProfile = {
  id: 'cannonball-trail',
  sizeStart: { min: 0.30, max: 0.50 },
  life: { min: 0.5, max: 1.0 },
  velScale: 0.0, velJitter: 0.5,
  edgeGrowth: 0.4, sizeMax: 1.0,
  drag: 0.97, buoyancy: -0.6,
  inertiaExp: 2, inertiaWeight: 0.10,
  color: [0.7, 0.7, 0.72], colorJitter: 0.02,
  alpha: 0.85, softness: 0.85,
  coalesce: null,
};

export const CANNONBALL_TRAIL_INDEX = registerProfile(CANNONBALL_TRAIL);
```

```ts
// src/puffs/profiles/cloud.ts
import { registerProfile, type PuffProfile } from '../profile';

export const CLOUD: PuffProfile = {
  id: 'cloud',
  sizeStart: { min: 12, max: 25 },
  life: { min: 60, max: 180 },
  velScale: 1.0, velJitter: 0.0,
  edgeGrowth: 0.0, sizeMax: 45,
  drag: 1.0, buoyancy: 0.0,
  inertiaExp: 2, inertiaWeight: 0.5,
  color: [0.92, 0.94, 0.96], colorJitter: 0.03,
  alpha: 0.5, softness: 0.95,
  coalesce: null,
};

export const CLOUD_INDEX = registerProfile(CLOUD);
```

```ts
// src/puffs/index.ts
export { createPuffs, allocPuff, updatePuffs, type Puffs } from './puffs';
export { registerProfile, getProfileByIndex, profileCount, type PuffProfile } from './profile';
export { emitPuff, emitPuffBurst, emitPuffWithCoalesce } from './emit';
export { buildCoalesceGrid, gridInsert, tryMergeOrSpawn } from './coalesce';
export { DUST, DUST_INDEX } from './profiles/dust';
export { MUSKET_SMOKE, MUSKET_SMOKE_INDEX } from './profiles/musket-smoke';
export { CANNON_SMOKE, CANNON_SMOKE_INDEX } from './profiles/cannon-smoke';
export { SHELL_BILLOW, SHELL_BILLOW_INDEX } from './profiles/shell-billow';
export { CANNONBALL_TRAIL, CANNONBALL_TRAIL_INDEX } from './profiles/cannonball-trail';
export { CLOUD, CLOUD_INDEX } from './profiles/cloud';
```

- [ ] **Step 2: Sanity-check by running existing tests**

Run: `npx vitest run src/puffs`
Expected: PASS — 12 tests across profile/puffs/coalesce/emit.

- [ ] **Step 3: Commit**

```bash
git add src/puffs/profiles src/puffs/index.ts
git commit -m "feat(puffs): six baseline profiles (dust, smoke, billow, trail, cloud)"
```

---

## Task 7: Per-soldier dust emission (replaces emitDust)

**Files:**
- Create: `src/puffs/emit-dust.ts`
- Test: `src/puffs/emit-dust.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/puffs/emit-dust.test.ts
import { describe, it, expect } from 'vitest';
import { createPuffs } from './puffs';
import { emitDustForFrame } from './emit-dust';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';

describe('emitDustForFrame', () => {
  it('emits at least one dust puff for moving soldiers over a full second', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 200 });
    for (let k = 0; k < 8; k++) {
      const id = allocEntity(world.entities);
      world.entities.posX[id] = 50 + (k % 2) * 0.1;
      world.entities.posY[id] = 50 + Math.floor(k / 2) * 0.1;
      world.entities.velX[id] = 1; world.entities.velY[id] = 0;
    }
    const puffs = createPuffs(64);
    emitDustForFrame(world, puffs, 1.0);
    expect(puffs.count).toBeGreaterThan(0);
  });

  it('does not emit for stationary soldiers', () => {
    const world = createWorld({ seed: 2, capacity: 4, mapSize: 200 });
    const id = allocEntity(world.entities);
    world.entities.posX[id] = 10; world.entities.posY[id] = 10;
    world.entities.velX[id] = 0; world.entities.velY[id] = 0;
    const puffs = createPuffs(8);
    emitDustForFrame(world, puffs, 1.0);
    expect(puffs.count).toBe(0);
  });

  it('produces a distribution of distinct puffs (not one mega-cloud)', () => {
    // Many overlapping marchers; mergeChance=0.7 means ~30% spawn fresh.
    const world = createWorld({ seed: 3, capacity: 200, mapSize: 200 });
    for (let k = 0; k < 100; k++) {
      const id = allocEntity(world.entities);
      world.entities.posX[id] = 50;
      world.entities.posY[id] = 50;
      world.entities.velX[id] = 1; world.entities.velY[id] = 0;
    }
    const puffs = createPuffs(256);
    emitDustForFrame(world, puffs, 1.0);
    // Expect more than a single puff (would be 1 if everything merged).
    expect(puffs.count).toBeGreaterThan(2);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/puffs/emit-dust.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/puffs/emit-dust.ts
import type { World } from '../sim/world';
import type { Puffs } from './puffs';
import { DUST, DUST_INDEX } from './profiles/dust';
import { buildCoalesceGrid, gridInsert, tryMergeOrSpawn } from './coalesce';
import { allocPuff } from './puffs';

const DUST_PER_SEC = 1.2; // particles per moving entity per second

export function emitDustForFrame(world: World, puffs: Puffs, dt: number): void {
  const e = world.entities;
  const expected = DUST_PER_SEC * dt;
  const grid = buildCoalesceGrid(puffs);
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    const vx = e.velX[i]!;
    const vy = e.velY[i]!;
    if (vx === 0 && vy === 0) continue;
    if (world.rng.next() > expected) continue;
    const speed = Math.hypot(vx, vy);
    const inv = speed > 0 ? 1 / speed : 0;
    const dirX = vx * inv;
    const dirY = vy * inv;
    const jx = world.rng.range(-0.4, 0.4);
    const jy = world.rng.range(-0.4, 0.4);
    const fx = e.posX[i]! + jx;
    const fy = e.posY[i]! + jy + 0.5;
    // Emission velocity: drift backward and slightly upward, like the old dust.
    const vex = -dirX * 0.16 + world.rng.range(-0.18, 0.18);
    const vey = -dirY * 0.16 - world.rng.range(0.18, 0.4);

    const merged = tryMergeOrSpawn(puffs, grid, DUST, DUST_INDEX, fx, fy, world.rng);
    if (merged.merged) continue;

    const idx = allocPuff(puffs);
    if (idx === -1) continue;
    // Inline the writeProfile work — emit-dust is a hot loop and avoids the
    // double rng draw of the full emitPuff path's velocity jitter (we have
    // our own physics-aware velocity above).
    puffs.profileIdx[idx] = DUST_INDEX;
    puffs.posX[idx] = fx; puffs.posY[idx] = fy;
    puffs.velX[idx] = vex; puffs.velY[idx] = vey;
    const life = world.rng.range(DUST.life.min, DUST.life.max);
    puffs.life[idx] = life; puffs.lifeMax[idx] = life;
    puffs.size[idx] = world.rng.range(DUST.sizeStart.min, DUST.sizeStart.max);
    puffs.sizeMax[idx] = DUST.sizeMax;
    puffs.edgeGrowth[idx] = DUST.edgeGrowth;
    puffs.drag[idx] = DUST.drag;
    puffs.buoyancy[idx] = DUST.buoyancy;
    puffs.inertiaExp[idx] = DUST.inertiaExp;
    puffs.inertiaWeight[idx] = DUST.inertiaWeight;
    puffs.r[idx] = DUST.color[0]; puffs.g[idx] = DUST.color[1]; puffs.b[idx] = DUST.color[2];
    puffs.alpha[idx] = DUST.alpha; puffs.softness[idx] = DUST.softness;
    gridInsert(grid, puffs, idx);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/puffs/emit-dust.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/puffs/emit-dust.ts src/puffs/emit-dust.test.ts
git commit -m "feat(puffs): per-soldier dust emission with coalescence"
```

---

## Task 8: Wind for puffs

**Files:**
- Create: `src/puffs/wind.ts`
- Test: `src/puffs/wind.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/puffs/wind.test.ts
import { describe, it, expect } from 'vitest';
import { createPuffs, allocPuff } from './puffs';
import { applyWindToPuffs } from './wind';
import { DUST_INDEX } from './profiles/dust';
import { CANNON_SMOKE_INDEX } from './profiles/cannon-smoke';

describe('applyWindToPuffs', () => {
  it('applies acceleration scaled by buoyancy magnitude (heavier puffs drift less)', () => {
    const p = createPuffs(4);
    const dust = allocPuff(p);
    p.profileIdx[dust] = DUST_INDEX; p.velX[dust] = 0; p.buoyancy[dust] = -0.1;
    const smoke = allocPuff(p);
    p.profileIdx[smoke] = CANNON_SMOKE_INDEX; p.velX[smoke] = 0; p.buoyancy[smoke] = -0.6;
    applyWindToPuffs(p, 1.0, 1.0); // accelX = 1, dt = 1
    // Smoke (buoyancy -0.6) should drift faster than dust (buoyancy -0.1).
    expect(Math.abs(p.velX[smoke]!)).toBeGreaterThan(Math.abs(p.velX[dust]!));
  });

  it('zero acceleration is a no-op', () => {
    const p = createPuffs(2);
    const i = allocPuff(p);
    p.velX[i] = 5;
    applyWindToPuffs(p, 0, 1);
    expect(p.velX[i]).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/puffs/wind.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/puffs/wind.ts
import type { Puffs } from './puffs';

/** Applies horizontal wind acceleration to alive puffs. The effect scales
 *  with |buoyancy|: lighter puffs (high upward buoyancy magnitude) catch
 *  more wind. Heavy ground dust (small buoyancy) barely moves. */
export function applyWindToPuffs(p: Puffs, accelX: number, dt: number): void {
  if (accelX === 0) return;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    const factor = Math.min(1.0, Math.abs(p.buoyancy[i]!));
    p.velX[i]! += accelX * factor * dt;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/puffs/wind.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/puffs/wind.ts src/puffs/wind.test.ts
git commit -m "feat(puffs): wind acceleration scaled by buoyancy"
```

---

## Task 9: Render shader strings (puff.glsl.ts)

**Files:**
- Create: `src/render/shaders/puff.glsl.ts`

- [ ] **Step 1: Write the shader strings**

```ts
// src/render/shaders/puff.glsl.ts
export const PUFF_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;       // -0.5..0.5
layout(location = 1) in vec2 a_pos;          // world center
layout(location = 2) in float a_size;        // radius (m)
layout(location = 3) in vec4 a_color;        // rgb + life ratio
layout(location = 4) in vec2 a_alphaSoft;    // peakAlpha, softness

uniform mat3 u_viewProj;
out vec2 v_local;
out vec4 v_color;
out float v_peakAlpha;
out float v_softness;

void main() {
  vec2 wp = a_pos + a_corner * (a_size * 2.0);
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0;            // -1..1 across the quad
  v_color = a_color;
  v_peakAlpha = a_alphaSoft.x;
  v_softness = a_alphaSoft.y;
}
`;

export const PUFF_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
in float v_peakAlpha;
in float v_softness;
out vec4 outColor;

void main() {
  float r = length(v_local);
  if (r > 1.0) discard;
  float feather = max(1e-3, v_softness);
  float a = 1.0 - smoothstep(1.0 - feather, 1.0, r);
  a *= v_color.a;        // life ratio
  a *= v_peakAlpha;
  if (a <= 0.0) discard;
  outColor = vec4(v_color.rgb * a, a);
}
`;
```

- [ ] **Step 2: No test (shader strings; covered by render integration)**

- [ ] **Step 3: Commit**

```bash
git add src/render/shaders/puff.glsl.ts
git commit -m "feat(render): puff shader with soft radial falloff"
```

---

## Task 10: Puff render pass

**Files:**
- Create: `src/render/passes/puff-pass.ts`

The shader cannot be unit-tested without a GL context; an integration verification happens in the lab harness later (Task 14).

- [ ] **Step 1: Implement the pass (modeled on `particle-pass.ts`)**

```ts
// src/render/passes/puff-pass.ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { PUFF_VS, PUFF_FS } from '../shaders/puff.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { Puffs } from '../../puffs/puffs';

export interface PuffPass {
  draw(puffs: Puffs, cam: Camera): void;
}

export function createPuffPass(gl: WebGL2RenderingContext, capacity: number): PuffPass {
  const prog = linkProgram(gl, PUFF_VS, PUFF_FS);
  const u = getUniforms(gl, prog, ['u_viewProj'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const sizeBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const colorBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  const alphaSoftBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);

  gl.bindVertexArray(null);

  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity);
  const scratchColor = new Float32Array(capacity * 4);
  const scratchAS = new Float32Array(capacity * 2);

  return {
    draw(p, cam) {
      let n = 0;
      for (let i = 0; i < p.capacity; i++) {
        if (p.alive[i] === 0) continue;
        scratchPos[n * 2 + 0] = p.posX[i]!;
        scratchPos[n * 2 + 1] = p.posY[i]!;
        scratchSize[n] = p.size[i]!;
        const lifeRatio = p.lifeMax[i]! > 0 ? p.life[i]! / p.lifeMax[i]! : 0;
        scratchColor[n * 4 + 0] = p.r[i]!;
        scratchColor[n * 4 + 1] = p.g[i]!;
        scratchColor[n * 4 + 2] = p.b[i]!;
        scratchColor[n * 4 + 3] = lifeRatio;
        scratchAS[n * 2 + 0] = p.alpha[i]!;
        scratchAS[n * 2 + 1] = p.softness[i]!;
        n++;
      }
      if (n === 0) return;
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchSize.subarray(0, n));
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchColor.subarray(0, n * 4));
      gl.bindBuffer(gl.ARRAY_BUFFER, alphaSoftBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchAS.subarray(0, n * 2));
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/render/passes/puff-pass.ts
git commit -m "feat(render): puff render pass — instanced soft discs"
```

---

## Task 11: Wire puffs into Renderer

**Files:**
- Modify: `src/render/renderer.ts`

- [ ] **Step 1: Edit `renderer.ts`**

Add the import and pass creation; thread `puffs` through `render()` between sprite and particle draws.

```ts
// At the top, add:
import { createPuffPass } from './passes/puff-pass';
import type { Puffs } from '../puffs/puffs';

// Update Renderer.render signature:
export interface Renderer {
  render(
    world: World,
    projectiles: Projectiles,
    puffs: Puffs,
    particles: Particles,
    cam: Camera,
    sel: Selection,
    drag: DragRect,
    formation: FormationPreview | null,
    opts: RenderOptions,
  ): void;
  resize(): void;
  bloodStain: BloodStainPass;
}

// Update createRenderer signature: add `puffCapacity: number` after particleCapacity.
export function createRenderer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  capacity: number,
  particleCapacity: number,
  puffCapacity: number,
  projectileCapacity: number,
  worldW: number,
  worldH: number,
): Renderer {
  // ... existing pass creation ...
  const puffsPass = createPuffPass(gl, puffCapacity);

  return {
    bloodStain,
    resize() { resizeToDisplay(gl, canvas); },
    render(world, projectiles, puffs, particlePool, cam, sel, drag, formation, opts) {
      bloodStain.flush();
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
      selectionPass.drawDiscs(world, cam, sel, drag);
      sprites.draw(world, cam);
      projectilesPass.draw(projectiles, cam);
      // Puffs first (under), sparks after (over).
      puffsPass.draw(puffs, cam);
      particlesPass.draw(particlePool, cam, ABOVE_SOLDIER_MASK);
      selectionPass.draw(world, cam, sel, drag, formation);
      if (opts.showHealthBars) healthBarPass.draw(world, cam);
    },
  };
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: errors at every Renderer call site (main.ts, lab/main.ts) — those callers will be updated in Tasks 12 and 14.

- [ ] **Step 3: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat(render): thread Puffs through Renderer + new draw step"
```

---

## Task 12: Wire puffs into main.ts (game entrypoint)

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update main.ts**

Replace the existing dust path with puff-system equivalents.

```ts
// New imports
import { createPuffs, updatePuffs } from './puffs/puffs';
import { emitDustForFrame } from './puffs/emit-dust';

// Constants — add:
const PUFF_CAPACITY = 1024;

// Renderer call — add puff capacity:
const renderer = createRenderer(
  gl, canvas, CAPACITY, PARTICLE_CAPACITY, PUFF_CAPACITY, PROJECTILE_CAPACITY,
  map.size.w, map.size.h,
);

// State — add puffs pool:
const puffs = createPuffs(PUFF_CAPACITY);

// Frame loop — replace the emitDust(particles) call and add updatePuffs:
//   tickWorld(world, dt);
//   emitDust(world, particles, dt);          // REMOVE
//   updateParticles(particles, dt);
// becomes:
   tickWorld(world, dt);
   emitDustForFrame(world, puffs, dt);
   updatePuffs(puffs, dt);
   updateParticles(particles, dt);

// Render call — pass puffs:
renderer.render(world, projectiles, puffs, particles, camera, selection, drag, controller.formationPreview(), { showHealthBars });
```

Remove the now-unused `emitDust` import.

- [ ] **Step 2: Verify it builds**

Run: `npx tsc --noEmit`
Expected: errors only at `lab/main.ts` (still uses old renderer signature) and at `emitMuzzleFx`/`emitCannonballTrail` call sites (still old). Continue.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): wire puff pool, replace dust path"
```

---

## Task 13: MuzzleProfile + ExplosionProfile shape change

**Files:**
- Modify: `src/data/weapons/types.ts`
- Modify: `src/data/weapons/musket.ts`
- Modify: `src/data/weapons/cannon-12-solid.ts`
- Modify: `src/data/weapons/cannon-12-shell.ts`

- [ ] **Step 1: Update the type definitions**

Replace the inline `smoke` and `smokeBillow` shapes with profile references.

```ts
// src/data/weapons/types.ts
import type { PuffProfile } from '../../puffs/profile';

export type Color3 = readonly [number, number, number];

export interface MuzzleProfile {
  flash: { size: number; life: number; color: Color3 };
  smoke: {
    profile: PuffProfile;
    profileIdx: number;
    count: number;
    coneAngle: number;          // radians
    speed: { min: number; max: number };
  };
  recoilFirer: number;
}

export interface ExplosionProfile {
  flash: { size: number; life: number; color: Color3 };
  smokeBillow: {
    profile: PuffProfile;
    profileIdx: number;
    count: number;
    speed: { min: number; max: number };
  };
  debris: { count: number; speedMin: number; speedMax: number; life: number; size: number };
  damage: number;
  damageRadius: number;
  impulse: number;
}

// WeaponProfile unchanged.
```

- [ ] **Step 2: Update musket.ts**

```ts
// src/data/weapons/musket.ts
import type { WeaponProfile } from './types';
import { MUSKET_SMOKE, MUSKET_SMOKE_INDEX } from '../../puffs/profiles/musket-smoke';

export const musket: WeaponProfile = {
  id: 'musket',
  kind: 'musket',
  muzzle: {
    flash: { size: 0.5, life: 0.06, color: [1.0, 0.86, 0.59] },
    smoke: {
      profile: MUSKET_SMOKE,
      profileIdx: MUSKET_SMOKE_INDEX,
      count: 10,
      coneAngle: 0.4,
      speed: { min: 4, max: 7 },
    },
    recoilFirer: 0.5,
  },
  projectile: {
    mass: 0.03,
    muzzleVelocity: 400,
    damage: 12,
    accuracySpreadRad: (1.5 * Math.PI) / 180,
    maxLife: 0.4,
  },
};
```

- [ ] **Step 3: Update cannon-12-solid.ts**

```ts
// src/data/weapons/cannon-12-solid.ts
import type { MuzzleProfile, WeaponProfile } from './types';
import { CANNON_SMOKE, CANNON_SMOKE_INDEX } from '../../puffs/profiles/cannon-smoke';

export const cannon12Muzzle: MuzzleProfile = {
  flash: { size: 3.0, life: 0.15, color: [1.0, 0.86, 0.59] },
  smoke: {
    profile: CANNON_SMOKE,
    profileIdx: CANNON_SMOKE_INDEX,
    count: 40,
    coneAngle: 0.8,
    speed: { min: 8, max: 15 },
  },
  recoilFirer: 4.0,
};

export const cannon12Solid: WeaponProfile = {
  id: 'cannon-12-solid',
  kind: 'solid-shot',
  muzzle: cannon12Muzzle,
  projectile: {
    mass: 6,
    muzzleVelocity: 250,
    damage: 80,
    maxLife: 6.0,
    launchHeight: 0.7,
    ricochetCount: 3,
    restitutionZ: 0.5,
    horizontalDampingPerRicochet: 0.7,
    groundFriction: 1.5,
    rollStopSpeed: 3,
    perHitDamageFalloff: 0.6,
    perHitVelocityFalloff: 0.85,
    freeBelowDamage: 5,
  },
};
```

- [ ] **Step 4: Update cannon-12-shell.ts**

```ts
// src/data/weapons/cannon-12-shell.ts
import type { WeaponProfile } from './types';
import { cannon12Muzzle } from './cannon-12-solid';
import { SHELL_BILLOW, SHELL_BILLOW_INDEX } from '../../puffs/profiles/shell-billow';

export const cannon12Shell: WeaponProfile = {
  id: 'cannon-12-shell',
  kind: 'shell',
  muzzle: cannon12Muzzle,
  projectile: {
    mass: 6,
    muzzleVelocity: 250,
    damage: 0,
    maxLife: 6.0,
    launchHeight: 0.7,
    fuse: 1.5,
    explosion: {
      flash: { size: 5, life: 0.18, color: [1.0, 0.9, 0.63] },
      smokeBillow: {
        profile: SHELL_BILLOW,
        profileIdx: SHELL_BILLOW_INDEX,
        count: 50,
        speed: { min: 6, max: 14 },
      },
      debris: { count: 20, speedMin: 10, speedMax: 22, life: 0.6, size: 0.25 },
      damage: 60,
      damageRadius: 6,
      impulse: 6000,
    },
  },
};
```

- [ ] **Step 5: Verify type-check (still failing at emitMuzzleFx call sites)**

Run: `npx tsc --noEmit`
Expected: failures only at `emitMuzzleFx`, `emitCannonballTrail`, `spawnExplosion` call sites that still consume the old shape. Those are addressed in Tasks 15–17.

- [ ] **Step 6: Commit**

```bash
git add src/data/weapons/types.ts src/data/weapons/musket.ts src/data/weapons/cannon-12-solid.ts src/data/weapons/cannon-12-shell.ts
git commit -m "feat(data): MuzzleProfile/ExplosionProfile reference puff profiles"
```

---

## Task 14: Wire puffs into lab/main.ts (FX harness)

**Files:**
- Modify: `src/lab/main.ts`

- [ ] **Step 1: Read lab/main.ts to find current renderer wiring and frame loop**

Run: `grep -n "createRenderer\|updateParticles\|renderer.render" src/lab/main.ts`

- [ ] **Step 2: Apply the same diff pattern as main.ts**

Add `createPuffs`/`updatePuffs`/`PUFF_CAPACITY = 1024` and pass `puffs` through `createRenderer` and `renderer.render`. Tick `updatePuffs(puffs, dt)` in the frame loop alongside `updateParticles`.

```ts
// Imports
import { createPuffs, updatePuffs } from '../puffs/puffs';

// State
const PUFF_CAPACITY = 1024;
const puffs = createPuffs(PUFF_CAPACITY);

// Renderer creation — add PUFF_CAPACITY arg in correct position.

// Frame loop — add updatePuffs(puffs, dt) before renderer.render(...).
// Renderer call — pass puffs alongside particles.
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: errors only at the still-unmigrated emitter call sites.

- [ ] **Step 4: Commit**

```bash
git add src/lab/main.ts
git commit -m "feat(lab): wire puff pool into FX harness"
```

---

## Task 15: Replace muzzle smoke (emitMuzzleFx → flash + emitPuffBurst)

**Files:**
- Modify: `src/particles/emitters.ts`
- Modify: `src/sim/fire-resolver.ts`
- Modify: `src/lab/actions.ts`
- Modify: `src/particles/emitters.test.ts` (update muzzle test)

- [ ] **Step 1: Replace `emitMuzzleFx` body in `src/particles/emitters.ts` with flash-only**

```ts
// src/particles/emitters.ts — replace existing emitMuzzleFx
export function emitMuzzleFx(
  particles: Particles,
  profile: MuzzleProfile,
  x: number, y: number,
  _dirX: number, _dirY: number,
  _rng: Rng,
): void {
  // Flash particle only. Smoke is now handled by the puff system; callers
  // also invoke emitPuffBurst with `profile.smoke`.
  spawnParticle(particles, {
    x, y,
    vx: 0, vy: 0,
    life: profile.flash.life,
    size: profile.flash.size,
    r: profile.flash.color[0], g: profile.flash.color[1], b: profile.flash.color[2],
    drag: 0.6,
    accelY: 0,
    sizeGrowth: 0,
    klass: ParticleClass.Flash,
  });
}
```

- [ ] **Step 2: Update `src/sim/fire-resolver.ts` to also call emitPuffBurst**

Find the two call sites and add the puff-burst alongside.

```ts
// At the top of fire-resolver.ts, add:
import { emitPuffBurst } from '../puffs/emit';
import type { Puffs } from '../puffs/puffs';

// Update fireResolver function signature to accept `puffs: Puffs`
// (search for `function fireResolver` or similar).

// Replace each:
//   emitMuzzleFx(particles, weapon.muzzle, tip.x, tip.y, dirX, dirY, rng);
// with:
   emitMuzzleFx(particles, weapon.muzzle, tip.x, tip.y, dirX, dirY, rng);
   emitPuffBurst(
     puffs,
     weapon.muzzle!.smoke.profile,
     weapon.muzzle!.smoke.profileIdx,
     tip.x, tip.y, dirX, dirY,
     weapon.muzzle!.smoke.count,
     weapon.muzzle!.smoke.coneAngle,
     weapon.muzzle!.smoke.speed,
     rng,
   );
```

Update every caller of `fireResolver` (search via `grep -n fireResolver src/`) to thread the `puffs` argument from the call site (`main.ts`, `lab/main.ts`, `tickStates`, etc.).

- [ ] **Step 3: Update `src/lab/actions.ts`**

Same pattern: add `emitPuffBurst` call after `emitMuzzleFx`. Thread `puffs` through the action signatures.

- [ ] **Step 4: Update emitters.test.ts**

```ts
// src/particles/emitters.test.ts — change emitMuzzleFx assertions
describe('emitMuzzleFx', () => {
  it('spawns exactly 1 flash particle for the musket profile (smoke handled by puffs)', () => {
    const p = createParticles(64);
    const rng = createRng(1);
    emitMuzzleFx(p, musket.muzzle!, 0, 0, 1, 0, rng);
    expect(p.count).toBe(1);
    expect(countByClass(p, ParticleClass.Flash)).toBe(1);
  });

  // Drop the "10 smoke particles" expectation — covered by puff tests.
  // Keep the flash-shape test as-is.
});
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS for everything except the `emitDust` and `emitCannonballTrail` test blocks (those still use the old emitters; they're addressed in Tasks 16, 18, 20).

- [ ] **Step 6: Commit**

```bash
git add src/particles/emitters.ts src/sim/fire-resolver.ts src/lab/actions.ts src/particles/emitters.test.ts
git commit -m "feat: muzzle smoke now uses puff burst; flash stays in particles"
```

---

## Task 16: Wire puffs through fire-resolver and actions callers

**Files:**
- Modify: `src/main.ts`, `src/lab/main.ts`, `src/sim/systems/states.ts` (or wherever `tickStates` lives — search), `src/input/selection-controller.ts` (if it threads through)

This task only exists if Task 15 left dangling `puffs` arguments in callers. Use `npx tsc --noEmit` to find them.

- [ ] **Step 1: Find every caller of `fireResolver` / `tickStates`**

Run: `grep -rn "fireResolver\|tickStates" src/ --include='*.ts' | grep -v test`

- [ ] **Step 2: Thread `puffs` through each layer**

Add `puffs: Puffs` to function signatures up the call chain until you reach `main.ts` and `lab/main.ts` where the pool exists. Pass it at every call site.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: type-check passes; `emitDust` and `emitCannonballTrail` tests still need updates (next tasks).

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "feat: thread puff pool through fire-resolver and action callers"
```

---

## Task 17: Replace cannonball trail emitter

**Files:**
- Modify: `src/sim/systems/projectile-system.ts`
- Modify: `src/particles/emitters.ts` (remove `emitCannonballTrail`)

- [ ] **Step 1: Update `tickProjectiles` to take `puffs` and emit via the puff system**

```ts
// src/sim/systems/projectile-system.ts
import { emitPuff } from '../../puffs/emit';
import type { Puffs } from '../../puffs/puffs';
import { CANNONBALL_TRAIL, CANNONBALL_TRAIL_INDEX } from '../../puffs/profiles/cannonball-trail';

export function tickProjectiles(
  projectiles: Projectiles,
  entities: Entities,
  grid: Grid,
  puffs: Puffs,                // NEW
  particles: Particles,
  rng: Rng,
  dt: number,
  splats?: BloodSplats,
): void {
  // ... existing body unchanged until the trail emit at end of loop ...

  // Step 9 — replace:
  //   emitCannonballTrail(particles, p.posX[i]!, p.posY[i]!, rng);
  // with:
  if (kind === ProjectileKind.SolidShot || kind === ProjectileKind.Shell) {
    emitPuff(puffs, CANNONBALL_TRAIL, CANNONBALL_TRAIL_INDEX, p.posX[i]!, p.posY[i]!, 0, 0, rng);
  }
}
```

Drop the old import.

- [ ] **Step 2: Remove `emitCannonballTrail` from `src/particles/emitters.ts`**

Delete the function. The cannonball trail no longer touches the `Particles` pool.

- [ ] **Step 3: Update every caller of `tickProjectiles` to pass `puffs`**

```bash
grep -rn "tickProjectiles" src/ --include='*.ts' | grep -v test
```

Thread `puffs` from `main.ts` and `lab/main.ts`.

- [ ] **Step 4: Update tests**

In `src/particles/emitters.test.ts`, delete the `describe('emitCannonballTrail', ...)` block.

- [ ] **Step 5: Run tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS except for the still-active `emitDust merging` block (next task).

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "feat: cannonball trail moves to puff system"
```

---

## Task 18: Remove emitDust + dust constants from particles/emitters.ts

**Files:**
- Modify: `src/particles/emitters.ts`
- Modify: `src/particles/emitters.test.ts`

- [ ] **Step 1: Delete `emitDust` and the `DUST_*` constants**

Open `src/particles/emitters.ts`. Delete:
- The `DUST_PER_SEC`, `DUST_MERGE_RADIUS*`, `DUST_CELL`, `DUST_MAX_SIZE`, `DUST_MAX_LIFE`, `DUST_SIZE_PER_MERGE`, `DUST_LIFE_PER_MERGE` constants.
- The `dustCellKey` helper.
- The entire `emitDust` function.
- The `import type { World } from '../sim/world'` line if no other function in the file uses it.

The remaining functions in this file: `emitOrderPuff`, `emitMuzzleFx`, `spawnBlood`, `emitRicochetBurst`, `emitImpactDust`. These all stay.

- [ ] **Step 2: Drop the dust block from `src/particles/emitters.test.ts`**

Delete the entire `describe('emitDust merging', ...)` block.

Keep all other tests (`emitMuzzleFx`, `spawnBlood`, `emitRicochetBurst`, `emitImpactDust`).

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: PASS — full suite green.

- [ ] **Step 4: Commit**

```bash
git add src/particles/emitters.ts src/particles/emitters.test.ts
git commit -m "chore: remove emitDust from particles (replaced by puff system)"
```

---

## Task 19: Migrate explosion smoke billow to puffs

**Files:**
- Modify: `src/fx/explosion.ts`

- [ ] **Step 1: Update `spawnExplosion` to take `puffs` and use emitPuffBurst**

```ts
// src/fx/explosion.ts
import type { Puffs } from '../puffs/puffs';
import { emitPuffBurst } from '../puffs/emit';

export function spawnExplosion(
  entities: Entities,
  grid: Grid,
  puffs: Puffs,                  // NEW
  particles: Particles,
  rng: Rng,
  x: number, y: number,
  profile: ExplosionProfile,
  excludeTeam?: number,
  splats?: BloodSplats,
): void {
  // 1. Flash — unchanged (still in Particles).
  spawnParticle(particles, {
    x, y, vx: 0, vy: 0,
    life: profile.flash.life,
    size: profile.flash.size,
    r: profile.flash.color[0], g: profile.flash.color[1], b: profile.flash.color[2],
    drag: 0.6, accelY: 0, sizeGrowth: 0,
    klass: ParticleClass.Flash,
  });

  // 2. Smoke billow — radial puff burst (was a 50-particle smoke loop).
  const sb = profile.smokeBillow;
  emitPuffBurst(puffs, sb.profile, sb.profileIdx, x, y, 1, 0, sb.count, Math.PI * 2, sb.speed, rng);
  // (coneAngle = 2π → full circle, matching the old radial spray.)

  // 3. Debris — unchanged (still in Particles).
  // ... existing debris code ...

  // 4. Area damage — unchanged.
  // ... existing damage loop ...
}
```

Note: the old `smokeBillow.upwardDrift`, `drag`, `sizeGrowth`, `lifeMin/lifeMax`, `sizeStart` fields are now profile-driven; this file no longer uses them.

- [ ] **Step 2: Update every caller of `spawnExplosion`**

```bash
grep -rn "spawnExplosion" src/ --include='*.ts' | grep -v test
```

Add `puffs` argument at each call site (likely in `projectile-system.ts` and any standalone tests).

- [ ] **Step 3: Run tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "feat: explosion smoke billow uses puff burst"
```

---

## Task 20: Update lab/wind.ts to puffs

**Files:**
- Modify: `src/lab/wind.ts`
- Modify: `src/lab/wind.test.ts`
- Modify: `src/lab/main.ts`

- [ ] **Step 1: Replace particle-based applyWind with the puff version**

```ts
// src/lab/wind.ts — replace the entire file
import type { Puffs } from '../puffs/puffs';
import { applyWindToPuffs } from '../puffs/wind';

/** Lab-side wind: forwards horizontal acceleration to the puff system.
 *  Sparks (flash, blood, debris) are not wind-affected, matching the
 *  prior behavior. */
export function applyWind(puffs: Puffs, accelX: number, dt: number): void {
  applyWindToPuffs(puffs, accelX, dt);
}
```

- [ ] **Step 2: Update `src/lab/wind.test.ts`**

Replace the test's particle-based assertions with puff-pool ones; reuse the cases from `src/puffs/wind.test.ts` style (smoke drifts more than dust, zero accel is no-op).

- [ ] **Step 3: Update `src/lab/main.ts`**

Wherever the frame loop calls `applyWind(particles, ...)`, change to `applyWind(puffs, ...)`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lab/wind.ts src/lab/wind.test.ts src/lab/main.ts
git commit -m "feat(lab): wind now operates on puffs, not particles"
```

---

## Task 21: Ambient cloud spawner

**Files:**
- Create: `src/puffs/ambient-clouds.ts`
- Test: `src/puffs/ambient-clouds.test.ts`
- Modify: `src/main.ts`, `src/lab/main.ts` (call from frame loop)

- [ ] **Step 1: Write the failing test**

```ts
// src/puffs/ambient-clouds.test.ts
import { describe, it, expect } from 'vitest';
import { createPuffs } from './puffs';
import { tickAmbientClouds, type AmbientCloudConfig } from './ambient-clouds';
import { CLOUD_INDEX } from './profiles/cloud';
import { createRng } from '../util/rng';

const cfg: AmbientCloudConfig = {
  target: 6,
  viewport: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
  windX: 1.5, windY: 0,
};

function countClouds(p: ReturnType<typeof createPuffs>): number {
  let n = 0;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 1 && p.profileIdx[i] === CLOUD_INDEX) n++;
  }
  return n;
}

describe('ambient clouds', () => {
  it('spawns up to target count over multiple ticks', () => {
    const p = createPuffs(64);
    const rng = createRng(1);
    for (let n = 0; n < 20; n++) tickAmbientClouds(p, cfg, 0.5, rng);
    expect(countClouds(p)).toBeGreaterThanOrEqual(cfg.target - 1);
    expect(countClouds(p)).toBeLessThanOrEqual(cfg.target + 1);
  });

  it('spawns on the upwind viewport edge', () => {
    const p = createPuffs(64);
    const rng = createRng(2);
    // wind from -X (windX > 0 means cloud drifts in +X), so spawn at minX.
    for (let n = 0; n < 20; n++) tickAmbientClouds(p, cfg, 0.5, rng);
    let upwindCount = 0, totalCount = 0;
    for (let i = 0; i < p.capacity; i++) {
      if (p.alive[i] === 1 && p.profileIdx[i] === CLOUD_INDEX) {
        totalCount++;
        if (p.posX[i]! < cfg.viewport.minX + 30) upwindCount++;
      }
    }
    expect(upwindCount).toBeGreaterThan(totalCount * 0.5);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/puffs/ambient-clouds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/puffs/ambient-clouds.ts
import type { Puffs } from './puffs';
import { allocPuff } from './puffs';
import { CLOUD, CLOUD_INDEX } from './profiles/cloud';
import type { Rng } from '../util/rng';

export interface AmbientCloudConfig {
  target: number;
  viewport: { minX: number; minY: number; maxX: number; maxY: number };
  windX: number;
  windY: number;
}

export function tickAmbientClouds(
  puffs: Puffs, cfg: AmbientCloudConfig, dt: number, rng: Rng,
): void {
  let alive = 0;
  for (let i = 0; i < puffs.capacity; i++) {
    if (puffs.alive[i] === 1 && puffs.profileIdx[i] === CLOUD_INDEX) alive++;
  }
  const deficit = cfg.target - alive;
  if (deficit <= 0) return;

  // Emit at most one per tick to avoid bursty spawns; rate-limit by time.
  const probability = Math.min(1, deficit * dt * 0.5);
  if (rng.next() > probability) return;

  // Upwind edge: opposite of (windX, windY). If wind ≈ 0, pick a random edge.
  const wMag = Math.hypot(cfg.windX, cfg.windY);
  let x: number, y: number;
  const v = cfg.viewport;
  if (wMag < 1e-3) {
    const side = rng.intRange(0, 4);
    if (side === 0) { x = v.minX; y = rng.range(v.minY, v.maxY); }
    else if (side === 1) { x = v.maxX; y = rng.range(v.minY, v.maxY); }
    else if (side === 2) { x = rng.range(v.minX, v.maxX); y = v.minY; }
    else { x = rng.range(v.minX, v.maxX); y = v.maxY; }
  } else {
    const upwindX = -cfg.windX / wMag;
    const upwindY = -cfg.windY / wMag;
    const cx = (v.minX + v.maxX) * 0.5;
    const cy = (v.minY + v.maxY) * 0.5;
    const halfW = (v.maxX - v.minX) * 0.5;
    const halfH = (v.maxY - v.minY) * 0.5;
    // Walk from center along upwind direction until hitting an edge.
    const t = Math.min(
      Math.abs(upwindX) > 1e-6 ? halfW / Math.abs(upwindX) : Infinity,
      Math.abs(upwindY) > 1e-6 ? halfH / Math.abs(upwindY) : Infinity,
    );
    x = cx + upwindX * t + rng.range(-halfH, halfH) * (1 - Math.abs(upwindX));
    y = cy + upwindY * t + rng.range(-halfW, halfW) * (1 - Math.abs(upwindY));
  }

  const idx = allocPuff(puffs);
  if (idx === -1) return;
  puffs.profileIdx[idx] = CLOUD_INDEX;
  puffs.posX[idx] = x; puffs.posY[idx] = y;
  puffs.velX[idx] = cfg.windX; puffs.velY[idx] = cfg.windY;
  const life = rng.range(CLOUD.life.min, CLOUD.life.max);
  puffs.life[idx] = life; puffs.lifeMax[idx] = life;
  puffs.size[idx] = rng.range(CLOUD.sizeStart.min, CLOUD.sizeStart.max);
  puffs.sizeMax[idx] = CLOUD.sizeMax;
  puffs.edgeGrowth[idx] = CLOUD.edgeGrowth;
  puffs.drag[idx] = CLOUD.drag;
  puffs.buoyancy[idx] = CLOUD.buoyancy;
  puffs.inertiaExp[idx] = CLOUD.inertiaExp;
  puffs.inertiaWeight[idx] = CLOUD.inertiaWeight;
  puffs.r[idx] = CLOUD.color[0]; puffs.g[idx] = CLOUD.color[1]; puffs.b[idx] = CLOUD.color[2];
  puffs.alpha[idx] = CLOUD.alpha; puffs.softness[idx] = CLOUD.softness;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/puffs/ambient-clouds.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Wire into main.ts**

```ts
// src/main.ts (and src/lab/main.ts) — add ambient cloud tick

import { tickAmbientClouds, type AmbientCloudConfig } from './puffs/ambient-clouds';

// In frame loop, after updatePuffs:
const cloudCfg: AmbientCloudConfig = {
  target: 12,
  viewport: { minX: 0, minY: 0, maxX: map.size.w, maxY: map.size.h },
  windX: 0.6, windY: 0,
};
tickAmbientClouds(puffs, cloudCfg, dt, world.rng);
```

- [ ] **Step 6: Commit**

```bash
git add src/puffs/ambient-clouds.ts src/puffs/ambient-clouds.test.ts src/main.ts src/lab/main.ts
git commit -m "feat(puffs): ambient cloud spawner for sky drift"
```

---

## Task 22: particles/particles.test.ts — keep multiplicative semantics test for non-Dust klass

**Files:**
- Modify: `src/particles/particles.test.ts`

The existing test "sizeGrowth scales size per second" defaults klass to Dust (which is no longer used). Change the test to be explicit about klass to remove the implicit dependency.

- [ ] **Step 1: Update the test**

```ts
// src/particles/particles.test.ts — find the existing test:
//   it('sizeGrowth scales size per second', ...) and replace with:

it('sizeGrowth scales size per second (multiplicative)', () => {
  const p = createParticles(4);
  const id = spawnParticle(p, {
    x: 0, y: 0, vx: 0, vy: 0, life: 10, size: 1, r: 1, g: 1, b: 1,
    sizeGrowth: 1.0,
    klass: ParticleClass.Smoke,            // explicit
  });
  updateParticles(p, 1.0);
  // size *= 1 + 1.0 * 1.0 = 2
  expect(p.size[id]).toBeCloseTo(2, 5);
});
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS — full suite green.

- [ ] **Step 3: Commit**

```bash
git add src/particles/particles.test.ts
git commit -m "test(particles): sizeGrowth test uses explicit klass"
```

---

## Task 23: Full-suite verification + manual lab smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — every test green, no skips.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Build the dev bundle**

Run: `npm run build` (or whatever the project's build script is — check `package.json`).
Expected: build succeeds.

- [ ] **Step 4: Manual smoke test via lab harness**

The lab harness exposes `solidShot` and `explosiveShell` actions. The author should:

1. `npm run dev` (or equivalent dev command from `package.json`).
2. Open the browser, switch to the lab page if separate.
3. Trigger `solidShot` — verify a fan of cannon-smoke puffs appears at the muzzle and a thin trail follows the ball.
4. Trigger `explosiveShell` — verify the explosion produces a billowing soft cloud (not a flat-square cluster).
5. Watch marching soldiers in the main game — dust should appear as a distribution of puffs along the column, not one mega-cloud, and the cluster should be obviously smoother and softer than before.
6. If wind is enabled in the lab harness, toggle it — clouds should drift, dust barely.

Document any visual regressions in the next task as follow-up tweaks.

- [ ] **Step 5: Commit any noted tuning tweaks**

If any profile values need adjustment after the smoke test, edit the corresponding `src/puffs/profiles/*.ts` file and commit:

```bash
git add src/puffs/profiles/
git commit -m "chore(puffs): tune profile after lab smoke test"
```

---

## Self-review notes

The plan above covers every section of the spec:

| Spec section | Implementing task(s) |
|---|---|
| Architecture / file layout | Tasks 1–6, 9–10 |
| Data model (`PuffProfile`, `Puffs`) | Tasks 1–2 |
| Update loop (additive growth, size-damped drag) | Tasks 2–3 |
| Coalescence (frame-scoped hash, mergeChance, saturation) | Task 4 |
| Emission API (`emitPuff`, `emitPuffBurst`, with-coalesce) | Task 5 |
| Profiles (six baseline) | Task 6 |
| Rendering (shader + pass + integration) | Tasks 9–11 |
| Ambient clouds | Task 21 |
| Migration: dust | Tasks 7, 12, 18 |
| Migration: muzzle | Tasks 13, 15, 16 |
| Migration: trail | Task 17 |
| Migration: explosion | Tasks 13, 19 |
| Wind | Tasks 8, 20 |
| Tests (new + updated) | Each task includes its own tests; Task 22 cleans up the legacy test |
| Final verification | Task 23 |

No placeholders. Type and identifier consistency: `Puffs`, `PuffProfile`,
`emitPuff`, `emitPuffBurst`, `emitPuffWithCoalesce`, `tryMergeOrSpawn`,
`buildCoalesceGrid`, `gridInsert`, `tickAmbientClouds`, `applyWindToPuffs`,
`emitDustForFrame` are used consistently across tasks.
