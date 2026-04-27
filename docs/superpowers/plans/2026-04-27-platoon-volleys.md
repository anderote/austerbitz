# Platoon Volleys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make line infantry fire in ad-hoc local volleys via spatial fire-signal contagion: when one soldier fires, nearby same-team soldiers who just finished reloading fire on (almost) the same tick. Standalone "leader" fire still happens for soldiers whose hold time expires before any neighbour signals.

**Architecture:** A new per-cell-per-team `fireSignal` Int32Array stores the most-recent tick a shot resolved in each grid cell, written by `tickStates` after every successful `resolveFire`. The combat system gains a hold-then-fire decision: each `Idle` armed soldier with a target either (a) joins by triggering fire with a 0 s windup if any same-team signal in the 3×3 cell neighbourhood is fresher than ~0.15 s, (b) leads by firing with the normal 0.15 s windup once their per-id deterministic `maxHold` timer (0.20–0.60 s) expires, or (c) waits. Targeting also switches from "first enemy in box scan" to "closest enemy in box scan".

**Tech Stack:** TypeScript, Vitest (`npm test`), Vite (`npm run dev` for browser smoke test). Sim is hand-rolled SoA over typed arrays.

**Spec:** `docs/superpowers/specs/2026-04-27-platoon-volleys-design.md`

---

## File Structure

| File | Role |
|---|---|
| `src/sim/spatial/grid.ts` | Modify. Re-export the existing file-local `cellOf` helper. |
| `src/sim/fire-signal.ts` | New. Owns the per-cell-per-team last-fire-tick `Int32Array`. Exports `FireSignal` type, `createFireSignal(grid)`, `writeFireSignal(fs, grid, x, y, team, tick)`, `hasRecentFire(fs, grid, x, y, team, tick, windowTicks)`. |
| `src/sim/fire-signal.test.ts` | New. Unit tests for the helpers. |
| `src/sim/world.ts` | Modify. Add `fireSignal: FireSignal` field; allocate in `createWorld`. |
| `src/sim/systems/state-system.ts` | Modify. (a) `triggerFire` gains optional `windup` param. (b) On `Reloading → Idle` reset `e.stateT[i] = 0`. (c) Default branch increments `e.stateT[i] += dt` only when `state === Idle`. (d) `tickStates` gains `fireSignal: FireSignal` and `grid: Grid` params; writes a signal at the firer's cell after `resolveFire` returns true. |
| `src/sim/systems/state-system.test.ts` | Modify. Update `tickStates` call sites (new params), add tests for stateT-on-Idle and signal write. |
| `src/sim/systems/combat-system.ts` | Modify. (a) Replace first-match `break` with closest-distance tracking. (b) Restructure into "acquire target → decide fire" so the volley check runs on both the fast-path and the rescan path. (c) Volley-signal lookup + `maxHold` watchdog; export `maxHoldFor` for tests. |
| `src/sim/systems/combat-system.test.ts` | Modify. Update `tickStates` call sites in the integration test, plus add tests for the genuine first-match-vs-closest case, lone-leader-after-maxhold, joiner-on-hot-signal, out-of-radius, cross-team. |
| `src/main.ts` | Modify. Pass `world.fireSignal` and `world.grid` into the `tickStates` adapter. |

---

## Task 1: Export `cellOf` from `grid.ts`

**Files:**
- Modify: `src/sim/spatial/grid.ts:40`

- [ ] **Step 1: Add `export` keyword to `cellOf`**

In `src/sim/spatial/grid.ts:40`, change:

```ts
function cellOf(g: Grid, x: number, y: number): number {
```

to:

```ts
export function cellOf(g: Grid, x: number, y: number): number {
```

Internal call sites at lines 69, 81 are unaffected.

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/sim/spatial/grid.ts
git commit -m "refactor(grid): export cellOf for fire-signal lookup"
```

---

## Task 2: New `fire-signal.ts` module + tests

**Files:**
- Create: `src/sim/fire-signal.ts`
- Create: `src/sim/fire-signal.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/sim/fire-signal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGrid } from './spatial/grid';
import {
  createFireSignal,
  writeFireSignal,
  hasRecentFire,
} from './fire-signal';

function makeGrid() {
  return createGrid({
    minX: 0, minY: 0, maxX: 200, maxY: 200,
    cellSize: 2, capacity: 64,
  });
}

