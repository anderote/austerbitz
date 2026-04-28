import { clamp } from '../util/math';
import { mulberry32 } from '../map/prng';

export const TREE_W = 32;
export const TREE_H = 48;
export const TREE_VARIANTS = 6;
export const TREE_ATLAS_W = TREE_W * TREE_VARIANTS;
export const TREE_ATLAS_H = TREE_H;

const CANOPY_DEEP:  [number, number, number] = [38,  58, 22];
const CANOPY_MID:   [number, number, number] = [62,  92, 34];
const CANOPY_HIGH:  [number, number, number] = [104, 144, 48];
const CANOPY_DRY:   [number, number, number] = [136, 158, 64];
const TRUNK_DARK:   [number, number, number] = [42,  28, 16];
const TRUNK_MID:    [number, number, number] = [70,  48, 26];

interface VariantSpec {
  shape: 'round' | 'tall' | 'wide' | 'conifer';
  canopyW: number;       // ratio of TREE_W
  canopyH: number;       // ratio of TREE_H (excluding trunk space)
  trunkW: number;        // px
  trunkH: number;        // px
  preferDry?: boolean;
}

const VARIANTS: VariantSpec[] = [
  { shape: 'round',   canopyW: 0.78, canopyH: 0.66, trunkW: 4, trunkH: 8 },
  { shape: 'wide',    canopyW: 0.92, canopyH: 0.55, trunkW: 4, trunkH: 7 },
  { shape: 'tall',    canopyW: 0.55, canopyH: 0.78, trunkW: 3, trunkH: 7 },
  { shape: 'conifer', canopyW: 0.62, canopyH: 0.82, trunkW: 3, trunkH: 6 },
  { shape: 'round',   canopyW: 0.62, canopyH: 0.55, trunkW: 3, trunkH: 6, preferDry: true },
  { shape: 'conifer', canopyW: 0.78, canopyH: 0.78, trunkW: 4, trunkH: 7 },
];

function setPixel(px: Uint8Array, x: number, y: number, rgb: [number, number, number]) {
  const i = (y * TREE_ATLAS_W + x) * 4;
  px[i + 0] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
}

function paletteFor(t: number, preferDry: boolean): [number, number, number] {
  if (preferDry) {
    if (t < 0.30) return CANOPY_DEEP;
    if (t < 0.55) return CANOPY_MID;
    if (t < 0.85) return CANOPY_DRY;
    return CANOPY_HIGH;
  }
  if (t < 0.30) return CANOPY_DEEP;
  if (t < 0.70) return CANOPY_MID;
  if (t < 0.95) return CANOPY_HIGH;
  return CANOPY_DRY;
}

function inCanopy(
  shape: VariantSpec['shape'],
  dx: number, dy: number,         // offset from canopy centre, normalised −1..+1 within bbox
): boolean {
  switch (shape) {
    case 'round':
      return dx * dx + dy * dy <= 1.0;
    case 'wide':
      // squashed ellipse, slight bottom-flatten
      return dx * dx * 0.85 + dy * dy * 1.20 <= 1.0;
    case 'tall':
      return dx * dx * 1.30 + dy * dy * 0.80 <= 1.0;
    case 'conifer': {
      // triangle silhouette: |dx| <= 1 - (dy + 1) / 2
      const t = (dy + 1) * 0.5;          // 0 at top, 1 at bottom
      const wAtY = 0.15 + 0.85 * t;      // narrow tip, wide base
      return Math.abs(dx) <= wAtY;
    }
  }
}

/**
 * 6 vertical tree silhouettes packed left-to-right into a 192×48 atlas. Each
 * tree is anchored at the bottom-centre (the trunk base). Variants alternate
 * between rounded deciduous puffs and triangular conifers; one variant biases
 * toward dry/yellow tones for autumnal variety.
 */
export function generateTreeAtlas(seed = 29): Uint8Array {
  const px = new Uint8Array(TREE_ATLAS_W * TREE_ATLAS_H * 4);

  for (let v = 0; v < TREE_VARIANTS; v++) {
    const spec = VARIANTS[v]!;
    const r = mulberry32(seed + v * 7919);
    const baseX = v * TREE_W;
    const trunkBaseY = TREE_H - 1;

    // --- Canopy ---
    const canopyHpx = Math.floor(spec.canopyH * (TREE_H - spec.trunkH));
    const canopyWpx = Math.floor(spec.canopyW * TREE_W);
    const canopyCx = TREE_W / 2;
    const canopyTop = 1;
    const canopyBottom = canopyTop + canopyHpx;
    const canopyCy = (canopyTop + canopyBottom) / 2;
    const halfW = canopyWpx / 2;
    const halfH = canopyHpx / 2;

    for (let y = canopyTop; y <= canopyBottom; y++) {
      for (let x = 0; x < TREE_W; x++) {
        const dx = (x + 0.5 - canopyCx) / halfW;
        const dy = (y + 0.5 - canopyCy) / halfH;
        if (!inCanopy(spec.shape, dx, dy)) continue;
        // Light from upper-left → biases palette pick.
        const light = clamp((-dx - dy + 0.5) * 0.5 + 0.5, 0, 1);
        const noise = r();
        const t = clamp(0.55 * light + 0.30 * noise + 0.15 * (1 - Math.hypot(dx, dy)), 0, 1);
        const col = paletteFor(t, spec.preferDry === true);
        const g = 0.92 + r() * 0.16;
        setPixel(px, baseX + x, y, [
          Math.floor(clamp(col[0] * g, 0, 255)),
          Math.floor(clamp(col[1] * g, 0, 255)),
          Math.floor(clamp(col[2] * g, 0, 255)),
        ]);
      }
    }

    // --- Trunk ---
    const trunkX0 = Math.floor(canopyCx - spec.trunkW / 2);
    const trunkY0 = trunkBaseY - spec.trunkH + 1;
    for (let y = trunkY0; y <= trunkBaseY; y++) {
      for (let x = trunkX0; x < trunkX0 + spec.trunkW; x++) {
        if (x < 0 || x >= TREE_W) continue;
        // Left edge slightly darker (light from upper-left).
        const isLeft = (x === trunkX0);
        const col = isLeft ? TRUNK_DARK : TRUNK_MID;
        const g = 0.88 + r() * 0.18;
        setPixel(px, baseX + x, y, [
          Math.floor(clamp(col[0] * g, 0, 255)),
          Math.floor(clamp(col[1] * g, 0, 255)),
          Math.floor(clamp(col[2] * g, 0, 255)),
        ]);
      }
    }
  }
  return px;
}
