# Line Infantry — Plunging Ramrod Reload Animation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small steel-colored ramrod that plunges in and out of the line-infantry musket barrel during the Reloading state, providing a clear visual cue that a unit is reloading.

**Architecture:** Reuse the existing `make-ready` body pose unchanged. Procedurally generate a 1×5 px steel ramrod cell appended to the bottom of the combined atlas. Add a third per-frame instance group in `sprite-pass` (parallel to the existing weapon-front and weapon-behind groups) that emits one ramrod instance per `EntityState.Reloading` line-infantry entity, anchored per-facing and Y-shifted by an eased sinusoidal plunge curve driven by `1 - reloadT/reloadInitialT`.

**Tech Stack:** TypeScript, Vitest, WebGL2.

**Spec:** [`docs/superpowers/specs/2026-04-29-line-infantry-ramrod-reload-design.md`](../specs/2026-04-29-line-infantry-ramrod-reload-design.md)

---

## File Structure

| File | Role |
|------|------|
| `src/render/ramrod-sprite.ts` | NEW — procedural 1×5 steel ramrod sheet generator + region constants |
| `src/render/ramrod-sprite.test.ts` | NEW — unit test for the procedural sheet |
| `src/render/sprite-atlas.ts` | Modify — append ramrod sheet at bottom of combined atlas; export `RAMROD_REGION` meta |
| `src/render/reload-ramrod.ts` | NEW — pure plunge-curve function + per-facing anchor table (kept separate from sprite-pass for testability) |
| `src/render/reload-ramrod.test.ts` | NEW — unit test for the plunge curve |
| `src/render/passes/sprite-pass.ts` | Modify — add ramrod scratch buffers + emission loop + draw call |

No sim-layer changes (`reloadT`, `reloadInitialT`, `EntityState.Reloading` already exist).

---

## Conventions

- **Test runner:** Vitest. `npx vitest run path/to/file.test.ts` for a single file.
- **No commits.** The human controls commit boundaries — skip every `git commit` step.
- **No worktrees, no stash, no destructive git.** Work in-place.
- **Pixel-art aesthetic:** all motion snaps to integer source pixels via `Math.round`.
- **Procedural authoring:** match `british-soldier-sprite.ts` style — a palette object + grid blits, no PNGs.

---

## Task 1: Procedural ramrod sprite + atlas integration

**Files:**
- Create: `src/render/ramrod-sprite.ts`
- Create: `src/render/ramrod-sprite.test.ts`
- Modify: `src/render/sprite-atlas.ts`

### Steps

- [ ] **Step 1: Write the failing tests**

Create `src/render/ramrod-sprite.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  RAMROD_SHEET_W,
  RAMROD_SHEET_H,
  RAMROD_STEEL,
  generateRamrodSheet,
} from './ramrod-sprite';

describe('ramrod sprite', () => {
  it('has 1x5 dimensions', () => {
    expect(RAMROD_SHEET_W).toBe(1);
    expect(RAMROD_SHEET_H).toBe(5);
  });

  it('generates an opaque steel column', () => {
    const buf = generateRamrodSheet();
    expect(buf.length).toBe(RAMROD_SHEET_W * RAMROD_SHEET_H * 4);
    for (let i = 0; i < RAMROD_SHEET_H; i++) {
      const o = i * 4;
      expect(buf[o + 0]).toBe(RAMROD_STEEL[0]);
      expect(buf[o + 1]).toBe(RAMROD_STEEL[1]);
      expect(buf[o + 2]).toBe(RAMROD_STEEL[2]);
      expect(buf[o + 3]).toBe(255);
    }
  });
});
```

- [ ] **Step 2: Run test, verify failure**

`npx vitest run src/render/ramrod-sprite.test.ts` — should fail with module-not-found.

- [ ] **Step 3: Implement `ramrod-sprite.ts`**

