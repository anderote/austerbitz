import type { Rng } from '../../util/rng';
import {
  allocDebris,
  DebrisKind,
  MUSKET_GIB_CHANCE,
  MUSKET_NONLETHAL_GIB_CHANCE,
  MELEE_GIB_CHANCE,
  type Debris,
} from '../debris';
import type { HitKind } from './combat-events';
import type { KitGibInfo, KitGibTable } from '../kit-gib-table';
import { EMPTY_KIT_GIB_TABLE } from '../kit-gib-table';

// Chunk-id indices into public/sprites/gibs/manifest.json (order-coupled).
const CHUNK_HEAD          = 0;
const CHUNK_ARM           = 1; // existing — bare arm with tiny sleeve marker
const CHUNK_LEG           = 2; // existing — dark trouser/boot
const CHUNK_TORSO         = 3;
const CHUNK_HAT           = 4;
const CHUNK_MEAT_BLOB     = 5;
const CHUNK_ARM_UNIFORMED = 6; // full sleeve in team color
const CHUNK_ARM_BARE      = 7; // pure flesh (clean rip-off)
const CHUNK_LEG_TROUSERED = 8; // cream trousers + dark boot
const CHUNK_LEG_BARE      = 9; // pure flesh

/** Multiplier applied to GenericChunk tint when hit kind is 'explosion'. */
const EXPLOSION_CHAR_MUL = 0.5;

function rollLimbCount(rng: Rng, p1: number, p2: number): number {
  const r = rng.next();
  if (r < p1) return 1;
  if (r < p1 + p2) return 2;
  return 3;
}

/** Mass classification per chunk for speed/kick scaling. */
const LIGHT = new Set<number>([
  CHUNK_ARM, CHUNK_ARM_UNIFORMED, CHUNK_ARM_BARE,
  CHUNK_HAT, CHUNK_MEAT_BLOB,
]);

/**
 * One emit instruction. `kind` selects which renderer path the gib ends up on:
 * generic chunks read the gib atlas; kit-head / kit-weapon resolve their UV
 * from the combined sprite atlas at draw time, so the head/weapon look exactly
 * like the unit's actual sprite.
 */
interface EmitItem {
  kind: number;
  /** GenericChunk: chunk manifest id. KitHead/KitWeapon: ignored. */
  chunkId: number;
  /** GenericChunk only — multiplicative tint, RGB 0..255. */
  tint?: readonly [number, number, number];
}

export interface GibPlan {
  emits: EmitItem[];
  bloodBlobs: number;
}

/** Pick an arm variant when no kit info is available — old random distribution. */
function pickArmChunkRand(rng: Rng): number {
  const r = rng.next();
  if (r < 0.45) return CHUNK_ARM_UNIFORMED;
  if (r < 0.80) return CHUNK_ARM;
  return CHUNK_ARM_BARE;
}

/** Pick a leg variant when no kit info is available — old random distribution. */
function pickLegChunkRand(rng: Rng): number {
  const r = rng.next();
  if (r < 0.45) return CHUNK_LEG_TROUSERED;
  if (r < 0.80) return CHUNK_LEG;
  return CHUNK_LEG_BARE;
}

/**
 * Cheap kit-aware fall-through pick. When the kit declares a multi-id pool
 * (`armChunkIds` / `legChunkIds`), pick uniformly from it. Otherwise use the
 * kit's single `armChunkId` / `legChunkId`. Without any kit info, fall back
 * to the legacy random distribution across the generic variants.
 */
function pickArmChunkForKit(info: KitGibInfo | null, rng: Rng): number {
  if (!info) return pickArmChunkRand(rng);
  const pool = info.armChunkIds;
  if (pool.length > 0) return pool[rng.intRange(0, pool.length)]!;
  return info.armChunkId;
}
function pickLegChunkForKit(info: KitGibInfo | null, rng: Rng): number {
  if (!info) return pickLegChunkRand(rng);
  const pool = info.legChunkIds;
  if (pool.length > 0) return pool[rng.intRange(0, pool.length)]!;
  return info.legChunkId;
}
/**
 * Pick a misc-pool chunk id, or null if the kit has no misc pool. Used by
 * `planFullDismemberment` to occasionally throw a flavour chunk (epaulette,
 * cartridge box, etc.) into a cannon/explosion blast.
 */
function pickMiscChunkForKit(info: KitGibInfo | null, rng: Rng): number | null {
  if (!info) return null;
  const pool = info.miscChunkIds;
  if (pool.length === 0) return null;
  return pool[rng.intRange(0, pool.length)]!;
}

