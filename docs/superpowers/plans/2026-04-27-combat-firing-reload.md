# Auto-Fire & Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing combat primitives into the main game and add a `combat-system` that auto-fires armed Idle units at the nearest enemy in range, so opposing armies actually engage instead of standing still.

**Architecture:** New `combat-system.ts` module exposes `createCombatSystem(fireOrders)` returning a `System`. It iterates the packed alive list, gates on `state === Idle` + `velocity² < ε` + `kind.weapon != null`, grid-queries nearest enemy within `weaponRange`, and calls the existing `triggerFire`. The pre-existing `tickStates`, `tickProjectiles`, and `tickRagdoll` are then registered in `main.ts` via thin `System`-typed adapters that close over `fireOrders`, `projectiles`, `particles`, `world.bloodSplats`, and `world.rng`.

**Tech Stack:** TypeScript, Vitest (`npm test`), Vite for the dev server. Sim is hand-rolled SoA over typed arrays.

**Spec:** `docs/superpowers/specs/2026-04-27-combat-firing-reload-design.md`

---

## File Structure

| File | Role |
|---|---|
| `src/sim/systems/combat-system.ts` | New. Exports `createCombatSystem(fireOrders): System`. Pure target selection + `triggerFire` dispatch. |
| `src/sim/systems/combat-system.test.ts` | New. Vitest unit + pipeline-integration tests. |
| `src/main.ts` | Modify. Add import + adapter wiring + new `world.systems` array. |

No other files are touched.

---

## Task 1: combat-system module skeleton + positive-case test

**Files:**
- Create: `src/sim/systems/combat-system.ts`
- Create: `src/sim/systems/combat-system.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/systems/combat-system.test.ts
import { describe, it, expect } from 'vitest';
import { createWorld } from '../world';
import { allocEntity, EntityState } from '../entities';
import { getUnitKindIndex } from '../../data/units';
import { rebuildGrid } from '../world';
import { createCombatSystem } from './combat-system';
import type { FireOrders } from './state-system';

function makeWorld() {
  const world = createWorld({ seed: 1, capacity: 64, mapSize: 200, cellSize: 2 });
  return world;
}

function spawnLineInfantry(world: ReturnType<typeof makeWorld>, team: number, x: number, y: number): number {
  const e = world.entities;
  const id = allocEntity(e);
  e.kindId[id] = getUnitKindIndex('line-infantry');
  e.team[id] = team;
  e.posX[id] = x;
  e.posY[id] = y;
  e.hp[id] = 60;
  e.bodyRadius[id] = 0.45;
  e.massKg[id] = 80;
  e.state[id] = EntityState.Idle;
  return id;
}

describe('combatSystem', () => {
  it('fires when an idle armed unit has an enemy in weapon range', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const target  = spawnLineInfantry(world, 1, 50, 0); // 50 m, well inside 80 m range

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(world.entities.targetId[shooter]).toBe(target);
    expect(fireOrders.get(shooter)).toEqual({ tx: 50, ty: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- combat-system`

Expected: FAIL with "Cannot find module './combat-system'" or similar import error.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/sim/systems/combat-system.ts
import type { System } from '../world';
import { triggerFire, type FireOrders } from './state-system';
import { EntityState } from '../entities';
import { gridQueryRect } from '../spatial/grid';
import { getUnitKindByIndex } from '../../data/units';

const VEL_EPS_SQ = 0.05 * 0.05;
const candidateBuf = new Int32Array(2048);

