export const RANK_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;  // -0.5..0.5 quad
layout(location = 1) in vec2 a_pos;     // quad center in world space
layout(location = 2) in float a_rank;   // 1..4 (Recruit=0 entities are not in the buffer)

uniform mat3 u_viewProj;
uniform float u_quadSize;       // world-space quad side, e.g. 0.6

out vec2 v_uv;

void main() {
  vec2 wp = a_pos + a_corner * vec2(u_quadSize, u_quadSize);
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  // Atlas is 64x16 with 4 cells of 16x16. Each cell occupies 0.25 in U.
  // a_corner is in [-0.5, 0.5]; map to [0, 1] inside the cell.
  vec2 quadUv = a_corner + 0.5;
  float cellU = (a_rank - 1.0) * 0.25;  // rank 1 -> cell 0
  v_uv = vec2(cellU + quadUv.x * 0.25, quadUv.y);
}
`;

export const RANK_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_atlas;

void main() {
  vec4 tex = texture(u_atlas, v_uv);
  if (tex.a <= 0.0) discard;
  outColor = tex;
}
`;
