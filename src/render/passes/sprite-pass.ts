import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import { SPRITE_VS, SPRITE_FS } from '../shaders/sprite.glsl';
import { SHADOW_PROJECTION_VS, SHADOW_PROJECTION_FS } from '../shaders/shadow-projection.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import { EntityState, PartLost, isDead } from '../../sim/entities';
import { getUnitKindByIndex, unitKinds } from '../../data/units';
import { RECOIL_T, RECOIL_PUSH_END, RECOIL_HOLD_END } from '../../sim/fire-resolver';
import {
  KIND_ATLAS,
  COMBINED_SHEET_W,
  COMBINED_SHEET_H,
  generateCombinedAtlas,
  type KindAtlasMeta,
} from '../sprite-atlas';
import { type PoseAtlas, pickPoseUv, pickPoseVariantUv, pickWeaponUv, pickHeadUv } from '../poses/atlas';
import { composeCombinedAtlas } from '../poses/combined-atlas';
import {
  type Facing,
  type WeaponOrientation,
} from '../poses/resolver';
import { runtimePoseToEditorPoseName, type KitConfig } from '../poses/kit-loader';
import { Pose, POSE_CONFIG } from '../poses/pose-config';

// Held-weapon vertical bob during locomotion. The body sprite's bob is baked
// into its source frames, but the weapon overlay is anchored at one fixed
// per-(pose, facing) position — without a synthesized match, it floats
// steadily while the body bounces under it. Frequency = pose fps / 4 (one
// full bob cycle per stride on a standard 4-frame gait); amplitude is in
// source-sprite pixels and snapped to integers for pixel-art crispness.
const WEAPON_BOB_WALK_PX = 1;
const WEAPON_BOB_RUN_PX = 1;
const WEAPON_BOB_WALK_HZ = POSE_CONFIG[Pose.walking].fps / 4;
const WEAPON_BOB_RUN_HZ = POSE_CONFIG[Pose.running].fps / 4;

const SOLDIER_FALLBACK = KIND_ATLAS['line-infantry']!;

// Module-scoped sort state so the comparator closure isn't re-allocated each
// frame. `sortPosY` is set just before each per-frame sort call.
let sortPosY: Float32Array | null = null;
const sortByY = (a: number, b: number) => sortPosY![a]! - sortPosY![b]!;

export interface SpritePass {
  draw(world: World, cam: Camera): void;
  /**
   * Swap the GL atlas texture mid-session. Called by the dev-mode live-reload
   * watcher when sprite PNGs on disk change. The new image must already have
   * been decoded (e.g. via `createImageBitmap`); we just upload it to the
   * existing texture object so all UV bookkeeping stays valid.
   *
   * If the image dimensions change vs. the original atlas, this triggers a
   * full `texImage2D` call (otherwise `texSubImage2D` is used).
   */
  replaceAtlasTexture(image: ImageBitmap | ImageData | HTMLCanvasElement): void;
  /** Combined-atlas GL texture. Shared with the dropped-items pass. */
  getAtlas(): WebGLTexture;
  /** Combined-atlas pixel dimensions + the Y offset where the pose atlas was packed. */
  getSheetDims(): { w: number; h: number; poseAtlasY: number };
  /**
   * Pre-resolved per-kit weapon UVs keyed by `kit.weapon.layerPrefix` and
   * indexed by runtime facing 0..7. Used by dropped-items for the
   * frozen-corpse weapon visual; resolved from each kit's `dying` pose
   * palette refs (so a dropped musket matches the orientation the corpse
   * was holding).
   */
  getWeaponUvByPrefix(): ReadonlyMap<string, ReadonlyArray<readonly [number, number, number, number] | null>>;
  /** Pre-resolved per-kit head/hat UVs keyed by `kit.head.layerPrefix`. */
  getHeadUvByPrefix(): ReadonlyMap<string, ReadonlyArray<readonly [number, number, number, number] | null>>;
}

interface FactionPalette {
  /** Identifier for the regiment (matches `regiments.json`). */
  id?: string;
  /** Display label. */
  label?: string;
  /** Coat color (RGB 0..255). */
  primary: [number, number, number];
  /** Cross-belts / trousers / breeches (RGB 0..255). */
  secondary: [number, number, number];
  /** Boots/gaiters + shako/hat (RGB 0..255). */
  tertiary: [number, number, number];
}

/**
 * Per-team uniform colors. Indexed by `entities.team`. Hardcoded fallback
 * matches `public/regiments.json` so the renderer has valid palettes even if
 * the async fetch fails or the first frame ticks before the fetch resolves.
 */
let regiments: FactionPalette[] = [
  { id: 'french-line',   label: 'French Line',   primary: [40, 80, 190],   secondary: [240, 230, 210], tertiary: [25, 20, 35] },
  { id: 'british-line',  label: 'British Line',  primary: [180, 40, 50],   secondary: [240, 230, 210], tertiary: [25, 20, 35] },
  { id: 'prussian-line', label: 'Prussian Line', primary: [35, 45, 75],    secondary: [240, 230, 210], tertiary: [15, 15, 20] },
  { id: 'russian-line',  label: 'Russian Line',  primary: [40, 75, 50],    secondary: [240, 230, 210], tertiary: [15, 15, 20] },
  { id: 'austrian-line', label: 'Austrian Line', primary: [225, 215, 195], secondary: [120, 105, 85],  tertiary: [15, 15, 20] },
];

const FALLBACK_TEAM = regiments[0]!;

