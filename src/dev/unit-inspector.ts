import { getUnitKind, getUnitKindByIndex, unitKinds } from '../data/units';
import type { UnitKind } from '../data/types';
import {
  generateBritishSoldierSheet,
  SOLDIER_CELL_W,
  SOLDIER_CELL_H,
  SOLDIER_SHEET_W,
  POSE_CELLS,
} from '../render/british-soldier-sprite';

interface UnitRenderer {
  id: string;
  label: string;
  /** Return sprite canvases to display for this unit. */
  createPreviews(opts: { scale: number }): HTMLCanvasElement[];
}

function canvasFromImageData(data: Uint8Array, width: number, height: number, scale = 4): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.className = 'pixel-preview';
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  const imageData = new ImageData(width, height);
  imageData.data.set(data);
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = width;
  tmpCanvas.height = height;
  const tmpCtx = tmpCanvas.getContext('2d');
  if (!tmpCtx) throw new Error('tmp canvas 2d context unavailable');
  tmpCtx.putImageData(imageData, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmpCanvas, 0, 0, width, height, 0, 0, width * scale, height * scale);
  return canvas;
}

const britishInfantryRenderer: UnitRenderer = {
  id: 'line-infantry',
  label: 'British Line Infantry',
  createPreviews: ({ scale }) => {
    const sheet = generateBritishSoldierSheet();
    const previews: HTMLCanvasElement[] = [];
    for (const cell of POSE_CELLS) {
      const data = new Uint8Array(SOLDIER_CELL_W * SOLDIER_CELL_H * 4);
      const sheetRowStride = SOLDIER_SHEET_W * 4;
      for (let y = 0; y < SOLDIER_CELL_H; y++) {
        const srcRow = (cell.row * SOLDIER_CELL_H + y) * sheetRowStride + cell.col * SOLDIER_CELL_W * 4;
        const dstRow = y * SOLDIER_CELL_W * 4;
        data.set(sheet.subarray(srcRow, srcRow + SOLDIER_CELL_W * 4), dstRow);
      }
      previews.push(canvasFromImageData(data, SOLDIER_CELL_W, SOLDIER_CELL_H, scale));
    }
    return previews;
  },
};

const defaultRenderers: UnitRenderer[] = [britishInfantryRenderer];

function getRendererForUnit(kind: UnitKind): UnitRenderer | undefined {
  return defaultRenderers.find((r) => r.id === kind.id);
}

const searchInput = document.getElementById('unit-search') as HTMLInputElement;
const listEl = document.getElementById('unit-list')!;
const detailSection = document.getElementById('detail')!;
const noSelectionEl = document.getElementById('no-selection')!;
const detailNameEl = document.getElementById('detail-name')!;
const detailCategoryEl = document.getElementById('detail-category')!;
const detailIdEl = document.getElementById('detail-id')!;
const detailSizeEl = document.getElementById('detail-size')!;
const spritePreviewEl = document.getElementById('sprite-preview')!;
const statsGridEl = document.getElementById('stats-grid')!;
const placeholderChipEl = document.getElementById('placeholder-chip')!;
const placeholderMetaEl = document.getElementById('placeholder-meta')!;

let selectedId: string | null = null;

function formatSize(size: { w: number; h: number }): string {
  return `${size.w.toFixed(2)}m × ${size.h.toFixed(2)}m`;
}

function renderUnitList(filter: string) {
  const query = filter.trim().toLowerCase();
  listEl.innerHTML = '';
  unitKinds
    .filter((kind) => kind.name.toLowerCase().includes(query) || kind.id.includes(query))
    .forEach((kind) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = kind.name;
      btn.type = 'button';
      btn.dataset.unitId = kind.id;
      if (kind.id === selectedId) {
        btn.setAttribute('aria-pressed', 'true');
      }
      btn.addEventListener('click', () => {
        selectUnit(kind.id);
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
}

function selectUnit(id: string) {
  if (selectedId === id) return;
  selectedId = id;
  const buttons = listEl.querySelectorAll('button');
  buttons.forEach((btn) => {
    if ((btn as HTMLButtonElement).dataset.unitId === id) {
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.removeAttribute('aria-pressed');
    }
  });
  const unit = getUnitKind(id);
  populateDetail(unit);
}

function populateDetail(unit: UnitKind) {
  detailNameEl.textContent = unit.name;
  detailCategoryEl.textContent = unit.category;
  detailIdEl.textContent = `ID: ${unit.id}`;
  detailSizeEl.textContent = `Footprint: ${formatSize(unit.placeholderSize)}`;

  placeholderChipEl.style.backgroundColor = `rgb(${unit.placeholderColor.join(',')})`;
  placeholderMetaEl.textContent = `Placeholder tint rgb(${unit.placeholderColor.join(', ')})`;

  // Stats grid
  const { baseStats } = unit;
  statsGridEl.innerHTML = '';
  const statEntries: Array<[string, string]> = [
    ['HP', baseStats.hp.toString()],
    ['Speed', `${baseStats.moveSpeed.toFixed(1)} m/s`],
    ['Morale', baseStats.morale.toString()],
    ['Sight', `${baseStats.sightRange} m`],
    ['Weapon Range', `${baseStats.weaponRange} m`],
    ['Damage', `${baseStats.weaponDamage}`],
    ['Reload', `${baseStats.weaponReload.toFixed(1)} s`],
    ['Accuracy', `${Math.round(baseStats.weaponAccuracy * 100)}%`],
    ['Armor', baseStats.armor.toString()],
    ['Mass', `${baseStats.massKg} kg`],
    ['Spacing', `${baseStats.formationSpacing.x} × ${baseStats.formationSpacing.y}`],
  ];
  for (const [label, value] of statEntries) {
    const div = document.createElement('div');
    div.className = 'stat-pair';
    const lbl = document.createElement('div');
    lbl.className = 'stat-label';
    lbl.textContent = label;
    const val = document.createElement('div');
    val.className = 'stat-value';
    val.textContent = value;
    div.append(lbl, val);
    statsGridEl.appendChild(div);
  }

  // Sprite preview
  spritePreviewEl.innerHTML = '';
  const renderer = getRendererForUnit(unit);
  if (renderer) {
    const canvases = renderer.createPreviews({ scale: 4 });
    canvases.forEach((canvas) => spritePreviewEl.appendChild(canvas));
  } else {
    const placeholder = document.createElement('div');
    placeholder.textContent = 'No sprite renderer linked for this unit.';
    spritePreviewEl.appendChild(placeholder);
  }

  noSelectionEl.style.display = 'none';
  detailSection.hidden = false;
}

searchInput.addEventListener('input', () => renderUnitList(searchInput.value));

renderUnitList('');
if (unitKinds.length > 0) {
  selectUnit(unitKinds[0]!.id);
}

// Expose for quick debugging from console.
Object.assign(window, {
  __unitKinds: unitKinds,
  __getUnitKind: getUnitKindByIndex,
});
