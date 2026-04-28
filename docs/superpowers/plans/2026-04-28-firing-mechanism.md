# Firing Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the diagonal rank-blocking bug and add four firing stances (At Will / Volley / By Ranks (default) / Hold) with rank-aware volley contagion.

**Architecture:** Per-unit `stance`, `formationRank`, `holdLoaded` fields on `Entities`. Rank inferred each combat-system stripe tick from `restPos`/`restFacing` of same-team neighbors. Fire signal widens by a rank dimension; reads filter by stance. Blocking is now `formationRank ≤ 1`.

**Tech Stack:** TypeScript, Vitest, the existing custom ECS in `src/sim/`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-28-firing-mechanism-design.md`

---

## File Structure

| File | Role |
|---|---|
| `src/sim/entities.ts` | Add `stance`, `formationRank`, `holdLoaded` fields + `FireStance` enum + `FORMATION_RANK_UNKNOWN` / `MAX_TRACKED_RANKS` constants. Init in `allocEntity`. |
| `src/sim/fire-signal.ts` | Widen `tickByCellTeam` → `tickByCellTeamRank`. Update `writeFireSignal` / `hasRecentFire` signatures. Add `hasRecentFireAnyRank`. |
| `src/sim/fire-signal.test.ts` | Update existing tests to new signatures; add rank-keyed read/write tests. |
| `src/sim/formation-rank.ts` *(new)* | `FACING_VECS[8]` lookup + pure `inferFormationRank(...)` function operating on entity arrays. |
| `src/sim/formation-rank.test.ts` *(new)* | Synthetic regiments at all 8 octants, diagonal regression, lone soldier, opposing teams. |
| `src/sim/systems/combat-system.ts` | Replace forward-arc occlusion with `canFire = formationRank ≤ 1`. Add `STANCE_TUNABLES` lookup. Dispatch fire decision on stance. Compute rank on stripe tick. |
| `src/sim/systems/combat-system.test.ts` | Extend: rank-based blocking; diagonal regression. |
| `src/sim/systems/combat-system.stance.test.ts` *(new)* | At Will / Volley / By Ranks / Hold behavior. |
| `src/sim/systems/state-system.ts` | Pass `formationRank[id]` when calling `writeFireSignal`. Set `holdLoaded[id]=1` when reload completes under Hold. |
| `src/ui/formation-controls-panel.ts` | Add stance row with 4 keyed buttons. |
| `src/input/selection-controller.ts` | Bind keys 1/2/3/4 (or F/V/R/H) to stance setters when a selection is active. |

Each step ends in its own commit. The plan is ordered so each commit leaves the codebase building and tests passing.

---

## Step 1 — Add `FireStance` enum and entity fields

**Files:**
- Modify: `src/sim/entities.ts`
- Test: `src/sim/entities.test.ts`

- [ ] **1.1 Write failing test for new defaults**

Append to `src/sim/entities.test.ts` (find the existing describe block; add a new `it` inside):

```ts
import { FireStance, FORMATION_RANK_UNKNOWN } from './entities';
// ... in the existing describe('entities'):
it('allocEntity initialises new firing fields to defaults', () => {
  const e = createEntities(8);
  const id = allocEntity(e);
  expect(id).toBeGreaterThanOrEqual(0);
  expect(e.stance[id]).toBe(FireStance.ByRanks);
  expect(e.formationRank[id]).toBe(FORMATION_RANK_UNKNOWN);
  expect(e.holdLoaded[id]).toBe(0);
});
```

If `entities.test.ts` doesn't exist, create it with:
```ts
import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities, FireStance, FORMATION_RANK_UNKNOWN } from './entities';

describe('entities', () => {
  it('allocEntity initialises new firing fields to defaults', () => {
    const e = createEntities(8);
    const id = allocEntity(e);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(e.stance[id]).toBe(FireStance.ByRanks);
    expect(e.formationRank[id]).toBe(FORMATION_RANK_UNKNOWN);
    expect(e.holdLoaded[id]).toBe(0);
  });
});
```

- [ ] **1.2 Run test to verify it fails**

Run: `npx vitest run src/sim/entities.test.ts`
Expected: FAIL with `Cannot read properties of undefined (reading '0')` (or "FireStance is not exported").

- [ ] **1.3 Add enum + constants in `entities.ts`**

After the `EntityState` block (around line 12), add:

```ts
/**
 * Firing stance per-unit. Set by UI selection-wide. Determines volley
 * contagion behaviour and aiming/hold tunables in combat-system.
 */
export const FireStance = {
  AtWill:  0,
  Volley:  1,
  ByRanks: 2,
  Hold:    3,
} as const;
export type FireStance = (typeof FireStance)[keyof typeof FireStance];

/** Sentinel for `formationRank` before its first stripe inference. */
export const FORMATION_RANK_UNKNOWN = 255;

/** Ranks 0..MAX_TRACKED_RANKS-1 each get their own slot in the fire signal.
 *  Anyone past this rank is blocked from firing anyway, so they share the
 *  last bucket. Three is enough for the historically-typical 3-deep line. */
export const MAX_TRACKED_RANKS = 3;
```

In the `Entities` interface (around line 60–62 next to `canFire`), add:

```ts
  // Firing stance + rank within formation. See `FireStance` and
  // `formation-rank.ts`. `formationRank` is refreshed lazily on the
  // combat-system stripe tick from `restPos` + `restFacing`.
  stance: Uint8Array;
  formationRank: Uint8Array;
  // 1 if currently in Hold and the unit has a loaded shot ready. Lets a
  // stance flip away from Hold release the shot without re-reloading.
  holdLoaded: Uint8Array;
```

In `createEntities` (around line 152, with the other allocations), add:

```ts
    stance: new Uint8Array(capacity),
    formationRank: new Uint8Array(capacity),
    holdLoaded: new Uint8Array(capacity),
```

In `allocEntity` (right after `e.canFire[id] = 1;`), add:

```ts
  e.stance[id] = FireStance.ByRanks;
  e.formationRank[id] = FORMATION_RANK_UNKNOWN;
  e.holdLoaded[id] = 0;
```

- [ ] **1.4 Run test to verify it passes**

Run: `npx vitest run src/sim/entities.test.ts`
Expected: PASS.

- [ ] **1.5 Run full type/test pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All green. Existing tests still pass — the new fields are additive.

- [ ] **1.6 Commit**

```bash
git add src/sim/entities.ts src/sim/entities.test.ts
git commit -m "feat(sim): add FireStance + formationRank/holdLoaded entity fields"
```

---

## Step 2 — Export a `facingToVec` helper

**Files:**
- Modify: `src/sim/systems/facing-system.ts`
- Test: `src/sim/systems/facing-system.test.ts`

We need facing-octant → unit vector for rank inference. There's an inline copy in `src/lab/actions.ts` (`facingDir`); we'll promote it to `facing-system.ts` and reuse.

- [ ] **2.1 Write failing test**

Append to `src/sim/systems/facing-system.test.ts`:

```ts
import { facingToVec } from './facing-system';

