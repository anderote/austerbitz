# Pose Variants + Layer Paint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Per project convention:** do NOT commit per task — the user decides commit boundaries.

**Goal:** Rebuild `components.html` around a unit→pose→variant browsing flow, surface the existing per-`(pose, facing)` `weapons[]` array as user-facing "Variants", and add a paint mode that lets the user click pixels on the composited preview to edit the underlying source component PNGs via the existing `pixel-edits.json` system.

**Architecture:** Editor-only changes (no runtime/atlas/sprite-pass changes). New layout: top row = unit S-thumbnail + horizontal pose strip; middle = existing 3×3 facing grid; bottom = variants strip + weapon edit strip + (Phase B) paint toolbar. Paint applies pixel writes into the in-memory `pixel-edits.json` tree and re-renders live via an editor-side overlay; the existing `/api/pixel-edits` endpoint persists.

**Tech Stack:** TypeScript, Vite dev server, raw 2D Canvas, no framework. Runtime files (`src/render/poses/*`, `src/render/passes/*`) untouched. JSON field names on disk unchanged (`weapons[]` stays `weapons[]`).

**Spec:** `docs/superpowers/specs/2026-04-28-pose-variants-design.md`

---

## Phase A — Layout rework

### Task A1: Extract shared cell-render helper

**Why first:** the unit picker, pose strip, and variants strip all need to render a "kit + pose + facing + variant index → small canvas" thumbnail. Today that logic lives inline in `component-preview.ts`'s `renderCenterCell`. Extract it to a standalone module so the new strip modules can call it without circular state coupling.

**Files:**
- Create: `src/dev/cell-render.ts`
- Modify: `src/dev/component-preview.ts` (use the new module)

- [ ] **Step 1: Create `src/dev/cell-render.ts`** with a single exported function:

```ts
import { loadImage, getRecoloredCanvas } from './image-cache';
import { paintWeaponInto, facingToSuffix, type WeaponOrientation } from './weapon-rendering';
import type { Regiment } from './regiments';

export interface ComponentEntry {
  id: string;
  type: string;
  category: string;
  facings: string[];
  path: string;
}

export interface CellRenderInput {
  /** Layer ids in draw order (back-to-front). */
  layerIds: string[];
  /** Lookup: layer id → component entry. */
  components: ReadonlyMap<string, ComponentEntry>;
  /** Base URL for component PNGs (`/sprites/components/`). */
  componentBaseUrl: string;
  /** Optional regiment for recolor; null = raw colors. */
  regiment: Regiment | null;
  /** Optional weapon overlay drawn after layers. */
  weapon?: {
    layerPrefix: string;
    orientation: WeaponOrientation;
  };
}

/**
 * Paint one composited cell (background layers + optional weapon) into
 * `target`. Caller is responsible for `clearRect` if desired and for any
 * scaling — we always draw at native size into the (0, 0) origin.
 *
 * Token / cancellation is the caller's responsibility — pass `signal` and
 * we'll bail at await points if it's aborted.
 */
export async function renderCellInto(
  target: CanvasRenderingContext2D,
  input: CellRenderInput,
  signal?: AbortSignal,
): Promise<void> {
  for (const id of input.layerIds) {
    const entry = input.components.get(id);
    if (!entry) continue;
    const url = `${input.componentBaseUrl}${entry.path}`;
    try {
      if (input.regiment) {
        const recolored = await getRecoloredCanvas(url, input.regiment);
        if (signal?.aborted) return;
        target.drawImage(recolored, 0, 0);
      } else {
        const image = await loadImage(url);
        if (signal?.aborted) return;
        target.drawImage(image, 0, 0);
      }
    } catch (err) {
      console.warn('[cell-render]', err);
    }
  }
  if (input.weapon) {
    const { layerPrefix, orientation } = input.weapon;
    const weaponId = `${layerPrefix}-${facingToSuffix(orientation.src)}`;
    const weaponEntry = input.components.get(weaponId);
    if (weaponEntry) {
      const weaponUrl = `${input.componentBaseUrl}${weaponEntry.path}`;
      try {
        await paintWeaponInto(target, weaponUrl, orientation, { applyOffset: true });
        if (signal?.aborted) return;
      } catch (err) {
        console.warn('[cell-render][weapon]', err);
      }
    }
  }
}
```

- [ ] **Step 2: Refactor `component-preview.ts`'s `renderCenterCell` to use `renderCellInto`.**

Replace the body of `renderCenterCell` (around line 398–441 in the current file) with:

```ts
async function renderCenterCell(
  facing: string,
  cellCtx: CanvasRenderingContext2D,
  token: number,
): Promise<void> {
  cellCtx.clearRect(0, 0, cellCtx.canvas.width, cellCtx.canvas.height);

  const layers = layersForFacing(facing);
  const layerIds = layers.map((entry) => entry.id);

  const kit = currentKitId ? kitsById.get(currentKitId) : null;
  const layerPrefix = kit?.weapon?.layerPrefix;

  // Decide weapon orientation: target+working override, else weapons[0].
  let orientation: WeaponOrientation | undefined;
  const isTarget =
    targetCell !== null &&
    targetCell.pose === currentPose &&
    targetCell.facing === facing;
  if (isTarget && workingOrientation) {
    orientation = workingOrientation;
  } else {
    const entry = getPoseEntry(facing);
    orientation = entry?.weapons?.[0];
  }

  const signal = new AbortController();
  // Inline-cancel via the existing token mechanism: if renderToken changes,
  // abort by aborting our local controller. Keep the existing token pattern by
  // bailing manually on returns from `renderCellInto`.
  if (token !== renderToken) return;

  await renderCellInto(cellCtx, {
    layerIds,
    components: componentsById,
    componentBaseUrl: COMPONENT_BASE_URL,
    regiment: currentRegiment,
    weapon: layerPrefix && orientation ? { layerPrefix, orientation } : undefined,
  }, signal.signal);

  if (token !== renderToken) return;

  // Variant badge (count of saved weapons[]).
  const entry = getPoseEntry(facing);
  const variantCount = entry?.weapons?.length ?? 0;
  drawVariantBadge(cellCtx, variantCount);
}
```

- [ ] **Step 3: Add an import for `renderCellInto` to `component-preview.ts`.**

```ts
import { renderCellInto } from './cell-render';
```

- [ ] **Step 4: Run `npm run dev` and load `/components.html`. Verify nothing has changed visually** — same 3×3 grid, same weapon overlays, same selection behavior. Pure refactor checkpoint.

---

### Task A2: HTML scaffold for the new layout

**Files:**
- Modify: `components.html`

- [ ] **Step 1: Replace the contents of `<main>` in `components.html`** with the new structural layout. Drop the `<aside>` (its contents move to the Advanced drawer); drop the `.preview` section's `info-card` (move to the bottom of main); restructure into top + middle + bottom rows. Keep ALL existing canvas/button ids inside their new homes — the JS still references them.

The new `<main>` body:

