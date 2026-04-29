/**
 * 5×7 pixel-font digit atlas baked into a single R8 GL texture.
 *
 * Glyphs are packed horizontally: 10 digits × 5 px = 50 px wide, 7 px tall.
 * The bitmaps are hand-defined as `Uint8Array(35)` per digit (0 = off, 1 = on),
 * row-major top-to-bottom. Sampling uses `gl.NEAREST` so the atlas reads
 * crisply at any zoom level — no smoothing, hard edges, pixel-art.
 */

export const GLYPH_W = 5;
export const GLYPH_H = 7;
export const GLYPH_COUNT = 10;
export const ATLAS_W = GLYPH_W * GLYPH_COUNT;
export const ATLAS_H = GLYPH_H;

// Each row is one scanline of the 5×7 cell, top to bottom.
// Format: 5-character strings of 'X' (on) and '.' (off) for readability;
// converted to Uint8Array on module load.
const DIGIT_ART: readonly (readonly string[])[] = [
  // 0
  [
    '.XXX.',
    'X...X',
    'X..XX',
    'X.X.X',
    'XX..X',
    'X...X',
    '.XXX.',
  ],
  // 1
  [
    '..X..',
    '.XX..',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    '.XXX.',
  ],
  // 2
  [
    '.XXX.',
    'X...X',
    '....X',
    '...X.',
    '..X..',
    '.X...',
    'XXXXX',
  ],
  // 3
  [
    'XXXX.',
    '....X',
    '....X',
    '.XXX.',
    '....X',
    '....X',
    'XXXX.',
  ],
  // 4
  [
    '...X.',
    '..XX.',
    '.X.X.',
    'X..X.',
    'XXXXX',
    '...X.',
    '...X.',
  ],
  // 5
  [
    'XXXXX',
    'X....',
    'XXXX.',
    '....X',
    '....X',
    'X...X',
    '.XXX.',
  ],
  // 6
  [
    '..XX.',
    '.X...',
    'X....',
    'XXXX.',
    'X...X',
    'X...X',
    '.XXX.',
  ],
  // 7
  [
    'XXXXX',
    '....X',
    '...X.',
    '..X..',
    '.X...',
    '.X...',
    '.X...',
  ],
  // 8
  [
    '.XXX.',
    'X...X',
    'X...X',
    '.XXX.',
    'X...X',
    'X...X',
    '.XXX.',
  ],
  // 9
  [
    '.XXX.',
    'X...X',
    'X...X',
    '.XXXX',
    '....X',
    '...X.',
    '.XX..',
  ],
];

function bake(): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let g = 0; g < GLYPH_COUNT; g++) {
    const rows = DIGIT_ART[g]!;
    if (rows.length !== GLYPH_H) {
      throw new Error(`Digit ${g} has ${rows.length} rows; expected ${GLYPH_H}`);
    }
    const buf = new Uint8Array(GLYPH_W * GLYPH_H);
    for (let y = 0; y < GLYPH_H; y++) {
      const row = rows[y]!;
      if (row.length !== GLYPH_W) {
        throw new Error(`Digit ${g} row ${y} has width ${row.length}; expected ${GLYPH_W}`);
      }
      for (let x = 0; x < GLYPH_W; x++) {
        buf[y * GLYPH_W + x] = row[x] === 'X' ? 1 : 0;
      }
    }
    out.push(buf);
  }
  return out;
}

/** 10 entries, each `GLYPH_W * GLYPH_H` bytes, value 0 or 1. */
export const DIGIT_BITMAPS: readonly Uint8Array[] = bake();

/**
 * Pack the 10 digit bitmaps horizontally into a single R8 texture.
 * Layout: (gx + glyphIdx*GLYPH_W, gy) for each on-pixel.
 *
 * Filtering is `gl.NEAREST` to preserve hard pixel edges at any zoom.
 */
export function createGlyphAtlas(gl: WebGL2RenderingContext): WebGLTexture {
  const pixels = new Uint8Array(ATLAS_W * ATLAS_H);
  for (let g = 0; g < GLYPH_COUNT; g++) {
    const bm = DIGIT_BITMAPS[g]!;
    const xOff = g * GLYPH_W;
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        // Atlas is sampled with V flipped relative to the bitmap (UV y=0 is
        // the top of the texture in our coord system). Storing rows in the
        // same top-to-bottom order; we'll flip in the shader if needed.
        // Multiply by 255 so a sample of `1` reads as 1.0 in the FS.
        pixels[y * ATLAS_W + xOff + x] = bm[y * GLYPH_W + x]! * 255;
      }
    }
  }

  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // 1-byte alignment so 5×7 rows don't get padded.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.R8, ATLAS_W, ATLAS_H, 0,
    gl.RED, gl.UNSIGNED_BYTE, pixels,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
