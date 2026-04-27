export const SELECTION_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // unit-quad (-0.5..0.5)
layout(location = 1) in vec2 a_pos;        // per-instance world center
layout(location = 2) in float a_radius;    // per-instance radius (world units)
out vec2 v_local;

uniform mat3 u_viewProj;

void main() {
  vec2 wp = a_pos + a_corner * a_radius * 2.0;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0; // -1..1 across quad
}
`;

export const SELECTION_FS = `#version 300 es
precision highp float;
in vec2 v_local;
out vec4 outColor;

void main() {
  float d = length(v_local);
  // Ring: visible only where 0.85 <= d <= 1.0
  float a = smoothstep(0.85, 0.9, d) - smoothstep(0.98, 1.0, d);
  if (a <= 0.0) discard;
  outColor = vec4(0.4, 1.0, 0.4, a);
}
`;
