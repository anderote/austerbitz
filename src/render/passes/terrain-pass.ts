import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import { generateGrassTile } from '../grass-texture';
import { TERRAIN_VS, TERRAIN_FS } from '../shaders/terrain.glsl';
import type { Camera } from '../camera';
import { viewProjection, screenToWorld } from '../camera';

export interface TerrainPass {
  draw(cam: Camera): void;
}

export function createTerrainPass(gl: WebGL2RenderingContext): TerrainPass {
  const prog = linkProgram(gl, TERRAIN_VS, TERRAIN_FS);
  const u = getUniforms(gl, prog, [
    'u_worldMin', 'u_worldMax', 'u_viewProj', 'u_tile', 'u_tileSize',
  ] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const quad = new Float32Array([
    0, 0,  1, 0,  0, 1,
    0, 1,  1, 0,  1, 1,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const tileSize = 32;
  const tile = createTextureRGBA(gl, tileSize, tileSize, generateGrassTile(tileSize));

  const tileWorldUnits = 4; // 4 world meters per repeat — visible at zoom

  return {
    draw(cam) {
      const min = screenToWorld(cam, { x: 0, y: 0 });
      const max = screenToWorld(cam, { x: cam.viewport.w, y: cam.viewport.h });

      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tile);
      gl.uniform1i(u.u_tile, 0);
      gl.uniform1f(u.u_tileSize, tileWorldUnits);
      gl.uniform2f(u.u_worldMin, min.x, min.y);
      gl.uniform2f(u.u_worldMax, max.x, max.y);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },
  };
}
