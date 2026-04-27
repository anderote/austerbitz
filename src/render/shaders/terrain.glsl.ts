export const TERRAIN_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_pos;     // unit-quad corner (0..1)
uniform vec2 u_worldMin;                 // world-space min visible
uniform vec2 u_worldMax;                 // world-space max visible
uniform mat3 u_viewProj;
out vec2 v_worldPos;

void main() {
  vec2 wp = mix(u_worldMin, u_worldMax, a_pos);
  v_worldPos = wp;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

export const TERRAIN_FS = `#version 300 es
precision highp float;
in vec2 v_worldPos;
uniform sampler2D u_tile;
uniform float u_tileSize;   // world units per tile
out vec4 outColor;

void main() {
  vec2 uv = v_worldPos / u_tileSize;
  outColor = texture(u_tile, uv);
}
`;
