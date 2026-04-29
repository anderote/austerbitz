import type { Regiment } from './regiments';

export interface PaintPaletteOptions {
  /** Called when a swatch is clicked. Receives the chosen hex color. */
  onPick: (hex: string) => void;
}

const MATERIAL_PALETTES: Array<{
  label: string;
  hint?: string;
  shades: string[];
}> = [
  { label: 'Wood',    hint: 'stock',     shades: ['#3d2614', '#6b4226', '#a06a3d'] },
  { label: 'Brass',   hint: 'fittings',  shades: ['#7a5a18', '#c89432', '#f4d36a'] },
  { label: 'Steel',   hint: 'blade',     shades: ['#4a4f5c', '#8a909d', '#cdd2dc'] },
  { label: 'Leather', hint: 'belt',      shades: ['#2a1808', '#5a3818', '#8a5e2e'] },
  { label: 'Skin',    hint: 'face',      shades: ['#d6a78c', '#a87858', '#5e3a25'] },
  { label: 'Mono',    hint: 'b/w',       shades: ['#0d0c10', '#7d7a78', '#f1eee5'] },
];

export function mountPaintPalette(opts: PaintPaletteOptions): {
  setRegiment(reg: Regiment | null): void;
  setActiveColor(hex: string): void;
} {
  const slots: Array<{ row: HTMLDivElement; key: 'primary' | 'secondary' | 'tertiary' }> = [
    { row: document.getElementById('palette-row-primary') as HTMLDivElement, key: 'primary' },
    { row: document.getElementById('palette-row-secondary') as HTMLDivElement, key: 'secondary' },
    { row: document.getElementById('palette-row-tertiary') as HTMLDivElement, key: 'tertiary' },
  ];

  let activeHex = '';
  const swatchEls: HTMLButtonElement[] = [];
  const materialSwatchEls: HTMLButtonElement[] = [];

  function rgbToHex(rgb: [number, number, number]): string {
    const c = (v: number) => v.toString(16).padStart(2, '0');
    return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
  }

  function shadesFor(rgb: [number, number, number]): [number, number, number][] {
    // Three shades: 60% (shadow), 100% (base), 130% (highlight, clamped).
    const scale = (factor: number): [number, number, number] => [
      Math.min(255, Math.round(rgb[0] * factor)),
      Math.min(255, Math.round(rgb[1] * factor)),
      Math.min(255, Math.round(rgb[2] * factor)),
    ];
    return [scale(0.6), scale(1.0), scale(1.3)];
  }

  function highlightActive(): void {
    for (const sw of swatchEls) {
      sw.classList.toggle('active', sw.dataset.hex === activeHex);
    }
    for (const sw of materialSwatchEls) {
      sw.classList.toggle('active', sw.dataset.hex === activeHex);
    }
  }

  function buildSwatchRow(
    swatchHost: HTMLDivElement,
    swatchHexes: readonly string[],
    target: HTMLButtonElement[] = swatchEls,
    titlePrefix?: string,
  ): void {
    swatchHost.innerHTML = '';
    for (const hex of swatchHexes) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'palette-swatch';
      sw.style.background = hex;
      sw.dataset.hex = hex;
      sw.title = titlePrefix ? `${titlePrefix} ${hex}` : hex;
      sw.addEventListener('click', () => {
        activeHex = hex;
        opts.onPick(hex);
        highlightActive();
      });
      swatchHost.appendChild(sw);
      target.push(sw);
    }
  }

  function render(reg: Regiment | null): void {
    swatchEls.length = 0;
    for (const slot of slots) {
      const swatchHost = slot.row.querySelector<HTMLDivElement>('.palette-row-swatches');
      if (!swatchHost) continue;
      swatchHost.innerHTML = '';
      if (!reg) continue;
      const baseRgb = reg[slot.key];
      const hexes = shadesFor(baseRgb).map(rgbToHex);
      buildSwatchRow(swatchHost, hexes, swatchEls, slot.key);
    }
    highlightActive();
  }

  // Build the materials section once on mount — it doesn't depend on regiment.
  const materialsHost = document.getElementById('palette-materials') as HTMLDivElement | null;
  if (materialsHost) {
    for (const mat of MATERIAL_PALETTES) {
      const row = document.createElement('div');
      row.className = 'palette-row';
      const label = document.createElement('span');
      label.className = 'palette-row-label';
      label.innerHTML = mat.hint
        ? `${mat.label} <em>(${mat.hint})</em>`
        : mat.label;
      const swatchHost = document.createElement('div');
      swatchHost.className = 'palette-row-swatches';
      row.append(label, swatchHost);
      materialsHost.appendChild(row);
      buildSwatchRow(swatchHost, mat.shades, materialSwatchEls, mat.label.toLowerCase());
    }
  }

  return {
    setRegiment(reg) { render(reg); },
    setActiveColor(hex) { activeHex = hex; highlightActive(); },
  };
}
