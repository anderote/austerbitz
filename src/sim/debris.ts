/** Tuning constants for debris physics. Edit here to retune feel. */
export const GIB_GRAVITY = 18;          // world units / s^2
export const GIB_AIR_DRAG_XY = 0.6;     // 1/s — fraction lost per second
export const GIB_AIR_DRAG_Z = 0.05;
export const GIB_BOUNCE_DAMP = 0.4;     // velZ retained after ground hit
export const GIB_GROUND_FRICTION = 0.5; // velX/Y retained after ground hit
export const GIB_SPIN_DRAG = 0.5;       // 1/s

/** Bounce count at which a gib is considered settled / persistent. */
export const GIB_SETTLE_BOUNCES = 3;

export const MUSKET_GIB_CHANCE = 0.14;
export const MUSKET_NONLETHAL_GIB_CHANCE = 0.04;
export const MELEE_GIB_CHANCE = 0.30;

/** Tagged union over the SoA: which renderer path consumes this slot. */
export const DebrisKind = {
  /** Generic 8x8 chunk from the gib atlas (legs, arms, torso, hat, meat-blob). */
  GenericChunk: 0,
  /** Kit head/hat sprite — UV resolved from the combined sprite atlas at draw time. */
  KitHead: 1,
  /** Kit weapon sprite — UV resolved from the combined sprite atlas at draw time. */
  KitWeapon: 2,
} as const;
export type DebrisKind = (typeof DebrisKind)[keyof typeof DebrisKind];

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
  /** Tagged-union discriminator — one of `DebrisKind`. */
  kind: Uint8Array;
  /** GenericChunk: index into debris-atlas manifest. Unused for kit kinds. */
  chunkId: Uint8Array;
  team: Uint8Array;
  /** Kit kinds: index into the runtime kit table. 0xff = unset. */
  kitIdx: Uint8Array;
  /** Kit kinds: runtime facing 0..7 captured at spawn time. */
  facing: Uint8Array;
  /** GenericChunk: per-kit/per-regiment multiplicative tint, RGB 0..255. */
  tintR: Uint8Array;
  tintG: Uint8Array;
  tintB: Uint8Array;
  /** 1 if this gib was spawned by an explosion — used to emit smoke trails while airborne. */
  fromExplosion: Uint8Array;
  /** Per-gib smoke-puff timer accumulator (seconds). */
  smokeT: Float32Array;
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
    kind: new Uint8Array(capacity),
    chunkId: new Uint8Array(capacity),
    team: new Uint8Array(capacity),
    kitIdx: new Uint8Array(capacity),
    facing: new Uint8Array(capacity),
    tintR: new Uint8Array(capacity),
    tintG: new Uint8Array(capacity),
    tintB: new Uint8Array(capacity),
    fromExplosion: new Uint8Array(capacity),
    smokeT: new Float32Array(capacity),
  };
}

/**
 * Returns a free slot id. When the pool is full, evicts an existing gib —
 * preferring settled (long-landed) gibs over in-flight ones, falling back to
 * the oldest packed entry if every slot is still in flight. Never returns -1.
 */
export function allocDebris(d: Debris): number {
  if (d.count >= d.capacity) {
    // Prefer evicting a settled gib so a fresh kill replaces an old corpse,
    // not another gib that's still arcing through the air.
    let evictPacked = -1;
    for (let i = 0; i < d.count; i++) {
      const id = d.aliveIds[i]!;
      if (d.bounces[id]! >= GIB_SETTLE_BOUNCES) { evictPacked = i; break; }
    }
    // Fallback: oldest packed slot (FIFO-ish — packed list is alloc-order
    // modulo swap-with-last on free).
    if (evictPacked < 0) evictPacked = 0;
    freeDebris(d, d.aliveIds[evictPacked]!);
  }
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
