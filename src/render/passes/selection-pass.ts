import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { SELECTION_VS, SELECTION_FS, WAYPOINT_VS, WAYPOINT_FS } from '../shaders/selection.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import type { Selection, DragRect } from '../../input/selection';
import { getUnitKindByIndex } from '../../data/units';
import { screenToWorld } from '../camera';
import { PLAYER_TEAM } from '../../sim/player';

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

  const colBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  const scratchPos = new Float32Array(capacity * 2);
  const scratchRad = new Float32Array(capacity);
  const scratchCol = new Float32Array(capacity * 3);

  // Drag rectangle uses a small immediate-mode line draw — separate VAO
  const dragVao = createVertexArray(gl);
  gl.bindVertexArray(dragVao);
  const dragBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, 8 * 2 * 4, gl.DYNAMIC_DRAW); // 8 verts × vec2
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Waypoint polylines — solid-color line segments through queued orders
  const wpProg = linkProgram(gl, WAYPOINT_VS, WAYPOINT_FS);
  const wpU = getUniforms(gl, wpProg, ['u_viewProj', 'u_color'] as const);
  const wpVao = createVertexArray(gl);
  gl.bindVertexArray(wpVao);
  const WP_MAX_VERTS = capacity * 32; // rough cap: 8 segments × 4 verts × N selected
  const wpBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, WP_MAX_VERTS * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const wpScratch = new Float32Array(WP_MAX_VERTS * 2);

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
        const isOwn = e.team[id] === PLAYER_TEAM;
        scratchCol[n * 3 + 0] = isOwn ? 0.4 : 1.0;
        scratchCol[n * 3 + 1] = isOwn ? 0.7 : 0.4;
        scratchCol[n * 3 + 2] = isOwn ? 1.0 : 0.4;
        n++;
      }
      gl.useProgram(prog);
      if (n > 0) {
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, radBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRad.subarray(0, n));
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchCol.subarray(0, n * 3));
        gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
      }

      // Waypoint chains for selected units that have a queue
      let wpN = 0;
      for (const id of sel.ids) {
        if (e.alive[id] === 0) continue;
        const queue = world.orderQueue.get(id);
        if (!queue || queue.length === 0) continue;
        let prevX = e.posX[id]!;
        let prevY = e.posY[id]!;
        for (const o of queue) {
          if (o.kind !== 'move' && o.kind !== 'attack-move') continue;
          if (wpN + 2 > WP_MAX_VERTS) break;
          wpScratch[wpN * 2 + 0] = prevX;
          wpScratch[wpN * 2 + 1] = prevY;
          wpScratch[wpN * 2 + 2] = o.targetX;
          wpScratch[wpN * 2 + 3] = o.targetY;
          wpN += 2;
          prevX = o.targetX;
          prevY = o.targetY;
        }
      }
      if (wpN > 0) {
        gl.useProgram(wpProg);
        gl.bindVertexArray(wpVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, wpBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, wpScratch.subarray(0, wpN * 2));
        gl.uniformMatrix3fv(wpU.u_viewProj, false, viewProjection(cam));
        gl.uniform4f(wpU.u_color, 0.4, 0.7, 1.0, 0.4);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.LINES, 0, wpN);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
        gl.useProgram(prog); // restore for downstream draws (drag-rect)
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