describe('facingToVec', () => {
  it('octant 0 = east, 2 = north, 4 = west, 6 = south', () => {
    expect(facingToVec(0).x).toBeCloseTo(1, 6);
    expect(facingToVec(0).y).toBeCloseTo(0, 6);
    expect(facingToVec(2).x).toBeCloseTo(0, 6);
    expect(facingToVec(2).y).toBeCloseTo(1, 6);
    expect(facingToVec(4).x).toBeCloseTo(-1, 6);
    expect(facingToVec(4).y).toBeCloseTo(0, 6);
    expect(facingToVec(6).x).toBeCloseTo(0, 6);
    expect(facingToVec(6).y).toBeCloseTo(-1, 6);
  });
  it('octant 1 = NE diagonal (unit length)', () => {
    const v = facingToVec(1);
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(v.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
  });
});
```

- [ ] **2.2 Run test to verify it fails**

Run: `npx vitest run src/sim/systems/facing-system.test.ts`
Expected: FAIL with `facingToVec is not exported`.

- [ ] **2.3 Add the helper**

At the top of `src/sim/systems/facing-system.ts`, after `quantizeDirectionToFacing`:

```ts
/** Octant (0..7) → unit vector (CCW from east). */
export function facingToVec(facing: number): { x: number; y: number } {
  const theta = (facing * Math.PI) / 4;
  return { x: Math.cos(theta), y: Math.sin(theta) };
}
```

- [ ] **2.4 Verify and replace the duplicate in `src/lab/actions.ts`**

Read `src/lab/actions.ts` around lines 23–27 — there's a local `facingDir`. Replace it: delete the inline definition, add `import { facingToVec } from '../sim/systems/facing-system';` near the top, and rename callers (`facingDir(...)` → `facingToVec(...)`). Confirm with:

Run: `grep -n "facingDir" src/lab/actions.ts`
Expected: no matches.

- [ ] **2.5 Run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All green.

- [ ] **2.6 Commit**

```bash
git add src/sim/systems/facing-system.ts src/sim/systems/facing-system.test.ts src/lab/actions.ts
git commit -m "refactor(sim): export facingToVec from facing-system; drop duplicate in lab"
```

---

## Step 3 — Widen `fire-signal` by rank

**Files:**
- Modify: `src/sim/fire-signal.ts`
- Modify: `src/sim/fire-signal.test.ts`

Existing fire-signal stores one tick per `(cell, team)`. We replace with `(cell, team, rank)`. All call sites pass rank from the firer; `hasRecentFireAnyRank` is the stance-Volley read path.

- [ ] **3.1 Update `fire-signal.test.ts` first**

Replace existing tests AND add new ones. Full new file content:

```ts
import { describe, it, expect } from 'vitest';
import { createGrid } from './spatial/grid';
import { MAX_TRACKED_RANKS } from './entities';
import {
  createFireSignal,
  writeFireSignal,
  hasRecentFire,
  hasRecentFireAnyRank,
} from './fire-signal';

function makeGrid() {
  return createGrid({
    minX: 0, minY: 0, maxX: 200, maxY: 200,
    cellSize: 2, capacity: 64,
  });
}

describe('fireSignal', () => {
  it('createFireSignal initialises every (cell,team,rank) entry to -1', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    expect(fs.tickByCellTeamRank.length).toBe(grid.cols * grid.rows * 2 * MAX_TRACKED_RANKS);
    for (let i = 0; i < fs.tickByCellTeamRank.length; i++) {
      expect(fs.tickByCellTeamRank[i]).toBe(-1);
    }
  });

  it('writeFireSignal records the tick at the firer cell + team + rank', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 0, 42);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 42, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 50, 50, 1, 0, 42, 9)).toBe(false); // wrong team
    expect(hasRecentFire(fs, grid, 50, 50, 0, 1, 42, 9)).toBe(false); // wrong rank
  });

  it('hasRecentFire returns true within the window, false outside', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 0, 100);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 100, 9)).toBe(true);  // age 0
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 109, 9)).toBe(true);  // age 9 (boundary)
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 110, 9)).toBe(false); // age 10
  });

  it('hasRecentFire scans the 3x3 cell neighbourhood', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 0, 100);
    expect(hasRecentFire(fs, grid, 51.5, 50, 0, 0, 100, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 53,   50, 0, 0, 100, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 57,   50, 0, 0, 100, 9)).toBe(false);
  });

  it('hasRecentFire returns false on the never-fired sentinel', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    expect(hasRecentFire(fs, grid, 0, 0, 0, 0, 0, 9)).toBe(false);
    expect(hasRecentFire(fs, grid, 0, 0, 1, 0, 0, 9)).toBe(false);
  });

  it('writeFireSignal at the grid edge clamps into the grid', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 0, 0, 1, 0, 7);
    expect(hasRecentFire(fs, grid, 0, 0, 1, 0, 7, 9)).toBe(true);
  });

  it('hasRecentFireAnyRank matches a write on any rank', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 1, 100); // rank 1 fires
    expect(hasRecentFireAnyRank(fs, grid, 50, 50, 0, 100, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 100, 9)).toBe(false); // rank 0 read misses
    expect(hasRecentFire(fs, grid, 50, 50, 0, 1, 100, 9)).toBe(true);  // rank 1 read hits
  });

  it('writeFireSignal clamps rank to MAX_TRACKED_RANKS-1', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 99, 100); // out-of-range rank
    expect(hasRecentFire(fs, grid, 50, 50, 0, MAX_TRACKED_RANKS - 1, 100, 9)).toBe(true);
  });
});
```

- [ ] **3.2 Run tests to confirm they fail against current implementation**

Run: `npx vitest run src/sim/fire-signal.test.ts`
Expected: FAIL — current `writeFireSignal` has no `rank` parameter; `hasRecentFireAnyRank` not exported; `tickByCellTeamRank` not on `FireSignal`.

- [ ] **3.3 Rewrite `fire-signal.ts`**

Replace the entire file with:

```ts
import type { Grid } from './spatial/grid';
import { cellOf } from './spatial/grid';
import { MAX_TRACKED_RANKS } from './entities';

/**
 * Per-cell-per-team-per-rank last-fire-tick. Combat-system reads the firer's
 * 3x3 cell neighbourhood for own team to decide whether to join a volley.
 *
 * Index = (cellIndex * 2 + team) * MAX_TRACKED_RANKS + rank. Sentinel `-1`
 * = never fired. Ranks past MAX_TRACKED_RANKS-1 share the last bucket
 * (irrelevant in practice — only ranks 0/1 fire).
 */
