# Cuirassier pose-pipeline migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `idle/walking/running` cuirassier sprites at 32×24 to the
hand-drawn pose pipeline, generated programmatically from ASCII grids and
emitted as PNGs into `public/sprites/poses/cuirassier/`.

**Architecture:** Single source of truth in `scripts/lib/cuirassier-poses.mjs`
(palette, frame data, render/mirror helpers). A thin orchestrator script
`scripts/draw-cuirassier-poses.mjs` reads it and writes per-pose / per-dir /
per-frame PNGs. `scripts/build-pose-manifest.mjs` (already wired into
`npm run dev`/`build`) walks the new PNGs and rebuilds the manifest. The
existing `PoseAtlas` runtime resolves them automatically. The procedural
combined-atlas runtime path (`src/render/cuirassier-sprite.ts`) stays as a
fallback. Vitest test in `src/sprite-gen/cuirassier-poses.test.ts` imports the
.mjs lib to validate frame shapes, palette use, and frame counts.

**Tech Stack:** Node 20 ESM, `pngjs` (already a devDep), vitest, plain TS for
the test. No new dependencies.

**Reference:** Spec at `docs/superpowers/specs/2026-04-27-cuirassier-poses-design.md`.
Existing visual style reference: `src/render/cuirassier-sprite.ts` (15×20
single-frame ASCII grids, same palette, anchor at bottom-center).

---

## File structure

| Path | Purpose |
|---|---|
| `scripts/lib/cuirassier-poses.mjs` | Source of truth: constants, palette, ASCII frame data per pose×dir, helpers (`renderFrame`, `mirrorFrame`, `validateFrame`). |
| `scripts/draw-cuirassier-poses.mjs` | Orchestrator: walks the data, mirrors W/SW/NW from E/SE/NE, encodes PNGs via `pngjs`, writes to `public/sprites/poses/cuirassier/<pose>/<dir>/0/<frame>.png`. |
| `src/sprite-gen/cuirassier-poses.test.ts` | Vitest spec: shape/palette/frame-count assertions. Imports `scripts/lib/cuirassier-poses.mjs` directly. |
| `public/sprites/poses/cuirassier/idle/<DIR>/0/0.png` | Output, 8 dirs × 1 frame. |
| `public/sprites/poses/cuirassier/walking/<DIR>/0/<0..3>.png` | Output, 8 dirs × 4 frames. |
| `public/sprites/poses/cuirassier/running/<DIR>/0/<0..5>.png` | Output, 8 dirs × 6 frames. |
| `package.json` | New `draw:cuirassier-poses` script. |
| `scripts/seed-poses.mjs` | Remove the cuirassier block (obsoleted; would re-seed 15×20 PNGs over our 32×24 ones). |

Constants (use these exact values throughout):

- `CELL_W = 32`
- `CELL_H = 24`
- Source directions (authored): `['N', 'NE', 'E', 'SE', 'S']`
- Mirrored directions (emitted by flipping at write time):
  - `NW` = mirror of `NE`
  - `W` = mirror of `E`
  - `SW` = mirror of `SE`
- All 8 compass dirs are emitted to disk; the pose-atlas does not know about mirroring.

Palette glyphs (must match `src/render/cuirassier-sprite.ts` exactly so style is consistent):

```js
const PALETTE = {
  '.': [0, 0, 0, 0],         // transparent
  'k': [22, 18, 28, 255],    // outline / hooves
  'h': [110, 75, 45, 255],   // horse coat
  'H': [74, 50, 30, 255],    // horse coat shadow
  'f': [228, 188, 156, 255], // skin
  'F': [186, 142, 108, 255], // skin shadow
  'g': [180, 188, 200, 255], // steel: sabre, helmet
  'm': [60, 40, 26, 255],    // saddle leather
  'w': [236, 232, 222, 255], // belts / breeches / blanket
  's': [60, 56, 52, 110],    // ground shadow (semi-alpha)
  'P': [180, 40, 50, 255],   // primary = British red coat
  'S': [50, 60, 140, 255],   // secondary = British blue facings
};
```

(`P`/`S` are baked at British defaults. The on-disk PNGs already look like a
real unit. The runtime sprite-pass does **not** swap markers in pose-atlas
PNGs — that swap only applies to the procedural combined-atlas via the
generator's `resolvePrimary`/`resolveSecondary` opts. So the PNG colors are
final.)

---

