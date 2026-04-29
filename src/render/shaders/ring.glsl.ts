// src/render/shaders/ring.glsl.ts
export const RING_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // -0.5..0.5
layout(location = 1) in vec2 a_pos;        // per-instance world center
layout(location = 2) in float a_size;
layout(location = 3) in vec4 a_color;      // rgb + alpha (life ratio)

uniform mat3 u_viewProj;
out vec2 v_local;
out vec4 v_color;

void main() {
  vec2 wp = a_pos + a_corner * a_size;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0;        // [-1, 1] across the quad
  v_color = a_color;
}
`;

export const RING_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
out vec4 outColor;

void main() {
  float r = length(v_local);
  // Hollow annulus: bright at r ≈ 0.92, fading inward to 0.78 and outward to 1.0.
  float inner = smoothstep(0.78, 0.92, r);
  float outer = 1.0 - smoothstep(0.92, 1.0, r);
  float ring = inner * outer;
  float a = v_color.a * ring;
  if (a <= 0.0) discard;
  outColor = vec4(v_color.rgb * a, a);
}
`;
