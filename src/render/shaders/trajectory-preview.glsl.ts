export const TRAJECTORY_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec3 a_color;
uniform mat3 u_viewProj;
out vec3 v_color;
void main() {
  vec3 clip = u_viewProj * vec3(a_pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_color = a_color;
}`;

export const TRAJECTORY_FS = `#version 300 es
precision highp float;
in vec3 v_color;
out vec4 outColor;
void main() { outColor = vec4(v_color, 1.0); }`;