## Task 1: Module skeleton, palette, helpers, and helper tests

**Files:**
- Create: `scripts/lib/cuirassier-poses.mjs`
- Create: `src/sprite-gen/cuirassier-poses.test.ts`

- [ ] **Step 1: Create the lib module skeleton.**

```js
// scripts/lib/cuirassier-poses.mjs
// Source of truth for cuirassier pose sprites. Imported by:
//   - scripts/draw-cuirassier-poses.mjs (PNG emit)
//   - src/sprite-gen/cuirassier-poses.test.ts (shape/palette validation)
//
// Style reference: src/render/cuirassier-sprite.ts. Anchor: bottom-center of
// the cell aligns with the unit's ground position (so the lowest non-shadow
// row should be the hooves, with `s` shadow pixels at the very bottom).

export const CELL_W = 32;
export const CELL_H = 24;

export const SOURCE_DIRS = ['N', 'NE', 'E', 'SE', 'S'];
export const MIRROR_PAIRS = [
  ['NW', 'NE'],
  ['W',  'E'],
  ['SW', 'SE'],
];
export const ALL_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export const PALETTE = {
  '.': [0, 0, 0, 0],
  'k': [22, 18, 28, 255],
  'h': [110, 75, 45, 255],
  'H': [74, 50, 30, 255],
  'f': [228, 188, 156, 255],
  'F': [186, 142, 108, 255],
  'g': [180, 188, 200, 255],
  'm': [60, 40, 26, 255],
  'w': [236, 232, 222, 255],
  's': [60, 56, 52, 110],
  'P': [180, 40, 50, 255],
  'S': [50, 60, 140, 255],
};

export const FRAME_COUNTS = {
  idle: 1,
  walking: 4,
  running: 6,
};

/**
 * Validates a frame: must be CELL_H rows of CELL_W chars, every char in PALETTE.
 * Throws on mismatch with a descriptive message including the offending char.
 */
export function validateFrame(frame, label) {
  if (!Array.isArray(frame)) throw new Error(`${label}: frame is not an array`);
  if (frame.length !== CELL_H) {
    throw new Error(`${label}: expected ${CELL_H} rows, got ${frame.length}`);
  }
  for (let y = 0; y < CELL_H; y++) {
    const row = frame[y];
    if (typeof row !== 'string') throw new Error(`${label}[${y}]: row not a string`);
    if (row.length !== CELL_W) {
      throw new Error(`${label}[${y}]: expected ${CELL_W} cols, got ${row.length} ("${row}")`);
    }
    for (let x = 0; x < CELL_W; x++) {
      const ch = row[x];
      if (!(ch in PALETTE)) {
        throw new Error(`${label}[${y}][${x}]: unknown glyph '${ch}'`);
      }
    }
  }
}

/** Renders a frame to a Uint8Array of length CELL_W * CELL_H * 4 (RGBA). */
export function renderFrame(frame) {
  validateFrame(frame, 'renderFrame');
  const out = new Uint8Array(CELL_W * CELL_H * 4);
  for (let y = 0; y < CELL_H; y++) {
    const row = frame[y];
    for (let x = 0; x < CELL_W; x++) {
      const rgba = PALETTE[row[x]];
      const i = (y * CELL_W + x) * 4;
      out[i + 0] = rgba[0];
      out[i + 1] = rgba[1];
      out[i + 2] = rgba[2];
      out[i + 3] = rgba[3];
    }
  }
  return out;
}

/** Returns a horizontally-mirrored copy of a frame. */
export function mirrorFrame(frame) {
  validateFrame(frame, 'mirrorFrame');
  const out = [];
  for (let y = 0; y < CELL_H; y++) {
    out.push(frame[y].split('').reverse().join(''));
  }
  return out;
}

// Pose data is added in subsequent tasks. Placeholder so other tasks can
// import without errors:
export const POSES = {
  idle: {},
  walking: {},
  running: {},
};
```

- [ ] **Step 2: Write the failing test for helpers.**

