import { describe, it, expect } from 'vitest';
import {
  buildDirLookup,
  normalizePoseFacingEntry,
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
    // Per spec: a flipX facing-share with an unflipped source yields flipX:true
    // on the derived facing (XOR true).
    expect(resolveWeaponPoseTransform(poses, 'present', 'NE', MUSKET_BLOCK)).toEqual({
      x: -5,
      y: 6,
      rot: -30,
      flipX: true,
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
    // Per spec: flipX facing-share + unflipped source → flipX:true.
    expect(resolveWeaponPoseTransform(poses, 'hit', 'E', MUSKET_BLOCK)).toEqual({
      x: -2,
      y: -1,
      rot: 10,
      flipX: true,
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

  // ----- flipX-related inheritance tests -----

  it('returns authored flipX on the queried facing', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        N: { layers: [], weapon: { x: 1, y: 2, rot: 3, flipX: true } },
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'fire', 'N', MUSKET_BLOCK)).toEqual({
      x: 1,
      y: 2,
      rot: 3,
      flipX: true,
    });
  });

  it('omits flipX when stored value is false (or undefined) on direct read', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        N: { layers: [], weapon: { x: 1, y: 2, rot: 3 } },
      },
    };
    const out = resolveWeaponPoseTransform(poses, 'fire', 'N', MUSKET_BLOCK);
    expect(out.flipX).toBeUndefined();
    expect(out).toEqual({ x: 1, y: 2, rot: 3 });
  });

  it('inherits flipX through flipY mirror unchanged (S from N): flipped stays flipped', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        N: { layers: [], weapon: { x: 0, y: 0, rot: 0, flipX: true } },
      },
    };
    const out = resolveWeaponPoseTransform(poses, 'fire', 'S', MUSKET_BLOCK);
    expect(out.flipX).toBe(true);
  });

  it('inherits flipX through flipY mirror unchanged (S from N): unflipped stays unflipped', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        N: { layers: [], weapon: { x: 0, y: 0, rot: 0 } },
      },
    };
    const out = resolveWeaponPoseTransform(poses, 'fire', 'S', MUSKET_BLOCK);
    expect(out.flipX).toBeUndefined();
  });

  it('inherits flipX through rot180 mirror unchanged (SE from NW)', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        NW: { layers: [], weapon: { x: 0, y: 0, rot: 0, flipX: true } },
      },
    };
    const out = resolveWeaponPoseTransform(poses, 'fire', 'SE', MUSKET_BLOCK);
    expect(out.flipX).toBe(true);
  });

  it('XORs flipX through flipX mirror (NE from NW): flipped source becomes unflipped', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        NW: { layers: [], weapon: { x: 0, y: 0, rot: 0, flipX: true } },
      },
    };
    const out = resolveWeaponPoseTransform(poses, 'fire', 'NE', MUSKET_BLOCK);
    expect(out.flipX).toBeUndefined();
  });

  it('XORs flipX through flipX mirror (NE from NW): unflipped source becomes flipped', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        NW: { layers: [], weapon: { x: 0, y: 0, rot: 0 } },
      },
    };
    const out = resolveWeaponPoseTransform(poses, 'fire', 'NE', MUSKET_BLOCK);
    expect(out.flipX).toBe(true);
  });

  it('XORs flipX through flipX mirror (E from W) consistently', () => {
    const flippedW: Record<string, Record<string, PoseFacingEntry>> = {
      fire: { W: { layers: [], weapon: { x: 0, y: 0, rot: 0, flipX: true } } },
    };
    expect(resolveWeaponPoseTransform(flippedW, 'fire', 'E', MUSKET_BLOCK).flipX).toBeUndefined();
    const unflippedW: Record<string, Record<string, PoseFacingEntry>> = {
      fire: { W: { layers: [], weapon: { x: 0, y: 0, rot: 0 } } },
    };
    expect(resolveWeaponPoseTransform(unflippedW, 'fire', 'E', MUSKET_BLOCK).flipX).toBe(true);
  });

  it('authored flipX on the derived facing wins over inheritance', () => {
    const poses: Record<string, Record<string, PoseFacingEntry>> = {
      fire: {
        N: { layers: [], weapon: { x: 0, y: 0, rot: 0, flipX: true } },
        // S authored without flipX even though N has it — explicit wins.
        S: { layers: [], weapon: { x: 9, y: 9, rot: 9 } },
      },
    };
    expect(resolveWeaponPoseTransform(poses, 'fire', 'S', MUSKET_BLOCK)).toEqual({
      x: 9, y: 9, rot: 9,
    });
  });
});
