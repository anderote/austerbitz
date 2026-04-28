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

/** Per-pose weapon attachment offset + rotation (degrees) + optional mirror. */
export interface WeaponPoseTransform {
  x: number;
  y: number;
  rot: number;
  /**
   * Per-pose horizontal mirror of the *authored* sprite, applied BEFORE the
   * facing-share transform. Defaults to `false` and is omitted from JSON in
   * that case to keep diffs small. Lets the editor flip the weapon for one
   * (pose, facing) without re-authoring the source PNG.
   */
  flipX?: boolean;
}

/** Normalized shape for `kit.poses[pose][facing]`. */
export interface PoseFacingEntry {
  layers: string[];
  weapon?: WeaponPoseTransform;
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
 * Apply a facing transform to a `(x, y, rot)` triplet.
 *
 * The transform encodes how the runtime mirrors the *base sprite*; we mirror
 * the per-pose offset the same way so a hand-authored offset on a source
 * facing flows through unchanged to its derived facings.
 *
 * - `flipX`: mirror about the vertical axis → negate `x` and `rot`.
 * - `flipY`: mirror about the horizontal axis → negate `y` and `rot`.
 * - `rot180`: rotate 180° → negate both `x` and `y`; `rot` is unchanged
 *   (since rotating a rotation by 180° wraps to the same effective heading).
 *
 * `flipX` inheritance: when the facing-share transform is itself `flipX`,
 * the source's `flipX` flag XORs against `true` (so a flipped source becomes
 * un-flipped when the derived facing already mirrors it; an un-flipped source
 * becomes flipped). For `flipY` and `rot180`, `flipX` propagates unchanged
 * (those transforms don't mirror the X axis on their own).
 */
function applyFacingTransform(
  base: WeaponPoseTransform,
  transform: WeaponFacingTransform,
): WeaponPoseTransform {
  const baseFlip = base.flipX === true;
  switch (transform) {
    case 'flipX':
      return withFlipX({ x: -base.x, y: base.y, rot: -base.rot }, !baseFlip);
    case 'flipY':
      return withFlipX({ x: base.x, y: -base.y, rot: -base.rot }, baseFlip);
    case 'rot180':
      return withFlipX({ x: -base.x, y: -base.y, rot: base.rot }, baseFlip);
  }
}

/**
 * Helper: attach `flipX: true` to a `WeaponPoseTransform`, omit when false.
 * Keeps the JSON shape minimal (no `flipX: false` keys cluttering kit files).
 */
function withFlipX(t: WeaponPoseTransform, flipX: boolean): WeaponPoseTransform {
  return flipX ? { ...t, flipX: true } : t;
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
  // Normalize: only include flipX when explicitly true so equality checks /
  // JSON output stay clean.
  const w = normalized.weapon;
  return w.flipX === true ? { ...w, flipX: true } : { x: w.x, y: w.y, rot: w.rot };
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
