export const PUFF_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;       // -0.5..0.5
layout(location = 1) in vec2 a_pos;          // world center
layout(location = 2) in float a_size;        // radius (m)
layout(location = 3) in vec4 a_color;        // rgb + life ratio
layout(location = 4) in vec2 a_alphaSoft;    // peakAlpha, softness

uniform mat3 u_viewProj;
out vec2 v_local;
out vec4 v_color;
out float v_peakAlpha;
out float v_softness;

void main() {
  vec2 wp = a_pos + a_corner * (a_size * 2.0);
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0;            // -1..1 across the quad
  v_color = a_color;
  v_peakAlpha = a_alphaSoft.x;
  v_softness = a_alphaSoft.y;
}
`;

export const PUFF_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
in float v_peakAlpha;
in float v_softness;
out vec4 outColor;

void main() {
  float r = length(v_local);
  if (r > 1.0) discard;
  float feather = max(1e-3, v_softness);
  float a = 1.0 - smoothstep(1.0 - feather, 1.0, r);
  a *= v_color.a;        // life ratio
  a *= v_peakAlpha;
  if (a <= 0.0) discard;
  outColor = vec4(v_color.rgb * a, a);
}
`;
