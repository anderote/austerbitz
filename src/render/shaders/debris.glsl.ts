export const DEBRIS_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // unit-quad (-0.5..0.5)
layout(location = 1) in vec2 a_pos;        // per-instance world (posX, posY - z)
layout(location = 2) in vec4 a_uv;         // (u0, v0, u1, v1) atlas rect
layout(location = 3) in float a_rot;       // per-instance rotation in degrees
                                           // (rendered side snaps to 8 buckets)
layout(location = 4) in float a_team;      // 0 / 1 — selects tint palette
layout(location = 5) in vec3 a_modulate;   // per-instance multiplicative tint (0..1)

uniform mat3 u_viewProj;
uniform float u_pixelSize;                 // world units per chunk pixel × 8

out vec2 v_uv;
out float v_team;
out vec3 v_modulate;

void main() {
  float r = radians(a_rot);
  float c = cos(r);
  float s = sin(r);
  vec2 corner = a_corner * u_pixelSize;
  vec2 rotated = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  vec2 wp = a_pos + rotated;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vec2 quadUv = a_corner + 0.5;
  v_uv = vec2(mix(a_uv.x, a_uv.z, quadUv.x), mix(a_uv.y, a_uv.w, quadUv.y));
  v_team = a_team;
  v_modulate = a_modulate;
}
`;

export const DEBRIS_FS = `#version 300 es
precision mediump float;

in vec2 v_uv;
in float v_team;
in vec3 v_modulate;

uniform sampler2D u_atlas;
uniform vec3 u_team0;     // British red
uniform vec3 u_team1;     // French blue

out vec4 outColor;

void main() {
  vec4 c = texture(u_atlas, v_uv);
  if (c.a < 0.05) discard;
  vec3 col;
  // Marker pixel = pure red (#FF0000) → substitute team primary tint. Modulate
  // bypasses the marker path so regiment colour stays pure on tinted markers.
  if (c.r > 0.95 && c.g < 0.05 && c.b < 0.05) {
    col = mix(u_team0, u_team1, v_team);
  } else {
    col = c.rgb * v_modulate;
  }
  outColor = vec4(col, c.a);
}
`;

/**
 * Kit-gib shader: samples the *combined sprite atlas* (the same one
 * sprite-pass uses for bodies / heads / weapons) so a kit gib reads exactly
 * like the unit's authored sprite. Marker substitution mirrors SPRITE_FS so
 * regiment colours still resolve correctly. Per-instance UV rect is resolved
 * on the CPU at instance-buffer-fill time, not in shader.
 */
export const KIT_GIB_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
layout(location = 2) in vec2 a_size;       // per-instance world size (matches body pxToWorld)
layout(location = 3) in vec4 a_uvRect;     // (uMin, vMin, uSize, vSize), signed for flips
layout(location = 4) in vec3 a_primary;
layout(location = 5) in vec3 a_secondary;
layout(location = 6) in vec3 a_tertiary;
layout(location = 7) in float a_rot;       // radians

uniform mat3 u_viewProj;

out vec2 v_uv;
out vec3 v_primary;
out vec3 v_secondary;
out vec3 v_tertiary;

void main() {
  float c = cos(a_rot);
  float s = sin(a_rot);
  vec2 corner = a_corner * a_size;
  vec2 rotated = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  vec2 wp = a_pos + rotated;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vec2 quadUv = a_corner + 0.5;
  v_uv = a_uvRect.xy + quadUv * a_uvRect.zw;
  v_primary = a_primary;
  v_secondary = a_secondary;
  v_tertiary = a_tertiary;
}
`;

export const KIT_GIB_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_primary;
in vec3 v_secondary;
in vec3 v_tertiary;

uniform sampler2D u_atlas;

out vec4 outColor;

void main() {
  vec4 tex = texture(u_atlas, v_uv);
  if (tex.a <= 0.0) discard;
  vec3 col = tex.rgb;
  // Marker substitution — mirrors SPRITE_FS so a kit head/weapon gib reads in
  // the same regimental palette as the body it came from.
  vec3 src = col;
  float eps = 0.01;
  bool mag = abs(src.r - src.b) < eps && src.g < src.r - eps && src.r > 0.1;
  bool cyn = abs(src.g - src.b) < eps && src.r < src.g - eps && src.g > 0.1;
  bool yel = abs(src.r - src.g) < eps && src.b < src.r - eps && src.r > 0.1;
  bool redCoat = !mag && !cyn && !yel
              && src.r > 0.4
              && (src.r - src.g) > 0.30
              && (src.r - src.b) > 0.30;
  if (mag) {
    float f = src.r;
    col = clamp(v_primary * f, 0.0, 1.0);
    col = mix(col, vec3(1.0), src.g * 0.5);
  } else if (cyn) {
    float f = src.g;
    col = clamp(v_secondary * f, 0.0, 1.0);
    col = mix(col, vec3(1.0), src.r * 0.5);
  } else if (yel) {
    float f = src.r;
    col = clamp(v_tertiary * f, 0.0, 1.0);
    col = mix(col, vec3(1.0), src.b * 0.5);
  } else if (redCoat) {
    float f = clamp(src.r / 0.706, 0.0, 1.4);
    col = clamp(v_primary * f, 0.0, 1.0);
  }
  outColor = vec4(col, tex.a);
}
`;
