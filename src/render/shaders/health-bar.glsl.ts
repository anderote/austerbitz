export const HEALTH_BAR_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;  // -0.5..0.5 quad
layout(location = 1) in vec2 a_pos;     // bar center in world space
layout(location = 2) in vec2 a_size;    // bar width, height

uniform mat3 u_viewProj;

void main() {
  vec2 wp = a_pos + a_corner * a_size;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const HEALTH_BAR_FS = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(0.2, 0.95, 0.25, 1.0); }
`;
