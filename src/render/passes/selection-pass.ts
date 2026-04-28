import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { SELECTION_VS, SELECTION_FS, WAYPOINT_VS, WAYPOINT_FS, DRAG_VS, DRAG_FS, RANGE_VS, RANGE_FS } from '../shaders/selection.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import type { Selection, DragRect, FormationPreview } from '../../input/selection';
import { hitTestRect } from '../../input/selection';
import { getUnitKindByIndex } from '../../data/units';
import { screenToWorld } from '../camera';
import { PLAYER_TEAM } from '../../sim/player';
import { isDead } from '../../sim/entities';

// Reusable per-frame vert buffers for fixed-size line-loop overlays drawn
// inside `draw`. Each is 8 verts × vec2 = 16 floats.
const DRAG_RECT_VERTS = new Float32Array(16);
const FORMATION_OUTLINE_VERTS = new Float32Array(16);

export interface SelectionPass {
  // Tin-soldier base discs — call BEFORE the sprite pass so figures stand on top.
  // Selected units render green; units inside an active drag rect (preview)
  // render yellow.
  drawDiscs(world: World, cam: Camera, sel: Selection, drag: DragRect): void;
  drawTeamRange(world: World, cam: Camera, sel: Selection, team: number): void;
  // Waypoint chains, drag rectangle, and formation preview — call AFTER sprites so they overlay.
  draw(world: World, cam: Camera, sel: Selection, drag: DragRect, formation: FormationPreview | null): void;
  // Yellow per-soldier destination discs (same marker as selection base). Call AFTER sprites.
  drawMovePreview(world: World, cam: Camera, sel: Selection): void;
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
  const RANGE_PROFILE_SAMPLES = 96;
  const RANGE_MAX_VERTS = (RANGE_PROFILE_SAMPLES + 1) * 4;
  const FIRE_ARC_DEGREES = 110;
  const FIRE_ARC_HALF_RAD = (FIRE_ARC_DEGREES * Math.PI) / 360;
  const FIRE_ARC_COS = Math.cos(FIRE_ARC_HALF_RAD);
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
  const ringScratch = new Float32Array((RANGE_PROFILE_SAMPLES + 1) * 2);
  const overlayIdScratch: number[] = [];
  const overlayPosScratch: number[] = [];
  const overlayForwardScratch: number[] = [];
  const overlayLateralScratch: number[] = [];
  const overlayRangeScratch: number[] = [];
  const overlayFacingX: number[] = [];
  const overlayFacingY: number[] = [];
  const teamArtilleryScratch: number[] = [];
  const teamInfantryScratch: number[] = [];
  const angleScratch: number[] = [];
  const lengthScratch: number[] = [];
  const singleIdScratch: number[] = [];

  type RangeColor = readonly [number, number, number, number];

  interface RangeOverlay {
    top: number[];
    bottom: number[];
  }

  const COLOR_SELECTED: RangeColor = [1.0, 0.93, 0.2, 0.16];
  const COLOR_TEAM_WHITE: RangeColor = [1.0, 1.0, 1.0, 0.11];
  const COLOR_TEAM_ARTILLERY: RangeColor = [1.0, 1.0, 1.0, 0.35];

  function collectTeamRangeIds(
    world: World,
    team: number,
    predicate: ((kind: ReturnType<typeof getUnitKindByIndex>) => boolean) | null,
    out: number[],
  ): void {
    const e = world.entities;
    out.length = 0;
    for (let i = 0; i < e.count; i++) {
      const id = e.aliveIds[i]!;
      if (e.alive[id] !== 1) continue;
      if (isDead(e, id)) continue;
      if (e.team[id] !== team) continue;
      const kindIdx = e.kindId[id];
      const kind = getUnitKindByIndex(kindIdx);
      if (!kind.weapon || kind.baseStats.weaponRange <= 0) continue;
      if (predicate && !predicate(kind)) continue;
      out.push(id);
    }
  }

