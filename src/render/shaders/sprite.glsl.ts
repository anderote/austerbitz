export const SPRITE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // unit-quad (-0.5..0.5)
layout(location = 1) in vec2 a_pos;        // per-instance world pos
layout(location = 2) in vec2 a_size;       // per-instance world size
layout(location = 3) in vec4 a_color;      // per-instance tint rgba (0..1)
layout(location = 4) in vec4 a_uvRect;     // (uMin, vMin, uSize, vSize) in atlas
layout(location = 5) in vec3 a_primary;    // per-instance primary uniform color
layout(location = 6) in vec3 a_secondary;  // per-instance secondary uniform color
layout(location = 7) in float a_pattern;   // 0 = none, 1 = check, 2 = h-stripes

out vec2 v_uv;
out vec2 v_world;
out vec4 v_color;
out vec3 v_primary;
out vec3 v_secondary;
out float v_pattern;

uniform mat3 u_viewProj;

void main() {
  // Quad spans world size; -y in clip-space points up but our world Y grows
  // downward (top-down map), so the corner Y maps directly to atlas V.
  vec2 wp = a_pos + a_corner * a_size;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vec2 quadUv = a_corner + 0.5;            // 0..1 across quad
  v_uv = a_uvRect.xy + quadUv * a_uvRect.zw;
  v_world = wp;
  v_color = a_color;
  v_primary = a_primary;
  v_secondary = a_secondary;
  v_pattern = a_pattern;
}
`;

export const SPRITE_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec2 v_world;
in vec4 v_color;
in vec3 v_primary;
in vec3 v_secondary;
in float v_pattern;
out vec4 outColor;

uniform sampler2D u_atlas;
uniform float u_patternFeatureWorld; // size in world units of one check cell / one stripe band

void main() {
  vec4 tex = texture(u_atlas, v_uv);
  if (tex.a <= 0.0) discard;
  vec3 col = tex.rgb;
  // Marker substitution. Atlas uses NEAREST sampling so the markers come
  // through as pure (1,0,1) and (0,1,1) — no interpolation, exact match.
  if (col.r > 0.95 && col.g < 0.05 && col.b > 0.95) col = v_primary;
  else if (col.r < 0.05 && col.g > 0.95 && col.b > 0.95) col = v_secondary;
  // Dot patterns. Sampled atlas cell is solid white, so col=(1,1,1) here —
  // we override based on the fragment's WORLD position so adjacent overlapping
  // dots tile a single coherent pattern across the merged formation blob,
  // rather than each dot stamping its own pattern in isolation.
  if (v_pattern > 0.5 && v_pattern < 1.5) {
    // Cavalry: checker, white + team primary.
    vec2 cell = floor(v_world / u_patternFeatureWorld);
    bool teamCell = mod(cell.x + cell.y, 2.0) >= 0.5;
    col = teamCell ? v_primary : vec3(1.0);
  } else if (v_pattern > 1.5) {
    // Artillery: 3-band horizontal cycle — white | team primary | gray.
    float band = mod(floor(v_world.y / u_patternFeatureWorld), 3.0);
    if (band < 0.5) col = vec3(1.0);
    else if (band < 1.5) col = v_primary;
    else col = vec3(0.55);
  }
  outColor = vec4(col, tex.a) * v_color;
}
`;
