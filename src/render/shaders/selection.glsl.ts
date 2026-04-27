export const SELECTION_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;   // disc center in world space
layout(location = 2) in vec2 a_size;  // disc width, height (ellipse)
layout(location = 3) in vec3 a_color;
out vec2 v_local;
out vec3 v_color;

uniform mat3 u_viewProj;

void main() {
  vec2 wp = a_pos + a_corner * a_size;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0; // -1..1 across quad
  v_color = a_color;
}
`;

// Pixelated tin-soldier base: quantize the local quad coords into a chunky
// grid, then test the unit circle. Outer cell ring is a darker rim painted
// edge; interior is the team color, semi-transparent.
export const SELECTION_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec3 v_color;
out vec4 outColor;

void main() {
  const float N = 6.0; // 12 chunky pixels across the disc
  vec2 q = (floor(v_local * N) + 0.5) / N;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  float rim = step(0.55, d2);
  vec3 light = v_color * 1.05;
  vec3 dark = v_color * 0.65;
  vec3 col = mix(light, dark, rim);
  float alpha = mix(0.22, 0.55, rim);
  outColor = vec4(col, alpha);
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

export const DRAG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
uniform mat3 u_viewProj;
void main() {
  vec3 clip = u_viewProj * vec3(a_pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

// Marching-ants: alternating on/off pixels along a screen-space diagonal axis,
// animated by u_time so the dashes appear to crawl around the rectangle.
export const DRAG_FS = `#version 300 es
precision highp float;
uniform float u_time;
uniform vec3 u_color;
out vec4 outColor;
void main() {
  float p = gl_FragCoord.x + gl_FragCoord.y;
  float phase = mod(p - u_time * 24.0, 8.0);
  if (phase >= 4.0) discard;
  outColor = vec4(u_color, 1.0);
}
`;

// Per-slot formation pip — small hollow square, instanced.
// a_corner is a quad corner in [-0.5, 0.5]; a_pos is the slot center in world space.
// u_size is the world-space half-extent.
export const PIP_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
out vec2 v_local;
uniform mat3 u_viewProj;
uniform float u_size;
void main() {
  vec2 wp = a_pos + a_corner * u_size;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0;
}
`;

// Hollow square outline using fwidth for screen-stable 1px edges across zoom.
export const PIP_FS = `#version 300 es
precision highp float;
in vec2 v_local;
out vec4 outColor;
uniform vec3 u_color;
void main() {
  vec2 d = abs(v_local);
  float edge = max(d.x, d.y);
  float w = fwidth(edge);
  float a = smoothstep(1.0 - w * 1.5, 1.0 - w * 0.5, edge) - smoothstep(1.0 - w * 0.5, 1.0 + w * 0.5, edge);
  if (a <= 0.0) discard;
  outColor = vec4(u_color, a);
}
`;

export const RANGE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
uniform mat3 u_viewProj;
void main() {
  vec3 clip = u_viewProj * vec3(a_pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const RANGE_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform vec2 u_pattern;
out vec4 outColor;
void main() {
  outColor = u_color;
}
`;
