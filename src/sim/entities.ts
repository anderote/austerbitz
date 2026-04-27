export interface Entities {
  capacity: number;
  count: number;            // live count
  alive: Uint8Array;        // 1 = alive, 0 = free

  // Transform
  posX: Float32Array;
  posY: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  facing: Uint8Array;       // 0..7

  // Combat
  hp: Uint16Array;
  morale: Uint8Array;       // 0..255
  state: Uint8Array;        // 0=idle, 1=moving, 2=firing, 3=reloading, 4=ragdoll, 5=dead
  reloadT: Float32Array;
  targetId: Int32Array;     // -1 if none

  // Identity
  kindId: Uint16Array;
  team: Uint8Array;
  formationId: Int32Array;  // -1 if none

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
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    velX: new Float32Array(capacity),
    velY: new Float32Array(capacity),
    facing: new Uint8Array(capacity),
    hp: new Uint16Array(capacity),
    morale: new Uint8Array(capacity),
    state: new Uint8Array(capacity),
    reloadT: new Float32Array(capacity),
    targetId: new Int32Array(capacity).fill(-1),
    kindId: new Uint16Array(capacity),
    team: new Uint8Array(capacity),
    formationId: new Int32Array(capacity).fill(-1),
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
  e.count++;
  // Reset hot fields to deterministic defaults
  e.posX[id] = 0; e.posY[id] = 0;
  e.velX[id] = 0; e.velY[id] = 0;
  e.facing[id] = 0;
  e.hp[id] = 0;
  e.morale[id] = 200;
  e.state[id] = 0;
  e.reloadT[id] = 0;
  e.targetId[id] = -1;
  e.kindId[id] = 0;
  e.team[id] = 0;
  e.formationId[id] = -1;
  e.frame[id] = 0;
  e.frameTime[id] = 0;
  return id;
}

export function freeEntity(e: Entities, id: number): void {
  if (!e.alive[id]) return;
  e.alive[id] = 0;
  e.count--;
  e.freeListNext[id] = e.freeListHead;
  e.freeListHead = id;
}

export function isAlive(e: Entities, id: number): boolean {
  return e.alive[id] === 1;
}