/** Probability of a bonus misc-pool chunk in a full-dismemberment plan. */
const MISC_BONUS_CHANCE = 0.30;

/**
 * Lethal cannon/explosion deaths roll a varied limb mix per kill so adjacent
 * kills don't look identical. Counts are randomized; kit-real head/weapon and
 * the bonus generic head (for shako separation) are deterministic given the
 * kit. Generic-chunk fall-through still applies when the kit is unknown.
 */
function planFullDismemberment(rng: Rng, info: KitGibInfo | null): GibPlan {
  const emits: EmitItem[] = [];
  const tint = info?.gibTint ?? [255, 255, 255];
  if (info && info.hasHead) {
    // Shako separation: kit-real head AND a generic skull tinted by the kit.
    emits.push({ kind: DebrisKind.KitHead, chunkId: 0 });
    emits.push({ kind: DebrisKind.GenericChunk, chunkId: CHUNK_HEAD, tint });
  } else {
    emits.push({ kind: DebrisKind.GenericChunk, chunkId: CHUNK_HEAD, tint });
  }
  if (info && info.hasWeapon) {
    emits.push({ kind: DebrisKind.KitWeapon, chunkId: 0 });
  }
  // arms: P(1)=0.20, P(2)=0.55, P(3)=0.25.
  const armCount = rollLimbCount(rng, 0.20, 0.55);
  for (let i = 0; i < armCount; i++) {
    emits.push({ kind: DebrisKind.GenericChunk, chunkId: pickArmChunkForKit(info, rng), tint });
  }
  // legs: P(1)=0.30, P(2)=0.55, P(3)=0.15.
  const legCount = rollLimbCount(rng, 0.30, 0.55);
  for (let i = 0; i < legCount; i++) {
    emits.push({ kind: DebrisKind.GenericChunk, chunkId: pickLegChunkForKit(info, rng), tint });
  }
  if (rng.next() < 0.25) {
    emits.push({ kind: DebrisKind.GenericChunk, chunkId: CHUNK_TORSO, tint });
  }
  if (rng.next() < 0.15) {
    emits.push({ kind: DebrisKind.GenericChunk, chunkId: CHUNK_HAT, tint });
  }
  // Bonus misc — only fires when the kit declares a misc pool.
  if (rng.next() < MISC_BONUS_CHANCE) {
    const miscId = pickMiscChunkForKit(info, rng);
    if (miscId !== null) {
      emits.push({ kind: DebrisKind.GenericChunk, chunkId: miscId, tint });
    }
  }
  const bloodBlobs = 2 + rng.intRange(0, 3);
  return { emits, bloodBlobs };
}

export function planGibSpawn(
  rng: Rng,
  hit: HitKind,
  lethal: boolean,
  info: KitGibInfo | null,
): GibPlan {
  if (!lethal) {
    if (hit !== 'musket') return { emits: [], bloodBlobs: 0 };
    if (rng.next() >= MUSKET_NONLETHAL_GIB_CHANCE) return { emits: [], bloodBlobs: 0 };
    const tint = info?.gibTint ?? [255, 255, 255];
    const id = rng.next() < 0.5 ? pickArmChunkForKit(info, rng) : pickLegChunkForKit(info, rng);
    return { emits: [{ kind: DebrisKind.GenericChunk, chunkId: id, tint }], bloodBlobs: 0 };
  }
  switch (hit) {
    case 'cannon':
    case 'explosion':
      return planFullDismemberment(rng, info);
    case 'melee':
    case 'charge': {
      if (rng.next() >= MELEE_GIB_CHANCE) return { emits: [], bloodBlobs: 0 };
      const tint = info?.gibTint ?? [255, 255, 255];
      const r = rng.next();
      if (r < 0.5) {
        return {
          emits: [{ kind: DebrisKind.GenericChunk, chunkId: pickArmChunkForKit(info, rng), tint }],
          bloodBlobs: rng.intRange(0, 3),
        };
      }
      if (r < 0.8) {
        return {
          emits: [{ kind: DebrisKind.GenericChunk, chunkId: pickLegChunkForKit(info, rng), tint }],
          bloodBlobs: rng.intRange(0, 3),
        };
      }
      // Head — kit-real if we know the kit, otherwise generic.
      const head: EmitItem = info && info.hasHead
        ? { kind: DebrisKind.KitHead, chunkId: 0 }
        : { kind: DebrisKind.GenericChunk, chunkId: CHUNK_HEAD };
      return { emits: [head], bloodBlobs: rng.intRange(0, 3) };
    }
    case 'musket': {
      if (rng.next() >= MUSKET_GIB_CHANCE) return { emits: [], bloodBlobs: 0 };
      const tint = info?.gibTint ?? [255, 255, 255];
      const r = rng.next();
      if (r < 0.30) {
        return {
          emits: [{ kind: DebrisKind.GenericChunk, chunkId: CHUNK_HAT, tint }],
          bloodBlobs: 0,
        };
      }
      if (r < 0.65) {
        return {
          emits: [{ kind: DebrisKind.GenericChunk, chunkId: pickArmChunkForKit(info, rng), tint }],
          bloodBlobs: 0,
        };
      }
      if (r < 0.85) {
        return {
          emits: [{ kind: DebrisKind.GenericChunk, chunkId: pickLegChunkForKit(info, rng), tint }],
          bloodBlobs: 0,
        };
      }
      return {
        emits: [{ kind: DebrisKind.GenericChunk, chunkId: CHUNK_MEAT_BLOB }],
        bloodBlobs: 0,
      };
    }
  }
}