describe('fireSignal', () => {
  it('createFireSignal initialises every entry to -1 (no fire ever)', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    expect(fs.tickByCellTeam.length).toBe(grid.cols * grid.rows * 2);
    for (let i = 0; i < fs.tickByCellTeam.length; i++) {
      expect(fs.tickByCellTeam[i]).toBe(-1);
    }
  });

  it('writeFireSignal records the tick at the firer cell + team slot', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 42);
    // Same cell, team 0 → set; team 1 in same cell → still -1.
    expect(hasRecentFire(fs, grid, 50, 50, 0, 42, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 50, 50, 1, 42, 9)).toBe(false);
  });

  it('hasRecentFire returns true within the window, false outside', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 100);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 100, 9)).toBe(true);  // age 0
    expect(hasRecentFire(fs, grid, 50, 50, 0, 109, 9)).toBe(true);  // age 9 (boundary)
    expect(hasRecentFire(fs, grid, 50, 50, 0, 110, 9)).toBe(false); // age 10
  });

  it('hasRecentFire scans the 3x3 cell neighbourhood', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 100);
    // 1.5 m away — same cell.
    expect(hasRecentFire(fs, grid, 51.5, 50, 0, 100, 9)).toBe(true);
    // 3 m away — neighbour cell, still in 3x3.
    expect(hasRecentFire(fs, grid, 53, 50, 0, 100, 9)).toBe(true);
    // ~7 m away — beyond 3x3 (cells are 2 m, neighbourhood spans ±2 cells = 4 m from cell centre).
    expect(hasRecentFire(fs, grid, 57, 50, 0, 100, 9)).toBe(false);
  });

  it('hasRecentFire returns false on the never-fired sentinel even at tick 0', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    expect(hasRecentFire(fs, grid, 0, 0, 0, 0, 9)).toBe(false);
    expect(hasRecentFire(fs, grid, 0, 0, 1, 0, 9)).toBe(false);
  });

  it('writeFireSignal at the grid edge clamps into the grid', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    // (0,0) sits in the corner cell.
    writeFireSignal(fs, grid, 0, 0, 1, 7);
    expect(hasRecentFire(fs, grid, 0, 0, 1, 7, 9)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm test -- src/sim/fire-signal.test.ts`
Expected: FAIL with "Cannot find module './fire-signal'".

- [ ] **Step 3: Implement `fire-signal.ts`**

Create `src/sim/fire-signal.ts`:

```ts
import type { Grid } from './spatial/grid';
import { cellOf } from './spatial/grid';

/**
 * Per-cell-per-team last-fire-tick. Combat-system reads the firer's 3x3
 * cell neighbourhood for own team to decide whether to join a volley.
 *
 * Index = cellIndex * 2 + team. Sentinel `-1` = never fired.
 */
export interface FireSignal {
  tickByCellTeam: Int32Array;
}

export function createFireSignal(grid: Grid): FireSignal {
  const cells = grid.cols * grid.rows;
  const arr = new Int32Array(cells * 2);
  arr.fill(-1);
  return { tickByCellTeam: arr };
}

export function writeFireSignal(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  tick: number,
): void {
  const c = cellOf(grid, x, y);
  fs.tickByCellTeam[c * 2 + team] = tick;
}

/**
 * True iff any cell in the 3x3 neighbourhood around (x,y) has a same-team
 * fire whose age in ticks is `<= windowTicks`. The never-fired sentinel
 * `-1` always reports false (since `tick - (-1)` exceeds any reasonable
 * window).
 */
export function hasRecentFire(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  tick: number,
  windowTicks: number,
): boolean {
  const cellSize = grid.cfg.cellSize;
  const minX = grid.cfg.minX;
  const minY = grid.cfg.minY;
  const cols = grid.cols;
  const rows = grid.rows;
  const cx = Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cellSize)));
  const cy = Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / cellSize)));
  const cx0 = Math.max(0, cx - 1);
  const cx1 = Math.min(cols - 1, cx + 1);
  const cy0 = Math.max(0, cy - 1);
  const cy1 = Math.min(rows - 1, cy + 1);
  const arr = fs.tickByCellTeam;
  for (let yy = cy0; yy <= cy1; yy++) {
    const rowBase = yy * cols;
    for (let xx = cx0; xx <= cx1; xx++) {
      const c = rowBase + xx;
      const t = arr[c * 2 + team]!;
      if (t >= 0 && tick - t <= windowTicks) return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npm test -- src/sim/fire-signal.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/fire-signal.ts src/sim/fire-signal.test.ts
git commit -m "feat(sim): per-cell-per-team fire-signal data + helpers"
```

---

## Task 3: Allocate `world.fireSignal`

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `src/sim/world.test.ts` (only if a test asserts on World shape — usually not; if not, skip the modify)

- [ ] **Step 1: Update World interface and createWorld**

Modify `src/sim/world.ts`:

Add the import near the top, after `createBloodSplats`:

```ts
import { createFireSignal, type FireSignal } from './fire-signal';
```

Add the field to `World` (after `bloodSplats`):

```ts
  /** Per-cell-per-team most-recent-fire-tick — drives volley contagion. */
  fireSignal: FireSignal;
```

Initialise it in `createWorld` — after the `grid` is created, before the return. Restructure the return as needed; the simplest patch:

```ts
export function createWorld(cfg: WorldConfig): World {
  const cellSize = cfg.cellSize ?? 2;
  const grid = createGrid({
    minX: 0, minY: 0,
    maxX: cfg.mapSize, maxY: cfg.mapSize,
    cellSize,
    capacity: cfg.capacity,
  });
  return {
    cfg,
    entities: createEntities(cfg.capacity),
    grid,
    rng: createRng(cfg.seed),
    tickCount: 0,
    simTime: 0,
    systems: [],
    orderQueue: new Map(),
    bloodSplats: createBloodSplats(4096),
    fireSignal: createFireSignal(grid),
  };
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: clean (only the next step will introduce new TS errors at consumer sites).

- [ ] **Step 3: Run full test suite to confirm no regressions**

Run: `npm test`
Expected: all existing tests pass — the new field is additive.

- [ ] **Step 4: Commit**

```bash
git add src/sim/world.ts
git commit -m "feat(world): allocate fireSignal during createWorld"
```

---

## Task 4: state-system — windup param, Idle stateT, signal write

**Files:**
- Modify: `src/sim/systems/state-system.ts`
- Modify: `src/sim/systems/state-system.test.ts`

- [ ] **Step 1: Write failing tests for the new behaviour**

In `src/sim/systems/state-system.test.ts`, add the imports and tests below at the bottom of the file. (Existing tests will be updated in Step 4.)

```ts
import { createGrid } from '../spatial/grid';
import { createFireSignal } from '../fire-signal';

describe('tickStates — Idle stateT', () => {
  it('stateT accumulates while in Idle', () => {
    const e = makeEntities();
    const proj = createProjectiles(4);
    const par = createParticles(4);
    const puff = createPuffs(4);
    const rng = createRng(1);
    const orders: FireOrders = new Map();
    const grid = createGrid({ minX:0, minY:0, maxX:100, maxY:100, cellSize:2, capacity:4 });
    const fs = createFireSignal(grid);

    const id = allocLineInfantry(e, 0, 0, 0);
    e.state[id] = EntityState.Idle;
    e.stateT[id] = 0;

    tickStates(e, proj, par, puff, rng, orders, 1/60, 0, fs, grid);
    expect(e.stateT[id]).toBeCloseTo(1/60, 6);

    tickStates(e, proj, par, puff, rng, orders, 1/60, 1, fs, grid);
    expect(e.stateT[id]).toBeCloseTo(2/60, 6);
  });

  it('stateT resets to 0 on Reloading → Idle transition', () => {
    const e = makeEntities();
    const proj = createProjectiles(4);
    const par = createParticles(4);
    const puff = createPuffs(4);
    const rng = createRng(1);
    const orders: FireOrders = new Map();
    const grid = createGrid({ minX:0, minY:0, maxX:100, maxY:100, cellSize:2, capacity:4 });
    const fs = createFireSignal(grid);

    const id = allocLineInfantry(e, 0, 0, 0);
    e.state[id] = EntityState.Reloading;
    e.reloadT[id] = 1/120;     // half a tick — drains this tick
    e.stateT[id] = 999;        // stale value to prove the reset

    tickStates(e, proj, par, puff, rng, orders, 1/60, 0, fs, grid);

    expect(e.state[id]).toBe(EntityState.Idle);
    // stateT is reset to 0 on the transition, then default-branch increments
    // it by dt. Final value is exactly dt.
    expect(e.stateT[id]).toBeCloseTo(1/60, 6);
  });

  it('writes a fireSignal entry at the firer cell on a successful resolve', () => {
    const e = makeEntities();
    const proj = createProjectiles(4);
    const par = createParticles(4);
    const puff = createPuffs(4);
    const rng = createRng(1);
    const orders: FireOrders = new Map();
    const grid = createGrid({ minX:0, minY:0, maxX:100, maxY:100, cellSize:2, capacity:4 });
    const fs = createFireSignal(grid);

    const id = allocLineInfantry(e, 0, 50, 50);
    e.team[id] = 0;
    e.state[id] = EntityState.Aiming;
    e.stateT[id] = 0;             // windup elapsed; will resolve this tick
    orders.set(id, { tx: 60, ty: 50 });

    const tick = 17;
    tickStates(e, proj, par, puff, rng, orders, 1/60, tick, fs, grid);

    // Cell at (50,50): cellSize 2 → cx=25, cy=25, cellIndex = 25*50 + 25 = 1275.
    const idx = 1275 * 2 + 0;
    expect(fs.tickByCellTeam[idx]).toBe(tick);
  });
});
```

You will also need an `allocLineInfantry` helper in this test file if one isn't present. Add at the top (or reuse if it already exists):

```ts
function allocLineInfantry(e: ReturnType<typeof makeEntities>, team: number, x: number, y: number): number {
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('line-infantry');
  e.team[id] = team;
  e.posX[id] = x;
  e.posY[id] = y;
  e.hp[id] = 60;
  e.bodyRadius[id] = 0.45;
  e.massKg[id] = 80;
  return id;
}
```

(`makeEntities`, `getUnitKindIndex`, `allocEntity`, `createProjectiles`, `createParticles`, `createPuffs`, `createRng`, `tickStates`, `EntityState`, and `FireOrders` are imported in the existing test file. If `getUnitKindIndex` is not yet imported, add `import { getUnitKindIndex } from '../../data/units';`.)

- [ ] **Step 2: Run the new tests, expect failure**

Run: `npm test -- src/sim/systems/state-system.test.ts`
Expected: the three new tests FAIL — `tickStates` does not yet take `fs, grid` and the new behaviour is not implemented. Existing tests will also start failing because their `tickStates` calls don't pass the new arguments — that's intentional, we update them in Step 4.

- [ ] **Step 3: Implement the changes in `state-system.ts`**

Modify `src/sim/systems/state-system.ts`. Add imports near the top:

```ts
import { writeFireSignal, type FireSignal } from '../fire-signal';
import type { Grid } from '../spatial/grid';
```

Change `triggerFire` to take an optional `windup`:

```ts
export function triggerFire(
  e: Entities,
  fireOrders: FireOrders,
  id: number,
  targetX: number,
  targetY: number,
  windup: number = AIMING_WINDUP,
): void {
  e.state[id] = EntityState.Aiming;
  e.stateT[id] = windup;
  fireOrders.set(id, { tx: targetX, ty: targetY });
  writeFacingIntent(e, id, targetX - e.posX[id]!, targetY - e.posY[id]!);
}
```

Update `tickStates` signature to accept `fireSignal` and `grid`:

```ts
export function tickStates(
  e: Entities,
  projectiles: Projectiles,
  particles: Particles,
  puffs: Puffs,
  rng: Rng,
  fireOrders: FireOrders,
  dt: number,
  tick: number,
  fireSignal: FireSignal,
  grid: Grid,
): void {
```

In the `case EntityState.Aiming` block, after `resolveFire(...)`, write the signal. Replace:

```ts
          const order = fireOrders.get(i);
          if (order) {
            resolveFire(e, projectiles, particles, puffs, rng, i, order.tx, order.ty);
          }
          fireOrders.delete(i);
```

with:

```ts
          const order = fireOrders.get(i);
          if (order) {
            const fired = resolveFire(e, projectiles, particles, puffs, rng, i, order.tx, order.ty);
            if (fired) {
              writeFireSignal(fireSignal, grid, e.posX[i]!, e.posY[i]!, e.team[i]!, tick);
            }
          }
          fireOrders.delete(i);
```

In the `case EntityState.Reloading` block, reset `stateT` on the transition. Replace:

```ts
      case EntityState.Reloading: {
        e.reloadT[i] = e.reloadT[i]! - dt;
        if (e.reloadT[i]! <= 0) {
          e.state[i] = EntityState.Idle;
          e.reloadT[i] = 0;
        }
        break;
      }
```

with:

```ts
      case EntityState.Reloading: {
        e.reloadT[i] = e.reloadT[i]! - dt;
        if (e.reloadT[i]! <= 0) {
          e.state[i] = EntityState.Idle;
          e.reloadT[i] = 0;
          e.stateT[i] = 0;
        }
        break;
      }
```

In the `default` branch, increment `stateT` only when state is now `Idle`. Replace:

```ts
      default:
        // Idle, Moving, Firing (transient), Ragdoll, Dead — no transition here.
        break;
```

with:

```ts
      default:
        // Idle, Moving, Firing (transient), Ragdoll, Dead — no transition here.
        // stateT accumulates while in Idle so combat-system can read it as
        // "time spent ready" (used by the volley maxHold watchdog).
        if (e.state[i] === EntityState.Idle) e.stateT[i] = e.stateT[i]! + dt;
        break;
```

Also, the `Reloading → Idle` branch above just set state to Idle and stateT to 0; the same tick falls through past the switch and we want stateT to remain 0 (NOT have dt added by the default branch since this is the *transition* tick, not a "spent in idle" tick). The default branch doesn't run for Reloading because the switch already matched it — so this is fine; stateT stays 0 on the transition tick and starts incrementing the next tick.

Wait — re-reading: the test in Step 1 expects stateT to equal `dt` after one tick that takes Reloading → Idle. That asserts the increment *does* run on the transition tick. But the switch only enters one branch. So stateT lands at 0 (from the reset) and the test would fail.

Resolve by also adding the increment in the Reloading branch when it transitions. Replace the Reloading branch (final form) with:

```ts
      case EntityState.Reloading: {
        e.reloadT[i] = e.reloadT[i]! - dt;
        if (e.reloadT[i]! <= 0) {
          e.state[i] = EntityState.Idle;
          e.reloadT[i] = 0;
          e.stateT[i] = 0;
        }
        break;
      }
```

…and update the test to assert `expect(e.stateT[id]).toBe(0);` instead of `toBeCloseTo(1/60, 6)`. Update the test in Step 1 accordingly:

```ts
  it('stateT resets to 0 on Reloading → Idle transition', () => {
    // ...
    tickStates(e, proj, par, puff, rng, orders, 1/60, 0, fs, grid);
    expect(e.state[id]).toBe(EntityState.Idle);
    expect(e.stateT[id]).toBe(0);    // reset on the transition tick
  });
```

(The "accumulates while idle" test already covers the +=dt path, starting from a clean Idle-from-the-start setup.)

- [ ] **Step 4: Update existing call sites and existing tests**

Existing `tickStates` callers and tests must pass the new `fireSignal` and `grid` args. Search and update:

- `src/sim/systems/combat-system.test.ts:290, 303` — replace each `tickStates(world.entities, projectiles, particles, puffs, world.rng, fireOrders, dt, 0)` with `tickStates(world.entities, projectiles, particles, puffs, world.rng, fireOrders, dt, 0, world.fireSignal, world.grid)`. (`world` is already in scope.)

- `src/sim/systems/state-system.test.ts` — every existing `tickStates(...)` call gets the same two-arg suffix. The tests currently construct an `Entities` directly without a `World`; they'll need to construct a `Grid` and `FireSignal` of their own. At the top of each affected `it` block, after creating `e`/`proj`/`par`/`puff`/`rng`/`orders`, add:

```ts
    const grid = createGrid({ minX:0, minY:0, maxX:100, maxY:100, cellSize:2, capacity:4 });
    const fs = createFireSignal(grid);
```

…and append `, fs, grid` to each `tickStates` call. (If a `makeWorld` helper exists, switching to it would also work; the explicit two-line addition is the minimum diff.)

- `src/main.ts:84-85` — update the adapter:

```ts
const stateSystem: System = (w, dt) =>
  tickStates(w.entities, projectiles, particles, puffs, w.rng, fireOrders, dt, w.tickCount, w.fireSignal, w.grid);
```

- [ ] **Step 5: Run all tests, expect pass**

Run: `npm test`
Expected: all tests PASS — existing behaviour unchanged, new tests for stateT/signal-write green.

- [ ] **Step 6: Commit**

```bash
git add src/sim/systems/state-system.ts src/sim/systems/state-system.test.ts src/sim/systems/combat-system.test.ts src/main.ts
git commit -m "feat(state-system): windup param, idle stateT timer, fireSignal write"
```

---

## Task 5: combat-system — closest-enemy targeting

**Files:**
- Modify: `src/sim/systems/combat-system.ts`
- Modify: `src/sim/systems/combat-system.test.ts`

The existing test at `combat-system.test.ts:222` ("picks the nearer of two enemies in range") happens to pass under both first-match and closest-match because the grid iterates the closer enemy first. We add a test that *requires* closest-match: the farther enemy is iterated first by the grid (lower row, lower column), so first-match would pick the wrong one.

- [ ] **Step 1: Write the failing test**

Append to `src/sim/systems/combat-system.test.ts` inside the existing `describe('combatSystem', ...)`:

```ts
  it('picks the closer enemy even when grid iteration encounters a farther one first', () => {
    // Shooter at (40,40). Grid iterates cells row-major (cy ascending).
    // - far at (40,0)  → cy=0, distance 40 m.
    // - near at (40,30) → cy=15, distance 10 m.
    // far is iterated first; only closest-distance tracking will pick near.
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 40, 40);
    const far     = spawnLineInfantry(world, 1, 40, 0);
    const near    = spawnLineInfantry(world, 1, 40, 30);

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(near);
    expect(world.entities.targetId[shooter]).not.toBe(far);
  });
```

- [ ] **Step 2: Run the test, expect failure**

Run: `npm test -- src/sim/systems/combat-system.test.ts`
Expected: the new test FAILS — combat-system currently breaks on first match.

- [ ] **Step 3: Implement closest-enemy tracking**

In `src/sim/systems/combat-system.ts`, replace the candidate-loop body (lines 73–90 of the current file):

```ts
      let bestId = -1;
      for (let k = 0; k < count; k++) {
        const cid = candidateBuf[k]!;
        if (e.alive[cid] === 0) continue;
        if (e.team[cid] === team) continue;
        const cs = e.state[cid]!;
        if (
          cs === EntityState.Dead ||
          cs === EntityState.Dying ||
          cs === EntityState.Ragdoll
        ) continue;
        const dx = e.posX[cid]! - px;
        const dy = e.posY[cid]! - py;
        const d2 = dx * dx + dy * dy;
        if (d2 > rangeSq) continue;
        bestId = cid;
        break;
      }
```

with:

```ts
      let bestId = -1;
      let bestD2 = Infinity;
      for (let k = 0; k < count; k++) {
        const cid = candidateBuf[k]!;
        if (e.alive[cid] === 0) continue;
        if (e.team[cid] === team) continue;
        const cs = e.state[cid]!;
        if (
          cs === EntityState.Dead ||
          cs === EntityState.Dying ||
          cs === EntityState.Ragdoll
        ) continue;
        const dx = e.posX[cid]! - px;
        const dy = e.posY[cid]! - py;
        const d2 = dx * dx + dy * dy;
        if (d2 > rangeSq) continue;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestId = cid;
        }
      }
```

- [ ] **Step 4: Run all combat-system tests, expect pass**

Run: `npm test -- src/sim/systems/combat-system.test.ts`
Expected: all combat-system tests PASS, including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/sim/systems/combat-system.ts src/sim/systems/combat-system.test.ts
git commit -m "feat(combat): pick closest enemy in range, not first in box scan"
```

---

## Task 6: combat-system — volley join + maxHold leader

This is the core behaviour change. The `Idle`-armed branch becomes "acquire target → decide whether to fire (join / lead / wait)".

**Files:**
- Modify: `src/sim/systems/combat-system.ts`
- Modify: `src/sim/systems/combat-system.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `combat-system.test.ts`. (Existing `describe('combatSystem', ...)` block.)

```ts
  it('a lone idle armed soldier with a target waits and does not fire on the first tick', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;   // freshly idle

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('a lone idle soldier eventually fires once stateT >= maxHoldFor(id)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    // Force stateT past any possible maxHold so we know it fires THIS tick.
    world.entities.stateT[shooter] = 999;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(world.entities.stateT[shooter]).toBeCloseTo(0.15, 6);  // full leader windup
  });

  it('a hot same-team fireSignal in the 3x3 neighbourhood causes immediate fire with 0 windup', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;

    // Plant a fresh signal in shooter's own cell, same team, current tick.
    writeFireSignal(world.fireSignal, world.grid, 0, 0, 0, world.tickCount);

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(world.entities.stateT[shooter]).toBe(0);   // join windup
  });

  it('an out-of-radius signal does not trigger join', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;

    // 12 m away — outside the 3x3 cell neighbourhood (radius ~5–6 m).
    writeFireSignal(world.fireSignal, world.grid, 12, 0, 0, world.tickCount);

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('a fresh signal from the OTHER team is ignored', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;

    writeFireSignal(world.fireSignal, world.grid, 0, 0, 1, world.tickCount); // team 1

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('a stale signal (older than VOLLEY_WINDOW_TICKS) is ignored', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.stateT[shooter] = 0;

    // 50 ticks old at tickCount=0 — write at tick=-50.
    world.tickCount = 50;
    writeFireSignal(world.fireSignal, world.grid, 0, 0, 0, 0);  // age 50 > window

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('maxHoldFor returns a value within [MAX_HOLD_MIN_S, MAX_HOLD_MAX_S]', () => {
    for (let id = 0; id < 200; id++) {
      const v = maxHoldFor(id);
      expect(v).toBeGreaterThanOrEqual(0.20);
      expect(v).toBeLessThanOrEqual(0.60);
    }
  });
```

Add the imports needed at the top of the test file:

```ts
import { writeFireSignal } from '../fire-signal';
import { maxHoldFor } from './combat-system';
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test -- src/sim/systems/combat-system.test.ts`
Expected: the new tests FAIL — `maxHoldFor` is not exported, the volley logic does not exist.

- [ ] **Step 3: Implement the volley + maxHold logic**

Replace the entire body of `src/sim/systems/combat-system.ts` with:

```ts
import type { System } from '../world';
import { triggerFire, type FireOrders } from './state-system';
import { EntityState } from '../entities';
import { gridQueryRect } from '../spatial/grid';
import { getUnitKindByIndex } from '../../data/units';
import { hasRecentFire } from '../fire-signal';

// Block firing while marching at full speed, but allow the formation
// "settle drift" (orders-system sends parked/idle units back to their rest
// anchor at baseSpeed * 0.3 ≈ 0.75 m/s for line-infantry). 1.0 m/s clears
// 0.75 m/s drift but still blocks the 2.5 m/s line-infantry march.
const VEL_EPS_SQ = 1.0 * 1.0;
const candidateBuf = new Int32Array(2048);

// Stripe scans across this many ticks. Each entity does at most one full
// gridQueryRect every SCAN_PERIOD ticks (offset by id). The fast-path target
// cache below bypasses this entirely once a unit has locked onto an enemy.
const SCAN_PERIOD = 8;

// Volley contagion tunables.
const VOLLEY_WINDOW_TICKS = 9;          // ~0.15 s at 60 Hz
const JOIN_WINDUP_S = 0.0;              // joiners fire on the very next state-system tick
const AIMING_WINDUP_S = 0.15;           // mirror state-system's AIMING_WINDUP for leader fire
export const MAX_HOLD_MIN_S = 0.20;
export const MAX_HOLD_MAX_S = 0.60;

/**
 * Per-soldier hold ceiling: time a `Idle` armed soldier waits for a nearby
 * volley signal before firing alone. Stable across ticks (id-derived hash),
 * spread across [MAX_HOLD_MIN_S, MAX_HOLD_MAX_S]. Some soldiers always lead;
 * others always follow.
 */
export function maxHoldFor(id: number): number {
  let h = Math.imul(id, 2654435761) | 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  const u = (h >>> 0) / 0x100000000;
  return MAX_HOLD_MIN_S + (MAX_HOLD_MAX_S - MAX_HOLD_MIN_S) * u;
}

export function createCombatSystem(fireOrders: FireOrders): System {
  return (world, _dt) => {
    const e = world.entities;
    const grid = world.grid;
    const fireSignal = world.fireSignal;
    const tick = world.tickCount;
    for (let n = 0; n < e.count; n++) {
      const id = e.aliveIds[n]!;
      if (e.state[id] !== EntityState.Idle) continue;
      const vx = e.velX[id]!;
      const vy = e.velY[id]!;
      if (vx * vx + vy * vy > VEL_EPS_SQ) continue;
      const kind = getUnitKindByIndex(e.kindId[id]!);
      const weapon = kind.weapon;
      if (!weapon) continue;

      const range = kind.baseStats.weaponRange;
      const team = e.team[id]!;
      const px = e.posX[id]!;
      const py = e.posY[id]!;
      const rangeSq = range * range;

      // Step 1: acquire a valid target. Fast-path on prev target if still
      // alive + in range; otherwise scan-throttled grid query (closest pick).
      let targetId = -1;
      const prev = e.targetId[id]!;
      if (prev !== -1 && e.alive[prev] === 1 && e.team[prev] !== team) {
        const ps = e.state[prev]!;
        if (
          ps !== EntityState.Dead &&
          ps !== EntityState.Dying &&
          ps !== EntityState.Ragdoll
        ) {
          const dxp = e.posX[prev]! - px;
          const dyp = e.posY[prev]! - py;
          if (dxp * dxp + dyp * dyp <= rangeSq) {
            targetId = prev;
          }
        }
      }
      if (targetId === -1) {
        if ((tick + id) % SCAN_PERIOD !== 0) continue;
        const count = gridQueryRect(
          grid,
          px - range, py - range,
          px + range, py + range,
          candidateBuf,
        );
        let bestId = -1;
        let bestD2 = Infinity;
        for (let k = 0; k < count; k++) {
          const cid = candidateBuf[k]!;
          if (e.alive[cid] === 0) continue;
          if (e.team[cid] === team) continue;
          const cs = e.state[cid]!;
          if (
            cs === EntityState.Dead ||
            cs === EntityState.Dying ||
            cs === EntityState.Ragdoll
          ) continue;
          const dx = e.posX[cid]! - px;
          const dy = e.posY[cid]! - py;
          const d2 = dx * dx + dy * dy;
          if (d2 > rangeSq) continue;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestId = cid;
          }
        }
        if (bestId === -1) continue;
        targetId = bestId;
        e.targetId[id] = bestId;
      }

      // Step 2: hold-then-fire decision. Join a hot volley with 0 windup,
      // else fire alone with full windup once the per-id maxHold expires,
      // else wait (stateT keeps incrementing in tickStates).
      const tx = e.posX[targetId]!;
      const ty = e.posY[targetId]!;
      const hot = hasRecentFire(fireSignal, grid, px, py, team, tick, VOLLEY_WINDOW_TICKS);
      if (hot) {
        triggerFire(e, fireOrders, id, tx, ty, JOIN_WINDUP_S);
      } else if (e.stateT[id]! >= maxHoldFor(id)) {
        triggerFire(e, fireOrders, id, tx, ty, AIMING_WINDUP_S);
      }
    }
  };
}
```

- [ ] **Step 4: Update existing tests that assumed instant fire**

Several existing tests in `combat-system.test.ts` (e.g. `'fires when an idle armed unit has an enemy in weapon range'`) implicitly assumed the soldier fires on the very first tick. Under the new model that requires either a hot signal or a high `stateT`. Update each affected test to **set `world.entities.stateT[shooter] = 999` before `rebuildGrid`**, which forces the leader path and matches the previous "fires immediately" semantics.

Affected test names (each gets a `world.entities.stateT[shooter] = 999;` line right before `rebuildGrid(world);`):

- `'fires when an idle armed unit has an enemy in weapon range'`
- `'does not fire on same-team units even when they are the closest'`
- `'fires once velocity decays below epsilon (e.g. arrived at destination)'`
- `'fires while drifting back to rest anchor at settle speed'`
- `'fires at an enemy exactly at weaponRange (inclusive boundary)'`
- `'picks the nearer of two enemies in range'`
- `'skips enemies in Dying / Dead / Ragdoll and falls through to the next-nearest'`
- `'skips a Ragdoll target and a Dead target'`
- `'picks the closer enemy even when grid iteration encounters a farther one first'` (the test added in Task 5)

Tests that already DO NOT expect fire (Reloading / Aiming / Flinch / no-weapon / out-of-range / marching / no-enemies-in-range) need no change.

The integration test `'idle → aiming → reloading transitions and projectile is spawned'` runs many ticks of `state-system`, so `stateT` accumulates naturally past the maxHold ceiling. Add `world.entities.stateT[shooter] = 999;` once before the first `combat(world, dt)` to force the very first tick to fire. The remaining loop is unaffected.

- [ ] **Step 5: Run all tests, expect pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sim/systems/combat-system.ts src/sim/systems/combat-system.test.ts
git commit -m "feat(combat): platoon volley contagion via fireSignal + maxHold leader"
```

---

## Task 7: Final smoke test in browser

**Files:** none (manual verification).

- [ ] **Step 1: Build poses + start dev server**

Run: `npm run dev`
Expected: Vite serves at `http://localhost:5173`, no compile errors.

- [ ] **Step 2: Open the page and observe combat**

Open `http://localhost:5173` in a browser. The two 2 000-soldier armies face off and engage. Watch for ~30 seconds.

Expected behaviour:

- The first volley after spawn is naturally fragmented (random reload-T at spawn).
- Subsequent fire reads as **clusters** of overlapping shots — each ripple lights up ~10 streaks within a 50–100 ms window, separated by quieter gaps.
- The "rolling thunder" pattern is visible left-to-right or right-to-left along each line, NOT a uniform fizz of independent shots and NOT a single line-wide thunderclap.
- Stragglers fire alone between volleys.
- Smoke clouds form in clumps along the line where volleys go off, with quieter sections between.

If the line fires too synchronously (looks like one big volley): consider raising `MAX_HOLD_MAX_S` toward 0.8 in `combat-system.ts`.
If it looks too independent (no visible volleys): consider raising `VOLLEY_WINDOW_TICKS` toward 15 (~0.25 s).

These knobs are isolated in the constants block at the top of `combat-system.ts`; tuning is a parameter change and a refresh.

- [ ] **Step 3: Stop the server**

Ctrl+C in the terminal running Vite.

- [ ] **Step 4: Final commit if any tuning was applied**

If you tweaked tunables based on observation:

```bash
git add src/sim/systems/combat-system.ts
git commit -m "tune(combat): adjust volley window/maxHold to taste"
```

Otherwise nothing to commit — the implementation is complete.

---

## Self-review notes

- **Spec coverage:** every section of `2026-04-27-platoon-volleys-design.md` has a task.
  - "Targeting tweak" → Task 5.
  - "fireSignal data" → Task 2.
  - "Hold-then-fire" → Task 6.
  - "windup param on triggerFire" → Task 4.
  - "stateT idle accumulation + reset on Reloading→Idle" → Task 4.
  - "Signal write after resolveFire" → Task 4.
  - "main.ts adapter wiring" → Task 4 step 4.
  - All listed tests → covered across Tasks 2/4/5/6.
- **Reload jitter:** the spec keeps it; no task touches `state-system.ts:110`. The existing test asserting the ±20 % band continues to pass.
- **Cell math sanity:** with `cellSize = 2 m`, the 3×3 neighbourhood spans 6 m × 6 m centred on the firer's cell — diagonal corner ~5.66 m from a centred shooter. Tunable lives in the spec.
- **Determinism:** `maxHoldFor` is a pure function of `id`. Tests are stable.
- **Performance:** the new `hasRecentFire` is at most 9 Int32Array reads per `Idle` armed soldier per tick. No allocations in the hot path.
