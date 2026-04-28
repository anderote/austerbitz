import { describe, it, expect } from 'vitest';
import {
  buildPalette,
  effectiveSpriteSource,
  migrate,
  tupleKey,
} from './migrate-to-weapon-palette.mjs';

const MUSKET_FACINGS = {
  N: { src: 'self' },
  NW: { src: 'self' },
  W: { src: 'self' },
  S: { src: 'N', transform: 'flipY' },
  NE: { src: 'NW', transform: 'flipX' },
  SE: { src: 'NW', transform: 'rot180' },
  SW: { src: 'NW', transform: 'flipY' },
  E: { src: 'W', transform: 'flipX' },
};

function makeMinimalKit(poses) {
  return {
    id: 'test-kit',
    poses,
    weapon: {
      layerPrefix: 'musket-brown-bess',
      facings: { ...MUSKET_FACINGS },
    },
  };
}

describe('effectiveSpriteSource', () => {
  it('returns the inline src verbatim when set to a self-source facing', () => {
    const out = effectiveSpriteSource(
      { x: 0, y: 0, rot: 0, src: 'N' },
      MUSKET_FACINGS,
      'N',
    );
    expect(out).toEqual({ src: 'N', transform: 'none' });
  });

  it('passes through inline src + transform on a non-self facing without further redirect', () => {
    // 'NE' would normally redirect via kitFacings to NW/flipX, but if the
    // inline says 'NW', we honor 'NW' (which IS self).
    const out = effectiveSpriteSource(
      { x: 0, y: 0, rot: 0, src: 'NW' },
      MUSKET_FACINGS,
      'S',
    );
    expect(out).toEqual({ src: 'NW', transform: 'none' });
  });

  it('inherits canonical mapping when inline omits src (S → N flipY)', () => {
    const out = effectiveSpriteSource({ x: 0, y: 0, rot: 0 }, MUSKET_FACINGS, 'S');
    expect(out).toEqual({ src: 'N', transform: 'flipY' });
  });

  it('inherits canonical mapping for NE (→ NW flipX)', () => {
    const out = effectiveSpriteSource({ x: 0, y: 0, rot: 0 }, MUSKET_FACINGS, 'NE');
    expect(out).toEqual({ src: 'NW', transform: 'flipX' });
  });

  it('recursively resolves an inline src that itself points to a derived facing (E → W flipX)', () => {
    // The line-infantry hit.W case: { src: 'E', transform: 'none' }
    // facings.E = { src: 'W', transform: 'flipX' }
    // → effective { src: 'W', transform: 'flipX' }
    const out = effectiveSpriteSource(
      { x: -2, y: 4, rot: -10, src: 'E', transform: 'none' },
      MUSKET_FACINGS,
      'W',
    );
    expect(out).toEqual({ src: 'W', transform: 'flipX' });
  });

  it('composes inline transform on top of redirect transform', () => {
    // inline { src: 'E', transform: 'flipY' } → composed with facings.E → flipX:
    //   transform = compose(flipX, flipY) = rot180
    const out = effectiveSpriteSource(
      { x: 0, y: 0, rot: 0, src: 'E', transform: 'flipY' },
      MUSKET_FACINGS,
      'W',
    );
    expect(out).toEqual({ src: 'W', transform: 'rot180' });
  });

  it("treats inline src 'self' as the queried dir, then resolves recursively to authored source", () => {
    // 'self' means "the dir I'm authored for". On a derived facing (S), that
    // chain follows kitFacings.S = { src: 'N', flipY } down to the authored N.
    const out = effectiveSpriteSource(
      { x: 0, y: 0, rot: 0, src: 'self' },
      MUSKET_FACINGS,
      'S',
    );
    expect(out).toEqual({ src: 'N', transform: 'flipY' });
  });

  it("treats inline src 'self' as a no-op on an authored source dir", () => {
    const out = effectiveSpriteSource(
      { x: 0, y: 0, rot: 0, src: 'self' },
      MUSKET_FACINGS,
      'N',
    );
    expect(out).toEqual({ src: 'N', transform: 'none' });
  });
});

describe('tupleKey', () => {
  it('produces equal keys for equal tuples regardless of flipX representation', () => {
    expect(tupleKey('N', 'none', 1, 2, 3, false)).toBe(tupleKey('N', 'none', 1, 2, 3, false));
  });

  it('treats omitted transform as none', () => {
    expect(tupleKey('N', 'none', 0, 0, 0, false)).toBe(tupleKey('N', undefined, 0, 0, 0, false));
  });

  it('distinguishes flipX true vs false', () => {
    expect(tupleKey('N', 'none', 0, 0, 0, true)).not.toBe(tupleKey('N', 'none', 0, 0, 0, false));
  });
});

