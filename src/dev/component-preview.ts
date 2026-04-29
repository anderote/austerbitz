import { loadRegiments, type Regiment } from './regiments';
import { paintWeaponInto, facingToSuffix, type WeaponOrientation } from './weapon-rendering';
import { renderCellInto } from './cell-render';
import { mountUnitPicker, type UnitPickerKit } from './unit-picker';
import { mountPoseStrip, type PoseStripPose } from './pose-strip';
import { mountVariantsStrip } from './variants-strip';
import {
  applyEditsToContext,
  loadPixelEdits,
  lookupEdits,
  setPixel,
  type PixelEditsTree,
  type PixelEdit,
} from './pixel-edits-overlay';
import { loadImage } from './image-cache';
import { mountPaintTool } from './paint-tool';
import { mountPaintPalette } from './paint-palette';

// Component registry types ----------------------------------------------------
type ComponentEntry = {
  id: string;
  type: string;
  category: string;
  facings: string[];
  path: string;
  pivot?: [number, number];
  anchors?: Record<string, [number, number]>;
  notes?: string;
};

type ComponentRegistry = {
  components: ComponentEntry[];
};

type KitFacingConfig = {
  cell?: [number, number];
  layers: string[];
};

// Inline structural duplicate of PoseFacingEntry (dev-only; avoids importing runtime types).
// layers may be string[] (single frame) or string[][] (multi-frame animation).
// When absent or empty, the caller falls back to kit.facings[facing].layers.
type KitPoseFacingEntry = {
  layers?: string[] | string[][];
  weapons?: WeaponOrientation[];
};

function isPoseEntryObject(
  v: KitPoseFacingEntry | string[][],
): v is KitPoseFacingEntry {
  return !Array.isArray(v);
}

type KitConfig = {
  id: string;
  label: string;
  baseAtlas?: string;
  outputAtlas?: string;
  outputPreview?: string;
  facings: Record<string, KitFacingConfig>;
  poses?: Record<string, Record<string, KitPoseFacingEntry | string[][]>>;
  weapon?: { layerPrefix: string };
};

const COMPONENT_BASE_URL = '/sprites/components/';
const KIT_INDEX_URL = '/components/kits/index.json';
const REGISTRY_URL = '/components/index.json';

const LAYER_SEQUENCE = [
  'fx:shadow',
  'anatomy:legs',
  'uniform:lower',
  'anatomy:torso',
  'uniform:upper',
  'anatomy:head',
  'uniform:headgear',
  'weapon:primary',
];

const GROUP_LABELS: Record<string, string> = {
  fx: 'Effects',
  anatomy: 'Anatomy',
  uniform: 'Uniform',
  weapon: 'Weapons',
};

const registryContainer = document.getElementById('component-groups') as HTMLDivElement;
const facingSelect = document.getElementById('facing-select') as HTMLSelectElement;
const kitSelect = document.getElementById('kit-select') as HTMLSelectElement;
const poseSelect = document.getElementById('pose-select') as HTMLSelectElement;
const regimentSelect = document.getElementById('regiment-select') as HTMLSelectElement | null;
const resetButton = document.getElementById('reset-button') as HTMLButtonElement;
const infoCard = document.getElementById('info-card') as HTMLDivElement;

const GRID_FACINGS = ['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE'] as const;
type GridCell = { facing: string; cell: HTMLButtonElement; ctx: CanvasRenderingContext2D };
const gridCells: GridCell[] = [];
for (const facing of GRID_FACINGS) {
  const cell = document.querySelector<HTMLButtonElement>(
    `.facing-cell[data-facing="${facing}"]`,
  );
  if (!cell) continue;
  const cellCanvas = cell.querySelector<HTMLCanvasElement>('canvas');
  const cellCtx = cellCanvas?.getContext('2d', { alpha: true });
  if (!cellCanvas || !cellCtx) continue;
  cellCtx.imageSmoothingEnabled = false;
  gridCells.push({ facing, cell, ctx: cellCtx });
}

// Right-side weapon source grid cells.
type SourceGridCell = {
  facing: string;
  cell: HTMLButtonElement;
  ctx: CanvasRenderingContext2D;
};
const sourceGridCells: SourceGridCell[] = [];
for (const facing of GRID_FACINGS) {
  const cell = document.querySelector<HTMLButtonElement>(
    `.weapon-source-cell[data-facing="${facing}"]`,
  );
  if (!cell) continue;
  const cellCanvas = cell.querySelector<HTMLCanvasElement>('canvas');
  const cellCtx = cellCanvas?.getContext('2d', { alpha: true });
  if (!cellCanvas || !cellCtx) continue;
  cellCtx.imageSmoothingEnabled = false;
  sourceGridCells.push({ facing, cell, ctx: cellCtx });
}

// Edit-strip DOM handles.
const editThumb = document.getElementById('weapon-edit-thumb') as HTMLCanvasElement | null;
const editThumbCtx = editThumb?.getContext('2d', { alpha: true }) ?? null;
if (editThumbCtx) editThumbCtx.imageSmoothingEnabled = false;
const statX = document.getElementById('stat-x');
const statY = document.getElementById('stat-y');
const statRot = document.getElementById('stat-rot');
const statFlipX = document.getElementById('stat-flipx');
const btnMirror = document.getElementById('btn-mirror') as HTMLButtonElement | null;
const btnRotate = document.getElementById('btn-rotate') as HTMLButtonElement | null;
const btnDeleteVariant = document.getElementById('btn-delete-variant') as HTMLButtonElement | null;
const btnSaveKit = document.getElementById('btn-save-kit') as HTMLButtonElement | null;
const toastEl = document.getElementById('toast');

