# Platoon Volleys via Spatial Contagion

**Date:** 2026-04-27
**Status:** Approved (inline brainstorm)

## Goal & scope

Make line infantry fire in **ad-hoc local volleys** instead of as a uniform fizz of independent shots. When a soldier finishes reloading they prefer to fire at the same instant as nearby same-team soldiers. The result reads as "thunder rolling along the line" — clusters of ~5–15 men cracking off near-simultaneously, with stragglers and a steady scattering of independent fire.

Aiming stays simple: each soldier shoots at the closest enemy in range. A tweak to combat-system replaces "first enemy hit during the AABB scan" with "closest enemy", so front ranks reliably engage front ranks across.

### In scope

- `combat-system` switches target pick from first-in-box to nearest-in-box.
- New volley-signal data on the world (per-cell-per-team last-fire-tick).
- `Idle` armed soldiers wait briefly before firing: they join a nearby in-progress volley if one exists, otherwise lead a new one once their per-soldier hold time expires.
- `triggerFire` gains an optional shorter windup so volley joiners fire on (almost) the same tick as the leader.
- The existing ±20 % reload jitter is **kept**. Originally it was an anti-volley measure; under the new model it serves the opposite purpose — it prevents the cascade from collapsing into perfect lockstep volleys by ensuring successive `Reloading → Idle` cohorts arrive in slightly different waves rather than all-at-once. Without it, after the first scattered volley the cascade would re-synchronize the entire line every cycle.
- Unit tests covering nearest-enemy targeting, volley join, watchdog leader, signal expiry, cross-team isolation, and chained cascades.

### Out of scope

- Muzzle / projectile WIP currently in the dirty tree (slow ball, light-grey + streak, smoke gradient + buoyancy jitter) — those land as-is, no further tuning here.
- Recoil animation, muzzle FX timing, hit / damage resolution.
- Player-issued "fire by platoon" / "hold fire" / "fire at will" commands. The data is positioned so adding those later is straightforward, but the v1 here is purely emergent.
- Persistent platoon entities or a `platoonId` field on entities. Volley grouping is purely positional and dissolves naturally as the line moves.
- Any change to accuracy spread, weapon range, reload time, or the AABB target-scan rect.
- Cavalry, artillery, melee. Cannon (solid-shot / shell) crews technically traverse the same state machine, so they will fall through the new path; their reload is long enough that the volley-window check is rarely hot, and even if it triggered, two cannon firing within 0.15 s of each other is fine.

## §1 · Architecture

### State machine — minimal change

Today: `Idle → Aiming(0.15 s) → Firing(1 tick) → Reloading → Idle`. The combat-system fires immediately on the first tick of `Idle` if a target is in range.

After: same states. The combat-system gains a hold-then-fire decision on each `Idle` tick:

```
on Idle tick (armed, at rest, target in range):
  if any same-team soldier has fired within VOLLEY_WINDOW_TICKS in our 3×3 cell neighbourhood:
    triggerFire(target, windup = JOIN_WINDUP_S)            // join volley
  else if stateT >= maxHoldFor(id):
    triggerFire(target, windup = AIMING_WINDUP)            // lead a new volley
  // else: wait, stateT is incremented by tickStates
```

A "volley signal" is just `world.fireSignal.tickByCellTeam[cellIndex * 2 + team]`. `fire-resolver.ts` writes one entry per shot at the firer's cell. The combat-system reads at most 9 entries per check (the 3×3 cells around the firer). No grid scan, no entity loop, O(1) per soldier per tick.

`triggerFire`'s second job — writing the `FireOrders` aim point and pivoting facing intent — is unchanged. It just gains an optional `windup` parameter (default `AIMING_WINDUP`) used to seed `e.stateT[id]`. Volley joiners pass `JOIN_WINDUP_S = 0`, so on the next `tickStates` pass they immediately resolve to `Firing`.

`tickStates` already decrements `e.stateT[id]` while in `Aiming`. We add two tiny pieces:
- On `Reloading → Idle`: reset `e.stateT[i] = 0`.
- While in `Idle`: `e.stateT[i] += dt`. (Re-using `stateT` as the "time spent ready" timer; combat-system reads it as `readyT`.)

### Targeting — closest, not first

`combat-system.ts:74-90` currently breaks on the first valid enemy in the candidate buffer. Replace the `break` with a closer-distance check that retains the running minimum. One extra branch, no extra grid work. Front rank shoots front rank; centre-line fire becomes more "head-on" instead of randomly selecting a target somewhere in the rect.

### Per-soldier `MAX_HOLD`, deterministic and free

Some soldiers must lead, others must follow. Rather than store a per-entity field, derive it at lookup time from a stable id-hash:

```ts
function maxHoldFor(id: number): number {
  // 0..1 from a cheap integer hash
  const h = ((Math.imul(id, 2654435761) ^ 0xdeadbeef) >>> 0) / 0x100000000;
  return MAX_HOLD_MIN_S + (MAX_HOLD_MAX_S - MAX_HOLD_MIN_S) * h;
}
```

