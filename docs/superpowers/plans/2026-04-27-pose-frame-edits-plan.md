# Pose-frame edits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Pose Frames" tab to `components-editor.html` that lets the
user paint pixel edits onto auto-derived pose-tree PNGs, with edits saved
uniquely per `(kind, pose, dir, clip, frame)` to `public/sprites/poses/edits.json`.
Cuirassier draw script and line-infantry locomotion seeder apply those
edits before writing PNG, so edits survive auto-derive regenerations.

**Architecture:** New helper module `scripts/lib/pose-frame-edits.mjs` is
the build-time application point. New vite middleware
`/api/pose-frame-edits` writes the edits JSON. Editor UI gets a tab
toggle that swaps between the existing Components flow and a new
Pose-Frames flow that loads pose PNGs, paints over them, and saves to
the edits JSON.

**Tech Stack:** Node 20 ESM, `pngjs` (devDep), vitest, vanilla JS in
`components-editor.html`. No new deps.

**Reference:** Spec at `docs/superpowers/specs/2026-04-27-pose-frame-edits-design.md`.

---

## File structure

| Path | Change |
|---|---|
| `scripts/lib/pose-frame-edits.mjs` | **New** — `loadEdits`, `lookupEdits`, `applyEdits`. |
| `scripts/lib/pose-frame-edits.d.mts` | **New** — TS declarations. |
| `src/sprite-gen/pose-frame-edits.test.ts` | **New** — vitest. |
| `public/sprites/poses/edits.json` | **Created on first save** — pose-frame edits tree. |
| `scripts/draw-cuirassier-poses.mjs` | **Modify** — call `applyEdits()` before writing each PNG. |
| `scripts/seed-line-infantry-locomotion.mjs` | **Modify** — same. |
| `vite.config.ts` | **Modify** — add `/api/pose-frame-edits` middleware; extend `/api/build` to also run cuirassier draw + manifest builder. |
| `public/components-editor.html` | **Modify** — add Pose Frames tab + state + canvas hookup. |

Identifier conventions (use these exact names):

- `loadEdits(repoRoot)` — async; reads `public/sprites/poses/edits.json`,
  returns parsed tree or `{}`.
- `lookupEdits(tree, kind, pose, dir, clipIdx, frameIdx)` — returns the
  edit array, or `[]` if not present.
- `applyEdits(rgba, cellW, cellH, edits)` — mutates buffer in place.
- Edits-JSON path: `public/sprites/poses/edits.json` (constant `EDITS_PATH`).
- Server endpoint: `POST /api/pose-frame-edits` — body is the full tree.

---

## Task 1: Pose-frame edits helper module

**Files:**
- Create: `scripts/lib/pose-frame-edits.mjs`
- Create: `scripts/lib/pose-frame-edits.d.mts`
- Create: `src/sprite-gen/pose-frame-edits.test.ts`

- [ ] **Step 1: Create the helper module.**

