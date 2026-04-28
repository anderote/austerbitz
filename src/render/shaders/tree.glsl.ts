export const TREE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // cx in [-0.5, 0.5], cy in [0, 1] (cy=1 is the foot)
layout(location = 1) in vec2 a_foot;       // per-instance: world position of trunk base
layout(location = 2) in float a_size;      // per-instance: world width
layout(location = 3) in float a_variant;   // per-instance: 0..VARIANTS-1

uniform mat3  u_viewProj;
uniform float u_aspect;                     // TREE_H / TREE_W
uniform vec2  u_worldSize;                  // for footY → depth

out vec2 v_uv;
flat out float v_variant;

void main() {
  vec2 wp = a_foot + vec2(a_corner.x * a_size, (a_corner.y - 1.0) * a_size * u_aspect);
  v_uv = vec2(a_corner.x + 0.5, a_corner.y);
  v_variant = a_variant;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  // Larger foot-Y → closer to viewer → smaller z (drawn on top under LESS).
  float depth = clamp(0.95 - 0.90 * (a_foot.y / u_worldSize.y), 0.05, 0.95);
  gl_Position = vec4(clip.xy, depth, 1.0);
}
`;

export const TREE_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
flat in float v_variant;

uniform sampler2D u_atlas;
uniform float u_atlasGrid;

out vec4 outColor;

void main() {
  float u = (v_variant + v_uv.x) / u_atlasGrid;
  vec4 c = texture(u_atlas, vec2(u, v_uv.y));
  if (c.a < 0.5) discard;
  outColor = c;
}
`;
