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
    // Musket: bright tracer fading from head (right) to tail (left)
    float t = clamp(0.5 + v_local.x, 0.0, 1.0);
    float a = pow(t, 2.0) * smoothstep(1.0, 0.0, abs(v_local.y) * 2.0);
    if (a <= 0.0) discard;
    outColor = vec4(v_color.rgb * a, a);
  } else if (v_kind < 1.5) {
    // Cannonball: crisp dark sphere with rim highlight
    float d = length(v_local);
    if (d > 0.5) discard;
    float rim = smoothstep(0.45, 0.5, d);
    outColor = vec4(v_color.rgb + rim * 0.5, 1.0);
  } else {
    // Shadow: squashed ellipse, soft falloff
    vec2 e = v_local * vec2(1.0, 1.7);
    float d = length(e);
    if (d > 0.5) discard;
    outColor = vec4(0.0, 0.0, 0.0, 0.4 * smoothstep(0.5, 0.3, d));
  }
}
`;
