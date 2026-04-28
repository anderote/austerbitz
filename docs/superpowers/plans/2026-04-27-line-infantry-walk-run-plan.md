# Line-infantry walking + running — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `walking` (4-frame) and `running` (6-frame) poses to
line-infantry through the existing components pipeline, with multi-frame
support and a programmatic placeholder seeder for the 80 new trousers
PNGs.

**Architecture:** Three small backwards-compatible extensions to the
components pipeline (kit format, builder, slicer) plus one new seeder
script. The pose-atlas runtime and manifest builder require no changes —
they already support multi-frame clips (cuirassier walking/running proves
it). All new visuals are emitted from the existing per-component PNG
authoring path; anyone can hand-edit any seeded PNG in Aseprite later
without re-running the seeder.

**Tech Stack:** Node 20 ESM, `pngjs` (already a devDep), vitest. Same as
the rest of the components pipeline. Reference spec at
`docs/superpowers/specs/2026-04-27-line-infantry-walk-run-design.md`.

---

## File structure

| Path | Purpose |
|---|---|
| `scripts/build-soldier-components.mjs` | **Modify** — emit one atlas per frame for multi-frame pose entries; single-frame unchanged. |
| `scripts/slice-component-atlas.mjs` | **Rewrite (small)** — replace hardcoded `SOURCES` with a kit walker; supports multi-frame. |
| `scripts/seed-line-infantry-locomotion.mjs` | **Create** — generates 80 trousers walk/run frame PNGs from the existing facing baselines + patches `public/components/index.json` with their entries. |
| `scripts/lib/leg-shift.mjs` | **Create** — small helper: load a 32×36 PNG, identify "leg pixels" (lower 1/3 of opaque content), translate up/down by N pixels, return new RGBA. Shared between seeder and any future hand-tuning utility. |
| `public/components/kits/line-infantry.json` | **Modify** — append `walking` (8 dirs × 4 frames) and `running` (8 dirs × 6 frames) pose entries. |
| `public/components/index.json` | **Modify (auto)** — 80 new trousers entries appended by seeder. |
| `public/sprites/components/uniform/lower/trousers/<facing>-{walk,run}-<i>.png` | **Generated** — 80 placeholder PNGs from seeder. |
| `public/sprites/line-infantry-components-walking-<i>.png` (×4) | **Generated** — by builder. |
| `public/sprites/line-infantry-components-running-<i>.png` (×6) | **Generated** — by builder. |
| `public/sprites/poses/line-infantry/walking/<DIR>/0/<i>.png` (×32) | **Generated** — by slicer. |
| `public/sprites/poses/line-infantry/running/<DIR>/0/<i>.png` (×48) | **Generated** — by slicer. |
| `public/sprites/poses/manifest.json` | **Regenerated** — by `build-pose-manifest.mjs`. |
| `package.json` | **Modify** — add `seed:line-infantry-locomotion` npm script. |
| `scripts/build-soldier-components.test.mjs` | **Create** — small fixture-driven test for multi-frame output. |
| `scripts/slice-component-atlas.test.mjs` | **Create** — small fixture-driven test for kit-walker slicing. |

Naming/identifier conventions (use these exact strings throughout):

- Component IDs: `trousers-<facing-spelled-out>-walk-<i>` and
  `trousers-<facing-spelled-out>-run-<i>`. Facings spelled out per the
  existing convention (`north`, `northeast`, `east`, `southeast`, `south`,
  `southwest`, `west`, `northwest`). Examples:
  - `trousers-south-walk-0`, `trousers-south-walk-3`
  - `trousers-northwest-run-5`
- Component file paths: `uniform/lower/trousers/<facing-spelled-out>-walk-<i>.png`.
- Kit pose names: `walking` and `running` (match the runtime Pose enum
  exactly — no spec-name aliasing for these).
- Atlas filenames: `line-infantry-components-walking-<i>.png` (i in 0..3),
  `line-infantry-components-running-<i>.png` (i in 0..5).

Existing kit-name → runtime-pose-name map (preserve in slicer):

```js
const KIT_TO_RUNTIME_POSE = {
  'idle': 'idle',
  'make-ready': 'reloading',
  'present': 'aiming',
  'fire': 'firing',
  'walking': 'walking',
  'running': 'running',
  // Skipped:
  // 'hit'    — not a runtime Pose enum value
  // 'dying'  — runtime enum exists, kit pose maps directly; include as 'dying'
  // 'musket' — not a runtime pose, skip
};
const SKIP_KIT_POSES = new Set(['musket']);
```

Note: the existing slicer already writes `idle`, `reloading`, `aiming`,
`firing`. The rewrite must produce identical paths/contents for those four
or it will regress today's working sprites.

---

## Task 1: Multi-frame builder support

**Files:**
- Modify: `scripts/build-soldier-components.mjs`

Make the builder emit one atlas per frame for multi-frame pose entries.
Detection rule: examine `kit.poses[poseId]` — if any direction's value is an
array whose first element is **not** a string, treat the whole pose as
multi-frame.

- [ ] **Step 1: Read the current pose-emit loop in `main()` (around lines 336-341).**

Current code:

```js
if (kit.poses && typeof kit.poses === 'object') {
  for (const [poseId, override] of Object.entries(kit.poses)) {
    const poseAtlasPath = withSuffix(outputAtlasPath, `-${poseId}`);
    const posePreviewPath = outputPreviewPath ? withSuffix(outputPreviewPath, `-${poseId}`) : null;
    compositeAndWrite(poseId, override, poseAtlasPath, posePreviewPath, `Compositing pose: ${poseId}`);
  }
}
```

`override` is `Record<facing, layers>` where `layers` is `string[]` for
single-frame poses today.

