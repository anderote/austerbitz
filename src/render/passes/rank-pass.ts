import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { RANK_VS, RANK_FS } from '../shaders/rank.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import { getUnitKindByIndex } from '../../data/units';
import { isDead } from '../../sim/entities';

const QUAD_SIZE = 0.6;
export const ICON_GAP = 0.05;
const MIN_ZOOM_PX_PER_WORLD = 6;

export interface RankInstances {
  pos: Float32Array;     // [x, y] per icon
  rank: Float32Array;    // single float (1..4) per icon
  count: number;
  capacity: number;
}

export function createRankInstances(capacity: number): RankInstances {
  return {
    pos: new Float32Array(capacity * 2),
    rank: new Float32Array(capacity),
    count: 0,
    capacity,
  };
}

/**
 * Fill instance buffers with one rank-icon quad per non-Recruit alive entity,
 * anchored just below the unit's foot line. Recruits (rank === 0) and
 * dying/dead entities are skipped.
 */
export function computeRankInstances(world: World, out: RankInstances): void {
  const e = world.entities;
  let n = 0;
  const cap = Math.min(e.capacity, out.capacity);
  for (let i = 0; i < cap; i++) {
    if (e.alive[i] === 0) continue;
    if (isDead(e, i)) continue;
    const r = e.rank[i]!;
    if (r === 0) continue; // Recruit: no icon
    const kind = getUnitKindByIndex(e.kindId[i]!);
    const footY = e.posY[i]! + (kind.footYFromCenter ?? kind.placeholderSize.h * 0.5);
    out.pos[n * 2 + 0] = e.posX[i]!;
    out.pos[n * 2 + 1] = footY + ICON_GAP + QUAD_SIZE * 0.5;
    out.rank[n] = r;
    n++;
  }
  out.count = n;
}

export interface RankPass {
  draw(world: World, cam: Camera): void;
}

export function createRankPass(
  gl: WebGL2RenderingContext,
  capacity: number,
  atlasUrl: string,
): RankPass {
  const prog = linkProgram(gl, RANK_VS, RANK_FS);
  const u = getUniforms(gl, prog, ['u_viewProj', 'u_quadSize', 'u_atlas'] as const);

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

  const rankBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  gl.bindVertexArray(null);

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  };
  img.src = atlasUrl;

  const instances = createRankInstances(capacity);

  return {
    draw(world, cam) {
      if (cam.zoom < MIN_ZOOM_PX_PER_WORLD) return;
      computeRankInstances(world, instances);
      const n = instances.count;
      if (n === 0) return;
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.pos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, rankBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.rank.subarray(0, n));
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.uniform1f(u.u_quadSize, QUAD_SIZE);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.u_atlas, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.bindVertexArray(null);
    },
  };
}