export interface FireSignal {
  tickByCellTeamRank: Int32Array;
}

export function createFireSignal(grid: Grid): FireSignal {
  const cells = grid.cols * grid.rows;
  const arr = new Int32Array(cells * 2 * MAX_TRACKED_RANKS);
  arr.fill(-1);
  return { tickByCellTeamRank: arr };
}

function clampRank(rank: number): number {
  if (rank < 0) return 0;
  if (rank >= MAX_TRACKED_RANKS) return MAX_TRACKED_RANKS - 1;
  return rank;
}

export function writeFireSignal(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  rank: number,
  tick: number,
): void {
  const c = cellOf(grid, x, y);
  const r = clampRank(rank);
  fs.tickByCellTeamRank[(c * 2 + team) * MAX_TRACKED_RANKS + r] = tick;
}

/**
 * True iff any cell in the 3x3 neighbourhood around (x,y) has a same-team
 * same-rank fire whose age in ticks is `<= windowTicks`.
 */
export function hasRecentFire(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  rank: number,
  tick: number,
  windowTicks: number,
): boolean {
  return scan(fs, grid, x, y, team, clampRank(rank), tick, windowTicks, false);
}

/** Same as hasRecentFire but matches any rank (used by Volley stance). */
export function hasRecentFireAnyRank(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  tick: number,
  windowTicks: number,
): boolean {
  return scan(fs, grid, x, y, team, 0, tick, windowTicks, true);
}

function scan(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  rank: number,
  tick: number,
  windowTicks: number,
  anyRank: boolean,
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
  const arr = fs.tickByCellTeamRank;
  for (let yy = cy0; yy <= cy1; yy++) {
    const rowBase = yy * cols;
    for (let xx = cx0; xx <= cx1; xx++) {
      const c = rowBase + xx;
      const base = (c * 2 + team) * MAX_TRACKED_RANKS;
      if (anyRank) {
        for (let r = 0; r < MAX_TRACKED_RANKS; r++) {
          const t = arr[base + r]!;
          if (t >= 0 && tick - t <= windowTicks) return true;
        }
      } else {
        const t = arr[base + rank]!;
        if (t >= 0 && tick - t <= windowTicks) return true;
      }
    }
  }
  return false;
}
```

- [ ] **3.4 Run fire-signal tests**

Run: `npx vitest run src/sim/fire-signal.test.ts`
Expected: PASS.

- [ ] **3.5 Don't run wider tests yet**

The widened API breaks call sites in `state-system.ts` (writes) and `combat-system.ts` (reads). Those land in steps 4–9. The plan order keeps each test file passing as we touch it. But to keep the codebase building **while we're between steps**, fix the two call sites with minimal stubs now.

In `src/sim/systems/state-system.ts`, find the existing `writeFireSignal(fireSignal, grid, e.posX[i]!, e.posY[i]!, e.team[i]!, tick)` (around line 115) and change to:

```ts
writeFireSignal(fireSignal, grid, e.posX[i]!, e.posY[i]!, e.team[i]!, e.formationRank[i]!, tick);
```

In `src/sim/systems/combat-system.ts`, find the `hasRecentFire(fireSignal, grid, px, py, team, tick, VOLLEY_WINDOW_TICKS)` call (around line 180) and change to:

```ts
const hot = hasRecentFire(fireSignal, grid, px, py, team, e.formationRank[id]!, tick, VOLLEY_WINDOW_TICKS);
```

(`formationRank` defaults to `FORMATION_RANK_UNKNOWN` = 255, which `clampRank` collapses to `MAX_TRACKED_RANKS - 1` = 2. Until rank inference lands in step 5, every unit looks like rank 2 — but rank-2 fires still get written and read consistently, so behavior is unchanged from the prior single-bucket signal.)

- [ ] **3.6 Run full test pass + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All green.

- [ ] **3.7 Commit**

```bash
git add src/sim/fire-signal.ts src/sim/fire-signal.test.ts src/sim/systems/state-system.ts src/sim/systems/combat-system.ts
git commit -m "feat(sim): rank-aware fire signal (write + read)"
```

---

## Step 4 — Pure rank-inference helper

**Files:**
- Create: `src/sim/formation-rank.ts`
- Create: `src/sim/formation-rank.test.ts`

The helper takes raw arrays so it can be unit-tested without a full world.

- [ ] **4.1 Write the failing tests first**

Create `src/sim/formation-rank.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity } from './entities';
import { createGrid, gridInsert } from './spatial/grid';
import { inferFormationRank } from './formation-rank';

function makeGrid() {
  return createGrid({ minX: -100, minY: -100, maxX: 100, maxY: 100, cellSize: 2, capacity: 256 });
}

/** Place a 5-wide × 3-deep regiment at origin facing octant `facing` (CCW
 *  from east). Rank 0 is closest to "forward" along the facing axis. Returns
 *  ids in row-major order: front-rank-leftmost first, ..., rear-rank-rightmost last. */
function spawnRegiment(e: ReturnType<typeof createEntities>, grid: ReturnType<typeof makeGrid>, facing: number, team = 0): number[] {
  const ids: number[] = [];
  // Forward (octant→vec)
  const theta = (facing * Math.PI) / 4;
  const fx = Math.cos(theta), fy = Math.sin(theta);
  // Right perpendicular (rotated -90° from forward)
  const rx = fy, ry = -fx;
  const SPACING_X = 1.0, SPACING_Y = 1.2;
  for (let r = 0; r < 3; r++) {       // ranks back-to-front: r=0 is REAR, r=2 is FRONT
    for (let f = -2; f <= 2; f++) {   // 5 files
      const id = allocEntity(e);
      // Front rank: largest forward projection. So rank-0 (front) has 2*spacing-y forward; rear has 0.
      const rankIdxFromFront = 2 - r; // r=0 → rank 2 (rear); r=2 → rank 0 (front)
      const fwdOffset = (2 - rankIdxFromFront) * SPACING_Y; // FRONT (rank 0) = 2*spacing forward of rear
      e.restPosX[id] = fx * fwdOffset + rx * f * SPACING_X;
      e.restPosY[id] = fy * fwdOffset + ry * f * SPACING_X;
      e.posX[id] = e.restPosX[id]!;
      e.posY[id] = e.restPosY[id]!;
      e.restFacing[id] = facing;
      e.team[id] = team;
      gridInsert(grid, id, e.posX[id]!, e.posY[id]!);
      ids.push(id);
    }
  }
  return ids;
}

