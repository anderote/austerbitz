import { clamp } from '../util/math';
import { mulberry32, randInt, randRange } from '../map/prng';

export const TUFT_W = 16;
export const TUFT_H = 20;
export const TUFT_VARIANTS = 4;
export const TUFT_ATLAS_W = TUFT_W * TUFT_VARIANTS;
export const TUFT_ATLAS_H = TUFT_H;
const FOOT_Y = TUFT_H - 1;

const BLADE_DARK:   [number, number, number] = [54, 78, 32];
const BLADE_MID:    [number, number, number] = [78, 110, 42];
const BLADE_BRIGHT: [number, number, number] = [120, 160, 60];
const BLADE_DRY:    [number, number, number] = [148, 168, 78];

function setPixel(px: Uint8Array, atlasX: number, y: number, rgb: [number, number, number]) {
  const i = (y * TUFT_ATLAS_W + atlasX) * 4;
  px[i + 0] = rgb[0];
  px[i + 1] = rgb[1];
  px[i + 2] = rgb[2];
  px[i + 3] = 255;
}

/**
 * 4 tufts of pixel-art grass, packed left-to-right into a 64×20 atlas. Each
 * tuft is a small bundle of 1-pixel-wide vertical blades anchored at the
 * bottom-center (the "foot"). Variants differ in blade count, heights, and
 * which palette stops they prefer.
 */
export function generateTuftAtlas(seed = 23): Uint8Array {
  const px = new Uint8Array(TUFT_ATLAS_W * TUFT_ATLAS_H * 4);

  for (let v = 0; v < TUFT_VARIANTS; v++) {
    const r = mulberry32(seed + v * 7919);
    const bladeCount = randInt(r, 5, 8);
    for (let b = 0; b < bladeCount; b++) {
      // Blade x within the tuft (0..TUFT_W-1), biased toward the centre.
      const xJitter = (randRange(r, 0, 1) + randRange(r, 0, 1)) * 0.5; // triangular
      const bx = Math.floor(2 + xJitter * (TUFT_W - 4));
      const height = randInt(r, 9, TUFT_H - 2);
      const lean = randInt(r, -1, 1); // tip drifts ±1 px
      // Pick a primary palette stop.
      const t = r();
      let primary: [number, number, number];
      if (t < 0.45)      primary = BLADE_MID;
      else if (t < 0.78) primary = BLADE_DARK;
      else if (t < 0.95) primary = BLADE_BRIGHT;
      else               primary = BLADE_DRY;

      // Walk from foot upward, drifting x by `lean` over the blade's height.
      // Each blade is 2 px wide (main column + a darker shadow column) so it
      // remains visible when the tuft renders smaller than its native size.
      for (let h = 0; h < height; h++) {
        const t01 = h / Math.max(1, height - 1);
        const x = bx + Math.round(lean * t01);
        const y = FOOT_Y - h;
        if (x < 0 || x >= TUFT_W) continue;
        let col = primary;
        if (t01 > 0.85 && primary !== BLADE_DRY) col = BLADE_BRIGHT;
        else if (t01 < 0.15) col = BLADE_DARK;
        const g = 0.92 + r() * 0.16;
        setPixel(px, v * TUFT_W + x, y, [
          Math.floor(clamp(col[0] * g, 0, 255)),
          Math.floor(clamp(col[1] * g, 0, 255)),
          Math.floor(clamp(col[2] * g, 0, 255)),
        ]);
        // Shadow column to the right for thickness; only if cell is empty.
        const sx = x + 1;
        if (sx < TUFT_W) {
          const idx = (y * TUFT_ATLAS_W + (v * TUFT_W + sx)) * 4 + 3;
          if (px[idx] === 0) {
            const shadow = BLADE_DARK;
            setPixel(px, v * TUFT_W + sx, y, [
              Math.floor(clamp(shadow[0] * g, 0, 255)),
              Math.floor(clamp(shadow[1] * g, 0, 255)),
              Math.floor(clamp(shadow[2] * g, 0, 255)),
            ]);
          }
        }
      }
    }
  }
  return px;
}
