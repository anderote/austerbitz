/**
 * Loads the gib chunk PNGs from `public/sprites/gibs/` and packs them into a
 * single-row atlas texture. Returned UV table is indexed by chunkId (matching
 * `manifest.json` order); the renderer's per-instance buffer copies the rect
 * out of `uvByChunkId` for each live debris slot.
 */

export interface DebrisChunkInfo {
  id: string;
  partType: 'head' | 'arm' | 'leg' | 'torso' | 'hat' | 'misc';
  mass: 'light' | 'medium';
}

export interface DebrisAtlas {
  texture: WebGLTexture;
  width: number;
  height: number;
  /** UV rect per chunk index (matches manifest order). [u0, v0, u1, v1] */
  uvByChunkId: Float32Array;
  chunks: DebrisChunkInfo[];
}

interface ManifestChunk {
  id: string;
  path: string;
  partType: DebrisChunkInfo['partType'];
  mass: DebrisChunkInfo['mass'];
}

const CHUNK_PIXEL = 8;

export async function loadDebrisAtlas(
  gl: WebGL2RenderingContext,
  manifestUrl = '/sprites/gibs/manifest.json',
  baseUrl = '/sprites/gibs',
): Promise<DebrisAtlas | null> {
  let manifest: { chunks: ManifestChunk[] };
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      console.warn(`[debris-atlas] manifest fetch failed: ${res.status}`);
      return null;
    }
    manifest = await res.json();
  } catch (err) {
    console.warn('[debris-atlas] manifest fetch error:', err);
    return null;
  }

  if (!manifest?.chunks?.length) {
    console.warn('[debris-atlas] manifest had no chunks');
    return null;
  }

  let bitmaps: ImageBitmap[];
  try {
    bitmaps = await Promise.all(
      manifest.chunks.map(async (c) => {
        const url = `${baseUrl}/${c.path}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
        const blob = await r.blob();
        return await createImageBitmap(blob);
      }),
    );
  } catch (err) {
    console.warn('[debris-atlas] chunk fetch error:', err);
    return null;
  }

  // Pack horizontally — each chunk in its own column. 8x8 each.
  const cols = manifest.chunks.length;
  const atlasW = CHUNK_PIXEL * cols;
  const atlasH = CHUNK_PIXEL;

  // Composite via OffscreenCanvas (matching pose-atlas pattern), then upload.
  const canvas = new OffscreenCanvas(atlasW, atlasH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn('[debris-atlas] 2D context unavailable');
    return null;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, atlasW, atlasH);

  const uvByChunkId = new Float32Array(cols * 4);
  for (let i = 0; i < cols; i++) {
    ctx.drawImage(bitmaps[i]!, i * CHUNK_PIXEL, 0);
    // Half-texel inset to avoid bilinear bleed (NEAREST sampling, but the
    // inset costs nothing and is a good habit).
    const halfTexelU = 0.5 / atlasW;
    const halfTexelV = 0.5 / atlasH;
    const u0 = (i * CHUNK_PIXEL) / atlasW + halfTexelU;
    const v0 = 0 + halfTexelV;
    const u1 = ((i + 1) * CHUNK_PIXEL) / atlasW - halfTexelU;
    const v1 = CHUNK_PIXEL / atlasH - halfTexelV;
    uvByChunkId[i * 4 + 0] = u0;
    uvByChunkId[i * 4 + 1] = v0;
    uvByChunkId[i * 4 + 2] = u1;
    uvByChunkId[i * 4 + 3] = v1;
  }

  const imageData = ctx.getImageData(0, 0, atlasW, atlasH);
  const pixels = new Uint8Array(imageData.data.buffer.slice(0));

  const texture = gl.createTexture();
  if (!texture) {
    console.warn('[debris-atlas] createTexture returned null');
    return null;
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, atlasW, atlasH, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, pixels,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    texture,
    width: atlasW,
    height: atlasH,
    uvByChunkId,
    chunks: manifest.chunks.map((c) => ({ id: c.id, partType: c.partType, mass: c.mass })),
  };
}