- [ ] **Step 2: Write a helper `isMultiFrameOverride(override)`.**

Inside the same file (above `main()` is fine):

```js
function isMultiFrameOverride(override) {
  if (!override || typeof override !== 'object') return false;
  for (const value of Object.values(override)) {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (Array.isArray(first)) return true;
      // string[] → single-frame
      return false;
    }
  }
  return false;
}
```

- [ ] **Step 3: Write a helper `frameSliceOverride(override, frameIdx)`.**

Returns a new `Record<facing, string[]>` where each direction's layers are
the frame at `frameIdx` (or the last frame if that direction has fewer
frames):

```js
function frameSliceOverride(override, frameIdx) {
  const out = {};
  for (const [facing, frames] of Object.entries(override)) {
    if (!Array.isArray(frames) || frames.length === 0) continue;
    const useIdx = Math.min(frameIdx, frames.length - 1);
    const layers = frames[useIdx];
    if (!Array.isArray(layers)) {
      throw new Error(`Pose '${facing}' frame ${frameIdx} is not a layer array (got ${typeof layers}).`);
    }
    out[facing] = layers;
  }
  return out;
}

function frameCount(override) {
  let n = 0;
  for (const frames of Object.values(override)) {
    if (Array.isArray(frames)) n = Math.max(n, frames.length);
  }
  return n;
}
```

- [ ] **Step 4: Replace the pose-emit loop body.**

```js
if (kit.poses && typeof kit.poses === 'object') {
  for (const [poseId, override] of Object.entries(kit.poses)) {
    if (isMultiFrameOverride(override)) {
      const n = frameCount(override);
      for (let i = 0; i < n; i++) {
        const sliced = frameSliceOverride(override, i);
        const poseAtlasPath = withSuffix(outputAtlasPath, `-${poseId}-${i}`);
        const posePreviewPath = outputPreviewPath ? withSuffix(outputPreviewPath, `-${poseId}-${i}`) : null;
        compositeAndWrite(poseId, sliced, poseAtlasPath, posePreviewPath, `Compositing pose: ${poseId} frame ${i}`);
      }
    } else {
      const poseAtlasPath = withSuffix(outputAtlasPath, `-${poseId}`);
      const posePreviewPath = outputPreviewPath ? withSuffix(outputPreviewPath, `-${poseId}`) : null;
      compositeAndWrite(poseId, override, poseAtlasPath, posePreviewPath, `Compositing pose: ${poseId}`);
    }
  }
}
```

- [ ] **Step 5: Verify nothing else uses `override` as a flat string-array assumption.**

Run: `grep -n 'layerOverrides\[' scripts/build-soldier-components.mjs`

The only reference inside `compositeAndWrite` is on the line:
`const layers = (layerOverrides && layerOverrides[facing]) || config.layers;`
That's already correct because `frameSliceOverride` always passes a
`Record<facing, string[]>`.

- [ ] **Step 6: Sanity-run the builder against the current single-frame kit (no multi-frame entries yet).**

Run: `node scripts/build-soldier-components.mjs --kit line-infantry`
Expected: same output as before, no errors. The fact that no multi-frame
poses exist yet means the new code paths are not exercised; this just
confirms we didn't break the single-frame path.

- [ ] **Step 7: Do NOT commit.**

The user manages commit boundaries themselves.

---

## Task 2: Slicer rewrite — kit-driven, multi-frame aware

**Files:**
- Modify: `scripts/slice-component-atlas.mjs`

Replace the hardcoded `SOURCES` array with a kit walker that supports
multi-frame poses and preserves single-frame behavior identically.

- [ ] **Step 1: Read the current slicer to understand contract.**

The slicer reads atlases written by the builder, slices each cell, and writes
into `public/sprites/poses/line-infantry/<runtimePose>/<DIR>/0/<frameIdx>.png`.
Today `<frameIdx>` is always `0`.

- [ ] **Step 2: Replace `SOURCES` with a kit walker.**

Replace the current `SOURCES` constant (around line 50) and the `main`
function (around line 105) so the slicer:

1. Reads `public/components/kits/line-infantry.json`.
2. Builds a runtime work-list: an array of
   `{ kind, kitPose, runtimePose, atlasFile, frameIdx, cells }`.
3. For each entry: load the atlas, validate dimensions, slice the listed
   cells to the runtime pose tree.

The old `SOURCES` content is replaced by code; the COMPASS_CELLS, S_CELL,
sliceCell, writePng, loadPng helpers stay the same.

