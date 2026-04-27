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

const SOLDIER_FALLBACK = KIND_ATLAS['line-infantry']!;

export interface SpritePass {
  draw(world: World, cam: Camera): void;
}

interface FactionPalette {
  /** Coat color (RGB 0..255). */
  primary: [number, number, number];
  /** Facings / plume / collar / turnbacks (RGB 0..255). */
  secondary: [number, number, number];
}

/**
 * Per-team uniform colors. Indexed by `entities.team`. Add entries here as
 * new factions are introduced; missing teams fall back to entry 0.
 */
const TEAM_COLORS: readonly FactionPalette[] = [
  { primary: [180, 40, 50], secondary: [50, 60, 140] },   // 0 — British: red coat / blue facings
  { primary: [50, 60, 140], secondary: [200, 60, 70] },   // 1 — French: blue coat / red facings
];

const FALLBACK_TEAM = TEAM_COLORS[0]!;

export function createSpritePass(gl: WebGL2RenderingContext, capacity: number): SpritePass {
  const prog = linkProgram(gl, SPRITE_VS, SPRITE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj', 'u_atlas'] as const);

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

  gl.bindVertexArray(null);

  // Combined atlas: don't tile-wrap (each cell occupies a sub-rect, sampling
  // outside the cell would bleed into neighbours).
  const atlas = createTextureRGBA(
    gl,
    COMBINED_SHEET_W,
    COMBINED_SHEET_H,
    generateCombinedAtlas(),
    { wrap: gl.CLAMP_TO_EDGE },
  );

  // Cell UV rect for a given kind. `col`/`row` are local to that kind's
  // 3x3 region; we add the region's pixel offset before normalizing.
  const cellUv = (
    meta: KindAtlasMeta,
    col: number,
    row: number,
  ): [number, number, number, number] => {
    const halfTexelU = 0.5 / COMBINED_SHEET_W;
    const halfTexelV = 0.5 / COMBINED_SHEET_H;
    const px = meta.region.x + col * meta.cellW;
    const py = meta.region.y + row * meta.cellH;
    const u0 = px / COMBINED_SHEET_W + halfTexelU;
    const v0 = py / COMBINED_SHEET_H + halfTexelV;
    const us = meta.cellW / COMBINED_SHEET_W - 2 * halfTexelU;
    const vs = meta.cellH / COMBINED_SHEET_H - 2 * halfTexelV;
    return [u0, v0, us, vs];
  };

  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity * 2);
  const scratchColor = new Float32Array(capacity * 4);
  const scratchUv = new Float32Array(capacity * 4);
  const scratchPrimary = new Float32Array(capacity * 3);
  const scratchSecondary = new Float32Array(capacity * 3);
  // Reused per-frame sort buffer: alive entity ids sorted back-to-front by world Y.
  const sortIdx: number[] = [];

  return {
    draw(world, cam) {
      const e = world.entities;
      sortIdx.length = 0;
      for (let i = 0; i < e.capacity; i++) {
        if (e.alive[i] === 1) sortIdx.push(i);
      }
      const n = sortIdx.length;
      if (n === 0) return;
      // World Y grows downward, so larger Y = in front. Draw ascending by Y
      // so front sprites overwrite back ones (painter's algorithm).
      const posY = e.posY;
      sortIdx.sort((a, b) => posY[a]! - posY[b]!);

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
        scratchSize[k * 2 + 0] = kind.placeholderSize.w;
        scratchSize[k * 2 + 1] = kind.placeholderSize.h;
        scratchColor[k * 4 + 0] = kind.placeholderColor[0] / 255;
        scratchColor[k * 4 + 1] = kind.placeholderColor[1] / 255;
        scratchColor[k * 4 + 2] = kind.placeholderColor[2] / 255;
        scratchColor[k * 4 + 3] = 1.0;
        const team = TEAM_COLORS[e.team[i]!] ?? FALLBACK_TEAM;
        scratchPrimary[k * 3 + 0] = team.primary[0] / 255;
        scratchPrimary[k * 3 + 1] = team.primary[1] / 255;
        scratchPrimary[k * 3 + 2] = team.primary[2] / 255;
        scratchSecondary[k * 3 + 0] = team.secondary[0] / 255;
        scratchSecondary[k * 3 + 1] = team.secondary[1] / 255;
        scratchSecondary[k * 3 + 2] = team.secondary[2] / 255;
        const meta = KIND_ATLAS[kind.id] ?? SOLDIER_FALLBACK;
        const facing = e.facing[i]!;
        const cell = facing >= 1 && facing <= meta.poseCells.length
          ? meta.poseCells[facing - 1]!
          : (kind.spriteCell ?? meta.tintCell);
        const uv = cellUv(meta, cell.col, cell.row);
        scratchUv[k * 4 + 0] = uv[0];
        scratchUv[k * 4 + 1] = uv[1];
        scratchUv[k * 4 + 2] = uv[2];
        scratchUv[k * 4 + 3] = uv[3];
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

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(u.u_atlas, 0);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);

      gl.bindVertexArray(null);
    },
  };
}