```html
<main>
  <!-- TOP ROW -->
  <section class="top-row">
    <button class="unit-thumb" id="unit-thumb-button" type="button" title="Click to switch unit">
      <canvas id="unit-thumb-canvas" width="32" height="36"></canvas>
      <span class="unit-thumb-label" id="unit-thumb-label">—</span>
    </button>
    <div class="pose-strip" id="pose-strip"></div>
  </section>

  <!-- UNIT PICKER POPOVER (hidden by default) -->
  <div class="popover-backdrop" id="unit-picker-backdrop" hidden>
    <div class="unit-picker" id="unit-picker">
      <h2>Select Unit</h2>
      <div class="unit-picker-grid" id="unit-picker-grid"></div>
    </div>
  </div>

  <!-- MIDDLE: 3x3 facing grid -->
  <section class="preview">
    <div class="facing-grid" id="facing-grid">
      <button class="facing-cell" type="button" data-facing="NW"><canvas width="32" height="36"></canvas><span class="label">NW</span></button>
      <button class="facing-cell" type="button" data-facing="N"><canvas width="32" height="36"></canvas><span class="label">N</span></button>
      <button class="facing-cell" type="button" data-facing="NE"><canvas width="32" height="36"></canvas><span class="label">NE</span></button>
      <button class="facing-cell" type="button" data-facing="W"><canvas width="32" height="36"></canvas><span class="label">W</span></button>
      <div class="facing-cell-empty"></div>
      <button class="facing-cell" type="button" data-facing="E"><canvas width="32" height="36"></canvas><span class="label">E</span></button>
      <button class="facing-cell" type="button" data-facing="SW"><canvas width="32" height="36"></canvas><span class="label">SW</span></button>
      <button class="facing-cell" type="button" data-facing="S"><canvas width="32" height="36"></canvas><span class="label">S</span></button>
      <button class="facing-cell" type="button" data-facing="SE"><canvas width="32" height="36"></canvas><span class="label">SE</span></button>
    </div>
  </section>

  <!-- BOTTOM: variants strip + weapon edit strip -->
  <section class="bottom-row">
    <div class="variants-strip" id="variants-strip"></div>
    <div class="weapon-edit-pane">
      <div id="weapon-source-panel">
        <h2>Weapon Source</h2>
        <div id="weapon-source-grid">
          <button class="weapon-source-cell" type="button" data-facing="NW"><canvas width="32" height="32"></canvas><span class="label">NW</span></button>
          <button class="weapon-source-cell" type="button" data-facing="N"><canvas width="32" height="32"></canvas><span class="label">N</span></button>
          <button class="weapon-source-cell" type="button" data-facing="NE"><canvas width="32" height="32"></canvas><span class="label">NE</span></button>
          <button class="weapon-source-cell" type="button" data-facing="W"><canvas width="32" height="32"></canvas><span class="label">W</span></button>
          <div class="weapon-source-cell-empty"></div>
          <button class="weapon-source-cell" type="button" data-facing="E"><canvas width="32" height="32"></canvas><span class="label">E</span></button>
          <button class="weapon-source-cell" type="button" data-facing="SW"><canvas width="32" height="32"></canvas><span class="label">SW</span></button>
          <button class="weapon-source-cell" type="button" data-facing="S"><canvas width="32" height="32"></canvas><span class="label">S</span></button>
          <button class="weapon-source-cell" type="button" data-facing="SE"><canvas width="32" height="32"></canvas><span class="label">SE</span></button>
        </div>
        <h2>Edit</h2>
        <div id="weapon-edit-strip">
          <canvas id="weapon-edit-thumb" width="32" height="32"></canvas>
          <div id="weapon-edit-stats">
            <div><span class="stat-key">x:</span> <span id="stat-x">—</span></div>
            <div><span class="stat-key">y:</span> <span id="stat-y">—</span></div>
            <div><span class="stat-key">rot:</span> <span id="stat-rot">—</span></div>
            <div><span class="stat-key">flipX:</span> <span id="stat-flipx">—</span></div>
          </div>
          <div class="button-row">
            <button id="btn-mirror" type="button">Mirror</button>
            <button id="btn-rotate" type="button">Rotate 90&deg;</button>
            <button id="btn-save-kit" class="primary" type="button">Save Kit</button>
            <button id="btn-delete-variant" type="button">Delete</button>
          </div>
          <div id="weapon-edit-help">
            Arrow keys: nudge 1px &middot; Shift+Arrow: nudge 8px
          </div>
        </div>
      </div>
    </div>
  </section>

  <div class="info-card" id="info-card"></div>

  <!-- ADVANCED DRAWER (collapsible) -->
  <details class="advanced-drawer" id="advanced-drawer">
    <summary>⚙ Advanced</summary>
    <div class="advanced-body">
      <label>Facing <select id="facing-select"></select></label>
      <label>Kit <select id="kit-select"></select></label>
      <label>Pose <select id="pose-select">
        <option value="idle" selected>idle</option>
        <option value="walking">walking</option>
        <option value="running">running</option>
        <option value="make-ready">make-ready</option>
        <option value="present">present</option>
        <option value="fire">fire</option>
        <option value="hit">hit</option>
        <option value="dying">dying</option>
      </select></label>
      <label>Regiment <select id="regiment-select"></select></label>
      <label>Skeleton <select id="skeleton-select">
        <option value="none">None</option>
        <option value="front">Front</option>
        <option value="side">Side</option>
        <option value="back">Back</option>
      </select></label>
      <button class="reset" id="reset-button">Reset to Kit</button>
      <div id="component-groups"></div>
    </div>
  </details>
</main>
```

- [ ] **Step 2: Replace the `<style>` block** with new layout-aware styles. Keep all existing component styles (`.facing-cell`, `.weapon-source-cell`, `#weapon-edit-strip`, `#toast`); add styles for the new structural elements:

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #0f1115;
  color: #f3f4f6;
}
main {
  display: grid;
  grid-template-rows: auto 1fr auto auto;
  min-height: 100vh;
  padding: 12px;
  gap: 12px;
}

/* --- TOP ROW --- */
.top-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 16px;
  align-items: stretch;
}
.unit-thumb {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  background: rgba(21, 24, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  cursor: pointer;
  color: inherit;
}
.unit-thumb:hover { border-color: rgba(147, 197, 253, 0.55); }
.unit-thumb canvas {
  width: 96px;
  height: 108px;
  image-rendering: pixelated;
  background: #cbd5e1;
  border-radius: 4px;
}
.unit-thumb-label {
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #9ca3af;
}
.pose-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 8px;
  background: rgba(21, 24, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}
.pose-strip-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: rgba(12, 15, 20, 0.6);
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
}
.pose-strip-cell:hover { border-color: rgba(147, 197, 253, 0.55); }
.pose-strip-cell.active { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6; }
.pose-strip-cell canvas {
  width: 64px;
  height: 72px;
  image-rendering: pixelated;
  background: #cbd5e1;
  border-radius: 2px;
}
.pose-strip-cell .pose-label {
  font-size: 10px;
  font-family: ui-monospace, Menlo, monospace;
  color: #d1d5db;
}

/* --- POPOVER --- */
.popover-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.popover-backdrop[hidden] { display: none; }
.unit-picker {
  background: #15181e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 16px;
  max-width: 80vw;
  max-height: 80vh;
  overflow: auto;
}
.unit-picker h2 {
  margin: 0 0 12px;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9ca3af;
}
.unit-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}
.unit-picker-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  background: rgba(12, 15, 20, 0.6);
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
}
.unit-picker-cell:hover { border-color: rgba(147, 197, 253, 0.55); }
.unit-picker-cell.active { border-color: #3b82f6; }
.unit-picker-cell canvas {
  width: 96px;
  height: 108px;
  image-rendering: pixelated;
  background: #cbd5e1;
  border-radius: 2px;
}
.unit-picker-cell .unit-label {
  font-size: 11px;
  font-family: ui-monospace, Menlo, monospace;
  color: #d1d5db;
}

/* --- MIDDLE: facing grid (existing styles preserved) --- */
section.preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.facing-grid {
  display: grid;
  grid-template-columns: repeat(3, 96px);
  grid-template-rows: repeat(3, 108px);
  gap: 6px;
}
.facing-cell {
  position: relative;
  width: 96px;
  height: 108px;
  padding: 0;
  background: #cbd5e1;
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
}
.facing-cell:hover { border-color: rgba(147, 197, 253, 0.55); }
.facing-cell.active { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6; }
.facing-cell.target { border-color: #f59e0b; box-shadow: 0 0 0 1px #f59e0b; }
.facing-cell.active.target { border-color: #f59e0b; box-shadow: 0 0 0 1px #f59e0b, 0 0 0 3px rgba(59, 130, 246, 0.55); }
.facing-cell canvas {
  position: absolute; inset: 0; width: 100%; height: 100%;
  image-rendering: pixelated; pointer-events: none;
}
.facing-cell .label {
  position: absolute; top: 3px; left: 5px;
  font-size: 10px; font-family: ui-monospace, Menlo, monospace;
  color: rgba(243, 244, 246, 0.85);
  background: rgba(12, 15, 20, 0.65);
  padding: 1px 4px; border-radius: 2px; pointer-events: none;
}
.facing-cell-empty { width: 96px; height: 108px; }

/* --- BOTTOM: variants strip + weapon edit pane --- */
.bottom-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: stretch;
}
.variants-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 8px;
  background: rgba(21, 24, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}
.variant-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: rgba(12, 15, 20, 0.6);
  border: 2px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  cursor: pointer;
  color: inherit;
}
.variant-cell:hover { border-color: rgba(147, 197, 253, 0.55); }
.variant-cell.active { border-color: #3b82f6; box-shadow: 0 0 0 1px #3b82f6; }
.variant-cell canvas {
  width: 64px;
  height: 72px;
  image-rendering: pixelated;
  background: #cbd5e1;
  border-radius: 2px;
}
.variant-cell .variant-idx {
  font-size: 10px;
  font-family: ui-monospace, Menlo, monospace;
  color: #9ca3af;
}
.variant-cell.add-new {
  border-style: dashed;
  font-size: 24px;
  color: #6b7280;
  align-items: center;
  justify-content: center;
  min-width: 76px;
}
.weapon-edit-pane {
  min-width: 200px;
}
#weapon-source-panel {
  padding: 12px;
  background: rgba(21, 24, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
#weapon-source-panel h2 {
  margin: 0 0 4px;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9ca3af;
}
#weapon-source-grid {
  display: grid;
  grid-template-columns: repeat(3, 40px);
  grid-template-rows: repeat(3, 40px);
  gap: 4px;
}
.weapon-source-cell {
  position: relative; width: 40px; height: 40px; padding: 0;
  background: #cbd5e1; border: 2px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px; cursor: pointer; overflow: hidden;
}
.weapon-source-cell:hover { border-color: rgba(147, 197, 253, 0.55); }
.weapon-source-cell.active { border-color: #34d399; box-shadow: 0 0 0 1px #34d399; }
.weapon-source-cell.disabled { opacity: 0.35; cursor: not-allowed; }
.weapon-source-cell canvas {
  position: absolute; inset: 0; width: 100%; height: 100%;
  image-rendering: pixelated; pointer-events: none;
}
.weapon-source-cell .label {
  position: absolute; top: 1px; left: 2px;
  font-size: 8px; font-family: ui-monospace, Menlo, monospace;
  color: rgba(243, 244, 246, 0.85); background: rgba(12, 15, 20, 0.65);
  padding: 0 2px; border-radius: 2px; pointer-events: none;
}
.weapon-source-cell-empty { width: 40px; height: 40px; }

#weapon-edit-strip {
  display: flex; flex-direction: column; gap: 8px; font-size: 12px;
}
#weapon-edit-thumb {
  width: 40px; height: 40px; background: #cbd5e1;
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 4px;
  image-rendering: pixelated;
}
#weapon-edit-stats {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px; color: #d1d5db; line-height: 1.5;
}
#weapon-edit-stats .stat-key { color: #6b7280; }
#weapon-edit-strip .button-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
}
#weapon-edit-strip button {
  padding: 6px 8px; background: rgba(56, 76, 110, 0.45);
  border: 1px solid rgba(113, 153, 204, 0.6); color: inherit;
  border-radius: 4px; cursor: pointer; font-size: 12px;
}
#weapon-edit-strip button:hover { background: rgba(73, 104, 150, 0.55); }
#weapon-edit-strip button:disabled { opacity: 0.45; cursor: not-allowed; }
#weapon-edit-strip button.primary {
  background: rgba(34, 197, 94, 0.32); border-color: rgba(74, 222, 128, 0.7);
}
#weapon-edit-strip button.primary:hover { background: rgba(34, 197, 94, 0.45); }
#weapon-edit-help { font-size: 10px; color: #6b7280; line-height: 1.4; }

