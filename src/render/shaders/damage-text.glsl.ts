export const DAMAGE_TEXT_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;  // -0.5..0.5 quad
layout(location = 1) in vec2 a_pos;     // digit center in world space
layout(location = 2) in float a_digit;  // 0..9
layout(location = 3) in float a_alpha;  // 0..1 fade
layout(location = 4) in float a_crit;   // 0 or 1

uniform mat3 u_viewProj;
uniform vec2 u_glyphSize;               // world-space (w, h) of one glyph
uniform float u_glyphCount;             // = GLYPH_COUNT (10)

out vec2 v_uv;
out float v_alpha;
out float v_crit;

void main() {
  // Crits render 1.4x larger. Per-digit X spacing is also pre-scaled on
  // the CPU side to keep the number tight at the new size.
  float scale = a_crit > 0.5 ? 1.4 : 1.0;
  vec2 wp = a_pos + a_corner * u_glyphSize * scale;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  // Convert corner [-0.5..0.5] to [0..1] for UV mapping.
  // World Y is screen-down (viewProj flips Y), so a_corner.y = -0.5 is the
  // top edge on screen. The bitmap is uploaded row-major top-to-bottom into
  // the texture (default unpack: row 0 → V=0), so the top edge of the quad
  // (local.y = 0) maps directly to V=0 — no flip needed.
  vec2 local = a_corner + 0.5;
  float u = (a_digit + local.x) / u_glyphCount;
  float v = local.y;
  v_uv = vec2(u, v);
  v_alpha = a_alpha;
  v_crit = a_crit;
}
`;

export const DAMAGE_TEXT_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_alpha;
in float v_crit;

uniform sampler2D u_atlas;

out vec4 outColor;

void main() {
  // Hard-cutoff alpha — pixel-art constraint, no smoothing.
  float s = texture(u_atlas, v_uv).r;
  if (s < 0.5) discard;
  // Crits render in saturated yellow; normals in warm white.
  vec3 normalCol = vec3(1.0, 0.95, 0.85);
  vec3 critCol   = vec3(1.0, 0.85, 0.15);
  vec3 col = v_crit > 0.5 ? critCol : normalCol;
  outColor = vec4(col, v_alpha);
}
`;
