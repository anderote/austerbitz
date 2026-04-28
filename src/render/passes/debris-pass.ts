import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { DEBRIS_VS, DEBRIS_FS } from '../shaders/debris.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { Debris } from '../../sim/debris';
import type { DebrisAtlas } from '../debris-atlas';

/** Side length of one chunk PNG in pixels (matches `loadDebrisAtlas`). */
const CHUNK_PIXEL = 8;

export interface DebrisPass {
  /**
   * Draw all live debris instances. `worldUnitsPerPixel` should match the
   * unit-sprite scaling so chunks read at consistent size with the soldiers
   * they came from (sprite-pass uses ~`sprW / SPRITE_CELL_PX`; for line-
   * infantry that's 2.0 / 32 = 0.0625).
   */
  draw(d: Debris, atlas: DebrisAtlas, cam: Camera, worldUnitsPerPixel: number): void;
}

export function createDebrisPass(gl: WebGL2RenderingContext, capacity: number): DebrisPass {
  const prog = linkProgram(gl, DEBRIS_VS, DEBRIS_FS);
  const u = getUniforms(
    gl,
    prog,
    ['u_viewProj', 'u_pixelSize', 'u_atlas', 'u_team0', 'u_team1'] as const,
  );

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  // Static unit-quad corners (two triangles).
  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5,  0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const uvBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const rotBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  const teamBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);

  gl.bindVertexArray(null);

  // Per-frame scratch — sized once at startup, reused.
  const scratchPos = new Float32Array(capacity * 2);
  const scratchUv = new Float32Array(capacity * 4);
  const scratchRot = new Float32Array(capacity);
  const scratchTeam = new Float32Array(capacity);

  // Team palettes per spec — British red / French blue, RGB 0..1.
  const TEAM0 = new Float32Array([0.7, 0.15, 0.15]);
  const TEAM1 = new Float32Array([0.15, 0.25, 0.55]);

  return {
    draw(d, atlas, cam, worldUnitsPerPixel) {
      const n = d.count;
      if (n === 0) return;

      for (let i = 0; i < n; i++) {
        const id = d.aliveIds[i]!;
        // Visual height — render Y is shifted up by `z` so chunks appear above
        // the ground. Spec uses Y_FACTOR ≈ 1.0; world Y grows downward, so
        // subtract z to lift the sprite.
        scratchPos[i * 2 + 0] = d.posX[id]!;
        scratchPos[i * 2 + 1] = d.posY[id]! - d.z[id]!;

        const cId = d.chunkId[id]!;
        scratchUv[i * 4 + 0] = atlas.uvByChunkId[cId * 4 + 0]!;
        scratchUv[i * 4 + 1] = atlas.uvByChunkId[cId * 4 + 1]!;
        scratchUv[i * 4 + 2] = atlas.uvByChunkId[cId * 4 + 2]!;
        scratchUv[i * 4 + 3] = atlas.uvByChunkId[cId * 4 + 3]!;

        // Snap rotation to 8 buckets (every 45°) for the pixel-art aesthetic
        // — keeps each frame's rotation aligned to a discrete sprite axis,
        // avoiding the smeary look of free-rotated low-res pixels.
        const snapped = Math.round(d.spinDeg[id]! / 45) * 45;
        scratchRot[i] = snapped;
        scratchTeam[i] = d.team[id]!;
      }

      gl.useProgram(prog);
      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchUv.subarray(0, n * 4));
      gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRot.subarray(0, n));
      gl.bindBuffer(gl.ARRAY_BUFFER, teamBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchTeam.subarray(0, n));

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
      gl.uniform1i(u.u_atlas, 0);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.uniform1f(u.u_pixelSize, CHUNK_PIXEL * worldUnitsPerPixel);
      gl.uniform3fv(u.u_team0, TEAM0);
      gl.uniform3fv(u.u_team1, TEAM1);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);

      gl.bindVertexArray(null);
    },
  };
}
