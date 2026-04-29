# Terrain Features (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add procedurally generated trees, farm fields, hedgerows, and grass-tint meadow regions to the empty `WorldMap.features` slot, drawn by new render passes layered into the existing pipeline.

**Architecture:** Extend `MapFeature` with three new kinds (`tree_cluster`, `field`, `meadow_region`); add a deterministic seeded generator (`src/map/terrain-gen.ts`) that fills the map at load; add three new render passes (`fields-pass`, `hedgerows-pass`, `trees-pass`) plus a meadow-mask sampler in the existing `terrain-pass`. All textures generated procedurally to match the existing `grass-texture.ts` style. NEAREST filtering everywhere (in-world rendering must be pixel-art).

**Tech Stack:** TypeScript, WebGL2, vitest. No new dependencies. Triangulation, PRNG, and texture generation all hand-written and tested.

**Spec:** `docs/superpowers/specs/2026-04-28-terrain-features-design.md`

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `src/map/terrain-gen.ts` | Deterministic seeded generator: `generateMapFeatures(seed, size) → MapFeature[]` |
| `src/map/terrain-gen.test.ts` | Determinism + bounds tests |
| `src/map/prng.ts` | Mulberry32 PRNG + helpers |
| `src/map/prng.test.ts` | PRNG determinism test |
| `src/render/tree-sprite.ts` | Procedural tree-sprite atlas (5 variants, 320×64) |
| `src/render/tree-sprite.test.ts` | Atlas dimension/alpha tests |
| `src/render/hedge-texture.ts` | Procedural hedge tile (256×64, tileable) |
| `src/render/hedge-texture.test.ts` | Tile dimension test |
| `src/render/passes/fields-pass.ts` | Field polygon triangulation + draw |
| `src/render/passes/fields-pass.test.ts` | Triangulation test |
| `src/render/passes/hedgerows-pass.ts` | Polyline → quad strip + draw |
| `src/render/passes/trees-pass.ts` | Cluster expansion + per-instance tree draw |
| `src/render/shaders/field.glsl.ts` | Striped-row field VS/FS |
| `src/render/shaders/hedgerow.glsl.ts` | Hedge tile VS/FS |
| `src/render/shaders/tree.glsl.ts` | Tree atlas VS/FS |

**Modified files:**

| File | Change |
|------|--------|
| `src/data/types.ts` | Extend `MapFeature` (new `kind` values, new `shape.cluster` variant, optional `field`/`meadow` blocks) |
| `src/map/world-map.ts` | `createDefaultMap(seed?)` → calls generator |
| `src/render/passes/terrain-pass.ts` | Accept meadow mask + sampler |
| `src/render/shaders/terrain.glsl.ts` | Mix meadow tint into grass colour |
| `src/render/renderer.ts` | Build meadow mask; wire `fields-pass`, `hedgerows-pass`, `trees-pass` into draw order; pass `WorldMap` through |
| `src/main.ts` | Pass `map` to `createRenderer` |

**Draw order (back to front):** terrain (now with meadow tint) → fields → hedgerows → existing ground passes (blood-stain etc) → sprites → trees → projectiles/puffs/etc.

---

## Task 1: Extend `MapFeature` type for new feature kinds

**Files:**
- Modify: `src/data/types.ts:61-73`

- [ ] **Step 1: Replace the `MapFeature` interface**

Replace the existing interface (lines 61-73) with:

