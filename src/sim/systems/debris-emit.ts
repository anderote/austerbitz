import type { Rng } from '../../util/rng';
import {
  allocDebris,
  MUSKET_GIB_CHANCE,
  MUSKET_NONLETHAL_GIB_CHANCE,
  MELEE_GIB_CHANCE,
  type Debris,
} from '../debris';
import type { HitKind } from './combat-events';

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

/** Mass classification per chunk for speed/kick scaling. */
const LIGHT = new Set<number>([
  CHUNK_ARM, CHUNK_ARM_UNIFORMED, CHUNK_ARM_BARE,
  CHUNK_HAT, CHUNK_MEAT_BLOB,
]);

/**
 * Pick an arm variant. Most arms come off still wearing a sleeve, so the
 * uniformed and original (sleeve-marker) variants dominate; bare flesh is
 * rarer (clean rip at the shoulder).
 */
function pickArmChunk(rng: Rng): number {
  const r = rng.next();
  if (r < 0.45) return CHUNK_ARM_UNIFORMED;
  if (r < 0.80) return CHUNK_ARM;
  return CHUNK_ARM_BARE;
}

/** Pick a leg variant — trousered & dark-boot dominant, bare rare. */
function pickLegChunk(rng: Rng): number {
  const r = rng.next();
  if (r < 0.45) return CHUNK_LEG_TROUSERED;
  if (r < 0.80) return CHUNK_LEG;
  return CHUNK_LEG_BARE;
}

export interface GibPlan {
  chunks: number[];     // chunk ids, ordered
  bloodBlobs: number;   // count of meat-blob extras
}

export function planGibSpawn(rng: Rng, kind: HitKind, lethal: boolean = true): GibPlan {
  // Non-lethal hits only produce gibs for muskets — and only limbs (the
  // soldier survives the shot but loses an arm or leg). Other kinds either
  // don't fire on non-lethal (cannon/explosion always lethal in practice)
  // or already gate themselves above.
  if (!lethal) {
    if (kind !== 'musket') return { chunks: [], bloodBlobs: 0 };
    if (rng.next() >= MUSKET_NONLETHAL_GIB_CHANCE) return { chunks: [], bloodBlobs: 0 };
    const id = rng.next() < 0.5 ? pickArmChunk(rng) : pickLegChunk(rng);
    return { chunks: [id], bloodBlobs: 0 };
  }
  switch (kind) {
    case 'cannon':
    case 'explosion': {
      const chunks: number[] = [CHUNK_TORSO, CHUNK_HEAD, CHUNK_HAT];
      // 1–2 arms.
      const arms = 1 + rng.intRange(0, 2);
      for (let i = 0; i < arms; i++) chunks.push(pickArmChunk(rng));
      // 0–1 leg(s) — keep total in 4–6 range.
      if (chunks.length < 6 && rng.next() < 0.6) chunks.push(pickLegChunk(rng));
      const bloodBlobs = 4 + rng.intRange(0, 5); // 4..8
      return { chunks: chunks.slice(0, 6), bloodBlobs };
    }
    case 'melee':
    case 'charge': {
      if (rng.next() >= MELEE_GIB_CHANCE) return { chunks: [], bloodBlobs: 0 };
      const r = rng.next();
      const id = r < 0.5 ? pickArmChunk(rng) : r < 0.8 ? pickLegChunk(rng) : CHUNK_HEAD;
      return { chunks: [id], bloodBlobs: rng.intRange(0, 3) };
    }
    case 'musket': {
      if (rng.next() >= MUSKET_GIB_CHANCE) return { chunks: [], bloodBlobs: 0 };
      // 30% HAT (knocked off, no dismemberment), 35% ARM, 20% LEG, 15% MEAT_BLOB.
      // Limbs together (55%) are the dominant outcome: muskets shoot off arms
      // and legs as a visible signature.
      const r = rng.next();
      const id =
        r < 0.30 ? CHUNK_HAT
        : r < 0.65 ? pickArmChunk(rng)
        : r < 0.85 ? pickLegChunk(rng)
        : CHUNK_MEAT_BLOB;
      return { chunks: [id], bloodBlobs: 0 };
    }
  }
}

export function spawnGibs(
  d: Debris,
  rng: Rng,
  kind: HitKind,
  x: number,
  y: number,
  impX: number,
  impY: number,
  team: number,
  lethal: boolean = true,
): void {
  const plan = planGibSpawn(rng, kind, lethal);

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

  const emitOne = (chunkId: number) => {
    const id = allocDebris(d);
    if (id < 0) return;
    const light = LIGHT.has(chunkId);

    // Jitter direction ±30°.
    const jitter = (rng.next() - 0.5) * (Math.PI / 3);
    const c = Math.cos(jitter);
    const s = Math.sin(jitter);
    const jx = dirX * c - dirY * s;
    const jy = dirX * s + dirY * c;

    const speed = rng.range(0.7, 1.2) * (light ? 18 : 11);
    const upZ = light ? rng.range(5, 8) : rng.range(3, 5);

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
    d.chunkId[id] = chunkId;
    d.team[id] = team;
  };

  for (const chunkId of plan.chunks) emitOne(chunkId);
  for (let i = 0; i < plan.bloodBlobs; i++) emitOne(CHUNK_MEAT_BLOB);
}