describe('inferFormationRank', () => {
  it('axis-aligned (east-facing): front rank → 0, middle → 1, rear → 2', () => {
    const e = createEntities(64);
    const grid = makeGrid();
    const ids = spawnRegiment(e, grid, 0); // facing east
    // ids order: rear-rank first (5), middle (5), front (5).
    for (let i = 0; i < 5; i++)  expect(inferFormationRank(e, grid, ids[i + 10]!, 1.0, 1.2)).toBe(0);  // front
    for (let i = 0; i < 5; i++)  expect(inferFormationRank(e, grid, ids[i + 5]!, 1.0, 1.2)).toBe(1);   // middle
    for (let i = 0; i < 5; i++)  expect(inferFormationRank(e, grid, ids[i]!, 1.0, 1.2)).toBe(2);       // rear
  });

  it('diagonal (NE-facing): same regiment shape, ranks still inferred correctly', () => {
    const e = createEntities(64);
    const grid = makeGrid();
    const ids = spawnRegiment(e, grid, 1); // facing NE diagonal
    for (let i = 0; i < 5; i++)  expect(inferFormationRank(e, grid, ids[i + 10]!, 1.0, 1.2)).toBe(0);
    for (let i = 0; i < 5; i++)  expect(inferFormationRank(e, grid, ids[i + 5]!, 1.0, 1.2)).toBe(1);
    for (let i = 0; i < 5; i++)  expect(inferFormationRank(e, grid, ids[i]!, 1.0, 1.2)).toBe(2);
  });

  it('all 8 facings: rear unit reports rank 2', () => {
    for (let facing = 0; facing < 8; facing++) {
      const e = createEntities(64);
      const grid = makeGrid();
      const ids = spawnRegiment(e, grid, facing);
      // ids[0] is rear-leftmost — must have 2 ranks ahead.
      expect(inferFormationRank(e, grid, ids[0]!, 1.0, 1.2)).toBe(2);
    }
  });

  it('lone soldier: rank 0', () => {
    const e = createEntities(8);
    const grid = makeGrid();
    const id = allocEntity(e);
    e.restPosX[id] = 0; e.restPosY[id] = 0;
    e.posX[id] = 0; e.posY[id] = 0;
    e.restFacing[id] = 0;
    e.team[id] = 0;
    gridInsert(grid, id, 0, 0);
    expect(inferFormationRank(e, grid, id, 1.0, 1.2)).toBe(0);
  });

  it('opposing-team neighbors do not contribute', () => {
    const e = createEntities(16);
    const grid = makeGrid();
    // Self at origin facing east, team 0.
    const me = allocEntity(e);
    e.restPosX[me] = 0; e.restPosY[me] = 0;
    e.posX[me] = 0; e.posY[me] = 0;
    e.restFacing[me] = 0; e.team[me] = 0;
    gridInsert(grid, me, 0, 0);
    // Enemy directly ahead — must NOT count as a rank-ahead.
    const enemy = allocEntity(e);
    e.restPosX[enemy] = 1.2; e.restPosY[enemy] = 0;
    e.posX[enemy] = 1.2; e.posY[enemy] = 0;
    e.restFacing[enemy] = 0; e.team[enemy] = 1;
    gridInsert(grid, enemy, 1.2, 0);
    expect(inferFormationRank(e, grid, me, 1.0, 1.2)).toBe(0);
  });

  it('different restFacing neighbors do not contribute', () => {
    const e = createEntities(16);
    const grid = makeGrid();
    const me = allocEntity(e);
    e.restPosX[me] = 0; e.restPosY[me] = 0;
    e.posX[me] = 0; e.posY[me] = 0;
    e.restFacing[me] = 0; e.team[me] = 0;
    gridInsert(grid, me, 0, 0);
    // Same team, ahead, but facing a different octant — different formation.
    const stranger = allocEntity(e);
    e.restPosX[stranger] = 1.2; e.restPosY[stranger] = 0;
    e.posX[stranger] = 1.2; e.posY[stranger] = 0;
    e.restFacing[stranger] = 4; // facing west
    e.team[stranger] = 0;
    gridInsert(grid, stranger, 1.2, 0);
    expect(inferFormationRank(e, grid, me, 1.0, 1.2)).toBe(0);
  });

  it('result clamps at MAX_TRACKED_RANKS-1 = 2', () => {
    const e = createEntities(64);
    const grid = makeGrid();
    // 6-deep regiment, take the rear soldier.
    const ids: number[] = [];
    for (let r = 0; r < 6; r++) {
      const id = allocEntity(e);
      e.restPosX[id] = -r * 1.2;  // rear is most-negative-x, front at x=0
      e.restPosY[id] = 0;
      e.posX[id] = e.restPosX[id]!;
      e.posY[id] = e.restPosY[id]!;
      e.restFacing[id] = 0; // east
      e.team[id] = 0;
      gridInsert(grid, id, e.posX[id]!, e.posY[id]!);
      ids.push(id);
    }
    // Last soldier (5 ranks ahead) must clamp to 2.
    expect(inferFormationRank(e, grid, ids[5]!, 1.0, 1.2)).toBe(2);
  });
});
```

- [ ] **4.2 Run the tests to confirm failure**

Run: `npx vitest run src/sim/formation-rank.test.ts`
Expected: FAIL with `Cannot find module './formation-rank'`.

- [ ] **4.3 Implement `formation-rank.ts`**

Create `src/sim/formation-rank.ts`:

```ts
import type { Entities } from './entities';
import { MAX_TRACKED_RANKS } from './entities';
import type { Grid } from './spatial/grid';
import { gridQueryRect } from './spatial/grid';
import { facingToVec } from './systems/facing-system';

const candidateBuf = new Int32Array(2048);

const LATERAL_TOL_MULT = 0.6;   // |lat| <= LATERAL_TOL_MULT * spacingX
const FORWARD_NEAR_MULT = 0.5;  // fwd > FORWARD_NEAR_MULT * spacingY counts as ahead
const QUERY_RADIUS_MULT = 2.0;  // grid query window in units of spacingY

/**
 * Count distinct same-team same-restFacing neighbors that sit AHEAD of `id`
 * along its formation forward axis. The result is `id`'s formation rank
 * (0 = front), clamped to MAX_TRACKED_RANKS-1.
 *
 * Pure read of `Entities` + `Grid`. Caller passes per-unit `spacingX`/
 * `spacingY` (typically `kind.baseStats.formationSpacing.{x,y}`) so this
 * helper stays kind-agnostic.
 */
