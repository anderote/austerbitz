# Ground Shadows v2 — Implementation Plan

Spec: `docs/superpowers/specs/2026-04-28-ground-shadows-design.md`

This **replaces** the v1 ellipse implementation with sprite-shape projection and adds a dead-body skip.

## Reference files

- `src/render/passes/sprite-pass.ts` — host of the new shadow draws; ~800 lines.
- `src/render/shaders/sprite.glsl.ts` — model for the new shadow shader's vertex side.
- `src/sim/entities.ts` — `isDead(e, id)` returns true for `Dying` and `Dead` (line 257-259).
- `src/data/units/index.ts` & `src/data/types.ts` — `kind.footYFromCenter`, `kind.placeholderSize.h`.

## Task 1 — Delete v1 ellipse approach

Delete files:
- `src/render/shaders/shadow.glsl.ts`
- `src/render/passes/shadow-pass.ts`
- `src/render/passes/shadow-pass.test.ts`

Edit `src/render/renderer.ts`:
- Remove `import { createShadowPass } ...`
- Remove `const shadows = createShadowPass(gl, capacity);` line.
- Remove the `shadows.draw(world, cam);` call (sits between `terrain.draw(cam)` and the selection-range draw).

## Task 2 — Shadow shader

Create `src/render/shaders/shadow-projection.glsl.ts` exporting `SHADOW_PROJECTION_VS` and `SHADOW_PROJECTION_FS`.

**VS attribute layout (must match sprite-pass attribute locations — see Task 3):**

```
location 0: a_corner          vec2     (-0.5..0.5 unit quad)
location 1: a_pos             vec2     world center
location 2: a_size            vec2     world size
location 4: a_uvRect          vec4     atlas UV rect (uMin, vMin, uSize, vSize)
location 9: a_rot             float    rotation around center (radians)
location 10: a_footYFromCenter float
location 11: a_shadowAlpha    float
```

VS body:

```glsl
float c = cos(a_rot);
float s = sin(a_rot);
vec2 corner = a_corner * a_size;
vec2 rotated = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
vec2 wp = a_pos + rotated;
float footY = a_pos.y + a_footYFromCenter;
float aboveFoot = footY - wp.y;
vec2 shadowWp = vec2(
  wp.x + aboveFoot * 0.35,
  footY + aboveFoot * 0.35
);
gl_Position = vec4((u_viewProj * vec3(shadowWp, 1.0)).xy, 0.0, 1.0);
vec2 quadUv = a_corner + 0.5;
v_uv = a_uvRect.xy + quadUv * a_uvRect.zw;
v_shadowAlpha = a_shadowAlpha;
```

Note: shear is applied to the **rotated** world position (consistent with how recoil rotation is applied in sprite-pass — shadow follows the body's rotation).

`uniform mat3 u_viewProj;` and `uniform sampler2D u_atlas;` are required.

FS body:

```glsl
if (v_shadowAlpha < 0.5) discard;
vec4 tex = texture(u_atlas, v_uv);
if (tex.a <= 0.0) discard;
outColor = vec4(0.0, 0.0, 0.0, 0.4);
```

## Task 3 — sprite-pass plumbing

Edit `src/render/passes/sprite-pass.ts`. The pass currently has 3 parallel instance-data sets (body, weapon-front, weapon-behind, plus heads piggybacking on weapon buffers — verify by reading the file). For each instance group, do the following:

1. **Add scratch arrays:**
   ```ts
   const scratchFootY = new Float32Array(capacity);
   const scratchShadowAlpha = new Float32Array(capacity);
   // ...and parallel scratchWeaponFootY, scratchWeaponShadowAlpha,
   //                scratchWeaponBehindFootY, scratchWeaponBehindShadowAlpha,
   //                scratchHead*** as appropriate.
   ```

2. **Create new GPU buffers** at attribute locations 10 (footY) and 11 (shadowAlpha) on each existing VAO. Mirror the existing single-float-per-instance buffer pattern (cf. `patternBuf` at location 7, lines 190-194). Each is 1 float per instance, divisor 1.

3. **Populate per-frame** alongside the existing scratch writes. Per-body, after computing the kind's `footYFromCenter` (resolve via `getUnitKindByIndex(e.kindId[id]).footYFromCenter ?? kind.placeholderSize.h * 0.5`):
   ```ts
   scratchFootY[k] = kindFootY;
   scratchShadowAlpha[k] = isDead(e, id) ? 0.0 : 1.0;
   ```
   For weapon-front, weapon-behind, head: copy the same `kindFootY` (so weapon shadow uses the same foot as the body) and same `shadowAlpha`. Hint: these are populated in the same per-id loop as the body, so reuse the variables.

   Pre-resolve a `Float32Array(unitKinds.length)` of `footYFromCenter` per kind index at pass-creation time, like the v1 shadow-pass did, so the inner loop is index-only:
   ```ts
   const kindFootY = new Float32Array(unitKinds.length);
   for (let i = 0; i < unitKinds.length; i++) {
     const k = getUnitKindByIndex(i);
     kindFootY[i] = k.footYFromCenter ?? k.placeholderSize.h * 0.5;
   }
   ```

4. **Upload** the new buffers in the existing upload sequence (`bufferSubData` calls before `drawArraysInstanced`).

## Task 4 — Shadow program + draw calls

In `createSpritePass`:

1. Compile the shadow program once: `const shadowProg = linkProgram(gl, SHADOW_PROJECTION_VS, SHADOW_PROJECTION_FS);` and pull `u_viewProj` + `u_atlas` uniforms.

2. In the `draw()` function, **after** all scratch is populated and **after** all instance buffers are uploaded, but **before** the existing weapon-behind draw:

   ```ts
   gl.useProgram(shadowProg);
   gl.uniformMatrix3fv(shadowU.u_viewProj, false, viewProjection(cam));
   gl.activeTexture(gl.TEXTURE0);
   gl.bindTexture(gl.TEXTURE_2D, atlas);
   gl.uniform1i(shadowU.u_atlas, 0);
   gl.enable(gl.BLEND);
   gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

   // Body shadows
   gl.bindVertexArray(bodyVao);
   gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);

   // Weapon-behind shadows
   if (wbn > 0) {
     gl.bindVertexArray(weaponBehindVao);
     gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, wbn);
   }

   // Weapon-front shadows
   if (wn > 0) {
     gl.bindVertexArray(weaponFrontVao);
     gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, wn);
   }

   // Head shadows (use whichever VAO heads live on)
   if (hn > 0) {
     gl.bindVertexArray(headVao);
     gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, hn);
   }

   gl.disable(gl.BLEND);
   ```

   Variable names (`bodyVao`, `n`, `wbn`, `wn`, `hn`, etc.) are placeholders — read sprite-pass.ts and substitute the actual names. The point is: same VAO bound, different program, same instance count.

## Task 5 — Verification

- `bun test` — full suite green (the pre-existing `src/lab/wind.test.ts` failure is a known dirty-tree leftover from before this work; ignore).
- `npm run typecheck` — clean.
- Do **not** run dev server; the user will visually verify.

Report:
- Files created / modified / deleted with line counts.
- Test counts: pass / fail (excluding the known pre-existing wind.test.ts failure).
- Any deviations from the plan + reasoning.
- Do **not** commit.

## Out of scope (do not do these)

- Heads/weapons casting shadows at different foot lines than their carrier body (use the same).
- Per-instance shear/stretch tuning (constants in the shader).
- Fading shadow during the dying animation (snap-off).
- Optimization to skip dead instances entirely (we just discard in FS — fine for now).
- Debris / dropped-items shadows.