```js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SPRITES = resolve(REPO_ROOT, 'public', 'sprites');
const POSES_OUT = resolve(SPRITES, 'poses');
const KIT_PATH = resolve(REPO_ROOT, 'public', 'components', 'kits', 'line-infantry.json');

const CELL_W = 32;
const CELL_H = 36;

const COMPASS_CELLS = [
  { dir: 'N',  col: 1, row: 2 },
  { dir: 'NE', col: 2, row: 0 },
  { dir: 'E',  col: 2, row: 1 },
  { dir: 'SE', col: 2, row: 2 },
  { dir: 'S',  col: 1, row: 1 },
  { dir: 'SW', col: 0, row: 2 },
  { dir: 'W',  col: 0, row: 1 },
  { dir: 'NW', col: 0, row: 0 },
];
const S_CELL = COMPASS_CELLS.find((c) => c.dir === 'S');
const CELLS_BY_DIR = new Map(COMPASS_CELLS.map((c) => [c.dir, c]));

const KIT_TO_RUNTIME_POSE = {
  'idle':       'idle',
  'make-ready': 'reloading',
  'present':    'aiming',
  'fire':       'firing',
  'walking':    'walking',
  'running':    'running',
  'dying':      'dying',
  // Add new mappings here as kit poses are added.
};
const SKIP_KIT_POSES = new Set(['musket', 'hit']);

function isMultiFrameOverride(override) {
  if (!override || typeof override !== 'object') return false;
  for (const value of Object.values(override)) {
    if (Array.isArray(value) && value.length > 0) {
      return Array.isArray(value[0]);
    }
  }
  return false;
}

function frameCountOf(override) {
  let n = 0;
  for (const frames of Object.values(override)) {
    if (Array.isArray(frames)) n = Math.max(n, frames.length);
  }
  return n;
}

function buildWorkList(kit, kitId) {
  const kindAtlasBase = kit.outputAtlas
    ? kit.outputAtlas.replace(/^public\/sprites\//, '').replace(/\.png$/, '')
    : `${kitId}-components`;
  const work = [];

  // Idle uses the un-suffixed atlas and all 8 facings.
  work.push({
    kind: kitId,
    kitPose: 'idle',
    runtimePose: 'idle',
    atlasFile: `${kindAtlasBase}.png`,
    frameIdx: 0,
    cells: COMPASS_CELLS,
  });

  if (kit.poses && typeof kit.poses === 'object') {
    for (const [kitPose, override] of Object.entries(kit.poses)) {
      if (SKIP_KIT_POSES.has(kitPose)) continue;
      const runtimePose = KIT_TO_RUNTIME_POSE[kitPose];
      if (!runtimePose) {
        console.warn(`[slice-component-atlas] no runtime mapping for kit pose '${kitPose}', skipping`);
        continue;
      }
      const dirsAuthored = Object.keys(override);
      const cells = dirsAuthored
        .map((d) => CELLS_BY_DIR.get(d))
        .filter(Boolean);
      if (isMultiFrameOverride(override)) {
        const n = frameCountOf(override);
        for (let i = 0; i < n; i++) {
          work.push({
            kind: kitId,
            kitPose,
            runtimePose,
            atlasFile: `${kindAtlasBase}-${kitPose}-${i}.png`,
            frameIdx: i,
            cells,
          });
        }
      } else {
        work.push({
          kind: kitId,
          kitPose,
          runtimePose,
          atlasFile: `${kindAtlasBase}-${kitPose}.png`,
          frameIdx: 0,
          cells,
        });
      }
    }
  }

  return work;
}

async function loadPng(path) {
  const buf = await readFile(path);
  return PNG.sync.read(buf);
}

function sliceCell(src, col, row) {
  const srcX = col * CELL_W;
  const srcY = row * CELL_H;
  const out = new PNG({ width: CELL_W, height: CELL_H });
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const sIdx = ((srcY + y) * src.width + (srcX + x)) * 4;
      const dIdx = (y * CELL_W + x) * 4;
      out.data[dIdx + 0] = src.data[sIdx + 0];
      out.data[dIdx + 1] = src.data[sIdx + 1];
      out.data[dIdx + 2] = src.data[sIdx + 2];
      out.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  return out;
}

async function writePng(path, png) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, PNG.sync.write(png));
}

async function main() {
  const kit = JSON.parse(await readFile(KIT_PATH, 'utf8'));
  const work = buildWorkList(kit, kit.id ?? 'line-infantry');

  let written = 0;
  for (const w of work) {
    const srcPath = resolve(SPRITES, w.atlasFile);
    const src = await loadPng(srcPath);
    const expectW = 3 * CELL_W;
    const expectH = 3 * CELL_H;
    if (src.width !== expectW || src.height !== expectH) {
      throw new Error(
        `${w.atlasFile}: expected ${expectW}x${expectH}, got ${src.width}x${src.height}`,
      );
    }
    for (const cell of w.cells) {
      const png = sliceCell(src, cell.col, cell.row);
      const outPath = resolve(POSES_OUT, w.kind, w.runtimePose, cell.dir, '0', `${w.frameIdx}.png`);
      await writePng(outPath, png);
      console.log(`[slice-component-atlas] ${w.runtimePose}/${cell.dir}/${w.frameIdx} ← ${w.atlasFile}`);
      written++;
    }
  }
  console.log(`[slice-component-atlas] done — wrote ${written} sprite${written === 1 ? '' : 's'}`);
}

main().catch((err) => {
  console.error('[slice-component-atlas] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Sanity-run the slicer against the current single-frame state.**

Run: `node scripts/build-soldier-components.mjs --kit line-infantry && node scripts/slice-component-atlas.mjs`
Expected: writes the same paths the slicer wrote before, including
`public/sprites/poses/line-infantry/idle/<DIR>/0/0.png`,
`reloading/S/0/0.png`, `aiming/S/0/0.png`, `firing/S/0/0.png`, plus `dying`
and `hit` paths.

(`hit` is in `SKIP_KIT_POSES`, so it won't get sliced. Verify
`public/sprites/poses/line-infantry/hit/` is unchanged — pre-existing
content stays where it is, since the slicer only writes, never deletes.)

- [ ] **Step 4: Verify pre-existing pose tree is intact.**

Run: `find public/sprites/poses/line-infantry -name '*.png' | sort | head -20`
Expected: each direction's `idle/<DIR>/0/0.png` plus the `S` cell of
`reloading`, `aiming`, `firing`, and `dying`.

- [ ] **Step 5: Do NOT commit.**

The user manages commit boundaries themselves.

---

## Task 3: Builder + slicer fixture tests

**Files:**
- Create: `scripts/build-soldier-components.test.mjs`
- Create: `scripts/slice-component-atlas.test.mjs`

Vitest config currently picks up tests from `src/**/*.test.ts` only.
Extend it minimally to also pick up `scripts/**/*.test.mjs` for these two
tests so they run in `npm test`.

- [ ] **Step 1: Modify `vitest.config.ts`.**

Add `'scripts/**/*.test.mjs'` to the include array:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
```