export function inferFormationRank(
  e: Entities,
  grid: Grid,
  id: number,
  spacingX: number,
  spacingY: number,
): number {
  const team = e.team[id]!;
  const facing = e.restFacing[id]!;
  const fwdVec = facingToVec(facing);
  const fx = fwdVec.x, fy = fwdVec.y;
  const myX = e.restPosX[id]!;
  const myY = e.restPosY[id]!;
  const radius = QUERY_RADIUS_MULT * spacingY;
  const lateralTol = LATERAL_TOL_MULT * spacingX;
  const forwardNear = FORWARD_NEAR_MULT * spacingY;

  const count = gridQueryRect(
    grid,
    e.posX[id]! - radius, e.posY[id]! - radius,
    e.posX[id]! + radius, e.posY[id]! + radius,
    candidateBuf,
  );

  // Track the maximum forward offset of any qualifying ahead-neighbor;
  // formation rank ≈ floor(maxFwd / spacingY) once we subtract the slack.
  let maxFwd = 0;
  for (let k = 0; k < count; k++) {
    const cid = candidateBuf[k]!;
    if (cid === id) continue;
    if (e.alive[cid] === 0) continue;
    if (e.team[cid] !== team) continue;
    if (e.restFacing[cid] !== facing) continue;
    const dx = e.restPosX[cid]! - myX;
    const dy = e.restPosY[cid]! - myY;
    const fwd = dx * fx + dy * fy;
    if (fwd <= forwardNear) continue;
    const lat = -dx * fy + dy * fx;
    if (lat * lat > lateralTol * lateralTol) continue;
    if (fwd > maxFwd) maxFwd = fwd;
  }

  if (maxFwd <= 0) return 0;
  // floor((maxFwd - forwardNear) / spacingY) + 1 — one rank-ahead per spacing step.
  const ranksAhead = Math.floor((maxFwd - forwardNear) / spacingY) + 1;
  if (ranksAhead < 0) return 0;
  return Math.min(ranksAhead, MAX_TRACKED_RANKS - 1);
}
```

- [ ] **4.4 Run tests**

Run: `npx vitest run src/sim/formation-rank.test.ts`
Expected: PASS for all 7 tests. If the "diagonal" or "all 8 facings" cases fail, the offending soldier's lateral threshold is too tight — first inspect failure detail; do **not** hand-tune `LATERAL_TOL_MULT` higher than 0.6 without checking that it doesn't pull in same-rank neighbors. Document any tweak in the test.

- [ ] **4.5 Run wider tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All green.

- [ ] **4.6 Commit**

```bash
git add src/sim/formation-rank.ts src/sim/formation-rank.test.ts
git commit -m "feat(sim): inferFormationRank — restPos+restFacing rank inference"
```

---

## Step 5 — Wire rank inference into `combat-system`

**Files:**
- Modify: `src/sim/systems/combat-system.ts`

The stripe tick (`(tick + id) % SCAN_PERIOD === 0`) is the natural cadence — same as today's `canFire` refresh. We compute rank first, then base `canFire` on it, then continue with the rest of the loop.

- [ ] **5.1 Update combat-system to compute rank on stripe tick**

In `src/sim/systems/combat-system.ts`:

1. Add imports at the top:

```ts
import { inferFormationRank } from '../formation-rank';
```

2. Inside `createCombatSystem`, in the per-entity loop, **after** the `if (!weapon) continue;` line and **before** `const range = kind.baseStats.weaponRange;`, insert:

```ts
      // Refresh formationRank on this entity's stripe tick. Cheap: a single
      // grid query at restPos. Decoupled from target acquisition.
      if ((tick + id) % SCAN_PERIOD === 0) {
        e.formationRank[id] = inferFormationRank(
          e, grid, id,
          kind.baseStats.formationSpacing.x,
          kind.baseStats.formationSpacing.y,
        );
      }
```

- [ ] **5.2 Run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All green. The forward-arc occlusion below still runs (with its old buggy behavior) — we replace it in step 6.

- [ ] **5.3 Commit**

```bash
git add src/sim/systems/combat-system.ts
git commit -m "feat(combat): compute formationRank on stripe tick"
```

---

## Step 6 — Replace blocking corridor with rank check

**Files:**
- Modify: `src/sim/systems/combat-system.ts`
- Modify: `src/sim/systems/combat-system.test.ts`

- [ ] **6.1 Add a regression test for diagonal blocking**

Append to `src/sim/systems/combat-system.test.ts` (read the file first to see existing setup helpers; reuse them). Add a new `describe`:

```ts
import { FireStance } from '../entities';
// (add to existing imports — most setup helpers should already be in this file)

describe('combat-system — rank blocking', () => {
  it('rank-2 unit cannot fire (regression: diagonal formations)', () => {
    // Build a 1-file × 3-rank stack on a NE diagonal facing NE.
    // (Use the file's existing makeWorld / spawn helpers; the call below is
    //  illustrative — adapt to the actual helper names in the file.)
    const w = makeWorldWithFireOrders();
    const e = w.world.entities;
    const grid = w.world.grid;
    const enemyId = spawnLineInfantry(w.world, 50, 50, /*team*/ 1);
    // Three same-team soldiers stacked along NE forward axis.
    const f = 1; // octant 1 = NE
    const theta = (f * Math.PI) / 4;
    const fx = Math.cos(theta), fy = Math.sin(theta);
    const SY = 1.2;
    const rear   = spawnLineInfantryAt(w.world, 0,        0,        f, /*team*/ 0);
    const middle = spawnLineInfantryAt(w.world, fx*SY,    fy*SY,    f, 0);
    const front  = spawnLineInfantryAt(w.world, fx*2*SY,  fy*2*SY,  f, 0);
    e.targetId[rear]  = enemyId;
    e.targetId[front] = enemyId;
    // Run combat-system enough ticks to hit each unit's stripe.
    for (let t = 0; t < 16; t++) w.combatSystem(w.world, 1/60);
    expect(e.formationRank[front]).toBe(0);
    expect(e.formationRank[rear]).toBe(2);
    expect(e.canFire[front]).toBe(1);
    expect(e.canFire[rear]).toBe(0); // regression: was 1 on diagonals
  });
});
```

If the existing test file has different helpers, adapt the spawn calls to match. The required setup is: a world with combatSystem wired up, and the ability to place individual entities at chosen `(restPos, restFacing, team)` and assign target ids.

- [ ] **6.2 Run the new test**

Run: `npx vitest run src/sim/systems/combat-system.test.ts -t "rank blocking"`
Expected: FAIL — current canFire computation may pass for rank=0 but fails for rear (or fails differently). The test will pass step 6.3.

- [ ] **6.3 Replace the blocking corridor**

In `src/sim/systems/combat-system.ts`:

1. Delete these constants (around lines 29–33):
   ```
   const FORWARD_RANKS_SLACK = 4.5;
   const FORWARD_NEAR = 0.4;
   const LATERAL_HALF = 0.4;
   const LATERAL_HALF_SQ = LATERAL_HALF * LATERAL_HALF;
   const BLOCKING_THRESHOLD = 3;
   ```

2. Delete the entire "Step 2: refresh canFire on the stripe tick" block (the `if ((tick + id) % SCAN_PERIOD === 0) { ... e.canFire[id] = ... }` block, around lines 135–174).

3. Replace it with this single line, **after** target acquisition (after `const tx = ...; const ty = ...;` block) and before `if (!e.canFire[id]) continue;`:

```ts
      // canFire is purely rank-based now: front rank fires forward, rank 1
      // fires "over" rank 0, rank 2+ blocked. formationRank was refreshed
      // earlier on this stripe tick.
      e.canFire[id] = e.formationRank[id]! <= 1 ? 1 : 0;
