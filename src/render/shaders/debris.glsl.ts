export const DEBRIS_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // unit-quad (-0.5..0.5)
layout(location = 1) in vec2 a_pos;        // per-instance world (posX, posY - z)
layout(location = 2) in vec4 a_uv;         // (u0, v0, u1, v1) atlas rect
layout(location = 3) in float a_rot;       // per-instance rotation in degrees
                                           // (rendered side snaps to 8 buckets)
layout(location = 4) in float a_team;      // 0 / 1 — selects tint palette

uniform mat3 u_viewProj;
uniform float u_pixelSize;                 // world units per chunk pixel × 8

out vec2 v_uv;
out float v_team;

void main() {
  float r = radians(a_rot);
  float c = cos(r);
  float s = sin(r);
  vec2 corner = a_corner * u_pixelSize;
  vec2 rotated = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  vec2 wp = a_pos + rotated;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  // a_corner.x = -0.5 → u0, +0.5 → u1; same for y.
  vec2 quadUv = a_corner + 0.5;
  v_uv = vec2(mix(a_uv.x, a_uv.z, quadUv.x), mix(a_uv.y, a_uv.w, quadUv.y));
  v_team = a_team;
}
`;

export const DEBRIS_FS = `#version 300 es
precision mediump float;

in vec2 v_uv;
in float v_team;

uniform sampler2D u_atlas;
uniform vec3 u_team0;     // British red
uniform vec3 u_team1;     // French blue

out vec4 outColor;

void main() {
  vec4 c = texture(u_atlas, v_uv);
  if (c.a < 0.05) discard;
  // Marker pixel = pure red (#FF0000) → substitute team primary tint.
  if (c.r > 0.95 && c.g < 0.05 && c.b < 0.05) {
    vec3 tint = mix(u_team0, u_team1, v_team);
    outColor = vec4(tint, c.a);
  } else {
    outColor = c;
  }
}
`;
