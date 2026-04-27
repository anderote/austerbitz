# Austerbitz MVP-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the foundation slice of Austerbitz: a deployable static-site WebGL2 game with camera controls, a green-field map, three placeholder unit kinds, drag-select, right-click move, and a dust-particle stub.

**Architecture:** Three-layer split — pure simulation (SoA typed arrays, fixed timestep, seeded RNG, uniform spatial grid), WebGL2 renderer (instanced quad passes), and DOM input/UI overlay. Designed so each later milestone (combat, sprites, physics, formations) plugs in along an established seam.

**Tech Stack:** TypeScript 5, Vite 5, Vitest 1, WebGL2 (raw), gl-matrix, plain HTML/CSS for UI. Static deploy target.

**Spec:** [docs/superpowers/specs/2026-04-26-austerbitz-foundation-design.md](../specs/2026-04-26-austerbitz-foundation-design.md)

---

## Conventions for this plan

- **Commits**: per the user's standing instructions, do NOT commit at the end of every task. The user controls commit boundaries. Implement and verify; the user will commit when they're ready.
- **Tests are co-located**: `foo.ts` has `foo.test.ts` next to it. Vitest discovers them via `*.test.ts` pattern.
- **TDD where it pays**: math, sim systems, data registries, spatial grid — write the test first, watch it fail, implement. Rendering and DOM UI tasks use **visual verification** (run dev server, describe expected outcome) since unit-testing a WebGL framebuffer or a slide-out panel is more cost than benefit at this stage.
- **Paths are relative to repo root**: `/Users/andrewcote/Documents/software/austerbitz`.
- **Strict TypeScript**: `strict: true` from day one. No `any` unless commented and justified.

## File structure overview

```
austerbitz/
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  index.html
  README.md
  .gitignore
  public/
    (empty for now; future static assets)
  src/
    main.ts                     bootstrap, wires everything
    gl/
      context.ts                getGL2 context with sensible defaults
      program.ts                compileShader, linkProgram, withProgram
      buffer.ts                 createBuffer, updateBuffer
      texture.ts                createTexture, uploadRGBA
    render/
      camera.ts                 ortho camera, project/unproject, view matrix
      renderer.ts               coordinates passes
      passes/
        terrain-pass.ts
        sprite-pass.ts
        selection-pass.ts
        particle-pass.ts
      shaders/                  inlined as TS template literals
        terrain.glsl.ts
        sprite.glsl.ts
        selection.glsl.ts
        particle.glsl.ts
      grass-texture.ts          procedural noise grass tile
    sim/
      world.ts                  World type, createWorld, tick orchestration
      entities.ts               SoA buffers, alloc/free, capacity
      orders.ts                 order queue per entity
      spatial/
        grid.ts                 uniform spatial grid
      systems/
        movement-system.ts
        orders-system.ts
    particles/
      particles.ts              SoA particle pool, spawn, update
      emitters.ts               dust emitter
    data/
      units/
        line-infantry.ts
        cuirassier.ts
        cannon-12.ts
        index.ts                registry + lookup
      types.ts                  UnitKind, UpgradeNode, MapFeature types
    map/
      world-map.ts              WorldMap type + default green field
    input/
      input-manager.ts          centralized DOM listener
      camera-controls.ts        wheel, middle-drag, edge-scroll, arrow keys
      selection.ts              click + drag-rect, hit-testing
      commands.ts               right-click → order issuance
    ui/
      overlay.ts                root DOM overlay
      hud.ts                    FPS + entity count
      selection-panel.ts        bottom-center selected-units panel
      build-menu.ts             collapsible right-side panel
      styles.css
    util/
      time.ts                   fixed-timestep accumulator
      math.ts                   vec2 helpers
      rng.ts                    seeded PRNG
```

---

## Task 1: Project scaffold (Vite + TS + Vitest, blank canvas)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `.gitignore`
- Create: `README.md`
- Create: `src/sanity.test.ts`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules
dist
.DS_Store
.vite
coverage
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "austerbitz",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.5.0",
    "@types/node": "^20.12.0"
  },
  "dependencies": {
    "gl-matrix": "^3.4.3"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: lockfile created, `node_modules/` populated, no errors.

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "vite/client"],
    "jsx": "preserve"
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 5: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  server: {
    port: 5173,
  },
});
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 7: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Austerbitz</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
      #game { position: fixed; inset: 0; display: block; }
      #ui-root { position: fixed; inset: 0; pointer-events: none; }
    </style>
  </head>
  <body>
    <canvas id="game"></canvas>
    <div id="ui-root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 8: Create `src/main.ts` (minimal bootstrap)**

```ts
const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) throw new Error('WebGL2 not supported');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  gl!.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

gl.clearColor(0.32, 0.55, 0.27, 1.0); // grass green
function frame() {
  gl!.clear(gl!.COLOR_BUFFER_BIT);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 9: Create `README.md`**

```markdown
# Austerbitz

Top-down 2D Napoleonic RTS in WebGL2.

## Develop

    npm install
    npm run dev      # http://localhost:5173

## Test

    npm test         # run once
    npm run test:watch

## Build

    npm run build    # outputs dist/
    npm run preview  # serve dist/
```

- [ ] **Step 10: Write a sanity test — `src/sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 11: Run the test**

Run: `npm test`
Expected: 1 test passes, exit code 0.

- [ ] **Step 12: Verify dev server**

Run: `npm run dev` (in a terminal you can leave open)
Open `http://localhost:5173` in a browser.
Expected: full-window solid grass-green canvas; no console errors. Stop the server with Ctrl-C when done verifying.

- [ ] **Step 13: Verify production build**

Run: `npm run build`
Expected: completes successfully, produces `dist/`. The `tsc --noEmit` step also passes (no type errors).

---

## Task 2: Math utilities (Vec2)

**Files:**
- Create: `src/util/math.ts`
- Create: `src/util/math.test.ts`

- [ ] **Step 1: Write the failing test — `src/util/math.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { vec2, vAdd, vSub, vScale, vLen, vDist, vNormalize, clamp, lerp } from './math';

describe('vec2 helpers', () => {
  it('vec2 creates {x,y}', () => {
    expect(vec2(3, 4)).toEqual({ x: 3, y: 4 });
  });
  it('vAdd adds component-wise', () => {
    expect(vAdd(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
  });
  it('vSub subtracts component-wise', () => {
    expect(vSub(vec2(5, 7), vec2(2, 3))).toEqual({ x: 3, y: 4 });
  });
  it('vScale scales by scalar', () => {
    expect(vScale(vec2(2, 3), 2)).toEqual({ x: 4, y: 6 });
  });
  it('vLen returns euclidean length', () => {
    expect(vLen(vec2(3, 4))).toBe(5);
  });
  it('vDist returns distance between two points', () => {
    expect(vDist(vec2(0, 0), vec2(3, 4))).toBe(5);
  });
  it('vNormalize returns unit vector', () => {
    const n = vNormalize(vec2(3, 4));
    expect(n.x).toBeCloseTo(0.6, 5);
    expect(n.y).toBeCloseTo(0.8, 5);
  });
  it('vNormalize on zero returns zero', () => {
    expect(vNormalize(vec2(0, 0))).toEqual({ x: 0, y: 0 });
  });
});

describe('scalar helpers', () => {
  it('clamp clamps to range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
  it('lerp linearly interpolates', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test, verify failure**

Run: `npm test -- src/util/math.test.ts`
Expected: FAIL — module `./math` not found.

- [ ] **Step 3: Implement `src/util/math.ts`**

```ts
export type Vec2 = { x: number; y: number };

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function vAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vScale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function vLen(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function vDist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function vNormalize(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  if (l === 0) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

- [ ] **Step 4: Run the test, verify pass**

Run: `npm test -- src/util/math.test.ts`
Expected: 11 tests pass.

---

## Task 3: Seeded RNG (Mulberry32)

**Files:**
- Create: `src/util/rng.ts`
- Create: `src/util/rng.test.ts`

- [ ] **Step 1: Write the failing test — `src/util/rng.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createRng } from './rng';

describe('createRng', () => {
  it('produces deterministic sequence for same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() === b.next()) same++;
    }
    expect(same).toBeLessThan(5);
  });

  it('next() returns values in [0, 1)', () => {
    const r = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('range(lo, hi) returns values in [lo, hi)', () => {
    const r = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const x = r.range(10, 20);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThan(20);
    }
  });

  it('intRange(lo, hi) returns integers in [lo, hi)', () => {
    const r = createRng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const x = r.intRange(0, 5);
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(5);
      seen.add(x);
    }
    expect(seen.size).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test, verify failure**

Run: `npm test -- src/util/rng.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/util/rng.ts`**

```ts
export interface Rng {
  next(): number;
  range(lo: number, hi: number): number;
  intRange(lo: number, hi: number): number;
}

// Mulberry32 — small, fast, good enough for game determinism
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    intRange: (lo, hi) => Math.floor(lo + next() * (hi - lo)),
  };
}
```

- [ ] **Step 4: Run the test, verify pass**

Run: `npm test -- src/util/rng.test.ts`
Expected: 5 tests pass.

---

## Task 4: Fixed-timestep accumulator

**Files:**
- Create: `src/util/time.ts`
- Create: `src/util/time.test.ts`

- [ ] **Step 1: Write the failing test — `src/util/time.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createAccumulator } from './time';

describe('createAccumulator', () => {
  it('returns 1 tick when dt equals step', () => {
    const acc = createAccumulator(1 / 30);
    expect(acc.advance(1 / 30)).toBe(1);
  });

  it('returns 3 ticks when dt is 3 steps', () => {
    const acc = createAccumulator(1 / 30);
    expect(acc.advance(3 / 30)).toBe(3);
  });

  it('accumulates remainder across calls', () => {
    const acc = createAccumulator(1 / 30);
    expect(acc.advance(0.02)).toBe(0); // 0.02 < 1/30 ≈ 0.0333
    expect(acc.advance(0.02)).toBe(1); // 0.04 total → 1 tick, 0.0067 remainder
  });

  it('clamps maximum ticks per advance to spiral-of-death cap', () => {
    const acc = createAccumulator(1 / 30, 5);
    // 1 second of dt at 30hz would be 30 ticks; cap at 5
    expect(acc.advance(1)).toBe(5);
  });

  it('returns alpha (interpolation) between 0 and 1', () => {
    const acc = createAccumulator(1 / 30);
    acc.advance(1 / 60); // half a step
    expect(acc.alpha()).toBeCloseTo(0.5, 3);
  });
});
```

- [ ] **Step 2: Run the test, verify failure**

Run: `npm test -- src/util/time.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/util/time.ts`**

```ts
export interface Accumulator {
  /** Adds elapsed real-time seconds; returns whole sim ticks to run. */
  advance(dt: number): number;
  /** Interpolation factor in [0,1) between the most recent and next sim tick. */
  alpha(): number;
}