const componentsById = new Map<string, ComponentEntry>();
const kitsById = new Map<string, KitConfig>();
const componentSelections = new Set<string>();

let currentFacing = 'S';
let currentPose = 'idle';
let currentKitId: string | null = null;
let renderToken = 0;
let currentRegiment: Regiment | null = null;
let regiments: Regiment[] = [];

// Unit picker handle (initialized in main(), used by initEvents() handlers).
let unitPicker: ReturnType<typeof mountUnitPicker> | null = null;
// Pose strip handle (initialized in main(), used by initEvents() handlers).
let poseStrip: ReturnType<typeof mountPoseStrip> | null = null;
// Variants strip handle (initialized in main(), used by initEvents() handlers).
let selectedVariantIdx = 0;
let variantsStrip: ReturnType<typeof mountVariantsStrip> | null = null;
// Paint tool handle (initialized in main(), used by initEvents() handlers).
let paintTool: ReturnType<typeof mountPaintTool> | null = null;
// Paint palette handle (initialized in main()).
let paintPalette: ReturnType<typeof mountPaintPalette> | null = null;

// Per-row preview canvases. Both are displayed at 248×278 to match the 3×3
// grid box outer dimensions; the facing preview is 32×36 native, the weapon
// source preview is 32×32 native (slight vertical stretch is acceptable).
const facingPreviewCanvas = document.getElementById('facing-preview-canvas') as HTMLCanvasElement;
const facingPreviewCtx = facingPreviewCanvas.getContext('2d', { alpha: true });
if (facingPreviewCtx) facingPreviewCtx.imageSmoothingEnabled = false;

const weaponPreviewCanvas = document.getElementById('weapon-source-preview-canvas') as HTMLCanvasElement;
const weaponPreviewCtx = weaponPreviewCanvas.getContext('2d', { alpha: true });
if (weaponPreviewCtx) weaponPreviewCtx.imageSmoothingEnabled = false;

// Composite preview — view-only big canvas showing body + weapon together.
const compositePreviewCanvas = document.getElementById('composite-preview-canvas') as HTMLCanvasElement;
const compositePreviewCtx = compositePreviewCanvas.getContext('2d', { alpha: true });
if (compositePreviewCtx) compositePreviewCtx.imageSmoothingEnabled = false;

// In-memory mirror of pixel-edits.json (loaded in main()).
let pixelEdits: PixelEditsTree = {};

function getLayerEditsAt(
  kitId: string,
  pose: string,
  facing: string,
  componentId: string,
): readonly PixelEdit[] {
  return lookupEdits(pixelEdits, kitId, pose, facing, componentId);
}

function layerKey(entry: ComponentEntry): string {
  return `${entry.type}:${entry.category}`;
}

function buildPoseStrip(): PoseStripPose[] {
  if (!currentKitId) return [];
  const kit = kitsById.get(currentKitId);
  if (!kit) return [];
  const poseNames = kit.poses ? Object.keys(kit.poses) : [];
  const fallback = ['idle', 'walking', 'running', 'make-ready', 'present', 'fire', 'hit', 'dying'];
  const names = poseNames.length > 0 ? poseNames : fallback;
  return names.map((name) => {
    const sEntry = kit.poses?.[name]?.['S'];
    let sLayers: string[];
    if (!sEntry) {
      sLayers = kit.facings['S']?.layers ?? [];
    } else if (Array.isArray(sEntry)) {
      const first = sEntry[0];
      sLayers = Array.isArray(first)
        ? (first as string[])
        : ((sEntry as unknown) as string[]);
    } else {
      const obj = sEntry as { layers?: string[] | string[][] };
      const baseLayers = obj.layers && obj.layers.length > 0
        ? (Array.isArray(obj.layers[0]) ? (obj.layers[0] as string[]) : (obj.layers as string[]))
        : (kit.facings['S']?.layers ?? []);
      sLayers = baseLayers;
    }
    let weapon: PoseStripPose['weapon'];
    if (kit.weapon?.layerPrefix) {
      let sOrientation: WeaponOrientation | undefined;
      if (sEntry && !Array.isArray(sEntry)) {
        sOrientation = (sEntry as { weapons?: WeaponOrientation[] }).weapons?.[0];
      }
      weapon = { layerPrefix: kit.weapon.layerPrefix, sOrientation };
    }
    return { name, kitId: currentKitId!, sLayers, weapon };
  });
}

function layerPriority(entry: ComponentEntry): number {
  const key = layerKey(entry);
  const seqIndex = LAYER_SEQUENCE.indexOf(key);
  return seqIndex >= 0 ? seqIndex : LAYER_SEQUENCE.length + 1;
}

function ensureFacingOption(facing: string) {
  for (const option of facingSelect.options) {
    if (option.value === facing) return;
  }
  const opt = document.createElement('option');
  opt.value = facing;
  opt.textContent = facing;
  facingSelect.appendChild(opt);
}

function setFacing(facing: string) {
  currentFacing = facing;
  facingSelect.value = facing;
}

function setKit(kitId: string | null) {
  currentKitId = kitId;
  if (kitId) {
    kitSelect.value = kitId;
  }
}

