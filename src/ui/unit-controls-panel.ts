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
