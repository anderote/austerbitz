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
  return {
    capacity, count: 0,
    alive: new Uint8Array(capacity),
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
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) {
      p.alive[i] = 1;
      p.posX[i] = s.x; p.posY[i] = s.y;
      p.velX[i] = s.vx; p.velY[i] = s.vy;
      p.life[i] = s.life; p.lifeMax[i] = s.life;
      p.size[i] = s.size;
      p.r[i] = s.r; p.g[i] = s.g; p.b[i] = s.b;
      p.drag[i] = s.drag ?? 0.98;
      p.accelY[i] = s.accelY ?? 0;
      p.sizeGrowth[i] = s.sizeGrowth ?? 0;
      p.klass[i] = s.klass ?? ParticleClass.Dust;
      p.count++;
      return i;
    }
  }
  return -1;
}

export function updateParticles(p: Particles, dt: number): void {
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    p.life[i] -= dt;
    if (p.life[i]! <= 0) {
      p.alive[i] = 0;
      p.count--;
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
