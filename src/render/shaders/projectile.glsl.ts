export const PROJECTILE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;        // -0.5..0.5 quad corner
layout(location = 1) in vec2 a_centerWorld;   // per-instance world center
layout(location = 2) in vec2 a_sizeOrLen;     // (length, width) | (diameter, diameter) | (w, h)
layout(location = 3) in float a_rotation;     // radians
layout(location = 4) in float a_kind;         // 0 musket, 1 ball, 2 shadow
layout(location = 5) in vec4 a_color;         // rgb + alpha

uniform mat3 u_viewProj;

out vec2 v_local;
out float v_kind;
out vec4 v_color;

void main() {
  float c = cos(a_rotation);
  float s = sin(a_rotation);
  mat2 R = mat2(c, s, -s, c);
  vec2 offset = R * (a_corner * a_sizeOrLen);
  vec2 wp = a_centerWorld + offset;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner;            // -0.5..0.5 in local quad space
  v_kind = a_kind;
  v_color = a_color;
}
`;

export const PROJECTILE_FS = `#version 300 es
precision highp float;

in vec2 v_local;
in float v_kind;
in vec4 v_color;
out vec4 outColor;

void main() {
  if (v_kind < 0.5) {
    // Musket ball: hard-edged pixel square — flat lead colour.
    outColor = vec4(v_color.rgb, 1.0);
  } else if (v_kind < 1.5) {
    // Cannonball: chunky disc with hard rim — 8 cells across diameter.
    vec2 q = (floor(v_local * 8.0) + 0.5) / 8.0;
    float d2 = dot(q, q);
    if (d2 > 0.25) discard;
    float rim = step(0.16, d2);
    outColor = vec4(v_color.rgb + rim * 0.45, 1.0);
  } else {
    // Shadow: chunky squashed ellipse, hard edge, flat alpha.
    vec2 q = (floor(v_local * 8.0) + 0.5) / 8.0;
    vec2 e = q * vec2(1.0, 1.7);
    if (dot(e, e) > 0.25) discard;
    outColor = vec4(0.0, 0.0, 0.0, 0.4);
  }
}
`;
