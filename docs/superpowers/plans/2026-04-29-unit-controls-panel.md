# Unified Unit Controls Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `formation-controls-panel`, `cannon-ammo-panel`, and the selection-summary line of `selection-panel` with a single `unit-controls-panel` that consistently shows hotkeys and unit-specific controls for any selection (infantry, cannons, cavalry, or mixed).

**Architecture:** New `src/ui/unit-controls-panel.ts` mounted by all three scenario entry points (`src/main.ts`, `src/skirmish/main.ts`, `src/cannon-test/main.ts`). The panel renders a header (selection summary), zero-or-more unit-specific strips (stance for infantry, ammo for cannons; cavalry contributes none), a formation row, and a universal-keyboard-hotkeys block. The `StanceSummary`/`computeStanceSummary` helper is lifted from `skirmish/main.ts` to a shared `src/input/stance-summary.ts`. Same dirty-write caching pattern as existing panels — only touch the DOM when relevant inputs change.

**Tech Stack:** TypeScript, Vite, Vitest (test runner — `npm test`), plain DOM (no framework), CSS in `src/ui/styles.css`.

**Spec:** `docs/superpowers/specs/2026-04-29-unit-controls-panel-design.md`

---

## File Plan

**New files:**
- `src/input/stance-summary.ts` — shared `StanceSummary` type + `computeStanceSummary` helper.
- `src/ui/unit-controls-panel.ts` — the unified panel.
- `src/ui/unit-controls-panel.test.ts` — focused unit tests.

**Modified files:**
- `src/ui/styles.css` — add `.unit-controls` block; remove `.formation-controls` and `.cannon-ammo-panel` blocks.
- `src/ui/selection-panel.ts` — strip out the summary text, leave the single-unit identity card.
- `src/main.ts` — swap two panel imports/instantiations/updates for the unified panel.
- `src/skirmish/main.ts` — same swap; gains the artillery section automatically.
- `src/cannon-test/main.ts` — same swap.

**Deleted files:**
- `src/ui/formation-controls-panel.ts`
- `src/ui/cannon-ammo-panel.ts`

---

## Task 1: Lift `StanceSummary` to a shared module

**Files:**
- Create: `src/input/stance-summary.ts`
- Modify: `src/skirmish/main.ts` (remove inline definition, import from new module)
- Modify: `src/main.ts` (remove inline definition, import from new module)

The same helper is duplicated in `src/main.ts:372` and `src/skirmish/main.ts:284`. Extract once before adding a third caller (the new panel needs it too).

- [ ] **Step 1: Create the shared module.**

Create `src/input/stance-summary.ts`:

```ts
import type { Selection } from './selection';
import type { Entities } from '../sim/entities';
import { getUnitKindByIndex } from '../data/units';

export type StanceSummary =
  | { kind: 'uniform'; stance: number }
  | { kind: 'mixed' }
  | { kind: 'none' };

/**
 * Returns the active fire-stance across the alive infantry/cavalry units in
 * the selection. Cannons are skipped — their Z/X/C keys drive ammo, not
 * stance, so they should not contribute to the stance reading shown to the
 * player. Returns `none` when the selection contains no stance-bearing units.
 */
export function computeStanceSummary(sel: Selection, e: Entities): StanceSummary {
  if (sel.ids.size === 0) return { kind: 'none' };
  let first: number | undefined;
  for (const id of sel.ids) {
    if (e.alive[id] !== 1) continue;
    const cat = getUnitKindByIndex(e.kindId[id]!).category;
    if (cat === 'artillery') continue;
    if (first === undefined) { first = e.stance[id]!; continue; }
    if (e.stance[id]! !== first) return { kind: 'mixed' };
  }
  if (first === undefined) return { kind: 'none' };
  return { kind: 'uniform', stance: first };
}
```

Note the change vs. the existing inline copies: the new helper **excludes artillery** when reading stance. The current copies include artillery (whose `stance` field is whatever default `allocEntity` set). With the unified panel showing stance only for infantry/cavalry, this matches the visual.

- [ ] **Step 2: Replace inline definition in `src/skirmish/main.ts`.**

Remove the `function computeStanceSummary(...)` definition (currently around lines 284–294) and the `type StanceSummary` import from `formation-controls-panel`. Replace the import block:

```ts
import { createFormationControlsPanel, type StanceSummary } from '../ui/formation-controls-panel';
```

with:

```ts
import { createFormationControlsPanel } from '../ui/formation-controls-panel';
import { computeStanceSummary } from '../input/stance-summary';
```

(The `formation-controls-panel` import line will be deleted entirely in Task 5; for now we just remove `StanceSummary` from it.)

Delete the local `computeStanceSummary` function body. The call site at `fcPanel.update(selection, controller.formationParams, computeStanceSummary(selection, world.entities));` keeps working — it now resolves to the shared helper.

- [ ] **Step 3: Replace inline definition in `src/main.ts`.**

Same change. Remove the local `function computeStanceSummary(...)` (around lines 372–382). Adjust imports:

```ts
import { createFormationControlsPanel, type StanceSummary } from './ui/formation-controls-panel';
```

becomes:

```ts
import { createFormationControlsPanel } from './ui/formation-controls-panel';
import { computeStanceSummary } from './input/stance-summary';
```

Also drop the now-unused `type Entities` import from `./sim/entities` if nothing else in the file references it (check first — `allocEntity` and `EntityState` likely still need `Entities`; if so leave the import alone).

- [ ] **Step 4: Run typecheck + tests.**

