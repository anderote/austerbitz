import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import { SPRITE_VS, SPRITE_FS } from '../shaders/sprite.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import { getUnitKindByIndex } from '../../data/units';
import {
  generateBritishSoldierSheet,
  SOLDIER_SHEET_W,
  SOLDIER_SHEET_H,
  SOLDIER_CELL_W,
  SOLDIER_CELL_H,
  SOLDIER_TINT_CELL,
  POSE_CELLS,
} from '../british-soldier-sprite';

export interface SpritePass {
  draw(world: World, cam: Camera): void;
}

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

  gl.bindVertexArray(null);

  // Atlas: don't tile-wrap (each cell occupies a sub-rect, sampling outside
  // the cell would bleed into neighbours).
  const atlas = createTextureRGBA(
    gl,
    SOLDIER_SHEET_W,
    SOLDIER_SHEET_H,
    generateBritishSoldierSheet(),
    { wrap: gl.CLAMP_TO_EDGE },
  );

  // Per-cell UV rect cache (col*rows + row).
  const cellUv = (col: number, row: number): [number, number, number, number] => {
    // Inset a half-texel so NEAREST sampling stays clear of cell borders.
    const halfTexelU = 0.5 / SOLDIER_SHEET_W;
    const halfTexelV = 0.5 / SOLDIER_SHEET_H;
    const u0 = (col * SOLDIER_CELL_W) / SOLDIER_SHEET_W + halfTexelU;
    const v0 = (row * SOLDIER_CELL_H) / SOLDIER_SHEET_H + halfTexelV;
    const us = SOLDIER_CELL_W / SOLDIER_SHEET_W - 2 * halfTexelU;
    const vs = SOLDIER_CELL_H / SOLDIER_SHEET_H - 2 * halfTexelV;
    return [u0, v0, us, vs];
  };
  const tintUv = cellUv(SOLDIER_TINT_CELL.col, SOLDIER_TINT_CELL.row);

  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity * 2);
  const scratchColor = new Float32Array(capacity * 4);
  const scratchUv = new Float32Array(capacity * 4);

  return {
    draw(world, cam) {
      const e = world.entities;
      let n = 0;
      for (let i = 0; i < e.capacity; i++) {
        if (e.alive[i] === 0) continue;
        const kind = getUnitKindByIndex(e.kindId[i]!);
        scratchPos[n * 2 + 0] = e.posX[i]!;
        scratchPos[n * 2 + 1] = e.posY[i]!;
        scratchSize[n * 2 + 0] = kind.placeholderSize.w;
        scratchSize[n * 2 + 1] = kind.placeholderSize.h;
        scratchColor[n * 4 + 0] = kind.placeholderColor[0] / 255;
        scratchColor[n * 4 + 1] = kind.placeholderColor[1] / 255;
        scratchColor[n * 4 + 2] = kind.placeholderColor[2] / 255;
        scratchColor[n * 4 + 3] = 1.0;
        // facing in [1..POSE_CELLS.length] overrides the kind's default cell.
        const facing = e.facing[i]!;
        const overrideCell = facing >= 1 && facing <= POSE_CELLS.length
          ? POSE_CELLS[facing - 1]!
          : undefined;
        const cell = overrideCell ?? kind.spriteCell;
        const uv = cell ? cellUv(cell.col, cell.row) : tintUv;
        scratchUv[n * 4 + 0] = uv[0];
        scratchUv[n * 4 + 1] = uv[1];
        scratchUv[n * 4 + 2] = uv[2];
        scratchUv[n * 4 + 3] = uv[3];
        n++;
      }
      if (n === 0) return;

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
