export const SELECTION_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
layout(location = 2) in float a_radius;
layout(location = 3) in vec3 a_color;
out vec2 v_local;
out vec3 v_color;

uniform mat3 u_viewProj;

void main() {
  vec2 wp = a_pos + a_corner * a_radius * 2.0;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0;
  v_color = a_color;
}
`;

export const SELECTION_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec3 v_color;
out vec4 outColor;

void main() {
  float d = length(v_local);
  float a = smoothstep(0.85, 0.9, d) - smoothstep(0.98, 1.0, d);
  if (a <= 0.0) discard;
  outColor = vec4(v_color, a);
}
`;

export const WAYPOINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;

uniform mat3 u_viewProj;

void main() {
  vec3 clip = u_viewProj * vec3(a_pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const WAYPOINT_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }
`;