```ts
// src/sprite-gen/cuirassier-poses.test.ts
import { describe, expect, it } from 'vitest';
import {
  CELL_W,
  CELL_H,
  PALETTE,
  SOURCE_DIRS,
  ALL_DIRS,
  FRAME_COUNTS,
  validateFrame,
  renderFrame,
  mirrorFrame,
} from '../../scripts/lib/cuirassier-poses.mjs';

const SOLID_BLANK = Array.from({ length: CELL_H }, () => '.'.repeat(CELL_W));

describe('cuirassier-poses helpers', () => {
  it('exports correct cell dimensions', () => {
    expect(CELL_W).toBe(32);
    expect(CELL_H).toBe(24);
  });

  it('palette has every expected glyph and all colors are 4-byte', () => {
    const expected = ['.', 'k', 'h', 'H', 'f', 'F', 'g', 'm', 'w', 's', 'P', 'S'];
    for (const ch of expected) {
      expect(PALETTE[ch]).toBeDefined();
      const rgba = PALETTE[ch];
      expect(rgba).toHaveLength(4);
      for (const c of rgba) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });

  it('source dirs are 5 and all dirs are 8', () => {
    expect(SOURCE_DIRS).toEqual(['N', 'NE', 'E', 'SE', 'S']);
    expect(ALL_DIRS).toHaveLength(8);
  });

  it('frame counts match the design', () => {
    expect(FRAME_COUNTS).toEqual({ idle: 1, walking: 4, running: 6 });
  });

  it('validateFrame accepts a blank frame', () => {
    expect(() => validateFrame(SOLID_BLANK, 'blank')).not.toThrow();
  });

  it('validateFrame rejects wrong row count', () => {
    expect(() => validateFrame(SOLID_BLANK.slice(0, 5), 'short')).toThrow(/24 rows/);
  });

  it('validateFrame rejects wrong column count', () => {
    const bad = [...SOLID_BLANK];
    bad[0] = '.'.repeat(CELL_W - 1);
    expect(() => validateFrame(bad, 'narrow')).toThrow(/32 cols/);
  });

  it('validateFrame rejects unknown glyph', () => {
    const bad = [...SOLID_BLANK];
    bad[0] = 'X' + '.'.repeat(CELL_W - 1);
    expect(() => validateFrame(bad, 'glyph')).toThrow(/unknown glyph 'X'/);
  });

  it('renderFrame emits CELL_W*CELL_H*4 bytes of zero alpha for blank', () => {
    const buf = renderFrame(SOLID_BLANK);
    expect(buf).toHaveLength(CELL_W * CELL_H * 4);
    for (let i = 3; i < buf.length; i += 4) expect(buf[i]).toBe(0);
  });

  it('mirrorFrame is involutive on a blank frame', () => {
    const m = mirrorFrame(mirrorFrame(SOLID_BLANK));
    expect(m).toEqual(SOLID_BLANK);
  });

  it('mirrorFrame flips a single asymmetric pixel', () => {
    const f = [...SOLID_BLANK];
    f[10] = 'h' + '.'.repeat(CELL_W - 1);
    const m = mirrorFrame(f);
    expect(m[10]).toBe('.'.repeat(CELL_W - 1) + 'h');
  });
});
```

- [ ] **Step 3: Run tests to verify they pass.**

Run: `npx vitest run src/sprite-gen/cuirassier-poses.test.ts`
Expected: 10 tests pass.

- [ ] **Step 4: Commit.**

```bash
git add scripts/lib/cuirassier-poses.mjs src/sprite-gen/cuirassier-poses.test.ts
git commit -m "feat(sprite-gen): cuirassier pose lib skeleton + helpers"
```

---

## Task 2: Idle frames (5 source dirs × 1 frame)

**Files:**
- Modify: `scripts/lib/cuirassier-poses.mjs` (extend `POSES.idle`)
- Modify: `src/sprite-gen/cuirassier-poses.test.ts` (add idle assertions)

**Authoring guidance** (read this before writing the frames):

- Style reference: `src/render/cuirassier-sprite.ts` lines 58–171 — that file
  has 5 finished cuirassier silhouettes (`POSE_FRONT`, `POSE_FRONT_DIAG`,
  `POSE_SIDE`, `POSE_BACK`, `POSE_BACK_DIAG`) at 15×20. Keep the same body
  proportions, scaled up: rider centered horizontally, horse silhouette
  occupying the lower ~⅔ of the cell, ground-shadow `s` row at the bottom.
- 32×24 budget: rider ~14 px tall × ~10 px wide, horse body ~12 px tall ×
  ~22 px wide, hooves at row 22, ground shadow `s` on row 23.
- Helmet plume: 2-3 px tall above head, character `S`. Sabre (`g`) visible only
  in side and 3/4 facings, hilt at rider's right hand.
