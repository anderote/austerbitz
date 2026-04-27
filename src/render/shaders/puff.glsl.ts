export const PUFF_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;       // -0.5..0.5
layout(location = 1) in vec2 a_pos;          // world center
layout(location = 2) in vec2 a_sizeXY;       // half-extents (m): width, height
layout(location = 3) in vec4 a_color;        // rgb + life ratio
layout(location = 4) in vec2 a_alphaSoft;    // peakAlpha (.x), softness (.y, unused)

uniform mat3 u_viewProj;
out vec2 v_local;
out vec4 v_color;
out float v_peakAlpha;

void main() {
  vec2 wp = a_pos + a_corner * (a_sizeXY * 2.0);
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0;            // -1..1 across the quad
  v_color = a_color;
  v_peakAlpha = a_alphaSoft.x;
}
`;

export const PUFF_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
in float v_peakAlpha;
out vec4 outColor;

void main() {
  float a = v_color.a * v_peakAlpha;
  if (a <= 0.0) discard;
  outColor = vec4(v_color.rgb * a, a);
}
`;