```ts
// 1×5 px steel column packed into the combined atlas. Sampled by the sprite
// pass during the Reloading state to draw a plunging ramrod over the soldier.
// Color matches `'g'` in british-soldier-sprite.ts so the ramrod reads as the
// same steel as the bayonet/barrel.
export const RAMROD_SHEET_W = 1;
export const RAMROD_SHEET_H = 5;
export const RAMROD_STEEL: readonly [number, number, number] = [180, 188, 200];

export function generateRamrodSheet(): Uint8Array {
  const buf = new Uint8Array(RAMROD_SHEET_W * RAMROD_SHEET_H * 4);
  for (let y = 0; y < RAMROD_SHEET_H; y++) {
    const o = y * 4;
    buf[o + 0] = RAMROD_STEEL[0];
    buf[o + 1] = RAMROD_STEEL[1];
    buf[o + 2] = RAMROD_STEEL[2];
    buf[o + 3] = 255;
  }
  return buf;
}
```

- [ ] **Step 4: Verify ramrod-sprite tests pass**

`npx vitest run src/render/ramrod-sprite.test.ts`.

- [ ] **Step 5: Wire ramrod into combined atlas**

Edit `src/render/sprite-atlas.ts`:

1. Add import:
   ```ts
   import {
     RAMROD_SHEET_W,
     RAMROD_SHEET_H,
     generateRamrodSheet,
   } from './ramrod-sprite';
   ```

2. Update `COMBINED_SHEET_W` to include the ramrod (negligible — width 1 fits anywhere; keep `Math.max` formula but include `RAMROD_SHEET_W` for consistency):
   ```ts
   export const COMBINED_SHEET_W = Math.max(
     SOLDIER_SHEET_W,
     CUIRASSIER_SHEET_W,
     CANNON_SHEET_W,
     RAMROD_SHEET_W,
   );
   ```

3. Update `COMBINED_SHEET_H` to add the ramrod height:
   ```ts
   export const COMBINED_SHEET_H =
     SOLDIER_SHEET_H + CUIRASSIER_SHEET_H + CANNON_SHEET_H + RAMROD_SHEET_H;
   ```

4. Add a `RAMROD_Y` constant after `CANNON_Y`:
   ```ts
   const RAMROD_Y = SOLDIER_SHEET_H + CUIRASSIER_SHEET_H + CANNON_SHEET_H;
   ```