```ts
export interface MapFeature {
  id: number;
  kind:
    | 'hedgerow' | 'wall' | 'building' | 'trench' | 'river'
    | 'tree_cluster' | 'field' | 'meadow_region';
  shape:
    | { type: 'polyline'; points: { x: number; y: number }[] }
    | { type: 'polygon'; points: { x: number; y: number }[] }
    | { type: 'rect'; x: number; y: number; w: number; h: number }
    | { type: 'cluster'; cx: number; cy: number; radius: number; density: number; seed: number };
  blocksMovement: boolean;
  blocksProjectile: boolean;
  blocksSight: boolean;
  cover: number;
  height: number;
  field?: {
    crop: 'wheat' | 'furrow' | 'stubble';
    rowAngle: number; // radians
  };
  meadow?: {
    tint: [number, number, number]; // 0..1 per channel
    softness: number;                // 0..1
  };
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no callers exist yet, the empty `features: []` array still satisfies the type).

- [ ] **Step 3: Commit**

```bash
git add src/data/types.ts
git commit -m "feat(types): extend MapFeature with tree_cluster, field, meadow_region kinds"
```

---

## Task 2: Mulberry32 PRNG utility

**Files:**
- Create: `src/map/prng.ts`
- Create: `src/map/prng.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/map/prng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mulberry32, randRange, randInt, randInDisc } from './prng';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 16; i++) expect(a()).toBe(b());
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds produce different first values', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('helpers', () => {
  it('randRange respects bounds', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = randRange(r, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('randInt is integral and in range', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const v = randInt(r, 5, 9); // inclusive both ends
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it('randInDisc returns points within the disc', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const p = randInDisc(r, 5);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(5);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/map/prng.test.ts`
Expected: FAIL with "Cannot find module './prng'"

- [ ] **Step 3: Implement the PRNG and helpers**

Create `src/map/prng.ts`:

```ts
export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(r: RNG, lo: number, hi: number): number {
  return lo + r() * (hi - lo);
}

export function randInt(r: RNG, lo: number, hi: number): number {
  return Math.floor(lo + r() * (hi - lo + 1));
}

export function randInDisc(r: RNG, radius: number): { x: number; y: number } {
  // Rejection sample for uniform disc distribution.
  for (;;) {
    const x = (r() * 2 - 1) * radius;
    const y = (r() * 2 - 1) * radius;
    if (x * x + y * y <= radius * radius) return { x, y };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/map/prng.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/map/prng.ts src/map/prng.test.ts
git commit -m "feat(map): mulberry32 PRNG + helpers for terrain generation"
```

---

## Task 3: Terrain generator — meadows + fields + hedgerows + trees

**Files:**
- Create: `src/map/terrain-gen.ts`
- Create: `src/map/terrain-gen.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/map/terrain-gen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateMapFeatures } from './terrain-gen';

const SIZE = { w: 2000, h: 2000 };

describe('generateMapFeatures', () => {
  it('is deterministic for the same seed', () => {
    const a = generateMapFeatures(7, SIZE);
    const b = generateMapFeatures(7, SIZE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different feature sets', () => {
    const a = generateMapFeatures(7, SIZE);
    const b = generateMapFeatures(8, SIZE);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('emits all four feature kinds', () => {
    const f = generateMapFeatures(7, SIZE);
    const kinds = new Set(f.map(x => x.kind));
    expect(kinds.has('meadow_region')).toBe(true);
    expect(kinds.has('field')).toBe(true);
    expect(kinds.has('hedgerow')).toBe(true);
    expect(kinds.has('tree_cluster')).toBe(true);
  });

  it('assigns unique ids', () => {
    const f = generateMapFeatures(7, SIZE);
    const ids = new Set(f.map(x => x.id));
    expect(ids.size).toBe(f.length);
  });

  it('keeps every feature inside the world bounds', () => {
    const f = generateMapFeatures(7, SIZE);
    for (const feat of f) {
      const points: { x: number; y: number }[] = [];
      if (feat.shape.type === 'polyline' || feat.shape.type === 'polygon') {
        points.push(...feat.shape.points);
      } else if (feat.shape.type === 'cluster') {
        points.push({ x: feat.shape.cx, y: feat.shape.cy });
      }
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(SIZE.w);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(SIZE.h);
      }
    }
  });

  it('every field has a crop and rowAngle', () => {
    const f = generateMapFeatures(7, SIZE);
    for (const feat of f) {
      if (feat.kind === 'field') {
        expect(feat.field).toBeDefined();
        expect(['wheat', 'furrow', 'stubble']).toContain(feat.field!.crop);
        expect(typeof feat.field!.rowAngle).toBe('number');
      }
    }
  });

  it('every meadow has a tint and softness', () => {
    const f = generateMapFeatures(7, SIZE);
    for (const feat of f) {
      if (feat.kind === 'meadow_region') {
        expect(feat.meadow).toBeDefined();
        expect(feat.meadow!.tint).toHaveLength(3);
        expect(feat.meadow!.softness).toBeGreaterThanOrEqual(0);
        expect(feat.meadow!.softness).toBeLessThanOrEqual(1);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/map/terrain-gen.test.ts`
Expected: FAIL with "Cannot find module './terrain-gen'"

- [ ] **Step 3: Implement the generator**

Create `src/map/terrain-gen.ts`:

```ts
import type { MapFeature } from '../data/types';
import { mulberry32, randRange, randInt, type RNG } from './prng';

interface Size { w: number; h: number }

const FIELD_REGION = { w: 600, h: 600 };
const MEADOW_COUNT = { lo: 1, hi: 2 };
const FIELD_COUNT  = { lo: 6, hi: 12 };
const TREE_CLUSTER_COUNT = { lo: 4, hi: 8 };

const CROP_TYPES: Array<'wheat' | 'furrow' | 'stubble'> = ['wheat', 'furrow', 'stubble'];

let nextId = 1;
function alloc(): number { return nextId++; }

function defaultBlockingFor(kind: MapFeature['kind']) {
  switch (kind) {
    case 'tree_cluster': return { blocksMovement: false, blocksProjectile: false, blocksSight: true,  cover: 0.4, height: 12 };
    case 'field':        return { blocksMovement: false, blocksProjectile: false, blocksSight: false, cover: 0,   height: 0 };
    case 'meadow_region':return { blocksMovement: false, blocksProjectile: false, blocksSight: false, cover: 0,   height: 0 };
    case 'hedgerow':     return { blocksMovement: true,  blocksProjectile: false, blocksSight: true,  cover: 0.6, height: 1.5 };
    default:             return { blocksMovement: true,  blocksProjectile: true,  blocksSight: true,  cover: 0.8, height: 4 };
  }
}

function meadowPolygon(r: RNG, cx: number, cy: number, radius: number): { x: number; y: number }[] {
  const n = randInt(r, 5, 8);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + randRange(r, -0.15, 0.15);
    const rr = radius * randRange(r, 0.75, 1.0);
    pts.push({ x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr });
  }
  return pts;
}

function rotatedRect(cx: number, cy: number, w: number, h: number, ang: number): { x: number; y: number }[] {
  const c = Math.cos(ang), s = Math.sin(ang);
  const hw = w / 2, hh = h / 2;
  const corners = [
    { x: -hw, y: -hh }, { x:  hw, y: -hh },
    { x:  hw, y:  hh }, { x: -hw, y:  hh },
  ];
  return corners.map(p => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
}

function clamp01World(p: { x: number; y: number }, size: Size) {
  return { x: Math.max(0, Math.min(size.w, p.x)), y: Math.max(0, Math.min(size.h, p.y)) };
}

function clampPoly(pts: { x: number; y: number }[], size: Size) {
  return pts.map(p => clamp01World(p, size));
}

function distToBox(p: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

export function generateMapFeatures(seed: number, size: Size): MapFeature[] {
  nextId = 1;
  const r = mulberry32(seed);
  const out: MapFeature[] = [];

  // 1. Meadows
  const meadowCount = randInt(r, MEADOW_COUNT.lo, MEADOW_COUNT.hi);
  const meadowBoxes: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < meadowCount; i++) {
    const radius = randRange(r, 200, 400);
    const cx = randRange(r, radius, size.w - radius);
    const cy = randRange(r, radius, size.h - radius);
    const pts = clampPoly(meadowPolygon(r, cx, cy, radius), size);
    meadowBoxes.push({ x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 });
    out.push({
      id: alloc(),
      kind: 'meadow_region',
      shape: { type: 'polygon', points: pts },
      ...defaultBlockingFor('meadow_region'),
      meadow: {
        tint: [
          randRange(r, 0.88, 0.98),
          randRange(r, 1.00, 1.08),
          randRange(r, 0.92, 1.00),
        ] as [number, number, number],
        softness: randRange(r, 0.4, 0.8),
      },
    });
  }

  // 2. Fields — pack jittered rectangles inside one region.
  const regionX = randRange(r, 100, size.w - FIELD_REGION.w - 100);
  const regionY = randRange(r, 100, size.h - FIELD_REGION.h - 100);
  const fieldCount = randInt(r, FIELD_COUNT.lo, FIELD_COUNT.hi);
  const fieldRecords: { id: number; cx: number; cy: number; corners: { x: number; y: number }[] }[] = [];
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  let attempts = 0;
  while (fieldRecords.length < fieldCount && attempts < fieldCount * 20) {
    attempts++;
    const fw = randRange(r, 80, 180);
    const fh = randRange(r, 80, 180);
    const cx = randRange(r, regionX + fw / 2, regionX + FIELD_REGION.w - fw / 2);
    const cy = randRange(r, regionY + fh / 2, regionY + FIELD_REGION.h - fh / 2);
    const bbox = { x: cx - fw / 2 - 2, y: cy - fh / 2 - 2, w: fw + 4, h: fh + 4 };
    let overlap = false;
    for (const p of placed) {
      if (!(bbox.x + bbox.w < p.x || p.x + p.w < bbox.x || bbox.y + bbox.h < p.y || p.y + p.h < bbox.y)) {
        overlap = true; break;
      }
    }
    if (overlap) continue;
    placed.push(bbox);
    const ang = randRange(r, -Math.PI / 12, Math.PI / 12);
    const corners = clampPoly(rotatedRect(cx, cy, fw, fh, ang), size);
    const id = alloc();
    fieldRecords.push({ id, cx, cy, corners });
    const crop = CROP_TYPES[randInt(r, 0, CROP_TYPES.length - 1)]!;
    out.push({
      id,
      kind: 'field',
      shape: { type: 'polygon', points: corners },
      ...defaultBlockingFor('field'),
      field: { crop, rowAngle: ang + randRange(r, -0.05, 0.05) },
    });
  }

  // 3. Hedgerows — emit polylines along ~70% of the edges between adjacent fields.
  // Two fields are "adjacent" when their bounding boxes are within 4m of each other.
  for (let i = 0; i < fieldRecords.length; i++) {
    for (let j = i + 1; j < fieldRecords.length; j++) {
      const a = placed[i]!, b = placed[j]!;
      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (xOverlap > 8 && Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) < (a.h + b.h) / 2 + 4) {
        // Stacked vertically — emit horizontal hedge along their shared edge.
        if (r() < 0.7) {
          const x0 = Math.max(a.x, b.x) + 2;
          const x1 = Math.min(a.x + a.w, b.x + b.w) - 2;
          const y  = (a.y < b.y ? a.y + a.h : b.y + b.h) - 2;
          out.push({
            id: alloc(),
            kind: 'hedgerow',
            shape: { type: 'polyline', points: [{ x: x0, y }, { x: x1, y }] },
            ...defaultBlockingFor('hedgerow'),
          });
        }
      } else if (yOverlap > 8 && Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) < (a.w + b.w) / 2 + 4) {
        if (r() < 0.7) {
          const y0 = Math.max(a.y, b.y) + 2;
          const y1 = Math.min(a.y + a.h, b.y + b.h) - 2;
          const x  = (a.x < b.x ? a.x + a.w : b.x + b.w) - 2;
          out.push({
            id: alloc(),
            kind: 'hedgerow',
            shape: { type: 'polyline', points: [{ x, y: y0 }, { x, y: y1 }] },
            ...defaultBlockingFor('hedgerow'),
          });
        }
      }
    }
  }

  // 4. Tree clusters — biased away from field bboxes and meadow boxes.
  const treeCount = randInt(r, TREE_CLUSTER_COUNT.lo, TREE_CLUSTER_COUNT.hi);
  let treeAttempts = 0;
  let placedTrees = 0;
  while (placedTrees < treeCount && treeAttempts < treeCount * 20) {
    treeAttempts++;
    const radius = randRange(r, 30, 80);
    const cx = randRange(r, radius + 20, size.w - radius - 20);
    const cy = randRange(r, radius + 20, size.h - radius - 20);
    let tooClose = false;
    for (const p of placed)       if (distToBox({ x: cx, y: cy }, p) < radius + 30) { tooClose = true; break; }
    for (const p of meadowBoxes)  if (distToBox({ x: cx, y: cy }, p) < radius + 10) { tooClose = true; break; }
    if (tooClose) continue;
    placedTrees++;
    out.push({
      id: alloc(),
      kind: 'tree_cluster',
      shape: { type: 'cluster', cx, cy, radius, density: randRange(r, 0.04, 0.10), seed: Math.floor(r() * 1e9) },
      ...defaultBlockingFor('tree_cluster'),
    });
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/map/terrain-gen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/map/terrain-gen.ts src/map/terrain-gen.test.ts
git commit -m "feat(map): seeded generator for meadows, fields, hedgerows, tree clusters"
```

---

## Task 4: Wire generator into `createDefaultMap`

**Files:**
- Modify: `src/map/world-map.ts`

- [ ] **Step 1: Update the file**

Replace contents of `src/map/world-map.ts`:

```ts
import type { MapFeature } from '../data/types';
import { generateMapFeatures } from './terrain-gen';

export interface WorldMap {
  size: { w: number; h: number };
  features: MapFeature[];
}

export function createDefaultMap(seed = 7): WorldMap {
  const size = { w: 2000, h: 2000 };
  return {
    size,
    features: generateMapFeatures(seed, size),
  };
}
```

- [ ] **Step 2: Run typecheck and existing tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/map/world-map.ts
git commit -m "feat(map): default map populates features from seeded generator"
```

---

## Task 5: Hedge texture (procedural pixel-art tile)

**Files:**
- Create: `src/render/hedge-texture.ts`
- Create: `src/render/hedge-texture.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/render/hedge-texture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateHedgeTile, HEDGE_TILE_W, HEDGE_TILE_H } from './hedge-texture';

describe('generateHedgeTile', () => {
  it('produces RGBA pixels of the declared size', () => {
    const px = generateHedgeTile();
    expect(px.length).toBe(HEDGE_TILE_W * HEDGE_TILE_H * 4);
  });

  it('every pixel has full alpha', () => {
    const px = generateHedgeTile();
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255);
  });

  it('is deterministic for the same seed', () => {
    const a = generateHedgeTile(7);
    const b = generateHedgeTile(7);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/render/hedge-texture.test.ts`
Expected: FAIL with "Cannot find module './hedge-texture'"

- [ ] **Step 3: Implement the texture generator**

Create `src/render/hedge-texture.ts`:

```ts
import { clamp } from '../util/math';

export const HEDGE_TILE_W = 256;
export const HEDGE_TILE_H = 64;

const BASE:    [number, number, number] = [29, 44, 16];
const MID:     [number, number, number] = [42, 62, 24];
const HIGH:    [number, number, number] = [91, 122, 48];

function hash32(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(px: number, py: number, period: number, seed: number): number {
  const fx = px - Math.floor(px), fy = py - Math.floor(py);
  const x0 = ((Math.floor(px) % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((Math.floor(py) % period) + period) % period;
  const y1 = (y0 + 1) % period;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v00 = hash32(x0, y0, seed), v10 = hash32(x1, y0, seed);
  const v01 = hash32(x0, y1, seed), v11 = hash32(x1, y1, seed);
  return v00*(1-ux)*(1-uy) + v10*ux*(1-uy) + v01*(1-ux)*uy + v11*ux*uy;
}

export function generateHedgeTile(seed = 11): Uint8Array {
  const px = new Uint8Array(HEDGE_TILE_W * HEDGE_TILE_H * 4);
  for (let y = 0; y < HEDGE_TILE_H; y++) {
    for (let x = 0; x < HEDGE_TILE_W; x++) {
      // Vertical falloff: darker near top and bottom edges (where the hedge ends).
      const v = y / (HEDGE_TILE_H - 1);
      const edgeFalloff = 1 - Math.abs(v - 0.5) * 2; // 1 in middle, 0 at edges
      // Long-axis clump pattern.
      const n1 = valueNoise(x * 8 / HEDGE_TILE_W, y * 4 / HEDGE_TILE_H, 8, seed);
      const n2 = valueNoise(x * 32 / HEDGE_TILE_W, y * 16 / HEDGE_TILE_H, 32, seed + 17);
      const t = clamp(0.5 * n1 + 0.4 * n2 + 0.1 * edgeFalloff, 0, 1);
      let col: [number, number, number];
      if (t < 0.40) col = BASE;
      else if (t < 0.75) col = MID;
      else col = HIGH;
      // Per-pixel grain.
      const g = 0.92 + hash32(x, y, seed + 99) * 0.16;
      const i = (y * HEDGE_TILE_W + x) * 4;
      px[i + 0] = Math.floor(clamp(col[0] * g, 0, 255));
      px[i + 1] = Math.floor(clamp(col[1] * g, 0, 255));
      px[i + 2] = Math.floor(clamp(col[2] * g, 0, 255));
      px[i + 3] = 255;
    }
  }
  return px;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/render/hedge-texture.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/render/hedge-texture.ts src/render/hedge-texture.test.ts
git commit -m "feat(render): procedural pixel-art hedge tile texture"
```

---

## Task 6: Tree-sprite atlas (procedural pixel-art)

**Files:**
- Create: `src/render/tree-sprite.ts`
- Create: `src/render/tree-sprite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/render/tree-sprite.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  generateTreeAtlas, TREE_ATLAS_W, TREE_ATLAS_H,
  TREE_TILE, TREE_VARIANTS,
} from './tree-sprite';

describe('generateTreeAtlas', () => {
  it('atlas dimensions are TREE_TILE * TREE_VARIANTS by TREE_TILE', () => {
    expect(TREE_ATLAS_W).toBe(TREE_TILE * TREE_VARIANTS);
    expect(TREE_ATLAS_H).toBe(TREE_TILE);
  });

  it('returns RGBA pixel data of the declared size', () => {
    const px = generateTreeAtlas();
    expect(px.length).toBe(TREE_ATLAS_W * TREE_ATLAS_H * 4);
  });

  it('every variant has visible canopy (some non-zero alpha pixels)', () => {
    const px = generateTreeAtlas();
    for (let v = 0; v < TREE_VARIANTS; v++) {
      let opaqueCount = 0;
      for (let y = 0; y < TREE_TILE; y++) {
        for (let x = 0; x < TREE_TILE; x++) {
          const xx = v * TREE_TILE + x;
          const i = (y * TREE_ATLAS_W + xx) * 4 + 3;
          if (px[i]! > 0) opaqueCount++;
        }
      }
      expect(opaqueCount, `variant ${v}`).toBeGreaterThan(50);
    }
  });

  it('atlas corners are transparent (canopy is centred)', () => {
    const px = generateTreeAtlas();
    expect(px[3]).toBe(0);                         // top-left
    expect(px[(TREE_ATLAS_W - 1) * 4 + 3]).toBe(0); // top-right
  });

  it('is deterministic for the same seed', () => {
    const a = generateTreeAtlas(13);
    const b = generateTreeAtlas(13);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/render/tree-sprite.test.ts`
Expected: FAIL with "Cannot find module './tree-sprite'"

- [ ] **Step 3: Implement the tree atlas generator**

Create `src/render/tree-sprite.ts`:

```ts
import { clamp } from '../util/math';

export const TREE_TILE = 64;
export const TREE_VARIANTS = 5;
export const TREE_ATLAS_W = TREE_TILE * TREE_VARIANTS;
export const TREE_ATLAS_H = TREE_TILE;

const CANOPY_DEEP: [number, number, number] = [42, 63, 23];
const CANOPY_MID:  [number, number, number] = [61, 86, 33];
const CANOPY_HIGH: [number, number, number] = [91, 122, 48];
const TRUNK:       [number, number, number] = [58, 42, 24];
const SHADOW_RGBA: [number, number, number, number] = [0, 0, 0, 76]; // 30% alpha

function hash32(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function setPixel(px: Uint8Array, atlasX: number, y: number, rgba: [number, number, number, number]) {
  const i = (y * TREE_ATLAS_W + atlasX) * 4;
  px[i + 0] = rgba[0]; px[i + 1] = rgba[1]; px[i + 2] = rgba[2]; px[i + 3] = rgba[3];
}

export function generateTreeAtlas(seed = 13): Uint8Array {
  const px = new Uint8Array(TREE_ATLAS_W * TREE_ATLAS_H * 4);
  // Fully transparent baseline (Uint8Array defaults to 0 which is alpha 0).

  for (let v = 0; v < TREE_VARIANTS; v++) {
    const variantSeed = seed + v * 1009;
    const cx = TREE_TILE / 2 + (hash32(v, 0, variantSeed) - 0.5) * 4;
    const cy = TREE_TILE * 0.42 + (hash32(v, 1, variantSeed) - 0.5) * 4;
    const radiusX = TREE_TILE * (0.30 + 0.06 * hash32(v, 2, variantSeed));
    const radiusY = TREE_TILE * (0.28 + 0.05 * hash32(v, 3, variantSeed));
    const trunkBaseY = TREE_TILE - 4;

    // 1. Slanted shadow blob — short flat ellipse below the trunk base.
    const shadowCY = trunkBaseY + 1;
    const shadowRX = TREE_TILE * 0.42;
    const shadowRY = TREE_TILE * 0.07;
    const shear = -0.45;
    for (let y = 0; y < TREE_TILE; y++) {
      for (let x = 0; x < TREE_TILE; x++) {
        const sx = (x - cx) - shear * (y - shadowCY);
        const sy = y - shadowCY;
        const d = (sx * sx) / (shadowRX * shadowRX) + (sy * sy) / (shadowRY * shadowRY);
        if (d <= 1) setPixel(px, v * TREE_TILE + x, y, SHADOW_RGBA);
      }
    }

    // 2. Canopy — quantised noisy ellipse with a brighter top-left highlight.
    for (let y = 0; y < TREE_TILE; y++) {
      for (let x = 0; x < TREE_TILE; x++) {
        const dx = (x + 0.5) - cx;
        const dy = (y + 0.5) - cy;
        const d2 = (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY);
        if (d2 > 1.0) continue;
        // Light comes from the upper-left.
        const light = (-dx / radiusX + -dy / radiusY) * 0.5 + 0.5; // 0..1
        const noise = hash32(x, y, variantSeed + 41);
        const t = clamp(0.55 * light + 0.30 * noise + 0.15 * (1 - d2), 0, 1);
        let col: [number, number, number];
        if (t < 0.40) col = CANOPY_DEEP;
        else if (t < 0.78) col = CANOPY_MID;
        else col = CANOPY_HIGH;
        const g = 0.93 + hash32(x, y, variantSeed + 7) * 0.14;
        setPixel(px, v * TREE_TILE + x, y, [
          Math.floor(clamp(col[0] * g, 0, 255)),
          Math.floor(clamp(col[1] * g, 0, 255)),
          Math.floor(clamp(col[2] * g, 0, 255)),
          255,
        ]);
      }
    }

    // 3. Trunk peek — small dark rectangle at the bottom centre.
    const trunkW = 4 + Math.floor(hash32(v, 5, variantSeed) * 2);
    const trunkH = 7;
    const tx0 = Math.round(cx - trunkW / 2);
    const ty0 = trunkBaseY - trunkH;
    for (let y = ty0; y < trunkBaseY; y++) {
      for (let x = tx0; x < tx0 + trunkW; x++) {
        const g = 0.85 + hash32(x, y, variantSeed + 3) * 0.20;
        setPixel(px, v * TREE_TILE + x, y, [
          Math.floor(clamp(TRUNK[0] * g, 0, 255)),
          Math.floor(clamp(TRUNK[1] * g, 0, 255)),
          Math.floor(clamp(TRUNK[2] * g, 0, 255)),
          255,
        ]);
      }
    }
  }
  return px;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/render/tree-sprite.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/render/tree-sprite.ts src/render/tree-sprite.test.ts
git commit -m "feat(render): procedural pixel-art tree sprite atlas (5 variants)"
```

---

## Task 7: Meadow tint baked into terrain — extend `terrain-pass`

**Files:**
- Modify: `src/render/passes/terrain-pass.ts`
- Modify: `src/render/shaders/terrain.glsl.ts`

- [ ] **Step 1: Update the fragment shader**

Replace `src/render/shaders/terrain.glsl.ts` contents:

```ts
export const TERRAIN_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_pos;
uniform vec2 u_worldMin;
uniform vec2 u_worldMax;
uniform mat3 u_viewProj;
out vec2 v_worldPos;

void main() {
  vec2 wp = mix(u_worldMin, u_worldMax, a_pos);
  v_worldPos = wp;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const TERRAIN_FS = `#version 300 es
precision highp float;
in vec2 v_worldPos;
uniform sampler2D u_tile;
uniform sampler2D u_blood;
uniform sampler2D u_meadow;
uniform float u_tileSize;
uniform vec2 u_worldSize;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = v_worldPos / u_tileSize;
  vec3 base = texture(u_tile, uv).rgb;

  float macro = vnoise(v_worldPos * 0.008);
  float meso  = vnoise(v_worldPos * 1.0);
  float fine  = vnoise(v_worldPos * 4.0);
  float bright = 0.90 + 0.14 * macro + 0.06 * (meso - 0.5) + 0.04 * (fine - 0.5);
  vec3 color = base * bright;

  // Meadow tint: sample the world-space meadow mask and multiply.
  vec2 meadowUv = v_worldPos / u_worldSize;
  if (meadowUv.x >= 0.0 && meadowUv.x <= 1.0 && meadowUv.y >= 0.0 && meadowUv.y <= 1.0) {
    vec4 m = texture(u_meadow, meadowUv);
    color = mix(color, color * m.rgb, m.a);
  }

  vec2 bloodUv = v_worldPos / u_worldSize;
  float stain = 0.0;
  if (bloodUv.x >= 0.0 && bloodUv.x <= 1.0 && bloodUv.y >= 0.0 && bloodUv.y <= 1.0) {
    stain = texture(u_blood, bloodUv).r;
  }
  vec3 bloodCol = vec3(0.18, 0.02, 0.02);
  color = mix(color, bloodCol, clamp(stain * 0.5, 0.0, 0.5));

  outColor = vec4(color, 1.0);
}
`;
```

- [ ] **Step 2: Update the terrain pass to bind the meadow mask**

Replace `src/render/passes/terrain-pass.ts` contents:

```ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import { generateGrassTile } from '../grass-texture';
import { TERRAIN_VS, TERRAIN_FS } from '../shaders/terrain.glsl';
import type { Camera } from '../camera';
import { viewProjection, screenToWorld } from '../camera';

export interface TerrainPass {
  draw(cam: Camera): void;
  setBlood(texture: WebGLTexture, worldW: number, worldH: number): void;
  setMeadow(texture: WebGLTexture): void;
}

export function createTerrainPass(gl: WebGL2RenderingContext): TerrainPass {
  const prog = linkProgram(gl, TERRAIN_VS, TERRAIN_FS);
  const u = getUniforms(gl, prog, [
    'u_worldMin', 'u_worldMax', 'u_viewProj', 'u_tile', 'u_tileSize',
    'u_blood', 'u_meadow', 'u_worldSize',
  ] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);
  const quad = new Float32Array([
    0, 0,  1, 0,  0, 1,
    0, 1,  1, 0,  1, 1,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const tileSize = 3072;
  const tile = createTextureRGBA(gl, tileSize, tileSize, generateGrassTile(tileSize));
  const tileWorldUnits = 2048;

  const fallbackBlood = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, fallbackBlood);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // 1×1 transparent fallback so the meadow sampler is bound before setMeadow runs.
  const fallbackMeadow = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, fallbackMeadow);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let blood: WebGLTexture = fallbackBlood;
  let meadow: WebGLTexture = fallbackMeadow;
  let worldW = 1, worldH = 1;

  return {
    setBlood(texture, w, h) { blood = texture; worldW = w; worldH = h; },
    setMeadow(texture)      { meadow = texture; },
    draw(cam) {
      const min = screenToWorld(cam, { x: 0, y: 0 });
      const max = screenToWorld(cam, { x: cam.viewport.w, y: cam.viewport.h });
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tile);   gl.uniform1i(u.u_tile, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blood);  gl.uniform1i(u.u_blood, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, meadow); gl.uniform1i(u.u_meadow, 2);
      gl.uniform1f(u.u_tileSize, tileWorldUnits);
      gl.uniform2f(u.u_worldSize, worldW, worldH);
      gl.uniform2f(u.u_worldMin, min.x, min.y);
      gl.uniform2f(u.u_worldMax, max.x, max.y);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },
  };
}
```

- [ ] **Step 3: Run typecheck and existing tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/render/passes/terrain-pass.ts src/render/shaders/terrain.glsl.ts
git commit -m "feat(render): meadow tint sampler in terrain pass"
```

---

## Task 8: Build the meadow mask in the renderer

**Files:**
- Modify: `src/render/renderer.ts`

- [ ] **Step 1: Add a helper that builds the meadow mask texture**

At the top of `src/render/renderer.ts`, after the existing imports, add:

```ts
import type { WorldMap } from '../map/world-map';
import type { MapFeature } from '../data/types';
```

Then add this helper above `createRenderer`:

```ts
const MEADOW_MASK_SIZE = 512;

function buildMeadowMask(gl: WebGL2RenderingContext, map: WorldMap): WebGLTexture {
  const canvas = document.createElement('canvas');
  canvas.width = MEADOW_MASK_SIZE;
  canvas.height = MEADOW_MASK_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0)';
  ctx.fillRect(0, 0, MEADOW_MASK_SIZE, MEADOW_MASK_SIZE);
  const sx = MEADOW_MASK_SIZE / map.size.w;
  const sy = MEADOW_MASK_SIZE / map.size.h;
  for (const f of map.features) {
    if (f.kind !== 'meadow_region' || f.shape.type !== 'polygon' || !f.meadow) continue;
    const r = Math.floor(f.meadow.tint[0] * 255);
    const g = Math.floor(f.meadow.tint[1] * 255);
    const b = Math.floor(f.meadow.tint[2] * 255);
    // Soft alpha: paint the polygon, then blur via a stack of progressively
    // smaller alpha-multiplied passes. For v1 a simple shadowBlur is enough.
    ctx.shadowColor = `rgba(${r},${g},${b},1)`;
    ctx.shadowBlur = Math.max(8, f.meadow.softness * 64);
    ctx.fillStyle = `rgba(${r},${g},${b},1)`;
    ctx.beginPath();
    const pts = f.shape.points;
    ctx.moveTo(pts[0]!.x * sx, pts[0]!.y * sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x * sx, pts[i]!.y * sy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
```

- [ ] **Step 2: Add `map` to `createRenderer`'s signature and call the helper**

Update `createRenderer`'s parameter list (currently lines ~62-75) to take `map: WorldMap` as a new last argument:

```ts
export function createRenderer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  capacity: number,
  particleCapacity: number,
  puffCapacity: number,
  projectileCapacity: number,
  worldW: number,
  worldH: number,
  poseAtlas: PoseAtlas | null,
  kits: ReadonlyMap<string, KitConfig> = new Map(),
  debrisAtlas: DebrisAtlas | null = null,
  debrisCapacity = 256,
  map: WorldMap | null = null,
): Renderer {
```

Inside the body, after `terrain.setBlood(...)`:

```ts
  if (map) terrain.setMeadow(buildMeadowMask(gl, map));
```

- [ ] **Step 3: Pass `map` from `main.ts`**

In `src/main.ts:73-77` add `map` as the final argument:

```ts
const renderer = createRenderer(
  gl, canvas, CAPACITY, PARTICLE_CAPACITY, PUFF_CAPACITY, PROJECTILE_CAPACITY,
  map.size.w, map.size.h, poseAtlas, kits,
  debrisAtlas, undefined, map,
);
```

(Note: `debrisCapacity` keeps its default via `undefined`.)

- [ ] **Step 4: Run typecheck + tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 5: Manually verify in dev mode**

Run: `npm run dev`
Open the browser; the green field should now show 1–2 subtle softer-green patches (the meadows). If the page is fully green with no patches visible, check the browser console for shader compile errors.

- [ ] **Step 6: Commit**

```bash
git add src/render/renderer.ts src/main.ts
git commit -m "feat(render): build meadow mask from WorldMap and feed terrain pass"
```

---

## Task 9: Field shader

**Files:**
- Create: `src/render/shaders/field.glsl.ts`

- [ ] **Step 1: Create the shader file**

Create `src/render/shaders/field.glsl.ts`:

```ts
export const FIELD_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_worldPos;
layout(location = 1) in vec3 a_palette0;
layout(location = 2) in vec3 a_palette1;
layout(location = 3) in vec3 a_palette2;
layout(location = 4) in vec2 a_rowDir;     // (cos, sin) of rowAngle
layout(location = 5) in float a_rowPhase;  // 0..100, per-field

uniform mat3 u_viewProj;

out vec2  v_worldPos;
out vec3  v_p0;
out vec3  v_p1;
out vec3  v_p2;
out vec2  v_rowDir;
out float v_rowPhase;

void main() {
  v_worldPos = a_worldPos;
  v_p0 = a_palette0;
  v_p1 = a_palette1;
  v_p2 = a_palette2;
  v_rowDir = a_rowDir;
  v_rowPhase = a_rowPhase;
  vec3 clip = u_viewProj * vec3(a_worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const FIELD_FS = `#version 300 es
precision highp float;

in vec2  v_worldPos;
in vec3  v_p0;
in vec3  v_p1;
in vec3  v_p2;
in vec2  v_rowDir;
in float v_rowPhase;

out vec4 outColor;

float hash11(float n) {
  return fract(sin(n) * 43758.5453);
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  // World-aligned row coordinate (metres). Rows are 0.6m wide.
  float r = dot(v_worldPos, v_rowDir) + v_rowPhase;
  float band = floor(r / 0.6);

  // Pick one of the three palette stops per band.
  float pick = hash11(band);
  vec3 col;
  if (pick < 0.40)      col = v_p0; // crest
  else if (pick < 0.75) col = v_p1; // mid
  else                  col = v_p2; // furrow

  // Per-pixel grain so the rows aren't perfectly flat.
  float g = 0.92 + hash21(v_worldPos * 4.0) * 0.16;
  outColor = vec4(col * g, 1.0);
}
`;
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/render/shaders/field.glsl.ts
git commit -m "feat(render): striped-row field shader"
```

---

## Task 10: Fields pass — triangulation + draw

**Files:**
- Create: `src/render/passes/fields-pass.ts`
- Create: `src/render/passes/fields-pass.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/render/passes/fields-pass.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { triangulateField } from './fields-pass';

describe('triangulateField', () => {
  it('triangulates a 4-vertex convex polygon into 2 triangles (6 vertices)', () => {
    const verts = triangulateField([
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ]);
    expect(verts.length / 2).toBe(6);
  });

  it('triangulates a 6-vertex convex polygon into 4 triangles (12 vertices)', () => {
    const verts = triangulateField([
      { x: 0, y: 0 }, { x: 5, y: -2 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 5, y: 12 }, { x: 0, y: 10 },
    ]);
    expect(verts.length / 2).toBe(12);
  });

  it('first triangle shares vertex 0', () => {
    const verts = triangulateField([
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ]);
    expect(verts[0]).toBe(0); // x of vertex 0
    expect(verts[1]).toBe(0); // y of vertex 0
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/render/passes/fields-pass.test.ts`
Expected: FAIL with "Cannot find module './fields-pass'"

- [ ] **Step 3: Implement the fields pass**

Create `src/render/passes/fields-pass.ts`:

```ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { FIELD_VS, FIELD_FS } from '../shaders/field.glsl';
import { viewProjection } from '../camera';
import type { Camera } from '../camera';
import type { WorldMap } from '../../map/world-map';
import type { MapFeature } from '../../data/types';

export interface FieldsPass {
  draw(cam: Camera): void;
}

const PALETTE: Record<'wheat' | 'furrow' | 'stubble', [
  [number, number, number], [number, number, number], [number, number, number]
]> = {
  wheat:   [[0.722, 0.576, 0.259], [0.851, 0.702, 0.345], [0.627, 0.494, 0.212]],
  furrow:  [[0.353, 0.239, 0.133], [0.478, 0.345, 0.196], [0.290, 0.188, 0.094]],
  stubble: [[0.545, 0.486, 0.267], [0.647, 0.588, 0.333], [0.435, 0.384, 0.204]],
};

/**
 * Fan-triangulate a convex polygon into a flat [x,y, x,y, ...] vertex array.
 * Returns 2 * (n-2) * 3 floats.
 */
export function triangulateField(pts: { x: number; y: number }[]): Float32Array {
  if (pts.length < 3) return new Float32Array(0);
  const out = new Float32Array((pts.length - 2) * 3 * 2);
  let o = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    out[o++] = pts[0]!.x; out[o++] = pts[0]!.y;
    out[o++] = pts[i]!.x; out[o++] = pts[i]!.y;
    out[o++] = pts[i + 1]!.x; out[o++] = pts[i + 1]!.y;
  }
  return out;
}

export function createFieldsPass(gl: WebGL2RenderingContext, map: WorldMap): FieldsPass {
  const prog = linkProgram(gl, FIELD_VS, FIELD_FS);
  const u = getUniforms(gl, prog, ['u_viewProj'] as const);

  const fields = map.features.filter(
    (f): f is MapFeature & { shape: { type: 'polygon'; points: { x: number; y: number }[] } } =>
      f.kind === 'field' && f.shape.type === 'polygon' && !!f.field,
  );

  // Pack a single big vertex buffer with all per-vertex attributes inline.
  // Layout per vertex: x, y, p0r,p0g,p0b, p1r,p1g,p1b, p2r,p2g,p2b, rowCos, rowSin, rowPhase = 14 floats
  const STRIDE = 14;
  const pieces: number[] = [];
  for (const f of fields) {
    const tri = triangulateField(f.shape.points);
    const palette = PALETTE[f.field!.crop];
    const rowCos = Math.cos(f.field!.rowAngle);
    const rowSin = Math.sin(f.field!.rowAngle);
    const phase = (f.id * 17.31) % 100;
    for (let i = 0; i < tri.length; i += 2) {
      pieces.push(
        tri[i]!, tri[i + 1]!,
        palette[0]![0]!, palette[0]![1]!, palette[0]![2]!,
        palette[1]![0]!, palette[1]![1]!, palette[1]![2]!,
        palette[2]![0]!, palette[2]![1]!, palette[2]![2]!,
        rowCos, rowSin, phase,
      );
    }
  }
  const buf = new Float32Array(pieces);
  const vertexCount = buf.length / STRIDE;

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);
  createBuffer(gl, gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  const F = 4; // sizeof(float)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE * F, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * F, 2 * F);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, STRIDE * F, 5 * F);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE * F, 8 * F);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, STRIDE * F, 11 * F);
  gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, STRIDE * F, 13 * F);
  gl.bindVertexArray(null);

  return {
    draw(cam) {
      if (vertexCount === 0) return;
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      gl.bindVertexArray(null);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/render/passes/fields-pass.test.ts`
Expected: PASS

- [ ] **Step 5: Wire fields pass into the renderer**

In `src/render/renderer.ts`, add the import:

```ts
import { createFieldsPass, type FieldsPass } from './passes/fields-pass';
```

In `createRenderer`, after the meadow-mask call, build the fields pass (only if `map` was passed):

```ts
const fieldsPass: FieldsPass | null = map ? createFieldsPass(gl, map) : null;
```

In the `render()` body, immediately after `terrain.draw(cam);`:

```ts
if (fieldsPass) fieldsPass.draw(cam);
```

- [ ] **Step 6: Run typecheck + tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 7: Manually verify in dev mode**

Run: `npm run dev`
Open the browser; you should see ~6–12 rectangular striped patches in one region of the map (the field cluster). Each field's stripes should run at slightly different angles. If the patches appear flat-coloured (no stripes visible), zoom in.

- [ ] **Step 8: Commit**

```bash
git add src/render/passes/fields-pass.ts src/render/passes/fields-pass.test.ts src/render/renderer.ts
git commit -m "feat(render): fields pass with striped-row shader"
```

---

## Task 11: Hedgerow shader

**Files:**
- Create: `src/render/shaders/hedgerow.glsl.ts`

- [ ] **Step 1: Create the shader file**

Create `src/render/shaders/hedgerow.glsl.ts`:

```ts
export const HEDGE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_worldPos;
layout(location = 1) in vec2 a_uv;

uniform mat3 u_viewProj;
out vec2 v_uv;

void main() {
  v_uv = a_uv;
  vec3 clip = u_viewProj * vec3(a_worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const HEDGE_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tile;
out vec4 outColor;

void main() {
  outColor = texture(u_tile, v_uv);
}
`;
```

- [ ] **Step 2: Commit**

```bash
git add src/render/shaders/hedgerow.glsl.ts
git commit -m "feat(render): hedgerow tile shader"
```

---

## Task 12: Hedgerows pass

**Files:**
- Create: `src/render/passes/hedgerows-pass.ts`

- [ ] **Step 1: Implement the hedgerows pass**

Create `src/render/passes/hedgerows-pass.ts`:

```ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import { generateHedgeTile, HEDGE_TILE_W, HEDGE_TILE_H } from '../hedge-texture';
import { HEDGE_VS, HEDGE_FS } from '../shaders/hedgerow.glsl';
import { viewProjection } from '../camera';
import type { Camera } from '../camera';
import type { WorldMap } from '../../map/world-map';

export interface HedgerowsPass {
  draw(cam: Camera): void;
}

const HEDGE_HALF_WIDTH = 1.0; // metres; total hedge width 2m
const TILE_WORLD_LEN   = 6.0; // metres of hedge per full tile repeat along its length

export function createHedgerowsPass(gl: WebGL2RenderingContext, map: WorldMap): HedgerowsPass {
  const prog = linkProgram(gl, HEDGE_VS, HEDGE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj', 'u_tile'] as const);

  const tile = createTextureRGBA(gl, HEDGE_TILE_W, HEDGE_TILE_H, generateHedgeTile());

  // Build one big vertex buffer of all hedge quads.
  // Per vertex: x, y, u, v = 4 floats. Each polyline segment = 6 vertices (2 triangles).
  const STRIDE = 4;
  const pieces: number[] = [];
  for (const f of map.features) {
    if (f.kind !== 'hedgerow' || f.shape.type !== 'polyline') continue;
    const pts = f.shape.points;
    let runningU = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) continue;
      const nx = -dy / len, ny = dx / len; // perpendicular
      const aL = { x: a.x + nx * HEDGE_HALF_WIDTH, y: a.y + ny * HEDGE_HALF_WIDTH };
      const aR = { x: a.x - nx * HEDGE_HALF_WIDTH, y: a.y - ny * HEDGE_HALF_WIDTH };
      const bL = { x: b.x + nx * HEDGE_HALF_WIDTH, y: b.y + ny * HEDGE_HALF_WIDTH };
      const bR = { x: b.x - nx * HEDGE_HALF_WIDTH, y: b.y - ny * HEDGE_HALF_WIDTH };
      const u0 = runningU;
      const u1 = runningU + len / TILE_WORLD_LEN;
      runningU = u1;
      // Two triangles: (aL,aR,bL), (bL,aR,bR)
      pieces.push(
        aL.x, aL.y, u0, 0,
        aR.x, aR.y, u0, 1,
        bL.x, bL.y, u1, 0,

        bL.x, bL.y, u1, 0,
        aR.x, aR.y, u0, 1,
        bR.x, bR.y, u1, 1,
      );
    }
  }
  const buf = new Float32Array(pieces);
  const vertexCount = buf.length / STRIDE;

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);
  createBuffer(gl, gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  const F = 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE * F, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE * F, 2 * F);
  gl.bindVertexArray(null);

  return {
    draw(cam) {
      if (vertexCount === 0) return;
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tile); gl.uniform1i(u.u_tile, 0);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      gl.bindVertexArray(null);
    },
  };
}
```

- [ ] **Step 2: Wire hedgerows pass into the renderer**

In `src/render/renderer.ts`, add import:

```ts
import { createHedgerowsPass, type HedgerowsPass } from './passes/hedgerows-pass';
```

In `createRenderer`, after the fields pass:

```ts
const hedgerowsPass: HedgerowsPass | null = map ? createHedgerowsPass(gl, map) : null;
```

In `render()`, immediately after `if (fieldsPass) fieldsPass.draw(cam);`:

```ts
if (hedgerowsPass) hedgerowsPass.draw(cam);
```

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 4: Manually verify in dev mode**

Run: `npm run dev`
You should see thin dark-green lines along most edges between adjacent fields.

- [ ] **Step 5: Commit**

```bash
git add src/render/passes/hedgerows-pass.ts src/render/renderer.ts
git commit -m "feat(render): hedgerows pass with tiled hedge texture"
```

---

## Task 13: Tree shader

**Files:**
- Create: `src/render/shaders/tree.glsl.ts`

- [ ] **Step 1: Create the shader file**

Create `src/render/shaders/tree.glsl.ts`:

```ts
export const TREE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // unit-quad corner (-0.5..+0.5 on x, -1..0 on y so origin is at the trunk base)
layout(location = 1) in vec2 a_worldPos;   // per-instance: trunk-base world position
layout(location = 2) in float a_scale;     // per-instance: world units across the tile
layout(location = 3) in float a_variant;   // per-instance: which atlas slice (0..VARIANTS-1)

uniform mat3 u_viewProj;
uniform float u_atlasGrid;                 // number of variants in the atlas (= ATLAS_W / TILE)

out vec2 v_uv;
flat out float v_variant;

void main() {
  vec2 wp = a_worldPos + a_corner * a_scale;
  v_uv = vec2(a_corner.x + 0.5, -a_corner.y);  // 0..1 within the variant tile
  v_variant = a_variant;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const TREE_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
flat in float v_variant;

uniform sampler2D u_atlas;
uniform float u_atlasGrid;

out vec4 outColor;

void main() {
  float u = (v_variant + v_uv.x) / u_atlasGrid;
  float v = v_uv.y;
  vec4 c = texture(u_atlas, vec2(u, v));
  if (c.a < 0.05) discard;
  outColor = c;
}
`;
```

- [ ] **Step 2: Commit**

```bash
git add src/render/shaders/tree.glsl.ts
git commit -m "feat(render): tree atlas shader"
```

---

## Task 14: Trees pass — cluster expansion + per-instance draw

**Files:**
- Create: `src/render/passes/trees-pass.ts`

- [ ] **Step 1: Implement the trees pass**

Create `src/render/passes/trees-pass.ts`:

```ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import {
  generateTreeAtlas, TREE_ATLAS_W, TREE_ATLAS_H, TREE_VARIANTS,
} from '../tree-sprite';
import { TREE_VS, TREE_FS } from '../shaders/tree.glsl';
import { mulberry32, randInDisc, randInt, randRange } from '../../map/prng';
import { viewProjection } from '../camera';
import type { Camera } from '../camera';
import type { WorldMap } from '../../map/world-map';

export interface TreesPass {
  draw(cam: Camera): void;
}

const TREE_WORLD_SIZE = 8; // metres across; scaled per instance

interface Instance {
  x: number;
  y: number;
  scale: number;
  variant: number;
  footY: number; // for back-to-front sort
}

function expandClusters(map: WorldMap): Instance[] {
  const out: Instance[] = [];
  for (const f of map.features) {
    if (f.kind !== 'tree_cluster' || f.shape.type !== 'cluster') continue;
    const r = mulberry32(f.shape.seed);
    const area = Math.PI * f.shape.radius * f.shape.radius;
    const n = Math.max(1, Math.ceil(f.shape.density * area));
    for (let i = 0; i < n; i++) {
      const p = randInDisc(r, f.shape.radius);
      const scale = randRange(r, 0.85, 1.15) * TREE_WORLD_SIZE;
      const variant = randInt(r, 0, TREE_VARIANTS - 1);
      const x = f.shape.cx + p.x;
      const y = f.shape.cy + p.y;
      out.push({ x, y, scale, variant, footY: y });
    }
  }
  // Back-to-front by footY (smaller world-y first, since +y is "south" / "down" on screen).
  out.sort((a, b) => a.footY - b.footY);
  return out;
}

export function createTreesPass(gl: WebGL2RenderingContext, map: WorldMap): TreesPass {
  const prog = linkProgram(gl, TREE_VS, TREE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj', 'u_atlas', 'u_atlasGrid'] as const);

  const atlas = createTextureRGBA(gl, TREE_ATLAS_W, TREE_ATLAS_H, generateTreeAtlas(), {
    wrap: gl.CLAMP_TO_EDGE,
  });

  const instances = expandClusters(map);
  // Per vertex: cornerX, cornerY, worldX, worldY, scale, variant = 6 floats × 6 vertices per quad.
  const STRIDE = 6;
  const buf = new Float32Array(instances.length * 6 * STRIDE);

  // The corner mapping is: x in {-0.5, +0.5}, y in {-1, 0}; +y is "down" in world.
  // Trunk base sits at corner.y = 0 (the bottom of the tile in world coords),
  // canopy extends "up" (corner.y = -1), but in screen-down +y world space the
  // canopy is at smaller y than the trunk base — i.e. the tree visually rises
  // toward the top of the screen. To get this we offset the corner.y so that
  // the world position of corner (0, -1) is at (worldPos.y - scale).
  const CORNERS: [number, number][] = [
    [-0.5, -1], [0.5, -1], [-0.5, 0],
    [-0.5,  0], [0.5, -1], [0.5,  0],
  ];

  let o = 0;
  for (const inst of instances) {
    for (const [cx, cy] of CORNERS) {
      buf[o++] = cx;
      buf[o++] = cy;
      buf[o++] = inst.x;
      buf[o++] = inst.y;
      buf[o++] = inst.scale;
      buf[o++] = inst.variant;
    }
  }
  const vertexCount = instances.length * 6;

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);
  createBuffer(gl, gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
  const F = 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE * F, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE * F, 2 * F);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE * F, 4 * F);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE * F, 5 * F);
  gl.bindVertexArray(null);

  return {
    draw(cam) {
      if (vertexCount === 0) return;
      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.uniform1i(u.u_atlas, 0);
      gl.uniform1f(u.u_atlasGrid, TREE_VARIANTS);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      gl.bindVertexArray(null);
    },
  };
}
```

- [ ] **Step 2: Wire trees pass into the renderer**

In `src/render/renderer.ts`, add import:

```ts
import { createTreesPass, type TreesPass } from './passes/trees-pass';
```

In `createRenderer`, after the hedgerows pass:

```ts
const treesPass: TreesPass | null = map ? createTreesPass(gl, map) : null;
```

In `render()`, **after** `sprites.draw(world, cam);` (so trees render over soldiers per the spec's v1 occlusion choice):

```ts
if (treesPass) treesPass.draw(cam);
```

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 4: Manually verify in dev mode**

Run: `npm run dev`
You should see 4–8 woodlots scattered across the map. Each cluster contains many small tree sprites at varying scales. Trees should not appear inside fields or meadows.

- [ ] **Step 5: Commit**

```bash
git add src/render/passes/trees-pass.ts src/render/renderer.ts
git commit -m "feat(render): trees pass with cluster expansion and per-instance draw"
```

---

## Task 15: Final sanity check

- [ ] **Step 1: Run the full test + typecheck suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS for everything.

- [ ] **Step 2: Run the dev server and walk the map**

Run: `npm run dev`
Confirm in the browser:
- Map shows 1–2 subtly-tinted meadow patches.
- One region has 6–12 striped fields with hedgerows along most adjacent edges.
- 4–8 tree clusters scatter over the rest of the map; trees avoid the field cluster and meadows.
- Soldiers walking near trees are partially obscured by the canopies (expected v1 artefact).
- All ground rendering remains pixelated (NEAREST filtering).

- [ ] **Step 3: Note any v2 follow-ups in the spec**

If anything reads visually wrong (e.g. tree-occlusion artefact too distracting, hedgerows missing from some fields, fields overlapping trees), file the observations as a comment in the spec under "Open questions" — do not start v2 work in this branch.

- [ ] **Step 4: Final commit if anything was tweaked**

```bash
git status
# If anything changed:
git commit -am "chore(terrain): v1 tweaks from manual playtest"
```

---

## Self-Review

**Spec coverage:**
- Trees → Tasks 6, 13, 14 ✓
- Grass variation (meadow tint) → Tasks 7, 8 ✓
- Farm fields with striped rows → Tasks 9, 10 ✓
- Hedgerows → Tasks 5, 11, 12 ✓
- Procedural seeded generator → Tasks 2, 3, 4 ✓
- Data model extension → Task 1 ✓
- Pixel-art (NEAREST filtering) → enforced in `createTextureRGBA` defaults; trees pass uses `wrap: CLAMP_TO_EDGE` and inherits NEAREST ✓
- Z-order (terrain → fields → hedgerows → … → sprites → trees) → Tasks 8, 10, 12, 14 ✓

**Type/name consistency:** `triangulateField` (Task 10) is the only non-trivial cross-task identifier and is used in one place. `mulberry32`, `randInDisc`, `randInt`, `randRange` are introduced in Task 2 and re-used in Tasks 3, 14. `TREE_VARIANTS` is defined in Task 6 and used in Tasks 13, 14.

**Placeholder scan:** No "TBD", no "implement later", no "similar to". Every code step is complete.

**Risk callouts in the plan:**
- v1 tree occlusion: addressed inline in Task 14 step 4.
- Field triangulation: convex-only (fan); any concave field would break — generator only emits convex polygons.
- Hedgerow miter joints: not handled (segments emit independent quads). v1 hedges are single segments, so no joints exist.
