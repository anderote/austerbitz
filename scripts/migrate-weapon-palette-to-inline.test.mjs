import { describe, it, expect, vi, afterEach } from 'vitest';
import { inlineOne, migrate } from './migrate-weapon-palette-to-inline.mjs';

describe('inlineOne', () => {
  it('strips id and preserves required fields', () => {
    const out = inlineOne({ id: 'n-0', src: 'N', x: -7, y: -3, rot: 0 });
    expect(out).toEqual({ src: 'N', x: -7, y: -3, rot: 0 });
  });

  it('preserves transform when not none', () => {
    const out = inlineOne({ id: 'nw-0', src: 'NW', transform: 'flipX', x: 1, y: 1, rot: 5 });
    expect(out).toEqual({ src: 'NW', transform: 'flipX', x: 1, y: 1, rot: 5 });
  });

  it('drops transform when it is "none"', () => {
    const out = inlineOne({ id: 'a', src: 'N', transform: 'none', x: 0, y: 0, rot: 0 });
    expect(out.transform).toBeUndefined();
  });

  it('preserves flipX: true', () => {
    const out = inlineOne({ id: 'a', src: 'N', x: 0, y: 0, rot: 0, flipX: true });
    expect(out.flipX).toBe(true);
  });

  it('does not add flipX when false/absent', () => {
    const out = inlineOne({ id: 'a', src: 'N', x: 0, y: 0, rot: 0 });
    expect(out.flipX).toBeUndefined();
  });
});

