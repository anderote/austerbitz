export const SHADOW_PROJECTION_VS = `#version 300 es
precision highp float;

// Attribute layout MUST match sprite-pass VAO bindings exactly. Locations 3,
// 5, 6, 7, 8 are intentionally skipped (the sprite pass uses them for color /
// palettes / pattern) — the shadow program just leaves those slots unread.
layout(location = 0) in vec2 a_corner;          // unit-quad (-0.5..0.5)
layout(location = 1) in vec2 a_pos;             // per-instance world center
layout(location = 2) in vec2 a_size;            // per-instance world size
layout(location = 4) in vec4 a_uvRect;          // (uMin, vMin, uSize, vSize)
layout(location = 9) in float a_rot;            // per-instance rotation (radians)
layout(location = 10) in float a_footYWorld;    // absolute world Y of the carrier body's foot line
layout(location = 11) in float a_shadowAlpha;   // 1.0 alive, 0.0 dead/dying

out vec2 v_uv;
out float v_shadowAlpha;

uniform mat3 u_viewProj;

void main() {
  // Apply the same body rotation the sprite pass uses so the shadow shape
  // tracks recoil/falling-over orientation, then project onto the ground via
  // foot-anchored shear+squash. Foot pixels stay put, head pixels swing out.
  float c = cos(a_rot);
  float s = sin(a_rot);
  vec2 corner = a_corner * a_size;
  vec2 rotated = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  vec2 wp = a_pos + rotated;
  // a_footYWorld is the carrier body's foot Y in world coords. For body
  // instances this equals (a_pos.y + body's footYFromCenter); for weapon
  // instances a_pos is at the held-weapon position (chest height) so we
  // cannot reconstruct the soldier's foot line from a_pos alone — sprite-pass
  // pre-resolves it once per soldier and shares the value with attached
  // weapons.
  float footY = a_footYWorld;
  float aboveFoot = footY - wp.y;
  vec2 shadowWp = vec2(
    wp.x + aboveFoot * 0.15,
    footY + aboveFoot * 0.30
  );
  vec3 clip = u_viewProj * vec3(shadowWp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vec2 quadUv = a_corner + 0.5;
  v_uv = a_uvRect.xy + quadUv * a_uvRect.zw;
  v_shadowAlpha = a_shadowAlpha;
}
`;

export const SHADOW_PROJECTION_FS = `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_shadowAlpha;
out vec4 outColor;

uniform sampler2D u_atlas;

void main() {
  if (v_shadowAlpha < 0.5) discard;
  vec4 tex = texture(u_atlas, v_uv);
  if (tex.a <= 0.0) discard;
  outColor = vec4(0.0, 0.0, 0.0, 0.4);
}
`;