- [ ] **Step 2: Write the multi-frame helpers test for the builder.**

The builder helpers (`isMultiFrameOverride`, `frameSliceOverride`,
`frameCount`) need to be exported from `scripts/build-soldier-components.mjs`
to be testable. Add to the top-level exports:

```js
// At the bottom of build-soldier-components.mjs, before main():
export { isMultiFrameOverride, frameSliceOverride, frameCount };
```

(If exports are already in the file, merge with existing.)

Then create `scripts/build-soldier-components.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import {
  isMultiFrameOverride,
  frameSliceOverride,
  frameCount,
} from './build-soldier-components.mjs';

describe('build-soldier-components multi-frame helpers', () => {
  it('detects single-frame override (string[] per dir)', () => {
    const override = { S: ['layer-a', 'layer-b'] };
    expect(isMultiFrameOverride(override)).toBe(false);
  });

  it('detects multi-frame override (string[][] per dir)', () => {
    const override = { S: [['layer-a'], ['layer-b']] };
    expect(isMultiFrameOverride(override)).toBe(true);
  });

  it('frameCount returns the max length across dirs', () => {
    const override = { S: [['a'], ['b'], ['c']], N: [['x'], ['y']] };
    expect(frameCount(override)).toBe(3);
  });

  it('frameSliceOverride extracts the i-th frame per dir', () => {
    const override = { S: [['a0'], ['a1']], N: [['b0'], ['b1']] };
    expect(frameSliceOverride(override, 0)).toEqual({ S: ['a0'], N: ['b0'] });
    expect(frameSliceOverride(override, 1)).toEqual({ S: ['a1'], N: ['b1'] });
  });

  it('frameSliceOverride clamps to the last available frame for short dirs', () => {
    const override = { S: [['a0'], ['a1'], ['a2']], N: [['b0'], ['b1']] };
    expect(frameSliceOverride(override, 2)).toEqual({ S: ['a2'], N: ['b1'] });
  });
});
```

- [ ] **Step 3: Write the kit-walker test for the slicer.**

Export the helpers similarly. At the bottom of
`scripts/slice-component-atlas.mjs`:

```js
export { isMultiFrameOverride, frameCountOf, buildWorkList };
```

Then create `scripts/slice-component-atlas.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { buildWorkList } from './slice-component-atlas.mjs';

describe('slice-component-atlas buildWorkList', () => {
  it('emits idle entry referencing the unsuffixed atlas with all 8 cells', () => {
    const kit = { id: 'line-infantry', poses: {} };
    const work = buildWorkList(kit, 'line-infantry');
    expect(work).toHaveLength(1);
    expect(work[0].runtimePose).toBe('idle');
    expect(work[0].atlasFile).toBe('line-infantry-components.png');
    expect(work[0].frameIdx).toBe(0);
    expect(work[0].cells).toHaveLength(8);
  });

  it('translates kit pose names to runtime pose names', () => {
    const kit = {
      id: 'line-infantry',
      poses: { 'make-ready': { S: ['x'] } },
    };
    const work = buildWorkList(kit, 'line-infantry');
    const reload = work.find((w) => w.runtimePose === 'reloading');
    expect(reload).toBeDefined();
    expect(reload.atlasFile).toBe('line-infantry-components-make-ready.png');
    expect(reload.cells.map((c) => c.dir)).toEqual(['S']);
  });

  it('skips poses in SKIP_KIT_POSES (musket, hit)', () => {
    const kit = {
      id: 'line-infantry',
      poses: {
        musket: { S: ['x'] },
        hit:    { S: ['x'] },
        fire:   { S: ['x'] },
      },
    };
    const work = buildWorkList(kit, 'line-infantry');
    expect(work.find((w) => w.kitPose === 'musket')).toBeUndefined();
    expect(work.find((w) => w.kitPose === 'hit')).toBeUndefined();
    expect(work.find((w) => w.kitPose === 'fire')).toBeDefined();
  });

  it('emits one entry per frame for a multi-frame pose', () => {
    const kit = {
      id: 'line-infantry',
      poses: {
        walking: {
          S: [['a0'], ['a1'], ['a2'], ['a3']],
          N: [['b0'], ['b1'], ['b2'], ['b3']],
        },
      },
    };
    const work = buildWorkList(kit, 'line-infantry').filter((w) => w.runtimePose === 'walking');
    expect(work).toHaveLength(4);
    expect(work.map((w) => w.frameIdx)).toEqual([0, 1, 2, 3]);
    expect(work[0].atlasFile).toBe('line-infantry-components-walking-0.png');
    expect(work[3].atlasFile).toBe('line-infantry-components-walking-3.png');
  });
});
```

- [ ] **Step 4: Run the new tests.**

Run: `npx vitest run scripts/build-soldier-components.test.mjs scripts/slice-component-atlas.test.mjs`
Expected: all green.

- [ ] **Step 5: Run the full test suite to make sure nothing else broke.**

Run: `npm test`
Expected: same pass count as before, plus the new tests. The pre-existing
`src/lab/wind.test.ts` failure may still be there — note but don't fix.

- [ ] **Step 6: Do NOT commit.**

---

## Task 4: Leg-shift helper

**Files:**
- Create: `scripts/lib/leg-shift.mjs`
- Create: `src/sprite-gen/leg-shift.test.ts`

A small, focused helper used by the seeder. Loads a 32×36 PNG from disk
(or accepts a buffer), identifies "leg pixels" as the lowest 12 rows of
opaque pixels, and returns a new RGBA buffer with those pixels translated
vertically by N rows (positive = up, negative = down).

