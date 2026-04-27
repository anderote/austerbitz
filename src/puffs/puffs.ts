export interface Puffs {
  capacity: number;
  count: number;
  /** Rolling cursor for allocPuff so we don't rescan slot 0 every call. */
  cursor: number;
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
  /** Per-puff decay multiplier at full sizeMax. 1 = no slowdown; smaller
   *  values = bigger puffs decay slower. Lerped against sizeFrac in update. */
  decayMul: Float32Array;
}

export function createPuffs(capacity: number): Puffs {
  const decayMul = new Float32Array(capacity);
  decayMul.fill(1);
  return {
    capacity, count: 0, cursor: 0,
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
    decayMul,
  };
}

export function allocPuff(p: Puffs): number {
  const cap = p.capacity;
  let i = p.cursor;
  for (let n = 0; n < cap; n++) {
    if (p.alive[i] === 0) {
      p.alive[i] = 1;
      p.count++;
      p.cursor = i + 1 === cap ? 0 : i + 1;
      return i;
    }
    i = i + 1 === cap ? 0 : i + 1;
  }
  return -1;
}

export function updatePuffs(p: Puffs, dt: number): void {
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    const sm = p.sizeMax[i]!;
    const sizeFrac = sm > 0 ? p.size[i]! / sm : 0;
    // Decay slows down as the puff approaches its size cap. decayMul=1 means
    // no slowdown; decayMul<1 lets large/merged clouds linger.
    const decayMul = 1 - (1 - p.decayMul[i]!) * sizeFrac;
    p.life[i] -= dt * decayMul;
    if (p.life[i]! <= 0) {
      p.alive[i] = 0;
      p.count--;
      continue;
    }
    // inertiaExp must be > 0; pow(x, 0) = 1 would apply full inertia at all sizes.
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