function applyKitDefaults(kitId: string | null, facing: string) {
  if (!kitId) {
    componentSelections.clear();
    return;
  }
  const kit = kitsById.get(kitId);
  if (!kit) return;
  const facingConfig = kit.facings[facing];
  componentSelections.clear();
  if (!facingConfig) return;
  for (const id of facingConfig.layers) {
    const entry = componentsById.get(id);
    if (entry && entry.facings.includes(facing)) {
      componentSelections.add(id);
    }
  }
}

function rebuildComponentGroups() {
  registryContainer.innerHTML = '';
  const availableEntries = Array.from(componentsById.values()).filter((entry) =>
    entry.facings.includes(currentFacing)
  );
  availableEntries.sort((a, b) => {
    const layer = layerPriority(a) - layerPriority(b);
    if (layer !== 0) return layer;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.id.localeCompare(b.id);
  });

  // Remove selections that are no longer valid for this facing.
  for (const id of Array.from(componentSelections)) {
    const entry = componentsById.get(id);
    if (!entry || !entry.facings.includes(currentFacing)) {
      componentSelections.delete(id);
    }
  }

  const groups = new Map<string, HTMLDivElement>();

  const ensureGroup = (key: string) => {
    if (!groups.has(key)) {
      const section = document.createElement('div');
      const heading = document.createElement('h2');
      heading.textContent = GROUP_LABELS[key] ?? key;
      section.appendChild(heading);
      registryContainer.appendChild(section);
      groups.set(key, section);
    }
    return groups.get(key)!;
  };

  for (const entry of availableEntries) {
    const groupKey = entry.type;
    const section = ensureGroup(groupKey);
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = componentSelections.has(entry.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        componentSelections.add(entry.id);
      } else {
        componentSelections.delete(entry.id);
      }
      void renderPreview();
    });
    const descriptor = document.createElement('span');
    descriptor.textContent = `${entry.id} (${entry.category})`;
    label.append(checkbox, descriptor);
    section.appendChild(label);
  }
}

function resolvePoseLayers(
  kit: KitConfig,
  pose: string,
  facing: string,
): string[] | null {
  const poseData = kit.poses?.[pose]?.[facing];
  if (!poseData) return null;

  const rawLayers = isPoseEntryObject(poseData) ? poseData.layers : poseData;
  if (!rawLayers || rawLayers.length === 0) return null;

  // Static editor preview — no frame slider yet, so always show frame 0.
  if (Array.isArray(rawLayers[0])) {
    const frame0 = rawLayers[0] as string[];
    return frame0.length > 0 ? frame0 : null;
  }

  return rawLayers as string[];
}

function layersForFacing(facing: string): ComponentEntry[] {
  if (!currentKitId) {
    return Array.from(componentSelections)
      .map((id) => componentsById.get(id))
      .filter((entry): entry is ComponentEntry => Boolean(entry && entry.facings.includes(facing)))
      .sort((a, b) => {
        const priority = layerPriority(a) - layerPriority(b);
        if (priority !== 0) return priority;
        return a.id.localeCompare(b.id);
      });
  }
  const kit = kitsById.get(currentKitId);
  if (!kit) return [];

  // Consult pose layers first; fall back to kit.facings[facing].layers when
  // the pose has no entry for this facing, or when its layers array is empty.
  const poseLayerIds = resolvePoseLayers(kit, currentPose, facing);
  const ids = poseLayerIds ?? kit.facings[facing]?.layers ?? [];

  return ids
    .map((id) => componentsById.get(id))
    .filter((entry): entry is ComponentEntry => Boolean(entry && entry.facings.includes(facing)))
    .sort((a, b) => {
      const priority = layerPriority(a) - layerPriority(b);
      if (priority !== 0) return priority;
      return a.id.localeCompare(b.id);
    });
}

function getPoseEntry(facing: string): KitPoseFacingEntry | null {
  if (!currentKitId) return null;
  const kit = kitsById.get(currentKitId);
  if (!kit) return null;
  const raw = kit.poses?.[currentPose]?.[facing];
  if (!raw) return null;
  if (isPoseEntryObject(raw)) return raw;
  // Bare array — has no weapons field by definition.
  return null;
}

function drawVariantBadge(target: CanvasRenderingContext2D, count: number): void {
  if (count < 2) return;
  const text = `×${count}`;
  target.save();
  // Use canvas dimensions for placement (canvas is 32x36 in current setup).
  const cw = target.canvas.width;
  const ch = target.canvas.height;
  // Pixel-art aesthetic — small, hard-edged.
  target.font = '8px ui-monospace, Menlo, monospace';
  target.textBaseline = 'bottom';
  target.textAlign = 'right';
  const padX = 1;
  const padY = 1;
  const metrics = target.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const textHeight = 8;
  const boxW = textWidth + padX * 2;
  const boxH = textHeight + padY * 2;
  const boxX = cw - boxW - 1;
  const boxY = ch - boxH - 1;
  target.fillStyle = 'rgba(0, 0, 0, 0.75)';
  target.fillRect(boxX, boxY, boxW, boxH);
  target.fillStyle = '#ffffff';
  target.fillText(text, cw - 2, ch - 2);
  target.restore();
}