/* --- INFO CARD --- */
.info-card {
  padding: 8px 12px;
  background: rgba(17, 24, 39, 0.85);
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 4px;
  font-size: 11px;
  font-family: ui-monospace, Menlo, monospace;
  line-height: 1.4;
}
.info-card strong { color: #93c5fd; font-weight: 600; }

/* --- ADVANCED DRAWER --- */
.advanced-drawer {
  background: rgba(21, 24, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 8px 12px;
}
.advanced-drawer summary {
  cursor: pointer;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9ca3af;
}
.advanced-body {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  padding-top: 12px;
}
.advanced-body label {
  display: flex; flex-direction: column; gap: 4px;
  font-size: 11px; color: #9ca3af;
}
.advanced-body select, .advanced-body button {
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(12, 15, 20, 0.9);
  color: inherit;
  font-size: 12px;
}
.advanced-body button.reset {
  background: rgba(56, 76, 110, 0.45);
  border-color: rgba(113, 153, 204, 0.6);
  cursor: pointer;
}
#component-groups { grid-column: 1 / -1; max-height: 300px; overflow-y: auto; font-size: 12px; }
#component-groups label { display: flex; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; }
#component-groups h2 { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #9ca3af; margin: 8px 0 4px; }

/* --- TOAST --- */
#toast {
  position: fixed; bottom: 16px; right: 16px;
  padding: 10px 14px; background: rgba(12, 15, 20, 0.95);
  border: 1px solid rgba(147, 197, 253, 0.6); border-radius: 4px;
  font-size: 12px; opacity: 0; transform: translateY(8px);
  transition: opacity 160ms ease, transform 160ms ease;
  pointer-events: none; z-index: 100;
}
#toast.show { opacity: 1; transform: translateY(0); }
#toast.error { border-color: rgba(248, 113, 113, 0.7); }
#toast.success { border-color: rgba(74, 222, 128, 0.7); }
```

- [ ] **Step 3: Reload `/components.html`** in the browser. Verify:
  - The page loads without JS errors (the unit thumbnail / pose strip / variants strip will be empty until later tasks wire them up).
  - All existing controls still function — Advanced drawer can be toggled open and the kit/pose/regiment/facing/skeleton selects + Reset + component checkboxes work.
  - The 3×3 grid renders.
  - The weapon source 3×3 + edit strip render.

---

### Task A3: Unit picker module

**Files:**
- Create: `src/dev/unit-picker.ts`
- Modify: `src/dev/component-preview.ts` (mount + wire)

- [ ] **Step 1: Create `src/dev/unit-picker.ts`:**

```ts
import { renderCellInto, type ComponentEntry } from './cell-render';
import type { Regiment } from './regiments';

export interface UnitPickerKit {
  id: string;
  label: string;
  /** Layer ids for the kit's S-facing rest pose (kit.facings.S.layers). */
  sLayers: string[];
  /** Optional weapon block + S-facing weapons[0] for the thumbnail. */
  weapon?: {
    layerPrefix: string;
    sOrientation?: { src: string; x: number; y: number; rot: number; flipX?: boolean; transform?: 'flipX' | 'flipY' | 'rot180' };
  };
}

export interface UnitPickerOptions {
  components: ReadonlyMap<string, ComponentEntry>;
  componentBaseUrl: string;
  regiment: Regiment | null;
  onPick: (kitId: string) => void;
}

/**
 * Wire the unit thumbnail (top-left button) and the picker popover. Returns
 * a `refresh()` you call when the active kit / regiment changes (re-paints
 * the thumbnail) and an `open()` you call to show the popover (also called
 * automatically on thumbnail click).
 */
export function mountUnitPicker(opts: UnitPickerOptions): {
  setKits(kits: UnitPickerKit[]): void;
  setActiveKit(kitId: string | null): void;
  refresh(): void;
} {
  const thumbButton = document.getElementById('unit-thumb-button') as HTMLButtonElement;
  const thumbCanvas = document.getElementById('unit-thumb-canvas') as HTMLCanvasElement;
  const thumbLabel = document.getElementById('unit-thumb-label') as HTMLSpanElement;
  const thumbCtx = thumbCanvas.getContext('2d', { alpha: true });
  if (!thumbCtx) throw new Error('unit-picker: 2D context unavailable');
  thumbCtx.imageSmoothingEnabled = false;

  const backdrop = document.getElementById('unit-picker-backdrop') as HTMLDivElement;
  const grid = document.getElementById('unit-picker-grid') as HTMLDivElement;

  let kits: UnitPickerKit[] = [];
  let activeKitId: string | null = null;

  function renderThumb(): void {
    const kit = kits.find((k) => k.id === activeKitId);
    if (!kit) {
      thumbLabel.textContent = '—';
      thumbCtx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);
      return;
    }
    thumbLabel.textContent = kit.label;
    void renderCellInto(thumbCtx, {
      layerIds: kit.sLayers,
      components: opts.components,
      componentBaseUrl: opts.componentBaseUrl,
      regiment: opts.regiment,
      weapon: kit.weapon?.layerPrefix && kit.weapon.sOrientation
        ? { layerPrefix: kit.weapon.layerPrefix, orientation: kit.weapon.sOrientation as any }
        : undefined,
    }).catch((err) => console.warn('[unit-thumb]', err));
  }

  function renderPickerGrid(): void {
    grid.innerHTML = '';
    for (const kit of kits) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'unit-picker-cell';
      if (kit.id === activeKitId) cell.classList.add('active');

      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 36;
      const cctx = c.getContext('2d', { alpha: true });
      if (cctx) {
        cctx.imageSmoothingEnabled = false;
        void renderCellInto(cctx, {
          layerIds: kit.sLayers,
          components: opts.components,
          componentBaseUrl: opts.componentBaseUrl,
          regiment: opts.regiment,
          weapon: kit.weapon?.layerPrefix && kit.weapon.sOrientation
            ? { layerPrefix: kit.weapon.layerPrefix, orientation: kit.weapon.sOrientation as any }
            : undefined,
        }).catch((err) => console.warn('[unit-picker]', err));
      }

      const label = document.createElement('span');
      label.className = 'unit-label';
      label.textContent = kit.label;

      cell.append(c, label);
      cell.addEventListener('click', () => {
        opts.onPick(kit.id);
        backdrop.hidden = true;
      });
      grid.appendChild(cell);
    }
  }

  thumbButton.addEventListener('click', () => {
    renderPickerGrid();
    backdrop.hidden = false;
  });
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) backdrop.hidden = true;
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !backdrop.hidden) backdrop.hidden = true;
  });

  return {
    setKits(list) {
      kits = list;
      renderThumb();
    },
    setActiveKit(id) {
      activeKitId = id;
      renderThumb();
    },
    refresh() {
      renderThumb();
    },
  };
}
```

- [ ] **Step 2: Wire it up in `component-preview.ts`'s `main()`** (after `loadKits()` finishes, before `renderPreview()`). Build `UnitPickerKit[]` from `kitsById`:

```ts
import { mountUnitPicker, type UnitPickerKit } from './unit-picker';

