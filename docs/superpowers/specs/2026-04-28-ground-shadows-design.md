# Ground Shadows — Design

**Date:** 2026-04-28
**Status:** Approved (inline review). v2 supersedes v1: ellipse-shadow approach replaced with per-sprite shape projection; dead soldiers no longer cast shadows.

## Goal

Each soldier and cannon casts a shadow on the ground that is **the unit's own shape** projected as if a low sun cast it — sheared horizontally and squashed vertically, anchored at the foot. Shadows disappear for dying / dead soldiers (ragdolled bodies have no standing shadow).

## Approach

Reuse the sprite pass's per-frame instance buffers (already resolved with poses, weapons, heads, recoil, facings, y-sort) and issue an extra draw call before the body draw. The extra draw uses the same atlas + instance buffers but a different shader that:

1. Transforms each vertex onto the ground via shear + squash anchored at the foot line.
2. Samples the atlas alpha and outputs flat black at fixed alpha — no color processing, no marker substitution, no patterns.
3. Discards fragments for dead/dying entities via a per-instance `a_shadowAlpha` flag.

## Render order inside `sprite-pass.draw`

```
populate scratch (body + weaponFront + weaponBehind + head)  [unchanged]
upload all instance buffers                                  [unchanged]

DRAW SHADOW: body                                            [new]
DRAW SHADOW: weapon-behind                                   [new]
DRAW SHADOW: weapon-front                                    [new]
DRAW SHADOW: head                                            [new]

draw weapon-behind                                           [unchanged]
draw body                                                    [unchanged]
draw weapon-front                                            [unchanged]
draw head                                                    [unchanged]
```

All shadow draws happen before any sprite draws, so a sprite in front correctly occludes shadows behind it (y-sort already provides correct ordering between adjacent units' shadows since both use the same sorted instance buffer).

## Projection math (per vertex, in shader)

```glsl
uniform float u_shearX;     // 0.35
uniform float u_stretchY;   // 0.35

float footY = a_pos.y + a_footYFromCenter;
vec2 corner = a_corner * a_size;
vec2 wp = a_pos + corner;
float aboveFoot = footY - wp.y;       // signed: positive when above foot
vec2 shadowWp = vec2(
  wp.x + aboveFoot * u_shearX,
  footY + aboveFoot * u_stretchY
);
gl_Position = vec4((u_viewProj * vec3(shadowWp, 1.0)).xy, 0.0, 1.0);
```

Foot pixels (wp.y = footY) stay put, head pixels swing out by `headHeight * 0.35` toward the lower-right. A 1.75m-tall infantryman casts ~0.6m of diagonal shadow.

`SHEAR_X = 0.35`, `STRETCH_Y = 0.35` baked as constants in the shader source (uniform-free for simplicity; one number to retune in one place if needed).

## Dead-body handling

Per-instance flag `a_shadowAlpha` (1 float). Set during scratch population:

- `1.0` for living entities (`!isDead(e, id)`)
- `0.0` for dying / dead entities (`isDead(e, id)`)

Shadow fragment shader:

```glsl
if (v_shadowAlpha < 0.5) discard;
vec4 tex = texture(u_atlas, v_uv);
if (tex.a <= 0.0) discard;
outColor = vec4(0.0, 0.0, 0.0, 0.4);
```

This costs us rasterizing transparent quads for dead entities. Acceptable — dead entities are a small fraction of the field at any given moment, and we avoid more invasive buffer-reordering. Optimization (skipping dead slots entirely) can come later if profiling shows it.

## Per-instance attribute additions to sprite-pass

Two new `Float32Array` scratch arrays per existing instance group (body, weapon-front, weapon-behind, head):

| Attribute              | Per-instance type | Notes                                      |
|------------------------|-------------------|--------------------------------------------|
| `a_footYFromCenter`    | float             | World-units offset from sprite center to foot. For body, `kind.footYFromCenter ?? kind.placeholderSize.h * 0.5`. For weapons/heads, the same value as the parent body (weapon/head shadows project relative to the same foot as their carrier). |
| `a_shadowAlpha`        | float             | 1.0 alive, 0.0 dead.                       |

New GPU buffers + attribute pointers at locations 10 and 11 on each VAO. Body sprite shader doesn't reference them (no impact). Shadow shader reads both.

## Shader: `src/render/shaders/shadow-projection.glsl.ts`

VS: per the projection math above; pipes `v_uv`, `v_shadowAlpha`.
FS: discard if `v_shadowAlpha < 0.5`; sample alpha; discard if 0; output `(0,0,0,0.4)`.

## Files

| File                                            | Change         |
|-------------------------------------------------|----------------|
| `src/render/shaders/shadow-projection.glsl.ts`  | new            |
| `src/render/passes/sprite-pass.ts`              | add scratch arrays, GPU buffers, shadow program, 4 shadow draws |
| `src/render/shaders/shadow.glsl.ts`             | DELETE         |
| `src/render/passes/shadow-pass.ts`              | DELETE         |
| `src/render/passes/shadow-pass.test.ts`         | DELETE         |
| `src/render/renderer.ts`                        | remove `createShadowPass` import + call |

## Out of scope

- Per-team or per-time-of-day sun direction.
- Fading shadow during the dying animation (just snaps off).
- Debris / dropped-item shadows.
- Cannonball flight shadow refactor (already correct in `projectile-pass`).
- Soft edges, blur, ambient occlusion.

## Testing

Sprite-pass already lacks unit-test coverage of its draw path (mostly visual). The new code follows the same pattern. We rely on:

- All existing tests pass (`bun test`).
- Typecheck clean.
- Visual verification in the dev server: shadows project under units, deform with poses, swing with the unit's facing/recoil, disappear instantly when a soldier is killed.
