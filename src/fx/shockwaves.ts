export interface Shockwaves {
  capacity: number;        // max simultaneous waves
  entityCapacity: number;  // entities supported by hitMask
  count: number;
  alive: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  fullRadius: Float32Array;
  age: Float32Array;
  waveSpeed: Float32Array;
  damage: Float32Array;
  impulse: Float32Array;
  excludeTeam: Int32Array;     // -1 = none
  attackerId: Int32Array;
  hitMaskBytesPerWave: number;
  /** Flat array: hitMask[waveId * bytesPerWave + (entityId >>> 3)] holds the bit for entityId & 7. */
  hitMask: Uint8Array;        // capacity * hitMaskBytesPerWave
  freeListHead: number;
  freeListNext: Int32Array;
}

export function createShockwaves(capacity: number, entityCapacity: number): Shockwaves {
  const hitMaskBytesPerWave = Math.ceil(entityCapacity / 8);
  const freeListNext = new Int32Array(capacity);
  for (let i = 0; i < capacity - 1; i++) freeListNext[i] = i + 1;
  freeListNext[capacity - 1] = -1;
  return {
    capacity,
    entityCapacity,
    count: 0,
    alive: new Uint8Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    fullRadius: new Float32Array(capacity),
    age: new Float32Array(capacity),
    waveSpeed: new Float32Array(capacity),
    damage: new Float32Array(capacity),
    impulse: new Float32Array(capacity),
    excludeTeam: new Int32Array(capacity).fill(-1),
    attackerId: new Int32Array(capacity).fill(-1),
    hitMaskBytesPerWave,
    hitMask: new Uint8Array(capacity * hitMaskBytesPerWave),
    freeListHead: 0,
    freeListNext,
  };
}

export function allocShockwave(s: Shockwaves): number {
  const id = s.freeListHead;
  if (id === -1) return -1;
  s.freeListHead = s.freeListNext[id]!;
  s.alive[id] = 1;
  s.count++;
  // Reset fields to deterministic safe defaults.
  s.x[id] = 0;
  s.y[id] = 0;
  s.fullRadius[id] = 0;
  s.age[id] = 0;
  s.waveSpeed[id] = 0;
  s.damage[id] = 0;
  s.impulse[id] = 0;
  s.excludeTeam[id] = -1;
  s.attackerId[id] = -1;
  // Zero this wave's hitMask slice.
  const off = id * s.hitMaskBytesPerWave;
  s.hitMask.fill(0, off, off + s.hitMaskBytesPerWave);
  return id;
}

export function freeShockwave(s: Shockwaves, id: number): void {
  if (!s.alive[id]) return;
  s.alive[id] = 0;
  s.count--;
  s.freeListNext[id] = s.freeListHead;
  s.freeListHead = id;
}

export function isHit(s: Shockwaves, waveId: number, entityId: number): boolean {
  if (entityId < 0 || entityId >= s.entityCapacity) return true; // out-of-range = already-hit (skip)
  const off = waveId * s.hitMaskBytesPerWave + (entityId >>> 3);
  return (s.hitMask[off]! & (1 << (entityId & 7))) !== 0;
}

export function setHit(s: Shockwaves, waveId: number, entityId: number): void {
  if (entityId < 0 || entityId >= s.entityCapacity) return;
  const off = waveId * s.hitMaskBytesPerWave + (entityId >>> 3);
  s.hitMask[off] = s.hitMask[off]! | (1 << (entityId & 7));
}