/**
 * Render one center-grid cell (body + weapon overlay + variant badge).
 * For the active facing, draws the currently selected variant; for other
 * facings, draws their weapons[0] (or nothing if absent).
 */
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

  const variants = currentKitId
    ? kitsById.get(currentKitId)?.poses?.[currentPose]?.[facing]
    : null;
  let orientation: WeaponOrientation | undefined;
  if (variants && !Array.isArray(variants)) {
    const list = (variants as { weapons?: WeaponOrientation[] }).weapons;
    if (list && list.length > 0) {
      const idx = facing === currentFacing ? Math.min(selectedVariantIdx, list.length - 1) : 0;
      orientation = list[idx];
    }
  }

  if (token !== renderToken) return;

  await renderCellInto(cellCtx, {
    layerIds,
    components: componentsById,
    componentBaseUrl: COMPONENT_BASE_URL,
    regiment: currentRegiment,
    weapon: layerPrefix && orientation ? { layerPrefix, orientation } : undefined,
    layerEdits: (componentId) =>
      currentKitId ? lookupEdits(pixelEdits, currentKitId, currentPose, facing, componentId) : [],
  });

  if (token !== renderToken) return;

  // Variant badge (count of saved weapons[]).
  const entry = getPoseEntry(facing);
  const variantCount = entry?.weapons?.length ?? 0;
  drawVariantBadge(cellCtx, variantCount);
}

async function renderFacingPreview(token: number): Promise<void> {
  if (!facingPreviewCtx) return;
  facingPreviewCtx.clearRect(0, 0, facingPreviewCanvas.width, facingPreviewCanvas.height);

  const layers = layersForFacing(currentFacing);
  const layerIds = layers.map((entry) => entry.id);

  if (token !== renderToken) return;

  // Body-only: weapon overlay omitted on purpose — the composite column shows
  // the merged preview, and this surface is the paintable body view.
  await renderCellInto(facingPreviewCtx, {
    layerIds,
    components: componentsById,
    componentBaseUrl: COMPONENT_BASE_URL,
    regiment: currentRegiment,
    weapon: undefined,
    layerEdits: (componentId) =>
      currentKitId
        ? lookupEdits(pixelEdits, currentKitId, currentPose, currentFacing, componentId)
        : [],
  });
}

async function renderCompositePreview(token: number): Promise<void> {
  if (!compositePreviewCtx) return;
  compositePreviewCtx.clearRect(0, 0, compositePreviewCanvas.width, compositePreviewCanvas.height);

  const layers = layersForFacing(currentFacing);
  const layerIds = layers.map((entry) => entry.id);

  const kit = currentKitId ? kitsById.get(currentKitId) : null;
  const layerPrefix = kit?.weapon?.layerPrefix;

  const variants = currentKitId
    ? kitsById.get(currentKitId)?.poses?.[currentPose]?.[currentFacing]
    : null;
  let orientation: WeaponOrientation | undefined;
  if (variants && !Array.isArray(variants)) {
    const list = (variants as { weapons?: WeaponOrientation[] }).weapons;
    if (list && list.length > 0) {
      orientation = list[Math.min(selectedVariantIdx, list.length - 1)];
    }
  }

  if (token !== renderToken) return;

  await renderCellInto(compositePreviewCtx, {
    layerIds,
    components: componentsById,
    componentBaseUrl: COMPONENT_BASE_URL,
    regiment: currentRegiment,
    weapon: layerPrefix && orientation ? { layerPrefix, orientation } : undefined,
    layerEdits: (componentId) =>
      currentKitId
        ? lookupEdits(pixelEdits, currentKitId, currentPose, currentFacing, componentId)
        : [],
  });
}

async function renderWeaponSourcePreview(token: number): Promise<void> {
  if (!weaponPreviewCtx) return;
  weaponPreviewCtx.clearRect(0, 0, weaponPreviewCanvas.width, weaponPreviewCanvas.height);

  const v = getSelectedVariant();
  if (!v || !currentKitId) return;
  const kit = kitsById.get(currentKitId);
  const layerPrefix = kit?.weapon?.layerPrefix;
  if (!layerPrefix) return;
  const componentId = `${layerPrefix}-${facingToSuffix(v.src)}`;
  const componentEntry = componentsById.get(componentId);
  if (!componentEntry) return;
  const weaponUrl = `${COMPONENT_BASE_URL}${componentEntry.path}`;

  if (token !== renderToken) return;

  // Raw weapon PNG draw at native size, no offset / no transform — the user is
  // editing the underlying source PNG.
  try {
    const img = await loadImage(weaponUrl);
    if (token !== renderToken) return;
    weaponPreviewCtx.drawImage(img, 0, 0);

    // Apply any existing pixel-edits for this weapon component, sampled from
    // the (currentPose, currentFacing) entry — they're broadcast to all
    // (pose, facing) using this src, so any one is representative.
    const edits = lookupEdits(pixelEdits, currentKitId, currentPose, currentFacing, componentId);
    if (edits.length > 0) {
      applyEditsToContext(weaponPreviewCtx, edits);
    }
  } catch (err) {
    console.warn('[weapon-source-preview]', err);
  }
}

async function renderPreview() {
  const token = ++renderToken;

  // Update each grid cell using kit-defined layers for that facing so all 8
  // views stay in sync with the active kit + regiment.
  await Promise.all(
    gridCells.map(({ facing, ctx: cellCtx }) => renderCenterCell(facing, cellCtx, token)),
  );

  await renderFacingPreview(token);
  await renderWeaponSourcePreview(token);
  await renderCompositePreview(token);

  for (const { facing, cell } of gridCells) {
    cell.classList.toggle('active', facing === currentFacing);
  }

  const layers = layersForFacing(currentFacing);
  const lines: string[] = [];
  if (currentKitId) {
    const kit = kitsById.get(currentKitId);
    if (kit) {
      lines.push(`<strong>Kit:</strong> ${kit.label}`);
    }
  }
  lines.push(`<strong>Facing:</strong> ${currentFacing}`);
  lines.push(`<strong>Layers:</strong> ${layers.map((entry) => entry.id).join(', ') || 'none'}`);
  infoCard.innerHTML = lines.join('<br />');
}

