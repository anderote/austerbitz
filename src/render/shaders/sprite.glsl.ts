export const SPRITE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // unit-quad (-0.5..0.5)
layout(location = 1) in vec2 a_pos;        // per-instance world pos
layout(location = 2) in vec2 a_size;       // per-instance world size
layout(location = 3) in vec4 a_color;      // per-instance tint rgba (0..1)
layout(location = 4) in vec4 a_uvRect;     // (uMin, vMin, uSize, vSize) in atlas

out vec2 v_uv;
out vec4 v_color;

uniform mat3 u_viewProj;

void main() {
  // Quad spans world size; -y in clip-space points up but our world Y grows
  // downward (top-down map), so the corner Y maps directly to atlas V.
  vec2 wp = a_pos + a_corner * a_size;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vec2 quadUv = a_corner + 0.5;            // 0..1 across quad
  v_uv = a_uvRect.xy + quadUv * a_uvRect.zw;
  v_color = a_color;
}
`;

export const SPRITE_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;
out vec4 outColor;

uniform sampler2D u_atlas;

void main() {
  vec4 tex = texture(u_atlas, v_uv);
  if (tex.a <= 0.0) discard;
  outColor = tex * v_color;
}
`;
