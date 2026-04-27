export const EntityState = {
  Idle: 0,
  Moving: 1,
  Aiming: 2,
  Firing: 3,
  Reloading: 4,
  Flinch: 5,
  Ragdoll: 6,
  Dying: 7,
  Dead: 8,
} as const;
export type EntityState = (typeof EntityState)[keyof typeof EntityState];

export interface Entities {
  capacity: number;
  count: number;            // live count (also length of packed aliveIds)
  alive: Uint8Array;        // 1 = alive, 0 = free

  // Packed alive index — aliveIds[0..count) are the live entity ids,
  // aliveIdx[id] is the slot of `id` in aliveIds (or -1 if not alive).
  // Maintained via swap-pop on free.
  aliveIds: Int32Array;
  aliveIdx: Int32Array;

  // Transform
  posX: Float32Array;
  posY: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  facing: Uint8Array;       // 0..7
  facingIntentX: Float32Array;
  facingIntentY: Float32Array;

  // Combat
  hp: Uint16Array;
  morale: Uint8Array;       // 0..255
  state: Uint8Array;        // EntityState (0..8)
  reloadT: Float32Array;
  targetId: Int32Array;     // -1 if none

  // State-machine transients
  recoilT: Float32Array;    // countdown for visual recoil offset
  recoilPeakX: Float32Array; // peak render-only recoil displacement x
  recoilPeakY: Float32Array; // peak render-only recoil displacement y
  stateT: Float32Array;     // generic time-remaining-in-state timer
  impulseX: Float32Array;   // pending impulse x
  impulseY: Float32Array;   // pending impulse y
  ragdollT: Float32Array;   // countdown while in ragdoll state

  // Identity
  kindId: Uint16Array;
  team: Uint8Array;
  formationId: Int32Array;  // -1 if none

  // Per-entity body cache (populated at spawn from unit kind).
  bodyRadius: Float32Array;
  massKg: Float32Array;

  // Animation
  frame: Uint8Array;
  frameTime: Float32Array;

  // Free-list
  freeListHead: number;
  freeListNext: Int32Array;  // -1 = end of list
}

export function createEntities(capacity: number): Entities {
  const freeListNext = new Int32Array(capacity);
  for (let i = 0; i < capacity - 1; i++) freeListNext[i] = i + 1;
  freeListNext[capacity - 1] = -1;

  return {
    capacity,
    count: 0,
    alive: new Uint8Array(capacity),
    aliveIds: new Int32Array(capacity),
    aliveIdx: new Int32Array(capacity).fill(-1),
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    velX: new Float32Array(capacity),
    velY: new Float32Array(capacity),
    facing: new Uint8Array(capacity),
    facingIntentX: new Float32Array(capacity),
    facingIntentY: new Float32Array(capacity),
    hp: new Uint16Array(capacity),
    morale: new Uint8Array(capacity),
    state: new Uint8Array(capacity),
    reloadT: new Float32Array(capacity),
    targetId: new Int32Array(capacity).fill(-1),
    recoilT: new Float32Array(capacity),
    recoilPeakX: new Float32Array(capacity),
    recoilPeakY: new Float32Array(capacity),
    stateT: new Float32Array(capacity),
    impulseX: new Float32Array(capacity),
    impulseY: new Float32Array(capacity),
    ragdollT: new Float32Array(capacity),
    kindId: new Uint16Array(capacity),
    team: new Uint8Array(capacity),
    formationId: new Int32Array(capacity).fill(-1),
    bodyRadius: new Float32Array(capacity),
    massKg: new Float32Array(capacity),
    frame: new Uint8Array(capacity),
    frameTime: new Float32Array(capacity),
    freeListHead: 0,
    freeListNext,
  };
}

export function allocEntity(e: Entities): number {
  const id = e.freeListHead;
  if (id === -1) return -1;
  e.freeListHead = e.freeListNext[id]!;
  e.alive[id] = 1;
  // Append to packed alive list, then bump count.
  e.aliveIds[e.count] = id;
  e.aliveIdx[id] = e.count;
  e.count++;
  // Reset hot fields to deterministic defaults
  e.posX[id] = 0; e.posY[id] = 0;
  e.velX[id] = 0; e.velY[id] = 0;
  e.facing[id] = 0;
  e.facingIntentX[id] = 1;
  e.facingIntentY[id] = 0;
  e.hp[id] = 0;
  e.morale[id] = 200;
  e.state[id] = EntityState.Idle;
  e.reloadT[id] = 0;
  e.targetId[id] = -1;
  e.recoilT[id] = 0;
  e.recoilPeakX[id] = 0;
  e.recoilPeakY[id] = 0;
  e.stateT[id] = 0;
  e.impulseX[id] = 0;
  e.impulseY[id] = 0;
  e.ragdollT[id] = 0;
  e.kindId[id] = 0;
  e.team[id] = 0;
  e.formationId[id] = -1;
  e.bodyRadius[id] = 0;
  e.massKg[id] = 0;
  e.frame[id] = 0;
  e.frameTime[id] = 0;
  return id;
}

export function freeEntity(e: Entities, id: number): void {
  if (!e.alive[id]) return;
  e.alive[id] = 0;
  // Swap-pop out of the packed alive list.
  const slot = e.aliveIdx[id]!;
  const last = e.count - 1;
  if (slot !== last) {
    const lastId = e.aliveIds[last]!;
    e.aliveIds[slot] = lastId;
    e.aliveIdx[lastId] = slot;
  }
  e.aliveIdx[id] = -1;
  e.count--;
  e.freeListNext[id] = e.freeListHead;
  e.freeListHead = id;
}

export function isAlive(e: Entities, id: number): boolean {
  return e.alive[id] === 1;
}