Same hash mixer style as `pickClip` in `state-system.ts` — same numerical hygiene. A soldier with `maxHold ≈ 0.2 s` becomes a trigger-happy leader; `maxHold ≈ 0.6 s` always waits. With `MAX_HOLD_MIN_S = 0.20`, `MAX_HOLD_MAX_S = 0.60`, average ≈ 0.4 s.

### Why this gives the right feel

- **Ad-hoc clusters, not lockstep**: Cell radius is 3×3 of 2 m cells = ~6 m. In a 50-file × 8-rank line at 0.5 m × 0.6 m spacing that catches ~8–15 neighbours. Cells overlap at the boundary, so neighbouring clusters share a few seam soldiers — visible as "the volley rolls along" rather than "five independent walls of fire".
- **Stragglers fall out for free**: A soldier whose reload finishes mid-volley misses the window (signal age > `VOLLEY_WINDOW_TICKS`) and either lights its own ~0.4 s later, or catches the next one nearby.
- **Independent fire is just leader fire**: With per-soldier `maxHold` ranging 0.2–0.6 s, ~25 % of cycles produce leaders even before any signal exists, which keeps the line crackling between major volleys.
- **Cascades are bounded by the cell radius**: A leader's signal triggers joiners up to ~6 m away. Their fire writes new signals, which can trigger their neighbours. After 3–4 hops a cascade has spread ~20 m and naturally dies out as far ranks were never ready.

### Performance

Volley check is O(1) per soldier per tick — read up to 9 ints from a Int32Array. No allocations. The closest-enemy change only adds a branch inside the existing candidate loop. The AABB grid scan stays throttled at every 8 ticks via the existing `SCAN_PERIOD` gate; the volley check runs every tick without any scan. With 4 000 soldiers, worst case ~36 000 int reads per tick — negligible.

## §2 · Files & changes

| File | Role |
|---|---|
| `src/sim/world.ts` | Allocate `world.fireSignal: { tickByCellTeam: Int32Array }` sized to `grid.cols * grid.rows * 2`. Initialise to `-1` so "never fired" is unambiguous. |
| `src/sim/spatial/grid.ts` | Export `cellOf(g, x, y)` (currently file-local). Read-only re-export, no behavioural change. |
| `src/sim/fire-resolver.ts` | No signature change. Continues to spawn the projectile + FX + recoil. Signal-write happens in the caller (see `state-system.ts` below). |
| `src/sim/systems/state-system.ts` | (a) `triggerFire` gains optional `windup` param defaulting to `AIMING_WINDUP`. (b) On `Reloading → Idle`, reset `e.stateT[i] = 0`. (c) In the default branch (covers Idle), increment `e.stateT[i] += dt`. (d) `tickStates` gains a `fireSignal: FireSignal` parameter; when `resolveFire` returns `true`, write `fireSignal.tickByCellTeam[cellOf(grid, posX[i], posY[i]) * 2 + team[i]] = tick`. (e) Reload jitter is **kept** (`rng.range(0.8, 1.2)`) — see §1 rationale. |
| `src/sim/systems/combat-system.ts` | (a) Replace the first-match `break` with closest-enemy tracking. (b) Add the volley-signal lookup against the firer's 3×3 cell neighbourhood for the entity's own team. (c) Hold-then-fire decision: join with `JOIN_WINDUP_S` if signal hot, else fire with `AIMING_WINDUP` once `stateT >= maxHoldFor(id)`. (d) The existing fast-path (re-fire prev target without rescan) gains the same volley check. |
| `src/sim/systems/combat-system.test.ts` | New tests: nearest-enemy preference; lone soldier fires after `MAX_HOLD`; ready soldier with hot signal fires next tick; out-of-radius signal ignored; cross-team signal ignored; cascading cause-and-effect across two adjacent ready soldiers. |
| `src/sim/systems/state-system.test.ts` | Add tests: `stateT` accumulates during `Idle` and resets on `Reloading → Idle`; `tickStates` writes a `fireSignal` entry at the firer's cell on a successful resolve. |
| `src/main.ts` | Update the `stateSystem` adapter to thread `world.fireSignal` and `world.grid` (for `cellOf`) into `tickStates`. The `fireSignal` itself is allocated inside `createWorld`. |

### Tunables (one constant block in combat-system)

```ts
const VOLLEY_RADIUS_CELLS = 1;        // 3×3 neighbourhood (centre + 1 ring)
const VOLLEY_WINDOW_TICKS = 9;        // ~0.15 s at 60 Hz
const MAX_HOLD_MIN_S = 0.20;
const MAX_HOLD_MAX_S = 0.60;
const JOIN_WINDUP_S = 0.0;            // joiners fire on next state-system tick
```

### Data layout — `fireSignal`

```ts
interface FireSignal {
  tickByCellTeam: Int32Array;   // length = grid.cols * grid.rows * 2
  // index = cellIndex * 2 + team
  // value = tick of last fire from that team in that cell, or -1
}
```

