import { describe, it, expect } from 'vitest';
import {
  readWeaponVariantPool,
  resolveWeaponSpriteKey,
  type Facing,
  type PoseFacingEntry,
  type WeaponOrientation,
} from './resolver';
import { pickWeaponUv, type PoseAtlas } from './atlas';
import { runtimePoseToEditorPoseName } from './kit-loader';
import { Pose } from './pose-config';

// End-to-end weapon-resolution tests: exercise the *runtime path* the
// sprite-pass takes per soldier per frame, without touching GL. The pass
// itself is GL-coupled and not unit-testable in isolation, but the pure
// logic — pose-name mapping, inline-orientation lookup, atlas UV with
// transforms — is fully testable here.

const N_0: WeaponOrientation = { src: 'N', x: 0, y: -2, rot: 0 };
const N_FLIPY: WeaponOrientation = { src: 'N', transform: 'flipY', x: 0, y: 2, rot: 0 };
const NW_0: WeaponOrientation = { src: 'NW', x: 1, y: -1, rot: 5 };
const NW_FLIP: WeaponOrientation = {
  src: 'NW',
  transform: 'flipX',
  x: -1,
  y: -1,
  rot: -5,
  flipX: true,
};
const W_0: WeaponOrientation = { src: 'W', x: 2, y: 0, rot: 10 };

function makeAtlasWithWeapon(): PoseAtlas {
  // A 200x200 combined sheet with a 32x36 weapon cell at (50, 100) for each
  // of the 3 source facings (laid out left-to-right at the same y).
  const weaponCells = new Map<string, Map<Facing, { px: number; py: number; w: number; h: number }>>();
  const inner = new Map<Facing, { px: number; py: number; w: number; h: number }>();
  inner.set('N', { px: 50, py: 100, w: 32, h: 36 });
  inner.set('NW', { px: 82, py: 100, w: 32, h: 36 });
  inner.set('W', { px: 114, py: 100, w: 32, h: 36 });
  weaponCells.set('musket-brown-bess', inner);
  return {
    pixels: new Uint8Array(4),
    width: 200,
    height: 200,
    cells: new Map(),
    dirLookup: new Map(),
    weaponCells,
    headCells: new Map(),
    variantCells: new Map(),
  };
}

describe('runtimePoseToEditorPoseName', () => {
  it('maps firing → fire and reloading → make-ready', () => {
    expect(runtimePoseToEditorPoseName(Pose.firing)).toBe('fire');
    expect(runtimePoseToEditorPoseName(Pose.reloading)).toBe('make-ready');
  });
  it('maps aiming → present, flinch → hit, dying → dying', () => {
    expect(runtimePoseToEditorPoseName(Pose.aiming)).toBe('present');
    expect(runtimePoseToEditorPoseName(Pose.flinch)).toBe('hit');
    expect(runtimePoseToEditorPoseName(Pose.dying)).toBe('dying');
  });
  it('maps ragdoll & dead → dying (so the corpse keeps the dying weapon offset)', () => {
    expect(runtimePoseToEditorPoseName(Pose.ragdoll)).toBe('dying');
    expect(runtimePoseToEditorPoseName(Pose.dead)).toBe('dying');
  });
  it('maps idle / walking / running to their editor pose names so per-pose weapon authoring is honored', () => {
    expect(runtimePoseToEditorPoseName(Pose.idle)).toBe('idle');
    expect(runtimePoseToEditorPoseName(Pose.walking)).toBe('walking');
    expect(runtimePoseToEditorPoseName(Pose.running)).toBe('running');
  });
});

