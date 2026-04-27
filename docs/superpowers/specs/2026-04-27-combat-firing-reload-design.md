# Auto-Fire & Reload — Wiring The Combat Loop Into The Main Game

**Date:** 2026-04-27
**Status:** Approved (pending spec review)

## Goal & scope

The combat primitives — projectile pool, swept hit-test, muzzle FX, hit
reactions, ragdoll, and the soldier `Aiming → Firing → Reloading → Idle` state
machine — already exist and are exercised by the lab page (`lab.html`). They
are not wired into the main game. The two opposing 6×100×4 armies in
`src/main.ts` currently stand still and stare at each other.

This slice introduces a `combat-system` that auto-engages enemies in weapon
range, and registers the existing combat systems with the main world. The
result: armies that march into musket range open fire, reload, and fire again
without any new player UI.

### In scope

- New `combat-system` module that selects targets and calls `triggerFire`
- Wiring of `tickStates`, `tickProjectiles`, `tickRagdoll` into `world.systems`
  in `src/main.ts`
- Shared `FireOrders` map plumbed through the main loop
- Unit tests for the combat system
- Manual browser verification that armies engage when in range

### Out of scope

- Player-issued `attack` and `attack-move` order semantics (the orders-system
  branch is a stub today; that is its own slice)
- Hold-fire / fire-discipline UI controls (planned follow-up; the design
  leaves room for it)
- Line-of-sight occlusion (rank 2 firing through rank 1 is fine for v1)
- Facing-arc constraints (units pivot via `facingIntent` to whichever target
  combat picks; visual snap is the existing 8-direction facing system)
- Target priority beyond "nearest enemy" (no infantry-vs-cavalry preference,
  no officer targeting, no weighting by HP)
- Sticky targeting (we re-acquire each volley, per design discussion)
- Lab page wiring — the lab keeps its own bespoke orchestration

## §1 · Architecture

A new `combat-system` joins the per-tick pipeline. Each tick it iterates the
packed alive list and, for every unit that is `Idle`, at rest, and holds a
firearm, queries the spatial grid for the nearest enemy within `weaponRange`
and calls the existing `triggerFire`. The state machine and projectile
pipeline already in place do the rest — `Aiming` windup, projectile spawn at
the `Firing` tick, muzzle FX, recoil, `Reloading` countdown, return to `Idle`.

Everything else is wiring. `tickStates`, `tickProjectiles`, and `tickRagdoll`
are written and tested but never registered in `main.ts`. We add thin
`System`-typed adapters that close over the shared `FireOrders` map,
`projectiles`, `particles`, and `world.rng`.

The lab page keeps its own bespoke orchestration; this slice does not touch
it.

## §2 · Files & changes

| File | Change |
|---|---|
| `src/sim/systems/combat-system.ts` | **new** — `createCombatSystem(fireOrders): System` factory |
| `src/sim/systems/combat-system.test.ts` | **new** — unit tests |
| `src/main.ts` | wire `combat`, `state`, `projectile`, `ragdoll` adapters into `world.systems`; create the shared `fireOrders` map |

No changes to `state-system`, `fire-resolver`, `projectile-system`,
`combat-events`, `ragdoll-system`, or `orders-system`. The orders-system
`attack`-branch stub stays a stub for this slice.

## §3 · Tick order in `main.ts`

```
1. ordersSystem        → reads queued orders; sets velocity & facingIntent
2. combatSystem        → idle + at-rest + armed → triggerFire(nearest enemy in range)
3. movementSystem      → integrate velocity
4. facingSystem        → pivot toward facingIntent
5. collisionSystem     → soft-body push
6. stateSystem         → Aiming countdown → spawn projectile + muzzle FX → Reloading → Idle
7. projectileSystem    → integrate, hit-test, applyHit
8. ragdollSystem       → ragdoll integration
```