function buildPickerKits(): UnitPickerKit[] {
  const out: UnitPickerKit[] = [];
  for (const kit of kitsById.values()) {
    const sFacing = kit.facings['S'];
    const sLayers = sFacing?.layers ?? [];
    let weapon: UnitPickerKit['weapon'];
    if (kit.weapon?.layerPrefix) {
      const sPoseEntry = kit.poses?.idle?.['S'];
      const sOrientation = sPoseEntry && !Array.isArray(sPoseEntry)
        ? (sPoseEntry as { weapons?: any[] }).weapons?.[0]
        : undefined;
      weapon = { layerPrefix: kit.weapon.layerPrefix, sOrientation };
    }
    out.push({ id: kit.id, label: kit.label, sLayers, weapon });
  }
  return out;
}

const unitPicker = mountUnitPicker({
  components: componentsById,
  componentBaseUrl: COMPONENT_BASE_URL,
  regiment: currentRegiment,
  onPick: (kitId) => {
    setKit(kitId);
    applyKitDefaults(currentKitId, currentFacing);
    rebuildComponentGroups();
    targetCell = null;
    workingOrientation = null;
    updateEditStrip();
    void renderWeaponSourceGrid();
    void renderPreview();
    unitPicker.setActiveKit(kitId);
    unitPicker.refresh();
  },
});
unitPicker.setKits(buildPickerKits());
unitPicker.setActiveKit(currentKitId);
```

- [ ] **Step 3: Hook regiment changes** — in the existing `regimentSelect.addEventListener('change', ...)`, add a call to `unitPicker.refresh()` so the thumbnail recolors:

```ts
regimentSelect.addEventListener('change', () => {
  const next = regiments.find((r) => r.id === regimentSelect.value);
  if (next) {
    currentRegiment = next;
    void renderPreview();
    unitPicker.refresh();   // <-- add this
  }
});
```

Note: `mountUnitPicker` captures `regiment` by value, so we also need it to re-read on refresh. Add a setter to the picker module return:

In `unit-picker.ts`, change the closure to read `opts.regiment` lazily — wrap reads in a getter or accept a `getRegiment: () => Regiment | null` callback. Simpler fix: change `opts.regiment` accesses to call `getRegiment()`:

```ts
export interface UnitPickerOptions {
  components: ReadonlyMap<string, ComponentEntry>;
  componentBaseUrl: string;
  getRegiment: () => Regiment | null;   // <-- changed
  onPick: (kitId: string) => void;
}
```

And replace each `opts.regiment` with `opts.getRegiment()`. Update the call site in `component-preview.ts`:

```ts
const unitPicker = mountUnitPicker({
  components: componentsById,
  componentBaseUrl: COMPONENT_BASE_URL,
  getRegiment: () => currentRegiment,   // <-- changed
  onPick: (kitId) => { /* ... */ },
});
```

- [ ] **Step 4: Reload and verify** — the unit thumbnail at top-left renders the active kit's S-facing with weapon overlay; clicking it opens a popover with one cell per kit; clicking a cell switches the active kit and closes the popover; pressing Escape closes the popover; changing regiment in Advanced re-tints the thumbnail.

---

### Task A4: Pose strip module

**Files:**
- Create: `src/dev/pose-strip.ts`
- Modify: `src/dev/component-preview.ts`

- [ ] **Step 1: Create `src/dev/pose-strip.ts`:**

```ts
import { renderCellInto, type ComponentEntry } from './cell-render';
import type { Regiment } from './regiments';

export interface PoseStripPose {
  name: string;
  /** S-facing layer ids for this pose (frame 0 if animated). */
  sLayers: string[];
  /** Optional weapon overlay for the S-facing thumbnail. */
  weapon?: {
    layerPrefix: string;
    sOrientation?: any;
  };
}

export interface PoseStripOptions {
  components: ReadonlyMap<string, ComponentEntry>;
  componentBaseUrl: string;
  getRegiment: () => Regiment | null;
  onPick: (poseName: string) => void;
}

export function mountPoseStrip(opts: PoseStripOptions): {
  setPoses(poses: PoseStripPose[]): void;
  setActivePose(name: string): void;
  refresh(): void;
} {
  const strip = document.getElementById('pose-strip') as HTMLDivElement;

  let poses: PoseStripPose[] = [];
  let activeName = '';

  function render(): void {
    strip.innerHTML = '';
    for (const pose of poses) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'pose-strip-cell';
      if (pose.name === activeName) cell.classList.add('active');

      const c = document.createElement('canvas');
      c.width = 32; c.height = 36;
      const cctx = c.getContext('2d', { alpha: true });
      if (cctx) {
        cctx.imageSmoothingEnabled = false;
        void renderCellInto(cctx, {
          layerIds: pose.sLayers,
          components: opts.components,
          componentBaseUrl: opts.componentBaseUrl,
          regiment: opts.getRegiment(),
          weapon: pose.weapon?.layerPrefix && pose.weapon.sOrientation
            ? { layerPrefix: pose.weapon.layerPrefix, orientation: pose.weapon.sOrientation }
            : undefined,
        }).catch((err) => console.warn('[pose-strip]', err));
      }

      const label = document.createElement('span');
      label.className = 'pose-label';
      label.textContent = pose.name;

      cell.append(c, label);
      cell.addEventListener('click', () => opts.onPick(pose.name));
      strip.appendChild(cell);
    }
  }

  return {
    setPoses(list) { poses = list; render(); },
    setActivePose(name) { activeName = name; render(); },
    refresh() { render(); },
  };
}
```

- [ ] **Step 2: Wire it up in `component-preview.ts`.** Compute `PoseStripPose[]` from the active kit:

```ts
import { mountPoseStrip, type PoseStripPose } from './pose-strip';

function buildPoseStrip(): PoseStripPose[] {
  if (!currentKitId) return [];
  const kit = kitsById.get(currentKitId);
  if (!kit) return [];
  const poseNames = kit.poses ? Object.keys(kit.poses) : [];
  // Fallback to the static dropdown list if the kit has no authored poses.
  const fallback = ['idle','walking','running','make-ready','present','fire','hit','dying'];
  const names = poseNames.length > 0 ? poseNames : fallback;
  return names.map((name) => {
    const sEntry = kit.poses?.[name]?.['S'];
    let sLayers: string[];
    if (!sEntry) {
      sLayers = kit.facings['S']?.layers ?? [];
    } else if (Array.isArray(sEntry)) {
      // bare array — string[][] (per-frame) or string[] (single).
      const first = sEntry[0];
      sLayers = Array.isArray(first) ? (first as string[]) : (sEntry as string[]);
    } else {
      const obj = sEntry as { layers?: string[] | string[][] };
      const baseLayers = obj.layers && obj.layers.length > 0
        ? (Array.isArray(obj.layers[0]) ? (obj.layers[0] as string[]) : (obj.layers as string[]))
        : (kit.facings['S']?.layers ?? []);
      sLayers = baseLayers;
    }
    let weapon: PoseStripPose['weapon'];
    if (kit.weapon?.layerPrefix) {
      const orientation = sEntry && !Array.isArray(sEntry)
        ? (sEntry as { weapons?: any[] }).weapons?.[0]
        : undefined;
      weapon = { layerPrefix: kit.weapon.layerPrefix, sOrientation: orientation };
    }
    return { name, sLayers, weapon };
  });
}

