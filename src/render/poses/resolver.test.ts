import { describe, it, expect } from 'vitest';
import {
  buildDirLookup,
  normalizePoseFacingEntry,
  readWeaponVariantPool,
  resolveWeaponFacing,
  resolveWeaponPoseTransform,
  type Facing,
  type PoseFacingEntry,
  type WeaponBlock,
} from './resolver';
import { DIRECTIONS, type Direction } from './pose-config';

describe('buildDirLookup', () => {
  it('maps all 8 slots to omni when omni is available', () => {
    const lookup = buildDirLookup(['omni']);
    expect(lookup).toHaveLength(8);
    for (const d of lookup) {
      expect(d).toBe('omni');
    }
  });

  it('snaps 4-way [N,E,S,W] with horizontal tie-break preference', () => {
    const lookup = buildDirLookup(['N', 'E', 'S', 'W']);
    expect(lookup[0]).toBe('N'); // N
    expect(lookup[1]).toBe('E'); // NE → E
    expect(lookup[2]).toBe('E'); // E
    expect(lookup[3]).toBe('E'); // SE → E
    expect(lookup[4]).toBe('S'); // S
    expect(lookup[5]).toBe('W'); // SW → W
    expect(lookup[6]).toBe('W'); // W
    expect(lookup[7]).toBe('W'); // NW → W
  });

  it('maps every slot to S when only S is available', () => {
    const lookup = buildDirLookup(['S']);
    expect(lookup).toHaveLength(8);
    for (const d of lookup) {
      expect(d).toBe('S');
    }
  });

  it('returns identity when all 8 directions are available', () => {
    const all: Direction[] = [...DIRECTIONS];
    const lookup = buildDirLookup(all);
    for (let i = 0; i < 8; i++) {
      expect(lookup[i]).toBe(DIRECTIONS[i]);
    }
  });

  it('throws when no compass directions and no omni are provided', () => {
    expect(() => buildDirLookup([])).toThrow('pose has no directions');
  });
});

const MUSKET_BLOCK: WeaponBlock = {
  layerPrefix: 'musket-brown-bess',
  facings: {
    N: { src: 'self' },
    NW: { src: 'self' },
    W: { src: 'self' },
    S: { src: 'N', transform: 'flipY' },
    NE: { src: 'NW', transform: 'flipX' },
    SE: { src: 'NW', transform: 'rot180' },
    SW: { src: 'NW', transform: 'flipY' },
    E: { src: 'W', transform: 'flipX' },
  },
};

describe('normalizePoseFacingEntry', () => {
  it('wraps a bare layer array as { layers }', () => {
    const out = normalizePoseFacingEntry(['body-south-base', 'trousers-south']);
    expect(out).toEqual({ layers: ['body-south-base', 'trousers-south'] });
    // weapon is intentionally undefined for legacy entries.
    expect(out.weapon).toBeUndefined();
  });

  it('passes through an already-normalized entry', () => {
    const entry: PoseFacingEntry = {
      layers: ['body-south-base'],
      weapon: { x: 1, y: -2, rot: 20 },
    };
    expect(normalizePoseFacingEntry(entry)).toBe(entry);
  });

  it('passes through an entry without a weapon field', () => {
    const entry: PoseFacingEntry = { layers: ['body-south-base'] };
    expect(normalizePoseFacingEntry(entry)).toBe(entry);
  });
});

describe('resolveWeaponFacing', () => {
  it('returns the self sprite key with no transform on source facings', () => {
    expect(resolveWeaponFacing(MUSKET_BLOCK, 'N')).toEqual({
      spriteKey: 'musket-brown-bess-N',
      transform: 'none',
    });
    expect(resolveWeaponFacing(MUSKET_BLOCK, 'NW')).toEqual({
      spriteKey: 'musket-brown-bess-NW',
      transform: 'none',
    });
    expect(resolveWeaponFacing(MUSKET_BLOCK, 'W')).toEqual({
      spriteKey: 'musket-brown-bess-W',
      transform: 'none',
    });
  });

  it('S derives from N with flipY', () => {
    expect(resolveWeaponFacing(MUSKET_BLOCK, 'S')).toEqual({
      spriteKey: 'musket-brown-bess-N',
      transform: 'flipY',
    });
  });

  it('NE derives from NW with flipX', () => {
    expect(resolveWeaponFacing(MUSKET_BLOCK, 'NE')).toEqual({
      spriteKey: 'musket-brown-bess-NW',
      transform: 'flipX',
    });
  });

  it('SE derives from NW with rot180', () => {
    expect(resolveWeaponFacing(MUSKET_BLOCK, 'SE')).toEqual({
      spriteKey: 'musket-brown-bess-NW',
      transform: 'rot180',
    });
  });

  it('SW derives from NW with flipY', () => {
    expect(resolveWeaponFacing(MUSKET_BLOCK, 'SW')).toEqual({
      spriteKey: 'musket-brown-bess-NW',
      transform: 'flipY',
    });
  });

  it('E derives from W with flipX', () => {
    expect(resolveWeaponFacing(MUSKET_BLOCK, 'E')).toEqual({
      spriteKey: 'musket-brown-bess-W',
      transform: 'flipX',
    });
  });
});

