export const ParticleClass = {
  Dust: 0,
  Smoke: 1,
  Flash: 2,
  Blood: 3,
  Debris: 4,
} as const;
export type ParticleClass = (typeof ParticleClass)[keyof typeof ParticleClass];

export interface Particles {
  capacity: number;
  count: number;
  alive: Uint8Array;
  /** Packed list of alive slot ids; aliveIds[0..count) are live. */
  aliveIds: Int32Array;
  /** Inverse map: aliveIdx[slotId] = packed index, or -1 if not alive. */
  aliveIdx: Int32Array;
  /** Rolling cursor for spawnParticle (matches puffs.allocPuff pattern). */
  cursor: number;
  posX: Float32Array;
  posY: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  life: Float32Array;
  lifeMax: Float32Array;
  size: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  drag: Float32Array;
  accelY: Float32Array;
  sizeGrowth: Float32Array;
  klass: Uint8Array;
}

export interface ParticleSpawn {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  size: number;
  r: number; g: number; b: number;
  drag?: number;
  accelY?: number;
  sizeGrowth?: number;
  klass?: ParticleClass;
}

export function createParticles(capacity: number): Particles {
  const aliveIdx = new Int32Array(capacity);
  aliveIdx.fill(-1);
  return {
    capacity, count: 0, cursor: 0,
    alive: new Uint8Array(capacity),
    aliveIds: new Int32Array(capacity),
    aliveIdx,
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    velX: new Float32Array(capacity),
    velY: new Float32Array(capacity),
    life: new Float32Array(capacity),
    lifeMax: new Float32Array(capacity),
    size: new Float32Array(capacity),
    r: new Float32Array(capacity),
    g: new Float32Array(capacity),
    b: new Float32Array(capacity),
    drag: new Float32Array(capacity),
    accelY: new Float32Array(capacity),
    sizeGrowth: new Float32Array(capacity),
    klass: new Uint8Array(capacity),
  };
}

export function spawnParticle(p: Particles, s: ParticleSpawn): number {
  const cap = p.capacity;
  let i = p.cursor;
  for (let n = 0; n < cap; n++) {
    if (p.alive[i] === 0) {
      p.alive[i] = 1;
      p.aliveIdx[i] = p.count;
      p.aliveIds[p.count] = i;
      p.count++;
      p.cursor = i + 1 === cap ? 0 : i + 1;
      p.posX[i] = s.x; p.posY[i] = s.y;
      p.velX[i] = s.vx; p.velY[i] = s.vy;
      p.life[i] = s.life; p.lifeMax[i] = s.life;
      p.size[i] = s.size;
      p.r[i] = s.r; p.g[i] = s.g; p.b[i] = s.b;
      p.drag[i] = s.drag ?? 0.98;
      p.accelY[i] = s.accelY ?? 0;
      p.sizeGrowth[i] = s.sizeGrowth ?? 0;
      p.klass[i] = s.klass ?? ParticleClass.Dust;
      return i;
    }
    i = i + 1 === cap ? 0 : i + 1;
  }
  return -1;
}

/** Frees slot `i`. Safe to call from inside a packed-list iteration if the
 *  caller iterates by index `n` and decrements on free (see updateParticles). */
export function freeParticle(p: Particles, i: number): void {
  if (p.alive[i] === 0) return;
  p.alive[i] = 0;
  const idx = p.aliveIdx[i]!;
  const last = p.count - 1;
  if (idx !== last) {
    const lastId = p.aliveIds[last]!;
    p.aliveIds[idx] = lastId;
    p.aliveIdx[lastId] = idx;
  }
  p.aliveIdx[i] = -1;
  p.count--;
}

export function updateParticles(
  p: Particles,
  dt: number,
  splats?: { capacity: number; count: number; posX: Float32Array; posY: Float32Array; radius: Float32Array; intensity: Float32Array },
): void {
  for (let n = 0; n < p.count; n++) {
    const i = p.aliveIds[n]!;
    p.life[i] -= dt;
    if (p.life[i]! <= 0) {
      // Blood droplet "lands" — stamp a small ground splat at its final pos.
      // Radius floor of 0.5m so the stamp is ≥1 texel at 2 texels/m, otherwise
      // small drops fall between texels and never accumulate.
      if (splats !== undefined && p.klass[i] === ParticleClass.Blood && splats.count < splats.capacity) {
        const k = splats.count;
        splats.posX[k] = p.posX[i]!;
        splats.posY[k] = p.posY[i]!;
        splats.radius[k] = Math.max(p.size[i]! * 1.5, 0.5);
        splats.intensity[k] = 0.45;
        splats.count = k + 1;
      }
      freeParticle(p, i);
      n--;
      continue;
    }
    p.velX[i] *= p.drag[i]!;
    p.velY[i] *= p.drag[i]!;
    p.velY[i] += p.accelY[i]! * dt;
    p.size[i] *= 1 + p.sizeGrowth[i]! * dt;
    p.posX[i] += p.velX[i]! * dt;
    p.posY[i] += p.velY[i]! * dt;
  }
}