Allocation cost: `512 cols × 512 rows × 2 × 4 B = 2 MB` for a 1024 m map at 2 m cells. Fine. Re-zeroed only on `createWorld`; reads use `tick - tickByCellTeam[i] <= VOLLEY_WINDOW_TICKS` (the `-1` sentinel is so far in the past it always fails this gate).

## §3 · Failure modes & how we avoid them

- **Cascade explosion across the whole line.** Bounded primarily by the kept ±20 % reload jitter — at any moment only a fraction of the line is in `Idle`, so contagion has at most that fraction to spread to. A cascade hops at ~16 ms per ring; in the ~0.15 s signal window it could in principle reach 50 m, but the only ready soldiers within that reach are the small cohort that finished reloading roughly when the leader did. The rest are still mid-`Reloading` and contribute nothing. Result: a localised wave of fire, not a line-wide thunderclap.
- **Dead-air pauses.** Caused if every soldier's `maxHold` ticked from a synchronous Idle entry. Mitigated by the kept reload jitter (cohorts arrive in distinct waves) and by the per-id `maxHold` spread (the impatient leader in any wave is always within 0.2 s).
- **Joiners with stale targets.** A soldier may have written `e.targetId` 1.5 s ago, then the target died. The fast-path target check (existing) already handles this; if the prev target is dead/out-of-range, falls back to grid scan. Volley check only runs if a valid target exists this tick.
- **Joiner facing wrong way.** `triggerFire` writes `facingIntent` toward the target. The 0.0 s windup means the joiner skips the visible aim wind-up but the facing-intent → render facing path still pivots them within the existing facing system. Visual artefact at most: one frame of "fire while still rotating" if the joiner had been facing far off. In practice they were already facing the front because they just finished reloading from the last volley.
- **First volley after spawn.** All soldiers start `Reloading` with random `reloadT` (existing `kind.baseStats.weaponReload * rng.range(0,1)` in `main.ts:127`). They become Idle scattered across one reload cycle, so the first volley is naturally fragmented — leaders fire across a 3-second band, not as a single thunderclap. Good.

## §4 · Test plan

Unit tests in `combat-system.test.ts`:

1. **Closest-enemy preference.** Spawn one team-0 firer, two team-1 enemies in range — one closer, one farther but earlier in id order. Run one tick; firer's `targetId` should be the closer one.
2. **Lone leader fires after MAX_HOLD.** One armed firer, no nearby same-team soldier, target in range. Tick the system + state-system at 60 Hz. Firer should remain `Idle` for `maxHoldFor(id)` seconds (within one tick), then transition to `Aiming`.
3. **Joiner fires next tick.** Place an `Aiming`-state soldier 4 m away (with `recoilT > 0` *or* fresh `fireSignal` in their cell). A second armed firer becomes `Idle`. After one combat-system tick + one state-system tick, the second firer should be in `Firing`/`Reloading` (i.e., it skipped windup).
4. **Out-of-radius signal ignored.** Same as (3) but place the firing event 10 m away (outside the 3×3 cell neighbourhood). The second firer should *not* short-circuit; it should fall through to the `MAX_HOLD` watchdog.
5. **Cross-team signal ignored.** A team-1 soldier fires; a team-0 firer becomes ready in the same cell. The team-0 firer should not pick up team-1's signal.
6. **Chained cascade.** Three soldiers in a line at 3 m spacing. The middle leader fires (write signal manually). On the next combat-system tick both flankers join. On the *following* tick, no further chain-reaction (their signal is in already-active cells). This pins the bounded-cascade behaviour.

Plus light tests for `state-system`:

- `stateT` increments while `Idle` and is reset to 0 on `Reloading → Idle`.
- After a successful `resolveFire`, the firer's cell entry in `world.fireSignal.tickByCellTeam` equals the current tick; entries for other cells / the other team are unchanged.

Manual browser verification:

- `npm run dev`, open `http://localhost:5173`, watch the two armies engage. Pre-change baseline is a uniform fizz; post-change should clearly read as cracks of overlapping fire, with visible "rolls" along each line.
- The streaks (already in WIP) make this much easier to see — you can watch a wave of ~10 streaks leave the line within a few frames.

## §5 · Why no persistent platoons

Briefly considered: assign a `platoonId` at spawn (each regiment partitioned into N-file blocks), have the platoon leader vote and gather ready peers each cycle. Rejected because:

- Adds a per-entity field and a spawn-time partitioning step.
- Stops working the moment the line moves, takes casualties, or scatters — `platoonId` becomes a label that no longer reflects spatial reality.
- Tunables (window, radius) are the same either way; the spawn-time data buys nothing the spatial check doesn't already give us.
- The user explicitly asked for "ad-hoc". Spatial contagion *is* ad-hoc.

If a future "fire by platoon" UI command needs an explicit grouping, we can add `platoonId` then with no impact on this work — combat-system would simply gate the volley check on a flag. Not blocking it now keeps the v1 narrow.
