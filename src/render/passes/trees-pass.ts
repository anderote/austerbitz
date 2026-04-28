import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import {
  generateTreeAtlas, TREE_ATLAS_W, TREE_ATLAS_H, TREE_VARIANTS, TREE_W, TREE_H,
} from '../tree-sprite';
import { TREE_VS, TREE_FS } from '../shaders/tree.glsl';
import { mulberry32, randInt, randRange } from '../../map/prng';
import { viewProjection } from '../camera';
import type { Camera } from '../camera';
import type { WorldMap } from '../../map/world-map';

export interface TreesPass {
  draw(cam: Camera): void;
}

const TREES_PER_M2 = 1 / 4000;     // 2000² m² → ~1000 trees
const TREE_BASE_SIZE = 6.0;        // world-units wide; height = size * (H/W)
const TREE_SIZE_JITTER = 0.30;

function scatter(map: WorldMap): { foot: Float32Array; size: Float32Array; variant: Float32Array } {
  const r = mulberry32(53);
  const count = Math.floor(map.size.w * map.size.h * TREES_PER_M2);
  const foot = new Float32Array(count * 2);
  const size = new Float32Array(count);
  const variant = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    foot[i * 2 + 0] = randRange(r, 0, map.size.w);
    foot[i * 2 + 1] = randRange(r, 0, map.size.h);
    size[i] = TREE_BASE_SIZE * (1 + randRange(r, -TREE_SIZE_JITTER, TREE_SIZE_JITTER));
    variant[i] = randInt(r, 0, TREE_VARIANTS - 1);
  }
  return { foot, size, variant };
}

export function createTreesPass(gl: WebGL2RenderingContext, map: WorldMap): TreesPass {
  const prog = linkProgram(gl, TREE_VS, TREE_FS);
  const u = getUniforms(gl, prog, [
    'u_viewProj', 'u_atlas', 'u_atlasGrid', 'u_aspect', 'u_worldSize',
  ] as const);

  const atlas = createTextureRGBA(gl, TREE_ATLAS_W, TREE_ATLAS_H, generateTreeAtlas(), {
    wrap: gl.CLAMP_TO_EDGE,
  });

  const { foot, size, variant } = scatter(map);
  const count = size.length;

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const corners = new Float32Array([
    -0.5, 0,  0.5, 0,  -0.5, 1,
    -0.5, 1,  0.5, 0,   0.5, 1,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  createBuffer(gl, gl.ARRAY_BUFFER, foot, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  createBuffer(gl, gl.ARRAY_BUFFER, size, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  createBuffer(gl, gl.ARRAY_BUFFER, variant, gl.STATIC_DRAW);
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
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(u.u_atlas, 0);
      gl.uniform1f(u.u_atlasGrid, TREE_VARIANTS);
      gl.uniform1f(u.u_aspect, TREE_H / TREE_W);
      gl.uniform2f(u.u_worldSize, map.size.w, map.size.h);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      gl.bindVertexArray(null);
    },
  };
}
