import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { PUFF_VS, PUFF_FS } from '../shaders/puff.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { Puffs } from '../../puffs/puffs';

export interface PuffPass {
  draw(puffs: Puffs, cam: Camera): void;
}

export function createPuffPass(gl: WebGL2RenderingContext, capacity: number): PuffPass {
  const prog = linkProgram(gl, PUFF_VS, PUFF_FS);
  const u = getUniforms(gl, prog, ['u_viewProj'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
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

  const alphaSoftBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);

  gl.bindVertexArray(null);

  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity * 2);
  const scratchColor = new Float32Array(capacity * 4);
  const scratchAS = new Float32Array(capacity * 2);

  return {
    draw(p, cam) {
      let n = 0;
      for (let i = 0; i < p.capacity; i++) {
        if (p.alive[i] === 0) continue;
        scratchPos[n * 2 + 0] = p.posX[i]!;
        scratchPos[n * 2 + 1] = p.posY[i]!;
        // Width grows preferentially as the puff approaches its sizeMax,
        // turning fresh round puffs into flat hanging gunsmoke billows.
        const size = p.size[i]!;
        const sm = p.sizeMax[i]!;
        const sizeFrac = sm > 0 ? size / sm : 0;
        const aspect = 1 + (p.aspectMax[i]! - 1) * sizeFrac;
        scratchSize[n * 2 + 0] = size * aspect;
        scratchSize[n * 2 + 1] = size;
        const lifeRatio = p.lifeMax[i]! > 0 ? p.life[i]! / p.lifeMax[i]! : 0;
        scratchColor[n * 4 + 0] = p.r[i]!;
        scratchColor[n * 4 + 1] = p.g[i]!;
        scratchColor[n * 4 + 2] = p.b[i]!;
        scratchColor[n * 4 + 3] = lifeRatio;
        scratchAS[n * 2 + 0] = p.alpha[i]!;
        scratchAS[n * 2 + 1] = p.softness[i]!;
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
      gl.bindBuffer(gl.ARRAY_BUFFER, alphaSoftBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchAS.subarray(0, n * 2));
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    },
  };
}
