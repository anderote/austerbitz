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

/**
 * Bitmask flags identifying which detachable parts an entity has lost.
 * Each bit lines up with a kit-declared `detachables[].name` so the renderer
 * can swap to the matching `--no-<name>` body variant. Bits are independent;
 * future parts (cannon wheels, plumes, swords) just claim the next bit.
 */
export const PartLost = {
  Head: 1 << 0,
} as const;

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
  // Anchor position the unit drifts back toward after being shoved with no
  // active move order. Set at spawn, updated on move/attack-move arrival
  // and on 'stop'.
  restPosX: Float32Array;
  restPosY: Float32Array;
  facing: Uint8Array;       // 0..7
  facingIntentX: Float32Array;
  facingIntentY: Float32Array;
  // Octant (0..7) the unit returns to when ordered to regroup. Set at spawn,
  // updated on move/attack-move arrival to whatever direction the unit was
  // facing as it arrived.
  restFacing: Uint8Array;

  // Combat
  hp: Uint16Array;
  morale: Uint8Array;       // 0..255
  state: Uint8Array;        // EntityState (0..8)
  reloadT: Float32Array;
  targetId: Int32Array;     // -1 if none

  // Veterancy
  rank: Uint8Array;     // 0..4 (Recruit, Veteran, Sergeant, SgtMajor, Captain)
  xp: Uint16Array;      // kills toward next promotion; saturates at 65535

  // Lifetime stats (per-battle, per-entity)
  kills: Uint16Array;        // confirmed kills credited; saturates at 65535
  damageDealt: Uint32Array;  // accumulated effective damage dealt; saturates at 0xffffffff

  // State-machine transients
  recoilT: Float32Array;    // countdown for visual recoil offset
  recoilPeakX: Float32Array; // peak render-only recoil displacement x
  recoilPeakY: Float32Array; // peak render-only recoil displacement y
  stateT: Float32Array;     // generic time-remaining-in-state timer
  impulseX: Float32Array;   // pending impulse x
  impulseY: Float32Array;   // pending impulse y
  ragdollT: Float32Array;   // countdown while in ragdoll state
  pushedT: Float32Array;    // settle delay after being shoved by collision; >0 = wait before drifting back

  // Identity
  kindId: Uint16Array;
  team: Uint8Array;
  // Id of the last box-select group this unit was part of (-1 = none).
  // Double-clicking a unit re-selects every alive unit sharing this id.
  lastSelectionGroup: Int32Array;

  // Identity (per-instance bio)
  firstNameIdx: Uint16Array; // index into theme's first-name pool
  lastNameIdx: Uint16Array;  // index into theme's last-name pool
  hometownIdx: Uint16Array;  // index into theme's hometown pool
  themeId: Uint8Array;       // numeric id of the name-bank theme this unit was rolled from
  ageYears: Uint8Array;      // clamped to [16, 55] at spawn

  // Per-entity body cache (populated at spawn from unit kind).
  bodyRadius: Float32Array;
  massKg: Float32Array;

  // Animation
  pose: Uint8Array;         // Pose enum (0..9)
  poseT: Float32Array;      // seconds since pose entry
  clipIndex: Uint8Array;    // selected variant (0..255)
  // Body sprite rotation in radians (signed). Used by sprite-pass to tilt the
  // body during the Dying state and hold the final tilt during Dead. Set by
  // death-drops-system at the moment of death; zero for everything else.
  bodyRot: Float32Array;

  // Death-drop bookkeeping: 1 once this entity has dropped its weapon
  // (death-drops-system sets it; ensures we drop exactly once per death).
  weaponDropped: Uint8Array;

  // Bitmask of detachable parts this entity has lost (see `PartLost`). Sprite
  // pass routes through the matching `--no-<part>` body variant when set.
  partLost: Uint8Array;

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
    restPosX: new Float32Array(capacity),
    restPosY: new Float32Array(capacity),
    facing: new Uint8Array(capacity),
    facingIntentX: new Float32Array(capacity),
    facingIntentY: new Float32Array(capacity),
    restFacing: new Uint8Array(capacity),
    hp: new Uint16Array(capacity),
    morale: new Uint8Array(capacity),
    state: new Uint8Array(capacity),
    reloadT: new Float32Array(capacity),
    targetId: new Int32Array(capacity).fill(-1),
    rank: new Uint8Array(capacity),
    xp: new Uint16Array(capacity),
    kills: new Uint16Array(capacity),
    damageDealt: new Uint32Array(capacity),
    recoilT: new Float32Array(capacity),
    recoilPeakX: new Float32Array(capacity),
    recoilPeakY: new Float32Array(capacity),
    stateT: new Float32Array(capacity),
    impulseX: new Float32Array(capacity),
    impulseY: new Float32Array(capacity),
    ragdollT: new Float32Array(capacity),
    pushedT: new Float32Array(capacity),
    kindId: new Uint16Array(capacity),
    team: new Uint8Array(capacity),
    lastSelectionGroup: new Int32Array(capacity).fill(-1),
    firstNameIdx: new Uint16Array(capacity),
    lastNameIdx: new Uint16Array(capacity),
    hometownIdx: new Uint16Array(capacity),
    themeId: new Uint8Array(capacity),
    ageYears: new Uint8Array(capacity),
    bodyRadius: new Float32Array(capacity),
    massKg: new Float32Array(capacity),
    pose: new Uint8Array(capacity),
    poseT: new Float32Array(capacity),
    clipIndex: new Uint8Array(capacity),
    bodyRot: new Float32Array(capacity),
    weaponDropped: new Uint8Array(capacity),
    partLost: new Uint8Array(capacity),
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
  e.restPosX[id] = 0; e.restPosY[id] = 0;
  e.facing[id] = 0;
  e.facingIntentX[id] = 1;
  e.facingIntentY[id] = 0;
  e.restFacing[id] = 0;
  e.hp[id] = 0;
  e.morale[id] = 200;
  e.state[id] = EntityState.Idle;
  e.reloadT[id] = 0;
  e.targetId[id] = -1;
  e.rank[id] = 0;
  e.xp[id] = 0;
  e.kills[id] = 0;
  e.damageDealt[id] = 0;
  e.recoilT[id] = 0;
  e.recoilPeakX[id] = 0;
  e.recoilPeakY[id] = 0;
  e.stateT[id] = 0;
  e.impulseX[id] = 0;
  e.impulseY[id] = 0;
  e.ragdollT[id] = 0;
  e.pushedT[id] = 0;
  e.kindId[id] = 0;
  e.team[id] = 0;
  e.lastSelectionGroup[id] = -1;
  e.firstNameIdx[id] = 0;
  e.lastNameIdx[id] = 0;
  e.hometownIdx[id] = 0;
  e.themeId[id] = 0;
  e.ageYears[id] = 0;
  e.bodyRadius[id] = 0;
  e.massKg[id] = 0;
  e.pose[id] = 0;
  e.poseT[id] = 0;
  e.clipIndex[id] = 0;
  e.bodyRot[id] = 0;
  e.weaponDropped[id] = 0;
  e.partLost[id] = 0;
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

export function isDead(e: Entities, id: number): boolean {
  const s = e.state[id]!;
  return s === EntityState.Dying || s === EntityState.Dead;
}