```js
// scripts/lib/pose-frame-edits.mjs
//
// Tree of pixel-level edits applied to auto-derived pose-tree PNGs.
// Storage shape:
//   {
//     "<kind>": {
//       "<pose>": {
//         "<dir>": {
//           "<clipIdx>": {
//             "<frameIdx>": [{x, y, color}, ...]
//           }
//         }
//       }
//     }
//   }
//
// Edit color: '#rrggbb' or 'clear' (full transparency). Mirrors the
// existing pixel-edits.json convention.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const EDITS_PATH_REL = 'public/sprites/poses/edits.json';

/**
 * Load and parse public/sprites/poses/edits.json. Returns {} if the file
 * is missing or empty.
 */
export async function loadEdits(repoRoot) {
  const path = resolve(repoRoot, EDITS_PATH_REL);
  try {
    const buf = await readFile(path, 'utf8');
    if (!buf.trim()) return {};
    return JSON.parse(buf);
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
}

/**
 * Walk the tree to a frame's edit list. Returns [] if any key is missing.
 */
export function lookupEdits(tree, kind, pose, dir, clipIdx, frameIdx) {
  if (!tree) return [];
  const k = tree[kind];
  if (!k) return [];
  const p = k[pose];
  if (!p) return [];
  const d = p[dir];
  if (!d) return [];
  const c = d[String(clipIdx)];
  if (!c) return [];
  const f = c[String(frameIdx)];
  if (!Array.isArray(f)) return [];
  return f;
}

/**
 * Parse a hex color '#rrggbb' or '#rgb' into [r,g,b]. Returns null on a
 * malformed string.
 */
function parseHex(s) {
  if (typeof s !== 'string') return null;
  let m = s.match(/^#([0-9a-fA-F]{6})$/);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  m = s.match(/^#([0-9a-fA-F]{3})$/);
  if (m) {
    const r = parseInt(m[1][0], 16);
    const g = parseInt(m[1][1], 16);
    const b = parseInt(m[1][2], 16);
    return [r * 17, g * 17, b * 17];
  }
  return null;
}

/**
 * Mutate `rgba` in place applying each {x,y,color} edit. Out-of-range
 * coordinates emit a console.warn and are skipped. Buffer length must be
 * cellW*cellH*4 bytes.
 */
export function applyEdits(rgba, cellW, cellH, edits) {
  if (!Array.isArray(edits) || edits.length === 0) return 0;
  if (rgba.length !== cellW * cellH * 4) {
    throw new Error(
      `applyEdits: rgba length ${rgba.length} != ${cellW}*${cellH}*4`,
    );
  }
  let applied = 0;
  for (const e of edits) {
    if (!e || typeof e.x !== 'number' || typeof e.y !== 'number') continue;
    if (e.x < 0 || e.x >= cellW || e.y < 0 || e.y >= cellH) {
      console.warn(`[pose-frame-edits] out-of-range edit (${e.x},${e.y}) for ${cellW}x${cellH}`);
      continue;
    }
    const i = (e.y * cellW + e.x) * 4;
    if (e.color === 'clear') {
      rgba[i + 0] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 0;
    } else {
      const rgb = parseHex(e.color);
      if (!rgb) {
        console.warn(`[pose-frame-edits] unparseable color '${e.color}' at (${e.x},${e.y})`);
        continue;
      }
      rgba[i + 0] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = 255;
    }
    applied++;
  }
  return applied;
}
```

- [ ] **Step 2: Create the TS declarations.**

```ts
// scripts/lib/pose-frame-edits.d.mts
export const EDITS_PATH_REL: string;

export interface PixelEdit {
  x: number;
  y: number;
  color: string;
}
export type EditsTree = Record<string, Record<string, Record<string, Record<string, Record<string, PixelEdit[]>>>>>;

export function loadEdits(repoRoot: string): Promise<EditsTree>;
export function lookupEdits(
  tree: EditsTree | null | undefined,
  kind: string,
  pose: string,
  dir: string,
  clipIdx: number,
  frameIdx: number,
): PixelEdit[];
export function applyEdits(
  rgba: Uint8Array | Uint8ClampedArray,
  cellW: number,
  cellH: number,
  edits: PixelEdit[],
): number;
```

- [ ] **Step 3: Create the test.**

