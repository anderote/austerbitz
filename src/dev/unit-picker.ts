import { renderCellInto, type ComponentEntry } from './cell-render';
import type { WeaponOrientation } from './weapon-rendering';
import type { PixelEdit } from './pixel-edits-overlay';
import type { Regiment } from './regiments';

export interface UnitPickerKit {
  id: string;
  label: string;
  /** Layer ids for the kit's S-facing rest pose (kit.facings.S.layers). */
  sLayers: string[];
  /** Optional weapon block + S-facing weapons[0] for the thumbnail. */
  weapon?: {
    layerPrefix: string;
    sOrientation?: WeaponOrientation;
  };
}

export interface UnitPickerOptions {
  components: ReadonlyMap<string, ComponentEntry>;
  componentBaseUrl: string;
  /** Lazy-read so regiment changes are reflected on `refresh()`. */
  getRegiment: () => Regiment | null;
  getLayerEdits: (kitId: string, pose: string, facing: string, componentId: string) => readonly PixelEdit[];
  onPick: (kitId: string) => void;
}

/**
 * Wire the unit thumbnail (top-left button) and the picker popover. Returns
 * setters for kit list / active kit, plus a `refresh()` to repaint the
 * thumbnail (e.g., after regiment changes).
 */
export function mountUnitPicker(opts: UnitPickerOptions): {
  setKits(kits: UnitPickerKit[]): void;
  setActiveKit(kitId: string | null): void;
  refresh(): void;
} {
  const thumbButton = document.getElementById('unit-thumb-button') as HTMLButtonElement;
  const thumbCanvas = document.getElementById('unit-thumb-canvas') as HTMLCanvasElement;
  const thumbLabel = document.getElementById('unit-thumb-label') as HTMLSpanElement;
  const thumbCtxOrNull = thumbCanvas.getContext('2d', { alpha: true });
  if (!thumbCtxOrNull) throw new Error('unit-picker: 2D context unavailable');
  const thumbCtx: CanvasRenderingContext2D = thumbCtxOrNull;
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
    thumbCtx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);
    void renderCellInto(thumbCtx, {
      layerIds: kit.sLayers,
      components: opts.components,
      componentBaseUrl: opts.componentBaseUrl,
      regiment: opts.getRegiment(),
      weapon: kit.weapon?.layerPrefix && kit.weapon.sOrientation
        ? { layerPrefix: kit.weapon.layerPrefix, orientation: kit.weapon.sOrientation }
        : undefined,
      layerEdits: (componentId) => opts.getLayerEdits(kit.id, 'idle', 'S', componentId),
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
          regiment: opts.getRegiment(),
          weapon: kit.weapon?.layerPrefix && kit.weapon.sOrientation
            ? { layerPrefix: kit.weapon.layerPrefix, orientation: kit.weapon.sOrientation }
            : undefined,
          layerEdits: (componentId) => opts.getLayerEdits(kit.id, 'idle', 'S', componentId),
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