const poseStrip = mountPoseStrip({
  components: componentsById,
  componentBaseUrl: COMPONENT_BASE_URL,
  getRegiment: () => currentRegiment,
  onPick: (name) => {
    currentPose = name;
    poseSelect.value = name;
    targetCell = null;
    workingOrientation = null;
    updateEditStrip();
    updateSourceGridHighlight();
    poseStrip.setActivePose(name);
    void renderPreview();
  },
});
poseStrip.setPoses(buildPoseStrip());
poseStrip.setActivePose(currentPose);
```

- [ ] **Step 3: Wire pose-strip refresh into kit-change and regiment-change.** In the existing `kitSelect.addEventListener('change', ...)` handler and inside the `unitPicker.onPick`, add:

```ts
poseStrip.setPoses(buildPoseStrip());
poseStrip.setActivePose(currentPose);
```

In the existing `regimentSelect` handler, add `poseStrip.refresh();` next to the existing `unitPicker.refresh();`.

In the existing `poseSelect.addEventListener('change', ...)`, add `poseStrip.setActivePose(currentPose);` so the dropdown stays synced with the strip.

- [ ] **Step 4: Reload and verify** — the pose strip shows one cell per pose with S-facing thumbnail + label; the active pose cell has a blue ring; clicking a cell sets `currentPose` and the main 3×3 updates; clicking in the pose-select dropdown also highlights the matching strip cell.

---

### Task A5: Variants strip module

**Files:**
- Create: `src/dev/variants-strip.ts`
- Modify: `src/dev/component-preview.ts`

- [ ] **Step 1: Create `src/dev/variants-strip.ts`:**

```ts
import { renderCellInto, type ComponentEntry } from './cell-render';
import type { Regiment } from './regiments';
import type { WeaponOrientation } from './weapon-rendering';

export interface VariantsStripOptions {
  components: ReadonlyMap<string, ComponentEntry>;
  componentBaseUrl: string;
  getRegiment: () => Regiment | null;
  onPickVariant: (idx: number) => void;
  onAddVariant: () => void;
}

export function mountVariantsStrip(opts: VariantsStripOptions): {
  setContent(layerIds: string[], weaponLayerPrefix: string | null, variants: WeaponOrientation[], activeIdx: number): void;
} {
  const strip = document.getElementById('variants-strip') as HTMLDivElement;

  function render(layerIds: string[], layerPrefix: string | null, variants: WeaponOrientation[], activeIdx: number): void {
    strip.innerHTML = '';
    variants.forEach((orientation, idx) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'variant-cell';
      if (idx === activeIdx) cell.classList.add('active');

      const c = document.createElement('canvas');
      c.width = 32; c.height = 36;
      const cctx = c.getContext('2d', { alpha: true });
      if (cctx) {
        cctx.imageSmoothingEnabled = false;
        void renderCellInto(cctx, {
          layerIds,
          components: opts.components,
          componentBaseUrl: opts.componentBaseUrl,
          regiment: opts.getRegiment(),
          weapon: layerPrefix ? { layerPrefix, orientation } : undefined,
        }).catch((err) => console.warn('[variants-strip]', err));
      }

      const idxLabel = document.createElement('span');
      idxLabel.className = 'variant-idx';
      idxLabel.textContent = `v${idx}`;

      cell.append(c, idxLabel);
      cell.addEventListener('click', () => opts.onPickVariant(idx));
      strip.appendChild(cell);
    });

    // [+ new] cell.
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'variant-cell add-new';
    add.textContent = '+';
    add.title = 'Add a new variant for this (pose, facing)';
    add.addEventListener('click', () => opts.onAddVariant());
    strip.appendChild(add);
  }

  return {
    setContent(layerIds, weaponLayerPrefix, variants, activeIdx) {
      render(layerIds, weaponLayerPrefix, variants, activeIdx);
    },
  };
}
```

- [ ] **Step 2: Wire variant strip into `component-preview.ts`'s state.** Replace the old `targetCell` / `workingOrientation` two-step model with a single `selectedVariantIdx: number` for the current `(currentPose, currentFacing)`:

Add module-scope state:

```ts
import { mountVariantsStrip } from './variants-strip';

let selectedVariantIdx = 0;
```

Add a helper to read variants for the current cell:

```ts
function currentVariants(): WeaponOrientation[] {
  if (!currentKitId) return [];
  const kit = kitsById.get(currentKitId);
  if (!kit) return [];
  const entry = kit.poses?.[currentPose]?.[currentFacing];
  if (!entry || Array.isArray(entry)) return [];
  return ((entry as { weapons?: WeaponOrientation[] }).weapons) ?? [];
}
```

Mount the strip:

```ts
const variantsStrip = mountVariantsStrip({
  components: componentsById,
  componentBaseUrl: COMPONENT_BASE_URL,
  getRegiment: () => currentRegiment,
  onPickVariant: (idx) => {
    selectedVariantIdx = idx;
    workingOrientation = null;  // direct binding to weapons[idx], no working buffer
    refreshVariantsStrip();
    updateEditStrip();
    updateSourceGridHighlight();
    void renderPreview();
  },
  onAddVariant: () => {
    if (!currentKitId) return;
    const kit = kitsById.get(currentKitId)!;
    const list = ensurePoseEntryWeapons(kit, currentPose, currentFacing);
    list.push({ src: currentFacing as any, x: 0, y: 0, rot: 0 });
    selectedVariantIdx = list.length - 1;
    refreshVariantsStrip();
    updateEditStrip();
    updateSourceGridHighlight();
    void renderPreview();
  },
});

function refreshVariantsStrip(): void {
  const layers = layersForFacing(currentFacing).map((e) => e.id);
  const kit = currentKitId ? kitsById.get(currentKitId) : null;
  const layerPrefix = kit?.weapon?.layerPrefix ?? null;
  variantsStrip.setContent(layers, layerPrefix, currentVariants(), selectedVariantIdx);
}
```

- [ ] **Step 3: Refresh the strip after every state change that affects content** — kit, pose, or facing changes. In each existing handler (`kitSelect`, `poseSelect`, facing-cell clicks, `regimentSelect`), add a `refreshVariantsStrip();` call. Also call it once in `main()` after the initial setup, and inside `unitPicker.onPick`'s callback.

- [ ] **Step 4: Reload and verify** — bottom strip shows one cell per `weapons[i]` for the current `(pose, facing)`; clicking a cell highlights it; the [+] cell appends a new variant initialized at `(0, 0, 0)` and selects it; switching facing or pose rebuilds the strip.

---

### Task A6: Bind weapon edit strip to selected variant

The current edit-strip flow goes: pick a center cell (target), pick a source cell (working), tweak, Save Variant (commits). Replace with: select a variant in the strip, tweak, Save Kit (persists to disk). The "Save Variant" button is removed.

**Files:**
- Modify: `src/dev/component-preview.ts`

- [ ] **Step 1: Remove the `targetCell` / `workingOrientation` state and all references.** Delete:

```ts
let targetCell: { pose: string; facing: string } | null = null;
let workingOrientation: WeaponOrientation | null = null;
```

…and every read/write of these throughout the file. They're replaced by `selectedVariantIdx` + the variant array's mutability.

- [ ] **Step 2: Replace `updateEditStrip` to bind to the selected variant** of the current cell:

```ts
function getSelectedVariant(): WeaponOrientation | null {
  const list = currentVariants();
  if (list.length === 0) return null;
  if (selectedVariantIdx >= list.length) selectedVariantIdx = 0;
  return list[selectedVariantIdx] ?? null;
}

function updateEditStrip(): void {
  const v = getSelectedVariant();
  if (statX) statX.textContent = v ? String(v.x) : '—';
  if (statY) statY.textContent = v ? String(v.y) : '—';
  if (statRot) statRot.textContent = v ? String(v.rot) : '—';
  if (statFlipX) statFlipX.textContent = v ? (v.flipX ? 'true' : 'false') : '—';

  if (editThumbCtx) {
    editThumbCtx.clearRect(0, 0, editThumbCtx.canvas.width, editThumbCtx.canvas.height);
    if (v && currentKitId) {
      const kit = kitsById.get(currentKitId);
      const layerPrefix = kit?.weapon?.layerPrefix;
      if (layerPrefix) {
        const componentId = `${layerPrefix}-${facingToSuffix(v.src)}`;
        const componentEntry = componentsById.get(componentId);
        if (componentEntry) {
          const weaponUrl = `${COMPONENT_BASE_URL}${componentEntry.path}`;
          void paintWeaponInto(editThumbCtx, weaponUrl, v, { applyOffset: true })
            .catch((err) => console.warn('[edit-thumb]', err));
        }
      }
    }
  }
}
```

- [ ] **Step 3: Update `renderCenterCell` to draw the selected variant** (no more target-cell concept):

Replace the orientation-decision block in `renderCenterCell` from Task A1 with simply:

```ts
const variants = currentKitId
  ? kitsById.get(currentKitId)?.poses?.[currentPose]?.[facing]
  : null;
