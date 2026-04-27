import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { HEALTH_BAR_VS, HEALTH_BAR_FS } from '../shaders/health-bar.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import { getUnitKindByIndex } from '../../data/units';

const BAR_HEIGHT = 0.18;
// Vertical gap between disc bottom and bar top, in world units.
const BAR_GAP = 0.1;

export interface HealthBarInstances {
  pos: Float32Array;   // [x, y] per bar
  size: Float32Array;  // [w, h] per bar
  count: number;
  capacity: number;
}

export function createHealthBarInstances(capacity: number): HealthBarInstances {
  return {
    pos: new Float32Array(capacity * 2),
    size: new Float32Array(capacity * 2),
    count: 0,
    capacity,
  };
}

/**
 * Fill instance buffers with one bar per alive entity. Bars grow from the
 * left edge: width scales by hp/maxHp while the left edge stays anchored under
 * the unit's left side, so partial bars look like they've been chipped from
 * the right.
 */
export function computeHealthBarInstances(
  world: World,
  out: HealthBarInstances,
): void {
  const e = world.entities;
  let n = 0;
  const cap = Math.min(e.capacity, out.capacity);
  for (let i = 0; i < cap; i++) {
    if (e.alive[i] === 0) continue;
    const kind = getUnitKindByIndex(e.kindId[i]!);
    const maxHp = kind.baseStats.hp;
    if (maxHp <= 0) continue;
    const frac = Math.max(0, Math.min(1, e.hp[i]! / maxHp));
    if (frac === 0) continue;
    const w = kind.placeholderSize.w;
    const h = kind.placeholderSize.h;
    const fullW = w;
    const barW = fullW * frac;
    // Disc center: posY + h/2; disc half-height: w*0.275 (matches selection-pass).
    const discBottomY = e.posY[i]! + h * 0.5 + w * 0.275;
    const barCenterY = discBottomY + BAR_GAP + BAR_HEIGHT * 0.5;
    const leftEdge = e.posX[i]! - fullW * 0.5;
    const barCenterX = leftEdge + barW * 0.5;
    out.pos[n * 2 + 0] = barCenterX;
    out.pos[n * 2 + 1] = barCenterY;
    out.size[n * 2 + 0] = barW;
    out.size[n * 2 + 1] = BAR_HEIGHT;
    n++;
  }
  out.count = n;
}

export interface HealthBarPass {
  draw(world: World, cam: Camera): void;
}

export function createHealthBarPass(
  gl: WebGL2RenderingContext,
  capacity: number,
): HealthBarPass {
  const prog = linkProgram(gl, HEALTH_BAR_VS, HEALTH_BAR_FS);
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

  gl.bindVertexArray(null);

  const instances = createHealthBarInstances(capacity);

  return {
    draw(world, cam) {
      computeHealthBarInstances(world, instances);
      const n = instances.count;
      if (n === 0) return;
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.pos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.size.subarray(0, n * 2));
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.bindVertexArray(null);
    },
  };
}