/**
 * Paint the right-side 3x3 weapon source grid using the raw weapon PNGs for
 * the current kit. Cells without a registered source PNG render empty + disabled.
 */
async function renderWeaponSourceGrid(): Promise<void> {
  if (!currentKitId) return;
  const kit = kitsById.get(currentKitId);
  const layerPrefix = kit?.weapon?.layerPrefix;
  await Promise.all(
    sourceGridCells.map(async ({ facing, cell, ctx: cellCtx }) => {
      cellCtx.clearRect(0, 0, cellCtx.canvas.width, cellCtx.canvas.height);
      if (!layerPrefix) {
        cell.classList.add('disabled');
        return;
      }
      const componentId = `${layerPrefix}-${facingToSuffix(facing)}`;
      const componentEntry = componentsById.get(componentId);
      if (!componentEntry) {
        cell.classList.add('disabled');
        return;
      }
      cell.classList.remove('disabled');
      const weaponUrl = `${COMPONENT_BASE_URL}${componentEntry.path}`;
      try {
        await paintWeaponInto(
          cellCtx,
          weaponUrl,
          { src: facing, x: 0, y: 0, rot: 0 },
          { applyOffset: false },
        );
      } catch (err) {
        console.warn('[source-grid]', err);
      }
    }),
  );
  // Reflect any active source selection.
  updateSourceGridHighlight();
}

function updateSourceGridHighlight(): void {
  const v = getSelectedVariant();
  for (const { facing, cell } of sourceGridCells) {
    cell.classList.toggle('active', !!v && v.src === facing);
  }
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

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(message: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove('success', 'error');
  if (kind === 'success') toastEl.classList.add('success');
  else if (kind === 'error') toastEl.classList.add('error');
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2000);
}

function ensurePoseEntryWeapons(
  kit: KitConfig,
  pose: string,
  facing: string,
): WeaponOrientation[] {
  if (!kit.poses) kit.poses = {};
  const poseMap = kit.poses[pose] ?? (kit.poses[pose] = {});
  const existing = poseMap[facing];
  let entry: KitPoseFacingEntry;
  if (!existing) {
    entry = {};
    poseMap[facing] = entry;
  } else if (isPoseEntryObject(existing)) {
    entry = existing;
  } else {
    // Bare-array shape — convert to object form, preserving the layers.
    entry = { layers: existing };
    poseMap[facing] = entry;
  }
  if (!entry.weapons) entry.weapons = [];
  return entry.weapons;
}

function currentVariants(): WeaponOrientation[] {
  if (!currentKitId) return [];
  const kit = kitsById.get(currentKitId);
  if (!kit) return [];
  const entry = kit.poses?.[currentPose]?.[currentFacing];
  if (!entry || Array.isArray(entry)) return [];
  return ((entry as { weapons?: WeaponOrientation[] }).weapons) ?? [];
}

function getSelectedVariant(): WeaponOrientation | null {
  const list = currentVariants();
  if (list.length === 0) return null;
  if (selectedVariantIdx >= list.length) selectedVariantIdx = 0;
  return list[selectedVariantIdx] ?? null;
}

function refreshVariantsStrip(): void {
  if (!variantsStrip) return;
  const layers = layersForFacing(currentFacing).map((e) => e.id);
  const kit = currentKitId ? kitsById.get(currentKitId) : null;
  const layerPrefix = kit?.weapon?.layerPrefix ?? null;
  variantsStrip.setContent(layers, layerPrefix, currentVariants(), selectedVariantIdx);
}

function refreshPaintLayers(): void {
  if (!paintTool) return;
  const layerIds = layersForFacing(currentFacing).map((e) => e.id);
  paintTool.setActiveLayers(layerIds);
}

/**
 * Write a single pixel into the weapon source PNG identified by `componentId`,
 * broadcast to every `(pose, facing)` in the active kit whose `weapons[]`
 * entries reference the same `src`. Erase mode writes the literal `"clear"`.
 *
 * Data is duplicated across (pose, facing) keys — the build pipeline reads
 * pixel-edits per (kit, pose, facing, componentId), so this is the cheapest
 * way to "edit the source PNG" without a build-pipeline change.
 */
function paintWeaponSourcePixel(
  kitId: string,
  src: string,
  componentId: string,
  x: number,
  y: number,
  modeOverride?: 'brush' | 'erase',
): void {
  if (!paintTool) return;
  const mode = modeOverride ?? paintTool.state.mode;
  const color = mode === 'erase' ? 'clear' : paintTool.state.color;
  const kit = kitsById.get(kitId);
  if (!kit) return;
  const poses = kit.poses ?? {};
  let wrote = false;
  for (const [poseName, perFacing] of Object.entries(poses)) {
    if (!perFacing || typeof perFacing !== 'object') continue;
    for (const [facing, entry] of Object.entries(perFacing)) {
      if (!entry || Array.isArray(entry)) continue;
      const variants = (entry as { weapons?: Array<{ src?: string }> }).weapons;
      if (!variants) continue;
      const matches = variants.some((w) => w?.src === src);
      if (!matches) continue;
      setPixel(pixelEdits, kitId, poseName, facing, componentId, { x, y, color });
      wrote = true;
    }
  }
  if (wrote) void renderPreview();
}

