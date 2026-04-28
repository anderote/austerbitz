import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { SPRITE_VS, SPRITE_FS } from '../shaders/sprite.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import { getUnitKindByIndex } from '../../data/units';
import { DroppedKind } from '../../sim/dropped-items';
import type { KitConfig } from '../poses/kit-loader';

export interface DroppedItemsPass {
  draw(world: World, cam: Camera): void;
}

interface FactionPalette {
  primary: [number, number, number];
  secondary: [number, number, number];
  tertiary: [number, number, number];
}

// Inline regiment palette fallback — mirrors sprite-pass's hardcoded list.
// Kept in-pass to avoid plumbing a second async fetch through the renderer.
const regiments: FactionPalette[] = [
  { primary: [40, 80, 190],   secondary: [240, 230, 210], tertiary: [25, 20, 35] },
  { primary: [180, 40, 50],   secondary: [240, 230, 210], tertiary: [25, 20, 35] },
  { primary: [35, 45, 75],    secondary: [240, 230, 210], tertiary: [15, 15, 20] },
  { primary: [40, 75, 50],    secondary: [240, 230, 210], tertiary: [15, 15, 20] },
  { primary: [225, 215, 195], secondary: [120, 105, 85],  tertiary: [15, 15, 20] },
];
const FALLBACK_TEAM = regiments[0]!;

// Weapon source sprites are 32x36 (full cell with the musket pixels occupying
// a transparent 32x36 canvas). Body cells are 32 wide; pxToWorld = sprW / 32
// keeps the weapon scaled 1:1 with the body sprite that authored it.
const SPRITE_CELL_PX = 32;
const WEAPON_PX_W = 32;
const WEAPON_PX_H = 36;

