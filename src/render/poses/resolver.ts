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
// Per-pose weapon attachment schema (see
// docs/superpowers/specs/2026-04-27-per-pose-weapon-attachment-design.md).
//
// A kit may declare a top-level `weapon` block listing per-facing entries that
// either author their own sprite (`src: 'self'`) or re-use another facing's
// sprite with a flip/rotate transform. Each body pose × facing then carries an
// optional `(x, y, rot)` to position that weapon for that pose. Missing pose
// entries derive from the mirror source (negate rot, flip x/y per transform).
// ----------------------------------------------------------------------------

/** 8-way compass facing. The weapon system ignores `omni`. */
export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export const FACINGS: readonly Facing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Texture-space transform applied when re-using a source facing's sprite. */
export type WeaponFacingTransform = 'flipX' | 'flipY' | 'rot180';

/** Either authored on this facing (`self`) or borrowed from another facing. */
export type WeaponFacingEntry =
  | { src: 'self' }
  | { src: Facing; transform: WeaponFacingTransform };

/** Top-level kit weapon block. */
export interface WeaponBlock {
  layerPrefix: string;
  facings: Record<Facing, WeaponFacingEntry>;
}

/**
 * Per-pose weapon attachment authoring.
 *
 * `(x, y, rot)` positions the weapon for this (pose, facing). The optional
 * `flipX`/`src`/`transform` fields override which weapon-source PNG is drawn:
 * the editor's click-to-assign weapon-pose picker writes them so a body pose
 * can use a different facing's musket sprite (e.g. present.S using the NE
 * musket). `src === 'self'` is the implicit default; when omitted the sprite
 * comes from the kit's canonical `weapon.facings[F]` mapping.
 */
export interface WeaponPoseTransform {
  x: number;
  y: number;
  rot: number;
  flipX?: true;
  src?: 'self' | Facing;
  transform?: WeaponFacingTransform | 'none';
}

/** Normalized shape for `kit.poses[pose][facing]`. */
export interface PoseFacingEntry {
  layers: string[];
  weapon?: WeaponPoseTransform;
  /**
   * Saved alternative weapon authorings for this (pose, facing). At runtime
   * the renderer pools `[weapon, ...weaponVariants]` and picks an index by
   * `entity.id % pool.length`, so soldiers in formation get visual variety
   * without flickering frame-to-frame.
   */
  weaponVariants?: WeaponPoseTransform[];
}

/**
 * Wraps a bare layer array (legacy shape) as a `PoseFacingEntry`. Already-shaped
 * inputs pass through unchanged.
 */
export function normalizePoseFacingEntry(
  raw: string[] | PoseFacingEntry,
): PoseFacingEntry {
  if (Array.isArray(raw)) return { layers: raw };
  return raw;
}

/**
 * Resolve which atlas key + transform to draw for a given facing of a weapon.
 *
 * - `src: 'self'` → key is `<layerPrefix>-<facing>`, transform is `'none'`.
 * - Otherwise → key is `<layerPrefix>-<src>`, transform is the entry's transform.
 */
export function resolveWeaponFacing(
  weapon: WeaponBlock,
  facing: Facing,
): { spriteKey: string; transform: 'none' | WeaponFacingTransform } {
  const entry = weapon.facings[facing];
  if (!entry) {
    throw new Error(`weapon block has no facing entry for '${facing}'`);
  }
  if (entry.src === 'self') {
    return { spriteKey: `${weapon.layerPrefix}-${facing}`, transform: 'none' };
  }
  return {
    spriteKey: `${weapon.layerPrefix}-${entry.src}`,
    transform: entry.transform,
  };
}

/**
 * Apply a facing transform to a `(x, y, rot)` triplet so an offset authored
 * on the source facing flows through unchanged to its derived facings.
 *
 * - `flipX`: mirror about the vertical axis → negate `x` and `rot`.
 * - `flipY`: mirror about the horizontal axis → negate `y` and `rot`.
 * - `rot180`: rotate 180° → negate both `x` and `y`; `rot` is unchanged
 *   (since rotating a rotation by 180° wraps to the same effective heading).
 */
function applyFacingTransform(
  base: WeaponPoseTransform,
  transform: WeaponFacingTransform,
): WeaponPoseTransform {
  switch (transform) {
    case 'flipX':
      return { x: -base.x, y: base.y, rot: -base.rot };
    case 'flipY':
      return { x: base.x, y: -base.y, rot: -base.rot };
    case 'rot180':
      return { x: -base.x, y: -base.y, rot: base.rot };
  }
}

/** Read `poses[pose][facing].weapon` if present, else null. */
function readPoseWeapon(
  poses: Record<string, Record<string, string[] | PoseFacingEntry>> | undefined,
  pose: string,
  facing: Facing,
): WeaponPoseTransform | null {
  if (!poses) return null;
  const poseEntry = poses[pose];
  if (!poseEntry) return null;
  const facingEntry = poseEntry[facing];
  if (!facingEntry) return null;
  const normalized = normalizePoseFacingEntry(facingEntry);
  if (!normalized.weapon) return null;
  const w = normalized.weapon;
  return { x: w.x, y: w.y, rot: w.rot };
}

/**
 * Pool the variants authored for a (pose, facing): `[weapon, ...weaponVariants]`.
 * Each entry is normalized to `{x, y, rot}` only — variants tune position for
 * formation variety; they cannot pick a different sprite than the canonical
 * `kit.weapon.facings[F]`.
 */
export function readWeaponVariantPool(
  poses: Record<string, Record<string, string[] | PoseFacingEntry>> | undefined,
  pose: string,
  facing: Facing,
): WeaponPoseTransform[] {
  if (!poses) return [];
  const poseEntry = poses[pose];
  if (!poseEntry) return [];
  const facingEntry = poseEntry[facing];
  if (!facingEntry) return [];
  const norm = normalizePoseFacingEntry(facingEntry);
  const out: WeaponPoseTransform[] = [];
  if (norm.weapon) out.push({ x: norm.weapon.x, y: norm.weapon.y, rot: norm.weapon.rot });
  if (Array.isArray(norm.weaponVariants)) {
    for (const v of norm.weaponVariants) {
      if (v && typeof v === 'object') out.push({ x: v.x, y: v.y, rot: v.rot });
    }
  }
  return out;
}

/**
 * Resolve the per-pose `(x, y, rot)` for a (pose, facing) on this kit.
 *
 * - If authored directly on `(pose, facing)`, return it.
 * - Else, if the facing is derived (`src !== 'self'`), pull the source
 *   facing's pose offset and apply the facing transform (`flipX`/`flipY`/
 *   `rot180`).
 * - Else fall back to `{ x: 0, y: 0, rot: 0 }`.
 */
export function resolveWeaponPoseTransform(
  poses: Record<string, Record<string, string[] | PoseFacingEntry>> | undefined,
  pose: string,
  facing: Facing,
  weapon: WeaponBlock,
): WeaponPoseTransform {
  const direct = readPoseWeapon(poses, pose, facing);
  if (direct) return direct;
  const entry = weapon.facings[facing];
  if (entry && entry.src !== 'self') {
    const source = readPoseWeapon(poses, pose, entry.src);
    if (source) return applyFacingTransform(source, entry.transform);
  }
  return { x: 0, y: 0, rot: 0 };
}
