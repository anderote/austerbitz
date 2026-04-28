/** Tuning constants for debris physics. Edit here to retune feel. */
export const GIB_GRAVITY = 18;          // world units / s^2
export const GIB_AIR_DRAG_XY = 0.6;     // 1/s — fraction lost per second
export const GIB_AIR_DRAG_Z = 0.05;
export const GIB_BOUNCE_DAMP = 0.4;     // velZ retained after ground hit
export const GIB_GROUND_FRICTION = 0.5; // velX/Y retained after ground hit
export const GIB_SPIN_DRAG = 0.5;       // 1/s

export const MUSKET_GIB_CHANCE = 0.10;
export const MELEE_GIB_CHANCE = 0.30;

export interface Debris {
  capacity: number;
  count: number;
  alive: Uint8Array;
  aliveIds: Int32Array;
  aliveIdx: Int32Array;
  cursor: number;
  posX: Float32Array;
  posY: Float32Array;
  z: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  velZ: Float32Array;
  spinDeg: Float32Array;
  spinRate: Float32Array;
  ttl: Float32Array;
  bounces: Uint8Array;
  chunkId: Uint8Array;
  team: Uint8Array;
}

export function createDebris(capacity: number): Debris {
  const aliveIdx = new Int32Array(capacity);
  aliveIdx.fill(-1);
  return {
    capacity,
    count: 0,
    cursor: 0,
    alive: new Uint8Array(capacity),
    aliveIds: new Int32Array(capacity),
    aliveIdx,
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    z: new Float32Array(capacity),
    velX: new Float32Array(capacity),
    velY: new Float32Array(capacity),
    velZ: new Float32Array(capacity),
    spinDeg: new Float32Array(capacity),
    spinRate: new Float32Array(capacity),
    ttl: new Float32Array(capacity),
    bounces: new Uint8Array(capacity),
    chunkId: new Uint8Array(capacity),
    team: new Uint8Array(capacity),
  };
}

/** Returns a free slot id, or -1 if at capacity. */
export function allocDebris(d: Debris): number {
  if (d.count >= d.capacity) return -1;
  // Rolling cursor — find first free slot starting at cursor.
  for (let i = 0; i < d.capacity; i++) {
    const id = (d.cursor + i) % d.capacity;
    if (d.alive[id] === 0) {
      d.alive[id] = 1;
      d.aliveIdx[id] = d.count;
      d.aliveIds[d.count] = id;
      d.count++;
      d.cursor = (id + 1) % d.capacity;
      return id;
    }
  }
  return -1;
}

export function freeDebris(d: Debris, id: number): void {
  if (d.alive[id] === 0) return;
  d.alive[id] = 0;
  const packedIdx = d.aliveIdx[id]!;
  const lastPacked = d.count - 1;
  if (packedIdx !== lastPacked) {
    const lastId = d.aliveIds[lastPacked]!;
    d.aliveIds[packedIdx] = lastId;
    d.aliveIdx[lastId] = packedIdx;
  }
  d.aliveIds[lastPacked] = 0;
  d.aliveIdx[id] = -1;
  d.count--;
}