```

4. The `gridQueryRect`-using `candidateBuf` (top of file) is still used for target scanning — leave it in place.

- [ ] **6.4 Run the regression test**

Run: `npx vitest run src/sim/systems/combat-system.test.ts -t "rank blocking"`
Expected: PASS.

- [ ] **6.5 Run the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All green. Pre-existing combat-system tests that asserted the OLD blocking corridor's behavior may fail; if they do, read the failure: if the assertion still makes sense under rank-blocking (e.g. "soldier with 3 friends ahead doesn't fire"), reframe it as a rank assertion. If it doesn't (e.g. "soldier with 2 friends and a precise lateral offset"), delete the obsolete assertion. Document each deletion in the commit message.

- [ ] **6.6 Commit**

```bash
git add src/sim/systems/combat-system.ts src/sim/systems/combat-system.test.ts
git commit -m "feat(combat): replace forward-arc occlusion with formationRank<=1 check"
```

---

## Step 7 — Stance tunables and dispatch

**Files:**
- Modify: `src/sim/systems/combat-system.ts`
- Modify: `src/sim/systems/state-system.ts`

We replace the single-path "hot or maxHold" decision with a stance-keyed dispatch.

- [ ] **7.1 Add `STANCE_TUNABLES` and per-stance helpers**

In `src/sim/systems/combat-system.ts`, near the top (after `const SCAN_PERIOD = 8;`):

```ts
// Per-stance volley/aim tunables. Index = FireStance value.
//   leaderWindup : Aiming time when this unit fires alone
//   joinerWindup : always 0; preserved for symmetry with state-system
//   maxHoldMin/Max : range for maxHoldFor(id, stance)
const STANCE_TUNABLES = [
  // AtWill
  { leaderWindup: 0.15, joinerWindup: 0.0, maxHoldMin: 0.0, maxHoldMax: 0.0 },
  // Volley
  { leaderWindup: 0.40, joinerWindup: 0.0, maxHoldMin: 0.5, maxHoldMax: 2.0 },
  // ByRanks
  { leaderWindup: 0.25, joinerWindup: 0.0, maxHoldMin: 0.3, maxHoldMax: 1.2 },
  // Hold
  { leaderWindup: 0.0,  joinerWindup: 0.0, maxHoldMin: 0.0, maxHoldMax: 0.0 },
] as const;
```

Replace the existing `MAX_HOLD_MIN_S` / `MAX_HOLD_MAX_S` / `VOLLEY_WINDOW_TICKS` / `JOIN_WINDUP_S` / `AIMING_WINDUP_S` constants:

- Keep `VOLLEY_WINDOW_TICKS = 9;` (rank-window unchanged).
- Delete `MAX_HOLD_MIN_S`, `MAX_HOLD_MAX_S`, `AIMING_WINDUP_S`, `JOIN_WINDUP_S`.

Update `maxHoldFor(id)` to take stance:

```ts
export function maxHoldFor(id: number, stance: number): number {
  const t = STANCE_TUNABLES[stance] ?? STANCE_TUNABLES[2]!; // default ByRanks
  if (t.maxHoldMax <= 0) return 0;
  let h = Math.imul(id, 2654435761) | 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  const u = (h >>> 0) / 0x100000000;
  return t.maxHoldMin + (t.maxHoldMax - t.maxHoldMin) * u;
}
```

If anything imported `MAX_HOLD_MIN_S` / `MAX_HOLD_MAX_S` (run `grep -rn "MAX_HOLD_M" src`), update those imports to call `STANCE_TUNABLES[FireStance.ByRanks]` instead. Most likely just tests.

- [ ] **7.2 Update the fire-decision block**

In the per-entity loop, replace the existing "Step 3: hold-then-fire decision" (the `const hot = hasRecentFire(...); if (hot) { ... } else if (...)` block) with:

```ts
      // Step 3: stance-driven fire decision.
      const stance = e.stance[id]!;
      if (stance === FireStance.Hold) continue;

      const tun = STANCE_TUNABLES[stance] ?? STANCE_TUNABLES[FireStance.ByRanks]!;

      if (stance === FireStance.AtWill) {
        // Fire as soon as ready. No volley wait.
        triggerFire(e, fireOrders, id, tx, ty, tun.leaderWindup);
        continue;
      }

      // Volley + ByRanks: join hot fire if any, else fire alone after maxHold.
      const myRank = e.formationRank[id]!;
      const hot = stance === FireStance.Volley
        ? hasRecentFireAnyRank(fireSignal, grid, px, py, team, tick, VOLLEY_WINDOW_TICKS)
        : hasRecentFire(fireSignal, grid, px, py, team, myRank, tick, VOLLEY_WINDOW_TICKS);
      if (hot) {
        triggerFire(e, fireOrders, id, tx, ty, tun.joinerWindup);
      } else if (e.stateT[id]! >= maxHoldFor(id, stance)) {
        triggerFire(e, fireOrders, id, tx, ty, tun.leaderWindup);
      }
```

Add the imports the new code needs at the top of the file:

```ts
import { FireStance } from '../entities';
import { hasRecentFire, hasRecentFireAnyRank } from '../fire-signal';
```

Drop the now-unused `hasRecentFire` direct-import → `hasRecentFireAnyRank` is the new addition.

- [ ] **7.3 Run typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Mostly green. If tests around `maxHoldFor` break because of the new stance argument, update them to pass `FireStance.ByRanks`.

- [ ] **7.4 Commit**

```bash
git add src/sim/systems/combat-system.ts
git commit -m "feat(combat): stance-driven fire decision (At Will / Volley / By Ranks / Hold)"
```

---

## Step 8 — `holdLoaded` bookkeeping in state-system

**Files:**
- Modify: `src/sim/systems/state-system.ts`

When a unit finishes reload while its stance is Hold, mark `holdLoaded`. When it finishes reload under any other stance, clear it.

- [ ] **8.1 Update the `Reloading` case in `tickStates`**

In `src/sim/systems/state-system.ts`, find:

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

Replace with:

```ts
      case EntityState.Reloading: {
        e.reloadT[i] = e.reloadT[i]! - dt;
        if (e.reloadT[i]! <= 0) {
          e.state[i] = EntityState.Idle;
          e.reloadT[i] = 0;
          e.stateT[i] = 0;
          e.holdLoaded[i] = e.stance[i] === FireStance.Hold ? 1 : 0;
        }
        break;
      }