5. Add an exported `RAMROD_REGION` constant (not part of `KIND_ATLAS` — the ramrod isn't a unit kind):
   ```ts
   /** Pixel rect of the ramrod column in the combined atlas. */
   export const RAMROD_REGION = {
     x: 0,
     y: RAMROD_Y,
     w: RAMROD_SHEET_W,
     h: RAMROD_SHEET_H,
   } as const;
   ```

6. Add the ramrod blit inside `generateCombinedAtlas`:
   ```ts
   const ramrod = generateRamrodSheet();
   blitRegion(buf, COMBINED_SHEET_W, 0, RAMROD_Y, ramrod, RAMROD_SHEET_W, RAMROD_SHEET_H);
   ```

- [ ] **Step 6: Run all atlas tests**

`npx vitest run src/render/sprite-atlas.test.ts src/render/ramrod-sprite.test.ts` — both pass.

- [ ] **Step 7: Verify TypeScript compiles**

`npx tsc --noEmit`. Fix any errors.

---

## Task 2: Plunge-curve module

**Files:**
- Create: `src/render/reload-ramrod.ts`
- Create: `src/render/reload-ramrod.test.ts`

### Steps

- [ ] **Step 1: Write the failing tests**

Create `src/render/reload-ramrod.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  RAMROD_PLUNGE_CYCLES,
  RAMROD_PLUNGE_DEPTH_PX,
  ramrodPlungePx,
  RAMROD_ANCHOR_PX_BY_FACING,
} from './reload-ramrod';

describe('ramrod plunge curve', () => {
  it('returns 0 at progress=0', () => {
    expect(ramrodPlungePx(0)).toBe(0);
  });

  it('returns 0 at progress=1 (cycle endpoint)', () => {
    expect(ramrodPlungePx(1)).toBe(0);
  });

  it('returns max depth at the first plunge bottom', () => {
    // First cycle bottom is at progress = 1 / (2 * CYCLES)
    const p = 1 / (2 * RAMROD_PLUNGE_CYCLES);
    expect(ramrodPlungePx(p)).toBe(RAMROD_PLUNGE_DEPTH_PX);
  });

  it('returns integer values for arbitrary progress', () => {
    for (let i = 0; i <= 100; i++) {
      const v = ramrodPlungePx(i / 100);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(RAMROD_PLUNGE_DEPTH_PX);
    }
  });

  it('exposes 8 facings of anchor offsets', () => {
    expect(RAMROD_ANCHOR_PX_BY_FACING.length).toBe(8);
    for (const a of RAMROD_ANCHOR_PX_BY_FACING) {
      expect(a.length).toBe(2);
      expect(Number.isFinite(a[0])).toBe(true);
      expect(Number.isFinite(a[1])).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test, verify failure**

`npx vitest run src/render/reload-ramrod.test.ts`.

- [ ] **Step 3: Implement `reload-ramrod.ts`**

```ts
// Plunge curve and per-facing anchor table for the line-infantry reload ramrod.
// Kept separate from sprite-pass so the math is unit-testable.

export const RAMROD_PLUNGE_CYCLES = 4;
export const RAMROD_PLUNGE_DEPTH_PX = 5;

/**
 * Per-facing resting anchor of the ramrod relative to the soldier's body
 * sprite center, in source-cell pixels (32-px component cell). Indexed by
 * runtime facing 0..7 in the order [E, SE, S, SW, W, NW, N, NE]. Positive Y
 * is downward; positive X is right.
 *
 * Numbers are eyeball-tuned starting points — adjust by visual inspection.
 */
export const RAMROD_ANCHOR_PX_BY_FACING: ReadonlyArray<readonly [number, number]> = [
  [+5, -5], // E
  [+5, -5], // SE
  [+4, -5], // S
  [-4, -5], // SW
  [-5, -5], // W
  [-5, -7], // NW
  [+0, -7], // N
  [+5, -7], // NE
];

/**
 * Map normalized reload progress 0..1 to a downward Y offset in source pixels.
 * Output is `Math.round`ed to integer pixels for crisp pixel-art motion.
 *
 * Curve: `(1 - cos(2π * cycleFrac)) / 2` — eased dip-and-recover per cycle,
 * repeated `RAMROD_PLUNGE_CYCLES` times across the reload.
 */
export function ramrodPlungePx(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  const phase = (p * RAMROD_PLUNGE_CYCLES) % 1;
  const eased = (1 - Math.cos(phase * 2 * Math.PI)) * 0.5;
  return Math.round(eased * RAMROD_PLUNGE_DEPTH_PX);
}
```

- [ ] **Step 4: Verify tests pass**

`npx vitest run src/render/reload-ramrod.test.ts`. All green.

---

## Task 3: Sprite-pass emission

**Files:**
- Modify: `src/render/passes/sprite-pass.ts`

### Steps

- [ ] **Step 1: Add scratch buffers + counter**

Near the existing weapon scratch declarations (around line 306–323), add a parallel set for ramrods:

```ts
const scratchRamrodPos = new Float32Array(capacity * 2);
const scratchRamrodSize = new Float32Array(capacity * 2);
const scratchRamrodColor = new Float32Array(capacity * 4);
const scratchRamrodUv = new Float32Array(capacity * 4);
const scratchRamrodPrimary = new Float32Array(capacity * 3);
const scratchRamrodSecondary = new Float32Array(capacity * 3);
const scratchRamrodTertiary = new Float32Array(capacity * 3);
const scratchRamrodPattern = new Float32Array(capacity);
const scratchRamrodRot = new Float32Array(capacity);
const scratchRamrodFootY = new Float32Array(capacity);
const scratchRamrodShadowAlpha = new Float32Array(capacity);
```

- [ ] **Step 2: Add imports**

At the top of the file:

```ts
import { RAMROD_REGION } from '../sprite-atlas';
import { ramrodPlungePx, RAMROD_ANCHOR_PX_BY_FACING } from '../reload-ramrod';
```

- [ ] **Step 3: Pre-compute ramrod UV rect**

After the existing UV/cell setup (after the `cellUv` arrow function around line 290), compute the ramrod's combined-atlas UV rect once at pass-creation:

```ts
const ramrodUv: [number, number, number, number] = (() => {
  const halfTexelU = 0.5 / sheetW;
  const halfTexelV = 0.5 / sheetH;
  const u0 = RAMROD_REGION.x / sheetW + halfTexelU;
  const v0 = RAMROD_REGION.y / sheetH + halfTexelV;
  const us = RAMROD_REGION.w / sheetW - 2 * halfTexelU;
  const vs = RAMROD_REGION.h / sheetH - 2 * halfTexelV;
  return [u0, v0, us, vs];
})();
```

- [ ] **Step 4: Reset counter each frame**

In the `draw` function near `let wn = 0; let wbn = 0;` (around line 538), add:

```ts
let rn = 0;
```

- [ ] **Step 5: Emit ramrod instances inside the per-entity loop**

Inside the existing `for (let k = 0; k < n; k++)` loop, after the weapon-overlay block but still inside `else { ... }` (the non-dot branch, around line 816), add:

```ts
// Reload ramrod overlay. Emitted only for line infantry in the Reloading
// state — a thin steel column that plunges in and out of the rifle barrel
// during the reload window. Independent of the held-weapon overlay above.
if (
  kind.id === 'line-infantry' &&
  stateNow === EntityState.Reloading
) {
  const initial = e.reloadInitialT[i]!;
  if (initial > 0) {
    const progress = 1 - e.reloadT[i]! / initial;
    const facing = e.facing[i]!;
    const anchor = RAMROD_ANCHOR_PX_BY_FACING[facing]!;
    const plungePx = ramrodPlungePx(progress);
    const sprW = kind.spriteSize?.w ?? kind.placeholderSize.w;
    const pxToWorld = sprW / SPRITE_CELL_PX;
    const dxWorld = anchor[0] * pxToWorld;
    const dyWorld = (anchor[1] + plungePx) * pxToWorld;
    const ramrodWorldW = RAMROD_REGION.w * pxToWorld;
    const ramrodWorldH = RAMROD_REGION.h * pxToWorld;
    scratchRamrodPos[rn * 2 + 0] = scratchPos[k * 2 + 0]! + dxWorld;
    scratchRamrodPos[rn * 2 + 1] = scratchPos[k * 2 + 1]! + dyWorld;
    scratchRamrodSize[rn * 2 + 0] = ramrodWorldW;
    scratchRamrodSize[rn * 2 + 1] = ramrodWorldH;
    scratchRamrodColor[rn * 4 + 0] = 1;
    scratchRamrodColor[rn * 4 + 1] = 1;
    scratchRamrodColor[rn * 4 + 2] = 1;
    scratchRamrodColor[rn * 4 + 3] = 1;
    scratchRamrodUv[rn * 4 + 0] = ramrodUv[0];
    scratchRamrodUv[rn * 4 + 1] = ramrodUv[1];
    scratchRamrodUv[rn * 4 + 2] = ramrodUv[2];
    scratchRamrodUv[rn * 4 + 3] = ramrodUv[3];
    // Marker palette: ramrod has no marker pixels, but we must populate the
    // attribute buffers — copy the body's team palette (harmless, never
    // sampled because the steel pixels aren't markers).
    scratchRamrodPrimary[rn * 3 + 0] = scratchPrimary[k * 3 + 0]!;
    scratchRamrodPrimary[rn * 3 + 1] = scratchPrimary[k * 3 + 1]!;
    scratchRamrodPrimary[rn * 3 + 2] = scratchPrimary[k * 3 + 2]!;
    scratchRamrodSecondary[rn * 3 + 0] = scratchSecondary[k * 3 + 0]!;
    scratchRamrodSecondary[rn * 3 + 1] = scratchSecondary[k * 3 + 1]!;
    scratchRamrodSecondary[rn * 3 + 2] = scratchSecondary[k * 3 + 2]!;
    scratchRamrodTertiary[rn * 3 + 0] = scratchTertiary[k * 3 + 0]!;
    scratchRamrodTertiary[rn * 3 + 1] = scratchTertiary[k * 3 + 1]!;
    scratchRamrodTertiary[rn * 3 + 2] = scratchTertiary[k * 3 + 2]!;
    scratchRamrodPattern[rn] = 0;
    scratchRamrodRot[rn] = 0;
    scratchRamrodFootY[rn] = bodyFootYWorld;
    scratchRamrodShadowAlpha[rn] = 0; // no ground shadow for the ramrod
    rn++;
  }
}
```

- [ ] **Step 6: Add ramrod draw call AFTER bodies and BEFORE the front-weapon group**

The existing structure (around line 922–966):

```
1. shadows
2. weapons-behind sprite draw
3. bodies sprite draw
4. weapons-front sprite draw
```

Insert the ramrod draw between step 3 and step 4 (so the ramrod sits over the body but the front-weapon overlay can still cover the lower portion of the rod where it disappears into the barrel).

After the `// Bodies pass.` block ends (around line 942) and BEFORE `// Weapons-front pass:` (around line 944), add:

```ts
// Ramrod pass: drawn after bodies (so it sits in front of the soldier's
// torso) but before the front-weapon overlay (so the rifle barrel
// covers the lower half of the rod, completing the "rod is in the
// barrel" illusion). Same VAO + shader as the body pass.
if (rn > 0) {
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRamrodPos.subarray(0, rn * 2));
  gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRamrodSize.subarray(0, rn * 2));
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRamrodColor.subarray(0, rn * 4));
  gl.bindBuffer(gl.ARRAY_BUFFER, uvRectBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRamrodUv.subarray(0, rn * 4));
  gl.bindBuffer(gl.ARRAY_BUFFER, primaryBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRamrodPrimary.subarray(0, rn * 3));
  gl.bindBuffer(gl.ARRAY_BUFFER, secondaryBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRamrodSecondary.subarray(0, rn * 3));
  gl.bindBuffer(gl.ARRAY_BUFFER, tertiaryBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRamrodTertiary.subarray(0, rn * 3));
  gl.bindBuffer(gl.ARRAY_BUFFER, patternBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRamrodPattern.subarray(0, rn));
  gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRamrodRot.subarray(0, rn));
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, rn);
}
```

(No shadow draw for the ramrod — it's a tiny in-air object; ground shadow would just look like dirt under the soldier.)

- [ ] **Step 7: TypeScript check**

`npx tsc --noEmit`.

- [ ] **Step 8: Run the full test suite**

`npx vitest run`. All tests pass.

- [ ] **Step 9: Visual smoke test**

Per CLAUDE.md UI testing rule: start the dev server and verify the animation reads correctly in a browser.

```
npm run dev
```

Open the game, spawn a line-infantry unit (or watch an existing skirmish), and verify:

1. ✅ During the Reloading state, a small steel column appears near the rifle.
2. ✅ The column visibly plunges down + back up multiple times across the reload duration.
3. ✅ The column disappears the moment the soldier finishes reloading (state → Idle).
4. ✅ Different facings show the ramrod in roughly the right place (above the barrel area, not floating somewhere weird).
5. ✅ Ramrod doesn't appear during Aiming, Firing, Idle, or Walking.

If any anchor offset looks visibly wrong, tweak `RAMROD_ANCHOR_PX_BY_FACING` in `src/render/reload-ramrod.ts` and re-test. Repeat until the visual reads cleanly. **Anchor tuning is expected to take a few passes** — the placeholder values in the spec are starting points only.

---

## Done criteria

- All new tests pass (`ramrod-sprite.test.ts`, `reload-ramrod.test.ts`).
- Full `npx vitest run` is green.
- `npx tsc --noEmit` clean.
- Visual smoke test confirms the plunging-ramrod animation appears for line infantry in Reloading state, hidden in all other states, with reasonable per-facing positioning.
