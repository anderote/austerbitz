import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildDirLookup,
  normalizePoseFacingEntry,
  readWeaponVariantPool,
  resolvePaletteEntry,
  resolvePoseWeaponEntry,
  resolveWeaponSpriteKey,
  type Facing,
  type PoseFacingEntry,
  type WeaponPaletteEntry,
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

const PALETTE: WeaponPaletteEntry[] = [
  { id: 'n-0', src: 'N', x: 0, y: 6, rot: 0 },
  { id: 'n-1', src: 'N', transform: 'flipY', x: 0, y: -6, rot: 0 },
  { id: 'nw-0', src: 'NW', x: -7, y: 2, rot: 0 },
  { id: 'nw-flip', src: 'NW', x: 7, y: 2, rot: 0, flipX: true },
  { id: 'w-0', src: 'W', x: -2, y: 4, rot: 0 },
];

describe('normalizePoseFacingEntry', () => {
  it('wraps a bare layer array as { layers }', () => {
    const out = normalizePoseFacingEntry(['body-south-base', 'trousers-south']);
    expect(out).toEqual({ layers: ['body-south-base', 'trousers-south'] });
    expect(out.weapon).toBeUndefined();
  });

  it('passes through an already-normalized entry', () => {
    const entry: PoseFacingEntry = {
      layers: ['body-south-base'],
      weapon: 'n-0',
    };
    expect(normalizePoseFacingEntry(entry)).toBe(entry);
  });

  it('passes through an entry without a weapon field', () => {
    const entry: PoseFacingEntry = { layers: ['body-south-base'] };
    expect(normalizePoseFacingEntry(entry)).toBe(entry);
  });
});

describe('resolvePaletteEntry', () => {
  it('returns the entry by id', () => {
    expect(resolvePaletteEntry(PALETTE, 'n-0')).toBe(PALETTE[0]);
    expect(resolvePaletteEntry(PALETTE, 'nw-flip')).toBe(PALETTE[3]);
  });

  it('returns null on miss', () => {
    expect(resolvePaletteEntry(PALETTE, 'does-not-exist')).toBeNull();
  });

  it('returns null when the palette is undefined', () => {
    expect(resolvePaletteEntry(undefined, 'n-0')).toBeNull();
  });

  it('returns null when the palette is empty', () => {
    expect(resolvePaletteEntry([], 'n-0')).toBeNull();
  });
});

describe('resolveWeaponSpriteKey', () => {
  it('builds <layerPrefix>-<src>', () => {
    expect(resolveWeaponSpriteKey('musket-brown-bess', PALETTE[0]!)).toEqual({
      spriteKey: 'musket-brown-bess-N',
      transform: 'none',
    });
  });

  it('passes through an explicit transform', () => {
    expect(resolveWeaponSpriteKey('musket-brown-bess', PALETTE[1]!)).toEqual({
      spriteKey: 'musket-brown-bess-N',
      transform: 'flipY',
    });
  });

  it("defaults transform to 'none' when omitted", () => {
    const entry: WeaponPaletteEntry = { id: 'a', src: 'NW', x: 0, y: 0, rot: 0 };
    const out = resolveWeaponSpriteKey('musket-brown-bess', entry);
    expect(out.transform).toBe('none');
    expect(out.spriteKey).toBe('musket-brown-bess-NW');
  });
});

describe('resolvePoseWeaponEntry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the palette entry when (pose, facing).weapon is set', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: {
        N: { layers: [], weapon: 'n-0' },
      },
    };
    expect(resolvePoseWeaponEntry(poses, 'idle', 'N' as Facing, PALETTE)).toBe(PALETTE[0]);
  });

  it('returns null when the pose entry is absent', () => {
    expect(resolvePoseWeaponEntry({}, 'unknown-pose', 'S' as Facing, PALETTE)).toBeNull();
  });

  it('returns null when the facing entry has no weapon id', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: { N: { layers: [] } },
    };
    expect(resolvePoseWeaponEntry(poses, 'idle', 'N' as Facing, PALETTE)).toBeNull();
  });

  it('returns null and warns on unknown id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: { N: { layers: [], weapon: 'ghost' } },
    };
    expect(resolvePoseWeaponEntry(poses, 'idle', 'N' as Facing, PALETTE)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('treats a legacy bare-array facing as having no weapon', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      legacy: { N: ['body-north-base'] },
    };
    expect(resolvePoseWeaponEntry(poses, 'legacy', 'N' as Facing, PALETTE)).toBeNull();
  });
});

describe('readWeaponVariantPool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns [primary, ...variants] resolved via the palette', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: {
        N: {
          layers: [],
          weapon: 'n-0',
          weaponVariants: ['n-1', 'nw-0'],
        },
      },
    };
    const pool = readWeaponVariantPool(poses, PALETTE, 'idle', 'N' as Facing);
    expect(pool).toEqual([PALETTE[0], PALETTE[1], PALETTE[2]]);
  });

  it('returns just [primary] when there are no variants', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: { N: { layers: [], weapon: 'n-0' } },
    };
    const pool = readWeaponVariantPool(poses, PALETTE, 'idle', 'N' as Facing);
    expect(pool).toEqual([PALETTE[0]]);
  });

  it('returns an empty pool when no weapon id is set', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: { N: { layers: [] } },
    };
    expect(readWeaponVariantPool(poses, PALETTE, 'idle', 'N' as Facing)).toEqual([]);
  });

  it('returns an empty pool when the pose entry is absent', () => {
    expect(readWeaponVariantPool({}, PALETTE, 'walking', 'N' as Facing)).toEqual([]);
  });

  it('returns an empty pool for a legacy bare-array facing', () => {
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      walking: { N: ['body-north-base'] },
    };
    expect(readWeaponVariantPool(poses, PALETTE, 'walking', 'N' as Facing)).toEqual([]);
  });

  it('skips unknown variant ids with a warning, keeping known ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: {
        N: {
          layers: [],
          weapon: 'n-0',
          weaponVariants: ['ghost-1', 'nw-0', 'ghost-2'],
        },
      },
    };
    const pool = readWeaponVariantPool(poses, PALETTE, 'idle', 'N' as Facing);
    expect(pool).toEqual([PALETTE[0], PALETTE[2]]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('skips an unknown primary id but still resolves variants', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const poses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      idle: {
        N: {
          layers: [],
          weapon: 'ghost',
          weaponVariants: ['n-0'],
        },
      },
    };
    const pool = readWeaponVariantPool(poses, PALETTE, 'idle', 'N' as Facing);
    expect(pool).toEqual([PALETTE[0]]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
