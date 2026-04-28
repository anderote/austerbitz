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
uniform sampler2D u_blood;
uniform float u_tileSize;   // world units per tile
uniform vec2 u_worldSize;   // total world size in metres
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = v_worldPos / u_tileSize;
  vec3 base = texture(u_tile, uv).rgb;

  // Slow wobble (~125m), mottling (~1m), and fine grain (~25cm). The high
  // frequencies provide close-zoom detail that the texture lacks at 1.5 px/m,
  // and average out to flat at low zoom so they don't read as noise.
  float macro = vnoise(v_worldPos * 0.008);
  float meso  = vnoise(v_worldPos * 1.0);
  float fine  = vnoise(v_worldPos * 4.0);
  float bright = 0.90 + 0.14 * macro + 0.06 * (meso - 0.5) + 0.04 * (fine - 0.5);
  vec3 color = base * bright;

  vec2 bloodUv = v_worldPos / u_worldSize;
  float stain = 0.0;
  if (bloodUv.x >= 0.0 && bloodUv.x <= 1.0 && bloodUv.y >= 0.0 && bloodUv.y <= 1.0) {
    stain = texture(u_blood, bloodUv).r;
  }
  vec3 bloodCol = vec3(0.18, 0.02, 0.02);
  color = mix(color, bloodCol, clamp(stain * 0.5, 0.0, 0.5));

  outColor = vec4(color, 1.0);
}
`;