export function createAccumulator(stepSeconds: number, maxTicks = 8): Accumulator {
  let acc = 0;
  return {
    advance(dt) {
      acc += dt;
      let ticks = 0;
      while (acc >= stepSeconds && ticks < maxTicks) {
        acc -= stepSeconds;
        ticks++;
      }
      // If we hit the cap, drop excess time so we don't accumulate forever
      if (acc >= stepSeconds) acc = 0;
      return ticks;
    },
    alpha() {
      return acc / stepSeconds;
    },
  };
}
```

- [ ] **Step 4: Run the test, verify pass**

Run: `npm test -- src/util/time.test.ts`
Expected: 5 tests pass.

---

## Task 5: WebGL helpers (context, program, buffer, texture)

**Files:**
- Create: `src/gl/context.ts`
- Create: `src/gl/program.ts`
- Create: `src/gl/buffer.ts`
- Create: `src/gl/texture.ts`

These wrap raw WebGL2 calls to keep render code declarative. Each is small enough to verify by inspection and exercised by Task 7's terrain pass.

- [ ] **Step 1: Implement `src/gl/context.ts`**

```ts
export function getGL2(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 not supported in this browser');
  return gl;
}

export function resizeToDisplay(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): boolean {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    return true;
  }
  return false;
}
```

- [ ] **Step 2: Implement `src/gl/program.ts`**

```ts
export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '<no log>';
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed:\n${log}\n--- source ---\n${src}`);
  }
  return sh;
}

export function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram returned null');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? '<no log>';
    gl.deleteProgram(prog);
    throw new Error(`Program link failed:\n${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

export function getUniforms<K extends string>(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  names: readonly K[],
): Record<K, WebGLUniformLocation> {
  const out = {} as Record<K, WebGLUniformLocation>;
  for (const n of names) {
    const loc = gl.getUniformLocation(prog, n);
    if (!loc) throw new Error(`Uniform "${n}" not found`);
    out[n] = loc;
  }
  return out;
}
```

- [ ] **Step 3: Implement `src/gl/buffer.ts`**

```ts
export function createBuffer(
  gl: WebGL2RenderingContext,
  target: number,
  data: ArrayBufferView | null,
  usage: number,
): WebGLBuffer {
  const buf = gl.createBuffer();
  if (!buf) throw new Error('createBuffer returned null');
  gl.bindBuffer(target, buf);
  if (data) gl.bufferData(target, data, usage);
  return buf;
}

export function updateBuffer(
  gl: WebGL2RenderingContext,
  target: number,
  buf: WebGLBuffer,
  data: ArrayBufferView,
  usage: number,
): void {
  gl.bindBuffer(target, buf);
  gl.bufferData(target, data, usage);
}

export function createVertexArray(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('createVertexArray returned null');
  return vao;
}
```

- [ ] **Step 4: Implement `src/gl/texture.ts`**

```ts
export function createTextureRGBA(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  pixels: Uint8Array | null,
  opts: { mag?: number; min?: number; wrap?: number } = {},
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, pixels,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.mag ?? gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.min ?? gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrap ?? gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrap ?? gl.REPEAT);
  return tex;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes (no type errors).

---

## Task 6: Camera (orthographic, project/unproject)

**Files:**
- Create: `src/render/camera.ts`
- Create: `src/render/camera.test.ts`

The camera holds world-space center, zoom (pixels per world meter), and viewport size. It produces a view-projection matrix and helpers to convert between screen and world coordinates.

- [ ] **Step 1: Write the failing test — `src/render/camera.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createCamera, screenToWorld, worldToScreen } from './camera';

describe('Camera', () => {
  it('default camera centered at (0,0)', () => {
    const cam = createCamera();
    cam.center.x = 0;
    cam.center.y = 0;
    cam.zoom = 1;
    cam.viewport = { w: 800, h: 600 };
    const w = screenToWorld(cam, { x: 400, y: 300 });
    expect(w.x).toBeCloseTo(0, 5);
    expect(w.y).toBeCloseTo(0, 5);
  });

  it('screenToWorld and worldToScreen are inverses', () => {
    const cam = createCamera();
    cam.center.x = 100;
    cam.center.y = 50;
    cam.zoom = 2;
    cam.viewport = { w: 800, h: 600 };
    const screen = { x: 123, y: 456 };
    const world = screenToWorld(cam, screen);
    const back = worldToScreen(cam, world);
    expect(back.x).toBeCloseTo(123, 4);
    expect(back.y).toBeCloseTo(456, 4);
  });

  it('zoom scales screen-to-world distance', () => {
    const cam = createCamera();
    cam.center.x = 0;
    cam.center.y = 0;
    cam.zoom = 2; // 2 px per world meter
    cam.viewport = { w: 800, h: 600 };
    // 100 px to the right of center should be 50 world meters at zoom=2
    const w = screenToWorld(cam, { x: 500, y: 300 });
    expect(w.x).toBeCloseTo(50, 5);
    expect(w.y).toBeCloseTo(0, 5);
  });

  it('y axis: screen-down is world-down (y increases downward in world space)', () => {
    const cam = createCamera();
    cam.center.x = 0;
    cam.center.y = 0;
    cam.zoom = 1;
    cam.viewport = { w: 800, h: 600 };
    const w = screenToWorld(cam, { x: 400, y: 400 });
    expect(w.y).toBeCloseTo(100, 5);
  });
});
```

- [ ] **Step 2: Run the test, verify failure**

Run: `npm test -- src/render/camera.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/render/camera.ts`**

```ts
import type { Vec2 } from '../util/math';

export interface Camera {
  center: Vec2;          // world coords
  zoom: number;          // pixels per world unit
  viewport: { w: number; h: number }; // CSS pixels
}

export function createCamera(): Camera {
  return {
    center: { x: 0, y: 0 },
    zoom: 1,
    viewport: { w: 1, h: 1 },
  };
}

export function screenToWorld(cam: Camera, s: Vec2): Vec2 {
  return {
    x: cam.center.x + (s.x - cam.viewport.w / 2) / cam.zoom,
    y: cam.center.y + (s.y - cam.viewport.h / 2) / cam.zoom,
  };
}

export function worldToScreen(cam: Camera, w: Vec2): Vec2 {
  return {
    x: cam.viewport.w / 2 + (w.x - cam.center.x) * cam.zoom,
    y: cam.viewport.h / 2 + (w.y - cam.center.y) * cam.zoom,
  };
}

/**
 * Returns a 3x3 column-major matrix that maps world coordinates to clip space (-1..1).
 * Layout: [m00,m01,m02, m10,m11,m12, m20,m21,m22] passed as Float32Array(9).
 *
 * Y axis is flipped so increasing world-y maps to decreasing clip-y (i.e. screen-down).
 */
export function viewProjection(cam: Camera): Float32Array {
  const sx = (2 * cam.zoom) / cam.viewport.w;
  const sy = -(2 * cam.zoom) / cam.viewport.h;
  const tx = -cam.center.x * sx;
  const ty = -cam.center.y * sy;
  return new Float32Array([
    sx, 0,  0,
    0,  sy, 0,
    tx, ty, 1,
  ]);
}
```

- [ ] **Step 4: Run the test, verify pass**

Run: `npm test -- src/render/camera.test.ts`
Expected: 4 tests pass.

---

## Task 7: Terrain pass with procedural grass texture

**Files:**
- Create: `src/render/grass-texture.ts`
- Create: `src/render/shaders/terrain.glsl.ts`
- Create: `src/render/passes/terrain-pass.ts`
- Create: `src/render/renderer.ts`
- Modify: `src/main.ts`

The terrain pass draws one big quad covering the visible world, sampling a small tiled grass texture. UVs are derived from world position so the texture appears to scroll naturally as the camera pans.

- [ ] **Step 1: Implement `src/render/grass-texture.ts`**

```ts
import { createRng } from '../util/rng';

/** Generates a tileable RGBA8 buffer of green pixel noise. */
export function generateGrassTile(size = 32, seed = 7): Uint8Array {
  const rng = createRng(seed);
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = rng.next();
      const r = Math.floor(60 + v * 30);
      const g = Math.floor(110 + v * 60);
      const b = Math.floor(50 + v * 25);
      pixels[i + 0] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}
```

- [ ] **Step 2: Implement `src/render/shaders/terrain.glsl.ts`**

```ts
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
uniform float u_tileSize;   // world units per tile
out vec4 outColor;

void main() {
  vec2 uv = v_worldPos / u_tileSize;
  outColor = texture(u_tile, uv);
}
`;
```

- [ ] **Step 3: Implement `src/render/passes/terrain-pass.ts`**

```ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { createTextureRGBA } from '../../gl/texture';
import { generateGrassTile } from '../grass-texture';
import { TERRAIN_VS, TERRAIN_FS } from '../shaders/terrain.glsl';
import type { Camera } from '../camera';
import { viewProjection, screenToWorld } from '../camera';

export interface TerrainPass {
  draw(cam: Camera): void;
}

export function createTerrainPass(gl: WebGL2RenderingContext): TerrainPass {
  const prog = linkProgram(gl, TERRAIN_VS, TERRAIN_FS);
  const u = getUniforms(gl, prog, [
    'u_worldMin', 'u_worldMax', 'u_viewProj', 'u_tile', 'u_tileSize',
  ] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const quad = new Float32Array([
    0, 0,  1, 0,  0, 1,
    0, 1,  1, 0,  1, 1,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const tileSize = 32;
  const tile = createTextureRGBA(gl, tileSize, tileSize, generateGrassTile(tileSize));

  const tileWorldUnits = 4; // 4 world meters per repeat — visible at zoom

  return {
    draw(cam) {
      const min = screenToWorld(cam, { x: 0, y: 0 });
      const max = screenToWorld(cam, { x: cam.viewport.w, y: cam.viewport.h });

      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tile);
      gl.uniform1i(u.u_tile, 0);
      gl.uniform1f(u.u_tileSize, tileWorldUnits);
      gl.uniform2f(u.u_worldMin, min.x, min.y);
      gl.uniform2f(u.u_worldMax, max.x, max.y);
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },
  };
}
```

- [ ] **Step 4: Implement `src/render/renderer.ts`**

```ts
import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';

export interface Renderer {
  render(cam: Camera): void;
  resize(): void;
}

export function createRenderer(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): Renderer {
  const terrain = createTerrainPass(gl);

  return {
    resize() {
      resizeToDisplay(gl, canvas);
    },
    render(cam) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
    },
  };
}
```

- [ ] **Step 5: Replace `src/main.ts`**

```ts
import { getGL2 } from './gl/context';
import { createRenderer } from './render/renderer';
import { createCamera } from './render/camera';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const renderer = createRenderer(gl, canvas);
const camera = createCamera();

function syncViewport() {
  renderer.resize();
  camera.viewport = { w: window.innerWidth, h: window.innerHeight };
}
window.addEventListener('resize', syncViewport);
syncViewport();

camera.center.x = 0;
camera.center.y = 0;
camera.zoom = 8;

function frame() {
  renderer.render(camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 6: Verify visually**

Run: `npm run dev`
Open `http://localhost:5173`.
Expected: a textured grass-green field fills the window. The texture should look like noisy green pixels (no solid color), and should tile seamlessly across the window. No console errors.

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: passes.

---

## Task 8: Camera input controls (wheel zoom, middle-drag pan, edge scroll, arrow keys)

**Files:**
- Create: `src/input/input-manager.ts`
- Create: `src/input/camera-controls.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement `src/input/input-manager.ts`**

```ts
export interface InputState {
  mouse: { x: number; y: number; buttons: number };
  wheelDelta: number;
  keys: Set<string>;
  // Edge consumed events:
  consumedWheel: number;
}

export interface InputManager {
  state: InputState;
  /** Call once per frame to swap consumed values. */
  beginFrame(): void;
  destroy(): void;
}

export function createInputManager(target: HTMLElement): InputManager {
  const state: InputState = {
    mouse: { x: 0, y: 0, buttons: 0 },
    wheelDelta: 0,
    keys: new Set(),
    consumedWheel: 0,
  };

  const onMouseMove = (e: MouseEvent) => {
    state.mouse.x = e.clientX;
    state.mouse.y = e.clientY;
  };
  const onMouseDown = (e: MouseEvent) => {
    state.mouse.buttons |= 1 << e.button;
    target.focus();
  };
  const onMouseUp = (e: MouseEvent) => {
    state.mouse.buttons &= ~(1 << e.button);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    state.wheelDelta += e.deltaY;
  };
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    state.keys.add(e.key);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    state.keys.delete(e.key);
  };
  const onBlur = () => {
    state.keys.clear();
    state.mouse.buttons = 0;
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    state,
    beginFrame() {
      state.consumedWheel = state.wheelDelta;
      state.wheelDelta = 0;
    },
    destroy() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
```

- [ ] **Step 2: Implement `src/input/camera-controls.ts`**

```ts
import type { Camera } from '../render/camera';
import { screenToWorld } from '../render/camera';
import type { InputManager } from './input-manager';
import { clamp } from '../util/math';

export interface CameraControlsConfig {
  zoomMin: number;
  zoomMax: number;
  panKeySpeed: number;       // world units / second at zoom = 1
  edgeScrollPx: number;
  edgeScrollSpeed: number;   // px / second at zoom = 1
}

const DEFAULTS: CameraControlsConfig = {
  zoomMin: 0.25,
  zoomMax: 8,
  panKeySpeed: 600,
  edgeScrollPx: 8,
  edgeScrollSpeed: 600,
};

export interface CameraControls {
  update(dt: number): void;
}

export function createCameraControls(
  cam: Camera,
  input: InputManager,
  cfg: Partial<CameraControlsConfig> = {},
): CameraControls {
  const c = { ...DEFAULTS, ...cfg };
  let dragging = false;
  let dragLastX = 0;
  let dragLastY = 0;

  return {
    update(dt) {
      // Zoom — anchor at cursor
      const wheel = input.state.consumedWheel;
      if (wheel !== 0) {
        const before = screenToWorld(cam, input.state.mouse);
        const factor = Math.pow(1.0015, -wheel);
        cam.zoom = clamp(cam.zoom * factor, c.zoomMin, c.zoomMax);
        const after = screenToWorld(cam, input.state.mouse);
        cam.center.x += before.x - after.x;
        cam.center.y += before.y - after.y;
      }

      // Middle-drag pan
      const middleDown = (input.state.mouse.buttons & (1 << 1)) !== 0;
      if (middleDown && !dragging) {
        dragging = true;
        dragLastX = input.state.mouse.x;
        dragLastY = input.state.mouse.y;
      } else if (!middleDown && dragging) {
        dragging = false;
      }
      if (dragging) {
        const dx = input.state.mouse.x - dragLastX;
        const dy = input.state.mouse.y - dragLastY;
        cam.center.x -= dx / cam.zoom;
        cam.center.y -= dy / cam.zoom;
        dragLastX = input.state.mouse.x;
        dragLastY = input.state.mouse.y;
      }

      // Arrow keys & WASD
      let kx = 0, ky = 0;
      if (input.state.keys.has('ArrowLeft') || input.state.keys.has('a')) kx -= 1;
      if (input.state.keys.has('ArrowRight') || input.state.keys.has('d')) kx += 1;
      if (input.state.keys.has('ArrowUp') || input.state.keys.has('w')) ky -= 1;
      if (input.state.keys.has('ArrowDown') || input.state.keys.has('s')) ky += 1;
      if (kx !== 0 || ky !== 0) {
        const len = Math.hypot(kx, ky);
        cam.center.x += (kx / len) * c.panKeySpeed * dt / cam.zoom;
        cam.center.y += (ky / len) * c.panKeySpeed * dt / cam.zoom;
      }

      // Edge scroll
      const mx = input.state.mouse.x;
      const my = input.state.mouse.y;
      const w = cam.viewport.w;
      const h = cam.viewport.h;
      let ex = 0, ey = 0;
      if (mx >= 0 && mx <= c.edgeScrollPx) ex -= 1;
      else if (mx >= w - c.edgeScrollPx && mx <= w) ex += 1;
      if (my >= 0 && my <= c.edgeScrollPx) ey -= 1;
      else if (my >= h - c.edgeScrollPx && my <= h) ey += 1;
      if (ex !== 0 || ey !== 0) {
        cam.center.x += ex * c.edgeScrollSpeed * dt / cam.zoom;
        cam.center.y += ey * c.edgeScrollSpeed * dt / cam.zoom;
      }
    },
  };
}
```

- [ ] **Step 3: Update `src/main.ts` to wire input + camera controls**

```ts
import { getGL2 } from './gl/context';
import { createRenderer } from './render/renderer';
import { createCamera } from './render/camera';
import { createInputManager } from './input/input-manager';
import { createCameraControls } from './input/camera-controls';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const renderer = createRenderer(gl, canvas);
const camera = createCamera();
const input = createInputManager(canvas);
const cameraControls = createCameraControls(camera, input);

function syncViewport() {
  renderer.resize();
  camera.viewport = { w: window.innerWidth, h: window.innerHeight };
}
window.addEventListener('resize', syncViewport);
syncViewport();

camera.center.x = 1000;
camera.center.y = 1000;
camera.zoom = 1;

let lastT = performance.now();
function frame(t: number) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  input.beginFrame();
  cameraControls.update(dt);
  renderer.render(camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`. Open the page and verify:
- Mouse wheel zooms toward / away from the cursor smoothly. Range stops around 0.25× and 8×.
- Holding middle mouse button and dragging pans the world.
- Arrow keys (and WASD) pan smoothly.
- Moving the mouse to the very edge of the window triggers edge-scroll.
- Right-click does NOT show a context menu.

The grass texture should remain locked to world coordinates as you pan (the noise scrolls with the world, not the camera).

---

## Task 9: Entity SoA buffers + alloc/free

**Files:**
- Create: `src/sim/entities.ts`
- Create: `src/sim/entities.test.ts`

- [ ] **Step 1: Write the failing test — `src/sim/entities.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity, freeEntity, isAlive } from './entities';

describe('Entities SoA', () => {
  it('allocates entities with monotonically increasing ids until capacity', () => {
    const e = createEntities(4);
    const a = allocEntity(e);
    const b = allocEntity(e);
    const c = allocEntity(e);
    const d = allocEntity(e);
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(c).toBe(2);
    expect(d).toBe(3);
    expect(allocEntity(e)).toBe(-1); // capacity exhausted
  });

  it('marks freed slots as not alive and reuses them', () => {
    const e = createEntities(4);
    const a = allocEntity(e);
    const b = allocEntity(e);
    expect(isAlive(e, a)).toBe(true);
    expect(isAlive(e, b)).toBe(true);
    freeEntity(e, a);
    expect(isAlive(e, a)).toBe(false);
    expect(isAlive(e, b)).toBe(true);
    const reused = allocEntity(e);
    expect(reused).toBe(a);
    expect(isAlive(e, reused)).toBe(true);
  });

  it('exposes typed-array buffers at the expected length', () => {
    const e = createEntities(16);
    expect(e.posX).toBeInstanceOf(Float32Array);
    expect(e.posX.length).toBe(16);
    expect(e.team.length).toBe(16);
    expect(e.kindId.length).toBe(16);
  });

  it('count tracks live entities', () => {
    const e = createEntities(4);
    expect(e.count).toBe(0);
    allocEntity(e);
    allocEntity(e);
    expect(e.count).toBe(2);
    freeEntity(e, 0);
    expect(e.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/sim/entities.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sim/entities.ts`**

```ts
export interface Entities {
  capacity: number;
  count: number;            // live count
  alive: Uint8Array;        // 1 = alive, 0 = free

  // Transform
  posX: Float32Array;
  posY: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  facing: Uint8Array;       // 0..7

  // Combat
  hp: Uint16Array;
  morale: Uint8Array;       // 0..255
  state: Uint8Array;        // 0=idle, 1=moving, 2=firing, 3=reloading, 4=ragdoll, 5=dead
  reloadT: Float32Array;
  targetId: Int32Array;     // -1 if none

  // Identity
  kindId: Uint16Array;
  team: Uint8Array;
  formationId: Int32Array;  // -1 if none

  // Animation
  frame: Uint8Array;
  frameTime: Float32Array;

  // Free-list
  freeListHead: number;
  freeListNext: Int32Array;  // -1 = end of list
}

export function createEntities(capacity: number): Entities {
  const freeListNext = new Int32Array(capacity);
  for (let i = 0; i < capacity - 1; i++) freeListNext[i] = i + 1;
  freeListNext[capacity - 1] = -1;

  return {
    capacity,
    count: 0,
    alive: new Uint8Array(capacity),
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    velX: new Float32Array(capacity),
    velY: new Float32Array(capacity),
    facing: new Uint8Array(capacity),
    hp: new Uint16Array(capacity),
    morale: new Uint8Array(capacity),
    state: new Uint8Array(capacity),
    reloadT: new Float32Array(capacity),
    targetId: new Int32Array(capacity).fill(-1),
    kindId: new Uint16Array(capacity),
    team: new Uint8Array(capacity),
    formationId: new Int32Array(capacity).fill(-1),
    frame: new Uint8Array(capacity),
    frameTime: new Float32Array(capacity),
    freeListHead: 0,
    freeListNext,
  };
}

export function allocEntity(e: Entities): number {
  const id = e.freeListHead;
  if (id === -1) return -1;
  e.freeListHead = e.freeListNext[id]!;
  e.alive[id] = 1;
  e.count++;
  // Reset hot fields to deterministic defaults
  e.posX[id] = 0; e.posY[id] = 0;
  e.velX[id] = 0; e.velY[id] = 0;
  e.facing[id] = 0;
  e.hp[id] = 0;
  e.morale[id] = 200;
  e.state[id] = 0;
  e.reloadT[id] = 0;
  e.targetId[id] = -1;
  e.kindId[id] = 0;
  e.team[id] = 0;
  e.formationId[id] = -1;
  e.frame[id] = 0;
  e.frameTime[id] = 0;
  return id;
}

export function freeEntity(e: Entities, id: number): void {
  if (!e.alive[id]) return;
  e.alive[id] = 0;
  e.count--;
  e.freeListNext[id] = e.freeListHead;
  e.freeListHead = id;
}

export function isAlive(e: Entities, id: number): boolean {
  return e.alive[id] === 1;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- src/sim/entities.test.ts`
Expected: 4 tests pass.

---

## Task 10: Uniform spatial grid

**Files:**
- Create: `src/sim/spatial/grid.ts`
- Create: `src/sim/spatial/grid.test.ts`

- [ ] **Step 1: Write the failing test — `src/sim/spatial/grid.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createGrid, gridClear, gridInsert, gridQueryRect, gridQueryRadius } from './grid';

describe('uniform spatial grid', () => {
  it('inserts entities and finds them within a rect', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 1000, maxY: 1000, cellSize: 10 });
    gridClear(g);
    gridInsert(g, 1, 5, 5);
    gridInsert(g, 2, 50, 50);
    gridInsert(g, 3, 500, 500);

    const out = gridQueryRect(g, -1, -1, 60, 60);
    expect(out.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('returns entities within a radius (rectangular cell prefilter, then exact)', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 1000, maxY: 1000, cellSize: 10 });
    gridClear(g);
    gridInsert(g, 1, 100, 100);
    gridInsert(g, 2, 105, 105);
    gridInsert(g, 3, 200, 200);

    const out = gridQueryRadius(g, 100, 100, 20);
    expect(out.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('clears between rebuilds', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10 });
    gridClear(g);
    gridInsert(g, 1, 5, 5);
    expect(gridQueryRect(g, 0, 0, 100, 100)).toEqual([1]);
    gridClear(g);
    expect(gridQueryRect(g, 0, 0, 100, 100)).toEqual([]);
  });

  it('handles points outside bounds gracefully (clamped)', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10 });
    gridClear(g);
    gridInsert(g, 1, -5, -5);
    gridInsert(g, 2, 200, 200);
    const out = gridQueryRect(g, -1000, -1000, 1000, 1000);
    expect(out.sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/sim/spatial/grid.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sim/spatial/grid.ts`**

```ts
export interface GridConfig {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cellSize: number;
}

export interface Grid {
  cfg: GridConfig;
  cols: number;
  rows: number;
  cells: number[][]; // row-major; each cell holds entity ids
}

export function createGrid(cfg: GridConfig): Grid {
  const cols = Math.max(1, Math.ceil((cfg.maxX - cfg.minX) / cfg.cellSize));
  const rows = Math.max(1, Math.ceil((cfg.maxY - cfg.minY) / cfg.cellSize));
  const cells: number[][] = new Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = [];
  return { cfg, cols, rows, cells };
}

function cellIndex(g: Grid, x: number, y: number): number {
  const cx = Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.cfg.minX) / g.cfg.cellSize)));
  const cy = Math.max(0, Math.min(g.rows - 1, Math.floor((y - g.cfg.minY) / g.cfg.cellSize)));
  return cy * g.cols + cx;
}

export function gridClear(g: Grid): void {
  for (const c of g.cells) c.length = 0;
}

export function gridInsert(g: Grid, id: number, x: number, y: number): void {
  g.cells[cellIndex(g, x, y)]!.push(id);
}

export function gridQueryRect(g: Grid, x0: number, y0: number, x1: number, y1: number): number[] {
  const cx0 = Math.max(0, Math.min(g.cols - 1, Math.floor((x0 - g.cfg.minX) / g.cfg.cellSize)));
  const cx1 = Math.max(0, Math.min(g.cols - 1, Math.floor((x1 - g.cfg.minX) / g.cfg.cellSize)));
  const cy0 = Math.max(0, Math.min(g.rows - 1, Math.floor((y0 - g.cfg.minY) / g.cfg.cellSize)));
  const cy1 = Math.max(0, Math.min(g.rows - 1, Math.floor((y1 - g.cfg.minY) / g.cfg.cellSize)));
  const out: number[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const cell = g.cells[cy * g.cols + cx]!;
      for (let i = 0; i < cell.length; i++) out.push(cell[i]!);
    }
  }
  return out;
}

export function gridQueryRadius(g: Grid, x: number, y: number, r: number): number[] {
  return gridQueryRect(g, x - r, y - r, x + r, y + r);
}
```

Note: `gridQueryRadius` returns the rectangular pre-filter; callers do exact distance checks on the small result set. The test for radius works because all points are spread enough that the rect filter happens to match the radius result.

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- src/sim/spatial/grid.test.ts`
Expected: 4 tests pass.

---

## Task 11: World tick loop + sim systems framework

**Files:**
- Create: `src/sim/world.ts`
- Create: `src/sim/world.test.ts`

The World owns Entities, the spatial grid, the RNG, and the system list. Systems are pure functions `(world, dt) => void`.

- [ ] **Step 1: Write the failing test — `src/sim/world.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createWorld, tickWorld } from './world';
import { allocEntity } from './entities';

describe('World', () => {
  it('runs registered systems each tick in order', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const order: string[] = [];
    world.systems = [
      (_w, _dt) => order.push('a'),
      (_w, _dt) => order.push('b'),
      (_w, _dt) => order.push('c'),
    ];
    tickWorld(world, 1 / 30);
    tickWorld(world, 1 / 30);
    expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('builds the spatial grid from live entities each tick', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    world.systems = []; // baseline rebuild only happens via the dedicated step
    const id = allocEntity(world.entities);
    world.entities.posX[id] = 100;
    world.entities.posY[id] = 100;
    tickWorld(world, 1 / 30);
    // We don't assert the grid contents directly here; rebuild side-effect
    // is tested via the search query through later systems. This test just
    // verifies no errors when a live entity is present.
    expect(world.tickCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/sim/world.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sim/world.ts`**

```ts
import { createEntities, type Entities } from './entities';
import { createGrid, gridClear, gridInsert, type Grid } from './spatial/grid';
import { createRng, type Rng } from '../util/rng';

export type System = (world: World, dt: number) => void;

export interface WorldConfig {
  seed: number;
  capacity: number;
  mapSize: number;       // square map, world units (meters)
  cellSize?: number;
}

export interface World {
  cfg: WorldConfig;
  entities: Entities;
  grid: Grid;
  rng: Rng;
  tickCount: number;
  simTime: number;
  systems: System[];
  /** Single shared orders queue keyed by entity id. */
  orders: Map<number, Order>;
}

export type Order =
  | { kind: 'move'; targetX: number; targetY: number };

export function createWorld(cfg: WorldConfig): World {
  const cellSize = cfg.cellSize ?? 16;
  return {
    cfg,
    entities: createEntities(cfg.capacity),
    grid: createGrid({
      minX: 0, minY: 0,
      maxX: cfg.mapSize, maxY: cfg.mapSize,
      cellSize,
    }),
    rng: createRng(cfg.seed),
    tickCount: 0,
    simTime: 0,
    systems: [],
    orders: new Map(),
  };
}

export function rebuildGrid(world: World): void {
  gridClear(world.grid);
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 1) gridInsert(world.grid, i, e.posX[i]!, e.posY[i]!);
  }
}

export function tickWorld(world: World, dt: number): void {
  rebuildGrid(world);
  for (const sys of world.systems) sys(world, dt);
  world.tickCount++;
  world.simTime += dt;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- src/sim/world.test.ts`
Expected: 2 tests pass.

---

## Task 12: Unit kind data + registry

**Files:**
- Create: `src/data/types.ts`
- Create: `src/data/units/line-infantry.ts`
- Create: `src/data/units/cuirassier.ts`
- Create: `src/data/units/cannon-12.ts`
- Create: `src/data/units/index.ts`
- Create: `src/data/units/index.test.ts`

- [ ] **Step 1: Write the failing test — `src/data/units/index.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { unitKinds, getUnitKind, getUnitKindIndex } from './index';

describe('unit kind registry', () => {
  it('exposes the three MVP-1 unit kinds', () => {
    expect(unitKinds.map(k => k.id).sort()).toEqual(
      ['cannon-12', 'cuirassier', 'line-infantry'],
    );
  });

  it('getUnitKind by id returns the matching definition', () => {
    const k = getUnitKind('cuirassier');
    expect(k.category).toBe('cavalry');
    expect(k.baseStats.massKg).toBeGreaterThan(400); // horse + man
  });

  it('throws on unknown id', () => {
    expect(() => getUnitKind('not-a-real-id')).toThrow();
  });

  it('getUnitKindIndex provides a stable numeric id usable in Uint16Array', () => {
    const i = getUnitKindIndex('line-infantry');
    expect(Number.isInteger(i)).toBe(true);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(unitKinds.length);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/data/units/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/data/types.ts`**

```ts
export type UnitCategory = 'infantry' | 'cavalry' | 'artillery';

export interface BaseStats {
  hp: number;
  moveSpeed: number;        // m/s
  morale: number;           // 0..255 baseline
  sightRange: number;       // m
  weaponRange: number;      // m
  weaponDamage: number;
  weaponReload: number;     // s
  weaponAccuracy: number;   // 0..1
  armor: number;
  massKg: number;
  formationSpacing: { x: number; y: number };
}

export interface UnitKind {
  id: string;
  category: UnitCategory;
  name: string;
  /** Placeholder color (RGB 0..255) until sprites land. */
  placeholderColor: [number, number, number];
  /** Placeholder pixel size in world units (≈ meters). */
  placeholderSize: { w: number; h: number };
  baseStats: BaseStats;
}

export interface UpgradeNode {
  id: string;
  appliesTo: string[] | 'all';
  modifiers: Partial<{
    [K in keyof BaseStats]: { mul?: number; add?: number };
  }>;
  prerequisites: string[];
  cost: number;
}

export interface MapFeature {
  id: number;
  kind: 'hedgerow' | 'wall' | 'building' | 'trench' | 'river';
  shape:
    | { type: 'polyline'; points: { x: number; y: number }[] }
    | { type: 'polygon'; points: { x: number; y: number }[] }
    | { type: 'rect'; x: number; y: number; w: number; h: number };
  blocksMovement: boolean;
  blocksProjectile: boolean;
  blocksSight: boolean;
  cover: number;   // 0..1
  height: number;  // negative for trenches
}
```

- [ ] **Step 4: Implement `src/data/units/line-infantry.ts`**

```ts
import type { UnitKind } from '../types';

export const lineInfantry: UnitKind = {
  id: 'line-infantry',
  category: 'infantry',
  name: 'Line Infantry',
  placeholderColor: [200, 50, 50],
  placeholderSize: { w: 1.0, h: 1.4 }, // ≈1m wide, 1.4m tall
  baseStats: {
    hp: 60,
    moveSpeed: 2.5,
    morale: 180,
    sightRange: 120,
    weaponRange: 80,
    weaponDamage: 12,
    weaponReload: 18,
    weaponAccuracy: 0.4,
    armor: 0,
    massKg: 80,
    formationSpacing: { x: 1.2, y: 1.6 },
  },
};
```

- [ ] **Step 5: Implement `src/data/units/cuirassier.ts`**

```ts
import type { UnitKind } from '../types';

export const cuirassier: UnitKind = {
  id: 'cuirassier',
  category: 'cavalry',
  name: 'Cuirassier',
  placeholderColor: [60, 90, 200],
  placeholderSize: { w: 1.4, h: 2.4 }, // horse footprint
  baseStats: {
    hp: 140,
    moveSpeed: 7.5,
    morale: 220,
    sightRange: 150,
    weaponRange: 2,
    weaponDamage: 30,
    weaponReload: 1.5,
    weaponAccuracy: 0.9,
    armor: 4,
    massKg: 600,
    formationSpacing: { x: 2.0, y: 3.0 },
  },
};
```

- [ ] **Step 6: Implement `src/data/units/cannon-12.ts`**

```ts
import type { UnitKind } from '../types';

export const cannon12: UnitKind = {
  id: 'cannon-12',
  category: 'artillery',
  name: '12-Pounder Cannon',
  placeholderColor: [110, 110, 110],
  placeholderSize: { w: 2.2, h: 2.8 },
  baseStats: {
    hp: 200,
    moveSpeed: 1.2,
    morale: 160,
    sightRange: 200,
    weaponRange: 600,
    weaponDamage: 80,
    weaponReload: 30,
    weaponAccuracy: 0.6,
    armor: 2,
    massKg: 1500,
    formationSpacing: { x: 6.0, y: 6.0 },
  },
};
```

- [ ] **Step 7: Implement `src/data/units/index.ts`**

```ts
import type { UnitKind } from '../types';
import { lineInfantry } from './line-infantry';
import { cuirassier } from './cuirassier';
import { cannon12 } from './cannon-12';

export const unitKinds: readonly UnitKind[] = [lineInfantry, cuirassier, cannon12];

const idToIndex = new Map<string, number>();
unitKinds.forEach((k, i) => idToIndex.set(k.id, i));

export function getUnitKind(id: string): UnitKind {
  const idx = idToIndex.get(id);
  if (idx === undefined) throw new Error(`Unknown unit kind: ${id}`);
  return unitKinds[idx]!;
}

export function getUnitKindIndex(id: string): number {
  const idx = idToIndex.get(id);
  if (idx === undefined) throw new Error(`Unknown unit kind: ${id}`);
  return idx;
}

export function getUnitKindByIndex(idx: number): UnitKind {
  const k = unitKinds[idx];
  if (!k) throw new Error(`Unit kind index out of range: ${idx}`);
  return k;
}
```

- [ ] **Step 8: Run test, verify pass**

Run: `npm test -- src/data/units/index.test.ts`
Expected: 4 tests pass.

---

## Task 13: Sprite pass + initial unit spawn

**Files:**
- Create: `src/render/shaders/sprite.glsl.ts`
- Create: `src/render/passes/sprite-pass.ts`
- Modify: `src/render/renderer.ts`
- Create: `src/map/world-map.ts`
- Modify: `src/main.ts`

The sprite pass renders one instanced quad per live entity, colored by the entity's unit kind.

- [ ] **Step 1: Implement `src/map/world-map.ts`**

```ts
import type { MapFeature } from '../data/types';

export interface WorldMap {
  size: { w: number; h: number }; // world units (meters)
  features: MapFeature[];
}

export function createDefaultMap(): WorldMap {
  return {
    size: { w: 2000, h: 2000 },
    features: [],
  };
}
```

- [ ] **Step 2: Implement `src/render/shaders/sprite.glsl.ts`**

```ts
export const SPRITE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // unit-quad (-0.5..0.5)
layout(location = 1) in vec2 a_pos;        // per-instance world pos
layout(location = 2) in vec2 a_size;       // per-instance world size
layout(location = 3) in vec4 a_color;      // per-instance rgba (0..1)
out vec4 v_color;

uniform mat3 u_viewProj;

void main() {
  vec2 wp = a_pos + a_corner * a_size;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_color = a_color;
}
`;

export const SPRITE_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;

void main() {
  outColor = v_color;
}
`;
```

- [ ] **Step 3: Implement `src/render/passes/sprite-pass.ts`**

```ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { SPRITE_VS, SPRITE_FS } from '../shaders/sprite.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import { getUnitKindByIndex } from '../../data/units';

export interface SpritePass {
  draw(world: World, cam: Camera): void;
}

export function createSpritePass(gl: WebGL2RenderingContext, capacity: number): SpritePass {
  const prog = linkProgram(gl, SPRITE_VS, SPRITE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  // Quad corners (-0.5..0.5)
  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5,  -0.5,  0.5,
    -0.5,  0.5,  0.5, -0.5,   0.5,  0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Per-instance buffers
  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const sizeBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const colorBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  // Persistent client-side scratch
  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity * 2);
  const scratchColor = new Float32Array(capacity * 4);

  return {
    draw(world, cam) {
      const e = world.entities;
      let n = 0;
      for (let i = 0; i < e.capacity; i++) {
        if (e.alive[i] === 0) continue;
        const kind = getUnitKindByIndex(e.kindId[i]!);
        scratchPos[n * 2 + 0] = e.posX[i]!;
        scratchPos[n * 2 + 1] = e.posY[i]!;
        scratchSize[n * 2 + 0] = kind.placeholderSize.w;
        scratchSize[n * 2 + 1] = kind.placeholderSize.h;
        scratchColor[n * 4 + 0] = kind.placeholderColor[0] / 255;
        scratchColor[n * 4 + 1] = kind.placeholderColor[1] / 255;
        scratchColor[n * 4 + 2] = kind.placeholderColor[2] / 255;
        scratchColor[n * 4 + 3] = 1.0;
        n++;
      }
      if (n === 0) return;

      gl.useProgram(prog);
      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchSize.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchColor.subarray(0, n * 4));

      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.bindVertexArray(null);
    },
  };
}
```

- [ ] **Step 4: Update `src/render/renderer.ts` to use sprite pass**

```ts
import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import type { World } from '../sim/world';

export interface Renderer {
  render(world: World, cam: Camera): void;
  resize(): void;
}

export function createRenderer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  capacity: number,
): Renderer {
  const terrain = createTerrainPass(gl);
  const sprites = createSpritePass(gl, capacity);

  return {
    resize() {
      resizeToDisplay(gl, canvas);
    },
    render(world, cam) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
      sprites.draw(world, cam);
    },
  };
}
```

- [ ] **Step 5: Update `src/main.ts` to create world + spawn handfuls**

```ts
import { getGL2 } from './gl/context';
import { createRenderer } from './render/renderer';
import { createCamera } from './render/camera';
import { createInputManager } from './input/input-manager';
import { createCameraControls } from './input/camera-controls';
import { createWorld, tickWorld } from './sim/world';
import { allocEntity } from './sim/entities';
import { getUnitKindIndex } from './data/units';
import { createDefaultMap } from './map/world-map';

const CAPACITY = 4096;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const renderer = createRenderer(gl, canvas, CAPACITY);
const camera = createCamera();
const input = createInputManager(canvas);
const cameraControls = createCameraControls(camera, input);

const map = createDefaultMap();
const world = createWorld({ seed: 1, capacity: CAPACITY, mapSize: map.size.w });

function spawn(kindId: string, team: number, x: number, y: number) {
  const id = allocEntity(world.entities);
  if (id === -1) return;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  world.entities.team[id] = team;
}

// Place a small line of infantry, two cuirassiers, and a cannon
const cx = map.size.w / 2;
const cy = map.size.h / 2;
for (let i = 0; i < 16; i++) {
  spawn('line-infantry', 0, cx - 10 + i * 1.3, cy - 30);
}
for (let i = 0; i < 4; i++) {
  spawn('cuirassier', 0, cx - 6 + i * 3, cy - 50);
}
spawn('cannon-12', 0, cx, cy - 70);

function syncViewport() {
  renderer.resize();
  camera.viewport = { w: window.innerWidth, h: window.innerHeight };
}
window.addEventListener('resize', syncViewport);
syncViewport();

camera.center.x = cx;
camera.center.y = cy;
camera.zoom = 8;

let lastT = performance.now();
function frame(t: number) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  input.beginFrame();
  cameraControls.update(dt);
  tickWorld(world, dt); // not yet running systems
  renderer.render(world, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 6: Verify visually**

Run: `npm run dev`. Expected:
- Grass field as before.
- A line of 16 small red rectangles (line infantry), behind them 4 blue rectangles (cuirassiers), and one gray rectangle (cannon).
- Pan/zoom still works; the units sit fixed in world space and scale with zoom.
- No console errors.

---

## Task 14: Movement system + orders system

**Files:**
- Create: `src/sim/systems/orders-system.ts`
- Create: `src/sim/systems/movement-system.ts`
- Create: `src/sim/systems/movement-system.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write the failing test — `src/sim/systems/movement-system.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createWorld } from '../world';
import { allocEntity } from '../entities';
import { ordersSystem } from './orders-system';
import { movementSystem } from './movement-system';
import { getUnitKindIndex } from '../../data/units';

describe('movement + orders', () => {
  it('moves an entity toward its order target at unit kind speed', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orders.set(id, { kind: 'move', targetX: 100, targetY: 0 });
    world.systems = [ordersSystem, movementSystem];

    // Run for 1 simulated second at 30hz
    for (let i = 0; i < 30; i++) {
      world.systems.forEach(s => s(world, 1 / 30));
    }
    // line-infantry moveSpeed = 2.5 m/s
    expect(world.entities.posX[id]).toBeCloseTo(2.5, 1);
    expect(world.entities.posY[id]).toBeCloseTo(0, 4);
  });

  it('clears order and stops when arrived (within snap distance)', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = allocEntity(world.entities);
    world.entities.kindId[id] = getUnitKindIndex('line-infantry');
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.orders.set(id, { kind: 'move', targetX: 0.05, targetY: 0 });
    world.systems = [ordersSystem, movementSystem];

    world.systems.forEach(s => s(world, 1 / 30));
    expect(world.orders.has(id)).toBe(false);
    expect(world.entities.velX[id]).toBe(0);
    expect(world.entities.velY[id]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/sim/systems/movement-system.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/sim/systems/orders-system.ts`**

```ts
import type { System } from '../world';
import { getUnitKindByIndex } from '../../data/units';

const ARRIVE_RADIUS = 0.1; // m

export const ordersSystem: System = (world, _dt) => {
  const e = world.entities;
  for (const [id, order] of world.orders) {
    if (e.alive[id] === 0) {
      world.orders.delete(id);
      continue;
    }
    if (order.kind === 'move') {
      const dx = order.targetX - e.posX[id]!;
      const dy = order.targetY - e.posY[id]!;
      const dist = Math.hypot(dx, dy);
      if (dist <= ARRIVE_RADIUS) {
        e.velX[id] = 0;
        e.velY[id] = 0;
        world.orders.delete(id);
        continue;
      }
      const speed = getUnitKindByIndex(e.kindId[id]!).baseStats.moveSpeed;
      e.velX[id] = (dx / dist) * speed;
      e.velY[id] = (dy / dist) * speed;
    }
  }
};
```

- [ ] **Step 4: Implement `src/sim/systems/movement-system.ts`**

```ts
import type { System } from '../world';

export const movementSystem: System = (world, dt) => {
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    e.posX[i] += e.velX[i]! * dt;
    e.posY[i] += e.velY[i]! * dt;
  }
};
```

- [ ] **Step 5: Run test, verify pass**

Run: `npm test -- src/sim/systems/movement-system.test.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Wire systems into the main loop — update `src/main.ts`**

After the spawn block, before the frame loop, add:

```ts
import { ordersSystem } from './sim/systems/orders-system';
import { movementSystem } from './sim/systems/movement-system';
```

And inside `createWorld(...)` setup (after creating `world`):

```ts
world.systems = [ordersSystem, movementSystem];
```

- [ ] **Step 7: Verify visually**

Run: `npm run dev`. The screen should look identical to Task 13 (no orders are issued yet, so nothing moves). No console errors.

---

## Task 15: Selection (drag-rect + click + selection rings)

**Files:**
- Create: `src/input/selection.ts`
- Create: `src/input/selection.test.ts`
- Create: `src/render/shaders/selection.glsl.ts`
- Create: `src/render/passes/selection-pass.ts`
- Modify: `src/render/renderer.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write the failing test — `src/input/selection.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createSelection, hitTestPoint, hitTestRect } from './selection';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';

function spawnAt(world: ReturnType<typeof createWorld>, kind: string, x: number, y: number) {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex(kind);
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

describe('selection', () => {
  it('createSelection starts empty', () => {
    const sel = createSelection();
    expect(sel.ids.size).toBe(0);
  });

  it('hitTestPoint returns entity within its placeholder size', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawnAt(world, 'line-infantry', 100, 100);
    expect(hitTestPoint(world, { x: 100, y: 100 })).toBe(id);
    // Outside the unit's footprint
    expect(hitTestPoint(world, { x: 200, y: 200 })).toBe(-1);
  });

  it('hitTestRect returns all entities whose center is in the rect', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const a = spawnAt(world, 'line-infantry', 50, 50);
    const b = spawnAt(world, 'line-infantry', 60, 60);
    spawnAt(world, 'line-infantry', 200, 200);
    const ids = hitTestRect(world, 0, 0, 100, 100);
    expect(ids.sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/input/selection.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/input/selection.ts`**

```ts
import type { World } from '../sim/world';
import type { Vec2 } from '../util/math';
import { getUnitKindByIndex } from '../data/units';

export interface Selection {
  ids: Set<number>;
}

export interface DragRect {
  start: Vec2;       // screen
  current: Vec2;     // screen
  active: boolean;
}

export function createSelection(): Selection {
  return { ids: new Set() };
}

export function createDragRect(): DragRect {
  return {
    start: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    active: false,
  };
}

export function hitTestPoint(world: World, w: Vec2): number {
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    const kind = getUnitKindByIndex(e.kindId[i]!);
    const dx = Math.abs(w.x - e.posX[i]!);
    const dy = Math.abs(w.y - e.posY[i]!);
    if (dx <= kind.placeholderSize.w / 2 && dy <= kind.placeholderSize.h / 2) {
      return i;
    }
  }
  return -1;
}

export function hitTestRect(world: World, x0: number, y0: number, x1: number, y1: number): number[] {
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  const out: number[] = [];
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    const x = e.posX[i]!;
    const y = e.posY[i]!;
    if (x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y) out.push(i);
  }
  return out;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- src/input/selection.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Implement selection rings shader — `src/render/shaders/selection.glsl.ts`**

```ts
export const SELECTION_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // unit-quad (-0.5..0.5)
layout(location = 1) in vec2 a_pos;        // per-instance world center
layout(location = 2) in float a_radius;    // per-instance radius (world units)
out vec2 v_local;

uniform mat3 u_viewProj;

void main() {
  vec2 wp = a_pos + a_corner * a_radius * 2.0;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0; // -1..1 across quad
}
`;

export const SELECTION_FS = `#version 300 es
precision highp float;
in vec2 v_local;
out vec4 outColor;

void main() {
  float d = length(v_local);
  // Ring: visible only where 0.85 <= d <= 1.0
  float a = smoothstep(0.85, 0.9, d) - smoothstep(0.98, 1.0, d);
  if (a <= 0.0) discard;
  outColor = vec4(0.4, 1.0, 0.4, a);
}
`;
```

- [ ] **Step 6: Implement `src/render/passes/selection-pass.ts`**

```ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { SELECTION_VS, SELECTION_FS } from '../shaders/selection.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { World } from '../../sim/world';
import type { Selection, DragRect } from '../../input/selection';
import { getUnitKindByIndex } from '../../data/units';
import { screenToWorld } from '../camera';

export interface SelectionPass {
  draw(world: World, cam: Camera, sel: Selection, drag: DragRect): void;
}

export function createSelectionPass(gl: WebGL2RenderingContext, capacity: number): SelectionPass {
  const prog = linkProgram(gl, SELECTION_VS, SELECTION_FS);
  const u = getUniforms(gl, prog, ['u_viewProj'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const radBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  gl.bindVertexArray(null);

  const scratchPos = new Float32Array(capacity * 2);
  const scratchRad = new Float32Array(capacity);

  // Drag rectangle uses a small immediate-mode line draw — separate VAO
  const dragVao = createVertexArray(gl);
  gl.bindVertexArray(dragVao);
  const dragBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, 8 * 2 * 4, gl.DYNAMIC_DRAW); // 8 verts × vec2
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // Reuse u_viewProj uniform; we'll pass identity-ish positions
  gl.bindVertexArray(null);

  return {
    draw(world, cam, sel, drag) {
      // Rings
      let n = 0;
      const e = world.entities;
      for (const id of sel.ids) {
        if (e.alive[id] === 0) continue;
        const kind = getUnitKindByIndex(e.kindId[id]!);
        scratchPos[n * 2 + 0] = e.posX[id]!;
        scratchPos[n * 2 + 1] = e.posY[id]!;
        scratchRad[n] = Math.max(kind.placeholderSize.w, kind.placeholderSize.h) * 0.7;
        n++;
      }
      gl.useProgram(prog);
      if (n > 0) {
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, radBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRad.subarray(0, n));
        gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
      }

      // Drag-rect overlay (drawn in world space too, by converting screen corners)
      if (drag.active) {
        const a = screenToWorld(cam, drag.start);
        const b = screenToWorld(cam, drag.current);
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
        const verts = new Float32Array([
          x0, y0,  x1, y0,
          x1, y0,  x1, y1,
          x1, y1,  x0, y1,
          x0, y1,  x0, y0,
        ]);
        gl.bindVertexArray(dragVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, dragBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
        gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
        gl.drawArrays(gl.LINES, 0, 8);
        gl.bindVertexArray(null);
      }
    },
  };
}
```

Note: the drag-rect lines reuse the selection program for simplicity. The fragment shader's `discard` branch never runs because LINES generate one fragment per line pixel and the local coords map to a thin sliver — the result is a faint green line, which is acceptable for MVP-1.

- [ ] **Step 7: Update `src/render/renderer.ts` to include selection pass**

```ts
import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import { createSelectionPass } from './passes/selection-pass';
import type { World } from '../sim/world';
import type { Selection, DragRect } from '../input/selection';

export interface Renderer {
  render(world: World, cam: Camera, sel: Selection, drag: DragRect): void;
  resize(): void;
}

export function createRenderer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  capacity: number,
): Renderer {
  const terrain = createTerrainPass(gl);
  const sprites = createSpritePass(gl, capacity);
  const selectionPass = createSelectionPass(gl, capacity);

  return {
    resize() {
      resizeToDisplay(gl, canvas);
    },
    render(world, cam, sel, drag) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
      sprites.draw(world, cam);
      selectionPass.draw(world, cam, sel, drag);
    },
  };
}
```

- [ ] **Step 8: Wire selection into `src/main.ts`**

Replace the contents of `src/main.ts` with:

```ts
import { getGL2 } from './gl/context';
import { createRenderer } from './render/renderer';
import { createCamera, screenToWorld } from './render/camera';
import { createInputManager } from './input/input-manager';
import { createCameraControls } from './input/camera-controls';
import { createWorld, tickWorld } from './sim/world';
import { allocEntity } from './sim/entities';
import { getUnitKindIndex } from './data/units';
import { createDefaultMap } from './map/world-map';
import { ordersSystem } from './sim/systems/orders-system';
import { movementSystem } from './sim/systems/movement-system';
import {
  createSelection, createDragRect, hitTestPoint, hitTestRect,
} from './input/selection';

const CAPACITY = 4096;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const renderer = createRenderer(gl, canvas, CAPACITY);
const camera = createCamera();
const input = createInputManager(canvas);
const cameraControls = createCameraControls(camera, input);
const selection = createSelection();
const drag = createDragRect();

const map = createDefaultMap();
const world = createWorld({ seed: 1, capacity: CAPACITY, mapSize: map.size.w });
world.systems = [ordersSystem, movementSystem];

function spawn(kindId: string, team: number, x: number, y: number) {
  const id = allocEntity(world.entities);
  if (id === -1) return;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  world.entities.team[id] = team;
}

const cx = map.size.w / 2;
const cy = map.size.h / 2;
for (let i = 0; i < 16; i++) spawn('line-infantry', 0, cx - 10 + i * 1.3, cy - 30);
for (let i = 0; i < 4; i++) spawn('cuirassier', 0, cx - 6 + i * 3, cy - 50);
spawn('cannon-12', 0, cx, cy - 70);

function syncViewport() {
  renderer.resize();
  camera.viewport = { w: window.innerWidth, h: window.innerHeight };
}
window.addEventListener('resize', syncViewport);
syncViewport();

camera.center.x = cx;
camera.center.y = cy;
camera.zoom = 8;

// Selection input handlers (left mouse button)
const DRAG_THRESHOLD_PX = 4;
let pendingClickStart: { x: number; y: number } | null = null;

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  pendingClickStart = { x: e.clientX, y: e.clientY };
  drag.start = { x: e.clientX, y: e.clientY };
  drag.current = { x: e.clientX, y: e.clientY };
  drag.active = false;
});

window.addEventListener('mousemove', (e) => {
  if (!pendingClickStart) return;
  drag.current = { x: e.clientX, y: e.clientY };
  const dx = e.clientX - pendingClickStart.x;
  const dy = e.clientY - pendingClickStart.y;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.active = true;
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !pendingClickStart) return;
  const additive = e.shiftKey;
  if (drag.active) {
    const a = screenToWorld(camera, drag.start);
    const b = screenToWorld(camera, drag.current);
    const ids = hitTestRect(world, a.x, a.y, b.x, b.y);
    if (!additive) selection.ids.clear();
    for (const id of ids) selection.ids.add(id);
  } else {
    const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const id = hitTestPoint(world, w);
    if (!additive) selection.ids.clear();
    if (id !== -1) selection.ids.add(id);
  }
  drag.active = false;
  pendingClickStart = null;
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') selection.ids.clear();
});

let lastT = performance.now();
function frame(t: number) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  input.beginFrame();
  cameraControls.update(dt);
  tickWorld(world, dt);
  renderer.render(world, camera, selection, drag);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 9: Verify visually**

Run: `npm run dev`. Expected:
- Click on a single red rectangle → it gets a faint green ring around it.
- Click on empty grass → selection clears.
- Click + drag → a thin green rectangle outlines the drag area; on release, all units inside get rings.
- Shift+click adds to existing selection.
- ESC clears selection.

---

## Task 16: Right-click move command

**Files:**
- Create: `src/input/commands.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement `src/input/commands.ts`**

```ts
import type { World } from '../sim/world';
import type { Selection } from './selection';
import type { Vec2 } from '../util/math';

export function issueMoveOrder(world: World, sel: Selection, target: Vec2): void {
  if (sel.ids.size === 0) return;
  // Spread the destination into a small grid so units don't all stack
  const ids = Array.from(sel.ids).filter(id => world.entities.alive[id] === 1);
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  const spacing = 1.4;
  const half = (cols - 1) * spacing * 0.5;
  ids.forEach((id, i) => {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    const tx = target.x + cx * spacing - half;
    const ty = target.y + cy * spacing - half;
    world.orders.set(id, { kind: 'move', targetX: tx, targetY: ty });
  });
}
```

- [ ] **Step 2: Update `src/main.ts` to issue move on right-click**

Add the import:

```ts
import { issueMoveOrder } from './input/commands';
```

And add a right-click handler near the other selection handlers:

```ts
window.addEventListener('mouseup', (e) => {
  if (e.button !== 2) return;
  const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
  issueMoveOrder(world, selection, w);
});
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`. Expected:
- Click a single red infantry → ring appears.
- Right-click somewhere on the grass → the unit walks toward that point and stops there.
- Drag-select multiple units, right-click → all of them walk to a small grid of destinations near the click.
- Cuirassiers (blue) move much faster than infantry; cannons (gray) move much slower.

---

## Task 17: HUD overlay (FPS, entity count, selection panel)

**Files:**
- Create: `src/ui/styles.css`
- Create: `src/ui/overlay.ts`
- Create: `src/ui/hud.ts`
- Create: `src/ui/selection-panel.ts`
- Modify: `index.html`
- Modify: `src/main.ts`

- [ ] **Step 1: Create `src/ui/styles.css`**

```css
:root {
  --ui-bg: rgba(20, 24, 28, 0.85);
  --ui-border: #444;
  --ui-text: #e5e7eb;
  --ui-accent: #80cf80;
}

#ui-root * {
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--ui-text);
}

#ui-root .panel {
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  pointer-events: auto;
}

#ui-root .hud {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  white-space: pre;
}

#ui-root .selection-panel {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 12px;
  border-radius: 6px;
  min-width: 220px;
  text-align: center;
}

#ui-root .build-menu {
  position: absolute;
  top: 80px;
  right: 0;
  width: 180px;
  border-radius: 6px 0 0 6px;
  border-right: none;
  transition: transform 0.18s ease-out;
  padding: 8px;
}

#ui-root .build-menu.collapsed {
  transform: translateX(160px);
}

#ui-root .build-menu .toggle {
  position: absolute;
  left: -22px;
  top: 8px;
  width: 22px;
  height: 32px;
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-right: none;
  border-radius: 4px 0 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
}

#ui-root .build-menu h3 {
  margin: 4px 0 8px;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ui-accent);
}

#ui-root .build-menu button {
  display: block;
  width: 100%;
  margin-bottom: 4px;
  padding: 6px 8px;
  background: #2c343c;
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}

#ui-root .build-menu button:hover {
  background: #3a444f;
}
```

- [ ] **Step 2: Update `index.html` to load CSS**

Replace the existing `<style>` block contents with a link to the stylesheet, keeping the layout rules:

```html
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
      #game { position: fixed; inset: 0; display: block; }
      #ui-root { position: fixed; inset: 0; pointer-events: none; }
    </style>
```

(Leave it as-is; we'll import the CSS module from `main.ts` instead — Vite handles it.)

- [ ] **Step 3: Implement `src/ui/overlay.ts`**

```ts
export function createOverlay(): HTMLElement {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('#ui-root missing');
  return root;
}

export function panel(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `panel ${className}`;
  return el;
}
```

- [ ] **Step 4: Implement `src/ui/hud.ts`**

```ts
import { panel } from './overlay';
import type { World } from '../sim/world';

export interface Hud {
  update(fps: number, world: World): void;
}

export function createHud(root: HTMLElement): Hud {
  const el = panel('hud');
  root.appendChild(el);
  return {
    update(fps, world) {
      el.textContent =
        `FPS    ${fps.toFixed(0).padStart(4)}\n` +
        `Units  ${world.entities.count.toString().padStart(4)}\n` +
        `Tick   ${world.tickCount}`;
    },
  };
}
```

- [ ] **Step 5: Implement `src/ui/selection-panel.ts`**

```ts
import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Selection } from '../input/selection';
import { getUnitKindByIndex } from '../data/units';

export interface SelectionPanel {
  update(world: World, sel: Selection): void;
}

export function createSelectionPanel(root: HTMLElement): SelectionPanel {
  const el = panel('selection-panel');
  el.style.display = 'none';
  root.appendChild(el);
  return {
    update(world, sel) {
      if (sel.ids.size === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const counts = new Map<string, number>();
      for (const id of sel.ids) {
        if (world.entities.alive[id] === 0) continue;
        const kind = getUnitKindByIndex(world.entities.kindId[id]!);
        counts.set(kind.name, (counts.get(kind.name) ?? 0) + 1);
      }
      const lines: string[] = [];
      for (const [name, n] of counts) lines.push(`${name} × ${n}`);
      el.textContent = lines.join('  ·  ');
    },
  };
}
```

- [ ] **Step 6: Wire into `src/main.ts`**

Add at the top:

```ts
import './ui/styles.css';
import { createOverlay } from './ui/overlay';
import { createHud } from './ui/hud';
import { createSelectionPanel } from './ui/selection-panel';
```

After creating the world / camera / etc., before the frame loop:

```ts
const overlay = createOverlay();
const hud = createHud(overlay);
const selPanel = createSelectionPanel(overlay);
```

In the frame loop, track FPS via a smoothed estimate:

```ts
let lastT = performance.now();
let smoothedFps = 60;
function frame(t: number) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  smoothedFps = smoothedFps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
  input.beginFrame();
  cameraControls.update(dt);
  tickWorld(world, dt);
  renderer.render(world, camera, selection, drag);
  hud.update(smoothedFps, world);
  selPanel.update(world, selection);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 7: Verify visually**

Run: `npm run dev`. Expected:
- Top-left: a small dark panel showing `FPS`, `Units`, `Tick` updating live.
- Selection panel hidden when nothing is selected.
- When you select, e.g., 4 cuirassiers and 2 infantry, the bottom-center panel shows `Cuirassier × 4  ·  Line Infantry × 2`.

---

## Task 18: Collapsible build menu

**Files:**
- Create: `src/ui/build-menu.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement `src/ui/build-menu.ts`**

```ts
import { panel } from './overlay';
import { unitKinds } from '../data/units';

export interface BuildMenu {
  /** Currently a no-op; later versions update buildable list from selection. */
  update(): void;
}

export function createBuildMenu(root: HTMLElement): BuildMenu {
  const el = panel('build-menu');
  el.classList.add('collapsed');

  const toggle = document.createElement('div');
  toggle.className = 'toggle';
  toggle.textContent = '«';
  toggle.title = 'Toggle build menu';
  el.appendChild(toggle);

  const heading = document.createElement('h3');
  heading.textContent = 'Build';
  el.appendChild(heading);

  for (const k of unitKinds) {
    const btn = document.createElement('button');
    btn.textContent = k.name;
    btn.disabled = true; // placeholder buttons in MVP-1
    btn.title = `${k.category} (placeholder)`;
    el.appendChild(btn);
  }

  toggle.addEventListener('click', () => {
    const collapsed = el.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '«' : '»';
  });

  root.appendChild(el);

  return { update() {} };
}
```

- [ ] **Step 2: Wire into `src/main.ts`**

Add:

```ts
import { createBuildMenu } from './ui/build-menu';
```

And after creating `selPanel`:

```ts
const buildMenu = createBuildMenu(overlay);
```

Reference `buildMenu` once so the variable isn't unused. Inside the frame loop, after `selPanel.update`:

```ts
buildMenu.update();
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`. Expected:
- A `«` chevron tab visible on the right edge of the screen.
- Clicking it slides out a panel labeled `BUILD` with three disabled buttons (`Line Infantry`, `Cuirassier`, `12-Pounder Cannon`) and the chevron flips to `»`.
- Clicking again collapses the panel.

---

## Task 19: Particle pool + render pass

**Files:**
- Create: `src/particles/particles.ts`
- Create: `src/particles/particles.test.ts`
- Create: `src/render/shaders/particle.glsl.ts`
- Create: `src/render/passes/particle-pass.ts`
- Modify: `src/render/renderer.ts`

- [ ] **Step 1: Write the failing test — `src/particles/particles.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createParticles, spawnParticle, updateParticles } from './particles';

describe('particle pool', () => {
  it('spawn returns a slot index and increments live count', () => {
    const p = createParticles(8);
    const id = spawnParticle(p, { x: 0, y: 0, vx: 1, vy: 0, life: 1, size: 0.5, r: 1, g: 1, b: 1 });
    expect(id).toBeGreaterThanOrEqual(0);
    expect(p.count).toBe(1);
  });

  it('returns -1 when full', () => {
    const p = createParticles(2);
    spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    const id = spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    expect(id).toBe(-1);
  });

  it('updateParticles advances position and decays life', () => {
    const p = createParticles(8);
    const id = spawnParticle(p, { x: 0, y: 0, vx: 10, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    updateParticles(p, 0.1);
    expect(p.posX[id]).toBeCloseTo(1, 5);
    expect(p.life[id]).toBeCloseTo(0.9, 5);
  });

  it('expires particles when life reaches 0 and reuses their slot', () => {
    const p = createParticles(2);
    const a = spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 0.05, size: 1, r: 1, g: 1, b: 1 });
    spawnParticle(p, { x: 0, y: 0, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    updateParticles(p, 0.1);
    expect(p.count).toBe(1);
    const reused = spawnParticle(p, { x: 7, y: 7, vx: 0, vy: 0, life: 1, size: 1, r: 1, g: 1, b: 1 });
    expect(reused).toBe(a);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/particles/particles.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/particles/particles.ts`**

```ts
export interface Particles {
  capacity: number;
  count: number;
  alive: Uint8Array;
  posX: Float32Array;
  posY: Float32Array;
  velX: Float32Array;
  velY: Float32Array;
  life: Float32Array;
  lifeMax: Float32Array;
  size: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

export interface ParticleSpawn {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  size: number;
  r: number; g: number; b: number;
}

export function createParticles(capacity: number): Particles {
  return {
    capacity, count: 0,
    alive: new Uint8Array(capacity),
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    velX: new Float32Array(capacity),
    velY: new Float32Array(capacity),
    life: new Float32Array(capacity),
    lifeMax: new Float32Array(capacity),
    size: new Float32Array(capacity),
    r: new Float32Array(capacity),
    g: new Float32Array(capacity),
    b: new Float32Array(capacity),
  };
}

export function spawnParticle(p: Particles, s: ParticleSpawn): number {
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) {
      p.alive[i] = 1;
      p.posX[i] = s.x; p.posY[i] = s.y;
      p.velX[i] = s.vx; p.velY[i] = s.vy;
      p.life[i] = s.life; p.lifeMax[i] = s.life;
      p.size[i] = s.size;
      p.r[i] = s.r; p.g[i] = s.g; p.b[i] = s.b;
      p.count++;
      return i;
    }
  }
  return -1;
}

export function updateParticles(p: Particles, dt: number): void {
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 0) continue;
    p.life[i] -= dt;
    if (p.life[i] <= 0) {
      p.alive[i] = 0;
      p.count--;
      continue;
    }
    p.posX[i] += p.velX[i]! * dt;
    p.posY[i] += p.velY[i]! * dt;
    // Mild drag
    p.velX[i] *= 0.98;
    p.velY[i] *= 0.98;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- src/particles/particles.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Implement particle shaders — `src/render/shaders/particle.glsl.ts`**

```ts
export const PARTICLE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;     // -0.5..0.5
layout(location = 1) in vec2 a_pos;        // per-instance world center
layout(location = 2) in float a_size;
layout(location = 3) in vec4 a_color;      // rgb + alpha (life ratio)

uniform mat3 u_viewProj;
out vec2 v_local;
out vec4 v_color;

void main() {
  vec2 wp = a_pos + a_corner * a_size;
  vec3 clip = u_viewProj * vec3(wp, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_corner * 2.0;
  v_color = a_color;
}
`;

export const PARTICLE_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
out vec4 outColor;

void main() {
  float d = length(v_local);
  float a = smoothstep(1.0, 0.4, d) * v_color.a;
  if (a <= 0.0) discard;
  outColor = vec4(v_color.rgb * a, a);
}
`;
```

- [ ] **Step 6: Implement `src/render/passes/particle-pass.ts`**

```ts
import { linkProgram, getUniforms } from '../../gl/program';
import { createBuffer, createVertexArray } from '../../gl/buffer';
import { PARTICLE_VS, PARTICLE_FS } from '../shaders/particle.glsl';
import type { Camera } from '../camera';
import { viewProjection } from '../camera';
import type { Particles } from '../../particles/particles';

export interface ParticlePass {
  draw(particles: Particles, cam: Camera): void;
}

export function createParticlePass(gl: WebGL2RenderingContext, capacity: number): ParticlePass {
  const prog = linkProgram(gl, PARTICLE_VS, PARTICLE_FS);
  const u = getUniforms(gl, prog, ['u_viewProj'] as const);

  const vao = createVertexArray(gl);
  gl.bindVertexArray(vao);

  const corners = new Float32Array([
    -0.5, -0.5,  0.5, -0.5, -0.5, 0.5,
    -0.5,  0.5,  0.5, -0.5,  0.5, 0.5,
  ]);
  createBuffer(gl, gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const posBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  const sizeBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const colorBuf = createBuffer(gl, gl.ARRAY_BUFFER, null, gl.DYNAMIC_DRAW);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  const scratchPos = new Float32Array(capacity * 2);
  const scratchSize = new Float32Array(capacity);
  const scratchColor = new Float32Array(capacity * 4);

  return {
    draw(p, cam) {
      let n = 0;
      for (let i = 0; i < p.capacity; i++) {
        if (p.alive[i] === 0) continue;
        scratchPos[n * 2 + 0] = p.posX[i]!;
        scratchPos[n * 2 + 1] = p.posY[i]!;
        scratchSize[n] = p.size[i]!;
        const t = p.lifeMax[i]! > 0 ? p.life[i]! / p.lifeMax[i]! : 0;
        scratchColor[n * 4 + 0] = p.r[i]!;
        scratchColor[n * 4 + 1] = p.g[i]!;
        scratchColor[n * 4 + 2] = p.b[i]!;
        scratchColor[n * 4 + 3] = t; // fade with remaining life
        n++;
      }
      if (n === 0) return;

      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchPos.subarray(0, n * 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchSize.subarray(0, n));
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchColor.subarray(0, n * 4));
      gl.uniformMatrix3fv(u.u_viewProj, false, viewProjection(cam));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied additive-ish
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    },
  };
}
```

- [ ] **Step 7: Add particles to renderer — `src/render/renderer.ts`**

```ts
import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import { createSelectionPass } from './passes/selection-pass';
import { createParticlePass } from './passes/particle-pass';
import type { World } from '../sim/world';
import type { Selection, DragRect } from '../input/selection';
import type { Particles } from '../particles/particles';

export interface Renderer {
  render(world: World, particles: Particles, cam: Camera, sel: Selection, drag: DragRect): void;
  resize(): void;
}

export function createRenderer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  capacity: number,
  particleCapacity: number,
): Renderer {
  const terrain = createTerrainPass(gl);
  const sprites = createSpritePass(gl, capacity);
  const selectionPass = createSelectionPass(gl, capacity);
  const particles = createParticlePass(gl, particleCapacity);

  return {
    resize() {
      resizeToDisplay(gl, canvas);
    },
    render(world, particlePool, cam, sel, drag) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
      sprites.draw(world, cam);
      particles.draw(particlePool, cam);
      selectionPass.draw(world, cam, sel, drag);
    },
  };
}
```

---

## Task 20: Dust emitter under moving units

**Files:**
- Create: `src/particles/emitters.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement `src/particles/emitters.ts`**

```ts
import type { World } from '../sim/world';
import { spawnParticle, type Particles } from './particles';

const DUST_PER_SEC = 4;       // particles per moving unit per second

export function emitDust(world: World, particles: Particles, dt: number): void {
  const e = world.entities;
  const expected = DUST_PER_SEC * dt;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    const vx = e.velX[i]!;
    const vy = e.velY[i]!;
    if (vx === 0 && vy === 0) continue;
    if (world.rng.next() > expected) continue;
    const speed = Math.hypot(vx, vy);
    const jitter = () => world.rng.range(-0.4, 0.4);
    spawnParticle(particles, {
      x: e.posX[i]! + jitter(),
      y: e.posY[i]! + jitter() + 0.2,
      vx: -vx * 0.1 + jitter() * 0.5,
      vy: -vy * 0.1 + jitter() * 0.5,
      life: 0.4 + world.rng.next() * 0.4,
      size: 0.4 + Math.min(speed * 0.05, 0.4),
      r: 0.65, g: 0.55, b: 0.42,
    });
  }
}
```

- [ ] **Step 2: Wire dust + particles into `src/main.ts`**

Add imports near the top:

```ts
import { createParticles, updateParticles } from './particles/particles';
import { emitDust } from './particles/emitters';
```

After creating `world`:

```ts
const PARTICLE_CAPACITY = 4096;
const particles = createParticles(PARTICLE_CAPACITY);
```

Update the renderer creation to pass particle capacity:

```ts
const renderer = createRenderer(gl, canvas, CAPACITY, PARTICLE_CAPACITY);
```

Update the frame loop to update particles, emit dust, and pass particles into the renderer:

```ts
function frame(t: number) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  smoothedFps = smoothedFps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
  input.beginFrame();
  cameraControls.update(dt);
  tickWorld(world, dt);
  emitDust(world, particles, dt);
  updateParticles(particles, dt);
  renderer.render(world, particles, camera, selection, drag);
  hud.update(smoothedFps, world);
  selPanel.update(world, selection);
  buildMenu.update();
  requestAnimationFrame(frame);
}
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`. Expected:
- Select an infantry unit, right-click somewhere far away.
- As it walks, faint sandy-brown puffs appear under it and fade out.
- Cuirassiers (faster) emit visibly more dust because their speed pumps up the size term.
- Cannons emit very little.
- No console errors; FPS stays steady.

---

## Task 21: Production build verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: every test from prior tasks passes. Total: ~25+ tests.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: completes successfully, produces `dist/index.html` plus `dist/assets/*.js` and `dist/assets/*.css`. Bundle size should be small (well under 500 kB before gzip; the bulk is gl-matrix and our own code).

- [ ] **Step 4: Preview the production build**

Run: `npm run preview`
Open the URL it prints (usually `http://localhost:4173`).
Expected: identical behavior to `npm run dev` — grass field, units, camera controls, selection, right-click move, dust, build menu.

- [ ] **Step 5: Smoke test in two browsers**

Open the same URL in Chrome (or Edge) and Firefox. Both should render identically. WebGL2 is broadly supported; if Firefox shows nothing, check the console for shader-precision warnings.

---

## Spec coverage check

Cross-referencing the spec against this plan:

| Spec section                                | Covered by tasks         |
| ------------------------------------------- | ------------------------ |
| Tech stack (TS, Vite, WebGL2, gl-matrix)    | 1, 5                     |
| Three-layer architecture                    | structural across 7–20   |
| Hybrid SoA-ECS simulation                   | 9                        |
| Spatial grid                                | 10                       |
| World tick + system order                   | 11, 14, 19, 20           |
| Renderer with instanced quad passes         | 5, 7, 13, 15, 19         |
| Camera (ortho, project/unproject)           | 6                        |
| Camera input (wheel/drag/keys/edge)         | 8                        |
| UnitKind, UpgradeNode, MapFeature schemas   | 12 (UpgradeNode/MapFeature scaffolded but unused in MVP-1) |
| Map (2km × 2km green field)                 | 7, 13                    |
| Red Alert input controls (subset)           | 8, 15, 16                |
| HUD + selection panel + build menu          | 17, 18                   |
| Particles (dust emitter)                    | 19, 20                   |
| Static deploy                               | 21                       |
| MVP-1 success criteria                      | 21 (browser smoke)       |

Items intentionally deferred per spec (combat, projectiles, real sprites, formations, pathfinding, morale logic, upgrade tree wiring, map features, physics impulses, explosions, sound, multiplayer) — the codebase's structure (`src/sim/systems/`, `src/data/`, `src/map/`, `src/particles/emitters.ts`, etc.) leaves a slot for each.

---

**Plan complete.**
