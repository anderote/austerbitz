import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { SELECTION_VS, SELECTION_FS, WAYPOINT_VS, WAYPOINT_FS, DRAG_VS, DRAG_FS, PIP_VS, PIP_FS, RANGE_VS, RANGE_FS } from '../shaders/selection.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import type { Selection, DragRect, FormationPreview } from '../../input/selection';
import { hitTestRect } from '../../input/selection';
import { getUnitKindByIndex } from '../../data/units';
import { screenToWorld } from '../camera';
import { PLAYER_TEAM } from '../../sim/player';

export interface SelectionPass {
  // Tin-soldier base discs — call BEFORE the sprite pass so figures stand on top.
  // Selected units render green; units inside an active drag rect (preview)
  // render yellow.
  drawDiscs(world: World, cam: Camera, sel: Selection, drag: DragRect): void;
  // Waypoint chains, drag rectangle, and formation preview — call AFTER sprites so they overlay.
  draw(world: World, cam: Camera, sel: Selection, drag: DragRect, formation: FormationPreview | null): void;
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

  const sizeBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const colBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity * 2);
  const scratchCol = new Float32Array(capacity * 3);

  // Drag rectangle: dedicated program + VAO; marching-ants animated 1px lines.
  const dragProg = linkProgram(gl, DRAG_VS, DRAG_FS);
  const dragU = getUniforms(gl, dragProg, ['u_viewProj', 'u_time', 'u_color'] as const);
  const dragVao = createVertexArray(gl);
  gl.bindVertexArray(dragVao);
  const dragBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, 8 * 2 * 4, gl.DYNAMIC_DRAW); // 8 verts × vec2
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Formation slot pips — instanced hollow-square quads.
  const pipProg = linkProgram(gl, PIP_VS, PIP_FS);
  const pipU = getUniforms(gl, pipProg, ['u_viewProj', 'u_size', 'u_color'] as const);
  const pipVao = createVertexArray(gl);
  gl.bindVertexArray(pipVao);
  const pipCornersBuf = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const pipPosBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  const pipScratch = new Float32Array(capacity * 2);
  void pipCornersBuf;

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

  // Range/cone overlay for selected ranged units (Total War-style).
  const RANGE_SEGMENTS = 72;
  const RANGE_MAX_VERTS = RANGE_SEGMENTS + 2;
  const rangeProg = linkProgram(gl, RANGE_VS, RANGE_FS);
  const rangeU = getUniforms(gl, rangeProg, ['u_viewProj', 'u_color'] as const);
  const rangeVao = createVertexArray(gl);
  gl.bindVertexArray(rangeVao);
  const rangeBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, RANGE_MAX_VERTS * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const rangeScratch = new Float32Array(RANGE_MAX_VERTS * 2);
  const overlayPosScratch: number[] = [];
  const overlayForwardScratch: number[] = [];

  interface RangeOverlay {
    originX: number;
    originY: number;
    radius: number;
    dirX: number;
    dirY: number;
    halfAngle: number;
  }

  function computeRangeOverlay(world: World, sel: Selection): RangeOverlay | null {
    if (sel.ids.size === 0) return null;
    const e = world.entities;
    overlayPosScratch.length = 0;
    overlayForwardScratch.length = 0;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let dirX = 0;
    let dirY = 0;
    let fallbackFacing: number | null = null;
    let maxRange = 0;
    for (const id of sel.ids) {
      if (e.alive[id] !== 1) continue;
      const kind = getUnitKindByIndex(e.kindId[id]!);
      if (!kind.weapon) continue;
      const range = kind.baseStats.weaponRange;
      if (range <= 0) continue;
      const x = e.posX[id]!;
      const y = e.posY[id]!;
      overlayPosScratch.push(x, y);
      sumX += x;
      sumY += y;
      count++;
      if (range > maxRange) maxRange = range;
      const facing = e.facing[id]!;
      fallbackFacing = fallbackFacing ?? facing;
      const theta = (facing * Math.PI) / 4;
      dirX += Math.cos(theta);
      dirY += Math.sin(theta);
    }
    if (count === 0 || maxRange <= 0) return null;

    let dirLen = Math.hypot(dirX, dirY);
    if (dirLen < 1e-5) {
      if (fallbackFacing !== null) {
        const theta = (fallbackFacing * Math.PI) / 4;
        dirX = Math.cos(theta);
        dirY = Math.sin(theta);
        dirLen = 1;
      } else {
        dirX = 0;
        dirY = 1;
        dirLen = 1;
      }
    }
    dirX /= dirLen;
    dirY /= dirLen;

    const perpX = -dirY;
    const perpY = dirX;
    let minPerp = Infinity;
    let maxPerp = -Infinity;
    let minForward = Infinity;
    let maxForward = -Infinity;
    for (let i = 0; i < overlayPosScratch.length; i += 2) {
      const px = overlayPosScratch[i]!;
      const py = overlayPosScratch[i + 1]!;
      const forward = px * dirX + py * dirY;
      const lateral = px * perpX + py * perpY;
      if (forward < minForward) minForward = forward;
      if (forward > maxForward) maxForward = forward;
      if (lateral < minPerp) minPerp = lateral;
      if (lateral > maxPerp) maxPerp = lateral;
      overlayForwardScratch.push(forward);
    }

    const FRONT_MARGIN = 1.5;
    let frontSumX = 0;
    let frontSumY = 0;
    let frontCount = 0;
    for (let i = 0; i < overlayPosScratch.length; i += 2) {
      const px = overlayPosScratch[i]!;
      const py = overlayPosScratch[i + 1]!;
      const forward = overlayForwardScratch[i >> 1]!;
      if ((maxForward - forward) <= FRONT_MARGIN) {
        frontSumX += px;
        frontSumY += py;
        frontCount++;
      }
    }

    const originX = frontCount > 0 ? frontSumX / frontCount : sumX / count;
    const originY = frontCount > 0 ? frontSumY / frontCount : sumY / count;

    const width = Math.max(0, maxPerp - minPerp);
    const HALF_MIN = (25 * Math.PI) / 180;
    const HALF_MAX = (80 * Math.PI) / 180;
    const EXTRA_MARGIN = (10 * Math.PI) / 180;
    const spanHalf = width * 0.5;
    let halfAngle = Math.atan2(spanHalf, Math.max(maxRange, 1e-3)) + EXTRA_MARGIN;
    if (halfAngle < HALF_MIN) halfAngle = HALF_MIN;
    if (halfAngle > HALF_MAX) halfAngle = HALF_MAX;

    return { originX, originY, radius: maxRange, dirX, dirY, halfAngle };
  }

  function renderRangeOverlay(world: World, cam: Camera, sel: Selection): void {
    const overlay = computeRangeOverlay(world, sel);
    if (!overlay) return;
    const { originX, originY, radius, dirX, dirY, halfAngle } = overlay;
    if (radius <= 0) return;
    const baseAngle = Math.atan2(dirY, dirX);
    const startAngle = baseAngle - halfAngle;
    const endAngle = baseAngle + halfAngle;
    rangeScratch[0] = originX;
    rangeScratch[1] = originY;
    for (let i = 0; i <= RANGE_SEGMENTS; i++) {
      const t = i / RANGE_SEGMENTS;
      const ang = startAngle + (endAngle - startAngle) * t;
      rangeScratch[(i + 1) * 2 + 0] = originX + Math.cos(ang) * radius;
      rangeScratch[(i + 1) * 2 + 1] = originY + Math.sin(ang) * radius;
    }
    const vertCount = RANGE_SEGMENTS + 2;
    gl.useProgram(rangeProg);
    gl.uniformMatrix3fv(rangeU.u_viewProj, false, viewProjection(cam));
    gl.bindVertexArray(rangeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, rangeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rangeScratch.subarray(0, vertCount * 2));
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform4f(rangeU.u_color, 1.0, 0.93, 0.2, 0.16);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, vertCount);
    gl.uniform4f(rangeU.u_color, 1.0, 0.93, 0.2, 0.5);
    gl.drawArrays(gl.LINE_STRIP, 1, vertCount - 1);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  return {
    drawDiscs(world, cam, sel, drag) {
      renderRangeOverlay(world, cam, sel);
      const e = world.entities;
      const emit = (id: number, r: number, g: number, b: number): void => {
        if (e.alive[id] === 0) return;
        const kind = getUnitKindByIndex(e.kindId[id]!);
        const w = kind.placeholderSize.w;
        const h = kind.placeholderSize.h;
        // Disc straddles the foot line: center at the bottom of the sprite.
        scratchPos[n * 2 + 0] = e.posX[id]!;
        scratchPos[n * 2 + 1] = e.posY[id]! + h * 0.5;
        // Squashed ellipse — wider than tall to suggest a flat disc on the ground.
        scratchSize[n * 2 + 0] = w * 1.25;
        scratchSize[n * 2 + 1] = w * 0.55;
        scratchCol[n * 3 + 0] = r;
        scratchCol[n * 3 + 1] = g;
        scratchCol[n * 3 + 2] = b;
        n++;
      };

      let n = 0;
      // Selected: green
      for (const id of sel.ids) emit(id, 0.3, 1.0, 0.4);
      // Preview: yellow on own-team units inside the active drag rect, skipping
      // any already drawn as selected.
      if (drag.active) {
        const a = screenToWorld(cam, drag.start);
        const b = screenToWorld(cam, drag.current);
        const candidates = hitTestRect(world, a.x, a.y, b.x, b.y, { team: PLAYER_TEAM });
        for (const id of candidates) {
          if (sel.ids.has(id)) continue;
          emit(id, 1.0, 0.9, 0.2);
        }
      }
      if (n === 0) return;
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchSize.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchCol.subarray(0, n * 3));
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    },
    draw(world, cam, sel, drag, formation) {
      const e = world.entities;
      // Waypoint chains for player units that have a queue.
      //  - Selected units render at full opacity (group selections collapse
      //    to a single centroid line through per-index averaged targets).
      //  - Unselected player units' chains stay visible at low opacity so
      //    the player can still see where idle squads are headed.
      // Each "chain" is a flat list [x0,y0,x1,y1,...] starting at the unit's
      // (or group's) origin and stepping through waypoints.

      const halfW = 2 / cam.zoom;     // 4 game-pixels thick line
      const arrowLen = 7 / cam.zoom;
      const arrowHalf = 5 / cam.zoom;

      const renderChains = (chains: number[][], alpha: number, rgb?: readonly [number, number, number]): void => {
        if (chains.length === 0) return;
        let wpN = 0;
        const writeVert = (x: number, y: number): void => {
          wpScratch[wpN * 2 + 0] = x;
          wpScratch[wpN * 2 + 1] = y;
          wpN++;
        };
        for (const chain of chains) {
          if (chain.length < 4) continue;
          for (let i = 0; i + 3 < chain.length; i += 2) {
            if (wpN + 6 > WP_MAX_VERTS) break;
            const x0 = chain[i]!, y0 = chain[i + 1]!;
            const x1 = chain[i + 2]!, y1 = chain[i + 3]!;
            let dx = x1 - x0, dy = y1 - y0;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) continue;
            dx /= len; dy /= len;
            const px = -dy * halfW, py = dx * halfW;
            writeVert(x0 + px, y0 + py);
            writeVert(x0 - px, y0 - py);
            writeVert(x1 + px, y1 + py);
            writeVert(x1 + px, y1 + py);
            writeVert(x0 - px, y0 - py);
            writeVert(x1 - px, y1 - py);
          }
          if (wpN + 3 <= WP_MAX_VERTS) {
            const ix = chain.length - 4;
            const x0 = chain[ix]!, y0 = chain[ix + 1]!;
            const x1 = chain[ix + 2]!, y1 = chain[ix + 3]!;
            let dx = x1 - x0, dy = y1 - y0;
            const len = Math.hypot(dx, dy);
            if (len > 1e-6) {
              dx /= len; dy /= len;
              const px = -dy * arrowHalf, py = dx * arrowHalf;
              const bx = x1 - dx * arrowLen;
              const by = y1 - dy * arrowLen;
              writeVert(x1, y1);
              writeVert(bx + px, by + py);
              writeVert(bx - px, by - py);
            }
          }
        }
        if (wpN === 0) return;
        gl.useProgram(wpProg);
        gl.bindVertexArray(wpVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, wpBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, wpScratch.subarray(0, wpN * 2));
        gl.uniformMatrix3fv(wpU.u_viewProj, false, viewProjection(cam));
        gl.uniform4f(wpU.u_color, rgb?.[0] ?? 1.0, rgb?.[1] ?? 1.0, rgb?.[2] ?? 1.0, alpha);
        if (alpha < 1) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
        gl.drawArrays(gl.TRIANGLES, 0, wpN);
        if (alpha < 1) gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
      };

      const buildUnitChain = (id: number): number[] | null => {
        const queue = world.orderQueue.get(id);
        if (!queue || queue.length === 0) return null;
        const chain: number[] = [e.posX[id]!, e.posY[id]!];
        for (const o of queue) {
          if (o.kind !== 'move' && o.kind !== 'attack-move') continue;
          chain.push(o.targetX, o.targetY);
        }
        return chain.length >= 4 ? chain : null;
      };

      // Faded chains for unselected, alive, player-team units.
      // Cluster by *source position* via single-link union-find: any two
      // units within LINK_R of each other are the same squad. Squads are
      // physically tight (spacing ~1.4) while distinct squads sit far apart,
      // so this groups by visual cohesion rather than by destination spread,
      // which previously fragmented one squad into multiple arrows when its
      // spread targets crossed a grid-bucket boundary.
      const LINK_R = 4;
      const LINK_R2 = LINK_R * LINK_R;
      const candidates: number[] = [];
      for (const id of world.orderQueue.keys()) {
        if (e.alive[id] !== 1) continue;
        if (sel.ids.has(id)) continue;
        if (e.team[id] !== PLAYER_TEAM) continue;
        const q = world.orderQueue.get(id)!;
        let hasMove = false;
        for (const o of q) {
          if (o.kind === 'move' || o.kind === 'attack-move') { hasMove = true; break; }
        }
        if (hasMove) candidates.push(id);
      }
      const parent: number[] = candidates.map((_, i) => i);
      const find = (i: number): number => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
        return i;
      };
      for (let i = 0; i < candidates.length; i++) {
        const x1 = e.posX[candidates[i]!]!;
        const y1 = e.posY[candidates[i]!]!;
        for (let j = i + 1; j < candidates.length; j++) {
          const dx = e.posX[candidates[j]!]! - x1;
          const dy = e.posY[candidates[j]!]! - y1;
          if (dx * dx + dy * dy <= LINK_R2) {
            const ra = find(i), rb = find(j);
            if (ra !== rb) parent[ra] = rb;
          }
        }
      }
      const groups = new Map<number, number[]>();
      for (let i = 0; i < candidates.length; i++) {
        const r = find(i);
        let arr = groups.get(r);
        if (!arr) { arr = []; groups.set(r, arr); }
        arr.push(candidates[i]!);
      }
      const otherChains: number[][] = [];
      for (const ids of groups.values()) {
        if (ids.length === 1) {
          const chain = buildUnitChain(ids[0]!);
          if (chain) otherChains.push(chain);
          continue;
        }
        let cx = 0, cy = 0;
        for (const id of ids) {
          cx += e.posX[id]!;
          cy += e.posY[id]!;
        }
        cx /= ids.length;
        cy /= ids.length;
        const chain: number[] = [cx, cy];
        for (let k = 0; ; k++) {
          let sumX = 0, sumY = 0, count = 0;
          for (const id of ids) {
            const q = world.orderQueue.get(id);
            if (!q || k >= q.length) continue;
            const o = q[k]!;
            if (o.kind !== 'move' && o.kind !== 'attack-move') continue;
            sumX += o.targetX;
            sumY += o.targetY;
            count++;
          }
          if (count === 0) break;
          chain.push(sumX / count, sumY / count);
        }
        if (chain.length >= 4) otherChains.push(chain);
      }
      renderChains(otherChains, 0.2);

      // Full-opacity chain(s) for the active selection.
      const liveSelected: number[] = [];
      for (const id of sel.ids) {
        if (e.alive[id] === 1) liveSelected.push(id);
      }
      const selectedChains: number[][] = [];
      if (liveSelected.length > 1) {
        let cx = 0, cy = 0;
        for (const id of liveSelected) {
          cx += e.posX[id]!;
          cy += e.posY[id]!;
        }
        cx /= liveSelected.length;
        cy /= liveSelected.length;
        const chain: number[] = [cx, cy];
        for (let k = 0; ; k++) {
          let sumX = 0, sumY = 0, count = 0;
          for (const id of liveSelected) {
            const queue = world.orderQueue.get(id);
            if (!queue || k >= queue.length) continue;
            const o = queue[k]!;
            if (o.kind !== 'move' && o.kind !== 'attack-move') continue;
            sumX += o.targetX;
            sumY += o.targetY;
            count++;
          }
          if (count === 0) break;
          chain.push(sumX / count, sumY / count);
        }
        if (chain.length >= 4) selectedChains.push(chain);
      } else {
        for (const id of liveSelected) {
          const chain = buildUnitChain(id);
          if (chain) selectedChains.push(chain);
        }
      }
      renderChains(selectedChains, 1.0);

      // Drag-rect overlay: 1px marching-ants in world space.
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
        gl.useProgram(dragProg);
        gl.bindVertexArray(dragVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
        gl.uniformMatrix3fv(dragU.u_viewProj, false, viewProjection(cam));
        gl.uniform1f(dragU.u_time, performance.now() * 0.001);
        gl.uniform3f(dragU.u_color, 1.0, 1.0, 1.0); // white — selection drag
        gl.drawArrays(gl.LINES, 0, 8);
        gl.bindVertexArray(null);
      }

      // Formation preview: marching-ants outline + per-slot pips.
      if (formation) {
        const { rect, slots } = formation;
        const verts = new Float32Array([
          rect.tl.x, rect.tl.y,  rect.tr.x, rect.tr.y,
          rect.tr.x, rect.tr.y,  rect.br.x, rect.br.y,
          rect.br.x, rect.br.y,  rect.bl.x, rect.bl.y,
          rect.bl.x, rect.bl.y,  rect.tl.x, rect.tl.y,
        ]);
        gl.useProgram(dragProg);
        gl.bindVertexArray(dragVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
        gl.uniformMatrix3fv(dragU.u_viewProj, false, viewProjection(cam));
        gl.uniform1f(dragU.u_time, performance.now() * 0.001);
        gl.uniform3f(dragU.u_color, 0.55, 1.0, 0.6); // green — formation
        gl.drawArrays(gl.LINES, 0, 8);
        gl.bindVertexArray(null);

        const m = Math.min(slots.length, capacity);
        if (m > 0) {
          for (let i = 0; i < m; i++) {
            pipScratch[i * 2 + 0] = slots[i]!.x;
            pipScratch[i * 2 + 1] = slots[i]!.y;
          }
          gl.useProgram(pipProg);
          gl.bindVertexArray(pipVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, pipPosBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, pipScratch.subarray(0, m * 2));
          gl.uniformMatrix3fv(pipU.u_viewProj, false, viewProjection(cam));
          gl.uniform1f(pipU.u_size, 1.2); // world units; ~1m square pip
          gl.uniform3f(pipU.u_color, 0.55, 1.0, 0.6);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, m);
          gl.disable(gl.BLEND);
          gl.bindVertexArray(null);
        }

        // Transparent facing-direction arrow: from rect center along the
        // depth axis (bl - tl), extending slightly past the back rank.
        const cx = (rect.tl.x + rect.tr.x + rect.bl.x + rect.br.x) * 0.25;
        const cy = (rect.tl.y + rect.tr.y + rect.bl.y + rect.br.y) * 0.25;
        const dx = rect.bl.x - rect.tl.x;
        const dy = rect.bl.y - rect.tl.y;
        const depthLen = Math.hypot(dx, dy);
        if (depthLen > 1e-6) {
          const ux = dx / depthLen;
          const uy = dy / depthLen;
          const half = Math.max(depthLen * 0.5 + 2, 4);
          const tailX = cx - ux * half;
          const tailY = cy - uy * half;
          const tipX = cx + ux * half;
          const tipY = cy + uy * half;
          renderChains([[tailX, tailY, tipX, tipY]], 0.45, [0.55, 1.0, 0.6]);
        }
      }
    },
  };
}