- [ ] **Step 1: Create the helper.**

```js
// scripts/lib/leg-shift.mjs
//
// Tiny helper: loads a 32x36 RGBA PNG, finds "leg pixels" (the lower 12 of
// the 36 rows), and returns a new RGBA buffer with those pixels shifted
// up or down by `dy`. Rows revealed by the shift become transparent.
//
// Used by scripts/seed-line-infantry-locomotion.mjs to derive walk/run
// frame variants from the existing trousers/<facing>.png baselines.

import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

export const CELL_W = 32;
export const CELL_H = 36;
export const LEG_REGION_TOP = 24;     // rows 24..35 (12 rows) are "legs"
export const LEG_REGION_HEIGHT = CELL_H - LEG_REGION_TOP;

/**
 * Shifts the lower legs region of a 32×36 RGBA buffer by `dy` rows
 * (positive = up). Returns a new Uint8ClampedArray; does not mutate input.
 */
export function shiftLegs(rgba, dy) {
  if (rgba.length !== CELL_W * CELL_H * 4) {
    throw new Error(`shiftLegs: expected ${CELL_W * CELL_H * 4} bytes, got ${rgba.length}`);
  }
  const out = new Uint8ClampedArray(rgba.length);
  // Copy upper region as-is (rows 0..LEG_REGION_TOP-1).
  for (let i = 0; i < LEG_REGION_TOP * CELL_W * 4; i++) {
    out[i] = rgba[i];
  }
  // Copy leg region, shifted vertically. Rows revealed by the shift stay
  // transparent (Uint8ClampedArray defaults to 0).
  for (let y = 0; y < LEG_REGION_HEIGHT; y++) {
    const sourceY = LEG_REGION_TOP + y + dy;
    if (sourceY < LEG_REGION_TOP || sourceY >= CELL_H) continue;
    const dstY = LEG_REGION_TOP + y;
    for (let x = 0; x < CELL_W; x++) {
      const sIdx = (sourceY * CELL_W + x) * 4;
      const dIdx = (dstY * CELL_W + x) * 4;
      out[dIdx + 0] = rgba[sIdx + 0];
      out[dIdx + 1] = rgba[sIdx + 1];
      out[dIdx + 2] = rgba[sIdx + 2];
      out[dIdx + 3] = rgba[sIdx + 3];
    }
  }
  return out;
}

/**
 * Variant: shifts only the LEFT half (cols 0..15) or RIGHT half (cols 16..31)
 * of the leg region. Used to alternate left/right leg lift in walk cycles.
 *
 * `side` is 'left' or 'right'. `dy` positive = up.
 */
export function shiftHalfLegs(rgba, side, dy) {
  if (side !== 'left' && side !== 'right') {
    throw new Error(`shiftHalfLegs: side must be 'left' or 'right', got '${side}'`);
  }
  const out = new Uint8ClampedArray(rgba);
  const xStart = side === 'left' ? 0 : CELL_W / 2;
  const xEnd   = side === 'left' ? CELL_W / 2 : CELL_W;
  // Clear the destination region for this side first; rows revealed by the
  // shift become transparent.
  for (let y = 0; y < LEG_REGION_HEIGHT; y++) {
    const dstY = LEG_REGION_TOP + y;
    for (let x = xStart; x < xEnd; x++) {
      const dIdx = (dstY * CELL_W + x) * 4;
      out[dIdx + 0] = 0;
      out[dIdx + 1] = 0;
      out[dIdx + 2] = 0;
      out[dIdx + 3] = 0;
    }
  }
  for (let y = 0; y < LEG_REGION_HEIGHT; y++) {
    const sourceY = LEG_REGION_TOP + y + dy;
    if (sourceY < LEG_REGION_TOP || sourceY >= CELL_H) continue;
    const dstY = LEG_REGION_TOP + y;
    for (let x = xStart; x < xEnd; x++) {
      const sIdx = (sourceY * CELL_W + x) * 4;
      const dIdx = (dstY * CELL_W + x) * 4;
      out[dIdx + 0] = rgba[sIdx + 0];
      out[dIdx + 1] = rgba[sIdx + 1];
      out[dIdx + 2] = rgba[sIdx + 2];
      out[dIdx + 3] = rgba[sIdx + 3];
    }
  }
  return out;
}

/** Convenience: read a PNG file and return its RGBA Uint8ClampedArray. */
export async function readRgba(path) {
  const buf = await readFile(path);
  const png = PNG.sync.read(buf);
  if (png.width !== CELL_W || png.height !== CELL_H) {
    throw new Error(`${path}: expected ${CELL_W}x${CELL_H}, got ${png.width}x${png.height}`);
  }
  return new Uint8ClampedArray(png.data);
}

/** Convenience: write an RGBA buffer to a 32x36 PNG. */
export function rgbaToPng(rgba) {
  const png = new PNG({ width: CELL_W, height: CELL_H });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png);
}
```

- [ ] **Step 2: Write the test.**

