export interface Puffs {
  capacity: number;
  count: number;
  alive: Uint8Array;
  profileIdx: Uint16Array;
  posX: Float32Array; posY: Float32Array;
  velX: Float32Array; velY: Float32Array;
  life: Float32Array; lifeMax: Float32Array;
  size: Float32Array; sizeMax: Float32Array; edgeGrowth: Float32Array;
  drag: Float32Array; buoyancy: Float32Array;
  inertiaExp: Float32Array; inertiaWeight: Float32Array;
  r: Float32Array; g: Float32Array; b: Float32Array;
  alpha: Float32Array; softness: Float32Array;
}

export function createPuffs(capacity: number): Puffs {
  return {
    capacity, count: 0,
    alive: new Uint8Array(capacity),
    profileIdx: new Uint16Array(capacity),
    posX: new Float32Array(capacity), posY: new Float32Array(capacity),
    velX: new Float32Array(capacity), velY: new Float32Array(capacity),
    life: new Float32Array(capacity), lifeMax: new Float32Array(capacity),
    size: new Float32Array(capacity), sizeMax: new Float32Array(capacity), edgeGrowth: new Float32Array(capacity),
    drag: new Float32Array(capacity), buoyancy: new Float32Array(capacity),
    inertiaExp: new Float32Array(capacity), inertiaWeight: new Float32Array(capacity),
    r: new Float32Array(capacity), g: new Float32Array(capacity), b: new Float32Array(capacity),
    alpha: new Float32Array(capacity), softness: new Float32Array(capacity),
  };
}

export function allocPuff(p: Puffs): number {
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) {
      p.alive[i] = 1;
      p.count++;
      return i;
    }
  }
  return -1;
}

export function updatePuffs(p: Puffs, dt: number): void {
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    p.life[i] -= dt;
    if (p.life[i]! <= 0) {
      p.alive[i] = 0;
      p.count--;
      continue;
    }
    const sm = p.sizeMax[i]!;
    const sizeFrac = sm > 0 ? p.size[i]! / sm : 0;
    const sizeDamp = 1 - p.inertiaWeight[i]! * Math.pow(sizeFrac, p.inertiaExp[i]!);
    const tickMul = p.drag[i]! * sizeDamp;
    p.velX[i] = p.velX[i]! * tickMul;
    p.velY[i] = p.velY[i]! * tickMul;
    p.velY[i] = p.velY[i]! + p.buoyancy[i]! * dt;
    const grown = p.size[i]! + p.edgeGrowth[i]! * dt;
    p.size[i] = grown > sm ? sm : grown;
    p.posX[i] = p.posX[i]! + p.velX[i]! * dt;
    p.posY[i] = p.posY[i]! + p.velY[i]! * dt;
  }
}
