import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import { generateGrassTile } from '../grass-texture';
import { TERRAIN_VS, TERRAIN_FS } from '../shaders/terrain.glsl';
import type { Camera } from '../camera';
import { viewProjection, screenToWorld } from '../camera';

export interface TerrainPass {
  draw(cam: Camera): void;
  setBlood(texture: WebGLTexture, worldW: number, worldH: number): void;
  setCrater(texture: WebGLTexture, worldW: number, worldH: number): void;
}

export function createTerrainPass(gl: WebGL2RenderingContext): TerrainPass {
  const prog = linkProgram(gl, TERRAIN_VS, TERRAIN_FS);
  const u = getUniforms(gl, prog, [
    'u_worldMin', 'u_worldMax', 'u_viewProj', 'u_tile', 'u_tileSize',
    'u_blood', 'u_crater', 'u_worldSize',
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

  const tileSize = 3072;
  const tile = createTextureRGBA(gl, tileSize, tileSize, generateGrassTile(tileSize));

  const tileWorldUnits = 2048; // ~1 tile across the 2000m map

  // 1×1 R8 fallback so initial draws (before setBlood/setCrater is called) don't sample
  // an unbound sampler.
  const fallbackBlood = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, fallbackBlood);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fallbackCrater = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, fallbackCrater);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let blood: WebGLTexture = fallbackBlood;
  let crater: WebGLTexture = fallbackCrater;
  let worldW = 1;
  let worldH = 1;

  return {
    setBlood(texture, w, h) {
      blood = texture;
      worldW = w;
      worldH = h;
    },
    setCrater(texture, w, h) {
      crater = texture;
      worldW = w;
      worldH = h;
    },
    draw(cam) {
      const min = screenToWorld(cam, { x: 0, y: 0 });
      const max = screenToWorld(cam, { x: cam.viewport.w, y: cam.viewport.h });

      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tile);
      gl.uniform1i(u.u_tile, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blood);
      gl.uniform1i(u.u_blood, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, crater);
      gl.uniform1i(u.u_crater, 2);
      gl.uniform1f(u.u_tileSize, tileWorldUnits);
      gl.uniform2f(u.u_worldSize, worldW, worldH);
      gl.uniform2f(u.u_worldMin, min.x, min.y);
      gl.uniform2f(u.u_worldMax, max.x, max.y);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },
  };
}
