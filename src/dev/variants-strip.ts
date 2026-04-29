import { renderCellInto, type ComponentEntry } from './cell-render';
import type { PixelEdit } from './pixel-edits-overlay';
import type { Regiment } from './regiments';
import type { WeaponOrientation } from './weapon-rendering';

export interface VariantsStripOptions {
  components: ReadonlyMap<string, ComponentEntry>;
  componentBaseUrl: string;
  getRegiment: () => Regiment | null;
  getLayerEdits: (componentId: string) => readonly PixelEdit[];
  onPickVariant: (idx: number) => void;
  onAddVariant: () => void;
}

export function mountVariantsStrip(opts: VariantsStripOptions): {
  setContent(
    layerIds: string[],
    weaponLayerPrefix: string | null,
    variants: WeaponOrientation[],
    activeIdx: number,
  ): void;
} {
  const strip = document.getElementById('variants-strip') as HTMLDivElement;

  function render(
    layerIds: string[],
    layerPrefix: string | null,
    variants: WeaponOrientation[],
    activeIdx: number,
  ): void {
    strip.innerHTML = '';
    variants.forEach((orientation, idx) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'variant-cell';
      if (idx === activeIdx) cell.classList.add('active');

      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 36;
      const cctx = c.getContext('2d', { alpha: true });
      if (cctx) {
        cctx.imageSmoothingEnabled = false;
        void renderCellInto(cctx, {
          layerIds,
          components: opts.components,
          componentBaseUrl: opts.componentBaseUrl,
          regiment: opts.getRegiment(),
          weapon: layerPrefix ? { layerPrefix, orientation } : undefined,
          layerEdits: opts.getLayerEdits,
        }).catch((err) => console.warn('[variants-strip]', err));
      }

      const idxLabel = document.createElement('span');
      idxLabel.className = 'variant-idx';
      idxLabel.textContent = `v${idx}`;

      cell.append(c, idxLabel);
      cell.addEventListener('click', () => opts.onPickVariant(idx));
      strip.appendChild(cell);
    });

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