describe('resolveWeaponPoseTransform', () => {
  it('returns the authored offset when present on the queried facing', () => {
    const poses: Record<string, Record<Facing, PoseFacingEntry>> = {
      fire: {
        N: { layers: [], weapon: { x: 1, y: -2, rot: 20 } },
        NW: { layers: [] },
        W: { layers: [] },
        S: { layers: [] },
        NE: { layers: [] },
        SE: { layers: [] },
        SW: { layers: [] },
        E: { layers: [] },
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'fire', 'N', MUSKET_BLOCK)).toEqual({
      x: 1,
      y: -2,
      rot: 20,
    });
  });

  it('inherits via flipY mirror (S from N) when omitted on the derived facing', () => {
    const poses: Record<string, Record<string, PoseFacingEntry | string[]>> = {
      fire: {
        N: { layers: [], weapon: { x: 3, y: 4, rot: 15 } },
        // S omits weapon → should derive from N via flipY: y negates, rot negates.
        S: { layers: [] },
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'fire', 'S', MUSKET_BLOCK)).toEqual({
      x: 3,
      y: -4,
      rot: -15,
    });
  });

  it('inherits via flipX mirror (NE from NW) when omitted', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      present: {
        NW: { layers: [], weapon: { x: 5, y: 6, rot: 30 } },
      },
    };
    // x and rot negate through flipX; y is unchanged. The inherited offset
    // sits on top of the canonical NE sprite (NW with flipX) — no per-pose
    // flip flag, since per-pose authoring can't pick a different sprite.
    expect(resolveWeaponPoseTransform(poses, 'present', 'NE', MUSKET_BLOCK)).toEqual({
      x: -5,
      y: 6,
      rot: -30,
    });
  });

  it('inherits via rot180 mirror (SE from NW): both x and y negate, rot unchanged', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      present: {
        NW: { layers: [], weapon: { x: 7, y: 8, rot: 45 } },
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'present', 'SE', MUSKET_BLOCK)).toEqual({
      x: -7,
      y: -8,
      rot: 45,
    });
  });

  it('inherits via flipX mirror (E from W) when omitted', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      hit: {
        W: { layers: [], weapon: { x: 2, y: -1, rot: -10 } },
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'hit', 'E', MUSKET_BLOCK)).toEqual({
      x: -2,
      y: -1,
      rot: 10,
    });
  });

  it('authored override beats mirror inheritance', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        N: { layers: [], weapon: { x: 3, y: 4, rot: 15 } },
        S: { layers: [], weapon: { x: 99, y: 99, rot: 99 } },
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'fire', 'S', MUSKET_BLOCK)).toEqual({
      x: 99,
      y: 99,
      rot: 99,
    });
  });

  it('falls back to zero when both the queried facing and its source are missing', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        NW: { layers: [] }, // source has no weapon
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'fire', 'NE', MUSKET_BLOCK)).toEqual({
      x: 0,
      y: 0,
      rot: 0,
    });
  });

  it('falls back to zero on a source facing when the source itself omits weapon', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        N: { layers: [] }, // source N, no weapon offset
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'fire', 'N', MUSKET_BLOCK)).toEqual({
      x: 0,
      y: 0,
      rot: 0,
    });
  });

  it('falls back to zero when the entire pose entry is absent', () => {
    expect(resolveWeaponPoseTransform({}, 'unknown-pose', 'S', MUSKET_BLOCK)).toEqual({
      x: 0,
      y: 0,
      rot: 0,
    });
  });

  it('reads pose offsets through the legacy bare-array shape (treats as no weapon)', () => {
    // Legacy entries normalize to { layers } with no weapon → falls back to 0.
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      legacy: {
        N: ['body-north-base'],
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'legacy', 'N', MUSKET_BLOCK)).toEqual({
      x: 0,
      y: 0,
      rot: 0,
    });
  });

  it('returns zero offset for a legacy bare-array facing mixed with new-shape facings in the same pose', () => {
    // After idle/walking/running map to editor poses, the runtime queries
    // these for legacy bare-array facings — must not crash, must return zero.
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      walking: {
        N: ['body-north-base'],
        S: { layers: ['body-south-base'], weapon: { x: 4, y: 5, rot: 6 } },
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'walking', 'N', MUSKET_BLOCK)).toEqual({
      x: 0,
      y: 0,
      rot: 0,
    });
    // Sanity: shaped facings in the same pose still resolve normally.
    expect(resolveWeaponPoseTransform(poses, 'walking', 'S', MUSKET_BLOCK)).toEqual({
      x: 4,
      y: 5,
      rot: 6,
    });
  });

});

describe('readWeaponVariantPool', () => {
  it('returns an empty pool for a legacy bare-array facing', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      walking: {
        N: ['body-north-base'],
      },
    };
    expect(readWeaponVariantPool(poses, 'walking', 'N')).toEqual([]);
  });

  it('returns [weapon, ...weaponVariants] when authored', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      idle: {
        N: {
          layers: [],
          weapon: { x: 1, y: 2, rot: 3 },
          weaponVariants: [
            { x: 4, y: 5, rot: 6 },
            { x: 7, y: 8, rot: 9 },
          ],
        },
      },
    };
    expect(readWeaponVariantPool(poses, 'idle', 'N')).toEqual([
      { x: 1, y: 2, rot: 3 },
      { x: 4, y: 5, rot: 6 },
      { x: 7, y: 8, rot: 9 },
    ]);
  });

  it('returns an empty pool when the pose entry is absent', () => {
    expect(readWeaponVariantPool({}, 'walking', 'N')).toEqual([]);
  });
});
