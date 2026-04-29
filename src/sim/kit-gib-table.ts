import type { KitConfig } from '../render/poses/kit-loader';
import { unitKinds } from '../data/units';

export interface KitGibInfo {
  /** Stable runtime index — also written into `Debris.kitIdx` for kit gibs. */
  kitIdx: number;
  /** Unit kindId index (mirrors `entities.kindId`). */
  kindIdx: number;
  hasWeapon: boolean;
  hasHead: boolean;
  /** Generic-chunk variant id used for legs of this kit's deaths. */
  legChunkId: number;
  /** Generic-chunk variant id used for arms of this kit's deaths. */
  armChunkId: number;
  /** Multiplicative tint (RGB 0..255) applied to legs/arms. White = neutral. */
  gibTint: [number, number, number];
}

export interface KitGibTable {
  /** Sparse — null for kindIdxes whose kit isn't loaded. */
  byKindIdx: ReadonlyArray<KitGibInfo | null>;
  /** Same entries packed densely — kit-pass uses this to map `kitIdx → KitGibInfo`. */
  byKitIdx: ReadonlyArray<KitGibInfo>;
}

/** Same chunk ids as in debris-emit.ts — duplicated here to avoid a cross-import. */
const CHUNK_LEG           = 2;
const CHUNK_LEG_TROUSERED = 8;
const CHUNK_LEG_BARE      = 9;
const CHUNK_ARM_UNIFORMED = 6;
const CHUNK_ARM_BARE      = 7;

function pickLegChunkForKit(kitId: string): number {
  switch (kitId) {
    case 'line-infantry':
      return CHUNK_LEG_TROUSERED;
    case 'cuirassier':
      return CHUNK_LEG;
    default:
      return CHUNK_LEG_BARE;
  }
}

function pickArmChunkForKit(kitId: string): number {
  switch (kitId) {
    case 'line-infantry':
      return CHUNK_ARM_UNIFORMED;
    case 'cuirassier':
      return CHUNK_ARM_UNIFORMED;
    default:
      return CHUNK_ARM_BARE;
  }
}

/**
 * Build the per-kit gib-spawn lookup. Kits without a configured `gibTint` get
 * a neutral white tint (no recolour). Kindexes whose kit is not in the loaded
 * `kits` map get a null entry → sim falls back to plain generic chunks.
 */
export function buildKitGibTable(kits: ReadonlyMap<string, KitConfig>): KitGibTable {
  const byKitIdx: KitGibInfo[] = [];
  const byKindIdx: Array<KitGibInfo | null> = [];
  for (let kindIdx = 0; kindIdx < unitKinds.length; kindIdx++) {
    const kind = unitKinds[kindIdx]!;
    const kit = kits.get(kind.id);
    if (!kit) {
      byKindIdx.push(null);
      continue;
    }
    const info: KitGibInfo = {
      kitIdx: byKitIdx.length,
      kindIdx,
      hasWeapon: kit.weapon != null,
      hasHead: kit.head != null,
      legChunkId: pickLegChunkForKit(kit.id),
      armChunkId: pickArmChunkForKit(kit.id),
      gibTint: kit.gibTint ?? [255, 255, 255],
    };
    byKitIdx.push(info);
    byKindIdx.push(info);
  }
  return { byKindIdx, byKitIdx };
}

/** An empty table — caller-side default that produces no kit gibs (legacy path). */
export const EMPTY_KIT_GIB_TABLE: KitGibTable = { byKindIdx: [], byKitIdx: [] };