Run: `npm run build`
Expected: PASS (just `tsc --noEmit` plus the vite build succeeding).

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/input/stance-summary.ts src/skirmish/main.ts src/main.ts
git commit -m "refactor: lift computeStanceSummary to shared module"
```

---

## Task 2: Create the unified panel module

**Files:**
- Create: `src/ui/unit-controls-panel.ts`

This is the bulk of the work. The panel handles all sections in one place; each section is a private builder that returns a `{ root, update(...) }` shape so the outer panel orchestrates updates without leaking DOM details.

- [ ] **Step 1: Write the panel module.**

Create `src/ui/unit-controls-panel.ts`:

```ts
import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Selection } from '../input/selection';
import { getUnitKindByIndex } from '../data/units';
import type { FormationParams } from '../input/formation-params';
import { SPACING_STEPS } from '../input/formation-params';
import type { StanceSummary } from '../input/stance-summary';
import { FireStance } from '../sim/entities';

export interface UnitControlsPanel {
  update(
    world: World,
    sel: Selection,
    params: FormationParams,
    stance: StanceSummary,
    runMode: boolean,
  ): void;
}

// === Pixel-art glyphs (16×16, [x, y, color]). ============================
type Pixel = [x: number, y: number, color: string];

// Cannonball — 12-pdr solid shot. (Moved verbatim from cannon-ammo-panel.ts.)
const SOLID_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  for (let y = 3; y <= 13; y++) {
    for (let x = 3; x <= 13; x++) {
      const dx = x - 8 + 0.5;
      const dy = y - 8 + 0.5;
      const d = Math.hypot(dx, dy);
      if (d > 5.5) continue;
      const lit = (dx + dy) < -2;
      out.push([x, y, lit ? '#3a3a3a' : '#0a0a0a']);
    }
  }
  out.push([6, 5, '#9a9a9a']);
  return out;
})();

// Shell — cannonball with a sparking fuse. (Moved verbatim.)
const SHELL_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  for (let y = 5; y <= 14; y++) {
    for (let x = 3; x <= 13; x++) {
      const dx = x - 8 + 0.5;
      const dy = y - 9 + 0.5;
      const d = Math.hypot(dx, dy);
      if (d > 5) continue;
      const lit = (dx + dy) < -2;
      out.push([x, y, lit ? '#3a3a3a' : '#0a0a0a']);
    }
  }
  out.push([6, 6, '#9a9a9a']);
  out.push([8, 4, '#4a3a20']);
  out.push([8, 3, '#7a5a30']);
  out.push([7, 2, '#ff8a30']);
  out.push([9, 2, '#ffd070']);
  out.push([8, 1, '#ffe080']);
  return out;
})();

// Canister — brass cylinder showing musket-ball shot. (Moved verbatim.)
const CANISTER_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  const x0 = 5, x1 = 11;
  for (let y = 3; y <= 13; y++) {
    for (let x = x0; x <= x1; x++) {
      let color = '#a07a30';
      if (x === x0) color = '#7a5a20';
      else if (x === x1) color = '#c89540';
      if (y === 4) color = '#5a4018';
      if (y === 13) color = '#5a4018';
      out.push([x, y, color]);
    }
  }
  for (let x = x0; x <= x1; x++) out.push([x, 3, '#3a2a10']);
  out.push([6, 6, '#1a1a1a']);
  out.push([8, 6, '#1a1a1a']);
  out.push([10, 6, '#1a1a1a']);
  out.push([7, 8, '#1a1a1a']);
  out.push([9, 8, '#1a1a1a']);
  out.push([8, 10, '#1a1a1a']);
  return out;
})();

const AMMO_PIXELS: Pixel[][] = [SOLID_PIXELS, SHELL_PIXELS, CANISTER_PIXELS];
const AMMO_LABELS = ['Solid', 'Shell', 'Canister'];
const AMMO_KEYS = ['Z', 'X', 'C'];

// --- Stance glyphs --------------------------------------------------------
// Bold symbolic motifs. These are NEW glyphs (no prior asset); the goal is
// readability at 32×32 display, not historical accuracy.

// Single muzzle puff — a yellow burst centered.
const FAW_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  for (let y = 5; y <= 10; y++) for (let x = 5; x <= 10; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const d = Math.hypot(dx, dy);
    if (d > 2.8) continue;
    out.push([x, y, d > 1.6 ? '#c86010' : d > 0.6 ? '#ffb830' : '#fff0a0']);
  }
  return out;
})();

// Three aligned puffs in a row — synchronized volley.
const VOLLEY_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  const centers = [3.5, 7.5, 11.5];
  for (const cx of centers) {
    for (let y = 5; y <= 10; y++) for (let x = Math.floor(cx) - 2; x <= Math.ceil(cx) + 2; x++) {
      if (x < 0 || x > 15) continue;
      const dx = x - cx, dy = y - 7.5;
      const d = Math.hypot(dx, dy);
      if (d > 1.8) continue;
      out.push([x, y, d > 1 ? '#c86010' : '#ffb830']);
    }
  }
  return out;
})();

