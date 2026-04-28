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
// Weapon palette schema (see
// docs/superpowers/specs/2026-04-27-weapon-palette-design.md).
//
// A kit declares a flat `weaponPalette: WeaponPaletteEntry[]` of named entries
// — each carries its own (src, transform, x, y, rot, flipX) tuple. Per-pose
// authoring (`kit.poses[pose][dir].weapon` / `weaponVariants`) references
// palette entries by id (string), so the same entry can be reused across many
// (pose, dir) slots without duplication. `kit.weapon.layerPrefix` survives;
// the old `kit.weapon.facings` block is gone.
// ----------------------------------------------------------------------------

/** 8-way compass facing. The weapon system ignores `omni`. */
export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export const FACINGS: readonly Facing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Texture-space transform applied when re-using a source facing's sprite. */
export type WeaponFacingTransform = 'flipX' | 'flipY' | 'rot180';

/** A single named weapon entry in a kit's palette. */
export interface WeaponPaletteEntry {
  /** Unique within the kit; stable across edits. */
  id: string;
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

export type WeaponPalette = readonly WeaponPaletteEntry[];

/** Top-level kit weapon block. The palette carries the per-entry sprite choice. */
export interface WeaponBlock {
  layerPrefix: string;
}

/** Normalized shape for `kit.poses[pose][facing]`. */
export interface PoseFacingEntry {
  /** Single-frame layer list, or per-frame list of layer lists. */
  layers: string[] | string[][];
  /** Palette id of the primary weapon for this (pose, facing). */
  weapon?: string;
  /**
   * Palette ids of alternative weapon authorings for this (pose, facing).
   * Runtime pools `[weapon, ...weaponVariants]` and picks an index by
   * `entity.id % pool.length` so soldiers in formation get visual variety
   * without flickering frame-to-frame.
   */
  weaponVariants?: string[];
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
 * Look up a palette entry by id. Returns null on miss; logs a warning for
 * unknown ids so authoring drift surfaces in the console.
 */
export function resolvePaletteEntry(
  palette: WeaponPalette | undefined,
  id: string,
): WeaponPaletteEntry | null {
  if (!palette) return null;
  for (const entry of palette) {
    if (entry.id === id) return entry;
  }
  return null;
}

/**
 * Resolve which atlas key + transform to draw for a palette entry.
 *
 * `spriteKey` is `<layerPrefix>-<entry.src>`; transform defaults to `'none'`.
 */
export function resolveWeaponSpriteKey(
  layerPrefix: string,
  entry: WeaponPaletteEntry,
): { spriteKey: string; transform: 'none' | WeaponFacingTransform } {
  return {
    spriteKey: `${layerPrefix}-${entry.src}`,
    transform: entry.transform ?? 'none',
  };
}

/**
 * Resolve the palette entry referenced by `(pose, facing).weapon`. Returns
 * null when the pose entry, the facing entry, or the weapon id is missing —
 * or when the id doesn't exist in the palette. Unknown ids emit a warning.
 */
export function resolvePoseWeaponEntry(
  poses:
    | Record<string, Record<string, string[] | string[][] | PoseFacingEntry>>
    | undefined,
  pose: string,
  facing: Facing,
  palette: WeaponPalette | undefined,
): WeaponPaletteEntry | null {
  if (!poses) return null;
  const poseEntry = poses[pose];
  if (!poseEntry) return null;
  const facingEntry = poseEntry[facing];
  if (!facingEntry) return null;
  const normalized = normalizePoseFacingEntry(facingEntry);
  const id = normalized.weapon;
  if (typeof id !== 'string') return null;
  const resolved = resolvePaletteEntry(palette, id);
  if (!resolved) {
    console.warn(
      `[weapon-palette] unknown palette id '${id}' on (pose=${pose}, facing=${facing})`,
    );
    return null;
  }
  return resolved;
}

/**
 * Pool the variants authored for a (pose, facing): `[primary, ...variants]`,
 * each resolved through the palette. Unknown ids are skipped with a warning.
 * Returns an empty array when there's no primary weapon id.
 */
export function readWeaponVariantPool(
  poses:
    | Record<string, Record<string, string[] | string[][] | PoseFacingEntry>>
    | undefined,
  palette: WeaponPalette | undefined,
  pose: string,
  facing: Facing,
): WeaponPaletteEntry[] {
  if (!poses) return [];
  const poseEntry = poses[pose];
  if (!poseEntry) return [];
  const facingEntry = poseEntry[facing];
  if (!facingEntry) return [];
  const norm = normalizePoseFacingEntry(facingEntry);
  const out: WeaponPaletteEntry[] = [];
  if (typeof norm.weapon === 'string') {
    const primary = resolvePaletteEntry(palette, norm.weapon);
    if (primary) {
      out.push(primary);
    } else {
      console.warn(
        `[weapon-palette] unknown primary palette id '${norm.weapon}' on ` +
          `(pose=${pose}, facing=${facing})`,
      );
    }
  }
  if (Array.isArray(norm.weaponVariants)) {
    for (const id of norm.weaponVariants) {
      if (typeof id !== 'string') continue;
      const entry = resolvePaletteEntry(palette, id);
      if (entry) {
        out.push(entry);
      } else {
        console.warn(
          `[weapon-palette] unknown variant palette id '${id}' on ` +
            `(pose=${pose}, facing=${facing})`,
        );
      }
    }
  }
  return out;
}
