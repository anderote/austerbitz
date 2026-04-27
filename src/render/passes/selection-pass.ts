import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { SELECTION_VS, SELECTION_FS } from '../shaders/selection.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import type { Selection, DragRect } from '../../input/selection';
import { getUnitKindByIndex } from '../../data/units';
import { screenToWorld } from '../camera';

export interface SelectionPass {
  draw(world: World, cam: Camera, sel: Selection, drag: DragRect): void;
}

export function createSelectionPass(gl: WebGL2RenderingContext, capacity: number): SelectionPass {
  const prog = linkProgram(gl, SELECTION_VS, SELECTION_FS);
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

  const radBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  gl.bindVertexArray(null);

  const scratchPos = new Float32Array(capacity * 2);
  const scratchRad = new Float32Array(capacity);

  // Drag rectangle uses a small immediate-mode line draw — separate VAO
  const dragVao = createVertexArray(gl);
  gl.bindVertexArray(dragVao);
  const dragBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, 8 * 2 * 4, gl.DYNAMIC_DRAW); // 8 verts × vec2
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return {
    draw(world, cam, sel, drag) {
      // Rings
      let n = 0;
      const e = world.entities;
      for (const id of sel.ids) {
        if (e.alive[id] === 0) continue;
        const kind = getUnitKindByIndex(e.kindId[id]!);
        scratchPos[n * 2 + 0] = e.posX[id]!;
        scratchPos[n * 2 + 1] = e.posY[id]!;
        scratchRad[n] = Math.max(kind.placeholderSize.w, kind.placeholderSize.h) * 0.7;
        n++;
      }
      gl.useProgram(prog);
      if (n > 0) {
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, radBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRad.subarray(0, n));
        gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
      }

      // Drag-rect overlay (drawn in world space too)
      if (drag.active) {
        const a = screenToWorld(cam, drag.start);
        const b = screenToWorld(cam, drag.current);
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
        const verts = new Float32Array([
          x0, y0,  x1, y0,
          x1, y0,  x1, y1,
          x1, y1,  x0, y1,
          x0, y1,  x0, y0,
        ]);
        gl.bindVertexArray(dragVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
        gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
        gl.drawArrays(gl.LINES, 0, 8);
        gl.bindVertexArray(null);
      }
    },
  };
}