```ts
// src/sprite-gen/leg-shift.test.ts
import { describe, expect, it } from 'vitest';
import {
  CELL_W,
  CELL_H,
  LEG_REGION_TOP,
  shiftLegs,
  shiftHalfLegs,
} from '../../scripts/lib/leg-shift.mjs';

function makeRgba(fill = 0) {
  const out = new Uint8ClampedArray(CELL_W * CELL_H * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i + 0] = fill;
    out[i + 1] = fill;
    out[i + 2] = fill;
    out[i + 3] = fill === 0 ? 0 : 255;
  }
  return out;
}

function paintRow(rgba: Uint8ClampedArray, y: number, color: [number, number, number, number]) {
  for (let x = 0; x < CELL_W; x++) {
    const i = (y * CELL_W + x) * 4;
    rgba[i + 0] = color[0]!;
    rgba[i + 1] = color[1]!;
    rgba[i + 2] = color[2]!;
    rgba[i + 3] = color[3]!;
  }
}

describe('leg-shift helpers', () => {
  it('shiftLegs(0) is identity for the leg region', () => {
    const src = makeRgba(0);
    paintRow(src, CELL_H - 1, [255, 0, 0, 255]);
    const out = shiftLegs(src, 0);
    expect(Array.from(out.slice((CELL_H - 1) * CELL_W * 4, (CELL_H - 1) * CELL_W * 4 + 4)))
      .toEqual([255, 0, 0, 255]);
  });

  it('shiftLegs(1) translates the bottom row up by 1 (was at H-1, now at H-2)', () => {
    const src = makeRgba(0);
    paintRow(src, CELL_H - 1, [255, 0, 0, 255]);
    const out = shiftLegs(src, 1);
    // Row H-2 should now contain what was at H-1.
    expect(Array.from(out.slice((CELL_H - 2) * CELL_W * 4, (CELL_H - 2) * CELL_W * 4 + 4)))
      .toEqual([255, 0, 0, 255]);
    // Row H-1 should be transparent (revealed by shift).
    expect(Array.from(out.slice((CELL_H - 1) * CELL_W * 4, (CELL_H - 1) * CELL_W * 4 + 4)))
      .toEqual([0, 0, 0, 0]);
  });

  it('shiftLegs preserves the upper region (rows 0..LEG_REGION_TOP-1)', () => {
    const src = makeRgba(0);
    paintRow(src, 5, [128, 128, 128, 255]);
    const out = shiftLegs(src, 1);
    expect(Array.from(out.slice(5 * CELL_W * 4, 5 * CELL_W * 4 + 4)))
      .toEqual([128, 128, 128, 255]);
  });

  it('shiftHalfLegs("left", 1) moves only the left half of the leg region', () => {
    const src = makeRgba(0);
    paintRow(src, CELL_H - 1, [200, 0, 0, 255]);
    const out = shiftHalfLegs(src, 'left', 1);
    // Left half of row H-2 should now be red.
    const lhsIdx = ((CELL_H - 2) * CELL_W + 0) * 4;
    expect(out[lhsIdx + 0]).toBe(200);
    expect(out[lhsIdx + 3]).toBe(255);
    // Right half of row H-2 should still be transparent (untouched).
    const rhsIdx = ((CELL_H - 2) * CELL_W + (CELL_W / 2)) * 4;
    expect(out[rhsIdx + 3]).toBe(0);
    // Right half of row H-1 should still be red (untouched bottom row).
    const rhsBotIdx = ((CELL_H - 1) * CELL_W + (CELL_W / 2)) * 4;
    expect(out[rhsBotIdx + 0]).toBe(200);
  });

  it('throws on a buffer with the wrong size', () => {
    expect(() => shiftLegs(new Uint8ClampedArray(100), 0)).toThrow();
  });
});
```

- [ ] **Step 3: Run the test.**

Run: `npx vitest run src/sprite-gen/leg-shift.test.ts`
Expected: all green.

- [ ] **Step 4: Do NOT commit.**

---

## Task 5: Locomotion seeder

**Files:**
- Create: `scripts/seed-line-infantry-locomotion.mjs`
- Modify: `package.json` (add `seed:line-infantry-locomotion` npm script)

The seeder generates 80 trousers PNGs (32 walk + 48 run), patches
`public/components/index.json` with their entries, and prints the kit
fragment for `walking` and `running` poses to stdout for the user to copy
into the kit JSON. (Patching the kit JSON automatically is also fine —
choice below explained.)

We will **patch the kit JSON automatically** — same justification as
patching `index.json`: it's a generated artifact with a clear regeneration
path. The user can hand-tune the kit JSON afterward; the seeder uses a
deep-merge strategy and only inserts/replaces the `walking` and `running`
keys.

- [ ] **Step 1: Write the seeder.**