```

Add to imports at top:

```ts
import { FireStance } from '../entities';
```

After `triggerFire` runs (i.e. when the unit transitions Aiming → Firing in tickStates around line 110), clear `holdLoaded`:

In the `case EntityState.Aiming:` block, immediately after the `e.state[i] = EntityState.Firing;` line, add:

```ts
          e.holdLoaded[i] = 0;
```

- [ ] **8.2 Run tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All green.

- [ ] **8.3 Commit**

```bash
git add src/sim/systems/state-system.ts
git commit -m "feat(combat): set holdLoaded when reload completes under Hold stance"
```

---

## Step 9 — Stance behavior tests

**Files:**
- Create: `src/sim/systems/combat-system.stance.test.ts`

A focused test file for stance behavior, separate from the catch-all `combat-system.test.ts`.

- [ ] **9.1 Sketch the helpers**

Read `src/sim/systems/combat-system.test.ts` to copy the existing world setup helpers (`makeWorld`, spawn calls, fixed RNG seeding). Mirror the style.

- [ ] **9.2 Write the file**

Create `src/sim/systems/combat-system.stance.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FireStance, EntityState } from '../entities';
// Import the existing test harness from combat-system.test.ts. If the
// helpers there aren't exported, factor them into a local file (see step 9.3
// fallback) before continuing.
import { makeCombatTestWorld, spawnInfantryAt } from './combat-system.test-helpers';

describe('combat-system — stance behaviour', () => {
  let w: ReturnType<typeof makeCombatTestWorld>;
  beforeEach(() => { w = makeCombatTestWorld(); });

  it('At Will: fires alone immediately when target acquired and loaded', () => {
    const me   = spawnInfantryAt(w.world, 0, 0, /*facing*/ 0, /*team*/ 0);
    const them = spawnInfantryAt(w.world, 30, 0, /*facing*/ 4, /*team*/ 1);
    w.world.entities.stance[me] = FireStance.AtWill;
    w.world.entities.targetId[me] = them;
    // Run one stripe-aligned combat-system tick (8 ticks max).
    for (let t = 0; t < 16; t++) w.combatSystem(w.world, 1/60);
    expect(w.world.entities.state[me]).toBe(EntityState.Aiming); // immediately committed to fire
  });

  it('Volley: holds Idle, then fires alone after maxHold', () => {
    const me   = spawnInfantryAt(w.world, 0, 0, 0, 0);
    const them = spawnInfantryAt(w.world, 30, 0, 4, 1);
    w.world.entities.stance[me] = FireStance.Volley;
    w.world.entities.targetId[me] = them;
    // First few ticks: still Idle (waiting on volley signal or maxHold).
    for (let t = 0; t < 8; t++) w.combatSystem(w.world, 1/60);
    expect(w.world.entities.state[me]).toBe(EntityState.Idle);
    // After enough idle time (>2s worst case), commits to fire.
    for (let t = 0; t < 60 * 3; t++) {
      w.tick(1/60); // runs combatSystem + state-system; advances stateT
    }
    expect(w.world.entities.state[me]).not.toBe(EntityState.Idle);
  });

  it('By Ranks: rank-0 fire does not pull rank-1 in (signal split)', () => {
    // Set up two soldiers in the same neighborhood but at different
    // formationRanks; verify rank-1 stays Idle while rank-0 fires.
    const r0 = spawnInfantryAt(w.world, 0, 0, 0, 0);
    const r1 = spawnInfantryAt(w.world, 0, 5, 0, 0);
    const them = spawnInfantryAt(w.world, 30, 0, 4, 1);
    w.world.entities.stance[r0] = FireStance.ByRanks;
    w.world.entities.stance[r1] = FireStance.ByRanks;
    w.world.entities.formationRank[r0] = 0;
    w.world.entities.formationRank[r1] = 1;
    w.world.entities.targetId[r0] = them;
    w.world.entities.targetId[r1] = them;
    // Force r0 to fire by writing a rank-0 signal nearby and stepping once.
    // (Implementation detail: directly write to fireSignal via writeFireSignal
    //  to simulate a peer rank-0 firing, then run combat-system one tick.)
    const { writeFireSignal } = await import('../fire-signal');
    writeFireSignal(w.world.fireSignal, w.world.grid, 0, 0, 0, 0, w.world.tickCount);
    for (let t = 0; t < 8; t++) w.combatSystem(w.world, 1/60);
    // r0 should join the rank-0 hot signal; r1 should not.
    expect(w.world.entities.state[r0]).toBe(EntityState.Aiming);
    expect(w.world.entities.state[r1]).toBe(EntityState.Idle);
  });

  it('Hold: never fires; stance flip to Volley releases the loaded shot', () => {
    const me = spawnInfantryAt(w.world, 0, 0, 0, 0);
    const them = spawnInfantryAt(w.world, 30, 0, 4, 1);
    w.world.entities.stance[me] = FireStance.Hold;
    w.world.entities.targetId[me] = them;
    // Drive several seconds; Hold should keep state Idle once reload finishes.
    for (let t = 0; t < 60 * 12; t++) w.tick(1/60);
    expect(w.world.entities.state[me]).toBe(EntityState.Idle);
    expect(w.world.entities.holdLoaded[me]).toBe(1);
    // Flip to Volley → next combat-system tick lets it fire.
    w.world.entities.stance[me] = FireStance.Volley;
    for (let t = 0; t < 16; t++) w.combatSystem(w.world, 1/60);
    expect(w.world.entities.state[me]).not.toBe(EntityState.Idle);
  });
});
```

(`async`/`await` in a test body is fine in Vitest; if the existing test style avoids it, refactor by importing `writeFireSignal` at the top.)

- [ ] **9.3 Fallback if `makeCombatTestWorld` / `spawnInfantryAt` aren't exported**

Read `combat-system.test.ts`. If its setup is private, extract a `combat-system.test-helpers.ts` next to it that exports `makeCombatTestWorld(seed?)` and `spawnInfantryAt(world, x, y, facing, team)`. Update `combat-system.test.ts` to import from the new helper file. Keep the helper signatures minimal — they should set up enough that `combatSystem(world, dt)` runs and entities have meaningful kindIds + weapons.

- [ ] **9.4 Run the new tests**

Run: `npx vitest run src/sim/systems/combat-system.stance.test.ts`
Expected: PASS.

- [ ] **9.5 Run full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All green.

- [ ] **9.6 Commit**

```bash
git add src/sim/systems/combat-system.stance.test.ts src/sim/systems/combat-system.test-helpers.ts
git commit -m "test(combat): stance behavior coverage (At Will / Volley / By Ranks / Hold)"
```

(Add `combat-system.test.ts` to the commit too if the helper extraction touched it.)

---

## Step 10 — UI: stance row in formation-controls-panel

**Files:**
- Modify: `src/ui/formation-controls-panel.ts`
- Modify: `src/input/selection-controller.ts`
- Modify: `src/main.ts` (wire-up)

The panel today shows Spacing and Ranks rows with key-label hints. We add a Stance row showing the current modal stance across the selection plus key hints `1 2 3 4`.

- [ ] **10.1 Update the panel**

In `src/ui/formation-controls-panel.ts`:

1. Extend `FormationControlsPanel.update` signature to receive a stance summary:

```ts
export type StanceSummary =
  | { kind: 'uniform'; stance: number }
  | { kind: 'mixed' }
  | { kind: 'none' };