`combatSystem` runs immediately after `ordersSystem` so that order-driven
velocity is visible this tick. Orders never set `state = Moving` today —
ordersSystem only writes velocity. Combat therefore uses **`velX² + velY² >
VEL_EPS²`** (≈ 0.0025 m²/s²) as the "currently marching" gate. When an
`attack-move` arrives at its destination, ordersSystem zeroes velocity → the
following tick combat picks the unit up.

`combatSystem` runs **before** `movementSystem` so the `state = Aiming`
transition issued by `triggerFire` is visible to downstream systems this
tick. `triggerFire` itself does not zero velocity — combat only acts on units
that are already at rest (the velocity gate above), so velocity is already
zero when we transition.

## §4 · `combatSystem` algorithm

```ts
const VEL_EPS_SQ = 0.05 * 0.05;            // m²/s²
const candidateBuf = new Int32Array(2048); // module-level scratch

function combat(world):
  e = world.entities
  for n in 0 .. e.count:
    id = e.aliveIds[n]
    if e.state[id] != Idle: continue
    vx = e.velX[id]; vy = e.velY[id]
    if vx*vx + vy*vy > VEL_EPS_SQ: continue   // mid-march
    kind = unitKind(e.kindId[id])
    if kind.weapon == null: continue          // cuirassier etc.
    range = kind.baseStats.weaponRange
    team  = e.team[id]
    px    = e.posX[id]; py = e.posY[id]

    n = gridQueryRect(world.grid, px-range, py-range, px+range, py+range, candidateBuf)
    bestId = -1; bestD2 = range*range + 1e-9   // inclusive boundary
    for k in 0..n:
      cid = candidateBuf[k]
      if e.alive[cid] == 0: continue
      if e.team[cid] == team: continue
      cs = e.state[cid]
      if cs in {Dead, Dying, Ragdoll}: continue   // don't shoot corpses
      dx = e.posX[cid] - px; dy = e.posY[cid] - py
      d2 = dx*dx + dy*dy
      if d2 < bestD2 || (d2 === bestD2 && cid < bestId):
        bestD2 = d2; bestId = cid

    if bestId < 0: continue
    triggerFire(e, fireOrders, id, e.posX[bestId], e.posY[bestId])
    e.targetId[id] = bestId
```

Notes:

- Iterates the **packed alive list** (`aliveIds[0..count]`), not
  `0..capacity`, so cost scales with live entities.
- Tie-break by lower `id` keeps the result independent of `gridQueryRect`'s
  cell-iteration order — deterministic with the seeded RNG.
- The `e.targetId[id]` write is informational (used by selection panel /
  future debug overlays). We re-query each volley regardless.
- `bestD2 = range² + ε` (small float epsilon) makes the in-range predicate
  inclusive — a unit exactly at the boundary fires.
- The "skip Dead / Dying / Ragdoll" filter prevents the visible-but-doomed
  body from drawing fire that a more conservative target would absorb. (Flinch
  and Aiming are still legitimate targets.)

## §5 · `main.ts` wiring

```ts
import { tickStates, type FireOrders } from './sim/systems/state-system';
import { tickProjectiles } from './sim/systems/projectile-system';
import { tickRagdoll } from './sim/systems/ragdoll-system';
import { createCombatSystem } from './sim/systems/combat-system';

const fireOrders: FireOrders = new Map();
const combatSystem = createCombatSystem(fireOrders);
const stateSystem: System = (world, dt) =>
  tickStates(world.entities, projectiles, particles, world.rng, fireOrders, dt);
const projectileSystem: System = (world, dt) =>
  tickProjectiles(projectiles, world.entities, world.grid, particles, world.rng, dt, world.bloodSplats);
const ragdollSystemAdapter: System = (world, dt) => tickRagdoll(world.entities, dt);

world.systems = [
  ordersSystem,
  combatSystem,
  movementSystem,
  facingSystem,
  collisionSystem,
  stateSystem,
  projectileSystem,
  ragdollSystemAdapter,
];
```