interface PaintSurface {
  canvas: HTMLCanvasElement;
  indicator: HTMLDivElement;
  /** Native pixel coords → write the pixel. */
  apply(x: number, y: number, mode: 'brush' | 'erase'): void;
  /** Optional guard — if it returns false, mousedown/move are no-ops (e.g. nothing selected). */
  ready(): boolean;
}

function eventToPixel(canvas: HTMLCanvasElement, ev: PointerEvent): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const cssX = ev.clientX - rect.left;
  const cssY = ev.clientY - rect.top;
  if (cssX < 0 || cssY < 0 || cssX >= rect.width || cssY >= rect.height) return null;
  const x = Math.floor((cssX / rect.width) * canvas.width);
  const y = Math.floor((cssY / rect.height) * canvas.height);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x, y };
}

function showIndicator(
  canvas: HTMLCanvasElement,
  indicator: HTMLDivElement,
  x: number,
  y: number,
  activeMode?: 'brush' | 'erase' | null,
): void {
  const rect = canvas.getBoundingClientRect();
  const cellW = rect.width / canvas.width;
  const cellH = rect.height / canvas.height;
  indicator.style.width = `${cellW}px`;
  indicator.style.height = `${cellH}px`;
  indicator.style.transform = `translate(${x * cellW}px, ${y * cellH}px)`;
  const mode = activeMode ?? paintTool?.state.mode ?? 'brush';
  if (mode === 'brush') {
    indicator.style.background = paintTool?.state.color ?? '#ff0000';
  } else {
    indicator.style.background = 'transparent';
  }
  indicator.hidden = false;
}

function bindPaintSurface(surface: PaintSurface): void {
  const { canvas, indicator } = surface;

  // Suppress context menu so right-click can be used as erase.
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  let activePointerId: number | null = null;
  let activeMode: 'brush' | 'erase' | null = null;
  let stroke: Set<string> | null = null;

  function paintAtPixel(x: number, y: number): void {
    if (!activeMode) return;
    const key = `${x},${y}`;
    if (stroke && stroke.has(key)) return;
    if (stroke) stroke.add(key);
    surface.apply(x, y, activeMode);
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!surface.ready()) return;
    if (ev.button !== 0 && ev.button !== 2) return;
    activeMode = ev.button === 2 ? 'erase' : 'brush';
    activePointerId = ev.pointerId;
    stroke = new Set();
    canvas.setPointerCapture(ev.pointerId);
    const px = eventToPixel(canvas, ev);
    if (px) {
      showIndicator(canvas, indicator, px.x, px.y, activeMode);
      paintAtPixel(px.x, px.y);
    }
    ev.preventDefault();
  });

  canvas.addEventListener('pointermove', (ev) => {
    const px = eventToPixel(canvas, ev);
    if (!px) {
      if (activePointerId === null) indicator.hidden = true;
      return;
    }
    showIndicator(canvas, indicator, px.x, px.y, activeMode);
    if (activePointerId === ev.pointerId) {
      paintAtPixel(px.x, px.y);
    }
  });

  function endStroke(ev: PointerEvent): void {
    if (activePointerId === ev.pointerId) {
      try { canvas.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      activePointerId = null;
      activeMode = null;
      stroke = null;
    }
  }

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', (ev) => {
    if (activePointerId === null) {
      indicator.hidden = true;
    }
    // Don't end stroke on leave — pointer capture keeps moves flowing if user drags out then back in.
    // pointerup outside still fires because of capture.
    void ev;
  });
}

