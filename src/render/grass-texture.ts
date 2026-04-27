import { clamp } from '../util/math';

type RGB = [number, number, number];

// Tight green palette — all four stops are close shades of grass green so the
// field reads as mostly uniform with subtle texture, no visible dry/dirt
// patches.
const SHADOW: RGB = [72, 96, 52];
const MID:    RGB = [86, 114, 62];
const BRIGHT: RGB = [102, 128, 72];
const DRY:    RGB = [115, 136, 78];

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// 32-bit integer hash, returns [0, 1).
function hash32(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Seamless 2D value noise. Lattice indices wrap modulo `period`.
function valueNoise(px: number, py: number, period: number, seed: number): number {
  const fx = px - Math.floor(px);
  const fy = py - Math.floor(py);
  const x0 = ((Math.floor(px) % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((Math.floor(py) % period) + period) % period;
  const y1 = (y0 + 1) % period;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v00 = hash32(x0, y0, seed);
  const v10 = hash32(x1, y0, seed);
  const v01 = hash32(x0, y1, seed);
  const v11 = hash32(x1, y1, seed);
  return v00 * (1 - ux) * (1 - uy)
       + v10 * ux * (1 - uy)
       + v01 * (1 - ux) * uy
       + v11 * ux * uy;
}

// FBM with `octaves` doublings of frequency, normalised to ~[0, 1].
function fbm(px: number, py: number, period: number, seed: number, octaves: number): number {
  let v = 0;
  let amp = 1;
  let freq = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise(px * freq, py * freq, period * freq, seed + i * 991);
    total += amp;
    freq *= 2;
    amp *= 0.5;
  }
  return v / total;
}

// Seamless Worley F1: distance to nearest jittered point + a per-cell hash.
function worley(x: number, y: number, period: number, seed: number): { dist: number; hash: number } {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let minDistSq = Infinity;
  let minHash = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx;
      const iy = cy + dy;
      const wx = ((ix % period) + period) % period;
      const wy = ((iy % period) + period) % period;
      const jx = hash32(wx, wy, seed);
      const jy = hash32(wx, wy, seed + 7919);
      const ddx = (ix + jx) - x;
      const ddy = (iy + jy) - y;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < minDistSq) {
        minDistSq = d2;
        minHash = hash32(wx, wy, seed + 13371337);
      }
    }
  }
  return { dist: Math.sqrt(minDistSq), hash: minHash };
}

// Hard-quantised 4-stop palette with thin transition bands. Most pixels land
// on a discrete colour rather than a smooth interpolation — that's what
// makes the result read as grass rather than as a gradient.
function paletteAt(t: number): RGB {
  if (t < 0.28) return SHADOW;
  if (t < 0.32) return lerpRGB(SHADOW, MID, (t - 0.28) / 0.04);
  if (t < 0.62) return MID;
  if (t < 0.66) return lerpRGB(MID, BRIGHT, (t - 0.62) / 0.04);
  if (t < 0.83) return BRIGHT;
  if (t < 0.86) return lerpRGB(BRIGHT, DRY, (t - 0.83) / 0.03);
  return DRY;
}

/**
 * Seeded, seamlessly-tileable grass texture.
 *
 * Construction:
 *   1. Domain-warped 4-octave FBM produces a slow "colour field" (the
 *      Inigo Quilez 2-level warp recipe — this kills the blobby look).
 *   2. A Worley/cellular field adds ~2m grass-clump structure with a
 *      per-cell hash that biases each cell into a different palette stop.
 *   3. The combined value is quantised through a 4-stop multimodal palette
 *      (~28/50/17/5% shadow/mid/bright/dry).
 *   4. A per-pixel hash adds sub-pixel grass-blade brightness variance.
 */
export function generateGrassTile(size = 512, seed = 7): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;

      // Domain-warped 4-octave FBM, period 4 lattice cells across the tile.
      const wx = u * 4;
      const wy = v * 4;
      const warpX = fbm(wx,       wy,       4, seed + 17, 2);
      const warpY = fbm(wx + 5.2, wy + 1.3, 4, seed + 31, 2);
      const field = fbm(wx + 2.0 * warpX, wy + 2.0 * warpY, 4, seed, 4);

      // Clumps: 32 cells across the tile, so ~2m clumps at 64m tile coverage.
      const w = worley(u * 32, v * 32, 32, seed + 53);

      // Warped FBM dominates so the field reads as mostly uniform; cell
      // hash adds a small bias so cells aren't identical.
      let t = 0.80 * field + 0.15 * w.hash + 0.05 * (1 - w.dist);
      t = clamp(t, 0, 1);

      let [r, g, b] = paletteAt(t);

      // Subtle per-pixel grain — small brightness jitter, no visible blades.
      const grain = hash32(px, py, seed + 7777);
      const bright = 0.95 + 0.10 * grain;
      r *= bright;
      g *= bright;
      b *= bright;

      const i = (py * size + px) * 4;
      pixels[i + 0] = Math.floor(clamp(r, 0, 255));
      pixels[i + 1] = Math.floor(clamp(g, 0, 255));
      pixels[i + 2] = Math.floor(clamp(b, 0, 255));
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}