The `fireOrders` map is owned by `main.ts` and shared between `combatSystem`
(writes) and `stateSystem` (reads + clears). It is **not** added to the
`World` interface — the lab owns its own map separately, so adding a field
would force the lab to thread one too.

## §6 · Reload

Reload is already wired and unchanged. After `state-system` resolves the
`Firing` tick it sets:

```
state[id]   = Reloading
reloadT[id] = kind.baseStats.weaponReload   // musket 18 s, cannon 30 s
```

Each tick `state-system` decrements `reloadT[id]`; at zero the unit returns to
`Idle` with `reloadT = 0`. Combat picks the unit up the next tick if a target
is in range.

## §7 · Tests

`combat-system.test.ts`:

| Case | Expected |
|---|---|
| idle armed unit, enemy in range | enters `Aiming`, `targetId` set to enemy id, `fireOrders` has entry pointing at enemy's position |
| idle armed unit, no enemy in range | stays `Idle`, no `fireOrders` entry, `targetId` unchanged |
| idle armed unit, enemy just outside `weaponRange` (boundary) | stays `Idle` |
| idle armed unit, enemy exactly at `weaponRange` (boundary) | fires |
| state = `Reloading` | does not fire |
| state = `Aiming` | does not fire (already in the pipeline) |
| state = `Flinch` | does not fire |
| velocity² > VEL_EPS² | does not fire |
| `kind.weapon == null` (cuirassier) | does not fire |
| two enemies in range | picks the nearer (verify by id swap) |
| target in `Dying` / `Dead` / `Ragdoll` | filtered out, falls through to the next-nearest |
| same-team unit closer than enemy | picks enemy |
| pipeline integration: combat → state → projectile, run for `aimingWindup + dt` ticks | a projectile is alive after windup; the unit is in `Reloading`; after `weaponReload` more ticks, unit is `Idle` again |

The pipeline-integration test runs the actual systems in order on a tiny
synthetic world (two facing line-infantry, 5 m apart) for the cost of one
volley. Existing tests in `state-system.test.ts`, `projectile-system.test.ts`
etc. cover the per-system contracts.

## §8 · Manual verification

Before declaring complete:

1. `npm run dev`, open the page. Both armies are 200 m apart with `weaponRange
   = 80 m`; they should remain idle.
2. Select the friendly army (`Ctrl-A`-equivalent or drag-select), issue an
   `attack-move` (or plain `move`) toward the enemy line. Once the front
   ranks come within ~80 m, friendly fires; once enemy is within their range,
   they fire back.
3. Confirm muzzle smoke, blood splats, ragdolls, and reload cadence match the
   lab.

If selection / attack-move plumbing is not yet usable for this scenario,
fall back to nudging the friendly `enemyFrontX` constant in `main.ts` close
enough that both armies start in range, just to validate the wiring.

## §9 · Risks & follow-ups

- **Cost**: 2400 units/side. A unit only queries on `Idle`, which is a thin
  slice of any tick (≤ aimingWindup + reload-tail). Worst case at battle-start
  when both armies enter range simultaneously: ~4800 grid queries within a
  few ticks; each rect covers an 80 m × 80 m window over a 2 m grid (~1600
  cells, mostly empty in the gap between formations). Comfortable headroom.
- **Cannon out-of-arc**: `solveCannonLaunch` can return null even when
  distance ≤ `weaponRange` (e.g., target above muzzle-velocity capability).
  `resolveFire` returns `false`; the projectile does not spawn but the state
  still advances `Aiming → Reloading`. Result: cannon "wastes" a shot.
  Acceptable for v1; revisit if it shows up in play.
- **Friendly-fire by occlusion**: rank 2 fires through rank 1; the
  projectile system's same-team filter prevents damage but visually the line
  looks transparent. Out of scope (LOS occlusion deferred).
- **No fire-discipline UI**: every armed unit at rest fires automatically.
  Hold-fire toggle and `attack-move` gating are deferred follow-ups; the
  combat-system signature can absorb a per-entity gate (e.g., a
  `holdFire: Uint8Array`) without restructuring.