describe('pickWeaponUv (atlas UV with facing transforms)', () => {
  // A weapon facing pulls its sprite via (layerPrefix, sourceFacing). The UV
  // rect's signed (us, vs) encodes the mirror — the shader walks the cell
  // backwards on negative spans, sampling the flipped pixels for free.
  it('returns a positive-span UV rect for a source facing with transform=none', () => {
    const atlas = makeAtlasWithWeapon();
    const uv = pickWeaponUv(atlas, 'musket-brown-bess', 'N', 'none', 0, 200, 200);
    expect(uv).not.toBeNull();
    const [u0, v0, us, vs] = uv!;
    expect(u0).toBeCloseTo(50 / 200 + 0.5 / 200, 5);
    expect(v0).toBeCloseTo(100 / 200 + 0.5 / 200, 5);
    expect(us).toBeGreaterThan(0);
    expect(vs).toBeGreaterThan(0);
  });

  it('flipX inverts u-span: us < 0, u origin shifts to right edge', () => {
    const atlas = makeAtlasWithWeapon();
    const noneUv = pickWeaponUv(atlas, 'musket-brown-bess', 'W', 'none', 0, 200, 200)!;
    const flipUv = pickWeaponUv(atlas, 'musket-brown-bess', 'W', 'flipX', 0, 200, 200)!;
    expect(flipUv[0]).toBeCloseTo(noneUv[0] + noneUv[2], 5);
    expect(flipUv[2]).toBeCloseTo(-noneUv[2], 5);
    expect(flipUv[1]).toBeCloseTo(noneUv[1], 5);
    expect(flipUv[3]).toBeCloseTo(noneUv[3], 5);
  });

  it('flipY inverts v-span: vs < 0, v origin shifts to bottom edge', () => {
    const atlas = makeAtlasWithWeapon();
    const noneUv = pickWeaponUv(atlas, 'musket-brown-bess', 'N', 'none', 0, 200, 200)!;
    const flipUv = pickWeaponUv(atlas, 'musket-brown-bess', 'N', 'flipY', 0, 200, 200)!;
    expect(flipUv[1]).toBeCloseTo(noneUv[1] + noneUv[3], 5);
    expect(flipUv[3]).toBeCloseTo(-noneUv[3], 5);
    expect(flipUv[0]).toBeCloseTo(noneUv[0], 5);
    expect(flipUv[2]).toBeCloseTo(noneUv[2], 5);
  });

  it('rot180 inverts both spans (composition of flipX and flipY)', () => {
    const atlas = makeAtlasWithWeapon();
    const noneUv = pickWeaponUv(atlas, 'musket-brown-bess', 'NW', 'none', 0, 200, 200)!;
    const rotUv = pickWeaponUv(atlas, 'musket-brown-bess', 'NW', 'rot180', 0, 200, 200)!;
    expect(rotUv[0]).toBeCloseTo(noneUv[0] + noneUv[2], 5);
    expect(rotUv[1]).toBeCloseTo(noneUv[1] + noneUv[3], 5);
    expect(rotUv[2]).toBeCloseTo(-noneUv[2], 5);
    expect(rotUv[3]).toBeCloseTo(-noneUv[3], 5);
  });

  it('returns null when the layerPrefix is not packed', () => {
    const atlas = makeAtlasWithWeapon();
    expect(pickWeaponUv(atlas, 'unknown-weapon', 'N', 'none', 0, 200, 200)).toBeNull();
  });

  it('returns null when the source facing is not packed', () => {
    const atlas = makeAtlasWithWeapon();
    // S is a derived facing — not packed in our test atlas (only N/NW/W are).
    expect(pickWeaponUv(atlas, 'musket-brown-bess', 'S', 'none', 0, 200, 200)).toBeNull();
  });
});

describe('end-to-end weapon resolution (inline weapons[] + atlas)', () => {
  // The sprite-pass per-soldier-per-frame chain:
  //   1. readWeaponVariantPool(kit.poses, editorPose, facing) → orientations[]
  //   2. orientation = pool[entity.id % pool.length]
  //   3. resolveWeaponSpriteKey(layerPrefix, orientation) → (spriteKey, transform)
  //   4. pickWeaponUv(atlas, layerPrefix, orientation.src, transform) → UV rect
  //   5. quad placement uses orientation.x / .y / .rot / .flipX
  // These tests exercise the chain on a synthetic kit + atlas.

  const kitPoses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
    fire: {
      N: { layers: [], weapons: [N_0] },
      NW: { layers: [], weapons: [NW_0] },
      W: { layers: [], weapons: [W_0] },
      // S/NE/SE/SW/E omit weapons → no overlay.
    },
    present: {
      N: { layers: [], weapons: [N_0, N_FLIPY] },
    },
  };

  it('source facing N during fire pose resolves through inline weapons[] to a positive-span UV', () => {
    const atlas = makeAtlasWithWeapon();
    const pool = readWeaponVariantPool(kitPoses, 'fire', 'N' as Facing);
    expect(pool).toEqual([N_0]);
    const orientation = pool[0]!;
    const { spriteKey, transform } = resolveWeaponSpriteKey('musket-brown-bess', orientation);
    expect(spriteKey).toBe('musket-brown-bess-N');
    expect(transform).toBe('none');
    const uv = pickWeaponUv(atlas, 'musket-brown-bess', orientation.src, transform, 0, 200, 200);
    expect(uv).not.toBeNull();
    expect(uv![2]).toBeGreaterThan(0);
  });

  it('a flipY orientation produces a negative v-span on the same N source', () => {
    const atlas = makeAtlasWithWeapon();
    const pool = readWeaponVariantPool(kitPoses, 'present', 'N' as Facing);
    expect(pool).toEqual([N_0, N_FLIPY]);
    const orientation = pool[1]!;
    const { transform } = resolveWeaponSpriteKey('musket-brown-bess', orientation);
    expect(transform).toBe('flipY');
    const uv = pickWeaponUv(atlas, 'musket-brown-bess', orientation.src, transform, 0, 200, 200);
    expect(uv).not.toBeNull();
    expect(uv![3]).toBeLessThan(0);
  });

  it('a flipX orientation on NW produces a negative u-span', () => {
    const atlas = makeAtlasWithWeapon();
    const orientation = NW_FLIP;
    const { transform } = resolveWeaponSpriteKey('musket-brown-bess', orientation);
    expect(transform).toBe('flipX');
    expect(orientation.flipX).toBe(true);
    const uv = pickWeaponUv(atlas, 'musket-brown-bess', orientation.src, transform, 0, 200, 200);
    expect(uv).not.toBeNull();
    expect(uv![2]).toBeLessThan(0);
  });

  it('returns an empty pool for a (pose, facing) without authored weapons[]', () => {
    expect(readWeaponVariantPool(kitPoses, 'fire', 'NE' as Facing)).toEqual([]);
    expect(readWeaponVariantPool(kitPoses, 'fire', 'S' as Facing)).toEqual([]);
  });
});
