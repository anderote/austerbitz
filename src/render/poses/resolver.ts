import { DIRECTIONS, type Direction } from './pose-config';

const HORIZONTALNESS: Record<Exclude<Direction, 'omni'>, number> = {
  N: 0,
  NE: 1,
  E: 2,
  SE: 1,
  S: 0,
  SW: 1,
  W: 2,
  NW: 1,
};

export function buildDirLookup(available: readonly Direction[]): Direction[] {
  if (available.includes('omni')) {
    return Array(8).fill('omni') as Direction[];
  }
  const compass = available.filter((d): d is Exclude<Direction, 'omni'> => d !== 'omni');
  if (compass.length === 0) throw new Error('pose has no directions');
  const result: Direction[] = new Array(8);
  for (let i = 0; i < 8; i++) {
    let best: Exclude<Direction, 'omni'> = compass[0]!;
    let bestDist = 9;
    let bestHoriz = -1;
    let bestCw = 9;
    for (const d of compass) {
      const j = DIRECTIONS.indexOf(d);
      const cw = (i - j + 8) % 8;
      const ccw = (j - i + 8) % 8;
      const dist = Math.min(cw, ccw);
      const horiz = HORIZONTALNESS[d];
      if (
        dist < bestDist ||
        (dist === bestDist && horiz > bestHoriz) ||
        (dist === bestDist && horiz === bestHoriz && cw < bestCw)
      ) {
        best = d;
        bestDist = dist;
        bestHoriz = horiz;
        bestCw = cw;
      }
    }
    result[i] = best;
  }
  return result;
}

// ----------------------------------------------------------------------------
// Inline weapon orientation schema (see
// docs/superpowers/specs/2026-04-28-weapon-pose-palette-design.md).
//
// Each `(pose, facing)` carries its own `weapons?: WeaponOrientation[]` array.
// The first entry is the primary; remaining entries are variants. The runtime
// picks `entity.id % weapons.length` so soldiers in formation get visual
// variety without flickering frame-to-frame. The kit-level palette
// indirection is gone.
// ----------------------------------------------------------------------------

/** 8-way compass facing. The weapon system ignores `omni`. */
export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export const FACINGS: readonly Facing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Texture-space transform applied when re-using a source facing's sprite. */
export type WeaponFacingTransform = 'flipX' | 'flipY' | 'rot180';

/**
 * A single weapon orientation authored on a `(pose, facing)` cell. Carries the
 * full `(src, transform, x, y, rot, flipX)` tuple inline — no kit-level
 * indirection.
 */
export interface WeaponOrientation {
  /** Which authored source PNG to sample. */
  src: Facing;
  /** Texture-space transform on the source UV (default 'none'). */
  transform?: WeaponFacingTransform;
  /** Pixel offset relative to the body sprite center. */
  x: number;
  y: number;
  /** Rotation in degrees (+ccw, matches today's authoring). */
  rot: number;
  /** Optional additional UV horizontal flip on top of `transform`. */
  flipX?: true;
}

/** Top-level kit weapon block. */
export interface WeaponBlock {
  layerPrefix: string;
}

/** Normalized shape for `kit.poses[pose][facing]`. */
export interface PoseFacingEntry {
  /** Single-frame layer list, or per-frame list of layer lists. */
  layers: string[] | string[][];
  /**
   * Inline weapon orientations: `[primary, ...variants]`. Runtime picks
   * `entity.id % weapons.length` so soldiers in formation get visual variety
   * without flickering frame-to-frame. Empty/missing → no weapon overlay.
   */
  weapons?: WeaponOrientation[];
}

/**
 * Wraps a bare layer array (legacy shape) as a `PoseFacingEntry`. Already-shaped
 * inputs pass through unchanged.
 */
export function normalizePoseFacingEntry(
  raw: string[] | string[][] | PoseFacingEntry,
): PoseFacingEntry {
  if (Array.isArray(raw)) return { layers: raw as string[] | string[][] };
  return raw;
}

/**
 * Resolve which atlas key + transform to draw for a weapon orientation.
 *
 * `spriteKey` is `<layerPrefix>-<orientation.src>`; transform defaults to
 * `'none'`.
 */
export function resolveWeaponSpriteKey(
  layerPrefix: string,
  orientation: WeaponOrientation,
): { spriteKey: string; transform: 'none' | WeaponFacingTransform } {
  return {
    spriteKey: `${layerPrefix}-${orientation.src}`,
    transform: orientation.transform ?? 'none',
  };
}

/**
 * Read the inline weapon-orientation pool for a `(pose, facing)`. Returns
 * `(pose, facing).weapons ?? []`. Order is preserved (primary first). Returns
 * an empty array for missing pose / facing / `weapons` field, and for legacy
 * bare-array facing entries.
 */
export function readWeaponVariantPool(
  poses:
    | Record<string, Record<string, string[] | string[][] | PoseFacingEntry>>
    | undefined,
  pose: string,
  facing: Facing,
): WeaponOrientation[] {
  if (!poses) return [];
  const poseEntry = poses[pose];
  if (!poseEntry) return [];
  const facingEntry = poseEntry[facing];
  if (!facingEntry) return [];
  const norm = normalizePoseFacingEntry(facingEntry);
  return Array.isArray(norm.weapons) ? norm.weapons : [];
}
