import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import {
  generateTuftAtlas, TUFT_ATLAS_W, TUFT_ATLAS_H, TUFT_VARIANTS, TUFT_W, TUFT_H,
} from '../grass-tuft-sprite';
import { TUFT_VS, TUFT_FS } from '../shaders/grass-tuft.glsl';
import { mulberry32, randInt, randRange } from '../../map/prng';
import { viewProjection } from '../camera';
import type { Camera } from '../camera';
import type { WorldMap } from '../../map/world-map';

export interface GrassTuftsPass {
  draw(cam: Camera): void;
}

const TUFTS_PER_M2 = 1 / 100;      // 2000² m² → ~40 000 tufts
const TUFT_BASE_SIZE = 1.1;        // world-units wide; height = size * (H/W)
const TUFT_SIZE_JITTER = 0.35;     // ± fraction

function scatter(map: WorldMap): Float32Array[] {
  const r = mulberry32(31);
  const count = Math.floor(map.size.w * map.size.h * TUFTS_PER_M2);
  const foot = new Float32Array(count * 2);
  const size = new Float32Array(count);
  const variant = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    foot[i * 2 + 0] = randRange(r, 0, map.size.w);
    foot[i * 2 + 1] = randRange(r, 0, map.size.h);
    size[i] = TUFT_BASE_SIZE * (1 + randRange(r, -TUFT_SIZE_JITTER, TUFT_SIZE_JITTER));
    variant[i] = randInt(r, 0, TUFT_VARIANTS - 1);
  }
  return [foot, size, variant];
}

export function createGrassTuftsPass(gl: WebGL2RenderingContext, map: WorldMap): GrassTuftsPass {
  const prog = linkProgram(gl, TUFT_VS, TUFT_FS);
  const u = getUniforms(gl, prog, [
    'u_viewProj', 'u_atlas', 'u_atlasGrid', 'u_aspect', 'u_worldH',
  ] as const);

  const atlas = createTextureRGBA(gl, TUFT_ATLAS_W, TUFT_ATLAS_H, generateTuftAtlas(), {
    wrap: gl.CLAMP_TO_EDGE,
  });

  const [foot, size, variant] = scatter(map);
  const count = size.length;

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  // Unit-quad corners: cx in {-0.5, 0.5}, cy in {0, 1}. cy=1 is the foot.
  const corners = new Float32Array([
    -0.5, 0,  0.5, 0,  -0.5, 1,
    -0.5, 1,  0.5, 0,   0.5, 1,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  createBuffer(gl, gl.ARRAY_BUFFER, foot!, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  createBuffer(gl, gl.ARRAY_BUFFER, size!, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  createBuffer(gl, gl.ARRAY_BUFFER, variant!, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  return {
    draw(cam) {
      if (count === 0) return;
      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(u.u_atlas, 0);
      gl.uniform1f(u.u_atlasGrid, TUFT_VARIANTS);
      gl.uniform1f(u.u_aspect, TUFT_H / TUFT_W);
      gl.uniform1f(u.u_worldH, map.size.h);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
    },
  };
}