const orientation = (variants && !Array.isArray(variants))
  ? (variants as { weapons?: WeaponOrientation[] }).weapons?.[
      facing === currentFacing ? selectedVariantIdx : 0
    ]
  : undefined;
```

So the active facing's cell shows the selected variant; other cells show their own `weapons[0]`.

- [ ] **Step 4: Update Mirror, Rotate, and arrow-key handlers** to mutate the selected variant in place:

```ts
btnMirror?.addEventListener('click', () => {
  const v = getSelectedVariant();
  if (!v) return;
  if (v.flipX) delete v.flipX;
  else v.flipX = true;
  updateEditStrip();
  refreshVariantsStrip();
  void renderPreview();
});

btnRotate?.addEventListener('click', () => {
  const v = getSelectedVariant();
  if (!v) return;
  v.rot = (v.rot + 90) % 360;
  updateEditStrip();
  refreshVariantsStrip();
  void renderPreview();
});

document.addEventListener('keydown', (ev) => {
  const v = getSelectedVariant();
  if (!v) return;
  const target = ev.target as Element | null;
  if (target) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  }
  const step = ev.shiftKey ? 8 : 1;
  let handled = false;
  switch (ev.key) {
    case 'ArrowLeft':  v.x -= step; handled = true; break;
    case 'ArrowRight': v.x += step; handled = true; break;
    case 'ArrowUp':    v.y -= step; handled = true; break;
    case 'ArrowDown':  v.y += step; handled = true; break;
  }
  if (handled) {
    ev.preventDefault();
    updateEditStrip();
    refreshVariantsStrip();
    void renderPreview();
  }
});
```

- [ ] **Step 5: Replace source-grid clicks** — clicking a source-grid cell now changes `src` (and resets `transform`) on the selected variant in place:

```ts
for (const { facing, cell } of sourceGridCells) {
  cell.addEventListener('click', () => {
    if (cell.classList.contains('disabled')) return;
    const v = getSelectedVariant();
    if (!v) {
      showToast('Select a variant first', 'info');
      return;
    }
    v.src = facing as any;
    delete v.transform;
    updateEditStrip();
    updateSourceGridHighlight();
    refreshVariantsStrip();
    void renderPreview();
  });
}
```

And update `updateSourceGridHighlight` to read from the selected variant:

```ts
function updateSourceGridHighlight(): void {
  const v = getSelectedVariant();
  for (const { facing, cell } of sourceGridCells) {
    cell.classList.toggle('active', !!v && v.src === facing);
  }
}
```

- [ ] **Step 6: Remove the Save-Variant button handler** (the button no longer exists in HTML). Wire up the new Delete button:

```ts
const btnDeleteVariant = document.getElementById('btn-delete-variant') as HTMLButtonElement | null;
btnDeleteVariant?.addEventListener('click', () => {
  if (!currentKitId) return;
  const kit = kitsById.get(currentKitId)!;
  const entry = kit.poses?.[currentPose]?.[currentFacing];
  if (!entry || Array.isArray(entry)) return;
  const list = (entry as { weapons?: WeaponOrientation[] }).weapons;
  if (!list || list.length === 0) return;
  list.splice(selectedVariantIdx, 1);
  if (selectedVariantIdx >= list.length) selectedVariantIdx = Math.max(0, list.length - 1);
  refreshVariantsStrip();
  updateEditStrip();
  updateSourceGridHighlight();
  void renderPreview();
});
```

- [ ] **Step 7: Update facing-cell clicks** — clicking a facing cell sets `currentFacing` and resets `selectedVariantIdx` to 0:

```ts
for (const { facing, cell } of gridCells) {
  cell.addEventListener('click', () => {
    setFacing(facing);
    selectedVariantIdx = 0;
    if (currentKitId) {
      applyKitDefaults(currentKitId, currentFacing);
    }
    rebuildComponentGroups();
    refreshVariantsStrip();
    updateEditStrip();
    updateSourceGridHighlight();
    void renderPreview();
  });
}
```

- [ ] **Step 8: Reload and verify**:
  - Variants strip lists one cell per `weapons[]` entry.
  - Clicking a variant cell selects it; the edit strip thumbnail and stats reflect it.
  - Mirror / Rotate / arrow keys mutate the selected variant in place; the main grid + variant strip + edit thumbnail all update live.
  - Clicking a different source facing cell changes the variant's `src` field (`transform` cleared) and the main cell re-renders.
  - `[+ new]` adds a variant, selects it, defaults to identity orientation.
  - `Delete` removes the current variant.
  - `Save Kit` writes to disk (existing behavior).
  - Switching facing/pose/kit resets selection to variant 0.

---

### Task A7: Remove unused legacy state + smoke-test Phase A

- [ ] **Step 1: Audit `component-preview.ts` for dead code.** Remove:
  - `targetCell` and any remaining references.
  - `workingOrientation` and any remaining references.
  - The old `renderCenterCellByFacing` function (no longer called; main-grid rerenders all cells via `renderPreview`).
  - The old `ensurePoseEntryWeapons` calls' double-purpose (kept — it's still used by `onAddVariant`).

- [ ] **Step 2: Run `npm run typecheck`** (or `npx tsc -p tsconfig.json --noEmit` if no script) to confirm no TS errors.

- [ ] **Step 3: Run `npm test -- --run` to confirm existing tests pass** (no runtime test regressions — we touched no runtime code).

- [ ] **Step 4: Manual smoke test in `/components.html`:**
  - Top: unit thumbnail renders + click opens picker + picker picks a kit.
  - Top: pose strip renders all kit poses + clicking each switches the main grid.
  - Middle: 3×3 grid renders, clicking a cell sets facing.
  - Bottom: variants strip lists weapons; click switches selection; [+] adds; Delete removes.
  - Edit strip: Mirror/Rotate/arrow-keys edit the selected variant; source-grid click changes `src`.
  - Save Kit writes the kit JSON; reload picks up the change.
  - Advanced drawer expands and all old controls (regiment, skeleton, layer checkboxes, facing dropdown, Reset) still work.

**Phase A done.** Stop and ask the user to commit before proceeding to Phase B.

---

## Phase B — Paint mode + live overlay

### Task B1: Live pixel-edits overlay (no paint UI yet)

The existing `pixel-edits.json` flows through the build pipeline only; the editor has been blind to it. Render it on top of layers at draw time so the editor preview matches the build output. Subsequent paint clicks mutate this same in-memory tree.

**Files:**
- Create: `src/dev/pixel-edits-overlay.ts`
- Create: `src/dev/pixel-edits-overlay.test.ts`
- Modify: `src/dev/cell-render.ts` (apply overlay per layer)
- Modify: `src/dev/component-preview.ts` (load overlay, pass to render)

- [ ] **Step 1: Create `src/dev/pixel-edits-overlay.ts`:**

```ts
/**
 * In-memory mirror of `public/components/pixel-edits.json`. Keyed
 * `[kit][pose][facing][componentId]` → array of `{ x, y, color }` (color is a
 * hex string or the literal `"clear"` for transparent).
 */
export type PixelEdit = { x: number; y: number; color: string };
export type PixelEditsTree = Record<
  string,
  Record<string, Record<string, Record<string, PixelEdit[]>>>
>;

const PIXEL_EDITS_URL = '/components/pixel-edits.json';
const SAVE_URL = '/api/pixel-edits';

export async function loadPixelEdits(): Promise<PixelEditsTree> {
  try {
    const res = await fetch(PIXEL_EDITS_URL);
    if (!res.ok) return {};
    return (await res.json()) as PixelEditsTree;
  } catch {
    return {};
  }
}

export function lookupEdits(
  tree: PixelEditsTree,
  kit: string,
  pose: string,
  facing: string,
  componentId: string,
): readonly PixelEdit[] {
  return tree[kit]?.[pose]?.[facing]?.[componentId] ?? [];
}

/**
 * Apply edits onto an in-context 2D canvas at native pixel coords. Brush
 * pixels write `color`; `"clear"` writes a transparent pixel via clearRect(1,1).
 */
export function applyEditsToContext(
  ctx: CanvasRenderingContext2D,
  edits: readonly PixelEdit[],
): void {
  for (const e of edits) {
    if (e.color === 'clear') {
      ctx.clearRect(e.x, e.y, 1, 1);
    } else {
      ctx.fillStyle = e.color;
      ctx.fillRect(e.x, e.y, 1, 1);
    }
  }
}