// Two ranks: front-row puffing yellow, back-row dim grey (waiting).
const BY_RANKS_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  const centers = [3.5, 7.5, 11.5];
  // Back rank — dim, y≈3.5
  for (const cx of centers) {
    for (let y = 2; y <= 5; y++) for (let x = Math.floor(cx) - 1; x <= Math.ceil(cx) + 1; x++) {
      if (x < 0 || x > 15) continue;
      const dx = x - cx, dy = y - 3.5;
      const d = Math.hypot(dx, dy);
      if (d > 1.4) continue;
      out.push([x, y, '#5a5a5a']);
    }
  }
  // Front rank — bright, y≈11
  for (const cx of centers) {
    for (let y = 9; y <= 13; y++) for (let x = Math.floor(cx) - 2; x <= Math.ceil(cx) + 2; x++) {
      if (x < 0 || x > 15) continue;
      const dx = x - cx, dy = y - 11;
      const d = Math.hypot(dx, dy);
      if (d > 1.8) continue;
      out.push([x, y, d > 1 ? '#c86010' : '#ffb830']);
    }
  }
  return out;
})();

// Hold — a red horizontal bar (stop sign aesthetic) with white edges.
const HOLD_PIXELS: Pixel[] = (() => {
  const out: Pixel[] = [];
  for (let x = 2; x <= 13; x++) {
    out.push([x, 6, '#a01010']);
    out.push([x, 7, '#d02020']);
    out.push([x, 8, '#d02020']);
    out.push([x, 9, '#a01010']);
  }
  // White inner highlight stripe.
  for (let x = 4; x <= 11; x++) out.push([x, 7, '#ffe0e0']);
  return out;
})();

const STANCE_PIXELS: Pixel[][] = [FAW_PIXELS, VOLLEY_PIXELS, BY_RANKS_PIXELS, HOLD_PIXELS];
const STANCE_LABELS = ['Fire at Will', 'Volley', 'By Ranks', 'Hold'];
const STANCE_KEYS = ['Z', 'X', 'C', 'V'];

