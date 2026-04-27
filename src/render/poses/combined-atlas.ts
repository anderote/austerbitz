import type { PoseAtlas } from './atlas';

export interface CombinedAtlas {
  pixels: Uint8Array;
  width: number;
  height: number;
  /** Y offset where the pose-atlas region begins inside the combined sheet. */
  poseAtlasY: number;
}

/**
 * Compose a procedural-atlas RGBA buffer and a (possibly null) pose atlas
 * into a single RGBA buffer. The procedural region sits at (0, 0); the pose
 * region sits directly below at (0, procedural.height). Padding right of
 * either region is left transparent.
 */
export function composeCombinedAtlas(
  procedural: { pixels: Uint8Array; width: number; height: number },
  poseAtlas: PoseAtlas | null,
): CombinedAtlas {
  const poseW = poseAtlas?.width ?? 0;
  const poseH = poseAtlas?.height ?? 0;
  const width = Math.max(procedural.width, poseW);
  const height = procedural.height + poseH;
  const pixels = new Uint8Array(width * height * 4);
  blit(pixels, width, 0, 0, procedural.pixels, procedural.width, procedural.height);
  if (poseAtlas && poseW > 0 && poseH > 0) {
    blit(pixels, width, 0, procedural.height, poseAtlas.pixels, poseW, poseH);
  }
  return { pixels, width, height, poseAtlasY: procedural.height };
}

function blit(
  dst: Uint8Array,
  dstW: number,
  dstX: number,
  dstY: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
): void {
  for (let y = 0; y < srcH; y++) {
    const dstRow = ((dstY + y) * dstW + dstX) * 4;
    const srcRow = y * srcW * 4;
    for (let x = 0; x < srcW * 4; x++) {
      dst[dstRow + x] = src[srcRow + x]!;
    }
  }
}
