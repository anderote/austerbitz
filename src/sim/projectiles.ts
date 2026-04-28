export const ProjectileKind = {
  Musket:    0,
  SolidShot: 1,
  Shell:     2,
} as const;
export type ProjectileKind = (typeof ProjectileKind)[keyof typeof ProjectileKind];

export interface Projectiles {
  capacity: number;
  count: number;                 // live count
  alive: Uint8Array;
  posX: Float32Array;
  posY: Float32Array;
  posZ: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  velZ: Float32Array;
  prevX: Float32Array;
  prevY: Float32Array;
  life: Float32Array;            // max-flight-time safety countdown
  kind: Uint8Array;              // ProjectileKind
  team: Uint8Array;
  ownerId: Int32Array;           // entity id of firer, or -1 if ownerless
  damage: Float32Array;          // depletes for solid-shot
  mass: Float32Array;            // for impulse on hit
  ricochets: Uint8Array;         // remaining bounces (solid-shot)
  fuseT: Float32Array;           // shell fuse countdown (else unused)

  // Free-list
  freeListHead: number;
  freeListNext: Int32Array;
}

export function createProjectiles(capacity: number): Projectiles {
  const freeListNext = new Int32Array(capacity);
  for (let i = 0; i < capacity - 1; i++) freeListNext[i] = i + 1;
  freeListNext[capacity - 1] = -1;

  return {
    capacity,
    count: 0,
    alive: new Uint8Array(capacity),
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    posZ: new Float32Array(capacity),
    velX: new Float32Array(capacity),
    velY: new Float32Array(capacity),
    velZ: new Float32Array(capacity),
    prevX: new Float32Array(capacity),
    prevY: new Float32Array(capacity),
    life: new Float32Array(capacity),
    kind: new Uint8Array(capacity),
    team: new Uint8Array(capacity),
    ownerId: new Int32Array(capacity).fill(-1),
    damage: new Float32Array(capacity),
    mass: new Float32Array(capacity),
    ricochets: new Uint8Array(capacity),
    fuseT: new Float32Array(capacity),
    freeListHead: 0,
    freeListNext,
  };
}

export function allocProjectile(p: Projectiles): number {
  const id = p.freeListHead;
  if (id === -1) return -1;
  p.freeListHead = p.freeListNext[id]!;
  p.alive[id] = 1;
  p.count++;
  // Reset every field to a deterministic safe default.
  p.posX[id] = 0; p.posY[id] = 0; p.posZ[id] = 0;
  p.velX[id] = 0; p.velY[id] = 0; p.velZ[id] = 0;
  p.prevX[id] = 0; p.prevY[id] = 0;
  p.life[id] = 0;
  p.kind[id] = ProjectileKind.Musket;
  p.team[id] = 0;
  p.ownerId[id] = -1;
  p.damage[id] = 0;
  p.mass[id] = 0;
  p.ricochets[id] = 0;
  p.fuseT[id] = 0;
  return id;
}

export function freeProjectile(p: Projectiles, id: number): void {
  if (!p.alive[id]) return;
  p.alive[id] = 0;
  p.count--;
  p.freeListNext[id] = p.freeListHead;
  p.freeListHead = id;
}

export function spawnMusketBall(
  p: Projectiles,
  ox: number, oy: number,
  dirX: number, dirY: number,
  team: number,
  damage: number,
  muzzleSpeed: number,
  mass: number,
  maxLife: number,
  ownerId: number,
): number {
  const id = allocProjectile(p);
  if (id === -1) return -1;
  p.posX[id] = ox;
  p.posY[id] = oy;
  p.posZ[id] = 0;
  p.prevX[id] = ox;
  p.prevY[id] = oy;
  p.velX[id] = dirX * muzzleSpeed;
  p.velY[id] = dirY * muzzleSpeed;
  p.velZ[id] = 0;
  p.life[id] = maxLife;
  p.kind[id] = ProjectileKind.Musket;
  p.team[id] = team;
  p.damage[id] = damage;
  p.mass[id] = mass;
  p.ricochets[id] = 0;
  p.fuseT[id] = 0;
  p.ownerId[id] = ownerId;
  return id;
}

export function spawnSolidShot(
  p: Projectiles,
  ox: number, oy: number, oz: number,
  vx: number, vy: number, vz: number,
  team: number,
  damage: number,
  mass: number,
  maxLife: number,
  ricochets: number,
  ownerId: number,
): number {
  const id = allocProjectile(p);
  if (id === -1) return -1;
  p.posX[id] = ox;
  p.posY[id] = oy;
  p.posZ[id] = oz;
  p.prevX[id] = ox;
  p.prevY[id] = oy;
  p.velX[id] = vx;
  p.velY[id] = vy;
  p.velZ[id] = vz;
  p.life[id] = maxLife;
  p.kind[id] = ProjectileKind.SolidShot;
  p.team[id] = team;
  p.damage[id] = damage;
  p.mass[id] = mass;
  p.ricochets[id] = ricochets;
  p.fuseT[id] = 0;
  p.ownerId[id] = ownerId;
  return id;
}

export function spawnShell(
  p: Projectiles,
  ox: number, oy: number, oz: number,
  vx: number, vy: number, vz: number,
  team: number,
  damage: number,
  mass: number,
  maxLife: number,
  fuseT: number,
  ownerId: number,
): number {
  const id = allocProjectile(p);
  if (id === -1) return -1;
  p.posX[id] = ox;
  p.posY[id] = oy;
  p.posZ[id] = oz;
  p.prevX[id] = ox;
  p.prevY[id] = oy;
  p.velX[id] = vx;
  p.velY[id] = vy;
  p.velZ[id] = vz;
  p.life[id] = maxLife;
  p.kind[id] = ProjectileKind.Shell;
  p.team[id] = team;
  p.damage[id] = damage;
  p.mass[id] = mass;
  p.ricochets[id] = 0;
  p.fuseT[id] = fuseT;
  p.ownerId[id] = ownerId;
  return id;
}
