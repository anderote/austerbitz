import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { DAMAGE_TEXT_VS, DAMAGE_TEXT_FS } from '../shaders/damage-text.glsl';
import { createGlyphAtlas, GLYPH_COUNT } from '../../fx/damage-texts/glyph-atlas';
import type { DamageTexts } from '../../fx/damage-texts/damage-texts';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';

/** World-space size of one glyph: ~knee-high to a soldier (~1.6 m tall). */
const GLYPH_W_WORLD = 0.3;
const GLYPH_H_WORLD = 0.4;
/** Per-digit horizontal stride (no kerning — equal to glyph width). */
const DIGIT_STRIDE_WORLD = GLYPH_W_WORLD;
/** Crit text scale multiplier — applied to size and digit spacing. */
const CRIT_SCALE = 1.4;

export interface DamageTextInstances {
  /** [x, y] per digit instance. */
  pos: Float32Array;
  /** digit value 0..9 per instance. */
  digit: Float32Array;
  /** [0..1] alpha per instance. */
  alpha: Float32Array;
  /** 0 or 1 per instance — VS scales size, FS picks color. */
  crit: Float32Array;
  count: number;
  capacity: number;
}

export function createDamageTextInstances(capacity: number): DamageTextInstances {
  return {
    pos: new Float32Array(capacity * 2),
    digit: new Float32Array(capacity),
    alpha: new Float32Array(capacity),
    crit: new Float32Array(capacity),
    count: 0,
    capacity,
  };
}

/** How many digits in `value` (1..3 for 0..999). */
function digitCount(value: number): number {
  if (value <= 0) return 1;
  if (value < 10) return 1;
  if (value < 100) return 2;
  return 3;
}

/**
 * Flatten the live damage-text pool into per-digit instances.
 *
 * For each text with value V having N digits, emit N instances spread
 * symmetrically around the text's center: digit `d ∈ [0, N)` sits at
 * `(d - (N-1)/2) * DIGIT_STRIDE_WORLD`. The most-significant digit is at
 * the leftmost offset.
 *
 * Alpha fade: full opacity for the first 70 % of life, linear ramp to 0
 * over the last 30 %. Same as the spec's `alpha = clamp(life / (0.3 *
 * lifeMax), 0, 1)` formula.
 */
export function computeDamageTextInstances(
  d: DamageTexts,
  out: DamageTextInstances,
): void {
  let n = 0;
  for (let k = 0; k < d.count; k++) {
    const i = d.aliveIds[k]!;
    const v = d.value[i]!;
    const nd = digitCount(v);
    if (n + nd > out.capacity) break;
    const cx = d.posX[i]!;
    const cy = d.posY[i]!;
    const lifeFrac = d.life[i]! / d.lifeMax[i]!;
    const a = Math.max(0, Math.min(1, lifeFrac / 0.3));
    const isCrit = d.crit[i]! === 1;
    const stride = isCrit ? DIGIT_STRIDE_WORLD * CRIT_SCALE : DIGIT_STRIDE_WORLD;
    for (let dIdx = 0; dIdx < nd; dIdx++) {
      // Most-significant digit first, leftmost slot.
      const placeDiv = Math.pow(10, nd - 1 - dIdx);
      const digit = Math.floor(v / placeDiv) % 10;
      const xOff = (dIdx - (nd - 1) * 0.5) * stride;
      out.pos[n * 2 + 0] = cx + xOff;
      out.pos[n * 2 + 1] = cy;
      out.digit[n] = digit;
      out.alpha[n] = a;
      out.crit[n] = isCrit ? 1 : 0;
      n++;
    }
  }
  out.count = n;
}

export interface DamageTextPass {
  draw(d: DamageTexts, cam: Camera): void;
}

export function createDamageTextPass(
  gl: WebGL2RenderingContext,
  capacity: number,
): DamageTextPass {
  // Instance capacity = pool capacity × 3 (max 3 digits per text).
  const instanceCap = capacity * 3;

  const prog = linkProgram(gl, DAMAGE_TEXT_VS, DAMAGE_TEXT_FS);
  const u = getUniforms(gl, prog, [
    'u_viewProj', 'u_glyphSize', 'u_glyphCount', 'u_atlas',
  ] as const);

  const atlas = createGlyphAtlas(gl);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  // Static corner buffer.
  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Per-instance: pos (vec2).
  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  // Per-instance: digit (float).
  const digitBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  // Per-instance: alpha (float).
  const alphaBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  // Per-instance: crit flag (float, 0 or 1).
  const critBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);

  gl.bindVertexArray(null);

  const instances = createDamageTextInstances(instanceCap);

  return {
    draw(d, cam) {
      computeDamageTextInstances(d, instances);
      const n = instances.count;
      if (n === 0) return;

      gl.useProgram(prog);
      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.pos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, digitBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.digit.subarray(0, n));
      gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.alpha.subarray(0, n));
      gl.bindBuffer(gl.ARRAY_BUFFER, critBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.crit.subarray(0, n));

      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.uniform2f(u.u_glyphSize, GLYPH_W_WORLD, GLYPH_H_WORLD);
      gl.uniform1f(u.u_glyphCount, GLYPH_COUNT);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.uniform1i(u.u_atlas, 0);

      // Standard alpha blending; fragments below the cutoff are discarded.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);

      gl.bindVertexArray(null);
    },
  };
}

// Re-export glyph-size constants in case callers want to align HUD/world UI.
export { GLYPH_W_WORLD, GLYPH_H_WORLD, DIGIT_STRIDE_WORLD };