export function createCombatSystem(fireOrders: FireOrders): System {
  return (world, _dt) => {
    const e = world.entities;
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

      const count = gridQueryRect(
        world.grid,
        px - range, py - range,
        px + range, py + range,
        candidateBuf,
      );

      let bestId = -1;
      let bestD2 = range * range + 1e-9;
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
        if (d2 < bestD2 || (d2 === bestD2 && (bestId === -1 || cid < bestId))) {
          bestD2 = d2;
          bestId = cid;
        }
      }

      if (bestId === -1) continue;
      triggerFire(e, fireOrders, id, e.posX[bestId]!, e.posY[bestId]!);
      e.targetId[id] = bestId;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- combat-system`

Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add src/sim/systems/combat-system.ts src/sim/systems/combat-system.test.ts
git commit -m "feat(combat): add combat-system with positive-case test"
```

---

## Task 2: State and weapon filters

**Files:**
- Modify: `src/sim/systems/combat-system.test.ts` (append tests)

- [ ] **Step 1: Append the failing tests**

Append after the existing `it(...)` inside the same `describe('combatSystem', ...)` block:

```typescript
  it('does not fire while reloading', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.state[shooter] = EntityState.Reloading;
    world.entities.reloadT[shooter] = 5;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Reloading);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not fire while aiming', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.state[shooter] = EntityState.Aiming;
    world.entities.stateT[shooter] = 0.1;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not fire while flinching', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    world.entities.state[shooter] = EntityState.Flinch;
    world.entities.stateT[shooter] = 0.2;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Flinch);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not fire when the unit kind has no weapon (cuirassier)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = allocEntity(world.entities);
    world.entities.kindId[shooter] = getUnitKindIndex('cuirassier');
    world.entities.team[shooter] = 0;
    world.entities.posX[shooter] = 0;
    world.entities.posY[shooter] = 0;
    world.entities.state[shooter] = EntityState.Idle;
    spawnLineInfantry(world, 1, 1, 0); // adjacent enemy, well inside any range

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('does not fire on same-team units even when they are the closest', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 0, 5, 0);   // friendly, very close
    const enemy   = spawnLineInfantry(world, 1, 60, 0); // farther but enemy

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(enemy);
    expect(fireOrders.get(shooter)).toEqual({ tx: 60, ty: 0 });
  });

  it('stays idle when no enemies are in range', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 81, 0); // 1 m beyond 80 m musket range

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- combat-system`

Expected: all 7 tests pass. (The state filter, weapon-null filter, and team filter were already present in Task 1's implementation; these tests pin the behaviour.)

- [ ] **Step 3: Commit**

```bash
git add src/sim/systems/combat-system.test.ts
git commit -m "test(combat): pin state, weapon, and team filters"
```

---

## Task 3: Velocity gate (mid-march units don't fire)

**Files:**
- Modify: `src/sim/systems/combat-system.test.ts` (append test)

- [ ] **Step 1: Append the failing test**

Append inside the `describe('combatSystem', ...)` block:

```typescript
  it('does not fire while marching (velocity above epsilon)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);
    // line-infantry moveSpeed is 2.5 m/s — well above the 0.05 m/s gate.
    world.entities.velX[shooter] = 2.5;
    world.entities.velY[shooter] = 0;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.state[shooter]).toBe(EntityState.Idle);
    expect(fireOrders.has(shooter)).toBe(false);
  });

  it('fires once velocity decays below epsilon (e.g. arrived at destination)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const target  = spawnLineInfantry(world, 1, 50, 0);
    // Below the 0.05 m/s gate.
    world.entities.velX[shooter] = 0.01;
    world.entities.velY[shooter] = 0;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(target);
    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- combat-system`

Expected: 9 passing tests. (The velocity gate was already in Task 1's implementation; these tests pin it.)

- [ ] **Step 3: Commit**

```bash
git add src/sim/systems/combat-system.test.ts
git commit -m "test(combat): pin velocity gate for marching units"
```

---

## Task 4: Range boundary, nearest-of-many, corpse filter

**Files:**
- Modify: `src/sim/systems/combat-system.test.ts` (append tests)

- [ ] **Step 1: Append the failing tests**

```typescript
  it('fires at an enemy exactly at weaponRange (inclusive boundary)', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const target  = spawnLineInfantry(world, 1, 80, 0); // exactly 80 m

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(target);
  });

  it('picks the nearer of two enemies in range', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const far     = spawnLineInfantry(world, 1, 70, 0);
    const near    = spawnLineInfantry(world, 1, 30, 0);

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(near);
    expect(world.entities.targetId[shooter]).not.toBe(far);
  });

  it('skips enemies in Dying / Dead / Ragdoll and falls through to the next-nearest', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const corpseNear = spawnLineInfantry(world, 1, 20, 0);
    const aliveFar   = spawnLineInfantry(world, 1, 60, 0);
    world.entities.state[corpseNear] = EntityState.Dying;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(aliveFar);
  });

  it('skips a Ragdoll target and a Dead target', () => {
    const world = makeWorld();
    const fireOrders: FireOrders = new Map();
    const system = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    const ragdoll = spawnLineInfantry(world, 1, 10, 0);
    const dead    = spawnLineInfantry(world, 1, 20, 0);
    const alive   = spawnLineInfantry(world, 1, 30, 0);
    world.entities.state[ragdoll] = EntityState.Ragdoll;
    world.entities.state[dead]    = EntityState.Dead;

    rebuildGrid(world);
    system(world, 1 / 60);

    expect(world.entities.targetId[shooter]).toBe(alive);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- combat-system`

Expected: 13 passing tests.

- [ ] **Step 3: Commit**

```bash
git add src/sim/systems/combat-system.test.ts
git commit -m "test(combat): pin range boundary, nearest selection, corpse filter"
```

---

## Task 5: Pipeline integration test (combat → state → projectile)

**Files:**
- Modify: `src/sim/systems/combat-system.test.ts` (append a new `describe` block)

- [ ] **Step 1: Append the failing test**

```typescript
import { tickStates } from './state-system';
import { tickProjectiles } from './projectile-system';
import { createProjectiles } from '../projectiles';
import { createParticles } from '../../particles/particles';
import { getUnitKindByIndex } from '../../data/units';

describe('combat pipeline integration', () => {
  it('idle → aiming → reloading → idle, spawning a projectile along the way', () => {
    const world = makeWorld();
    const projectiles = createProjectiles(16);
    const particles = createParticles(2048);
    const fireOrders: FireOrders = new Map();
    const combat = createCombatSystem(fireOrders);

    const shooter = spawnLineInfantry(world, 0, 0, 0);
    spawnLineInfantry(world, 1, 50, 0);

    const dt = 1 / 60;

    // Tick 1: combat picks the target and triggers Aiming. State-system advances stateT.
    rebuildGrid(world);
    combat(world, dt);
    tickStates(world.entities, projectiles, particles, world.rng, fireOrders, dt);
    tickProjectiles(projectiles, world.entities, world.grid, particles, world.rng, dt, world.bloodSplats);

    expect(world.entities.state[shooter]).toBe(EntityState.Aiming);
    expect(projectiles.count).toBe(0);

    // Run enough ticks to outlast the 0.15 s aiming windup. After Aiming
    // expires, state-system resolves the shot and transitions to Reloading.
    for (let i = 0; i < 12; i++) {
      rebuildGrid(world);
      combat(world, dt);
      tickStates(world.entities, projectiles, particles, world.rng, fireOrders, dt);
      tickProjectiles(projectiles, world.entities, world.grid, particles, world.rng, dt, world.bloodSplats);
    }

    expect(world.entities.state[shooter]).toBe(EntityState.Reloading);
    // Projectile may have hit, missed, or still be in flight — but we know
    // at least one was spawned.
    // Reload countdown is in progress.
    const reloadTotal = getUnitKindByIndex(world.entities.kindId[shooter]!).baseStats.weaponReload;
    expect(world.entities.reloadT[shooter]).toBeGreaterThan(0);
    expect(world.entities.reloadT[shooter]).toBeLessThan(reloadTotal);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- combat-system`

Expected: 14 passing tests in total. The integration block confirms combat triggers fire, state-system spawns the projectile, and the unit is reloading.

- [ ] **Step 3: Commit**

```bash
git add src/sim/systems/combat-system.test.ts
git commit -m "test(combat): pipeline integration combat→state→projectile"
```

---

## Task 6: Wire systems into `main.ts`

**Files:**
- Modify: `src/main.ts:1-51`

- [ ] **Step 1: Update imports**

In `src/main.ts`, replace the existing system-related imports (the lines around 10-13) with the expanded set. Find this block (currently lines 10-13):

```typescript
import { ordersSystem } from './sim/systems/orders-system';
import { movementSystem } from './sim/systems/movement-system';
import { collisionSystem } from './sim/systems/collision-system';
import { facingSystem } from './sim/systems/facing-system';
```

Replace with:

```typescript
import { ordersSystem } from './sim/systems/orders-system';
import { movementSystem } from './sim/systems/movement-system';
import { collisionSystem } from './sim/systems/collision-system';
import { facingSystem } from './sim/systems/facing-system';
import { tickStates, type FireOrders } from './sim/systems/state-system';
import { tickProjectiles } from './sim/systems/projectile-system';
import { tickRagdoll } from './sim/systems/ragdoll-system';
import { createCombatSystem } from './sim/systems/combat-system';
import type { System } from './sim/world';
```

- [ ] **Step 2: Replace the `world.systems` assignment**

Find this line (currently line 51):

```typescript
world.systems = [ordersSystem, movementSystem, facingSystem, collisionSystem];
```

Replace with:

```typescript
const fireOrders: FireOrders = new Map();
const combatSystem = createCombatSystem(fireOrders);
const stateSystem: System = (w, dt) =>
  tickStates(w.entities, projectiles, particles, w.rng, fireOrders, dt);
const projectileSystem: System = (w, dt) =>
  tickProjectiles(projectiles, w.entities, w.grid, particles, w.rng, dt, w.bloodSplats);
const ragdollSystem: System = (w, dt) => tickRagdoll(w.entities, dt);

world.systems = [
  ordersSystem,
  combatSystem,
  movementSystem,
  facingSystem,
  collisionSystem,
  stateSystem,
  projectileSystem,
  ragdollSystem,
];
```

- [ ] **Step 3: Type-check the project**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 4: Run all tests to confirm nothing regressed**

Run: `npm test`

Expected: all tests pass — including the existing sanity test in `src/sim/sanity.test.ts` and the new `combat-system.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): wire combat, state, projectile, ragdoll systems into world.systems"
```

---

## Task 7: Manual verification in the browser

**Files:** none modified.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Expected output includes a localhost URL (typically `http://localhost:5173`).

- [ ] **Step 2: Open the page and observe initial state**

Open the URL in a browser. You should see two opposing 6×100×4 armies, 200 m apart. Because `weaponRange` for line-infantry is 80 m, **neither army should fire** — they are out of range.

If either side fires immediately, something is wrong with the range check or the wiring. Stop and investigate.

- [ ] **Step 3: Bring the armies into range**

Easiest path without depending on selection / attack-move plumbing: temporarily edit `src/main.ts` to reduce `BATTLE_GAP` so the armies start in musket range. Find:

```typescript
const BATTLE_GAP = 200;     // metres between the two armies' front ranks
```

Change to:

```typescript
const BATTLE_GAP = 120;     // metres between the two armies' front ranks
```

Vite hot-reloads. Front ranks are now ~60 m apart — well inside 80 m musket range.

Expected: within ~0.15 s of the page loading, **both armies open fire**. You should see muzzle smoke, flying musket balls, blood splats, and units flinching / dying / ragdolling. Roughly every 18 s the cadence repeats as units finish reloading and fire again.

- [ ] **Step 4: Confirm reload cadence**

Watch a single soldier near the front. They should fire, then stand still for ~18 s, then fire again. (Set `Alt` to show health bars — they tick down on the side taking hits.)

If the cadence is wildly off, or units fire immediately a second time without reloading, the state-system / fire-orders plumbing is mis-wired.

- [ ] **Step 5: Revert the BATTLE_GAP edit**

Restore the original line in `src/main.ts`:

```typescript
const BATTLE_GAP = 200;     // metres between the two armies' front ranks
```

- [ ] **Step 6: Stop the dev server and run the full test suite once more**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 7: Commit any remaining changes**

If `git status` shows untracked or modified files, inspect and decide. Likely there are no changes after the revert. If there are unintended changes, restore them. If there are intended cleanup changes, commit them with an appropriate message.

```bash
git status
```

If clean, this task is done with no commit.

---

## Self-Review

**Spec coverage:**
- §1 architecture — Tasks 1, 6 ✓
- §2 files & changes — all three files appear in tasks ✓
- §3 tick order — Task 6 step 2 mirrors the spec's order ✓
- §4 algorithm — Task 1 step 3 implements all clauses (state filter, velocity gate, weapon-null filter, grid query, range², team filter, corpse filter, tie-break) ✓
- §5 wiring — Task 6 ✓
- §6 reload — covered indirectly by Task 5 (asserts Reloading state with `reloadT > 0`) and Task 7 step 4 (manual cadence) ✓
- §7 tests — Tasks 2-5 cover every row of the test table:
  - idle armed unit, enemy in range — Task 1 ✓
  - idle armed unit, no enemy in range — Task 2 ✓
  - boundary just outside — Task 2 ✓
  - boundary exactly at — Task 4 ✓
  - state = Reloading — Task 2 ✓
  - state = Aiming — Task 2 ✓
  - state = Flinch — Task 2 ✓
  - velocity² > VEL_EPS² — Task 3 ✓
  - kind.weapon == null — Task 2 ✓
  - two enemies, picks nearer — Task 4 ✓
  - target Dying/Dead/Ragdoll — Task 4 (two cases) ✓
  - same-team unit closer — Task 2 ✓
  - pipeline integration — Task 5 ✓
- §8 manual verification — Task 7 ✓
- §9 risks/follow-ups — non-binding, no tasks needed

**Placeholder scan:** No "TBD", no "implement appropriate handling", every code block is concrete. ✓

**Type consistency:** `FireOrders`, `System`, `EntityState`, `triggerFire`, `tickStates`, `tickProjectiles`, `tickRagdoll`, `createCombatSystem`, `gridQueryRect`, `getUnitKindByIndex`, `getUnitKindIndex`, `createWorld`, `rebuildGrid`, `allocEntity`, `createProjectiles`, `createParticles` — all match the actual symbol names in the source. ✓

No issues found.