async function saveKitToServer(kit: KitConfig): Promise<void> {
  // Vite exposes import.meta.env.DEV at build time.
  const isDev = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ?? false;
  const json = JSON.stringify(kit, null, 2) + '\n';
  if (isDev) {
    let response: Response;
    try {
      response = await fetch(`/api/save-kit/${encodeURIComponent(kit.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      });
    } catch (err) {
      showToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return;
    }
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const data = (await response.json()) as { error?: string };
        if (data.error) detail = data.error;
      } catch {
        // ignore
      }
      showToast(`Save failed (${response.status}): ${detail}`, 'error');
      return;
    }
    showToast(`Saved ${kit.id}.json`, 'success');
  } else {
    // Built/preview mode — trigger a download.
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kit.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${kit.id}.json`, 'success');
  }
}

async function loadRegistry(): Promise<void> {
  const response = await fetch(REGISTRY_URL);
  if (!response.ok) {
    throw new Error(`Failed to load component registry: ${response.statusText}`);
  }
  const data = (await response.json()) as ComponentRegistry;
  for (const entry of data.components) {
    componentsById.set(entry.id, entry);
    for (const facing of entry.facings) {
      ensureFacingOption(facing);
    }
  }
  if (!componentsById.size) {
    throw new Error('Component registry is empty.');
  }
}

async function loadKits(): Promise<void> {
  const response = await fetch(KIT_INDEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to load kit index: ${response.statusText}`);
  }
  const kitIds = (await response.json()) as string[];
  kitSelect.innerHTML = '';
  for (const id of kitIds) {
    const kitResponse = await fetch(`/components/kits/${id}.json`);
    if (!kitResponse.ok) {
      console.warn(`Skipping kit ${id}: ${kitResponse.statusText}`);
      continue;
    }
    const kit = (await kitResponse.json()) as KitConfig;
    kitsById.set(kit.id, kit);
    const opt = document.createElement('option');
    opt.value = kit.id;
    opt.textContent = kit.label;
    kitSelect.appendChild(opt);
  }
  if (!kitSelect.options.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— No Kits —';
    kitSelect.appendChild(opt);
  }
}

function initEvents() {
  facingSelect.addEventListener('change', () => {
    setFacing(facingSelect.value);
    const kit = currentKitId ? kitsById.get(currentKitId) : null;
    const newFacing = currentFacing;
    if (kit && !kit.facings[newFacing]) {
      const available = Object.keys(kit.facings);
      if (available.length) {
        setFacing(available[0]);
      }
    }
    if (currentKitId) {
      applyKitDefaults(currentKitId, currentFacing);
    }
    rebuildComponentGroups();
    void renderPreview();
  });

  kitSelect.addEventListener('change', () => {
    const kitId = kitSelect.value || null;
    setKit(kitId);
    if (kitId) {
      const kit = kitsById.get(kitId);
      if (kit) {
        if (!kit.facings[currentFacing]) {
          const available = Object.keys(kit.facings);
          if (available.length) {
            setFacing(available[0]);
          }
        }
      }
    }
    applyKitDefaults(currentKitId, currentFacing);
    rebuildComponentGroups();
    updateEditStrip();
    void renderWeaponSourceGrid();
    void renderPreview();
    unitPicker?.setActiveKit(kitId);
    poseStrip?.setPoses(buildPoseStrip());
    poseStrip?.setActivePose(currentPose);
    refreshVariantsStrip();
    refreshPaintLayers();
  });

  poseSelect.addEventListener('change', () => {
    selectedVariantIdx = 0;
    currentPose = poseSelect.value;
    updateEditStrip();
    updateSourceGridHighlight();
    void renderPreview();
    poseStrip?.setActivePose(currentPose);
    refreshVariantsStrip();
    refreshPaintLayers();
  });

  if (regimentSelect) {
    regimentSelect.addEventListener('change', () => {
      const next = regiments.find((r) => r.id === regimentSelect.value);
      if (next) {
        currentRegiment = next;
        void renderPreview();
        unitPicker?.refresh();
        poseStrip?.refresh();
        refreshVariantsStrip();
        refreshPaintLayers();
        paintPalette?.setRegiment(currentRegiment);
      }
    });
  }

  resetButton.addEventListener('click', () => {
    applyKitDefaults(currentKitId, currentFacing);
    rebuildComponentGroups();
    void renderPreview();
  });

  for (const { facing, cell } of gridCells) {
    cell.addEventListener('click', () => {
      setFacing(facing);
      selectedVariantIdx = 0;
      if (currentKitId) {
        applyKitDefaults(currentKitId, currentFacing);
      }
      rebuildComponentGroups();
      refreshVariantsStrip();
      refreshPaintLayers();
      updateEditStrip();
      updateSourceGridHighlight();
      void renderPreview();
    });
  }

  const facingPixelHover = document.getElementById('facing-pixel-hover') as HTMLDivElement;
  const weaponPixelHover = document.getElementById('weapon-pixel-hover') as HTMLDivElement;

  bindPaintSurface({
    canvas: facingPreviewCanvas,
    indicator: facingPixelHover,
    ready: () => Boolean(currentKitId),
    apply: (x, y, mode) => {
      if (!currentKitId || !paintTool) return;
      paintTool.paintAt(currentKitId, currentPose, currentFacing, x, y, mode);
    },
  });

  bindPaintSurface({
    canvas: weaponPreviewCanvas,
    indicator: weaponPixelHover,
    ready: () => {
      const v = getSelectedVariant();
      return Boolean(currentKitId && v);
    },
    apply: (x, y, mode) => {
      const v = getSelectedVariant();
      if (!currentKitId || !v || !paintTool) return;
      const kit = kitsById.get(currentKitId);
      const layerPrefix = kit?.weapon?.layerPrefix;
      if (!layerPrefix) return;
      const componentId = `${layerPrefix}-${facingToSuffix(v.src)}`;
      paintWeaponSourcePixel(currentKitId, v.src, componentId, x, y, mode);
    },
  });

  // Source-grid clicks: rebind the selected variant to a new source facing.
  for (const { facing, cell } of sourceGridCells) {
    cell.addEventListener('click', () => {
      if (cell.classList.contains('disabled')) return;
      const v = getSelectedVariant();
      if (!v) {
        showToast('Select a variant first', 'info');
        return;
      }
      v.src = facing;
      delete v.transform;
      updateEditStrip();
      updateSourceGridHighlight();
      refreshVariantsStrip();
      void renderPreview();
    });
  }

  // Edit-strip buttons.
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

  btnDeleteVariant?.addEventListener('click', () => {
    if (!currentKitId) return;
    const kit = kitsById.get(currentKitId);
    if (!kit) return;
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

  btnSaveKit?.addEventListener('click', () => {
    if (!currentKitId) return;
    const kit = kitsById.get(currentKitId);
    if (!kit) return;
    void saveKitToServer(kit);
  });

  // Keyboard nudges — active only while a variant is selected, and not while
  // focus is on a form control.
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
}

async function main() {
  await loadRegistry();
  await loadKits();
  pixelEdits = await loadPixelEdits();

  regiments = await loadRegiments();
  if (regimentSelect) {
    regimentSelect.innerHTML = '';
    for (const reg of regiments) {
      const opt = document.createElement('option');
      opt.value = reg.id;
      opt.textContent = reg.label;
      regimentSelect.appendChild(opt);
    }
  }
  currentRegiment = regiments[0] ?? null;
  if (regimentSelect && currentRegiment) {
    regimentSelect.value = currentRegiment.id;
  }

  // Default facing to first option if not present.
  if (!Array.from(facingSelect.options).some((opt) => opt.value === currentFacing)) {
    if (facingSelect.options.length) {
      currentFacing = facingSelect.options[0].value;
    }
  }
  facingSelect.value = currentFacing;

  if (kitSelect.options.length) {
    const initialKitId = kitSelect.options[0].value || null;
    if (initialKitId) {
      setKit(initialKitId);
      const kit = kitsById.get(initialKitId);
      if (kit) {
        if (!kit.facings[currentFacing]) {
          const available = Object.keys(kit.facings);
          if (available.length) {
            currentFacing = available[0];
            facingSelect.value = currentFacing;
          }
        }
      }
      applyKitDefaults(initialKitId, currentFacing);
    }
  }

  rebuildComponentGroups();

  // Unit picker — top-left thumbnail + popover for switching kits.
  function buildPickerKits(): UnitPickerKit[] {
    const out: UnitPickerKit[] = [];
    for (const kit of kitsById.values()) {
      const sFacing = kit.facings['S'];
      const sLayers = sFacing?.layers ?? [];
      let weapon: UnitPickerKit['weapon'];
      if (kit.weapon?.layerPrefix) {
        const sPoseEntry = kit.poses?.idle?.['S'];
        let sOrientation: WeaponOrientation | undefined;
        if (sPoseEntry && !Array.isArray(sPoseEntry)) {
          sOrientation = (sPoseEntry as { weapons?: WeaponOrientation[] }).weapons?.[0];
        }
        weapon = { layerPrefix: kit.weapon.layerPrefix, sOrientation };
      }
      out.push({ id: kit.id, label: kit.label, sLayers, weapon });
    }
    return out;
  }
  unitPicker = mountUnitPicker({
    components: componentsById,
    componentBaseUrl: COMPONENT_BASE_URL,
    getRegiment: () => currentRegiment,
    getLayerEdits: getLayerEditsAt,
    onPick: (kitId) => {
      setKit(kitId);
      const kit = kitsById.get(kitId);
      if (kit && !kit.facings[currentFacing]) {
        const available = Object.keys(kit.facings);
        if (available.length) setFacing(available[0]);
      }
      applyKitDefaults(currentKitId, currentFacing);
      rebuildComponentGroups();
      updateEditStrip();
      void renderWeaponSourceGrid();
      void renderPreview();
      unitPicker?.setActiveKit(kitId);
      poseStrip?.setPoses(buildPoseStrip());
      poseStrip?.setActivePose(currentPose);
      refreshVariantsStrip();
      refreshPaintLayers();
      paintPalette?.setRegiment(currentRegiment);
    },
  });
  unitPicker.setKits(buildPickerKits());
  unitPicker.setActiveKit(currentKitId);

  poseStrip = mountPoseStrip({
    components: componentsById,
    componentBaseUrl: COMPONENT_BASE_URL,
    getRegiment: () => currentRegiment,
    getLayerEdits: getLayerEditsAt,
    onPick: (name) => {
      currentPose = name;
      poseSelect.value = name;
      selectedVariantIdx = 0;
      updateEditStrip();
      updateSourceGridHighlight();
      poseStrip?.setActivePose(name);
      refreshVariantsStrip();
      refreshPaintLayers();
      void renderPreview();
    },
  });
  poseStrip.setPoses(buildPoseStrip());
  poseStrip.setActivePose(currentPose);

  variantsStrip = mountVariantsStrip({
    components: componentsById,
    componentBaseUrl: COMPONENT_BASE_URL,
    getRegiment: () => currentRegiment,
    getLayerEdits: (componentId) =>
      currentKitId ? getLayerEditsAt(currentKitId, currentPose, currentFacing, componentId) : [],
    onPickVariant: (idx) => {
      selectedVariantIdx = idx;
      refreshVariantsStrip();
      updateEditStrip();
      updateSourceGridHighlight();
      void renderPreview();
    },
    onAddVariant: () => {
      if (!currentKitId) return;
      const kit = kitsById.get(currentKitId);
      if (!kit) return;
      const list = ensurePoseEntryWeapons(kit, currentPose, currentFacing);
      list.push({ src: currentFacing, x: 0, y: 0, rot: 0 });
      selectedVariantIdx = list.length - 1;
      refreshVariantsStrip();
      void renderPreview();
    },
  });
  refreshVariantsStrip();

  paintTool = mountPaintTool({
    getTree: () => pixelEdits,
    onChange: () => void renderPreview(),
    showToast,
  });
  refreshPaintLayers();

  paintPalette = mountPaintPalette({
    onPick: (hex) => {
      // Sync the custom color picker AND the paint tool's state.
      const colorInput = document.getElementById('paint-color-input') as HTMLInputElement | null;
      if (colorInput) colorInput.value = hex;
      if (paintTool) paintTool.state.color = hex;
    },
  });
  paintPalette.setRegiment(currentRegiment);

  initEvents();
  updateEditStrip();
  await renderPreview();
  await renderWeaponSourceGrid();
}

void main().catch((err) => {
  console.error(err);
  infoCard.innerHTML = `<strong>Error:</strong> ${String(err)}`;
});
