/**
 * Per-frame queue of crater-stain splats requested by the sim. Drained each
 * frame by the renderer (which bakes them into the GPU stain texture) and
 * reset to zero. Capacity caps splats per frame, not total accumulated stain.
 */
export interface CraterSplats {
  capacity: number;
  count: number;
  posX: Float32Array;
  posY: Float32Array;
  radius: Float32Array;
  intensity: Float32Array;
}

export function createCraterSplats(capacity: number): CraterSplats {
  return {
    capacity,
    count: 0,
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    radius: new Float32Array(capacity),
    intensity: new Float32Array(capacity),
  };
}

export function pushCraterSplat(
  splats: CraterSplats,
  x: number,
  y: number,
  radius: number,
  intensity: number,
): void {
  if (splats.count >= splats.capacity) return;
  const i = splats.count;
  splats.posX[i] = x;
  splats.posY[i] = y;
  splats.radius[i] = radius;
  splats.intensity[i] = intensity;
  splats.count++;
}

export function clearCraterSplats(splats: CraterSplats): void {
  splats.count = 0;
}
