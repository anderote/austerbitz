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
  colorInput.addEventListener('input', () => {
    state.color = colorInput.value;
  });
  layerSelect.addEventListener('change', () => {
    state.activeLayer = layerSelect.value || null;
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

  syncToolbarVisibility();

  return {
    state,
    setActiveLayers(layerIds) {
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