```js
// scripts/seed-line-infantry-locomotion.mjs
//
// Generates placeholder walk/run trousers PNGs and patches the components
// index + line-infantry kit so the multi-frame pipeline has assets to chew on.
//
// Outputs:
//   public/sprites/components/uniform/lower/trousers/<facing>-walk-{0..3}.png
//   public/sprites/components/uniform/lower/trousers/<facing>-run-{0..5}.png
// Patches:
//   public/components/index.json    (adds 80 component entries)
//   public/components/kits/line-infantry.json (adds walking + running poses)
//
// Idempotent: re-running overwrites PNGs and resets walking/running entries.
//
// The frame phasing is a simple alternating leg-shift cycle. It reads as
// motion in the runtime; refine in Aseprite for proper pixel-art animation.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CELL_W,
  CELL_H,
  shiftLegs,
  shiftHalfLegs,
  readRgba,
  rgbaToPng,
} from './lib/leg-shift.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const COMPONENT_ROOT = resolve(REPO_ROOT, 'public', 'sprites', 'components');
const TROUSERS_DIR = resolve(COMPONENT_ROOT, 'uniform', 'lower', 'trousers');
const INDEX_JSON = resolve(REPO_ROOT, 'public', 'components', 'index.json');
const KIT_JSON   = resolve(REPO_ROOT, 'public', 'components', 'kits', 'line-infantry.json');

const FACINGS = [
  { abbr: 'N',  full: 'north'     },
  { abbr: 'NE', full: 'northeast' },
  { abbr: 'E',  full: 'east'      },
  { abbr: 'SE', full: 'southeast' },
  { abbr: 'S',  full: 'south'     },
  { abbr: 'SW', full: 'southwest' },
  { abbr: 'W',  full: 'west'      },
  { abbr: 'NW', full: 'northwest' },
];

// 4-beat walk: alternating left/right leg lift.
//   Frame 0: identity (contact)
//   Frame 1: left leg lifted up 1px
//   Frame 2: identity (mid-step)
//   Frame 3: right leg lifted up 1px
const WALK_FRAMES = 4;
function walkFrame(rgba, frameIdx) {
  switch (frameIdx) {
    case 0: return new Uint8ClampedArray(rgba);
    case 1: return shiftHalfLegs(rgba, 'left', 1);
    case 2: return new Uint8ClampedArray(rgba);
    case 3: return shiftHalfLegs(rgba, 'right', 1);
  }
  throw new Error(`walkFrame: bad index ${frameIdx}`);
}

// 6-key gallop-ish run cycle (compressed for foot soldiers):
//   Frame 0: gather (identity)
//   Frame 1: push   (left leg up 1)
//   Frame 2: suspension (both legs up 1)
//   Frame 3: landing (right leg up 1)
//   Frame 4: rolling-contact (identity)
//   Frame 5: re-gather (left leg up 2 — slight overshoot)
const RUN_FRAMES = 6;
function runFrame(rgba, frameIdx) {
  switch (frameIdx) {
    case 0: return new Uint8ClampedArray(rgba);
    case 1: return shiftHalfLegs(rgba, 'left', 1);
    case 2: return shiftLegs(rgba, 1);
    case 3: return shiftHalfLegs(rgba, 'right', 1);
    case 4: return new Uint8ClampedArray(rgba);
    case 5: return shiftHalfLegs(rgba, 'left', 2);
  }
  throw new Error(`runFrame: bad index ${frameIdx}`);
}

async function emitFrame(facingFull, prefix, frameIdx, rgba) {
  const outPath = resolve(TROUSERS_DIR, `${facingFull}-${prefix}-${frameIdx}.png`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, rgbaToPng(rgba));
  return `uniform/lower/trousers/${facingFull}-${prefix}-${frameIdx}.png`;
}

function indexEntry(componentId, facingAbbr, relPath) {
  return {
    id: componentId,
    type: 'uniform',
    category: 'lower',
    facings: [facingAbbr],
    path: relPath,
  };
}

function trousersIdleId(facingFull) {
  return `trousers-${facingFull}`;
}

/**
 * Generate one frame's component id given pattern (walk|run) and frame index.
 */
function trousersFrameId(facingFull, prefix, frameIdx) {
  return `trousers-${facingFull}-${prefix}-${frameIdx}`;
}

async function main() {
  // 1. Generate the 80 PNGs and gather index entries.
  const newEntries = [];
  for (const f of FACINGS) {
    const baseRgba = await readRgba(resolve(TROUSERS_DIR, `${f.full}.png`));
    for (let i = 0; i < WALK_FRAMES; i++) {
      const frame = walkFrame(baseRgba, i);
      const path = await emitFrame(f.full, 'walk', i, frame);
      newEntries.push(indexEntry(trousersFrameId(f.full, 'walk', i), f.abbr, path));
    }
    for (let i = 0; i < RUN_FRAMES; i++) {
      const frame = runFrame(baseRgba, i);
      const path = await emitFrame(f.full, 'run', i, frame);
      newEntries.push(indexEntry(trousersFrameId(f.full, 'run', i), f.abbr, path));
    }
  }
  console.log(`Wrote ${newEntries.length} trousers frame PNGs.`);

  // 2. Patch components/index.json.
  const idx = JSON.parse(await readFile(INDEX_JSON, 'utf8'));
  if (!Array.isArray(idx.components)) {
    throw new Error('index.json: expected components array');
  }
  // Remove any prior walk-/run- trousers entries first (idempotency).
  idx.components = idx.components.filter((c) => {
    if (typeof c.id !== 'string') return true;
    return !/^trousers-(north|northeast|east|southeast|south|southwest|west|northwest)-(walk|run)-\d+$/.test(c.id);
  });
  // Append the new entries, preserving array order.
  idx.components.push(...newEntries);
  await writeFile(INDEX_JSON, JSON.stringify(idx, null, 2) + '\n');
  console.log(`Patched ${INDEX_JSON} (+${newEntries.length} entries).`);

  // 3. Patch line-infantry kit with walking + running poses.
  const kit = JSON.parse(await readFile(KIT_JSON, 'utf8'));
  if (!kit.poses || typeof kit.poses !== 'object') kit.poses = {};

  // Build pose entries. Layer stack mirrors the existing facing layers, but
  // swaps the trousers id to the per-frame variant.
  function buildPoseFrames(prefix, frameCount) {
    const out = {};
    for (const f of FACINGS) {
      const facingCfg = kit.facings && kit.facings[f.abbr];
      if (!facingCfg || !Array.isArray(facingCfg.layers)) {
        throw new Error(`kit.facings.${f.abbr}.layers missing`);
      }
      const baseLayers = facingCfg.layers;
      const trousersIdx = baseLayers.findIndex((id) => id === trousersIdleId(f.full));
      if (trousersIdx < 0) {
        throw new Error(`kit.facings.${f.abbr}.layers does not contain '${trousersIdleId(f.full)}'`);
      }
      const frames = [];
      for (let i = 0; i < frameCount; i++) {
        const layers = baseLayers.slice();
        layers[trousersIdx] = trousersFrameId(f.full, prefix, i);
        frames.push(layers);
      }
      out[f.abbr] = frames;
    }
    return out;
  }

  kit.poses.walking = buildPoseFrames('walk', WALK_FRAMES);
  kit.poses.running = buildPoseFrames('run', RUN_FRAMES);

  await writeFile(KIT_JSON, JSON.stringify(kit, null, 2) + '\n');
  console.log(`Patched ${KIT_JSON} (walking + running).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script.**

