import { describe, it, expect } from 'vitest';
import {
  buildDirLookup,
  normalizePoseFacingEntry,
  readWeaponVariantPool,
  resolveWeaponSpriteKey,
  type Facing,
  type PoseFacingEntry,
  type WeaponOrientation,
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

const N0: WeaponOrientation = { src: 'N', x: 0, y: 6, rot: 0 };
const N1_FLIPY: WeaponOrientation = { src: 'N', transform: 'flipY', x: 0, y: -6, rot: 0 };
const NW0: WeaponOrientation = { src: 'NW', x: -7, y: 2, rot: 0 };
const NW_FLIP: WeaponOrientation = { src: 'NW', x: 7, y: 2, rot: 0, flipX: true };

describe('normalizePoseFacingEntry', () => {
  it('wraps a bare layer array as { layers }', () => {
    const out = normalizePoseFacingEntry(['body-south-base', 'trousers-south']);
    expect(out).toEqual({ layers: ['body-south-base', 'trousers-south'] });
    expect(out.weapons).toBeUndefined();
  });

  it('passes through an already-normalized entry', () => {
    const entry: PoseFacingEntry = {
      layers: ['body-south-base'],
      weapons: [N0],
    };
    expect(normalizePoseFacingEntry(entry)).toBe(entry);
  });

  it('passes through an entry without a weapons field', () => {
    const entry: PoseFacingEntry = { layers: ['body-south-base'] };
    expect(normalizePoseFacingEntry(entry)).toBe(entry);
  });
});

describe('resolveWeaponSpriteKey', () => {
  it('builds <layerPrefix>-<src>', () => {
    expect(resolveWeaponSpriteKey('musket-brown-bess', N0)).toEqual({
      spriteKey: 'musket-brown-bess-N',
      transform: 'none',
    });
  });

  it('passes through an explicit transform', () => {
    expect(resolveWeaponSpriteKey('musket-brown-bess', N1_FLIPY)).toEqual({
      spriteKey: 'musket-brown-bess-N',
      transform: 'flipY',
    });
  });

  it("defaults transform to 'none' when omitted", () => {
    const orientation: WeaponOrientation = { src: 'NW', x: 0, y: 0, rot: 0 };
    const out = resolveWeaponSpriteKey('musket-brown-bess', orientation);
    expect(out.transform).toBe('none');
    expect(out.spriteKey).toBe('musket-brown-bess-NW');
  });
});

describe('readWeaponVariantPool', () => {
  it('returns weapons[] verbatim when set, primary first', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: {
        N: { layers: [], weapons: [N0, N1_FLIPY, NW0] },
      },
    };
    const pool = readWeaponVariantPool(poses, 'idle', 'N' as Facing);
    expect(pool).toEqual([N0, N1_FLIPY, NW0]);
  });

  it('returns just [primary] when there is one entry', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: { N: { layers: [], weapons: [N0] } },
    };
    expect(readWeaponVariantPool(poses, 'idle', 'N' as Facing)).toEqual([N0]);
  });

  it('returns an empty pool when weapons is missing', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: { N: { layers: [] } },
    };
    expect(readWeaponVariantPool(poses, 'idle', 'N' as Facing)).toEqual([]);
  });

  it('returns an empty pool when the pose entry is absent', () => {
    expect(readWeaponVariantPool({}, 'walking', 'N' as Facing)).toEqual([]);
  });

  it('returns an empty pool when the facing entry is absent', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: { N: { layers: [], weapons: [N0] } },
    };
    expect(readWeaponVariantPool(poses, 'idle', 'S' as Facing)).toEqual([]);
  });

  it('returns an empty pool for a legacy bare-array facing', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      walking: { N: ['body-north-base'] },
    };
    expect(readWeaponVariantPool(poses, 'walking', 'N' as Facing)).toEqual([]);
  });

  it('preserves order with flipX entries intact', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: {
        N: { layers: [], weapons: [N0, NW_FLIP] },
      },
    };
    const pool = readWeaponVariantPool(poses, 'idle', 'N' as Facing);
    expect(pool).toEqual([N0, NW_FLIP]);
    expect(pool[1]!.flipX).toBe(true);
  });

  it('returns the pose entry undefined when poses is undefined', () => {
    expect(readWeaponVariantPool(undefined, 'idle', 'N' as Facing)).toEqual([]);
  });
});
