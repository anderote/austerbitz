import type { CanisterProfile } from '../data/weapons/types';
import { gaussian, type Rng } from '../util/rng';
import { rollDamage } from './damage-roll';

export const ProjectileKind = {
  Musket:    0,
  SolidShot: 1,
  Shell:     2,
} as const;
export type ProjectileKind = (typeof ProjectileKind)[keyof typeof ProjectileKind];

/**
 * Optional per-projectile ballistics: range falloff curve params + pierce
 * config. Omitted (or zeroed) ⇒ no falloff (`mul = 1`) and free-on-first-hit
 * (the original behaviour).
 */
export interface BallisticsParams {
  falloffNearM?: number;
  falloffDecayK?: number;     // 0 = disabled
  falloffMinMul?: number;     // default 0
  pierceMinDamage?: number;   // 0 = disabled (free on first hit)
  piercePerTargetMul?: number;
  pierceVelMul?: number;      // default 1
}

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
  crit: Uint8Array;              // 1 = was rolled as a critical hit at fire time
  // Range falloff: damage at hit time scales by exp(-decayK * max(0, dist - nearM)),
  // floored at minMul. decayK == 0 disables falloff.
  spawnX: Float32Array;
  spawnY: Float32Array;
  falloffNearM: Float32Array;
  falloffDecayK: Float32Array;
  falloffMinMul: Float32Array;
  // Pierce: after each hit, damage *= piercePerTargetMul and velocity *= pierceVelMul;
  // free once damage drops below pierceMinDamage. piercePerTargetMul == 0 ⇒ free on first hit.
  pierceMinDamage: Float32Array;
  piercePerTargetMul: Float32Array;
  pierceVelMul: Float32Array;

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
    crit: new Uint8Array(capacity),
    spawnX: new Float32Array(capacity),
    spawnY: new Float32Array(capacity),
    falloffNearM: new Float32Array(capacity),
    falloffDecayK: new Float32Array(capacity),
    falloffMinMul: new Float32Array(capacity),
    pierceMinDamage: new Float32Array(capacity),
    piercePerTargetMul: new Float32Array(capacity),
    pierceVelMul: new Float32Array(capacity),
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
  p.crit[id] = 0;
  p.spawnX[id] = 0;
  p.spawnY[id] = 0;
  p.falloffNearM[id] = 0;
  p.falloffDecayK[id] = 0;       // 0 ⇒ falloff disabled
  p.falloffMinMul[id] = 0;
  p.pierceMinDamage[id] = 0;
  p.piercePerTargetMul[id] = 0;  // 0 ⇒ free on first hit
  p.pierceVelMul[id] = 1;
  return id;
}

export function freeProjectile(p: Projectiles, id: number): void {
  if (!p.alive[id]) return;
  p.alive[id] = 0;
  p.count--;
  p.freeListNext[id] = p.freeListHead;
  p.freeListHead = id;
}

function writeBallistics(
  p: Projectiles,
  id: number,
  ox: number, oy: number,
  b: BallisticsParams | undefined,
): void {
  p.spawnX[id] = ox;
  p.spawnY[id] = oy;
  p.falloffNearM[id] = b?.falloffNearM ?? 0;
  p.falloffDecayK[id] = b?.falloffDecayK ?? 0;
  p.falloffMinMul[id] = b?.falloffMinMul ?? 0;
  p.pierceMinDamage[id] = b?.pierceMinDamage ?? 0;
  p.piercePerTargetMul[id] = b?.piercePerTargetMul ?? 0;
  p.pierceVelMul[id] = b?.pierceVelMul ?? 1;
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
  crit: 0 | 1 = 0,
  ballistics?: BallisticsParams,
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
  p.crit[id] = crit;
  writeBallistics(p, id, ox, oy, ballistics);
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
  crit: 0 | 1 = 0,
  ballistics?: BallisticsParams,
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
  p.crit[id] = crit;
  writeBallistics(p, id, ox, oy, ballistics);
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
  crit: 0 | 1 = 0,
  ballistics?: BallisticsParams,
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
  p.crit[id] = crit;
  writeBallistics(p, id, ox, oy, ballistics);
  return id;
}

/**
 * Fire a canister round: spawn `ballCount` musket-class projectiles in a
 * Gaussian cone. Each ball decays via the standard musket projectile path.
 */
export function spawnCanister(
  p: Projectiles,
  ox: number, oy: number,
  dirX: number, dirY: number,
  team: number,
  profile: CanisterProfile,
  ownerId: number,
  rng: Rng,
): void {
  const baseAngle = Math.atan2(dirY, dirX);
  const sigma = profile.spreadSigmaDeg * Math.PI / 180;
  for (let i = 0; i < profile.ballCount; i++) {
    const j = gaussian(rng) * sigma;
    const a = baseAngle + j;
    const sp = profile.muzzleSpeed * (1 + (rng.next() * 2 - 1) * profile.speedJitter);
    const roll = rollDamage(
      profile.ballDamage,
      profile.ballDamageVarianceFrac ?? 0,
      profile.ballCritChance ?? 0,
      profile.ballCritMul ?? 1.5,
      rng,
    );
    spawnMusketBall(
      p, ox, oy,
      Math.cos(a), Math.sin(a),
      team,
      roll.damage,
      sp,
      profile.ballMass,
      profile.ballMaxLife,
      ownerId,
      roll.crit ? 1 : 0,
    );
  }
}