describe('migrate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inlines a single weapon id into weapons[]', () => {
    const kit = {
      id: 'test',
      poses: {
        idle: {
          S: { layers: ['x'], weapon: 'n-0' },
        },
      },
      weaponPalette: [{ id: 'n-0', src: 'N', x: -7, y: -3, rot: 0 }],
    };
    migrate(kit);
    expect(kit.weaponPalette).toBeUndefined();
    expect(kit.poses.idle.S).toEqual({
      layers: ['x'],
      weapons: [{ src: 'N', x: -7, y: -3, rot: 0 }],
    });
  });

  it('inlines weapon + weaponVariants in [primary, ...variants] order', () => {
    const kit = {
      id: 'test',
      poses: {
        idle: {
          N: { layers: [], weapon: 'a', weaponVariants: ['b', 'c'] },
        },
      },
      weaponPalette: [
        { id: 'a', src: 'N', x: 1, y: 1, rot: 0 },
        { id: 'b', src: 'N', x: 2, y: 2, rot: 10 },
        { id: 'c', src: 'NW', x: 3, y: 3, rot: 20 },
      ],
    };
    migrate(kit);
    expect(kit.poses.idle.N.weapons).toEqual([
      { src: 'N', x: 1, y: 1, rot: 0 },
      { src: 'N', x: 2, y: 2, rot: 10 },
      { src: 'NW', x: 3, y: 3, rot: 20 },
    ]);
    expect(kit.poses.idle.N.weapon).toBeUndefined();
    expect(kit.poses.idle.N.weaponVariants).toBeUndefined();
  });

  it('skips unknown variant ids with a warning, keeping known ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kit = {
      id: 'test',
      poses: {
        idle: {
          N: { layers: [], weapon: 'a', weaponVariants: ['ghost', 'b'] },
        },
      },
      weaponPalette: [
        { id: 'a', src: 'N', x: 0, y: 0, rot: 0 },
        { id: 'b', src: 'NW', x: 1, y: 1, rot: 0 },
      ],
    };
    migrate(kit);
    expect(kit.poses.idle.N.weapons).toEqual([
      { src: 'N', x: 0, y: 0, rot: 0 },
      { src: 'NW', x: 1, y: 1, rot: 0 },
    ]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('round-trips transform and flipX fields', () => {
    const kit = {
      id: 'test',
      poses: {
        idle: {
          N: { layers: [], weapon: 'a' },
          S: { layers: [], weapon: 'b' },
        },
      },
      weaponPalette: [
        { id: 'a', src: 'NW', transform: 'flipY', x: 1, y: 2, rot: 5, flipX: true },
        { id: 'b', src: 'W', transform: 'rot180', x: -1, y: 2, rot: -5 },
      ],
    };
    migrate(kit);
    expect(kit.poses.idle.N.weapons[0]).toEqual({
      src: 'NW',
      transform: 'flipY',
      x: 1,
      y: 2,
      rot: 5,
      flipX: true,
    });
    expect(kit.poses.idle.S.weapons[0]).toEqual({
      src: 'W',
      transform: 'rot180',
      x: -1,
      y: 2,
      rot: -5,
    });
  });

  it('omits weapons[] entirely when no ids resolved', () => {
    const kit = {
      id: 'test',
      poses: {
        idle: {
          N: { layers: ['x'] }, // no weapon ref
        },
      },
      weaponPalette: [{ id: 'a', src: 'N', x: 0, y: 0, rot: 0 }],
    };
    migrate(kit);
    expect(kit.poses.idle.N.weapons).toBeUndefined();
    expect(kit.weaponPalette).toBeUndefined();
  });

  it('is idempotent: a migrated kit (no weaponPalette) is returned unchanged', () => {
    const kit = {
      id: 'test',
      poses: {
        idle: {
          N: { layers: [], weapons: [{ src: 'N', x: 1, y: 2, rot: 0 }] },
        },
      },
    };
    const before = JSON.stringify(kit);
    migrate(kit);
    expect(JSON.stringify(kit)).toBe(before);
  });

  it('is idempotent across multiple invocations', () => {
    const kit = {
      id: 'test',
      poses: {
        idle: {
          N: { layers: [], weapon: 'a' },
        },
      },
      weaponPalette: [{ id: 'a', src: 'N', x: 0, y: 0, rot: 0 }],
    };
    migrate(kit);
    const once = JSON.stringify(kit);
    migrate(kit);
    expect(JSON.stringify(kit)).toBe(once);
  });

  it('leaves bare-array (legacy) facing entries untouched', () => {
    const kit = {
      id: 'test',
      poses: {
        legacy: {
          N: ['body-north-base'], // bare array, not a PoseFacingEntry
        },
        idle: {
          N: { layers: [], weapon: 'a' },
        },
      },
      weaponPalette: [{ id: 'a', src: 'N', x: 0, y: 0, rot: 0 }],
    };
    migrate(kit);
    expect(kit.poses.legacy.N).toEqual(['body-north-base']);
    expect(kit.poses.idle.N.weapons).toEqual([{ src: 'N', x: 0, y: 0, rot: 0 }]);
  });

  it('preserves order: primary first, variants in declared order', () => {
    const kit = {
      id: 'test',
      poses: {
        present: {
          N: { layers: [], weapon: 'first', weaponVariants: ['second', 'third', 'fourth'] },
        },
      },
      weaponPalette: [
        { id: 'first', src: 'N', x: 1, y: 1, rot: 0 },
        { id: 'second', src: 'N', x: 2, y: 2, rot: 0 },
        { id: 'third', src: 'N', x: 3, y: 3, rot: 0 },
        { id: 'fourth', src: 'N', x: 4, y: 4, rot: 0 },
      ],
    };
    migrate(kit);
    const w = kit.poses.present.N.weapons;
    expect(w).toHaveLength(4);
    expect(w[0].x).toBe(1);
    expect(w[1].x).toBe(2);
    expect(w[2].x).toBe(3);
    expect(w[3].x).toBe(4);
  });

  it('returns kit unchanged when weaponPalette is absent', () => {
    const kit = { id: 'test', poses: { idle: { N: { layers: [] } } } };
    const result = migrate(kit);
    expect(result).toBe(kit);
    expect(kit).toEqual({ id: 'test', poses: { idle: { N: { layers: [] } } } });
  });

  it('handles empty weaponPalette by deleting it', () => {
    const kit = { id: 'test', poses: { idle: {} }, weaponPalette: [] };
    migrate(kit);
    expect(kit.weaponPalette).toBeUndefined();
  });
});