Edit `package.json`, add inside `scripts`:

```json
"seed:line-infantry-locomotion": "node scripts/seed-line-infantry-locomotion.mjs",
```

- [ ] **Step 3: Run the seeder.**

Run: `npm run seed:line-infantry-locomotion`
Expected stdout:
- `Wrote 80 trousers frame PNGs.`
- `Patched .../public/components/index.json (+80 entries).`
- `Patched .../public/components/kits/line-infantry.json (walking + running).`

- [ ] **Step 4: Verify file count + sample dimension.**

Run: `find public/sprites/components/uniform/lower/trousers -name '*-walk-*.png' -o -name '*-run-*.png' | wc -l`
Expected: `80`.

Run: `file public/sprites/components/uniform/lower/trousers/south-walk-0.png`
Expected: `PNG image data, 32 x 36, 8-bit/color RGBA, non-interlaced`.

- [ ] **Step 5: Verify index.json has the new entries.**

Run: `node -e "const c=require('./public/components/index.json').components; console.log(c.filter(x=>/^trousers-.*-(walk|run)-\d+$/.test(x.id)).length)"`
Expected: `80`.

- [ ] **Step 6: Verify kit has walking + running.**

Run: `node -e "const k=require('./public/components/kits/line-infantry.json'); console.log(Object.keys(k.poses.walking).length, k.poses.walking.S.length); console.log(Object.keys(k.poses.running).length, k.poses.running.S.length)"`
Expected: `8 4` then `8 6`.

- [ ] **Step 7: Do NOT commit.**

---

## Task 6: Run the full pipeline + verify pose tree

**Files:** None modified directly — runs scripts and inspects outputs.

- [ ] **Step 1: Run the full build.**

Run: `npm run build:poses`
Expected:
- `build:soldier-components` composites idle + every kit pose, including
  `walking` (4 frames) and `running` (6 frames). Look for log lines like
  `Compositing pose: walking frame 0`, `Compositing pose: walking frame 1`,
  etc.
- `slice-component-atlas` writes line-infantry pose tree PNGs.
- `build-pose-manifest` regenerates the manifest.

- [ ] **Step 2: Verify atlas count.**

Run: `ls public/sprites/line-infantry-components-{walking,running}-*.png 2>/dev/null | wc -l`
Expected: `10` (4 walking + 6 running).

- [ ] **Step 3: Verify pose tree.**

Run: `find public/sprites/poses/line-infantry/walking -name '*.png' | wc -l`
Expected: `32` (8 dirs × 4 frames).

Run: `find public/sprites/poses/line-infantry/running -name '*.png' | wc -l`
Expected: `48` (8 dirs × 6 frames).

- [ ] **Step 4: Verify manifest reflects multi-frame.**

Run: `node -e "const m=require('./public/sprites/poses/manifest.json'); console.log(m.kinds['line-infantry'].poses.walking.clips.E[0].length); console.log(m.kinds['line-infantry'].poses.running.clips.E[0].length)"`
Expected: `4` then `6`.

- [ ] **Step 5: Run the test suite.**

Run: `npm test`
Expected: green (modulo pre-existing `wind.test.ts` failure).

- [ ] **Step 6: Run the typechecker.**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Do NOT commit.**

---

## Task 7: Visual smoke test in dev server

This task is manual verification; no code changes.

- [ ] **Step 1: Start the dev server.**

Run: `npm run dev`
Expected: vite starts, prints `ready in <Nms>` and a localhost URL.

- [ ] **Step 2: Open the lab and place a line-infantry company.**

Open `/lab.html`, select line-infantry, place a small formation, issue a
move order. Watch the soldiers walk, then issue a longer-distance order
to make them run.

- [ ] **Step 3: Verify each visual criterion.**

- Walking soldiers visibly cycle their legs at ~8 fps over 0.5 s.
- Running soldiers cycle faster (12 fps).
- No red/missing-frame artifacts (would indicate `pickPoseUv` returning null).
- All 8 facings render correctly during walk and run.
- Idle, fire, present, make-ready, hit, dying still look right (we shouldn't
  have regressed any of them).

- [ ] **Step 4: Stop the dev server.**

Ctrl+C in the terminal running `npm run dev`.

---

## Self-review checklist

- ✅ Spec coverage:
  - Multi-frame kit format detection — Task 1.
  - Builder emits per-frame atlases — Task 1.
  - Slicer kit-driven, multi-frame aware — Task 2.
  - Tests for builder/slicer — Task 3.
  - Leg-shift helper + tests — Task 4.
  - Seeder produces 80 PNGs + patches index + kit — Task 5.
  - Full pipeline run + manifest verification — Task 6.
  - Visual smoke test — Task 7.
- ✅ No "TBD"/"TODO" placeholders. Every step has concrete code or commands.
- ✅ Identifier consistency: `isMultiFrameOverride`, `frameSliceOverride`,
  `frameCount` (builder); `buildWorkList`, `frameCountOf` (slicer);
  `shiftLegs`, `shiftHalfLegs`, `readRgba`, `rgbaToPng`, `CELL_W`/`CELL_H`/`LEG_REGION_TOP`
  (helper); `walkFrame`, `runFrame`, `WALK_FRAMES`, `RUN_FRAMES`,
  `trousersFrameId`, `trousersIdleId`, `FACINGS` (seeder). Used unchanged
  across tasks.
- ✅ Each task ends without a commit; user manages commit boundaries
  themselves.
- ✅ All file paths and commands are exact.