/**
 * Mutate the tree to set a single pixel. Replaces any prior entry at the
 * same `(x, y)` for the same `(kit, pose, facing, componentId)`. Returns the
 * updated tree (same object).
 */
export function setPixel(
  tree: PixelEditsTree,
  kit: string,
  pose: string,
  facing: string,
  componentId: string,
  edit: PixelEdit,
): PixelEditsTree {
  const path = ((((tree[kit] ??= {})[pose] ??= {})[facing] ??= {})[componentId] ??= []);
  // Remove any prior entry at the same (x, y).
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i]!.x === edit.x && path[i]!.y === edit.y) path.splice(i, 1);
  }
  path.push(edit);
  return tree;
}

export async function savePixelEdits(tree: PixelEditsTree): Promise<void> {
  const res = await fetch(SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tree, null, 2),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) detail = data.error;
    } catch {
      // ignore
    }
    throw new Error(`pixel-edits save failed (${res.status}): ${detail}`);
  }
}
```

- [ ] **Step 2: Create `src/dev/pixel-edits-overlay.test.ts`** — small unit tests for the pure helpers:

```ts
import { describe, it, expect } from 'vitest';
import { lookupEdits, setPixel, type PixelEditsTree } from './pixel-edits-overlay';

describe('pixel-edits-overlay', () => {
  it('lookupEdits returns [] for missing path', () => {
    const tree: PixelEditsTree = {};
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toEqual([]);
  });

  it('lookupEdits returns the entry array when present', () => {
    const tree: PixelEditsTree = { k: { p: { S: { c: [{ x: 1, y: 2, color: '#fff' }] } } } };
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toEqual([{ x: 1, y: 2, color: '#fff' }]);
  });

  it('setPixel creates the path and appends', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 1, y: 2, color: '#abc' });
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toEqual([{ x: 1, y: 2, color: '#abc' }]);
  });

  it('setPixel replaces an existing pixel at the same (x, y)', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 1, y: 2, color: '#aaa' });
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 1, y: 2, color: '#bbb' });
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toEqual([{ x: 1, y: 2, color: '#bbb' }]);
  });

  it('setPixel preserves other entries', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 1, y: 2, color: '#aaa' });
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 3, y: 4, color: '#bbb' });
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run `npx vitest run src/dev/pixel-edits-overlay.test.ts`. Expected: all 5 pass.**

- [ ] **Step 4: Modify `src/dev/cell-render.ts`** to accept a per-layer edits lookup and apply edits after each layer's draw:

Add to `CellRenderInput`:

```ts
import { applyEditsToContext, type PixelEdit } from './pixel-edits-overlay';

export interface CellRenderInput {
  // ...existing fields...
  /**
   * Optional per-layer edits lookup. Called once per layer with the layer's
   * componentId; should return the edits to apply post-draw (or `[]` if none).
   * Edits are applied at native canvas pixel coordinates immediately after
   * the layer's PNG is drawn, mirroring the build's `applyEdits` step.
   */
  layerEdits?: (componentId: string) => readonly PixelEdit[];
}
```

In `renderCellInto`, after each `target.drawImage(image, 0, 0)` (both the recolored and raw branches), apply edits:

```ts
const layerEdits = input.layerEdits?.(id) ?? [];
if (layerEdits.length > 0) {
  applyEditsToContext(target, layerEdits);
}
```

- [ ] **Step 5: Modify `src/dev/component-preview.ts`** to load the tree, hold it, and pass it through:

```ts
import { loadPixelEdits, lookupEdits, type PixelEditsTree } from './pixel-edits-overlay';

let pixelEdits: PixelEditsTree = {};
```

In `main()`, after `loadKits()`:

```ts
pixelEdits = await loadPixelEdits();
```

Pass `layerEdits` into every `renderCellInto` call (in the refactored `renderCenterCell`, in the unit picker, pose strip, and variants strip). The `getRegiment` pattern lets us keep the closure simple — add a `getLayerEdits` callback. Update the option types in `unit-picker.ts`, `pose-strip.ts`, and `variants-strip.ts` to take `getLayerEdits: (componentId: string) => readonly PixelEdit[]` and forward it to `renderCellInto`.

In `component-preview.ts`, supply this everywhere:

```ts
const getLayerEdits = (componentId: string) =>
  currentKitId
    ? lookupEdits(pixelEdits, currentKitId, currentPose, currentFacing, componentId)
    : [];
```

For the strip / picker thumbnails (which render specific known facings, not always the active one), pass a closure that captures the per-thumb facing/pose context. Concrete patch in `unit-picker.ts`'s `renderCellInto` call — add `layerEdits` reading at S facing of `idle`:

```ts
layerEdits: (componentId) => opts.getLayerEdits(kit.id, 'idle', 'S', componentId),
```

The picker / strip option signatures become:

```ts
getLayerEdits: (kitId: string, pose: string, facing: string, componentId: string) => readonly PixelEdit[];
```

In `component-preview.ts`:

```ts
const getLayerEditsAt = (kitId: string, pose: string, facing: string, componentId: string) =>
  lookupEdits(pixelEdits, kitId, pose, facing, componentId);
```

…and pass this to all three strips. For `renderCenterCell`'s call to `renderCellInto`, supply a per-cell facing closure (because each of the 8 cells uses its own facing):

```ts
await renderCellInto(cellCtx, {
  layerIds,
  components: componentsById,
  componentBaseUrl: COMPONENT_BASE_URL,
  regiment: currentRegiment,
  weapon: layerPrefix && orientation ? { layerPrefix, orientation } : undefined,
  layerEdits: (componentId) =>
    currentKitId
      ? lookupEdits(pixelEdits, currentKitId, currentPose, facing, componentId)
      : [],
});
```

- [ ] **Step 6: Reload and verify** — load a kit that has existing entries in `pixel-edits.json` (e.g., `british-line-infantry` from the file we sampled earlier). The existing edits should now be visible in the editor preview at the correct facings.

---

### Task B2: Paint tool module + toolbar UI

**Files:**
- Create: `src/dev/paint-tool.ts`
- Create: `src/dev/paint-tool.test.ts`
- Modify: `components.html` (add the paint toolbar)
- Modify: `src/dev/component-preview.ts` (mount, wire click handler)