```ts
// src/sprite-gen/pose-frame-edits.test.ts
import { describe, expect, it } from 'vitest';
import {
  lookupEdits,
  applyEdits,
} from '../../scripts/lib/pose-frame-edits.mjs';

describe('lookupEdits', () => {
  it('returns [] for missing tree', () => {
    expect(lookupEdits(null, 'cuirassier', 'idle', 'S', 0, 0)).toEqual([]);
  });

  it('returns [] for missing kind/pose/dir/clip/frame', () => {
    const tree = { cuirassier: { idle: { S: { '0': { '0': [{ x: 1, y: 1, color: '#ff0000' }] } } } } };
    expect(lookupEdits(tree, 'cuirassier', 'idle', 'S', 0, 0)).toHaveLength(1);
    expect(lookupEdits(tree, 'cuirassier', 'idle', 'N', 0, 0)).toEqual([]);
    expect(lookupEdits(tree, 'cuirassier', 'walking', 'S', 0, 0)).toEqual([]);
    expect(lookupEdits(tree, 'cuirassier', 'idle', 'S', 1, 0)).toEqual([]);
    expect(lookupEdits(tree, 'cuirassier', 'idle', 'S', 0, 5)).toEqual([]);
  });

  it('returns the edit list when all keys match', () => {
    const tree = { c: { p: { D: { '0': { '2': [{ x: 5, y: 6, color: '#ababab' }] } } } } };
    expect(lookupEdits(tree, 'c', 'p', 'D', 0, 2)).toEqual([{ x: 5, y: 6, color: '#ababab' }]);
  });
});

describe('applyEdits', () => {
  function makeBuf(w = 4, h = 4) {
    return new Uint8ClampedArray(w * h * 4);
  }

  it('writes a hex color at the correct offset', () => {
    const buf = makeBuf();
    const n = applyEdits(buf, 4, 4, [{ x: 1, y: 1, color: '#ff0000' }]);
    expect(n).toBe(1);
    const idx = (1 * 4 + 1) * 4;
    expect(Array.from(buf.slice(idx, idx + 4))).toEqual([255, 0, 0, 255]);
  });

  it('handles "clear" by zeroing all 4 bytes', () => {
    const buf = makeBuf();
    // pre-fill
    for (let i = 0; i < buf.length; i++) buf[i] = 200;
    const n = applyEdits(buf, 4, 4, [{ x: 0, y: 0, color: 'clear' }]);
    expect(n).toBe(1);
    expect(Array.from(buf.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('parses #rgb shorthand', () => {
    const buf = makeBuf();
    applyEdits(buf, 4, 4, [{ x: 0, y: 0, color: '#fa0' }]);
    expect(Array.from(buf.slice(0, 4))).toEqual([255, 170, 0, 255]);
  });

  it('skips out-of-range coordinates with a warn', () => {
    const buf = makeBuf();
    const n = applyEdits(buf, 4, 4, [
      { x: 99, y: 0, color: '#fff' },
      { x: 0, y: -1, color: '#fff' },
    ]);
    expect(n).toBe(0);
  });

  it('skips bad color strings', () => {
    const buf = makeBuf();
    const n = applyEdits(buf, 4, 4, [{ x: 0, y: 0, color: 'not-a-color' }]);
    expect(n).toBe(0);
  });

  it('throws on wrong-sized buffer', () => {
    expect(() => applyEdits(new Uint8ClampedArray(10), 4, 4, [])).toThrow(/length/);
  });

  it('returns count of applied edits', () => {
    const buf = makeBuf();
    const n = applyEdits(buf, 4, 4, [
      { x: 0, y: 0, color: '#fff' },
      { x: 1, y: 1, color: '#000' },
      { x: 99, y: 0, color: '#fff' },
    ]);
    expect(n).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests.**

Run: `npx vitest run src/sprite-gen/pose-frame-edits.test.ts`
Expected: 9 green.

- [ ] **Step 5: Run typecheck.**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Do NOT commit.**

---

## Task 2: Integrate applyEdits into cuirassier draw

**Files:**
- Modify: `scripts/draw-cuirassier-poses.mjs`

- [ ] **Step 1: Read the current `emitDir` function.**

Today it renders → writes. New flow: render → applyEdits → write.

- [ ] **Step 2: Update imports.**

Add at the top of the file, alongside existing leg-shift / cuirassier-poses imports:

```js
import { resolve as _resolve, dirname as _dirname } from 'node:path';
import { fileURLToPath as _fu } from 'node:url';
import { loadEdits, lookupEdits, applyEdits } from './lib/pose-frame-edits.mjs';
```

(Use whatever names don't conflict — the file already imports `resolve`, `dirname`, `fileURLToPath`. Skip the underscore aliases if they conflict.)

- [ ] **Step 3: Pre-load edits in `main()`.**

At the top of `main()`:

```js
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const editsTree = await loadEdits(REPO_ROOT);
```

(If `__dirname` and `REPO_ROOT` already exist at module scope, reuse them.)

- [ ] **Step 4: Apply edits per frame in the emit loop.**

Current `emitDir(pose, dir, frames)` loop:

```js
for (let i = 0; i < frames.length; i++) {
  const rgba = renderFrame(frames[i]);
  const outPath = resolve(OUT_BASE, pose, dir, '0', `${i}.png`);
  await writePng(rgba, outPath);
}
```

Update to apply edits before writing. The kind name for cuirassier is
`'cuirassier'`. Pass the edits tree in via closure:

```js
async function emitDir(pose, dir, frames) {
  for (let i = 0; i < frames.length; i++) {
    const rgba = renderFrame(frames[i]);
    const edits = lookupEdits(editsTree, 'cuirassier', pose, dir, 0, i);
    const n = applyEdits(rgba, CELL_W, CELL_H, edits);
    if (n > 0) {
      console.log(`[cuirassier] applied ${n} pose-frame edits to ${pose}/${dir}/0/${i}.png`);
    }
    const outPath = resolve(OUT_BASE, pose, dir, '0', `${i}.png`);
    await writePng(rgba, outPath);
  }
}
```

NOTE: `emitDir` currently doesn't see `editsTree` because it's defined
outside `main()`. Move it inside `main()` (a closure) OR pass the tree
through. Closure is simpler — restructure `main()` so `emitDir` is
defined inside it.

- [ ] **Step 5: Re-run the cuirassier draw with no edits authored yet.**

Run: `npm run draw:cuirassier-poses`
Expected: emits 88 PNGs, no "applied N pose-frame edits" log lines (because the JSON file doesn't exist yet → `loadEdits` returns `{}`).

- [ ] **Step 6: Smoke-test with a fake edit.**

Create `public/sprites/poses/edits.json` by hand with:

```json
{ "cuirassier": { "idle": { "S": { "0": { "0": [{ "x": 16, "y": 12, "color": "#ff00ff" }] } } } } }
```

Run: `npm run draw:cuirassier-poses`
Expected: log line `[cuirassier] applied 1 pose-frame edits to idle/S/0/0.png`.

Use the Read tool on `public/sprites/poses/cuirassier/idle/S/0/0.png` and confirm there's a magenta pixel at (16, 12).

- [ ] **Step 7: Clean up the smoke test.**

Delete `public/sprites/poses/edits.json` (or replace its content with `{}`). Re-run `npm run draw:cuirassier-poses`. Sanity-check that the magenta pixel is gone.

- [ ] **Step 8: Do NOT commit.**

---

## Task 3: Integrate applyEdits into line-infantry locomotion seeder

**Files:**
- Modify: `scripts/seed-line-infantry-locomotion.mjs`

NOTE: The seeder writes 80 trousers PNGs (component-level). It does NOT
write the per-frame line-infantry pose-tree PNGs — those are written by
the slicer. So applying frame-level edits in the seeder is wrong — the
seeder's outputs are component-level inputs to the builder, not pose-tree
outputs.

So we DON'T modify the seeder. Frame-level edits for line-infantry need
to be applied at the slicer step, where the per-frame pose-tree PNG is
about to be written.

CORRECTION: This task changes from the seeder to the slicer.

- [ ] **Step 1: Modify `scripts/slice-component-atlas.mjs` to apply edits.**

At the top, add:

```js
import { loadEdits, lookupEdits, applyEdits } from './lib/pose-frame-edits.mjs';
```

In `main()`, load the edits tree once:

```js
const editsTree = await loadEdits(REPO_ROOT);
```

(`REPO_ROOT` already defined.)

In the slice-and-write loop (around line 105 in the current slicer),
between `const png = sliceCell(...)` and `await writePng(outPath, png)`,
apply edits to `png.data`:

```js
const png = sliceCell(src, cell.col, cell.row);
const edits = lookupEdits(editsTree, w.kind, w.runtimePose, cell.dir, 0, w.frameIdx);
const n = applyEdits(png.data, CELL_W, CELL_H, edits);
if (n > 0) {
  console.log(`[slice] applied ${n} pose-frame edits to ${w.runtimePose}/${cell.dir}/0/${w.frameIdx}.png`);
}
await writePng(outPath, png);
```

`png.data` is a Buffer; `applyEdits` writes via byte indices, so it works on Buffer too.

- [ ] **Step 2: Sanity-run the slicer.**

Run: `node scripts/build-soldier-components.mjs --kit line-infantry --scale 16 && node scripts/slice-component-atlas.mjs`
Expected: same outputs as before, no "applied" lines (because edits.json is empty/missing).

- [ ] **Step 3: Smoke-test.**

Create a one-pixel edit on line-infantry idle/S/0/0:

```json
{ "line-infantry": { "idle": { "S": { "0": { "0": [{ "x": 16, "y": 16, "color": "#00ff00" }] } } } } }
```

Re-run the slicer. Expected log line and a green pixel at (16, 16) in `public/sprites/poses/line-infantry/idle/S/0/0.png`.

- [ ] **Step 4: Clean up smoke test.**

Delete `edits.json` (or set to `{}`); re-run slicer; sanity check.

- [ ] **Step 5: Do NOT commit.**

---

## Task 4: Vite middleware — `/api/pose-frame-edits` + extend `/api/build`

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: Add the `/api/pose-frame-edits` POST handler.**

In the `configureServer` function, alongside the existing
`/api/pixel-edits` handler:

```ts
if (method === 'POST' && url === '/api/pose-frame-edits') {
  try {
    const body = await readJsonBody(req);
    const target = resolve(PROJECT_ROOT, 'public/sprites/poses/edits.json');
    await writeFile(target, JSON.stringify(body, null, 2) + '\n', 'utf8');
    sendJson(res, 200, { ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { ok: false, error: message });
  }
  return;
}
```

- [ ] **Step 2: Extend `/api/build` to also run cuirassier draw + manifest.**

The current handler runs `build-soldier-components.mjs`. Replace its
single `execFile` call with a sequence that runs (in series):

1. `node scripts/build-soldier-components.mjs --kit line-infantry --scale 16`
2. `node scripts/slice-component-atlas.mjs`
3. `node scripts/draw-cuirassier-poses.mjs`
4. `node scripts/build-pose-manifest.mjs`

Use a small helper inside the handler:

```ts
async function runStep(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveStep, rejectStep) => {
    execFile(
      process.execPath,
      args,
      { cwd: PROJECT_ROOT, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(
            Object.assign(error, { stdout: String(stdout), stderr: String(stderr) }),
          );
          return;
        }
        resolveStep({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}
```

(Note: keep the existing `rejectPromise`/`resolvePromise` style of the
file. The handler currently uses inline new Promise — refactor minimally.)

Then call:

```ts
const out = [];
out.push(await runStep(['scripts/build-soldier-components.mjs', '--kit', 'line-infantry', '--scale', '16']));
out.push(await runStep(['scripts/slice-component-atlas.mjs']));
out.push(await runStep(['scripts/draw-cuirassier-poses.mjs']));
out.push(await runStep(['scripts/build-pose-manifest.mjs']));
const stdout = out.map(o => o.stdout).join('\n');
const stderr = out.map(o => o.stderr).join('\n');
sendJson(res, 200, { ok: true, stdout, stderr });
```

If any step fails, the error propagates and `sendJson(res, 500, ...)` is sent with the cumulative stdout up to that point.

- [ ] **Step 3: Verify vite still type-checks.**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Manually exercise the new endpoint.**

Start vite (it's already running on http://localhost:5174). Run:

```bash
curl -X POST http://localhost:5174/api/pose-frame-edits -H 'content-type: application/json' -d '{"cuirassier":{"idle":{"S":{"0":{"0":[{"x":16,"y":12,"color":"#ff00ff"}]}}}}}'
```

Expected: `{"ok":true}` and `public/sprites/poses/edits.json` written.

- [ ] **Step 5: Trigger the build endpoint.**

```bash
curl -X POST http://localhost:5174/api/build
```

Expected: `{"ok":true,"stdout":"...","stderr":"..."}` with stdout containing the cuirassier draw + manifest output. Check that `public/sprites/poses/cuirassier/idle/S/0/0.png` now has a magenta pixel at (16,12) (use Read to view).

- [ ] **Step 6: Reset.**

Set `edits.json` content to `{}` (or delete via `rm public/sprites/poses/edits.json`), re-run `/api/build`, confirm pixel reverted.

- [ ] **Step 7: Do NOT commit.**

---

## Task 5: Editor UI — Pose Frames tab

**Files:**
- Modify: `public/components-editor.html`

This is the largest task. Adding a new mode to a 1500-line single-file
editor without breaking the existing flow. The approach: introduce a
top-level mode toggle, then a separate render path that gates on the
active mode.

- [ ] **Step 1: Read `public/components-editor.html` (~1500 lines).**

Identify:
- The top-level layout — there's a header/title bar area near the top of the body.
- Where state.kit / state.poseId / state.facing are managed.
- Where the canvas paint event handlers are wired.
- Where save buttons live.

- [ ] **Step 2: Add the mode-toggle UI.**

Above the existing editor content, add a tab strip:

```html
<div class="mode-tabs" style="display:flex; gap:8px; padding:8px 16px; border-bottom:1px solid #d1d5db;">
  <button id="mode-components" class="mode-tab active">Components</button>
  <button id="mode-pose-frames" class="mode-tab">Pose Frames</button>
</div>
```

CSS:

```css
.mode-tab { padding: 6px 14px; background: transparent; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; }
.mode-tab.active { background: #2563eb; color: #fff; border-color: #2563eb; }
```

State variable: `state.mode = 'components'` (default) or `'pose-frames'`.

Click handlers toggle the active class and call `renderActiveMode()`.

Wrap the existing editor content in a `<div id="components-mode">…</div>`. Add a sibling `<div id="pose-frames-mode" style="display:none">…</div>` containing the new mode's UI (stub at first; populate in subsequent steps).

`renderActiveMode()`:
```js
function renderActiveMode() {
  const cm = document.getElementById('components-mode');
  const pm = document.getElementById('pose-frames-mode');
  if (state.mode === 'pose-frames') {
    cm.style.display = 'none';
    pm.style.display = '';
    renderPoseFramesUI();
  } else {
    cm.style.display = '';
    pm.style.display = 'none';
  }
}
```

- [ ] **Step 3: Add the Pose Frames mode UI (selectors + canvas + buttons).**

Inside `<div id="pose-frames-mode">`:

```html
<div style="padding: 16px;">
  <div style="display:flex; gap:12px; align-items:center; margin-bottom:12px;">
    <label>Kind <select id="pf-kind"></select></label>
    <label>Pose <select id="pf-pose"></select></label>
    <label>Dir <select id="pf-dir"></select></label>
    <label>Clip <select id="pf-clip"></select></label>
    <label>Frame <select id="pf-frame"></select></label>
    <span id="pf-edit-count" style="font-size:13px; color:#374151;">0 edits</span>
  </div>
  <canvas id="pf-canvas" style="border:1px solid #d1d5db; image-rendering:pixelated; cursor:crosshair;"></canvas>
  <div style="display:flex; gap:8px; margin-top:12px;">
    <button id="pf-save">Save</button>
    <button id="pf-build">Build</button>
    <button id="pf-clear">Clear edits for this frame</button>
    <input type="color" id="pf-color" value="#ff0000" />
    <label><input type="checkbox" id="pf-erase"/> Erase</label>
  </div>
  <div id="pf-toast" style="margin-top:8px; font-size:12px; color:#374151;"></div>
</div>
```

- [ ] **Step 4: Add Pose Frames state + manifest fetch.**

```js
state.poseFrames = {
  kind: 'cuirassier',
  pose: 'idle',
  dir: 'S',
  clip: 0,
  frame: 0,
  edits: {},          // tree mirroring edits.json
  manifest: null,     // public/sprites/poses/manifest.json
  zoom: 8,            // pixels per src px in canvas
  baseImage: null,    // ImageData of the on-disk PNG (without edits)
};
```

On editor load, fetch the manifest and the existing edits:

```js
async function loadPoseFramesState() {
  const m = await fetch('/sprites/poses/manifest.json').then(r => r.json());
  state.poseFrames.manifest = m;
  try {
    const e = await fetch('/sprites/poses/edits.json').then(r => r.json());
    state.poseFrames.edits = e || {};
  } catch (_) {
    state.poseFrames.edits = {};
  }
}
```

Call this from the existing init code path.

- [ ] **Step 5: Populate the dropdowns.**

```js
function populateKindDropdown() {
  const sel = document.getElementById('pf-kind');
  sel.innerHTML = '';
  const kinds = Object.keys(state.poseFrames.manifest?.kinds || {});
  for (const k of kinds) {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = k;
    sel.appendChild(opt);
  }
  sel.value = state.poseFrames.kind;
  sel.onchange = () => { state.poseFrames.kind = sel.value; renderPoseFramesUI(); };
}

function populatePoseDropdown() {
  const sel = document.getElementById('pf-pose');
  sel.innerHTML = '';
  const kindEntry = state.poseFrames.manifest?.kinds[state.poseFrames.kind];
  const poses = Object.keys(kindEntry?.poses || {});
  for (const p of poses) {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  }
  if (!poses.includes(state.poseFrames.pose)) state.poseFrames.pose = poses[0] || 'idle';
  sel.value = state.poseFrames.pose;
  sel.onchange = () => { state.poseFrames.pose = sel.value; renderPoseFramesUI(); };
}

function populateDirDropdown() {
  const sel = document.getElementById('pf-dir');
  sel.innerHTML = '';
  const poseEntry = state.poseFrames.manifest?.kinds[state.poseFrames.kind]?.poses[state.poseFrames.pose];
  const dirs = poseEntry?.dirs || [];
  for (const d of dirs) {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    sel.appendChild(opt);
  }
  if (!dirs.includes(state.poseFrames.dir)) state.poseFrames.dir = dirs[0] || 'S';
  sel.value = state.poseFrames.dir;
  sel.onchange = () => { state.poseFrames.dir = sel.value; renderPoseFramesUI(); };
}

function populateClipDropdown() {
  const sel = document.getElementById('pf-clip');
  sel.innerHTML = '';
  const opts = ['0']; // for now only clip 0 is authored anywhere
  for (const c of opts) {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  }
  state.poseFrames.clip = 0;
  sel.value = '0';
}

function populateFrameDropdown() {
  const sel = document.getElementById('pf-frame');
  sel.innerHTML = '';
  const clips = state.poseFrames.manifest?.kinds[state.poseFrames.kind]?.poses[state.poseFrames.pose]?.clips;
  const dirClips = clips?.[state.poseFrames.dir];
  const frameCount = (dirClips && dirClips[state.poseFrames.clip]?.length) || 1;
  for (let i = 0; i < frameCount; i++) {
    const opt = document.createElement('option');
    opt.value = String(i); opt.textContent = String(i);
    sel.appendChild(opt);
  }
  if (state.poseFrames.frame >= frameCount) state.poseFrames.frame = 0;
  sel.value = String(state.poseFrames.frame);
  sel.onchange = () => { state.poseFrames.frame = parseInt(sel.value, 10); renderPoseFramesUI(); };
}
```

- [ ] **Step 6: Load and render the frame's PNG to the canvas.**

```js
async function renderPoseFramesUI() {
  populateKindDropdown();
  populatePoseDropdown();
  populateDirDropdown();
  populateClipDropdown();
  populateFrameDropdown();

  const { kind, pose, dir, clip, frame } = state.poseFrames;
  const url = `/sprites/poses/${kind}/${pose}/${dir}/${clip}/${frame}.png?v=${Date.now()}`;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

  const off = document.createElement('canvas');
  off.width = img.naturalWidth; off.height = img.naturalHeight;
  const offCtx = off.getContext('2d');
  offCtx.drawImage(img, 0, 0);
  state.poseFrames.baseImage = offCtx.getImageData(0, 0, off.width, off.height);

  const canvas = document.getElementById('pf-canvas');
  const z = state.poseFrames.zoom;
  canvas.width = img.naturalWidth * z;
  canvas.height = img.naturalHeight * z;
  redrawPfCanvas();
  updateEditCount();
}

function redrawPfCanvas() {
  const canvas = document.getElementById('pf-canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { baseImage, edits, kind, pose, dir, clip, frame, zoom } = state.poseFrames;
  if (!baseImage) return;

  // Draw base image.
  const tmp = document.createElement('canvas');
  tmp.width = baseImage.width; tmp.height = baseImage.height;
  tmp.getContext('2d').putImageData(baseImage, 0, 0);
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);

  // Overlay edits.
  const list = lookupPfEdits(edits, kind, pose, dir, clip, frame);
  for (const e of list) {
    if (e.color === 'clear') {
      ctx.clearRect(e.x * zoom, e.y * zoom, zoom, zoom);
    } else {
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x * zoom, e.y * zoom, zoom, zoom);
    }
  }
}

function lookupPfEdits(tree, kind, pose, dir, clip, frame) {
  return tree?.[kind]?.[pose]?.[dir]?.[String(clip)]?.[String(frame)] ?? [];
}

function ensurePfEditsArray() {
  const t = state.poseFrames.edits;
  const { kind, pose, dir, clip, frame } = state.poseFrames;
  if (!t[kind]) t[kind] = {};
  if (!t[kind][pose]) t[kind][pose] = {};
  if (!t[kind][pose][dir]) t[kind][pose][dir] = {};
  if (!t[kind][pose][dir][String(clip)]) t[kind][pose][dir][String(clip)] = {};
  if (!t[kind][pose][dir][String(clip)][String(frame)]) t[kind][pose][dir][String(clip)][String(frame)] = [];
  return t[kind][pose][dir][String(clip)][String(frame)];
}

function updateEditCount() {
  const list = lookupPfEdits(state.poseFrames.edits, state.poseFrames.kind, state.poseFrames.pose, state.poseFrames.dir, state.poseFrames.clip, state.poseFrames.frame);
  document.getElementById('pf-edit-count').textContent = `${list.length} edits`;
}
```

- [ ] **Step 7: Wire click-to-paint.**

```js
function attachPfCanvasHandlers() {
  const canvas = document.getElementById('pf-canvas');
  canvas.onclick = (ev) => {
    const r = canvas.getBoundingClientRect();
    const z = state.poseFrames.zoom;
    const x = Math.floor((ev.clientX - r.left) / z);
    const y = Math.floor((ev.clientY - r.top) / z);
    const erase = document.getElementById('pf-erase').checked;
    const color = erase ? 'clear' : document.getElementById('pf-color').value;
    const arr = ensurePfEditsArray();
    arr.push({ x, y, color });
    redrawPfCanvas();
    updateEditCount();
  };
}
```

Call `attachPfCanvasHandlers()` once on init.

- [ ] **Step 8: Wire Save / Build / Clear.**

```js
document.getElementById('pf-save').onclick = async () => {
  try {
    const res = await fetch('/api/pose-frame-edits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state.poseFrames.edits),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showPfToast('Saved');
  } catch (err) {
    showPfToast('Save failed: ' + err.message, true);
  }
};

document.getElementById('pf-build').onclick = async () => {
  showPfToast('Building...');
  try {
    const res = await fetch('/api/build', { method: 'POST' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'HTTP ' + res.status);
    }
    showPfToast('Build OK');
    await renderPoseFramesUI();
  } catch (err) {
    showPfToast('Build failed: ' + err.message, true);
  }
};

document.getElementById('pf-clear').onclick = async () => {
  const t = state.poseFrames.edits;
  const { kind, pose, dir, clip, frame } = state.poseFrames;
  if (t?.[kind]?.[pose]?.[dir]?.[String(clip)]?.[String(frame)]) {
    delete t[kind][pose][dir][String(clip)][String(frame)];
    // No deeper cleanup needed; lookups handle missing keys.
  }
  redrawPfCanvas();
  updateEditCount();
};

function showPfToast(msg, isError = false) {
  const t = document.getElementById('pf-toast');
  t.textContent = msg;
  t.style.color = isError ? '#b91c1c' : '#15803d';
}
```

- [ ] **Step 9: Initialize the new mode on page load.**

Find the existing init / boot function in the editor (search for `loadKit` or similar). After it completes, also call:

```js
await loadPoseFramesState();
attachPfCanvasHandlers();
// Default mode is components; switch to pose-frames if the URL hash says so.
if (location.hash === '#pose-frames') {
  state.mode = 'pose-frames';
  document.getElementById('mode-components').classList.remove('active');
  document.getElementById('mode-pose-frames').classList.add('active');
}
renderActiveMode();
```

Wire mode-tab clicks:

```js
document.getElementById('mode-components').onclick = () => {
  state.mode = 'components';
  document.getElementById('mode-components').classList.add('active');
  document.getElementById('mode-pose-frames').classList.remove('active');
  renderActiveMode();
};
document.getElementById('mode-pose-frames').onclick = () => {
  state.mode = 'pose-frames';
  document.getElementById('mode-pose-frames').classList.add('active');
  document.getElementById('mode-components').classList.remove('active');
  renderActiveMode();
};
```

- [ ] **Step 10: Manual smoke test.**

Reload http://localhost:5174/components-editor.html. Click "Pose Frames". Pick `cuirassier / running / W / 0 / 2`. The frame should render scaled. Click somewhere — a colored square appears. Click "Save" — toast says "Saved". Click "Build" — toast says "Build OK", canvas refreshes. Reload page. The edit should still be present (loaded from the JSON).

- [ ] **Step 11: Do NOT commit.**

---

## Task 6: End-to-end + verify

- [ ] **Step 1: Run the test suite.**

Run: `npm test`
Expected: green (modulo pre-existing failures). New `pose-frame-edits.test.ts` 9 tests passing.

- [ ] **Step 2: Run typecheck.**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Browser smoke (manual).**

http://localhost:5174/components-editor.html → Pose Frames tab. Verify:
- All kinds in dropdown (cuirassier, line-infantry, cannon-12).
- All poses populate based on kind selection.
- Direction populates based on pose.
- Frame index respects multi-frame poses (cuirassier walking has 4, running has 6).
- Painting writes a colored pixel; erase removes it.
- Save → /api/pose-frame-edits writes the JSON.
- Build → all four scripts run, manifest regenerates.
- Reload → edits persist.

- [ ] **Step 4: Manifest sanity.**

Run: `node -e "const m=require('./public/sprites/poses/manifest.json'); console.log(Object.keys(m.kinds))"`
Expected: includes cuirassier, line-infantry, cannon-12.

- [ ] **Step 5: Do NOT commit.**

---

## Self-review

- ✅ Spec coverage:
  - Storage at `public/sprites/poses/edits.json` — Task 1.
  - Helper module + tests — Task 1.
  - Cuirassier draw integrates applyEdits — Task 2.
  - Line-infantry slicer integrates applyEdits — Task 3 (note: slicer, not seeder; corrected in plan).
  - Vite endpoint + extended /api/build — Task 4.
  - Editor Pose Frames tab — Task 5.
  - End-to-end smoke — Task 6.
- ✅ No "TBD"/"TODO" placeholders. Every step has concrete code or commands.
- ✅ Identifier consistency: `loadEdits`, `lookupEdits`, `applyEdits`,
  `EDITS_PATH_REL`, `state.poseFrames.{kind,pose,dir,clip,frame,edits,manifest,zoom,baseImage}`,
  `renderPoseFramesUI`, `redrawPfCanvas`, `lookupPfEdits`,
  `ensurePfEditsArray`, `attachPfCanvasHandlers`, `loadPoseFramesState`,
  `populateKindDropdown` (etc), `showPfToast`, `renderActiveMode`. All
  used unchanged across tasks.
- ✅ Each task ends without a commit; user manages commit boundaries.
- ✅ All file paths and commands exact.
