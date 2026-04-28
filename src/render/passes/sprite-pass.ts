import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import { SPRITE_VS, SPRITE_FS } from '../shaders/sprite.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import { getUnitKindByIndex } from '../../data/units';
import { RECOIL_T, RECOIL_PUSH_END, RECOIL_HOLD_END } from '../../sim/fire-resolver';
import {
  KIND_ATLAS,
  COMBINED_SHEET_W,
  COMBINED_SHEET_H,
  generateCombinedAtlas,
  type KindAtlasMeta,
} from '../sprite-atlas';
import { type PoseAtlas, pickPoseUv, pickWeaponUv } from '../poses/atlas';
import { composeCombinedAtlas } from '../poses/combined-atlas';
import {
  resolveWeaponFacing,
  resolveWeaponPoseTransform,
  type Facing,
} from '../poses/resolver';
import { runtimePoseToEditorPoseName, type KitConfig } from '../poses/kit-loader';

const SOLDIER_FALLBACK = KIND_ATLAS['line-infantry']!;

// Module-scoped sort state so the comparator closure isn't re-allocated each
// frame. `sortPosY` is set just before each `sortIdx.sort(sortByY)` call.
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
  { id: 'british-line',  label: 'British Line',  primary: [180, 40, 50],   secondary: [240, 230, 210], tertiary: [25, 20, 35] },
  { id: 'french-line',   label: 'French Line',   primary: [50, 60, 140],   secondary: [240, 230, 210], tertiary: [25, 20, 35] },
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
): SpritePass {
  // Fire-and-forget regiment load; falls back to the hardcoded defaults until
  // the fetch resolves. Validation + warning live inside loadRegimentsAsync.
  void loadRegimentsAsync();

  const prog = linkProgram(gl, SPRITE_VS, SPRITE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj', 'u_atlas', 'u_patternFeatureWorld'] as const);

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
  // soldier per frame.
  const scratchWeaponPos = new Float32Array(capacity * 2);
  const scratchWeaponSize = new Float32Array(capacity * 2);
  const scratchWeaponColor = new Float32Array(capacity * 4);
  const scratchWeaponUv = new Float32Array(capacity * 4);
  const scratchWeaponPrimary = new Float32Array(capacity * 3);
  const scratchWeaponSecondary = new Float32Array(capacity * 3);
  const scratchWeaponTertiary = new Float32Array(capacity * 3);
  const scratchWeaponPattern = new Float32Array(capacity);
  const scratchWeaponRot = new Float32Array(capacity);
  // Reused per-frame sort buffer: alive entity ids sorted back-to-front by world Y.
  const sortIdx: number[] = [];

  /**
   * Pre-resolved weapon UV cache keyed by `kit.weapon.layerPrefix`. Each entry
   * holds the 8-facing UV-rect array (index = facing 0..7 in compass order
   * matching the runtime `e.facing[i]` 0..7 = E, NE, N, NW, W, SW, S, SE).
   * Computed once at startup from the pose-atlas's weaponCells; the per-frame
   * lookup is then a single Map.get + array index.
   */
  const weaponUvByPrefix = new Map<string, Array<[number, number, number, number] | null>>();
  if (poseAtlas) {
    for (const kit of kits.values()) {
      if (!kit.weapon) continue;
      if (weaponUvByPrefix.has(kit.weapon.layerPrefix)) continue;
      const uvs: Array<[number, number, number, number] | null> = new Array(8).fill(null);
      // Runtime facing 0..7 = E, SE, S, SW, W, NW, N, NE
      // (matches `(facing + 2) & 7` index into DIRECTIONS = [N, NE, E, SE, S, SW, W, NW]).
      const RUNTIME_FACING_ORDER: Facing[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
      for (let i = 0; i < 8; i++) {
        const facing = RUNTIME_FACING_ORDER[i]!;
        const resolved = resolveWeaponFacing(kit.weapon, facing);
        // resolved.spriteKey is `<layerPrefix>-<sourceFacing>` — extract sourceFacing.
        // Cleaner: we already know it's `entry.src` if !== 'self', else `facing`.
        const entry = kit.weapon.facings[facing]!;
        const sourceFacing: Facing = entry.src === 'self' ? facing : entry.src;
        uvs[i] = pickWeaponUv(
          poseAtlas,
          kit.weapon.layerPrefix,
          sourceFacing,
          resolved.transform,
          poseAtlasY,
          sheetW,
          sheetH,
        );
      }
      weaponUvByPrefix.set(kit.weapon.layerPrefix, uvs);
    }
  }
  // Map from runtime facing 0..7 -> Facing string, for per-pose offset lookup.
  const RUNTIME_FACING_TO_LETTER: Facing[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
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
      sortIdx.length = 0;
      for (let n = 0; n < e.count; n++) sortIdx.push(e.aliveIds[n]!);
      const n = sortIdx.length;
      if (n === 0) return;
      // World Y grows downward, so larger Y = in front. Draw ascending by Y
      // so front sprites overwrite back ones (painter's algorithm).
      sortPosY = e.posY;
      sortIdx.sort(sortByY);

      const useDots = cam.zoom < UNIT_DOT_ZOOM;
      const infantryDot = INFANTRY_DOT_PIXELS / cam.zoom;
      const cavalryDot = CAVALRY_DOT_PIXELS / cam.zoom;
      const artilleryDot = ARTILLERY_DOT_PIXELS / cam.zoom;

      // Per-frame weapon instance count. Bumped each time we emit a weapon
      // attached to a soldier — bound by `n` (one weapon per soldier max).
      let wn = 0;

      for (let k = 0; k < n; k++) {
        const i = sortIdx[k]!;
        const kind = getUnitKindByIndex(e.kindId[i]!);
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
        } else {
          scratchSize[k * 2 + 0] = kind.placeholderSize.w;
          scratchSize[k * 2 + 1] = kind.placeholderSize.h;
          scratchColor[k * 4 + 0] = kind.placeholderColor[0] / 255;
          scratchColor[k * 4 + 1] = kind.placeholderColor[1] / 255;
          scratchColor[k * 4 + 2] = kind.placeholderColor[2] / 255;
          scratchColor[k * 4 + 3] = 1.0;
          scratchPattern[k] = 0;
          const facing = e.facing[i]!;
          const pose = e.pose[i]!;
          const poseT = e.poseT[i]!;
          const clipIdx = e.clipIndex[i]!;
          let uv: readonly [number, number, number, number] | null = null;
          if (poseAtlas) {
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
          // its source sprites). Renders as a separate instance after all
          // bodies; per-pose `(x, y, rot)` lifted from the kit JSON.
          const kit = kits.get(kind.id);
          if (kit && kit.weapon) {
            const uvList = weaponUvByPrefix.get(kit.weapon.layerPrefix);
            const wuv = uvList ? uvList[facing] : null;
            if (wuv) {
              const facingLetter = RUNTIME_FACING_TO_LETTER[facing]!;
              const editorPose = runtimePoseToEditorPoseName(pose);
              const offset = editorPose
                ? resolveWeaponPoseTransform(kit.poses, editorPose, facingLetter, kit.weapon)
                : { x: 0, y: 0, rot: 0 };
              // Convert pixel offsets to world units. Body sprite is
              // SPRITE_CELL_PX (16) wide in `placeholderSize.w` world units.
              const pxToWorld = kind.placeholderSize.w / SPRITE_CELL_PX;
              const dxWorld = offset.x * pxToWorld;
              const dyWorld = offset.y * pxToWorld;
              // Weapon world size = 32x36 px scaled by the same px-per-world.
              const wWorldW = WEAPON_PX_W * pxToWorld;
              const wWorldH = WEAPON_PX_H * pxToWorld;
              scratchWeaponPos[wn * 2 + 0] = scratchPos[k * 2 + 0]! + dxWorld;
              scratchWeaponPos[wn * 2 + 1] = scratchPos[k * 2 + 1]! + dyWorld;
              scratchWeaponSize[wn * 2 + 0] = wWorldW;
              scratchWeaponSize[wn * 2 + 1] = wWorldH;
              // Weapon: white tint passthrough. Marker substitution still runs
              // in the FS, so any team-coloured pixels in the weapon sprite
              // get tinted from the same per-instance team palette.
              scratchWeaponColor[wn * 4 + 0] = 1;
              scratchWeaponColor[wn * 4 + 1] = 1;
              scratchWeaponColor[wn * 4 + 2] = 1;
              scratchWeaponColor[wn * 4 + 3] = 1;
              scratchWeaponPattern[wn] = 0;
              // Apply per-pose flipX by inverting the U axis on the prepacked
              // UV rect: shift origin to the right edge then negate uSize.
              // Composes correctly even with the facing-share's pre-baked U
              // sign — flipping a negative U just flips it back to positive.
              if (offset.flipX === true) {
                scratchWeaponUv[wn * 4 + 0] = wuv[0] + wuv[2];
                scratchWeaponUv[wn * 4 + 1] = wuv[1];
                scratchWeaponUv[wn * 4 + 2] = -wuv[2];
                scratchWeaponUv[wn * 4 + 3] = wuv[3];
              } else {
                scratchWeaponUv[wn * 4 + 0] = wuv[0];
                scratchWeaponUv[wn * 4 + 1] = wuv[1];
                scratchWeaponUv[wn * 4 + 2] = wuv[2];
                scratchWeaponUv[wn * 4 + 3] = wuv[3];
              }
              scratchWeaponPrimary[wn * 3 + 0] = scratchPrimary[k * 3 + 0]!;
              scratchWeaponPrimary[wn * 3 + 1] = scratchPrimary[k * 3 + 1]!;
              scratchWeaponPrimary[wn * 3 + 2] = scratchPrimary[k * 3 + 2]!;
              scratchWeaponSecondary[wn * 3 + 0] = scratchSecondary[k * 3 + 0]!;
              scratchWeaponSecondary[wn * 3 + 1] = scratchSecondary[k * 3 + 1]!;
              scratchWeaponSecondary[wn * 3 + 2] = scratchSecondary[k * 3 + 2]!;
              scratchWeaponTertiary[wn * 3 + 0] = scratchTertiary[k * 3 + 0]!;
              scratchWeaponTertiary[wn * 3 + 1] = scratchTertiary[k * 3 + 1]!;
              scratchWeaponTertiary[wn * 3 + 2] = scratchTertiary[k * 3 + 2]!;
              scratchWeaponRot[wn] = (offset.rot * Math.PI) / 180;
              wn++;
            }
          }
        }
        // Bodies always render axis-aligned.
        scratchRot[k] = 0;
      }

      gl.useProgram(prog);
      gl.bindVertexArray(vao);

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

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(u.u_atlas, 0);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.uniform1f(u.u_patternFeatureWorld, PATTERN_FEATURE_PIXELS / cam.zoom);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);

      // Weapon overlay pass: re-upload all per-instance buffers with the
      // weapon scratch arrays then draw on top of the bodies. Same VAO,
      // shader, atlas. Skipped at zoom levels where bodies render as dots
      // (since we don't emit weapons in that branch).
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

      gl.bindVertexArray(null);
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