export function createDroppedItemsPass(
  gl: WebGL2RenderingContext,
  capacity: number,
  kits: ReadonlyMap<string, KitConfig>,
  atlas: WebGLTexture,
  weaponUvByPrefix: ReadonlyMap<string, ReadonlyArray<readonly [number, number, number, number] | null>>,
  headUvByPrefix: ReadonlyMap<string, ReadonlyArray<readonly [number, number, number, number] | null>>,
): DroppedItemsPass {
  const prog = linkProgram(gl, SPRITE_VS, SPRITE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj', 'u_atlas', 'u_patternFeatureWorld'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

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

  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity * 2);
  const scratchColor = new Float32Array(capacity * 4);
  const scratchUv = new Float32Array(capacity * 4);
  const scratchPrimary = new Float32Array(capacity * 3);
  const scratchSecondary = new Float32Array(capacity * 3);
  const scratchTertiary = new Float32Array(capacity * 3);
  const scratchPattern = new Float32Array(capacity);
  const scratchRot = new Float32Array(capacity);

  return {
    draw(world, cam) {
      const PATTERN_FEATURE_PIXELS = 4;
      const d = world.droppedItems;
      const simTime = world.simTime;
      let n = 0;
      for (let id = 0; id < d.capacity; id++) {
        if (d.alive[id] !== 1) continue;
        const kindIdx = d.kindId[id]!;
        const kind = getUnitKindByIndex(kindIdx);
        const kit = kits.get(kind.id);
        if (!kit) continue;
        // Route to the right UV cache based on item kind. Defensive skip if
        // the kit lacks the corresponding block (shouldn't happen at runtime
        // since spawn-side gates on the same fields).
        const itemKind = d.kind[id]!;
        let wuv: readonly [number, number, number, number] | null = null;
        if (itemKind === DroppedKind.Hat) {
          if (!kit.head) continue;
          const uvList = headUvByPrefix.get(kit.head.layerPrefix);
          if (!uvList) continue;
          wuv = uvList[d.facing[id]!] ?? null;
        } else {
          if (!kit.weapon) continue;
          const uvList = weaponUvByPrefix.get(kit.weapon.layerPrefix);
          if (!uvList) continue;
          wuv = uvList[d.facing[id]!] ?? null;
        }
        if (!wuv) continue;

        const sprW = kind.spriteSize?.w ?? kind.placeholderSize.w;
        const pxToWorld = sprW / SPRITE_CELL_PX;
        const wWorldW = WEAPON_PX_W * pxToWorld;
        const wWorldH = WEAPON_PX_H * pxToWorld;

        // Tumble interpolation: while elapsed < animDur, lerp between start
        // and end pose and add a parabolic vertical lift + extra rotational
        // turns so the item visibly arcs and spins. After animDur, snap to
        // the final resting pose.
        const dur = d.animDur[id]!;
        const elapsed = simTime - d.spawnTime[id]!;
        let drawX: number;
        let drawY: number;
        let drawRot: number;
        if (dur > 0 && elapsed < dur) {
          const t = elapsed / dur;
          drawX = d.startX[id]! + (d.posX[id]! - d.startX[id]!) * t;
          drawY = d.startY[id]! + (d.posY[id]! - d.startY[id]!) * t;
          // World Y grows downward, so subtracting moves the sprite visually
          // upward (toward the camera/north) at the arc's apex.
          drawY -= d.arcH[id]! * 4 * t * (1 - t);
          // Total turns: hats whirl more than muskets. Direction follows the
          // horizontal travel sign so the spin matches the visible motion.
          const totalTurns = d.kind[id] === DroppedKind.Hat ? 1.75 : 0.75;
          const sign = (d.posX[id]! - d.startX[id]!) >= 0 ? 1 : -1;
          drawRot = d.startRot[id]! + (d.rot[id]! - d.startRot[id]!) * t + sign * totalTurns * Math.PI * 2 * t;
        } else {
          drawX = d.posX[id]!;
          drawY = d.posY[id]!;
          drawRot = d.rot[id]!;
        }

        scratchPos[n * 2 + 0] = drawX;
        scratchPos[n * 2 + 1] = drawY;
        scratchSize[n * 2 + 0] = wWorldW;
        scratchSize[n * 2 + 1] = wWorldH;
        scratchColor[n * 4 + 0] = 1;
        scratchColor[n * 4 + 1] = 1;
        scratchColor[n * 4 + 2] = 1;
        scratchColor[n * 4 + 3] = 1;
        // flipX honoring: same trick sprite-pass uses for its weapon overlay.
        if (d.flipX[id] === 1) {
          scratchUv[n * 4 + 0] = wuv[0] + wuv[2];
          scratchUv[n * 4 + 1] = wuv[1];
          scratchUv[n * 4 + 2] = -wuv[2];
          scratchUv[n * 4 + 3] = wuv[3];
        } else {
          scratchUv[n * 4 + 0] = wuv[0];
          scratchUv[n * 4 + 1] = wuv[1];
          scratchUv[n * 4 + 2] = wuv[2];
          scratchUv[n * 4 + 3] = wuv[3];
        }
        const team = regiments[d.team[id]!] ?? FALLBACK_TEAM;
        scratchPrimary[n * 3 + 0] = team.primary[0] / 255;
        scratchPrimary[n * 3 + 1] = team.primary[1] / 255;
        scratchPrimary[n * 3 + 2] = team.primary[2] / 255;
        scratchSecondary[n * 3 + 0] = team.secondary[0] / 255;
        scratchSecondary[n * 3 + 1] = team.secondary[1] / 255;
        scratchSecondary[n * 3 + 2] = team.secondary[2] / 255;
        scratchTertiary[n * 3 + 0] = team.tertiary[0] / 255;
        scratchTertiary[n * 3 + 1] = team.tertiary[1] / 255;
        scratchTertiary[n * 3 + 2] = team.tertiary[2] / 255;
        scratchPattern[n] = 0;
        scratchRot[n] = drawRot;
        n++;
      }
      if (n === 0) return;

      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(u.u_atlas, 0);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.uniform1f(u.u_patternFeatureWorld, PATTERN_FEATURE_PIXELS / cam.zoom);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

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

      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    },
  };
}
