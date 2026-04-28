/**
 * Dropped-item kind discriminator. Routes the render pass between the
 * weapon-atlas UV cache and the head-atlas UV cache so a single pool can
 * hold both muskets and shakos.
 */
export const DroppedKind = {
  Weapon: 0,
  Hat: 1,
} as const;
export type DroppedKind = (typeof DroppedKind)[keyof typeof DroppedKind];

export interface DroppedItems {
  capacity: number;
  count: number;                 // live count
  alive: Uint8Array;
  posX: Float32Array;
  posY: Float32Array;
  rot: Float32Array;             // radians (final, includes jitter)
  kindId: Uint16Array;           // entity kind index — used to look up the kit at render time
  team: Uint8Array;              // for shader's per-team palette
  facing: Uint8Array;            // runtime facing 0..7 at death
  flipX: Uint8Array;             // 0/1, copied from the dying-pose offset's flipX flag
  kind: Uint8Array;              // DroppedKind: 0=weapon, 1=hat

  // Free-list
  freeListHead: number;
  freeListNext: Int32Array;
}

export function createDroppedItems(capacity: number): DroppedItems {
  const freeListNext = new Int32Array(capacity);
  for (let i = 0; i < capacity - 1; i++) freeListNext[i] = i + 1;
  freeListNext[capacity - 1] = -1;

  return {
    capacity,
    count: 0,
    alive: new Uint8Array(capacity),
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    rot: new Float32Array(capacity),
    kindId: new Uint16Array(capacity),
    team: new Uint8Array(capacity),
    facing: new Uint8Array(capacity),
    flipX: new Uint8Array(capacity),
    kind: new Uint8Array(capacity),
    freeListHead: 0,
    freeListNext,
  };
}

export function allocDroppedItem(d: DroppedItems): number {
  const id = d.freeListHead;
  if (id === -1) return -1;
  d.freeListHead = d.freeListNext[id]!;
  d.alive[id] = 1;
  d.count++;
  // Reset every field to a deterministic safe default.
  d.posX[id] = 0; d.posY[id] = 0;
  d.rot[id] = 0;
  d.kindId[id] = 0;
  d.team[id] = 0;
  d.facing[id] = 0;
  d.flipX[id] = 0;
  d.kind[id] = 0;
  return id;
}

export function freeDroppedItem(d: DroppedItems, id: number): void {
  if (!d.alive[id]) return;
  d.alive[id] = 0;
  d.count--;
  d.freeListNext[id] = d.freeListHead;
  d.freeListHead = id;
}

export function spawnDroppedWeapon(
  d: DroppedItems,
  posX: number,
  posY: number,
  rot: number,
  kindId: number,
  team: number,
  facing: number,
  flipX: number,
): number {
  const id = allocDroppedItem(d);
  if (id === -1) return -1;
  d.posX[id] = posX;
  d.posY[id] = posY;
  d.rot[id] = rot;
  d.kindId[id] = kindId;
  d.team[id] = team;
  d.facing[id] = facing;
  d.flipX[id] = flipX;
  d.kind[id] = DroppedKind.Weapon;
  return id;
}

export function spawnDroppedHat(
  d: DroppedItems,
  posX: number,
  posY: number,
  rot: number,
  kindId: number,
  team: number,
  facing: number,
  flipX: number,
): number {
  const id = allocDroppedItem(d);
  if (id === -1) return -1;
  d.posX[id] = posX;
  d.posY[id] = posY;
  d.rot[id] = rot;
  d.kindId[id] = kindId;
  d.team[id] = team;
  d.facing[id] = facing;
  d.flipX[id] = flipX;
  d.kind[id] = DroppedKind.Hat;
  return id;
}