describe('buildPalette + rewrite', () => {
  it('migrates a single inline weapon entry inheriting from facings', () => {
    const kit = makeMinimalKit({
      idle: {
        S: {
          layers: ['body-south-base'],
          weapon: { x: 0, y: 6, rot: 0 },
        },
      },
    });
    migrate(kit);
    expect(kit.weaponPalette).toEqual([
      { id: 'n-0', src: 'N', transform: 'flipY', x: 0, y: 6, rot: 0 },
    ]);
    expect(kit.poses.idle.S.weapon).toBe('n-0');
    expect(kit.weapon).toEqual({ layerPrefix: 'musket-brown-bess' });
  });

  it('dedupes two (pose, dir) slots with identical effective tuples to a single id', () => {
    const kit = makeMinimalKit({
      idle: {
        N: { layers: [], weapon: { x: 0, y: 6, rot: 0 } },
      },
      present: {
        N: { layers: [], weapon: { x: 0, y: 6, rot: 0 } },
      },
    });
    migrate(kit);
    expect(kit.weaponPalette).toHaveLength(1);
    const id = kit.weaponPalette[0].id;
    expect(kit.poses.idle.N.weapon).toBe(id);
    expect(kit.poses.present.N.weapon).toBe(id);
  });

  it('handles the hit.W src=E case by rewriting to W with flipX transform', () => {
    const kit = makeMinimalKit({
      hit: {
        W: {
          layers: [],
          weapon: { x: -2, y: 4, rot: -10, src: 'E', transform: 'none' },
        },
      },
    });
    migrate(kit);
    expect(kit.weaponPalette).toHaveLength(1);
    expect(kit.weaponPalette[0]).toEqual({
      id: 'w-0',
      src: 'W',
      transform: 'flipX',
      x: -2,
      y: 4,
      rot: -10,
    });
    expect(kit.poses.hit.W.weapon).toBe('w-0');
  });

  it('preserves flipX:true variants as distinct palette entries from non-flipped siblings', () => {
    const kit = makeMinimalKit({
      idle: {
        S: {
          layers: [],
          // After resolution against MUSKET_FACINGS.S = { src: 'N', flipY }:
          //  - normal entry: src=N, flipY, x=1, y=2, rot=0, flipX=false
          //  - flipped entry: src=N, flipY, x=1, y=2, rot=0, flipX=true
          // These differ on flipX → two palette entries.
          weapon: { x: 1, y: 2, rot: 0 },
          weaponVariants: [{ x: 1, y: 2, rot: 0, flipX: true }],
        },
      },
    });
    migrate(kit);
    expect(kit.weaponPalette).toHaveLength(2);
    const flipped = kit.weaponPalette.find((p) => p.flipX === true);
    const plain = kit.weaponPalette.find((p) => p.flipX !== true);
    expect(flipped).toBeTruthy();
    expect(plain).toBeTruthy();
    expect(kit.poses.idle.S.weapon).toBe(plain.id);
    expect(kit.poses.idle.S.weaponVariants).toEqual([flipped.id]);
  });

  it('replaces weaponVariants[] element-wise with id strings', () => {
    const kit = makeMinimalKit({
      idle: {
        N: {
          layers: [],
          weapon: { x: 0, y: 0, rot: 0 },
          weaponVariants: [
            { x: 1, y: 0, rot: 0 },
            { x: 0, y: 0, rot: 0 }, // duplicate of primary → same id
            { x: 2, y: 0, rot: 0 },
          ],
        },
      },
    });
    migrate(kit);
    // 3 unique tuples (primary + 2 distinct variants; duplicate collapses).
    expect(kit.weaponPalette).toHaveLength(3);
    const facing = kit.poses.idle.N;
    expect(typeof facing.weapon).toBe('string');
    expect(Array.isArray(facing.weaponVariants)).toBe(true);
    for (const id of facing.weaponVariants) expect(typeof id).toBe('string');
    // Variant[1] (the duplicate) shares the primary's id.
    expect(facing.weaponVariants[1]).toBe(facing.weapon);
  });

  it('idempotency: re-running migrate() produces no further changes', () => {
    const kit = makeMinimalKit({
      idle: {
        S: { layers: [], weapon: { x: 0, y: 6, rot: 0 } },
        N: { layers: [], weapon: { x: -7, y: -3, rot: 0 } },
      },
      hit: {
        W: { layers: [], weapon: { x: -2, y: 4, rot: -10, src: 'E', transform: 'none' } },
      },
    });
    migrate(kit);
    const snapshot = JSON.stringify(kit);
    migrate(kit);
    expect(JSON.stringify(kit)).toBe(snapshot);
  });

  it('does not collapse two distinct inline placements with the same dir to one id', () => {
    const kit = makeMinimalKit({
      idle: {
        N: {
          layers: [],
          weapon: { x: 0, y: 6, rot: 0 },
          weaponVariants: [
            { x: 1, y: 6, rot: 0 },
            { x: -1, y: 6, rot: 0 },
          ],
        },
      },
    });
    migrate(kit);
    expect(kit.weaponPalette).toHaveLength(3);
    expect(new Set(kit.weaponPalette.map((p) => p.id)).size).toBe(3);
  });

  it('drops kit.weapon.facings but preserves layerPrefix', () => {
    const kit = makeMinimalKit({
      idle: { N: { layers: [], weapon: { x: 0, y: 0, rot: 0 } } },
    });
    migrate(kit);
    expect(kit.weapon.layerPrefix).toBe('musket-brown-bess');
    expect(kit.weapon.facings).toBeUndefined();
  });

  it('palette.src is always an authored source (never a derived facing) for the line-infantry pattern', () => {
    // Cover all 8 dirs each authored with the canonical mapping; resulting
    // palette entries should only carry src ∈ { N, NW, W }.
    const kit = makeMinimalKit({
      idle: Object.fromEntries(
        ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((dir) => [
          dir,
          { layers: [], weapon: { x: 0, y: 0, rot: 0 } },
        ]),
      ),
    });
    migrate(kit);
    const allowed = new Set(['N', 'NW', 'W']);
    for (const entry of kit.weaponPalette) {
      expect(allowed.has(entry.src)).toBe(true);
    }
  });
});

describe('buildPalette directly', () => {
  it('returns a palette with sorted ids for stable diff output', () => {
    const kit = makeMinimalKit({
      idle: {
        N: { layers: [], weapon: { x: 1, y: 0, rot: 0 } },
        S: { layers: [], weapon: { x: 0, y: 0, rot: 0 } },
        W: { layers: [], weapon: { x: 2, y: 0, rot: 0 } },
        NW: { layers: [], weapon: { x: 3, y: 0, rot: 0 } },
      },
    });
    const { palette } = buildPalette(kit);
    const ids = palette.map((e) => e.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});
