import { describe, it, expect } from 'vitest';
import {
  resolveWeaponFacing,
  resolveWeaponPoseTransform,
  type Facing,
  type PoseFacingEntry,
  type WeaponBlock,
} from './resolver';
import { pickWeaponUv, type PoseAtlas } from './atlas';
import { runtimePoseToEditorPoseName } from './kit-loader';
import { Pose } from './pose-config';

// End-to-end weapon-resolution tests: exercise the *runtime path* the
// sprite-pass takes per soldier per frame, without touching GL. The pass
// itself is GL-coupled and not unit-testable in isolation, but the pure
// logic — pose-name mapping, weapon-facing resolution, per-pose offset
// derivation, atlas UV lookup with transforms — is fully testable here.

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
  it('returns null for poses with no editor counterpart (idle / walking / running)', () => {
    expect(runtimePoseToEditorPoseName(Pose.idle)).toBeNull();
    expect(runtimePoseToEditorPoseName(Pose.walking)).toBeNull();
    expect(runtimePoseToEditorPoseName(Pose.running)).toBeNull();
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
    // u0 is left edge (with half-texel inset) of the N cell at px=50.
    expect(u0).toBeCloseTo(50 / 200 + 0.5 / 200, 5);
    expect(v0).toBeCloseTo(100 / 200 + 0.5 / 200, 5);
    // Span is positive for transform=none (no flip).
    expect(us).toBeGreaterThan(0);
    expect(vs).toBeGreaterThan(0);
  });

  it('flipX inverts u-span: us < 0, u origin shifts to right edge', () => {
    const atlas = makeAtlasWithWeapon();
    const noneUv = pickWeaponUv(atlas, 'musket-brown-bess', 'W', 'none', 0, 200, 200)!;
    const flipUv = pickWeaponUv(atlas, 'musket-brown-bess', 'W', 'flipX', 0, 200, 200)!;
    // u origin shifts by +us (right edge of cell), then us flips sign.
    expect(flipUv[0]).toBeCloseTo(noneUv[0] + noneUv[2], 5);
    expect(flipUv[2]).toBeCloseTo(-noneUv[2], 5);
    // v unchanged.
    expect(flipUv[1]).toBeCloseTo(noneUv[1], 5);
    expect(flipUv[3]).toBeCloseTo(noneUv[3], 5);
  });

  it('flipY inverts v-span: vs < 0, v origin shifts to bottom edge', () => {
    const atlas = makeAtlasWithWeapon();
    const noneUv = pickWeaponUv(atlas, 'musket-brown-bess', 'N', 'none', 0, 200, 200)!;
    const flipUv = pickWeaponUv(atlas, 'musket-brown-bess', 'N', 'flipY', 0, 200, 200)!;
    expect(flipUv[1]).toBeCloseTo(noneUv[1] + noneUv[3], 5);
    expect(flipUv[3]).toBeCloseTo(-noneUv[3], 5);
    // u unchanged.
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

describe('end-to-end weapon resolution (kit + atlas)', () => {
  // The sprite-pass per-soldier-per-frame chain:
  //   1. resolveWeaponFacing(kit.weapon, facing) → (spriteKey, transform)
  //   2. pickWeaponUv(atlas, layerPrefix, sourceFacing, transform) → UV rect
  //   3. resolveWeaponPoseTransform(kit.poses, editorPose, facing, kit.weapon)
  //        → (x, y, rot)
  // These tests exercise that chain on a fake kit + fake atlas.

  const kitPoses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
    fire: {
      N: { layers: [], weapon: { x: 0, y: -2, rot: 0 } },
      NW: { layers: [], weapon: { x: 1, y: -1, rot: 5 } },
      W: { layers: [], weapon: { x: 2, y: 0, rot: 10 } },
      // Other facings omit weapon → derive from mirror source.
    },
    present: {
      N: { layers: [], weapon: { x: 1, y: -1, rot: 20 } },
    },
  };

  it('source facing N during fire pose resolves to the authored sprite + offset', () => {
    const atlas = makeAtlasWithWeapon();
    const resolved = resolveWeaponFacing(MUSKET_BLOCK, 'N');
    expect(resolved.spriteKey).toBe('musket-brown-bess-N');
    expect(resolved.transform).toBe('none');

    const uv = pickWeaponUv(
      atlas,
      MUSKET_BLOCK.layerPrefix,
      'N',
      resolved.transform,
      0,
      200,
      200,
    );
    expect(uv).not.toBeNull();
    expect(uv![2]).toBeGreaterThan(0); // positive span = no flip

    const offset = resolveWeaponPoseTransform(kitPoses, 'fire', 'N', MUSKET_BLOCK);
    expect(offset).toEqual({ x: 0, y: -2, rot: 0 });
  });

  it('derived S facing during fire inherits N’s offset via flipY (y negates, rot negates)', () => {
    const atlas = makeAtlasWithWeapon();
    const resolved = resolveWeaponFacing(MUSKET_BLOCK, 'S');
    expect(resolved.spriteKey).toBe('musket-brown-bess-N');
    expect(resolved.transform).toBe('flipY');

    // Sprite key uses N (the source); transform=flipY → vs negated.
    const uv = pickWeaponUv(
      atlas,
      MUSKET_BLOCK.layerPrefix,
      'N',
      resolved.transform,
      0,
      200,
      200,
    );
    expect(uv).not.toBeNull();
    expect(uv![3]).toBeLessThan(0); // negative v-span = vertical mirror

    // Per-pose offset: N has y=-2, S = flipY(N) → (x, -y, -rot) = (0, 2, 0).
    // Using toBeCloseTo to absorb the JS distinction between -0 and +0
    // (negating zero produces -0, which is numerically equal to 0).
    const offset = resolveWeaponPoseTransform(kitPoses, 'fire', 'S', MUSKET_BLOCK);
    expect(offset.x).toBeCloseTo(0);
    expect(offset.y).toBeCloseTo(2);
    expect(offset.rot).toBeCloseTo(0);
  });

  it('derived NE facing during present inherits NW via flipX even when NE is unauthored in poses', () => {
    const resolved = resolveWeaponFacing(MUSKET_BLOCK, 'NE');
    expect(resolved.spriteKey).toBe('musket-brown-bess-NW');
    expect(resolved.transform).toBe('flipX');

    // Present pose only has N authored; NE has no source-mirror data either
    // (NW isn’t in present), so the offset falls back to (0, 0, 0).
    const offset = resolveWeaponPoseTransform(kitPoses, 'present', 'NE', MUSKET_BLOCK);
    expect(offset).toEqual({ x: 0, y: 0, rot: 0 });
  });

  it('derived NE facing during fire inherits NW via flipX (NW is authored in fire)', () => {
    const resolved = resolveWeaponFacing(MUSKET_BLOCK, 'NE');
    expect(resolved.spriteKey).toBe('musket-brown-bess-NW');
    expect(resolved.transform).toBe('flipX');

    // Fire/NW = (x=1, y=-1, rot=5); NE = flipX(NW) → (-x, y, -rot).
    const offset = resolveWeaponPoseTransform(kitPoses, 'fire', 'NE', MUSKET_BLOCK);
    expect(offset).toEqual({ x: -1, y: -1, rot: -5 });
  });

  it('derived SE facing during fire inherits NW via rot180 (both x and y negate, rot unchanged)', () => {
    const resolved = resolveWeaponFacing(MUSKET_BLOCK, 'SE');
    expect(resolved.spriteKey).toBe('musket-brown-bess-NW');
    expect(resolved.transform).toBe('rot180');

    // Fire/NW = (x=1, y=-1, rot=5); SE = rot180(NW) → (-x, -y, rot).
    const offset = resolveWeaponPoseTransform(kitPoses, 'fire', 'SE', MUSKET_BLOCK);
    expect(offset).toEqual({ x: -1, y: 1, rot: 5 });
  });

  it('authored override on a derived facing wins over mirror inheritance', () => {
    const overridePoses: Record<string, Record<string, string[] | PoseFacingEntry>> = {
      fire: {
        N: { layers: [], weapon: { x: 0, y: -2, rot: 0 } },
        S: { layers: [], weapon: { x: 99, y: 99, rot: 99 } },
      },
    };
    const offset = resolveWeaponPoseTransform(overridePoses, 'fire', 'S', MUSKET_BLOCK);
    expect(offset).toEqual({ x: 99, y: 99, rot: 99 });
  });
});