  function computeRangeOverlay(world: World, ids: readonly number[]): RangeOverlay | null {
    if (ids.length === 0) return null;
    const e = world.entities;
    overlayPosScratch.length = 0;
    overlayForwardScratch.length = 0;
    overlayLateralScratch.length = 0;
    overlayRangeScratch.length = 0;
    overlayFacingX.length = 0;
    overlayFacingY.length = 0;

    let dirSumX = 0;
    let dirSumY = 0;
    let fallbackFacing: number | null = null;
    let maxRange = 0;
    let count = 0;

    for (const id of ids) {
      if (e.alive[id] !== 1) continue;
      if (isDead(e, id)) continue;
      const kindIndex = e.kindId[id];
      const kind = kindIndex !== undefined ? getUnitKindByIndex(kindIndex) : null;
      if (!kind || !kind.weapon) continue;
      const range = kind.baseStats.weaponRange;
      if (range <= 0) continue;
      const x = e.posX[id]!;
      const y = e.posY[id]!;
      overlayPosScratch.push(x, y);
      overlayRangeScratch.push(range);
      count++;
      if (range > maxRange) maxRange = range;
      const facing = e.facing[id]!;
      fallbackFacing = fallbackFacing ?? facing;
      const theta = (facing * Math.PI) / 4;
      const fx = Math.cos(theta);
      const fy = Math.sin(theta);
      overlayFacingX.push(fx);
      overlayFacingY.push(fy);
      dirSumX += fx;
      dirSumY += fy;
    }

    if (count === 0 || maxRange <= 0) return null;

    let dirLen = Math.hypot(dirSumX, dirSumY);
    let dirX: number;
    let dirY: number;
    if (dirLen < 1e-5) {
      if (fallbackFacing !== null) {
        const theta = (fallbackFacing * Math.PI) / 4;
        dirX = Math.cos(theta);
        dirY = Math.sin(theta);
      } else {
        dirX = 0;
        dirY = 1;
      }
    } else {
      dirX = dirSumX / dirLen;
      dirY = dirSumY / dirLen;
    }

    const perpX = -dirY;
    const perpY = dirX;
    let minSample = Infinity;
    let maxSample = -Infinity;
    for (let i = 0, j = 0; i < overlayPosScratch.length; i += 2, j++) {
      const px = overlayPosScratch[i]!;
      const py = overlayPosScratch[i + 1]!;
      const forward = px * dirX + py * dirY;
      const lateral = px * perpX + py * perpY;
      overlayForwardScratch[j] = forward;
      overlayLateralScratch[j] = lateral;
      const range = overlayRangeScratch[j]!;
      const left = lateral - range;
      const right = lateral + range;
      if (left < minSample) minSample = left;
      if (right > maxSample) maxSample = right;
    }

    if (count === 0 || maxRange <= 0) return null;

    if (!Number.isFinite(minSample) || !Number.isFinite(maxSample)) return null;

    if (maxSample - minSample < 1e-4) {
      minSample -= maxRange * 0.5;
      maxSample += maxRange * 0.5;
    }

    const span = Math.max(maxSample - minSample, 1e-3);
    const samples = Math.max(12, Math.min(RANGE_PROFILE_SAMPLES, Math.ceil(span / Math.max(maxRange * 0.08, 0.5))));
    const topBoundary: number[] = [];
    const bottomBoundary: number[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = samples === 0 ? 0 : i / samples;
      const lateral = minSample + span * t;
      let bestForward = -Infinity;
      let bestIndex = -1;
      for (let j = 0; j < overlayForwardScratch.length; j++) {
        const baseForward = overlayForwardScratch[j]!;
        const baseLateral = overlayLateralScratch[j]!;
        const range = overlayRangeScratch[j]!;
        const delta = lateral - baseLateral;
        if (Math.abs(delta) > range) continue;
        const forwardDelta = Math.sqrt(Math.max(0, range * range - delta * delta));
        if (forwardDelta <= 1e-4) continue;
        const candidateForward = baseForward + forwardDelta;
        if (candidateForward <= baseForward) continue;
        const worldDX = dirX * forwardDelta + perpX * delta;
        const worldDY = dirY * forwardDelta + perpY * delta;
        const mag = Math.hypot(worldDX, worldDY);
        if (mag < 1e-5) continue;
        const facingDot = (worldDX * overlayFacingX[j]! + worldDY * overlayFacingY[j]!) / mag;
        if (facingDot < FIRE_ARC_COS) continue;
        if (candidateForward > bestForward) {
          bestForward = candidateForward;
          bestIndex = j;
        }
      }
      if (!Number.isFinite(bestForward) || bestIndex === -1) continue;
      const worldX = dirX * bestForward + perpX * lateral;
      const worldY = dirY * bestForward + perpY * lateral;
      topBoundary.push(worldX, worldY);
      bottomBoundary.push(overlayPosScratch[bestIndex * 2]!, overlayPosScratch[bestIndex * 2 + 1]!);
    }

    if (topBoundary.length < 4 || topBoundary.length !== bottomBoundary.length) return null;

    return { top: topBoundary, bottom: bottomBoundary };
  }

