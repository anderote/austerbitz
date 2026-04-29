import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { TRAJECTORY_VS, TRAJECTORY_FS } from '../shaders/trajectory-preview.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';

const MAX_VERTS = 8192;

export interface TrajectoryPreviewPass {
  draw(cam: Camera, points: Float32Array, colors: Float32Array, vertCount: number): void;
}

export function createTrajectoryPreviewPass(gl: WebGL2RenderingContext): TrajectoryPreviewPass {
  const prog = linkProgram(gl, TRAJECTORY_VS, TRAJECTORY_FS);
  const u = getUniforms(gl, prog, ['u_viewProj'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  // a_pos: vec2 — positions buffer
  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_VERTS * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // a_color: vec3 — colors buffer
  const colBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_VERTS * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);

  return {
    draw(cam, points, colors, vertCount) {
      if (vertCount <= 0) return;
      const count = Math.min(vertCount, MAX_VERTS);

      gl.useProgram(prog);
      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, points.subarray(0, count * 2));

      gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors.subarray(0, count * 3));

      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.LINES, 0, count);
      gl.disable(gl.BLEND);

      gl.bindVertexArray(null);
    },
  };
}