function pixelsToSvg(pixels: Pixel[]): string {
  const rects = pixels
    .map(([x, y, c]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`)
    .join('');
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

// === Slot-strip builder (used for stance and ammo) =======================

interface StripHandle {
  root: HTMLDivElement;
  /** -1 = mixed, otherwise active slot index. */
  setActive(active: number, mixed: boolean): void;
}

function buildSlotStrip(
  pixelsArr: Pixel[][],
  labels: string[],
  keys: string[],
  className: string,
): StripHandle {
  const root = document.createElement('div');
  root.className = `unit-strip ${className}`;
  const slots: HTMLDivElement[] = [];
  for (let i = 0; i < pixelsArr.length; i++) {
    const slot = document.createElement('div');
    slot.className = 'unit-slot';
    slot.innerHTML =
      `<div class="unit-slot-icon">${pixelsToSvg(pixelsArr[i]!)}</div>` +
      `<div class="unit-slot-name">${labels[i]}</div>` +
      `<div class="unit-slot-key">${keys[i]}</div>`;
    root.appendChild(slot);
    slots.push(slot);
  }
  const mixed = document.createElement('div');
  mixed.className = 'unit-slot-mixed';
  mixed.textContent = 'mixed';
  mixed.style.display = 'none';
  root.appendChild(mixed);

  let lastActive = -2;
  let lastMixed = false;
  return {
    root,
    setActive(active, isMixed) {
      if (active === lastActive && isMixed === lastMixed) return;
      lastActive = active; lastMixed = isMixed;
      for (let i = 0; i < slots.length; i++) {
        slots[i]!.classList.toggle('active', !isMixed && i === active);
      }
      mixed.style.display = isMixed ? '' : 'none';
    },
  };
}

// === Text-row builder (used for formation rows + universal hotkeys) ======

interface TextRow {
  root: HTMLDivElement;
  setVal(text: string): void;
}

function buildRow(keyText: string, label: string, hasVal: boolean): TextRow {
  const row = document.createElement('div');
  row.className = 'uc-row';
  const k = document.createElement('span'); k.className = 'uc-key'; k.textContent = keyText;
  const l = document.createElement('span'); l.className = 'uc-label'; l.textContent = label;
  row.append(k, l);
  let val: HTMLSpanElement | null = null;
  if (hasVal) {
    val = document.createElement('span'); val.className = 'uc-val';
    row.appendChild(val);
  }
  let lastVal = '';
  return {
    root: row,
    setVal(text) {
      if (!val) return;
      if (text === lastVal) return;
      val.textContent = text;
      lastVal = text;
    },
  };
}

// === Main factory ========================================================

export function createUnitControlsPanel(root: HTMLElement): UnitControlsPanel {
  const el = panel('unit-controls');
  el.style.display = 'none';
  root.appendChild(el);

  // Header — selection summary line.
  const summaryEl = document.createElement('div');
  summaryEl.className = 'uc-summary';
  el.appendChild(summaryEl);

  // Stance strip (infantry/cavalry).
  const stanceStrip = buildSlotStrip(STANCE_PIXELS, STANCE_LABELS, STANCE_KEYS, 'unit-strip-stance');
  stanceStrip.root.style.display = 'none';
  el.appendChild(stanceStrip.root);

  // Ammo strip (artillery).
  const ammoStrip = buildSlotStrip(AMMO_PIXELS, AMMO_LABELS, AMMO_KEYS, 'unit-strip-ammo');
  ammoStrip.root.style.display = 'none';
  el.appendChild(ammoStrip.root);

  // Formation block.
  const fmBlock = document.createElement('div');
  fmBlock.className = 'uc-block uc-block-formation';
  const spacingRow = buildRow('[ ]', 'Spacing', true);
  const ranksRow = buildRow(', .', 'Ranks', true);
  fmBlock.append(spacingRow.root, ranksRow.root);
  el.appendChild(fmBlock);

  // Universal-hotkeys block.
  const uniBlock = document.createElement('div');
  uniBlock.className = 'uc-block uc-block-universal';
  const rRow = buildRow('R', 'Attack-move', false);
  const fRow = buildRow('F', 'Hurry to slot', false);
  const tRow = buildRow('T', 'Walk / Run', true);
  const delRow = buildRow('Del', 'Stop', false);
  const escRow = buildRow('Esc', 'Deselect', false);
  uniBlock.append(rRow.root, fRow.root, tRow.root, delRow.root, escRow.root);
  el.appendChild(uniBlock);

  // Cannon-only universal rows (own block so they can hide as a unit).
  const cannonBlock = document.createElement('div');
  cannonBlock.className = 'uc-block uc-block-cannon';
  cannonBlock.style.display = 'none';
  const spaceRow = buildRow('Space', 'Fire', false);
  const arrowsLR = buildRow('← →', 'Rotate', false);
  const arrowsUD = buildRow('↑ ↓', 'Elevate', false);
  cannonBlock.append(spaceRow.root, arrowsLR.root, arrowsUD.root);
  el.appendChild(cannonBlock);

  // Caches.
  let lastSummary = '';
  let lastVisible = false;
  let lastSpacing = -1;
  let lastRanks: number | null | undefined = undefined;
  let lastRunMode: boolean | undefined = undefined;
  let lastHasInfantry: boolean | undefined = undefined;
  let lastHasArtillery: boolean | undefined = undefined;

  return {
    update(world, sel, params, stance, runMode) {
      if (sel.ids.size === 0) {
        if (lastVisible) { el.style.display = 'none'; lastVisible = false; }
        return;
      }
      if (!lastVisible) { el.style.display = ''; lastVisible = true; }

      // Summary + per-category presence + ammo state.
      const e = world.entities;
      const counts = new Map<string, number>();
      let hasInfantry = false;
      let hasArtillery = false;
      let ammoSeen = -1;
      let ammoMixed = false;
      for (const id of sel.ids) {
        if (e.alive[id] !== 1) continue;
        const kind = getUnitKindByIndex(e.kindId[id]!);
        counts.set(kind.name, (counts.get(kind.name) ?? 0) + 1);
        if (kind.category === 'infantry') hasInfantry = true;
        else if (kind.category === 'artillery') {
          hasArtillery = true;
          const a = e.cannonAmmo[id]!;
          if (ammoSeen === -1) ammoSeen = a;
          else if (ammoSeen !== a) ammoMixed = true;
        }
      }
      const summary: string[] = [];
      for (const [name, n] of counts) summary.push(`${name} × ${n}`);
      const summaryStr = summary.join('  ·  ');
      if (summaryStr !== lastSummary) {
        summaryEl.textContent = summaryStr;
        lastSummary = summaryStr;
      }

      // Stance strip visibility + state. Cavalry omitted per design (no
      // unit-specific section for cavalry today).
      if (hasInfantry !== lastHasInfantry) {
        stanceStrip.root.style.display = hasInfantry ? '' : 'none';
        lastHasInfantry = hasInfantry;
      }
      if (hasInfantry) {
        if (stance.kind === 'uniform') stanceStrip.setActive(stance.stance, false);
        else if (stance.kind === 'mixed') stanceStrip.setActive(-1, true);
        else stanceStrip.setActive(-1, false);
      }

      // Ammo strip visibility + state.
      if (hasArtillery !== lastHasArtillery) {
        ammoStrip.root.style.display = hasArtillery ? '' : 'none';
        cannonBlock.style.display = hasArtillery ? '' : 'none';
        lastHasArtillery = hasArtillery;
      }
      if (hasArtillery) {
        ammoStrip.setActive(ammoMixed ? -1 : ammoSeen, ammoMixed);
      }

      // Formation rows.
      if (params.spacingIndex !== lastSpacing) {
        const step = SPACING_STEPS[params.spacingIndex]!;
        spacingRow.setVal(`${step.mult.toFixed(2)}× ${step.label}`);
        lastSpacing = params.spacingIndex;
      }
      if (params.ranks !== lastRanks) {
        ranksRow.setVal(params.ranks == null ? 'auto' : String(params.ranks));
        lastRanks = params.ranks;
      }

      // Run/Walk row.
      if (runMode !== lastRunMode) {
        tRow.setVal(runMode ? 'Run' : 'Walk');
        lastRunMode = runMode;
      }

      // Reference FireStance to keep tree-shaking honest — the enum drives the
      // semantic ordering of STANCE_PIXELS even though we don't index by it.
      void FireStance;
    },
  };
}
```

- [ ] **Step 2: Verify it compiles.**

Run: `npm run build`
Expected: PASS. `tsc --noEmit` should be clean. Vite build OK (no scenarios mount it yet, but the module must typecheck).

- [ ] **Step 3: Commit.**

```bash
git add src/ui/unit-controls-panel.ts
git commit -m "feat: add unit-controls-panel module"
```

---

## Task 3: Add CSS for `.unit-controls`

**Files:**
- Modify: `src/ui/styles.css`

Add a single new block. Keep it close to the existing `.formation-controls` block in the file for proximity until Task 8 deletes the old blocks.

- [ ] **Step 1: Append the new CSS.**

Add to `src/ui/styles.css` (placement: directly after the existing `.formation-controls` block, around line 414):

```css
/* === Unit controls panel — replaces .formation-controls and .cannon-ammo-panel === */
#ui-root .unit-controls {
  position: absolute;
  bottom: 8px;
  left: 196px;
  padding: 6px 8px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 200px;
  font-size: 11px;
  line-height: 1.2;
  pointer-events: none;
}
#ui-root .unit-controls .uc-summary {
  font-size: 12px;
  color: #d8d8c8;
  font-weight: 500;
  white-space: nowrap;
}
#ui-root .unit-controls .unit-strip {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
#ui-root .unit-controls .unit-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 52px;
  padding: 4px 3px 3px;
  border: 1px solid rgba(120, 120, 140, 0.35);
  border-radius: 3px;
  background: rgba(20, 24, 28, 0.4);
  box-sizing: border-box;
  user-select: none;
}
#ui-root .unit-controls .unit-slot.active {
  border-color: #cfe070;
  background: rgba(80, 110, 40, 0.55);
  box-shadow: 0 0 0 1px #cfe070 inset;
}
#ui-root .unit-controls .unit-slot-icon {
  width: 28px;
  height: 28px;
  image-rendering: pixelated;
  margin-bottom: 3px;
}
#ui-root .unit-controls .unit-slot-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}
#ui-root .unit-controls .unit-slot-name {
  font-size: 9px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #d8d8c8;
  line-height: 1.1;
  margin-bottom: 2px;
  white-space: nowrap;
}
#ui-root .unit-controls .unit-slot.active .unit-slot-name {
  color: #f4f4d8;
}
#ui-root .unit-controls .unit-slot-key {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
  color: #aaa;
  line-height: 1;
  border: 1px solid rgba(180, 180, 190, 0.35);
  border-radius: 2px;
  padding: 1px 4px;
  background: rgba(0, 0, 0, 0.3);
}
#ui-root .unit-controls .unit-slot.active .unit-slot-key {
  color: #fff;
  border-color: #cfe070;
}
#ui-root .unit-controls .unit-slot-mixed {
  align-self: center;
  margin-left: 2px;
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #d8c060;
}
#ui-root .unit-controls .uc-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
#ui-root .unit-controls .uc-row {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  gap: 8px;
  align-items: baseline;
}
#ui-root .unit-controls .uc-key {
  color: var(--ui-accent);
  font-weight: bold;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
#ui-root .unit-controls .uc-label { color: #9ca3af; }
#ui-root .unit-controls .uc-val   { text-align: right; color: #d8d8c8; }
```

- [ ] **Step 2: Verify build still passes.**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/ui/styles.css
git commit -m "feat: add unit-controls-panel styles"
```

---

## Task 4: Strip selection-summary from `selection-panel.ts`

**Files:**
- Modify: `src/ui/selection-panel.ts`

The new panel owns the summary line. The single-unit identity card stays in `selection-panel.ts`.

- [ ] **Step 1: Rewrite `selection-panel.ts` to identity-only.**

Replace the file contents with:

```ts
import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Selection } from '../input/selection';
import { firstNameOf, lastNameOf, hometownOf } from '../data/name-bank';

export interface SelectionPanel {
  update(world: World, sel: Selection): void;
}

export function createSelectionPanel(root: HTMLElement): SelectionPanel {
  const el = panel('selection-panel');
  el.style.display = 'none';
  root.appendChild(el);

  const identityEl = document.createElement('div');
  identityEl.className = 'selection-identity';
  const idHeaderEl = document.createElement('div');
  idHeaderEl.className = 'selection-identity-header';
  const idHometownEl = document.createElement('div');
  idHometownEl.className = 'selection-identity-hometown';
  const idStatsEl = document.createElement('div');
  idStatsEl.className = 'selection-identity-stats';
  identityEl.append(idHeaderEl, idHometownEl, idStatsEl);
  el.appendChild(identityEl);

  let lastIdentityKey = '';

  return {
    update(world, sel) {
      // Identity card — only for exactly one selected entity. Otherwise hide.
      if (sel.ids.size !== 1) {
        if (el.style.display !== 'none') el.style.display = 'none';
        if (lastIdentityKey !== '') lastIdentityKey = '';
        return;
      }
      const id = sel.ids.values().next().value as number;
      const e = world.entities;
      if (e.alive[id] !== 1) {
        el.style.display = 'none';
        return;
      }
      const themeId = e.themeId[id]!;
      const firstIdx = e.firstNameIdx[id]!;
      const lastIdx = e.lastNameIdx[id]!;
      const townIdx = e.hometownIdx[id]!;
      const age = e.ageYears[id]!;
      const kills = e.kills[id]!;
      const damage = e.damageDealt[id]!;

      const key = `${id}|${themeId}|${firstIdx}|${lastIdx}|${townIdx}|${age}|${kills}|${damage}`;
      if (key !== lastIdentityKey) {
        const fullName = `${firstNameOf(themeId, firstIdx)} ${lastNameOf(themeId, lastIdx)}`;
        const hometown = hometownOf(themeId, townIdx);
        idHeaderEl.textContent = `${fullName}, age ${age}`;
        idHometownEl.textContent = hometown;
        idStatsEl.textContent = `Kills: ${kills}   Damage: ${damage}`;
        lastIdentityKey = key;
      }
      el.style.display = '';
    },
  };
}
```

The CSS for `.selection-identity-*` already exists and keeps working. The CSS for `.selection-panel .selection-summary` becomes dead — that's fine; it'll get pruned in Task 8.

- [ ] **Step 2: Verify build + tests.**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/ui/selection-panel.ts
git commit -m "refactor: trim selection-panel to identity card only"
```

---

## Task 5: Wire the new panel into `src/skirmish/main.ts`

**Files:**
- Modify: `src/skirmish/main.ts`

Skirmish currently mounts `selection-panel` and `formation-controls-panel` only — no `cannon-ammo-panel`, even though it has player cannons. The unified panel fixes that as a side effect.

- [ ] **Step 1: Replace the imports.**

Around line 39 in `src/skirmish/main.ts`, replace:

```ts
import { createFormationControlsPanel } from '../ui/formation-controls-panel';
```

(Note: `type StanceSummary` was already removed in Task 1.) Add:

```ts
import { createUnitControlsPanel } from '../ui/unit-controls-panel';
```

So the section ends up with `createSelectionPanel`, `createUnitControlsPanel`, and the other unchanged imports — no `createFormationControlsPanel` line.

- [ ] **Step 2: Swap instantiation.**

Replace:

```ts
const fcPanel = createFormationControlsPanel(overlay);
```

with:

```ts
const ucPanel = createUnitControlsPanel(overlay);
```

- [ ] **Step 3: Swap the per-frame update call.**

Replace:

```ts
fcPanel.update(selection, controller.formationParams, computeStanceSummary(selection, world.entities));
```

with:

```ts
ucPanel.update(world, selection, controller.formationParams, computeStanceSummary(selection, world.entities), controller.runMode);
```

- [ ] **Step 4: Build + tests.**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/skirmish/main.ts
git commit -m "feat(skirmish): mount unit-controls-panel"
```

---

## Task 6: Wire the new panel into `src/main.ts` (line battles)

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace the imports.**

In the import block (around lines 32 and 39), remove:

```ts
import { createCannonAmmoPanel } from './ui/cannon-ammo-panel';
```

```ts
import { createFormationControlsPanel } from './ui/formation-controls-panel';
```

(The `type StanceSummary` import was already removed in Task 1.) Add:

```ts
import { createUnitControlsPanel } from './ui/unit-controls-panel';
```

- [ ] **Step 2: Swap panel instantiations.**

Around lines 353 and 359, remove:

```ts
const cannonAmmoPanel = createCannonAmmoPanel(overlay);
```

```ts
const fcPanel = createFormationControlsPanel(overlay);
```

Add (place where `fcPanel` was, so initialization order matches the visual layout):

```ts
const ucPanel = createUnitControlsPanel(overlay);
```

- [ ] **Step 3: Swap update calls.**

Around line 431, remove:

```ts
cannonAmmoPanel.update(world, selection);
```

Around line 437, replace:

```ts
fcPanel.update(selection, controller.formationParams, computeStanceSummary(selection, world.entities));
```

with:

```ts
ucPanel.update(world, selection, controller.formationParams, computeStanceSummary(selection, world.entities), controller.runMode);
```

- [ ] **Step 4: Build + tests.**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main.ts
git commit -m "feat(line-battles): mount unit-controls-panel"
```

---

## Task 7: Wire the new panel into `src/cannon-test/main.ts`

**Files:**
- Modify: `src/cannon-test/main.ts`

This scenario only mounts `cannon-ammo-panel` today — no formation panel. Same swap.

- [ ] **Step 1: Inspect to find current wiring.**

Run: `grep -n "cannonAmmoPanel\|computeStanceSummary\|controller\." /Users/andrewcote/Documents/software/austerbitz/src/cannon-test/main.ts`
Expected: shows the import at line 22, instantiation at line 122, update call at line 254. Verify the controller variable name (likely `controller`) and that `controller.formationParams` and `controller.runMode` are accessible.

- [ ] **Step 2: Replace the import.**

Replace line 22:

```ts
import { createCannonAmmoPanel } from '../ui/cannon-ammo-panel';
```

with:

```ts
import { createUnitControlsPanel } from '../ui/unit-controls-panel';
import { computeStanceSummary } from '../input/stance-summary';
```

- [ ] **Step 3: Swap instantiation.**

Replace `const cannonAmmoPanel = createCannonAmmoPanel(overlay);` with:

```ts
const ucPanel = createUnitControlsPanel(overlay);
```

- [ ] **Step 4: Swap update call.**

Replace `cannonAmmoPanel.update(world, selection);` with:

```ts
ucPanel.update(world, selection, controller.formationParams, computeStanceSummary(selection, world.entities), controller.runMode);
```

If the local variable is named differently than `controller` (check Step 1), use the actual name. If `controller.runMode` isn't being read elsewhere yet, that's fine — it's a getter on the public `SelectionController` interface (see `src/input/selection-controller.ts:52`).

- [ ] **Step 5: Build + tests.**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/cannon-test/main.ts
git commit -m "feat(cannon-test): mount unit-controls-panel"
```

---

## Task 8: Delete the obsolete panels and their CSS

**Files:**
- Delete: `src/ui/formation-controls-panel.ts`
- Delete: `src/ui/cannon-ammo-panel.ts`
- Modify: `src/ui/styles.css`

By this task no scenario imports these files anymore. Verify, then remove.

- [ ] **Step 1: Confirm no remaining imports.**

Run: `grep -rn "formation-controls-panel\|cannon-ammo-panel" /Users/andrewcote/Documents/software/austerbitz/src /Users/andrewcote/Documents/software/austerbitz/index.html /Users/andrewcote/Documents/software/austerbitz/*.html 2>/dev/null`
Expected: No matches in `src/`. (The file paths themselves still exist on disk; we're checking for imports/references.)

If anything matches, fix it before deleting.

- [ ] **Step 2: Delete the files.**

```bash
rm src/ui/formation-controls-panel.ts src/ui/cannon-ammo-panel.ts
```

- [ ] **Step 3: Remove the dead CSS blocks.**

Open `src/ui/styles.css` and remove:

- The `#ui-root .formation-controls { … }` block plus its three `.fc-row`, `.fc-key`, `.fc-label`, `.fc-val` rules (around lines 389–413 in the file before this plan's edits).
- The `#ui-root .cannon-ammo-panel { … }` block and all `.cannon-ammo-slot`, `.cannon-ammo-icon`, `.cannon-ammo-name`, `.cannon-ammo-key`, `.cannon-ammo-mixed` rules (around lines 651–724).
- The dead `.selection-panel .selection-summary` rule (around line 51) — the summary text moved to `unit-controls`.

Also drop the comment `/* Cannon ammo panel — appears above the selection panel when artillery is selected. */` if it's still there.

- [ ] **Step 4: Build + tests.**

Run: `npm run build && npm test`
Expected: PASS. `tsc --noEmit` will catch any leftover references.

- [ ] **Step 5: Commit.**

```bash
git add -u src/ui/styles.css
git rm src/ui/formation-controls-panel.ts src/ui/cannon-ammo-panel.ts
git commit -m "chore: remove obsolete formation-controls and cannon-ammo panels"
```

---

## Task 9: Add focused unit tests

**Files:**
- Create: `src/ui/unit-controls-panel.test.ts`

Tests use the same fixture pattern as `src/ui/scenario-bar.test.ts`. Vitest runs in JSDOM mode by default for files like these (the project's existing tests confirm this). The panel needs a `#ui-root` element to mount into, which the test sets up before each case.

- [ ] **Step 1: Inspect the fixture surface for entities.**

Run: `grep -n "kindId\|cannonAmmo\|stance\|alive" /Users/andrewcote/Documents/software/austerbitz/src/sim/entities.ts | head -30`
Expected: confirms `e.kindId`, `e.alive`, `e.stance`, `e.cannonAmmo` are typed-array fields. We'll set them directly in the test.

Run: `grep -n "getUnitKindIndex\|line-infantry\|cannon-12\|cuirassier" /Users/andrewcote/Documents/software/austerbitz/src/data/units/index.ts`
Expected: confirms `getUnitKindIndex('line-infantry')`, `getUnitKindIndex('cannon-12')`, `getUnitKindIndex('cuirassier')` are the API for resolving kind ids.

- [ ] **Step 2: Write the test file.**

Create `src/ui/unit-controls-panel.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld } from '../sim/world';
import { allocEntity, FireStance } from '../sim/entities';
import { createSelection } from '../input/selection';
import { createFormationParams } from '../input/formation-params';
import { getUnitKindIndex } from '../data/units';
import { computeStanceSummary } from '../input/stance-summary';
import { createUnitControlsPanel } from './unit-controls-panel';

function setupRoot(): HTMLElement {
  document.body.innerHTML = '<div id="ui-root"></div>';
  return document.getElementById('ui-root')!;
}

function spawn(world: ReturnType<typeof createWorld>, kindId: string): number {
  const id = allocEntity(world.entities);
  if (id === -1) throw new Error('out of capacity');
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  return id;
}

function panelEl(root: HTMLElement): HTMLElement {
  const el = root.querySelector('.unit-controls') as HTMLElement | null;
  if (!el) throw new Error('panel not mounted');
  return el;
}

describe('unit-controls-panel', () => {
  let root: HTMLElement;
  let world: ReturnType<typeof createWorld>;
  let sel: ReturnType<typeof createSelection>;
  let params: ReturnType<typeof createFormationParams>;
  let panel: ReturnType<typeof createUnitControlsPanel>;

  beforeEach(() => {
    root = setupRoot();
    world = createWorld({ seed: 1, capacity: 32, mapSize: 100 });
    sel = createSelection();
    params = createFormationParams();
    panel = createUnitControlsPanel(root);
  });

  it('hides the panel when nothing is selected', () => {
    panel.update(world, sel, params, { kind: 'none' }, false);
    expect(panelEl(root).style.display).toBe('none');
  });

  it('shows the stance strip and hides the ammo strip for an infantry-only selection', () => {
    const id = spawn(world, 'line-infantry');
    world.entities.stance[id] = FireStance.Volley;
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    expect(el.style.display).toBe('');
    const stanceStrip = el.querySelector('.unit-strip-stance') as HTMLElement;
    const ammoStrip = el.querySelector('.unit-strip-ammo') as HTMLElement;
    expect(stanceStrip.style.display).toBe('');
    expect(ammoStrip.style.display).toBe('none');
    // Volley is index 1; check it's the active slot.
    const activeSlots = stanceStrip.querySelectorAll('.unit-slot.active');
    expect(activeSlots.length).toBe(1);
    expect(activeSlots[0]!.querySelector('.unit-slot-key')!.textContent).toBe('X');
  });

  it('shows the ammo strip and hides the stance strip for a cannon-only selection', () => {
    const id = spawn(world, 'cannon-12');
    world.entities.cannonAmmo[id] = 2; // canister
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    const stanceStrip = el.querySelector('.unit-strip-stance') as HTMLElement;
    const ammoStrip = el.querySelector('.unit-strip-ammo') as HTMLElement;
    expect(stanceStrip.style.display).toBe('none');
    expect(ammoStrip.style.display).toBe('');
    const activeKey = ammoStrip.querySelector('.unit-slot.active .unit-slot-key')!.textContent;
    expect(activeKey).toBe('C');
    // Cannon-only universal block visible.
    const cannonBlock = el.querySelector('.uc-block-cannon') as HTMLElement;
    expect(cannonBlock.style.display).toBe('');
  });

  it('hides both unit-specific strips for a cavalry-only selection', () => {
    const id = spawn(world, 'cuirassier');
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    expect((el.querySelector('.unit-strip-stance') as HTMLElement).style.display).toBe('none');
    expect((el.querySelector('.unit-strip-ammo') as HTMLElement).style.display).toBe('none');
    expect((el.querySelector('.uc-block-cannon') as HTMLElement).style.display).toBe('none');
    // Formation + universal blocks remain visible (parent panel visible).
    expect(el.style.display).toBe('');
  });

  it('shows both strips for a mixed infantry+artillery selection', () => {
    const inf = spawn(world, 'line-infantry');
    world.entities.stance[inf] = FireStance.Hold;
    const can = spawn(world, 'cannon-12');
    world.entities.cannonAmmo[can] = 0;
    sel.ids.add(inf); sel.ids.add(can);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    expect((el.querySelector('.unit-strip-stance') as HTMLElement).style.display).toBe('');
    expect((el.querySelector('.unit-strip-ammo') as HTMLElement).style.display).toBe('');
  });

  it('marks the stance strip mixed when infantry stances disagree', () => {
    const a = spawn(world, 'line-infantry'); world.entities.stance[a] = FireStance.AtWill;
    const b = spawn(world, 'line-infantry'); world.entities.stance[b] = FireStance.Volley;
    sel.ids.add(a); sel.ids.add(b);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    const mixedHint = el.querySelector('.unit-strip-stance .unit-slot-mixed') as HTMLElement;
    expect(mixedHint.style.display).toBe('');
    // No slot should be active.
    expect(el.querySelectorAll('.unit-strip-stance .unit-slot.active').length).toBe(0);
  });

  it('marks the ammo strip mixed when cannon ammo disagrees', () => {
    const a = spawn(world, 'cannon-12'); world.entities.cannonAmmo[a] = 0;
    const b = spawn(world, 'cannon-12'); world.entities.cannonAmmo[b] = 2;
    sel.ids.add(a); sel.ids.add(b);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);

    const el = panelEl(root);
    const mixedHint = el.querySelector('.unit-strip-ammo .unit-slot-mixed') as HTMLElement;
    expect(mixedHint.style.display).toBe('');
    expect(el.querySelectorAll('.unit-strip-ammo .unit-slot.active').length).toBe(0);
  });

  it('reflects runMode in the Walk/Run row value', () => {
    const id = spawn(world, 'line-infantry');
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);
    let tVal = panelEl(root).querySelectorAll('.uc-row .uc-val');
    // Find the row whose key is "T".
    function valForKey(key: string): string {
      const rows = panelEl(root).querySelectorAll('.uc-row');
      for (const row of rows) {
        if (row.querySelector('.uc-key')!.textContent === key) {
          return row.querySelector('.uc-val')?.textContent ?? '';
        }
      }
      throw new Error(`row ${key} missing`);
    }
    expect(valForKey('T')).toBe('Walk');

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), true);
    expect(valForKey('T')).toBe('Run');
  });

  it('reflects spacing/ranks values', () => {
    const id = spawn(world, 'line-infantry');
    sel.ids.add(id);

    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);
    function valForKey(key: string): string {
      const rows = panelEl(root).querySelectorAll('.uc-row');
      for (const row of rows) {
        if (row.querySelector('.uc-key')!.textContent === key) {
          return row.querySelector('.uc-val')?.textContent ?? '';
        }
      }
      throw new Error(`row ${key} missing`);
    }
    expect(valForKey('[ ]')).toMatch(/× /);
    expect(valForKey(', .')).toBe('auto');

    params.ranks = 4;
    panel.update(world, sel, params, computeStanceSummary(sel, world.entities), false);
    expect(valForKey(', .')).toBe('4');
  });
});
```

- [ ] **Step 3: Run the tests.**

Run: `npm test -- unit-controls-panel`
Expected: All 9 tests pass.

- [ ] **Step 4: Run the full suite.**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/ui/unit-controls-panel.test.ts
git commit -m "test: cover unit-controls-panel section visibility and state"
```

---

## Final verification

After all tasks complete:

- [ ] **Run typecheck + tests one more time.**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Manually open each scenario and click around to confirm.**

Run: `npm run dev`

Then in the browser:
- Line battles (`/index.html`): box-select infantry → expect stance strip + formation + universal rows. Box-select cannons → expect ammo strip + cannon-only rows. Box-select cavalry → no unit strip, formation + universal rows visible. Mixed → both strips.
- Skirmish (`/skirmish.html`): select the player cannons → ammo strip should appear (this is the fix for the previously-missing cannon-ammo panel in skirmish).
- Cannon test (`/cannon-test.html`): select a cannon → ammo strip + cannon-only rows.

In each scenario, also confirm: pressing T flips the "Walk / Run" row text; `[`/`]` updates the spacing value; `,`/`.` updates the ranks value; cycling Z/X/C (with infantry) cycles the active stance slot; cycling Z/X/C (with cannons) cycles the active ammo slot.

If a UI/manual smoke check fails, fix in place — don't claim "complete" until the panel actually works in all three scenarios.