export interface FormationControlsPanel {
  update(sel: Selection, params: FormationParams, stance: StanceSummary): void;
}
```

2. In `createFormationControlsPanel`, after the `ranksRow` block, add:

```ts
  const stanceRow = document.createElement('div');
  stanceRow.className = 'fc-row';
  const stanceKey = document.createElement('span'); stanceKey.className = 'fc-key'; stanceKey.textContent = '1234';
  const stanceLabel = document.createElement('span'); stanceLabel.className = 'fc-label'; stanceLabel.textContent = 'Stance';
  const stanceVal = document.createElement('span'); stanceVal.className = 'fc-val';
  stanceRow.append(stanceKey, stanceLabel, stanceVal);
  el.append(stanceRow);

  const STANCE_NAMES = ['Fire at Will', 'Volley', 'By Ranks', 'Hold'];
  let lastStanceText: string | undefined = undefined;
```

3. Inside `update`, after the existing `params.ranks` block, add:

```ts
      const text = stance.kind === 'uniform'
        ? STANCE_NAMES[stance.stance] ?? '?'
        : stance.kind === 'mixed' ? 'Mixed' : '—';
      if (text !== lastStanceText) {
        stanceVal.textContent = text;
        lastStanceText = text;
      }
```

- [ ] **10.2 Compute the stance summary at the call site**

In `src/main.ts` (or wherever `formationControlsPanel.update(...)` is invoked — find with `grep -n "formationControlsPanel\\." src/main.ts`), build the summary:

```ts
function computeStanceSummary(sel: Selection, e: Entities): StanceSummary {
  if (sel.ids.size === 0) return { kind: 'none' };
  let first: number | undefined;
  for (const id of sel.ids) {
    if (e.alive[id] !== 1) continue;
    if (first === undefined) { first = e.stance[id]!; continue; }
    if (e.stance[id]! !== first) return { kind: 'mixed' };
  }
  if (first === undefined) return { kind: 'none' };
  return { kind: 'uniform', stance: first };
}
```

Pass the result into `formationControlsPanel.update(sel, params, computeStanceSummary(sel, world.entities));`.

Add `import type { StanceSummary } from './ui/formation-controls-panel';` if needed.

- [ ] **10.3 Bind keys 1/2/3/4 in selection-controller**

In `src/input/selection-controller.ts`, in the `kd` keydown handler, **before** the `BracketLeft/Right` block (around line 475 — see existing pattern), add:

```ts
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit4') {
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      const tag = (ae && 'tagName' in ae) ? (ae as Element).tagName : null;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (selection.ids.size === 0) return;
      const stance = e.code === 'Digit1' ? 0  // AtWill
                   : e.code === 'Digit2' ? 1  // Volley
                   : e.code === 'Digit3' ? 2  // ByRanks
                   :                         3; // Hold
      const ents = world.entities;
      for (const id of selection.ids) {
        if (ents.alive[id] !== 1) continue;
        ents.stance[id] = stance;
      }
      return;
    }
```

(The handler already has access to `selection`, `world` — confirm by reading the surrounding context. If it doesn't, extend the handler closure as needed; mirror how `formationParams` is wired.)

- [ ] **10.4 Manual smoke test**

Run: `npm run dev` and in a browser window:
1. Spawn or select a regiment.
2. Press `1`/`2`/`3`/`4` — confirm the Stance row in the formation-controls panel updates to the chosen stance label.
3. Press `4` (Hold) — confirm units stop firing once their current shot resolves.
4. Press `2` (Volley) — confirm a held regiment immediately fires (loaded units that were holding release).
5. Place a regiment on a diagonal-ish facing, run combat, watch console / behavior — rear-rank units should not be firing through front-rank units. (No assertion here beyond "looks right.")

If anything looks off, file a follow-up note in the commit message. Don't unwind the work; the visual feel will get tuned in a separate pass.

- [ ] **10.5 Commit**

```bash
git add src/ui/formation-controls-panel.ts src/input/selection-controller.ts src/main.ts
git commit -m "feat(ui): stance buttons + 1/2/3/4 keys in formation panel"
```

---

## Step 11 — Final pass: typecheck, full tests, build

- [ ] **11.1 Run everything**

```bash
npx tsc --noEmit
npx vitest run
npm run build  # confirm production build succeeds
```

Expected: All green. The `dist/` output is a side-effect of the smoke build; no need to commit it.

- [ ] **11.2 Quick log audit**

`grep -rn "FORWARD_RANKS_SLACK\\|LATERAL_HALF\\|BLOCKING_THRESHOLD\\|MAX_HOLD_M\\|JOIN_WINDUP_S\\|AIMING_WINDUP_S" src/` — should return zero matches. If any survive, delete them. Commit if non-empty.

- [ ] **11.3 Done**

The plan is complete. The codebase is on `main` (per CLAUDE.md, no worktree). User decides whether to push or continue iterating.

---

## Self-Review Notes

Spec coverage spot-check:
- "Add `stance` / `formationRank` / `holdLoaded`" — Step 1.
- "Rank-aware fire signal" — Step 3.
- "Rank inference (formationRank)" — Steps 4–5.
- "Blocking corridor (the diagonal fix)" — Step 6.
- "Stance behavior table" — Step 7.
- "Hold + holdLoaded transitions" — Step 8.
- "Tests for rank inference / signal / stance / regression" — Steps 4, 3, 6, 9.
- "UI stance row + selection-wide setter" — Step 10.

No placeholders. Every code step ships exact code. Names are consistent: `FireStance` (enum), `formationRank` (field), `inferFormationRank` (helper), `STANCE_TUNABLES` (constant), `hasRecentFireAnyRank` (read variant). All new files have specified paths.

Risk note: Step 9's tests assume helpers from `combat-system.test.ts` are exportable. If they aren't, step 9.3 covers extracting them — small extra work but no design impact.