- Sword scabbard / saddle blanket: `m` strip at saddle line.
- Idle: horse standing at attention, all four legs planted, sabre held
  vertically (hilt up) for side facings. No frame-to-frame motion.

**One worked example — `idle.E` (horse facing East / right). Use this as the
template for proportions. The rider faces right; sabre rises from the right
hand. Adapt for N (rider+horse seen from behind, no sabre visible from this
angle), NE (3/4 back-right, sabre tip visible), SE (3/4 front-right, sabre
visible), S (front-on, sabre held vertical-center, plume visible).

```
................................   //  0
................................   //  1 sabre tip
.............................g..   //  2
............................g...   //  3
...........................g....   //  4
.........SS...............g.....   //  5 plume
........SSSS.............g......   //  6 plume base
........kkkk............g.......   //  7 helmet top
.......kkggk...........g........   //  8 helmet visor
.......kfFkk..........g.........   //  9 face profile + sabre
.......SPPS..........g..........   // 10 collar + sabre arm
......SPPPPSPS......g...........   // 11 cuirass + sword arm extended
......SPPPPSP...................   // 12 cuirass
......mwwwwwm...................   // 13 saddle blanket
.....hhhhhhhhh..................   // 14 horse withers
....hhhhhhhhhhh.................   // 15 back
...hhhhhhhhhhhhh................   // 16 body + head appearing right
...Hhhhhhhhhhfh.................   // 17 body + horse face
....HHHHHHHHHH..................   // 18 belly
....h....hh.h.h.................   // 19 4 legs visible from side
....h....hh.h.h.................   // 20
....k....kk.k.k.................   // 21 hooves
....k....kk.k.k.................   // 22
....sssssssssssss...............   // 23 ground shadow
```

(That's a recognizable side-facing cuirassier scaled to 32×24; the right-side
columns are blank because the sabre tip uses them in the side facing only.
For other facings, use the silhouette conventions from cuirassier-sprite.ts:
S = front-on with rider centered, N = back-on with helmet+plume only, NE/SE
= 3/4 views with horse body slightly biased to the right.)

The implementer should hand-author the remaining 4 idle frames (N, NE, SE, S)
following these proportions. Validate all five via the test.

- [ ] **Step 1: Add a failing test for idle frames.**

Add to `src/sprite-gen/cuirassier-poses.test.ts`:

```ts
import { POSES, validateFrame, SOURCE_DIRS, FRAME_COUNTS } from '../../scripts/lib/cuirassier-poses.mjs';

describe('cuirassier-poses idle', () => {
  it('has all 5 source directions populated', () => {
    for (const dir of SOURCE_DIRS) {
      expect(POSES.idle[dir]).toBeDefined();
      expect(POSES.idle[dir]).toHaveLength(FRAME_COUNTS.idle);
    }
  });

  it('every idle frame validates', () => {
    for (const dir of SOURCE_DIRS) {
      for (let i = 0; i < POSES.idle[dir].length; i++) {
        validateFrame(POSES.idle[dir][i], `idle.${dir}[${i}]`);
      }
    }
  });

  it('idle frames have ground shadow on the bottom row', () => {
    for (const dir of SOURCE_DIRS) {
      const lastRow = POSES.idle[dir][0][CELL_H - 1];
      expect(lastRow).toMatch(/s/);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `npx vitest run src/sprite-gen/cuirassier-poses.test.ts`
Expected: 3 new tests fail (`POSES.idle.N` is undefined, etc.).

- [ ] **Step 3: Author the 5 idle frames in the lib.**

Add to `scripts/lib/cuirassier-poses.mjs`, replacing the placeholder `idle: {}`:

```js
const IDLE_E = [
  // ... 24 rows of 32 chars (use the worked example above as the starting
  //     point and refine; ensure row 23 contains 's' chars)
];
const IDLE_S = [/* front-on, plume centered, sabre vertical, all legs visible */];
const IDLE_N = [/* back-on, helmet+plume centered, no sabre visible */];
const IDLE_NE = [/* 3/4 back-right; mirror of NE for NW happens at emit time */];
const IDLE_SE = [/* 3/4 front-right; mirror for SW happens at emit time */];

// ... and update POSES:
export const POSES = {
  idle: { N: [IDLE_N], NE: [IDLE_NE], E: [IDLE_E], SE: [IDLE_SE], S: [IDLE_S] },
  walking: {},
  running: {},
};
```

(The implementer fills in the actual ASCII for each. Each frame is wrapped in
a one-element array so the structure is uniform with multi-frame poses.)

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run src/sprite-gen/cuirassier-poses.test.ts`
Expected: all tests pass, including the 3 idle tests.

- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/cuirassier-poses.mjs src/sprite-gen/cuirassier-poses.test.ts
git commit -m "feat(sprite-gen): cuirassier idle frames (5 source dirs)"
```

---

## Task 3: Walking frames (5 source dirs × 4 frames)

**Files:**
- Modify: `scripts/lib/cuirassier-poses.mjs` (extend `POSES.walking`)
- Modify: `src/sprite-gen/cuirassier-poses.test.ts`

**Authoring guidance:**

- 4-beat horse walk cycle. Per-frame leg phases (looking from the **East**
  side; reverse for the back-facing dirs):
  - Frame 0: `LF planted, RH planted, RF lifted slightly, LH about to lift`
  - Frame 1: `LF planted, RH lifting, RF advanced (now planted), LH lifted high`
  - Frame 2: `LF lifting, RH advanced (now planted), RF planted, LH advanced`
  - Frame 3: `LF advanced (now planted), RH lifted, RF lifting, LH planted`
- Body bob: rider/saddle row `m` shifts up by 1 px on frames 1 and 3 (the
  "suspension" beats in a slow walk feel).
- Use the idle frame as the base; only the leg rows (rows 19–22) and saddle
  row (row 13) change between frames.
- The N facing has near-imperceptible leg motion (legs are mostly hidden
  behind the rump) — animate the saddle-bob only, and shift one visible
  hoof per frame.
- The S facing has all four legs visible head-on; rotate the lift cycle so
  the visible leg "swap" reads correctly.

**Worked example — walking.E frame 0 (the contact pose):** identical to
`idle.E` is fine for frame 0. Frames 1–3 are deltas as described above. Each
delta is ~6 changed cells.

- [ ] **Step 1: Add a failing test for walking frames.**

```ts
describe('cuirassier-poses walking', () => {
  it('has all 5 source directions with 4 frames each', () => {
    for (const dir of SOURCE_DIRS) {
      expect(POSES.walking[dir]).toBeDefined();
      expect(POSES.walking[dir]).toHaveLength(FRAME_COUNTS.walking);
    }
  });

  it('every walking frame validates', () => {
    for (const dir of SOURCE_DIRS) {
      for (let i = 0; i < POSES.walking[dir].length; i++) {
        validateFrame(POSES.walking[dir][i], `walking.${dir}[${i}]`);
      }
    }
  });

  it('walking frames are not all identical (animation is non-trivial)', () => {
    for (const dir of SOURCE_DIRS) {
      const first = POSES.walking[dir][0].join('\n');
      const lastDifferent = POSES.walking[dir].slice(1).some((f) => f.join('\n') !== first);
      expect(lastDifferent, `walking.${dir} all frames identical`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run src/sprite-gen/cuirassier-poses.test.ts`
Expected: 3 walking tests fail.

- [ ] **Step 3: Author the 20 walking frames.**

5 directions × 4 frames each. Use idle frames as the contact-pose base; vary
leg/hoof rows per the cycle described above. Update the lib:

```js
export const POSES = {
  idle: { ... },
  walking: {
    N:  [WALK_N_0,  WALK_N_1,  WALK_N_2,  WALK_N_3 ],
    NE: [WALK_NE_0, WALK_NE_1, WALK_NE_2, WALK_NE_3],
    E:  [WALK_E_0,  WALK_E_1,  WALK_E_2,  WALK_E_3 ],
    SE: [WALK_SE_0, WALK_SE_1, WALK_SE_2, WALK_SE_3],
    S:  [WALK_S_0,  WALK_S_1,  WALK_S_2,  WALK_S_3 ],
  },
  running: {},
};
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run src/sprite-gen/cuirassier-poses.test.ts`
Expected: all walking tests pass.

- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/cuirassier-poses.mjs src/sprite-gen/cuirassier-poses.test.ts
git commit -m "feat(sprite-gen): cuirassier walking frames (4-beat cycle)"
```

---

## Task 4: Running frames (5 source dirs × 6 frames)

**Files:**
- Modify: `scripts/lib/cuirassier-poses.mjs`
- Modify: `src/sprite-gen/cuirassier-poses.test.ts`

**Authoring guidance:**

- 6-key gallop cycle:
  - Frame 0: gathered (all four hooves under the body, lowest point)
  - Frame 1: rear-leg push-off (hind hooves down, front hooves lifting)
  - Frame 2: extended-flight (all hooves off ground, body stretched)
  - Frame 3: front-leg landing (front hooves down, hind hooves still extended back)
  - Frame 4: rolling-contact (front planted, hind catching up)
  - Frame 5: gather (all four hooves close together again, body compressed)
- Body lift: in frames 2–3 (suspension), the saddle row `m` and everything
  above shifts UP by 1–2 px. In frame 0 (gathered), the body is at its
  lowest — saddle row shifts DOWN by 1 px.
- Sabre held forward in side facings during gallop: `g` glyphs extend further
  to the East than in walking/idle (extended sword arm). Rider leans forward
  by 1 px (cuirass row shifts forward 1 col on frames 2-3).
- Ground shadow `s` blurs/lengthens during the suspension frames (rows
  21-23 may have `s` glyphs in a wider arc).
- Frames 0 and 5 are similar (start/end of cycle) but not identical.

- [ ] **Step 1: Add a failing test for running frames.**

```ts
describe('cuirassier-poses running', () => {
  it('has all 5 source directions with 6 frames each', () => {
    for (const dir of SOURCE_DIRS) {
      expect(POSES.running[dir]).toBeDefined();
      expect(POSES.running[dir]).toHaveLength(FRAME_COUNTS.running);
    }
  });

  it('every running frame validates', () => {
    for (const dir of SOURCE_DIRS) {
      for (let i = 0; i < POSES.running[dir].length; i++) {
        validateFrame(POSES.running[dir][i], `running.${dir}[${i}]`);
      }
    }
  });

  it('running frames are not all identical', () => {
    for (const dir of SOURCE_DIRS) {
      const first = POSES.running[dir][0].join('\n');
      const lastDifferent = POSES.running[dir].slice(1).some((f) => f.join('\n') !== first);
      expect(lastDifferent, `running.${dir} all frames identical`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Expected: 3 running tests fail.

- [ ] **Step 3: Author the 30 running frames.**

5 directions × 6 frames. Use the gallop cycle described above. Update
`POSES.running`:

```js
running: {
  N:  [RUN_N_0,  RUN_N_1,  RUN_N_2,  RUN_N_3,  RUN_N_4,  RUN_N_5 ],
  NE: [RUN_NE_0, RUN_NE_1, RUN_NE_2, RUN_NE_3, RUN_NE_4, RUN_NE_5],
  E:  [RUN_E_0,  RUN_E_1,  RUN_E_2,  RUN_E_3,  RUN_E_4,  RUN_E_5 ],
  SE: [RUN_SE_0, RUN_SE_1, RUN_SE_2, RUN_SE_3, RUN_SE_4, RUN_SE_5],
  S:  [RUN_S_0,  RUN_S_1,  RUN_S_2,  RUN_S_3,  RUN_S_4,  RUN_S_5 ],
},
```

- [ ] **Step 4: Run tests to verify they pass.**

Expected: all tests pass.

- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/cuirassier-poses.mjs src/sprite-gen/cuirassier-poses.test.ts
git commit -m "feat(sprite-gen): cuirassier running frames (6-key gallop cycle)"
```

---

## Task 5: Orchestrator script `draw-cuirassier-poses.mjs`

**Files:**
- Create: `scripts/draw-cuirassier-poses.mjs`

- [ ] **Step 1: Write the script.**

```js
// scripts/draw-cuirassier-poses.mjs
//
// Walks POSES from scripts/lib/cuirassier-poses.mjs and emits one PNG per
// (pose, dir, frame) into:
//   public/sprites/poses/cuirassier/<pose>/<dir>/0/<frame>.png
//
// Mirroring (NW=mirror(NE), W=mirror(E), SW=mirror(SE)) is performed at
// emit time so every direction has a real on-disk PNG.
//
// Idempotent: re-running overwrites existing PNGs.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  CELL_W,
  CELL_H,
  POSES,
  SOURCE_DIRS,
  MIRROR_PAIRS,
  renderFrame,
  mirrorFrame,
} from './lib/cuirassier-poses.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_BASE = resolve(REPO_ROOT, 'public', 'sprites', 'poses', 'cuirassier');

async function writePng(rgba, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  const png = new PNG({ width: CELL_W, height: CELL_H });
  png.data = Buffer.from(rgba);
  const buffer = PNG.sync.write(png);
  await writeFile(outPath, buffer);
}

async function emitDir(pose, dir, frames) {
  for (let i = 0; i < frames.length; i++) {
    const rgba = renderFrame(frames[i]);
    const outPath = resolve(OUT_BASE, pose, dir, '0', `${i}.png`);
    await writePng(rgba, outPath);
  }
}

async function main() {
  let total = 0;
  for (const pose of Object.keys(POSES)) {
    const data = POSES[pose];
    // Source dirs (authored).
    for (const dir of SOURCE_DIRS) {
      const frames = data[dir];
      if (!frames) throw new Error(`pose '${pose}' missing source dir '${dir}'`);
      await emitDir(pose, dir, frames);
      total += frames.length;
    }
    // Mirrored dirs.
    for (const [dst, src] of MIRROR_PAIRS) {
      const srcFrames = data[src];
      if (!srcFrames) throw new Error(`pose '${pose}' missing source dir '${src}' for mirror '${dst}'`);
      const dstFrames = srcFrames.map(mirrorFrame);
      await emitDir(pose, dst, dstFrames);
      total += dstFrames.length;
    }
  }
  console.log(`Wrote ${total} cuirassier pose frames to ${OUT_BASE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script.**

Edit `package.json` `scripts`, add after `"build:poses"`:

```json
"draw:cuirassier-poses": "node scripts/draw-cuirassier-poses.mjs",
```

- [ ] **Step 3: Run it.**

Run: `npm run draw:cuirassier-poses`
Expected: prints `Wrote 88 cuirassier pose frames to .../public/sprites/poses/cuirassier`. Output: `8 + 32 + 48 = 88`.

- [ ] **Step 4: Verify file count.**

Run: `find public/sprites/poses/cuirassier -name '*.png' | wc -l`
Expected: `88`.

Run: `find public/sprites/poses/cuirassier/idle -name '*.png' | wc -l`
Expected: `8`.

Run: `find public/sprites/poses/cuirassier/walking -name '*.png' | wc -l`
Expected: `32`.

Run: `find public/sprites/poses/cuirassier/running -name '*.png' | wc -l`
Expected: `48`.

- [ ] **Step 5: Verify a sample PNG dimension.**

Run: `file public/sprites/poses/cuirassier/walking/E/0/0.png`
Expected: `PNG image data, 32 x 24, 8-bit/color RGBA, non-interlaced`.

- [ ] **Step 6: Commit script + npm wiring + outputs.**

```bash
git add scripts/draw-cuirassier-poses.mjs package.json public/sprites/poses/cuirassier
git commit -m "feat(sprite-gen): emit cuirassier pose PNGs (88 frames at 32x24)"
```

---

## Task 6: Rebuild manifest and verify runtime can read it

**Files:**
- Modify: `public/sprites/poses/manifest.json` (regenerated by build script)

- [ ] **Step 1: Rebuild the manifest.**

Run: `npm run build:poses`
Expected: completes without warnings about cuirassier.

- [ ] **Step 2: Verify the manifest was updated.**

Run: `node -e "const m = require('./public/sprites/poses/manifest.json'); console.log(JSON.stringify(Object.keys(m.kinds.cuirassier.poses)))"`
Expected: `["idle","walking","running"]`.

Run: `node -e "const m = require('./public/sprites/poses/manifest.json'); console.log(m.kinds.cuirassier.poses.walking.clips.E.length, m.kinds.cuirassier.poses.walking.clips.E[0].length)"`
Expected: `1 4` (one clip per dir, 4 frames in that clip).

Run: `node -e "const m = require('./public/sprites/poses/manifest.json'); console.log(m.kinds.cuirassier.poses.running.clips.E[0].length)"`
Expected: `6`.

- [ ] **Step 3: Run the test suite to make sure nothing else broke.**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Run typecheck.**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit the regenerated manifest.**

```bash
git add public/sprites/poses/manifest.json
git commit -m "build(poses): rebuild manifest with cuirassier walking/running"
```

---

## Task 7: Remove obsolete cuirassier entry from `seed-poses.mjs`

**Files:**
- Modify: `scripts/seed-poses.mjs`

`seed-poses.mjs` was a one-shot seeder that slices `cuirassier.png` (15×20)
into pose PNGs. With `draw-cuirassier-poses.mjs` now the source of truth at
32×24, leaving the old seeder around risks someone re-running it and
clobbering our 32×24 PNGs with 15×20 ones.

- [ ] **Step 1: Open the file and locate the cuirassier KIND entry.**

Run: `grep -n "cuirassier" scripts/seed-poses.mjs`
Expected: lines pointing at the `cuirassier` block in the `KINDS` array
(approximately near line 53–67).

- [ ] **Step 2: Delete the cuirassier entry from the `KINDS` array.**

Edit `scripts/seed-poses.mjs` and remove the entire object literal:

```js
{
  kind: 'cuirassier',
  sourcePng: 'cuirassier.png',
  cellW: 15,
  cellH: 20,
  cells: [
    // ... CUIRASSIER_POSE_CELLS
  ],
},
```

Leave the `line-infantry` and `cannon-12` entries intact. Add a 1-line
comment above the array if it helps document the omission:

```js
// Cuirassier is no longer seeded from the legacy combined-atlas — see
// scripts/draw-cuirassier-poses.mjs (32x24 multi-pose).
```

- [ ] **Step 3: Verify the script still parses.**

Run: `node --check scripts/seed-poses.mjs`
Expected: no output, exit 0.

- [ ] **Step 4: Commit.**

```bash
git add scripts/seed-poses.mjs
git commit -m "chore(scripts): drop cuirassier from seed-poses (replaced by draw-cuirassier-poses)"
```

---

## Task 8: Visual smoke test in the running app

This task is a manual verification step. No code changes.

- [ ] **Step 1: Start the dev server.**

Run: `npm run dev`
Expected: vite starts on a local URL (typically `http://localhost:5173`).

- [ ] **Step 2: Open the lab and place a cuirassier formation.**

Open the lab page (`/lab.html`), select cuirassier from the unit dropdown,
and place a small formation. Issue a movement order to make them walk, then
a longer-distance order to make them run.

- [ ] **Step 3: Verify each visual criterion.**

Confirm by inspection:
- Idle cuirassiers face the correct direction for all 8 facings (no obvious mirroring errors — sabre on the correct side, etc.).
- Walking cycle visibly animates legs at ~8 fps (4 frames over 0.5s).
- Running cycle is faster (~12 fps over 0.5s) and visibly different from walking — gallop is taller, more forward lean.
- No red-square / missing-frame artifacts (which would indicate `pickPoseUv` returning null).
- Compared to line-infantry sprites in the same scene, the cuirassier silhouette is roughly proportional (slightly larger horizontally, similar height).

- [ ] **Step 4: If the cuirassier looks too large/small in the lab, adjust per-kind draw scaling.**

If visibly off-scale, check `src/lab/lab-ui.ts` (search for `IS_CAVALRY` or
size constants) and adjust the cuirassier display scale. This may not be
needed; verify first.

If a fix is needed, commit it:

```bash
git add src/lab/lab-ui.ts
git commit -m "fix(lab): adjust cuirassier display scale for 32x24 sprites"
```

- [ ] **Step 5: Stop the dev server.**

`Ctrl+C` in the terminal running `npm run dev`.

---

## Self-review checklist (run after writing the plan; not required as a task)

- ✅ Spec coverage:
  - Cell size 32×24 — Task 1.
  - Pose set idle/walking/running — Tasks 2/3/4.
  - Frame counts 1/4/6 — covered.
  - Mirroring at emit — Task 5.
  - PNGs at expected paths — Task 5/6.
  - Manifest rebuild via existing script — Task 6.
  - Test coverage for shapes/palette — Tasks 1–4.
  - `seed-poses.mjs` cleanup — Task 7.
  - Visual smoke test — Task 8.
- ✅ No "TBD"/"TODO" placeholders. Authoring guidance for the 55 source frames
  is concrete (cycle phases, body bob, sabre extension), and one fully worked
  ASCII example is provided as a starting template; remaining frames follow
  documented deltas. The implementer is expected to use judgment for the
  pixel-art details, validated by tests + visual smoke.
- ✅ Type/identifier consistency: `CELL_W`/`CELL_H`/`POSES`/`PALETTE`/`SOURCE_DIRS`/`MIRROR_PAIRS`/`renderFrame`/`mirrorFrame`/`validateFrame`/`FRAME_COUNTS` are introduced in Task 1 and used unchanged in Tasks 2–8.
- ✅ Each task ends with a commit; tests precede implementation everywhere it's possible (TDD).
- ✅ File paths and commands are exact.
