import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';

const BLOOD_STAIN_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;       // unit-quad corner [-0.5..0.5]
layout(location = 1) in vec2 a_pos;          // splat world center (m)
layout(location = 2) in float a_radius;      // splat radius (m)
layout(location = 3) in float a_intensity;   // 0..1
uniform vec2 u_worldSize;                    // total world size (m)
out vec2 v_local;                            // [-1..1] from quad center
out float v_intensity;

void main() {
  vec2 world = a_pos + a_corner * 2.0 * a_radius;
  vec2 uv = world / u_worldSize;
  vec2 ndc = uv * 2.0 - 1.0;
  v_local = a_corner * 2.0;
  v_intensity = a_intensity;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

const BLOOD_STAIN_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in float v_intensity;
out vec4 outColor;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // Wobble the apparent radius per-fragment for irregular blob edges.
  float n = hash21(floor(v_local * 8.0));
  float r = length(v_local) * (0.92 + 0.16 * n);
  float a = 1.0 - smoothstep(0.55, 1.0, r);
  if (a <= 0.0) discard;
  outColor = vec4(a * v_intensity, 0.0, 0.0, a * v_intensity);
}
`;

export interface BloodStainPass {
  /** Splat a blood stain at world (x,y) with given radius (meters) and intensity 0..1. */
  splat(x: number, y: number, radius: number, intensity: number): void;
  /** Flush queued splats into the stain texture. Call once per frame, before terrain renders. */
  flush(): void;
  /** WebGL texture handle for the stain — terrain pass binds this. */
  readonly texture: WebGLTexture;
  /** World size used for UV mapping (read by terrain pass uniform). */
  readonly worldW: number;
  readonly worldH: number;
  /** Clear all accumulated stain. */
  clear(): void;
}

const TEXELS_PER_METER = 2; // 0.5 m / texel

export function createBloodStainPass(
  gl: WebGL2RenderingContext,
  worldW: number,
  worldH: number,
): BloodStainPass {
  // R8 single-channel stain texture covering the world. Cap to GL_MAX_TEXTURE_SIZE.
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const texW = Math.min(maxSize, Math.ceil(worldW * TEXELS_PER_METER));
  const texH = Math.min(maxSize, Math.ceil(worldH * TEXELS_PER_METER));

  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, texW, texH, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('createFramebuffer returned null');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  // Clear to black (no stain).
  gl.viewport(0, 0, texW, texH);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const prog = linkProgram(gl, BLOOD_STAIN_VS, BLOOD_STAIN_FS);
  const u = getUniforms(gl, prog, ['u_worldSize'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const CAPACITY = 4096;
  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, CAPACITY * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const radBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, CAPACITY * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const intBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, CAPACITY * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  const pendingPos = new Float32Array(CAPACITY * 2);
  const pendingRad = new Float32Array(CAPACITY);
  const pendingInt = new Float32Array(CAPACITY);
  let pendingCount = 0;

  return {
    texture: tex,
    worldW,
    worldH,
    splat(x, y, radius, intensity) {
      if (pendingCount >= CAPACITY) return;
      pendingPos[pendingCount * 2 + 0] = x;
      pendingPos[pendingCount * 2 + 1] = y;
      pendingRad[pendingCount] = radius;
      pendingInt[pendingCount] = intensity;
      pendingCount++;
    },
    flush() {
      if (pendingCount === 0) return;

      // Save viewport so the next on-screen pass renders to the canvas, not
      // the FBO-sized region. WebGL2 returns [x, y, w, h].
      const prevVp = gl.getParameter(gl.VIEWPORT) as Int32Array;

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, texW, texH);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pendingPos.subarray(0, pendingCount * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, radBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pendingRad.subarray(0, pendingCount));
      gl.bindBuffer(gl.ARRAY_BUFFER, intBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pendingInt.subarray(0, pendingCount));

      gl.uniform2f(u.u_worldSize, worldW, worldH);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pendingCount);
      gl.disable(gl.BLEND);

      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(prevVp[0]!, prevVp[1]!, prevVp[2]!, prevVp[3]!);

      pendingCount = 0;
    },
    clear() {
      const prevVp = gl.getParameter(gl.VIEWPORT) as Int32Array;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, texW, texH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(prevVp[0]!, prevVp[1]!, prevVp[2]!, prevVp[3]!);
      pendingCount = 0;
    },
  };
}