  function renderRangeOverlay(
    world: World,
    cam: Camera,
    ids: readonly number[],
    color: RangeColor,
    drawFill: boolean,
    ringSpacing: number | null,
  ): void {
    if (ids.length === 0) return;
    const overlay = computeRangeOverlay(world, ids);
    if (!overlay) return;
    const { top, bottom } = overlay;
    const sampleCount = top.length / 2;
    if (sampleCount < 2 || sampleCount !== bottom.length / 2) return;
    const vertCount = sampleCount * 2;
    if (vertCount > RANGE_MAX_VERTS) return;
    let ptr = 0;
    for (let i = 0; i < sampleCount; i++) {
      rangeScratch[ptr++] = top[i * 2 + 0]!;
      rangeScratch[ptr++] = top[i * 2 + 1]!;
      rangeScratch[ptr++] = bottom[i * 2 + 0]!;
      rangeScratch[ptr++] = bottom[i * 2 + 1]!;
    }
    gl.useProgram(rangeProg);
    gl.uniformMatrix3fv(rangeU.u_viewProj, false, viewProjection(cam));
    gl.bindVertexArray(rangeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, rangeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, rangeScratch.subarray(0, vertCount * 2));
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (drawFill) {
      gl.uniform4f(rangeU.u_color, color[0], color[1], color[2], color[3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertCount);
    }
    if (ringSpacing && ringSpacing > 0) {
      let centerX = 0;
      let centerY = 0;
      for (let i = 0; i < sampleCount; i++) {
        centerX += bottom[i * 2 + 0]!;
        centerY += bottom[i * 2 + 1]!;
      }
      centerX /= sampleCount;
      centerY /= sampleCount;

      angleScratch.length = sampleCount;
      lengthScratch.length = sampleCount;
      let prevAngle = 0;
      for (let i = 0; i < sampleCount; i++) {
        const tx = top[i * 2 + 0]!;
        const ty = top[i * 2 + 1]!;
        const dx = tx - centerX;
        const dy = ty - centerY;
        let ang = Math.atan2(dy, dx);
        if (i === 0) {
          prevAngle = ang;
        } else {
          while (ang - prevAngle > Math.PI) ang -= Math.PI * 2;
          while (ang - prevAngle < -Math.PI) ang += Math.PI * 2;
          prevAngle = ang;
        }
        angleScratch[i] = ang;
        lengthScratch[i] = Math.hypot(dx, dy);
      }
      const startAngle = angleScratch[0]!;
      const endAngle = angleScratch[sampleCount - 1]!;
      let maxLen = 0;
      for (let i = 0; i < sampleCount; i++) {
        if (lengthScratch[i]! > maxLen) maxLen = lengthScratch[i]!;
      }
      const sampleLengthAt = (angle: number): number => {
        if (angle <= startAngle) return lengthScratch[0]!;
        if (angle >= endAngle) return lengthScratch[sampleCount - 1]!;
        let idx = 0;
        while (idx + 1 < sampleCount && angleScratch[idx + 1]! < angle) idx++;
        const a0 = angleScratch[idx]!;
        const a1 = angleScratch[idx + 1]!;
        const l0 = lengthScratch[idx]!;
        const l1 = lengthScratch[idx + 1]!;
        const span = a1 - a0;
        if (Math.abs(span) < 1e-6) return Math.max(l0, l1);
        const t = (angle - a0) / span;
        return l0 + (l1 - l0) * t;
      };

      const rayCount: number = 4; // evenly spaced spokes
      const radialColor: RangeColor = [color[0], color[1], color[2], color[3] * 0.12];
      const angularSpan = Math.max(endAngle - startAngle, 1e-4);
      gl.uniform4f(rangeU.u_color, radialColor[0], radialColor[1], radialColor[2], radialColor[3]);
      for (let i = 0; i < rayCount; i++) {
        const t = rayCount === 1 ? 0.5 : i / (rayCount - 1);
        const angle = startAngle + angularSpan * t;
        const len = sampleLengthAt(angle);
        if (len <= 0.25) continue;
        ringScratch[0] = centerX;
        ringScratch[1] = centerY;
        ringScratch[2] = centerX + Math.cos(angle) * len;
        ringScratch[3] = centerY + Math.sin(angle) * len;
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, ringScratch.subarray(0, 4));
        gl.drawArrays(gl.LINES, 0, 2);
      }

      const minorSpacing = ringSpacing / 5;
      const totalRings = Math.min(60, Math.floor(maxLen / minorSpacing));
      if (totalRings > 0) {
        const arcStep = Math.max(angularSpan / Math.max(sampleCount * 2, 1), 0.03);
        for (let r = 1; r <= totalRings; r++) {
          const radius = r * minorSpacing;
          const isMajor = (r % 5) === 0;
          const arcAlpha = isMajor ? color[3] * 0.35 : color[3] * 0.12;
          const arcTint = isMajor ? 1.0 : 0.9;
          gl.uniform4f(rangeU.u_color, color[0] * arcTint, color[1] * arcTint, color[2] * arcTint, arcAlpha);
          let ringPtr = 0;
          const flush = (): void => {
            if (ringPtr >= 4) {
              gl.bufferSubData(gl.ARRAY_BUFFER, 0, ringScratch.subarray(0, ringPtr));
              gl.drawArrays(gl.LINE_STRIP, 0, ringPtr / 2);
            }
            ringPtr = 0;
          };
          for (let angle = startAngle; angle <= endAngle + 1e-6; angle += arcStep) {
            const len = sampleLengthAt(angle);
            if (len + 0.5 < radius) {
              flush();
              continue;
            }
            ringScratch[ringPtr++] = centerX + Math.cos(angle) * radius;
            ringScratch[ringPtr++] = centerY + Math.sin(angle) * radius;
          }
          flush();
        }
        gl.uniform4f(rangeU.u_color, color[0], color[1], color[2], color[3]);
      }
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  return {
    drawDiscs(world, cam, sel, drag) {
      overlayIdScratch.length = 0;
      for (const id of sel.ids) overlayIdScratch.push(id);
      if (overlayIdScratch.length > 0) {
        renderRangeOverlay(world, cam, overlayIdScratch, COLOR_SELECTED, true, null);
      }
      const e = world.entities;
      const emit = (id: number, r: number, g: number, b: number): void => {
        if (e.alive[id] === 0) return;
        if (isDead(e, id)) return;
        const kind = getUnitKindByIndex(e.kindId[id]!);
        const w = kind.placeholderSize.w;
        const h = kind.placeholderSize.h;
        // Disc straddles the foot line. Use the kind's foot offset if set,
        // otherwise fall back to the bottom of the quad.
        const footY = kind.footYFromCenter ?? h * 0.5;
        scratchPos[n * 2 + 0] = e.posX[id]!;
        scratchPos[n * 2 + 1] = e.posY[id]! + footY;
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
        const a = drag.startWorld;
        const b = screenToWorld(cam, drag.currentScreen);
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
    drawTeamRange(world, cam, sel, team) {
      teamArtilleryScratch.length = 0;
      for (const id of sel.ids) {
        if (!Number.isInteger(id)) continue;
        if (world.entities.alive[id] !== 1) continue;
        if (isDead(world.entities, id)) continue;
        if (world.entities.team[id] !== team) continue;
        const kind = getUnitKindByIndex(world.entities.kindId[id]!);
        if (!kind.weapon || kind.baseStats.weaponRange <= 0) continue;
        if (kind.category !== 'artillery') continue;
        teamArtilleryScratch.push(id);
      }
      if (teamArtilleryScratch.length > 0) {
        const yardsToMeters = 0.9144;
        const spacing = 50 * yardsToMeters;
        for (const id of teamArtilleryScratch) {
          singleIdScratch.length = 1;
          singleIdScratch[0] = id;
          renderRangeOverlay(world, cam, singleIdScratch, COLOR_TEAM_ARTILLERY, false, spacing);
        }
      }
      collectTeamRangeIds(world, team, kind => kind.category !== 'artillery', teamInfantryScratch);
      if (teamInfantryScratch.length > 0) {
        renderRangeOverlay(world, cam, teamInfantryScratch, COLOR_TEAM_WHITE, true, null);
      }
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

      const renderChains = (chains: number[][], alpha: number, rgb?: readonly [number, number, number], noArrow?: boolean): void => {
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
          if (!noArrow && wpN + 3 <= WP_MAX_VERTS) {
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

      // Single-link union-find clumping by source position: any two units
      // within LINK_R of each other belong to the same squad. Squads are
      // physically tight (spacing ~1.4) while distinct squads sit far apart,
      // so this groups by visual cohesion rather than by destination spread,
      // which previously fragmented one squad into multiple arrows when its
      // spread targets crossed a grid-bucket boundary.
      const LINK_R = 4;
      const LINK_R2 = LINK_R * LINK_R;
      const clusterByLink = (ids: readonly number[]): number[][] => {
        const parent: number[] = ids.map((_, i) => i);
        const find = (i: number): number => {
          while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
          return i;
        };
        for (let i = 0; i < ids.length; i++) {
          const x1 = e.posX[ids[i]!]!;
          const y1 = e.posY[ids[i]!]!;
          for (let j = i + 1; j < ids.length; j++) {
            const dx = e.posX[ids[j]!]! - x1;
            const dy = e.posY[ids[j]!]! - y1;
            if (dx * dx + dy * dy <= LINK_R2) {
              const ra = find(i), rb = find(j);
              if (ra !== rb) parent[ra] = rb;
            }
          }
        }
        const groups = new Map<number, number[]>();
        for (let i = 0; i < ids.length; i++) {
          const r = find(i);
          let arr = groups.get(r);
          if (!arr) { arr = []; groups.set(r, arr); }
          arr.push(ids[i]!);
        }
        return Array.from(groups.values());
      };

      // Faded chains for unselected, alive, player-team units.
      const candidates: number[] = [];
      for (const id of world.orderQueue.keys()) {
        if (e.alive[id] !== 1) continue;
        if (isDead(e, id)) continue;
        if (sel.ids.has(id)) continue;
        if (e.team[id] !== PLAYER_TEAM) continue;
        const q = world.orderQueue.get(id)!;
        let hasMove = false;
        for (const o of q) {
          if (o.kind === 'move' || o.kind === 'attack-move') { hasMove = true; break; }
        }
        if (hasMove) candidates.push(id);
      }
      const otherChains: number[][] = [];
      for (const ids of clusterByLink(candidates)) {
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
        if (e.alive[id] !== 1) continue;
        if (isDead(e, id)) continue;
        liveSelected.push(id);
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
      renderChains(selectedChains, 1.0, [1.0, 0.93, 0.2]);

      // Green marching-ants bounds around each clump of selected units.
      // Single-unit "clumps" are skipped — the selection disc already marks them.
      if (liveSelected.length >= 2) {
        const selClumps = clusterByLink(liveSelected);
        let drewAny = false;
        for (const ids of selClumps) {
          if (ids.length < 2) continue;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const id of ids) {
            const x = e.posX[id]!, y = e.posY[id]!;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          const pad = 1.5;
          const x0 = minX - pad, y0 = minY - pad;
          const x1 = maxX + pad, y1 = maxY + pad;
          if (!drewAny) {
            gl.useProgram(dragProg);
            gl.bindVertexArray(dragVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
            gl.uniformMatrix3fv(dragU.u_viewProj, false, viewProjection(cam));
            gl.uniform1f(dragU.u_time, performance.now() * 0.001);
            gl.uniform3f(dragU.u_color, 0.55, 1.0, 0.6);
            drewAny = true;
          }
          const v = DRAG_RECT_VERTS;
          v[0]  = x0; v[1]  = y0; v[2]  = x1; v[3]  = y0;
          v[4]  = x1; v[5]  = y0; v[6]  = x1; v[7]  = y1;
          v[8]  = x1; v[9]  = y1; v[10] = x0; v[11] = y1;
          v[12] = x0; v[13] = y1; v[14] = x0; v[15] = y0;
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
          gl.drawArrays(gl.LINES, 0, 8);
        }
        if (drewAny) gl.bindVertexArray(null);
      }

      // Drag-rect overlay: 1px marching-ants in world space.
      if (drag.active) {
        const a = drag.startWorld;
        const b = screenToWorld(cam, drag.currentScreen);
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
        const v = DRAG_RECT_VERTS;
        v[0]  = x0; v[1]  = y0; v[2]  = x1; v[3]  = y0;
        v[4]  = x1; v[5]  = y0; v[6]  = x1; v[7]  = y1;
        v[8]  = x1; v[9]  = y1; v[10] = x0; v[11] = y1;
        v[12] = x0; v[13] = y1; v[14] = x0; v[15] = y0;
        gl.useProgram(dragProg);
        gl.bindVertexArray(dragVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
        gl.uniformMatrix3fv(dragU.u_viewProj, false, viewProjection(cam));
        gl.uniform1f(dragU.u_time, performance.now() * 0.001);
        gl.uniform3f(dragU.u_color, 1.0, 1.0, 1.0); // white — selection drag
        gl.drawArrays(gl.LINES, 0, 8);
        gl.bindVertexArray(null);
      }

      // Formation preview: marching-ants outline + per-slot pips.
      if (formation) {
        const { rect, slots } = formation;
        const v = FORMATION_OUTLINE_VERTS;
        v[0]  = rect.tl.x; v[1]  = rect.tl.y; v[2]  = rect.tr.x; v[3]  = rect.tr.y;
        v[4]  = rect.tr.x; v[5]  = rect.tr.y; v[6]  = rect.br.x; v[7]  = rect.br.y;
        v[8]  = rect.br.x; v[9]  = rect.br.y; v[10] = rect.bl.x; v[11] = rect.bl.y;
        v[12] = rect.bl.x; v[13] = rect.bl.y; v[14] = rect.tl.x; v[15] = rect.tl.y;
        gl.useProgram(dragProg);
        gl.bindVertexArray(dragVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
        gl.uniformMatrix3fv(dragU.u_viewProj, false, viewProjection(cam));
        gl.uniform1f(dragU.u_time, performance.now() * 0.001);
        gl.uniform3f(dragU.u_color, 0.55, 1.0, 0.6); // green — formation
        gl.drawArrays(gl.LINES, 0, 8);
        gl.bindVertexArray(null);

        const m = Math.min(slots.length, capacity);
        if (m > 0) {
          // Per-slot base discs in formation green — same ellipse shape as
          // selection / move-preview discs. Size derives from the widest
          // selected unit's placeholder, so mixed selections still fit.
          let maxW = 0;
          let repFootY = 0;
          for (const id of sel.ids) {
            if (e.alive[id] !== 1) continue;
            if (isDead(e, id)) continue;
            const kind = getUnitKindByIndex(e.kindId[id]!);
            if (kind.placeholderSize.w > maxW) {
              maxW = kind.placeholderSize.w;
              repFootY = kind.footYFromCenter ?? kind.placeholderSize.h * 0.5;
            }
          }
          if (maxW <= 0) maxW = 1;
          const sx = maxW * 1.25;
          const sy = maxW * 0.55;
          for (let i = 0; i < m; i++) {
            scratchPos[i * 2 + 0] = slots[i]!.x;
            scratchPos[i * 2 + 1] = slots[i]!.y + repFootY;
            scratchSize[i * 2 + 0] = sx;
            scratchSize[i * 2 + 1] = sy;
            scratchCol[i * 3 + 0] = 0.55;
            scratchCol[i * 3 + 1] = 1.0;
            scratchCol[i * 3 + 2] = 0.6;
          }
          gl.useProgram(prog);
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, m * 2));
          gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchSize.subarray(0, m * 2));
          gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchCol.subarray(0, m * 3));
          gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, m);
          gl.disable(gl.BLEND);
          gl.bindVertexArray(null);
        }

        // Transparent facing-direction arrow: from rect center along the
        // facing axis (tl - bl, opposite of depth), extending slightly past
        // the front rank to indicate where units will be looking.
        const cx = (rect.tl.x + rect.tr.x + rect.bl.x + rect.br.x) * 0.25;
        const cy = (rect.tl.y + rect.tr.y + rect.bl.y + rect.br.y) * 0.25;
        const dx = rect.tl.x - rect.bl.x;
        const dy = rect.tl.y - rect.bl.y;
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

          // Firing-range preview: a dotted white line from the arrow tip
          // forward by the longest weapon range in the selection, capped by
          // a solid white perpendicular bar marking the max effective reach.
          let maxRange = 0;
          for (const id of sel.ids) {
            if (e.alive[id] !== 1) continue;
            if (isDead(e, id)) continue;
            const kindIdx = e.kindId[id];
            if (kindIdx === undefined) continue;
            const kind = getUnitKindByIndex(kindIdx);
            if (!kind.weapon) continue;
            const r = kind.baseStats.weaponRange;
            if (r > maxRange) maxRange = r;
          }
          if (maxRange > 0) {
            // Anchor at the front-rank midpoint so the endpoint matches the
            // yellow range overlay (which is measured from each unit outward).
            const frontMidX = (rect.tl.x + rect.tr.x) * 0.5;
            const frontMidY = (rect.tl.y + rect.tr.y) * 0.5;
            const endX = frontMidX + ux * maxRange;
            const endY = frontMidY + uy * maxRange;
            const lv = DRAG_RECT_VERTS;
            lv[0] = frontMidX; lv[1] = frontMidY;
            lv[2] = endX;      lv[3] = endY;
            gl.useProgram(dragProg);
            gl.bindVertexArray(dragVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, lv.subarray(0, 4));
            gl.uniformMatrix3fv(dragU.u_viewProj, false, viewProjection(cam));
            gl.uniform1f(dragU.u_time, performance.now() * 0.001);
            gl.uniform3f(dragU.u_color, 1.0, 1.0, 1.0);
            gl.drawArrays(gl.LINES, 0, 2);
            gl.bindVertexArray(null);

            const px = -uy;
            const py = ux;
            const tickHalf = Math.max(depthLen * 0.5, 3);
            const aX = endX + px * tickHalf;
            const aY = endY + py * tickHalf;
            const bX = endX - px * tickHalf;
            const bY = endY - py * tickHalf;
            renderChains([[aX, aY, bX, bY]], 0.95, [1, 1, 1], true);
          }
        }
      }
    },
    drawMovePreview(world, cam, sel) {
      const e = world.entities;
      const finalDest = (id: number): { x: number; y: number } | null => {
        const queue = world.orderQueue.get(id);
        if (!queue || queue.length === 0) return null;
        for (let k = queue.length - 1; k >= 0; k--) {
          const o = queue[k]!;
          if (o.kind === 'move' || o.kind === 'attack-move' || o.kind === 'march-formation') {
            return { x: o.targetX, y: o.targetY };
          }
        }
        return null;
      };

      let n = 0;
      const emit = (id: number, r: number, g: number, b: number): void => {
        if (e.alive[id] !== 1) return;
        if (isDead(e, id)) return;
        const dst = finalDest(id);
        if (!dst) return;
        if (n >= capacity) return;
        const kind = getUnitKindByIndex(e.kindId[id]!);
        const w = kind.placeholderSize.w;
        const h = kind.placeholderSize.h;
        const footY = kind.footYFromCenter ?? h * 0.5;
        scratchPos[n * 2 + 0] = dst.x;
        scratchPos[n * 2 + 1] = dst.y + footY;
        scratchSize[n * 2 + 0] = w * 1.25;
        scratchSize[n * 2 + 1] = w * 0.55;
        scratchCol[n * 3 + 0] = r;
        scratchCol[n * 3 + 1] = g;
        scratchCol[n * 3 + 2] = b;
        n++;
      };

      // Selected units: yellow disc at final destination.
      for (const id of sel.ids) emit(id, 1.0, 0.9, 0.2);
      // Unselected player units: white disc at final destination.
      for (const id of world.orderQueue.keys()) {
        if (sel.ids.has(id)) continue;
        if (e.team[id] !== PLAYER_TEAM) continue;
        emit(id, 1.0, 1.0, 1.0);
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
  };
}
