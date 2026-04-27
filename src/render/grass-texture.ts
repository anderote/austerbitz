import { createRng } from '../util/rng';

/** Generates a tileable RGBA8 buffer of green pixel noise. */
export function generateGrassTile(size = 32, seed = 7): Uint8Array {
  const rng = createRng(seed);
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = rng.next();
      const r = Math.floor(60 + v * 30);
      const g = Math.floor(110 + v * 60);
      const b = Math.floor(50 + v * 25);
      pixels[i + 0] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}
