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
  /** Called whenever the active layer changes (user click or programmatic default). */
  onLayerChange?: (layerId: string | null) => void;
  showToast: (msg: string, kind?: 'success' | 'error' | 'info') => void;
}

/**
 * Mounts the paint toolbar UI elements and returns a state handle plus a
 * `paintAt` function the caller wires to canvas clicks. Paint is always-on —
 * there is no toggle.
 */
export function mountPaintTool(opts: PaintToolOptions): {
  state: PaintToolState;
  /**
   * Replace the layer list. `preferredId` (if present in `layerIds`) becomes
   * the active layer when the prior selection is no longer valid.
   */
  setActiveLayers(layerIds: string[], preferredId?: string | null): void;
  setActiveLayer(layerId: string | null): void;
  isEnabled(): boolean;
  /** Paint one pixel at the given canvas coords for (kit, pose, facing). */
  paintAt(
    kit: string,
    pose: string,
    facing: string,
    x: number,
    y: number,
    modeOverride?: 'brush' | 'erase',
  ): void;
} {
  const colorInput = document.getElementById('paint-color-input') as HTMLInputElement;
  const layerList = document.getElementById('paint-layer-list') as HTMLDivElement;
  const saveBtn = document.getElementById('btn-save-edits') as HTMLButtonElement;
  const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="paint-mode"]');

  const state: PaintToolState = {
    enabled: true,
    mode: 'brush',
    color: colorInput.value,
    activeLayer: null,
  };

  // The set of currently-displayed layer ids and which one is the weapon (used
  // for the ⚔ marker via the .is-weapon class).
  let weaponLayerId: string | null = null;

  function highlight(): void {
    for (const child of Array.from(layerList.children)) {
      const el = child as HTMLElement;
      const id = el.dataset.layerId ?? '';
      el.classList.toggle('active', id === state.activeLayer);
    }
  }

  function selectLayer(id: string | null): void {
    state.activeLayer = id;
    highlight();
    opts.onLayerChange?.(id);
  }

  colorInput.addEventListener('input', () => {
    state.color = colorInput.value;
  });
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

  return {
    state,
    setActiveLayers(layerIds, preferredId) {
      const prior = state.activeLayer;
      weaponLayerId = preferredId ?? null;
      layerList.innerHTML = '';
      for (const id of layerIds) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'paint-layer-item';
        if (id === weaponLayerId) item.classList.add('is-weapon');
        item.dataset.layerId = id;
        item.textContent = id;
        item.addEventListener('click', () => selectLayer(id));
        layerList.appendChild(item);
      }
      let next: string | null;
      if (prior && layerIds.includes(prior)) {
        next = prior;
      } else if (preferredId && layerIds.includes(preferredId)) {
        next = preferredId;
      } else {
        next = layerIds[0] ?? null;
      }
      selectLayer(next);
    },
    setActiveLayer(layerId) {
      selectLayer(layerId);
    },
    isEnabled() { return true; },
    paintAt(kit, pose, facing, x, y, modeOverride) {
      if (!state.enabled || !state.activeLayer) return;
      const mode = modeOverride ?? state.mode;
      const color = mode === 'erase' ? 'clear' : state.color;
      setPixel(opts.getTree(), kit, pose, facing, state.activeLayer, { x, y, color });
      opts.onChange();
    },
  };
}