function isTriple(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 255)
  );
}

async function loadRegimentsAsync(): Promise<void> {
  try {
    const res = await fetch('/regiments.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('regiments.json must be a non-empty array');
    }
    const parsed: FactionPalette[] = [];
    for (let i = 0; i < data.length; i++) {
      const e = data[i] as Record<string, unknown> | null | undefined;
      if (!e || typeof e !== 'object') {
        throw new Error(`entry ${i}: not an object`);
      }
      const { id, label, primary, secondary, tertiary } = e;
      if (typeof id !== 'string' || typeof label !== 'string') {
        throw new Error(`entry ${i}: id/label must be strings`);
      }
      if (!isTriple(primary) || !isTriple(secondary) || !isTriple(tertiary)) {
        throw new Error(`entry ${i}: primary/secondary/tertiary must each be [r,g,b] of 0..255`);
      }
      parsed.push({ id, label, primary, secondary, tertiary });
    }
    // Replace in-place so any captured references see the updated values.
    regiments.length = 0;
    regiments.push(...parsed);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sprite-pass] failed to load /regiments.json, keeping hardcoded fallback:', err);
  }
}

export function createSpritePass(
  gl: WebGL2RenderingContext,
  capacity: number,
  poseAtlas: PoseAtlas | null,
  kits: ReadonlyMap<string, KitConfig> = new Map(),
  worldH = 2000,
): SpritePass {
  // Fire-and-forget regiment load; falls back to the hardcoded defaults until
  // the fetch resolves. Validation + warning live inside loadRegimentsAsync.
  void loadRegimentsAsync();

  const prog = linkProgram(gl, SPRITE_VS, SPRITE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj', 'u_atlas', 'u_patternFeatureWorld', 'u_worldH'] as const);

  // Ground-shadow program. Reuses the same VAO and atlas as the sprite pass;
  // its VS reads attributes 0,1,2,4,9,10,11 and projects each vertex onto the
  // ground via foot-anchored shear+squash. FS discards dead instances and any
  // transparent atlas pixels, otherwise emits flat black at fixed alpha.
  const shadowProg = linkProgram(gl, SHADOW_PROJECTION_VS, SHADOW_PROJECTION_FS);
  const shadowU = getUniforms(gl, shadowProg, ['u_viewProj', 'u_atlas'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  // Quad corners (-0.5..0.5)
  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5,  -0.5,  0.5,
    -0.5,  0.5,  0.5, -0.5,   0.5,  0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const sizeBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const colorBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  const uvRectBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);

  const primaryBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(5, 1);

  const secondaryBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(6);
  gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(6, 1);

  const patternBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 1 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(7);
  gl.vertexAttribPointer(7, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(7, 1);

  const tertiaryBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(8);
  gl.vertexAttribPointer(8, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(8, 1);

  const rotBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 1 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(9);
  gl.vertexAttribPointer(9, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(9, 1);

  // Per-instance shadow inputs. Read only by the shadow projection program;
  // the sprite shader doesn't reference them but the locations stay enabled
  // on this VAO without cost (single float each, divisor 1).
  const footYBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 1 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(10);
  gl.vertexAttribPointer(10, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(10, 1);

  const shadowAlphaBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 1 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(11);
  gl.vertexAttribPointer(11, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(11, 1);

  gl.bindVertexArray(null);

  // Compose procedural + pose atlas into one combined RGBA sheet.
  const procedural = {
    pixels: generateCombinedAtlas(),
    width: COMBINED_SHEET_W,
    height: COMBINED_SHEET_H,
  };
  const combined = composeCombinedAtlas(procedural, poseAtlas);
  const sheetW = combined.width;
  const sheetH = combined.height;
  const poseAtlasY = combined.poseAtlasY;

  // Combined atlas: don't tile-wrap (each cell occupies a sub-rect, sampling
  // outside the cell would bleed into neighbours).
  const atlas = createTextureRGBA(
    gl,
    sheetW,
    sheetH,
    combined.pixels,
    { wrap: gl.CLAMP_TO_EDGE },
  );
  // Track current texture dimensions so `replaceAtlasTexture` can decide
  // between `texSubImage2D` (same size) and `texImage2D` (resize).
  let atlasW = sheetW;
  let atlasH = sheetH;

  // Cell UV rect for a procedural kind. `col`/`row` are local to that kind's
  // 3x3 region; we add the region's pixel offset before normalizing against
  // the combined sheet dimensions (which may be larger than the procedural
  // region alone if a pose atlas is present).
  const cellUv = (
    meta: KindAtlasMeta,
    col: number,
    row: number,
  ): [number, number, number, number] => {
    const halfTexelU = 0.5 / sheetW;
    const halfTexelV = 0.5 / sheetH;
    const px = meta.region.x + col * meta.cellW;
    const py = meta.region.y + row * meta.cellH;
    const u0 = px / sheetW + halfTexelU;
    const v0 = py / sheetH + halfTexelV;
    const us = meta.cellW / sheetW - 2 * halfTexelU;
    const vs = meta.cellH / sheetH - 2 * halfTexelV;
    return [u0, v0, us, vs];
  };

  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity * 2);
  const scratchColor = new Float32Array(capacity * 4);
  const scratchUv = new Float32Array(capacity * 4);
  const scratchPrimary = new Float32Array(capacity * 3);
  const scratchSecondary = new Float32Array(capacity * 3);
  const scratchTertiary = new Float32Array(capacity * 3);
  const scratchPattern = new Float32Array(capacity);
  const scratchRot = new Float32Array(capacity);
  // Per-frame weapon instance buffers (parallel to body scratch arrays).
  // Sized to body capacity since at most one weapon instance is emitted per
  // soldier per frame. Two parallel sets: "behind" weapons render BEFORE
  // bodies (so the body occludes the weapon, e.g. for N/NE/NW facings);
  // "front" weapons render AFTER bodies (overlay on top, e.g. S/SE/SW/E/W).
  const scratchWeaponPos = new Float32Array(capacity * 2);
  const scratchWeaponSize = new Float32Array(capacity * 2);
  const scratchWeaponColor = new Float32Array(capacity * 4);
  const scratchWeaponUv = new Float32Array(capacity * 4);
  const scratchWeaponPrimary = new Float32Array(capacity * 3);
  const scratchWeaponSecondary = new Float32Array(capacity * 3);
  const scratchWeaponTertiary = new Float32Array(capacity * 3);
  const scratchWeaponPattern = new Float32Array(capacity);
  const scratchWeaponRot = new Float32Array(capacity);
  const scratchWeaponBehindPos = new Float32Array(capacity * 2);
  const scratchWeaponBehindSize = new Float32Array(capacity * 2);
  const scratchWeaponBehindColor = new Float32Array(capacity * 4);
  const scratchWeaponBehindUv = new Float32Array(capacity * 4);
  const scratchWeaponBehindPrimary = new Float32Array(capacity * 3);
  const scratchWeaponBehindSecondary = new Float32Array(capacity * 3);
  const scratchWeaponBehindTertiary = new Float32Array(capacity * 3);
  const scratchWeaponBehindPattern = new Float32Array(capacity);
  const scratchWeaponBehindRot = new Float32Array(capacity);
  // Per-instance shadow inputs, parallel to each instance group above.
  // `footY` is a world-units offset from sprite center to the foot line; the
  // shadow shader uses it to anchor the projection. Weapon shadows use the
  // same foot value as their carrier body so the held musket projects against
  // the same ground line as the soldier. `shadowAlpha` is 1.0 for living
  // entities and 0.0 for dying/dead — the FS discards 0.0 instances.
  const scratchFootY = new Float32Array(capacity);
  const scratchShadowAlpha = new Float32Array(capacity);
  const scratchWeaponFootY = new Float32Array(capacity);
  const scratchWeaponShadowAlpha = new Float32Array(capacity);
  const scratchWeaponBehindFootY = new Float32Array(capacity);
  const scratchWeaponBehindShadowAlpha = new Float32Array(capacity);

  // Pre-resolve per-kind foot offset once at pass creation; the per-frame
  // loop is then a single index lookup per body.
  const kindFootY = new Float32Array(unitKinds.length);
  for (let i = 0; i < unitKinds.length; i++) {
    const k = getUnitKindByIndex(i);
    kindFootY[i] = k.footYFromCenter ?? k.placeholderSize.h * 0.5;
  }
  // Reused per-frame sort buffer: alive entity ids sorted back-to-front by world Y.
  // Int32Array so V8 can use the typed-array sort path; on 40k+ entries the
  // boxed-number Array.sort closure path was ~3× slower.
  let sortIdx = new Int32Array(capacity);

  /**
   * Per-source UV cache keyed by `${layerPrefix}|${src}|${transform}`. The
   * underlying atlas cell is shared per source facing; the transform is
   * encoded as signed UV spans by `pickWeaponUv`. Dedup ensures we pay the
   * UV math at most once per `(layerPrefix, src, transform)` combo across
   * all the kits' inline orientations.
   */
  const weaponUvBySource = new Map<string, [number, number, number, number]>();
  function getOrComputeSourceUv(
    layerPrefix: string,
    orientation: WeaponOrientation,
  ): [number, number, number, number] | null {
    if (!poseAtlas) return null;
    const transform = orientation.transform ?? 'none';
    const key = `${layerPrefix}|${orientation.src}|${transform}`;
    const cached = weaponUvBySource.get(key);
    if (cached) return cached;
    const uv = pickWeaponUv(
      poseAtlas,
      layerPrefix,
      orientation.src,
      transform,
      poseAtlasY,
      sheetW,
      sheetH,
    );
    if (uv) weaponUvBySource.set(key, uv);
    return uv;
  }

  /**
   * Pre-resolved per-kit weapon-orientation pool keyed by `(kit.id, pose,
   * facing)`, indexed by variant index. Each slot carries the resolved UV +
   * a reference to the source orientation (for `(x, y, rot, flipX)` at draw
   * time). Variants whose source PNG isn't packed are stored as null, which
   * the per-frame loop treats as "skip overlay."
   *
   * The per-frame draw loop reads:
   *   pool = weaponPoolByKey.get(`${kindId}|${editorPose}|${facingLetter}`)
   *   slot = pool[entity.id % pool.length]
   * — the same `entity.id % length` rule as the old palette path.
   */
  interface WeaponSlot {
    uv: [number, number, number, number];
    orientation: WeaponOrientation;
  }
  const weaponPoolByKey = new Map<string, Array<WeaponSlot | null>>();
  if (poseAtlas) {
    for (const kit of kits.values()) {
      if (!kit.weapon) continue;
      const layerPrefix = kit.weapon.layerPrefix;
      const poses = kit.poses;
      if (!poses) continue;
      for (const [poseName, poseEntry] of Object.entries(poses)) {
        if (!poseEntry || typeof poseEntry !== 'object' || Array.isArray(poseEntry)) continue;
        for (const [facing, facingEntryRaw] of Object.entries(poseEntry)) {
          if (!facingEntryRaw || typeof facingEntryRaw !== 'object' || Array.isArray(facingEntryRaw)) {
            continue;
          }
          const weapons = (facingEntryRaw as { weapons?: WeaponOrientation[] }).weapons;
          if (!Array.isArray(weapons) || weapons.length === 0) continue;
          const slots: Array<WeaponSlot | null> = new Array(weapons.length).fill(null);
          for (let i = 0; i < weapons.length; i++) {
            const orientation = weapons[i]!;
            const uv = getOrComputeSourceUv(layerPrefix, orientation);
            if (uv) slots[i] = { uv, orientation };
          }
          weaponPoolByKey.set(`${kit.id}|${poseName}|${facing}`, slots);
        }
      }
    }
  }

  /**
   * Per-runtime-facing weapon UV cache, keyed by `kit.weapon.layerPrefix`.
   * Used by dropped-items-pass: a dropped weapon picks its sprite based on
   * the facing the entity died on. We resolve each runtime facing to the
   * primary inline orientation on `kit.poses.dying[<facing>].weapons[0]`,
   * then to its UV. If the kit doesn't author a dying-pose weapon for some
   * facing, that slot stays null and the dropped-items pass skips it.
   */
  const weaponUvByPrefix = new Map<string, Array<[number, number, number, number] | null>>();
  const RUNTIME_FACING_ORDER_FOR_DROPS: Facing[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  if (poseAtlas) {
    for (const kit of kits.values()) {
      if (!kit.weapon) continue;
      if (weaponUvByPrefix.has(kit.weapon.layerPrefix)) continue;
      const layerPrefix = kit.weapon.layerPrefix;
      const dying = kit.poses?.dying;
      const uvs: Array<[number, number, number, number] | null> = new Array(8).fill(null);
      for (let i = 0; i < 8; i++) {
        const facing = RUNTIME_FACING_ORDER_FOR_DROPS[i]!;
        const facingEntry = dying?.[facing];
        if (!facingEntry || Array.isArray(facingEntry)) continue;
        const weapons = (facingEntry as { weapons?: WeaponOrientation[] }).weapons;
        if (!Array.isArray(weapons) || weapons.length === 0) continue;
        const orientation = weapons[0]!;
        uvs[i] = getOrComputeSourceUv(layerPrefix, orientation);
      }
      weaponUvByPrefix.set(layerPrefix, uvs);
    }
  }

  // Parallel head/hat UV cache. Same runtime-facing-order convention; each
  // facing has its own authored sprite (no derived facings) so we always pick
  // the matching source facing with `transform: 'none'`.
  const headUvByPrefix = new Map<string, Array<[number, number, number, number] | null>>();
  if (poseAtlas) {
    const RUNTIME_FACING_ORDER: Facing[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
    for (const kit of kits.values()) {
      if (!kit.head) continue;
      if (headUvByPrefix.has(kit.head.layerPrefix)) continue;
      const uvs: Array<[number, number, number, number] | null> = new Array(8).fill(null);
      for (let i = 0; i < 8; i++) {
        const facing = RUNTIME_FACING_ORDER[i]!;
        const entry = kit.head.facings[facing]!;
        const sourceFacing: Facing = entry.src === 'self' ? facing : entry.src;
        const transform = entry.src === 'self' ? 'none' : entry.transform;
        uvs[i] = pickHeadUv(
          poseAtlas,
          kit.head.layerPrefix,
          sourceFacing,
          transform,
          poseAtlasY,
          sheetW,
          sheetH,
        );
      }
      headUvByPrefix.set(kit.head.layerPrefix, uvs);
    }
  }

  // Map from runtime facing 0..7 -> Facing string, for per-pose offset lookup.
  const RUNTIME_FACING_TO_LETTER: Facing[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  // Facings where the weapon renders BEHIND the body (rear-facing soldiers
  // whose own torso would naturally occlude the held musket from the camera).
  // Mirrors WEAPON_BEHIND_FACINGS in public/components-editor.html — keep in sync.
  const RUNTIME_FACING_IS_BEHIND: ReadonlyArray<boolean> = [
    /* E  */ false,
    /* SE */ false,
    /* S  */ false,
    /* SW */ false,
    /* W  */ false,
    /* NW */ true,
    /* N  */ true,
    /* NE */ true,
  ];
  // Pixel-to-world conversion for per-pose offsets: kit JSON stores `(x, y)`
  // in source-sprite pixel units. Body cells are 32x36 px in the component
  // atlas; weapon sprites are also 32x36 (full-cell, with the musket pixels
  // occupying a portion of a transparent canvas). World-space weapon size
  // therefore matches the body's world size 1:1.
  const SPRITE_CELL_PX = 32;
  const WEAPON_PX_W = 32;
  const WEAPON_PX_H = 36;

  return {
    draw(world, cam) {
      const UNIT_DOT_ZOOM = 4;
      const INFANTRY_DOT_PIXELS = 3;
      const CAVALRY_DOT_PIXELS = 8;
      const ARTILLERY_DOT_PIXELS = 12;
      // Pattern is anchored to world-space, sized in screen pixels.
      // Each unit's quad is much larger than this feature size (8/12 px vs 4 px),
      // so neighboring quads overlap and tile the same pattern → merged blob.
      const PATTERN_FEATURE_PIXELS = 4;
      const e = world.entities;
      const useDots = cam.zoom < UNIT_DOT_ZOOM;
      // Grow the typed sort buffer if capacity expanded since startup.
      if (sortIdx.length < e.count) sortIdx = new Int32Array(e.count);
      let n = 0;
      for (let m = 0; m < e.count; m++) {
        const id = e.aliveIds[m]!;
        if (useDots && isDead(e, id)) continue;
        sortIdx[n++] = id;
      }
      if (n === 0) return;
      // World Y grows downward, so larger Y = in front. Draw ascending by Y
      // so front sprites overwrite back ones (painter's algorithm).
      sortPosY = e.posY;
      sortIdx.subarray(0, n).sort(sortByY);

      const infantryDot = INFANTRY_DOT_PIXELS / cam.zoom;
      const cavalryDot = CAVALRY_DOT_PIXELS / cam.zoom;
      const artilleryDot = ARTILLERY_DOT_PIXELS / cam.zoom;

      // Per-frame weapon instance count. Bumped each time we emit a weapon
      // attached to a soldier — bound by `n` (one weapon per soldier max).
      let wn = 0;
      let wbn = 0;

      for (let k = 0; k < n; k++) {
        const i = sortIdx[k]!;
        const kindIdx = e.kindId[i]!;
        const kind = getUnitKindByIndex(kindIdx);
        // World foot Y and shadow-alive flag are written once per body and
        // re-used for any weapon emitted by this entity (so the held weapon
        // projects against the same foot line as its carrier body — the
        // weapon's own a_pos is at hand height, not at the feet).
        const bodyFootYWorld = e.posY[i]! + kindFootY[kindIdx]!;
        const bodyShadowAlpha = isDead(e, i) ? 0.0 : 1.0;
        scratchFootY[k] = bodyFootYWorld;
        scratchShadowAlpha[k] = bodyShadowAlpha;
        // Render-only recoil: decelerating push out → hold at peak → slow
        // ease back to the anchor. Sim posX/posY never moves.
        const rt = e.recoilT[i]!;
        let wave = 0;
        if (rt > 0) {
          const phase = 1 - rt / RECOIL_T;
          if (phase < RECOIL_PUSH_END) {
            const u = phase / RECOIL_PUSH_END;
            const inv = 1 - u;
            wave = 1 - inv * inv * inv; // ease-out cubic: fast push, decaying
          } else if (phase < RECOIL_HOLD_END) {
            wave = 1; // pause at peak
          } else {
            const u = (phase - RECOIL_HOLD_END) / (1 - RECOIL_HOLD_END);
            wave = 1 - u * u * (3 - 2 * u); // smoothstep down: slow reset
          }
        }
        scratchPos[k * 2 + 0] = e.posX[i]! + e.recoilPeakX[i]! * wave;
        scratchPos[k * 2 + 1] = e.posY[i]! + e.recoilPeakY[i]! * wave;
        const team = regiments[e.team[i]!] ?? FALLBACK_TEAM;
        scratchPrimary[k * 3 + 0] = team.primary[0] / 255;
        scratchPrimary[k * 3 + 1] = team.primary[1] / 255;
        scratchPrimary[k * 3 + 2] = team.primary[2] / 255;
        scratchSecondary[k * 3 + 0] = team.secondary[0] / 255;
        scratchSecondary[k * 3 + 1] = team.secondary[1] / 255;
        scratchSecondary[k * 3 + 2] = team.secondary[2] / 255;
        scratchTertiary[k * 3 + 0] = team.tertiary[0] / 255;
        scratchTertiary[k * 3 + 1] = team.tertiary[1] / 255;
        scratchTertiary[k * 3 + 2] = team.tertiary[2] / 255;
        const meta = KIND_ATLAS[kind.id] ?? SOLDIER_FALLBACK;
        if (useDots) {
          // Solid tint cell — fragment shader will either pass v_color through
          // (infantry: pattern=0, v_color=team primary) or override col based
          // on v_quadUv (cavalry checker, artillery stripes).
          let dotSize: number;
          let pattern: number;
          let cR: number;
          let cG: number;
          let cB: number;
          if (kind.category === 'cavalry') {
            dotSize = cavalryDot;
            pattern = 1;
            // Patterned: shader picks white vs v_primary, so leave v_color white.
            cR = 1; cG = 1; cB = 1;
          } else if (kind.category === 'artillery') {
            dotSize = artilleryDot;
            pattern = 2;
            cR = 1; cG = 1; cB = 1;
          } else {
            dotSize = infantryDot;
            pattern = 0;
            cR = team.primary[0] / 255;
            cG = team.primary[1] / 255;
            cB = team.primary[2] / 255;
          }
          scratchSize[k * 2 + 0] = dotSize;
          scratchSize[k * 2 + 1] = dotSize;
          scratchColor[k * 4 + 0] = cR;
          scratchColor[k * 4 + 1] = cG;
          scratchColor[k * 4 + 2] = cB;
          scratchColor[k * 4 + 3] = 1.0;
          scratchPattern[k] = pattern;
          const uv = cellUv(meta, meta.tintCell.col, meta.tintCell.row);
          scratchUv[k * 4 + 0] = uv[0];
          scratchUv[k * 4 + 1] = uv[1];
          scratchUv[k * 4 + 2] = uv[2];
          scratchUv[k * 4 + 3] = uv[3];
          // Dot mode: bodyRot is irrelevant — keep the quad axis-aligned.
          scratchRot[k] = 0;
        } else {
          const sprW = kind.spriteSize?.w ?? kind.placeholderSize.w;
          const sprH = kind.spriteSize?.h ?? kind.placeholderSize.h;
          // Body tilt for the falling-over death animation. Eased over the
          // 0.5s Dying state (stateT counts down 0.5 → 0), then held at the
          // final tilt forever in Dead. bodyRot is 0 for everything else.
          const stateForRot = e.state[i]!;
          let bodyRotNow = 0;
          if (stateForRot === EntityState.Dying) {
            const DYING_DURATION = 0.5;
            const progress = 1 - Math.max(0, e.stateT[i]!) / DYING_DURATION;
            // Smoothstep so the fall accelerates toward the end (looks more
            // natural than linear — more weight to the impact).
            const eased = progress * progress * (3 - 2 * progress);
            bodyRotNow = e.bodyRot[i]! * eased;
          } else if (stateForRot === EntityState.Dead) {
            bodyRotNow = e.bodyRot[i]!;
          }
          // Pivot rotation at the feet (bottom of the sprite, where the
          // character touches the ground) instead of at the sprite center,
          // so the body falls sideways like a person rather than spinning
          // around its belt. Derivation: feet are world-fixed at
          // (cx, cy + h/2); to keep that point invariant under rotation θ
          // applied around the new center, the new center must be
          // footPoint + R(θ) * (0, -h/2). That simplifies to a shift of
          // (sin θ * h/2, (1 - cos θ) * h/2) from the original center.
          if (bodyRotNow !== 0) {
            const halfH = sprH / 2;
            const sinT = Math.sin(bodyRotNow);
            const cosT = Math.cos(bodyRotNow);
            scratchPos[k * 2 + 0] += sinT * halfH;
            scratchPos[k * 2 + 1] += halfH * (1 - cosT);
          }
          scratchSize[k * 2 + 0] = sprW;
          scratchSize[k * 2 + 1] = sprH;
          scratchColor[k * 4 + 0] = kind.placeholderColor[0] / 255;
          scratchColor[k * 4 + 1] = kind.placeholderColor[1] / 255;
          scratchColor[k * 4 + 2] = kind.placeholderColor[2] / 255;
          scratchColor[k * 4 + 3] = 1.0;
          scratchPattern[k] = 0;
          const facing = e.facing[i]!;
          const pose = e.pose[i]!;
          // Running soldiers desync per-entity so a column doesn't animate in
          // lockstep; walking pose (= marching/formation) stays synchronized.
          // Stable hash → [0, 1) seconds, large enough to span any pose's loop.
          const desync = pose === Pose.running
            ? ((i * 2654435761) >>> 0) / 0x100000000
            : 0;
          const poseT = e.poseT[i]! + desync;
          const clipIdx = e.clipIndex[i]!;
          let uv: readonly [number, number, number, number] | null = null;
          // Detachable-part variant lookup: when a part bit is set, prefer the
          // matching `--no-<part>` body variant. Only one variant axis exists
          // today (head); multi-bit combinations would need combinatorial
          // variants which we'll author once a kit needs them.
          const partLost = e.partLost[i]!;
          if (poseAtlas && partLost !== 0) {
            if ((partLost & PartLost.Head) !== 0) {
              uv = pickPoseVariantUv(
                poseAtlas, 'head', kind.id, pose, facing, clipIdx, poseT, poseAtlasY, sheetW, sheetH,
              );
            }
          }
          if (!uv && poseAtlas) {
            uv = pickPoseUv(poseAtlas, kind.id, pose, facing, clipIdx, poseT, poseAtlasY, sheetW, sheetH);
          }
          if (!uv) {
            // Same facing→slot mapping as pickPoseUv (see atlas.ts).
            const cell = meta.poseCells[(facing + 2) & 7] ?? kind.spriteCell ?? meta.tintCell;
            uv = cellUv(meta, cell.col, cell.row);
          }
          scratchUv[k * 4 + 0] = uv[0];
          scratchUv[k * 4 + 1] = uv[1];
          scratchUv[k * 4 + 2] = uv[2];
          scratchUv[k * 4 + 3] = uv[3];

          // Weapon overlay (if this kit has a weapon block + the atlas packed
          // its source sprites). Inline `(pose, facing).weapons[]` carries
          // the full (src, transform, x, y, rot, flipX) tuples; the pre-built
          // `weaponPoolByKey` carries one UV slot per orientation. Behind-
          // facings (N/NE/NW) emit into a separate set drawn BEFORE bodies so
          // the body occludes the weapon; front-facings emit into the regular
          // set drawn AFTER bodies (overlay on top).
          const stateNow = e.state[i]!;
          const isDyingOrDead = stateNow === EntityState.Dying || stateNow === EntityState.Dead;
          const kit = kits.get(kind.id);
          if (kit && kit.weapon && !isDyingOrDead) {
            const facingLetter = RUNTIME_FACING_TO_LETTER[facing]!;
            const editorPose = runtimePoseToEditorPoseName(pose);
            // Per-frame variant pick: `entity.id % weapons.length`. Pulls
            // from the prebuilt slot pool keyed on `(kindId, pose, facing)`;
            // each slot is a `(uv, orientation)` pair or `null` if the source
            // PNG wasn't packed.
            const poolKey = editorPose ? `${kind.id}|${editorPose}|${facingLetter}` : null;
            const pool = poolKey ? weaponPoolByKey.get(poolKey) : undefined;
            const slot = pool && pool.length > 0
              ? pool[((i % pool.length) + pool.length) % pool.length] ?? null
              : null;
            if (slot) {
              const wuv = slot.uv;
              const offset = slot.orientation;
              // Body sprite is rendered at `sprW` world units wide for a
              // SPRITE_CELL_PX-wide cell, so the weapon must use the SAME
              // pixel-to-world ratio for both its size AND its per-pose pixel
              // offsets — otherwise the weapon ends up at half-scale and
              // mis-anchored relative to the body anatomy that the editor
              // composites against 1:1.
              const pxToWorld = sprW / SPRITE_CELL_PX;
              const dxWorld = offset.x * pxToWorld;
              let bobPx = 0;
              if (pose === Pose.walking) {
                bobPx = Math.round(Math.sin(poseT * 2 * Math.PI * WEAPON_BOB_WALK_HZ) * WEAPON_BOB_WALK_PX);
              } else if (pose === Pose.running) {
                bobPx = Math.round(Math.sin(poseT * 2 * Math.PI * WEAPON_BOB_RUN_HZ) * WEAPON_BOB_RUN_PX);
              }
              const dyWorld = (offset.y + bobPx) * pxToWorld;
              const wWorldW = WEAPON_PX_W * pxToWorld;
              const wWorldH = WEAPON_PX_H * pxToWorld;
              const isBehind = RUNTIME_FACING_IS_BEHIND[facing]!;
              const dst = isBehind
                ? {
                    pos: scratchWeaponBehindPos,
                    size: scratchWeaponBehindSize,
                    color: scratchWeaponBehindColor,
                    uv: scratchWeaponBehindUv,
                    primary: scratchWeaponBehindPrimary,
                    secondary: scratchWeaponBehindSecondary,
                    tertiary: scratchWeaponBehindTertiary,
                    pattern: scratchWeaponBehindPattern,
                    rot: scratchWeaponBehindRot,
                  }
                : {
                    pos: scratchWeaponPos,
                    size: scratchWeaponSize,
                    color: scratchWeaponColor,
                    uv: scratchWeaponUv,
                    primary: scratchWeaponPrimary,
                    secondary: scratchWeaponSecondary,
                    tertiary: scratchWeaponTertiary,
                    pattern: scratchWeaponPattern,
                    rot: scratchWeaponRot,
                  };
              const wi = isBehind ? wbn : wn;
              dst.pos[wi * 2 + 0] = scratchPos[k * 2 + 0]! + dxWorld;
              dst.pos[wi * 2 + 1] = scratchPos[k * 2 + 1]! + dyWorld;
              dst.size[wi * 2 + 0] = wWorldW;
              dst.size[wi * 2 + 1] = wWorldH;
              // Weapon: white tint passthrough. Marker substitution still runs
              // in the FS, so any team-coloured pixels in the weapon sprite
              // get tinted from the same per-instance team palette.
              dst.color[wi * 4 + 0] = 1;
              dst.color[wi * 4 + 1] = 1;
              dst.color[wi * 4 + 2] = 1;
              dst.color[wi * 4 + 3] = 1;
              dst.pattern[wi] = 0;
              // Apply per-pose flipX by inverting the U axis on the prepacked
              // UV rect: shift origin to the right edge then negate uSize.
              // Composes correctly even with the facing-share's pre-baked U
              // sign — flipping a negative U just flips it back to positive.
              if (offset.flipX === true) {
                dst.uv[wi * 4 + 0] = wuv[0] + wuv[2];
                dst.uv[wi * 4 + 1] = wuv[1];
                dst.uv[wi * 4 + 2] = -wuv[2];
                dst.uv[wi * 4 + 3] = wuv[3];
              } else {
                dst.uv[wi * 4 + 0] = wuv[0];
                dst.uv[wi * 4 + 1] = wuv[1];
                dst.uv[wi * 4 + 2] = wuv[2];
                dst.uv[wi * 4 + 3] = wuv[3];
              }
              dst.primary[wi * 3 + 0] = scratchPrimary[k * 3 + 0]!;
              dst.primary[wi * 3 + 1] = scratchPrimary[k * 3 + 1]!;
              dst.primary[wi * 3 + 2] = scratchPrimary[k * 3 + 2]!;
              dst.secondary[wi * 3 + 0] = scratchSecondary[k * 3 + 0]!;
              dst.secondary[wi * 3 + 1] = scratchSecondary[k * 3 + 1]!;
              dst.secondary[wi * 3 + 2] = scratchSecondary[k * 3 + 2]!;
              dst.tertiary[wi * 3 + 0] = scratchTertiary[k * 3 + 0]!;
              dst.tertiary[wi * 3 + 1] = scratchTertiary[k * 3 + 1]!;
              dst.tertiary[wi * 3 + 2] = scratchTertiary[k * 3 + 2]!;
              dst.rot[wi] = (offset.rot * Math.PI) / 180;
              // Weapon shadow inputs: same foot/alpha as the carrier body so
              // the held musket projects against the same ground line. The
              // dying/dead branch above suppresses weapon emission entirely,
              // but we still write shadowAlpha=1 here for clarity.
              if (isBehind) {
                scratchWeaponBehindFootY[wi] = bodyFootYWorld;
                scratchWeaponBehindShadowAlpha[wi] = bodyShadowAlpha;
              } else {
                scratchWeaponFootY[wi] = bodyFootYWorld;
                scratchWeaponShadowAlpha[wi] = bodyShadowAlpha;
              }
              if (isBehind) wbn++;
              else wn++;
            }
          }
          // Body rotation: bodyRotNow is set above (zero outside Dying/Dead).
          scratchRot[k] = bodyRotNow;
        }
      }

      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // ---- Ground shadows (drawn before all sprite draws so any sprite in
      // front correctly occludes shadows behind it). Each group needs only
      // pos / size / uvRect / rot / footY / shadowAlpha — color / palette /
      // pattern buffers don't need re-upload here since the shadow shader
      // doesn't read them. Sprite-pass uploads will overwrite the shared
      // pos/size/uv/rot buffers immediately afterward.
      gl.useProgram(shadowProg);
      gl.uniformMatrix3fv(shadowU.u_viewProj, false, viewProjection(cam));
      gl.uniform1i(shadowU.u_atlas, 0);

      // Body shadows.
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchSize.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, uvRectBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchUv.subarray(0, n * 4));
      gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRot.subarray(0, n));
      gl.bindBuffer(gl.ARRAY_BUFFER, footYBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchFootY.subarray(0, n));
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowAlphaBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchShadowAlpha.subarray(0, n));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);

      // Weapon-behind shadows.
      if (wbn > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindPos.subarray(0, wbn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindSize.subarray(0, wbn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, uvRectBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindUv.subarray(0, wbn * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindRot.subarray(0, wbn));
        gl.bindBuffer(gl.ARRAY_BUFFER, footYBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindFootY.subarray(0, wbn));
        gl.bindBuffer(gl.ARRAY_BUFFER, shadowAlphaBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindShadowAlpha.subarray(0, wbn));
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, wbn);
      }

      // Weapon-front shadows.
      if (wn > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponPos.subarray(0, wn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponSize.subarray(0, wn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, uvRectBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponUv.subarray(0, wn * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponRot.subarray(0, wn));
        gl.bindBuffer(gl.ARRAY_BUFFER, footYBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponFootY.subarray(0, wn));
        gl.bindBuffer(gl.ARRAY_BUFFER, shadowAlphaBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponShadowAlpha.subarray(0, wn));
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, wn);
      }

      // ---- Sprite draws. Depth-write the body z derived from foot-Y so that
      // grass / trees in front (larger foot-Y) cover the body and vice versa.
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.useProgram(prog);
      gl.uniform1i(u.u_atlas, 0);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.uniform1f(u.u_patternFeatureWorld, PATTERN_FEATURE_PIXELS / cam.zoom);
      gl.uniform1f(u.u_worldH, worldH);

      // Weapons-behind pass: rear-facings (N/NE/NW) drawn FIRST so the body
      // composited next will occlude the weapon.
      if (wbn > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindPos.subarray(0, wbn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindSize.subarray(0, wbn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindColor.subarray(0, wbn * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, uvRectBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindUv.subarray(0, wbn * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, primaryBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindPrimary.subarray(0, wbn * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, secondaryBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindSecondary.subarray(0, wbn * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, tertiaryBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindTertiary.subarray(0, wbn * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, patternBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindPattern.subarray(0, wbn));
        gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponBehindRot.subarray(0, wbn));
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, wbn);
      }

      // Bodies pass.
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchSize.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchColor.subarray(0, n * 4));
      gl.bindBuffer(gl.ARRAY_BUFFER, uvRectBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchUv.subarray(0, n * 4));
      gl.bindBuffer(gl.ARRAY_BUFFER, primaryBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPrimary.subarray(0, n * 3));
      gl.bindBuffer(gl.ARRAY_BUFFER, secondaryBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchSecondary.subarray(0, n * 3));
      gl.bindBuffer(gl.ARRAY_BUFFER, tertiaryBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchTertiary.subarray(0, n * 3));
      gl.bindBuffer(gl.ARRAY_BUFFER, patternBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPattern.subarray(0, n));
      gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRot.subarray(0, n));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);

      // Weapons-front pass: front-facings (S/SE/SW/E/W) drawn AFTER bodies so
      // the weapon overlays the body. Same VAO, shader, atlas.
      if (wn > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponPos.subarray(0, wn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponSize.subarray(0, wn * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponColor.subarray(0, wn * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, uvRectBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponUv.subarray(0, wn * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, primaryBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponPrimary.subarray(0, wn * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, secondaryBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponSecondary.subarray(0, wn * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, tertiaryBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponTertiary.subarray(0, wn * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, patternBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponPattern.subarray(0, wn));
        gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchWeaponRot.subarray(0, wn));
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, wn);
      }

      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);

      gl.bindVertexArray(null);
    },
    getAtlas() {
      return atlas;
    },
    getSheetDims() {
      return { w: sheetW, h: sheetH, poseAtlasY };
    },
    getWeaponUvByPrefix() {
      return weaponUvByPrefix;
    },
    getHeadUvByPrefix() {
      return headUvByPrefix;
    },
    replaceAtlasTexture(image) {
      // Width/height inference: ImageBitmap exposes width/height directly;
      // ImageData and HTMLCanvasElement do too. Cast through `any` to keep
      // the union flexible without exhaustive type-narrowing here.
      const imgW = (image as { width: number }).width;
      const imgH = (image as { height: number }).height;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      // Force PMA-off / no flip — match the original `createTextureRGBA`
      // upload path so PNG alpha + texel layout stay consistent.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (imgW === atlasW && imgH === atlasH) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
        atlasW = imgW;
        atlasH = imgH;
      }
    },
  };
}