export function spawnGibs(
  d: Debris,
  rng: Rng,
  hit: HitKind,
  x: number,
  y: number,
  impX: number,
  impY: number,
  team: number,
  lethal: boolean = true,
  kindIdx: number = 0,
  facing: number = 0,
  table: KitGibTable = EMPTY_KIT_GIB_TABLE,
): void {
  const info = table.byKindIdx[kindIdx] ?? null;
  const plan = planGibSpawn(rng, hit, lethal, info);

  // Direction from impulse, or random if zero.
  let dirX = impX;
  let dirY = impY;
  const mag = Math.hypot(dirX, dirY);
  if (mag < 1e-6) {
    const a = rng.next() * Math.PI * 2;
    dirX = Math.cos(a);
    dirY = Math.sin(a);
  } else {
    dirX /= mag;
    dirY /= mag;
  }

  const isExplosion = hit === 'explosion';
  const emitOne = (item: EmitItem) => {
    const id = allocDebris(d);
    if (id < 0) return;
    const isLight = item.kind === DebrisKind.GenericChunk
      ? LIGHT.has(item.chunkId)
      : item.kind === DebrisKind.KitHead;

    // Jitter direction ±30°.
    const jitter = (rng.next() - 0.5) * (Math.PI / 3);
    const c = Math.cos(jitter);
    const s = Math.sin(jitter);
    const jx = dirX * c - dirY * s;
    const jy = dirX * s + dirY * c;

    const speedBase = isLight ? 18 : 11;
    const speedBonus = hit === 'explosion' && !isLight ? 1.3 : 1.0;
    const speed = rng.range(0.7, 1.2) * speedBase * speedBonus;
    const upZ =
      hit === 'explosion'
        ? (isLight ? rng.range(8, 12) : rng.range(5, 9))
        : (isLight ? rng.range(5, 8) : rng.range(3, 5));

    d.posX[id] = x;
    d.posY[id] = y;
    d.z[id] = 0;
    d.velX[id] = jx * speed;
    d.velY[id] = jy * speed;
    d.velZ[id] = upZ;
    d.spinDeg[id] = 0;
    d.spinRate[id] = rng.range(-540, 540);
    d.ttl[id] = rng.range(4, 7);
    d.bounces[id] = 0;
    d.kind[id] = item.kind;
    d.chunkId[id] = item.chunkId;
    d.team[id] = team;
    d.kitIdx[id] = info ? info.kitIdx : 0xff;
    d.facing[id] = facing & 7;
    let tR = item.tint ? item.tint[0] : 255;
    let tG = item.tint ? item.tint[1] : 255;
    let tB = item.tint ? item.tint[2] : 255;
    // Explosion-charred: only generic chunks darken; kit-real heads/weapons keep regiment colors.
    if (isExplosion && item.kind === DebrisKind.GenericChunk) {
      tR = Math.round(tR * EXPLOSION_CHAR_MUL);
      tG = Math.round(tG * EXPLOSION_CHAR_MUL);
      tB = Math.round(tB * EXPLOSION_CHAR_MUL);
    }
    d.tintR[id] = tR;
    d.tintG[id] = tG;
    d.tintB[id] = tB;
    d.fromExplosion[id] = isExplosion ? 1 : 0;
    d.smokeT[id] = 0;
  };

  for (const item of plan.emits) emitOne(item);
  for (let i = 0; i < plan.bloodBlobs; i++) {
    emitOne({ kind: DebrisKind.GenericChunk, chunkId: CHUNK_MEAT_BLOB });
  }
}