- [ ] **Step 1: Add the paint toolbar HTML** to `components.html`. Insert inside the `weapon-edit-pane` div (just below `#weapon-source-panel`'s closing tag, before `</div>`):

```html
<div id="paint-toolbar" hidden>
  <h2>Paint</h2>
  <div class="paint-mode-row">
    <label><input type="radio" name="paint-mode" value="brush" checked> Brush</label>
    <label><input type="radio" name="paint-mode" value="erase"> Erase</label>
  </div>
  <label class="paint-color-row">
    Color
    <input type="color" id="paint-color-input" value="#ff0000">
  </label>
  <label class="paint-layer-row">
    Layer
    <select id="paint-layer-select"></select>
  </label>
  <button id="btn-save-edits" class="primary" type="button">Save Edits</button>
</div>
```

Also add a paint-mode toggle button in `#weapon-edit-strip .button-row` (alongside Mirror / Rotate / Save Kit / Delete):

```html
<button id="btn-paint-toggle" type="button">🖌 Paint</button>
```

And styles:

```css
#paint-toolbar {
  margin-top: 12px;
  padding: 12px;
  background: rgba(21, 24, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12px;
}
#paint-toolbar[hidden] { display: none; }
#paint-toolbar h2 {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9ca3af;
}
#paint-toolbar .paint-mode-row { display: flex; gap: 12px; }
#paint-toolbar label { display: flex; align-items: center; gap: 6px; }
#paint-toolbar select, #paint-toolbar input[type="color"] {
  background: rgba(12, 15, 20, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: inherit;
  padding: 4px;
  border-radius: 4px;
}
#paint-toolbar button {
  padding: 6px 8px;
  background: rgba(34, 197, 94, 0.32);
  border: 1px solid rgba(74, 222, 128, 0.7);
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
#paint-toolbar button:hover { background: rgba(34, 197, 94, 0.45); }

.facing-cell.paint-mode { cursor: crosshair; }
```

- [ ] **Step 2: Create `src/dev/paint-tool.ts`:**

```ts
import { setPixel, savePixelEdits, type PixelEditsTree } from './pixel-edits-overlay';

export interface PaintToolState {
  enabled: boolean;
  mode: 'brush' | 'erase';
  color: string;
  /** Layer id to paint into. */
  activeLayer: string | null;
}

export interface PaintToolOptions {
  getTree: () => PixelEditsTree;
  /** Called after every successful pixel write. */
  onChange: () => void;
  showToast: (msg: string, kind?: 'success' | 'error' | 'info') => void;
}

/**
 * Mounts the paint toolbar UI elements and returns a state handle plus a
 * `paintAt` function the caller wires to canvas clicks.
 */
export function mountPaintTool(opts: PaintToolOptions): {
  state: PaintToolState;
  setActiveLayers(layerIds: string[]): void;
  isEnabled(): boolean;
  /** Paint one pixel at the given canvas coords for (kit, pose, facing). */
  paintAt(kit: string, pose: string, facing: string, x: number, y: number): void;
} {
  const toolbar = document.getElementById('paint-toolbar') as HTMLDivElement;
  const toggleBtn = document.getElementById('btn-paint-toggle') as HTMLButtonElement;
  const colorInput = document.getElementById('paint-color-input') as HTMLInputElement;
  const layerSelect = document.getElementById('paint-layer-select') as HTMLSelectElement;
  const saveBtn = document.getElementById('btn-save-edits') as HTMLButtonElement;
  const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="paint-mode"]');

  const state: PaintToolState = {
    enabled: false,
    mode: 'brush',
    color: colorInput.value,
    activeLayer: null,
  };

  function syncToolbarVisibility(): void {
    toolbar.hidden = !state.enabled;
    toggleBtn.classList.toggle('primary', state.enabled);
    document.querySelectorAll('.facing-cell').forEach((el) => {
      el.classList.toggle('paint-mode', state.enabled);
    });
  }

  toggleBtn.addEventListener('click', () => {
    state.enabled = !state.enabled;
    syncToolbarVisibility();
  });
  colorInput.addEventListener('input', () => { state.color = colorInput.value; });
  layerSelect.addEventListener('change', () => { state.activeLayer = layerSelect.value || null; });
  for (const r of modeRadios) {
    r.addEventListener('change', () => {
      if (r.checked) state.mode = r.value as 'brush' | 'erase';
    });
  }
  saveBtn.addEventListener('click', () => {
    savePixelEdits(opts.getTree())
      .then(() => opts.showToast('Pixel edits saved', 'success'))
      .catch((err: Error) => opts.showToast(err.message, 'error'));
  });

  syncToolbarVisibility();

  return {
    state,
    setActiveLayers(layerIds) {
      // Repopulate the dropdown; preserve selection if the prior id is still present.
      const prior = state.activeLayer;
      layerSelect.innerHTML = '';
      for (const id of layerIds) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        layerSelect.appendChild(opt);
      }
      if (prior && layerIds.includes(prior)) {
        layerSelect.value = prior;
      } else {
        state.activeLayer = layerIds[0] ?? null;
        if (state.activeLayer) layerSelect.value = state.activeLayer;
      }
    },
    isEnabled() { return state.enabled; },
    paintAt(kit, pose, facing, x, y) {
      if (!state.enabled || !state.activeLayer) return;
      const color = state.mode === 'erase' ? 'clear' : state.color;
      setPixel(opts.getTree(), kit, pose, facing, state.activeLayer, { x, y, color });
      opts.onChange();
    },
  };
}
```

- [ ] **Step 3: Create `src/dev/paint-tool.test.ts`** — only a tiny smoke test, since most of the module is DOM glue. Test the pure logic via a stub `getTree`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setPixel, type PixelEditsTree } from './pixel-edits-overlay';

describe('paint pipeline', () => {
  // The glue (mountPaintTool) is DOM-coupled; we cover the pure write here.
  it('a brush click writes a colored pixel into the tree', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'kit', 'idle', 'S', 'rider-torso-south', { x: 5, y: 7, color: '#abc' });
    expect(tree.kit?.idle?.S?.['rider-torso-south']).toEqual([{ x: 5, y: 7, color: '#abc' }]);
  });

  it('an erase click writes a "clear" marker', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'kit', 'idle', 'S', 'rider-torso-south', { x: 5, y: 7, color: 'clear' });
    expect(tree.kit?.idle?.S?.['rider-torso-south']).toEqual([{ x: 5, y: 7, color: 'clear' }]);
  });
});
```

- [ ] **Step 4: Run `npx vitest run src/dev/paint-tool.test.ts`. Expected: 2 pass.**

- [ ] **Step 5: Wire `mountPaintTool` into `component-preview.ts`:**

```ts
import { mountPaintTool } from './paint-tool';

const paintTool = mountPaintTool({
  getTree: () => pixelEdits,
  onChange: () => void renderPreview(),
  showToast,
});

// Update active-layer dropdown whenever the displayed cell changes.
function refreshPaintLayers(): void {
  const layerIds = layersForFacing(currentFacing).map((e) => e.id);
  paintTool.setActiveLayers(layerIds);
}
```

Call `refreshPaintLayers()` everywhere we already call `refreshVariantsStrip()`.

- [ ] **Step 6: Wire facing-cell clicks to paint** when paint mode is active. In the existing facing-cell click handler, branch on paint mode:

```ts
for (const { facing, cell } of gridCells) {
  cell.addEventListener('click', (ev) => {
    if (paintTool.isEnabled() && facing === currentFacing) {
      // Compute the pixel under the cursor.
      const rect = cell.getBoundingClientRect();
      const cssX = ev.clientX - rect.left;
      const cssY = ev.clientY - rect.top;
      // Cell is 96x108 CSS px scaled from 32x36 native.
      const x = Math.floor((cssX / rect.width) * 32);
      const y = Math.floor((cssY / rect.height) * 36);
      if (currentKitId) {
        paintTool.paintAt(currentKitId, currentPose, currentFacing, x, y);
      }
      return;
    }
    // ...existing facing-select behavior...
  });
}
```

(Reads the cell canvas's native dimensions inline — avoid coupling to a constant. Since the grid uses 32×36, hard-coding is acceptable; the canvas attributes already reflect this.)

- [ ] **Step 7: Reload and verify**:
  - Click `🖌 Paint` — toolbar appears, button highlights, the active center cell's cursor changes to crosshair.
  - Pick a layer in the dropdown.
  - Click a pixel on the active cell — that pixel paints in the chosen color, immediately visible.
  - Switch mode to Erase, click — the pixel clears.
  - Click `Save Edits` — toast confirms `Pixel edits saved`. Refresh the page; edits persist.
  - Toggle paint mode off — clicks revert to facing-select behavior.

---

### Task B3: Phase B smoke test

- [ ] **Step 1: Run `npm test -- --run`. Expected: all tests green** (the new pixel-edits-overlay + paint-tool tests + everything previously passing).

- [ ] **Step 2: Run `npm run typecheck`** (or `npx tsc -p tsconfig.json --noEmit`). Expected: no errors.

- [ ] **Step 3: Manual end-to-end**:
  - Load `/components.html`, pick `british-line-infantry`, pick `idle` pose, pick `S` facing.
  - Existing `pixel-edits.json` content is visible in the preview.
  - Toggle paint, pick the body layer, paint a few pixels, save.
  - Reload, paint a few more, save.
  - Inspect `public/components/pixel-edits.json` — new entries appear under `[british-line-infantry][idle][S][<layer>]`.
  - Run `npm run build:components` (or whatever the build script is) and confirm the resulting component PNG includes the painted pixels.

- [ ] **Step 4: Final visual pass** — compare against the spec layout diagram. Adjust spacing, font sizes, or colors as needed for legibility.

**Phase B done.** Ask the user to commit.

---

## Self-review notes

- **Spec coverage:**
  - Editor layout (top + middle + bottom + Advanced) → A2.
  - Unit picker → A3.
  - Pose strip → A4.
  - Variants strip + add/delete → A5, A6.
  - Direct-binding edit strip → A6.
  - Live `pixel-edits.json` overlay → B1.
  - Paint mode + toolbar + active layer + save → B2.
  - "Variants are pose + weapon, no other variation" → preserved by NOT renaming + NOT extending `WeaponOrientation`.
  - "Paint just fixes layer PNGs" → uses existing `pixel-edits.json`, not a new variant-paint store.
- **No placeholders** — every step contains the file path, the code, or the command to run.
- **Type consistency** — `WeaponOrientation` is imported from `./weapon-rendering` throughout; `PixelEditsTree` / `PixelEdit` from `./pixel-edits-overlay`; `ComponentEntry` from `./cell-render`.
- **Risk noted in spec**: the click-to-paint coordinate math (CSS px → native px) hard-codes 32×36 to match the existing canvas attributes. If a future kit needs a different cell size, the math needs to read `cell.querySelector('canvas').width/height` instead.
