# Dead State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Dying`/`Dead` entities behave like corpses: not selectable, not previewable, not order-executing, not movable. Use a single `isDead(e, id)` predicate everywhere.

**Spec:** `docs/superpowers/specs/2026-04-27-dead-state-design.md`

**Working tree:** `.worktrees/dead-state` on branch `feat/dead-state`. Run all commands from there.

**Tech:** TypeScript, Vitest (`npx vitest run`). TDD per task — write a failing test, then make it pass.

---

## File structure

| File | Role |
|---|---|
| `src/sim/entities.ts` | Add `isDead(e, id)` helper. |
| `src/sim/entities.test.ts` | Test `isDead` for each `EntityState` value. |
| `src/input/selection.ts` | Add `&& !isDead` to all 3 hit-test functions. |
| `src/input/selection-controller.ts` | Filter `liveFormationUnits` and group-recall by `!isDead`; auto-prune dead from `selection.ids` in `update`. |
| `src/render/passes/selection-pass.ts` | Filter every alive-only loop by `!isDead`. |
| `src/sim/systems/orders-system.ts` | Skip dying/dead in main loop. |
| `src/sim/systems/movement-system.ts` | Skip dying/dead in velocity integration. |
| `src/sim/systems/orders-system.test.ts` | New: dying unit doesn't move under queued order. |
| `src/sim/systems/movement-system.test.ts` | Extend: dying unit with velocity is not integrated. |
| `src/input/selection.test.ts` (new or existing) | Hit-test exclusion of dying/dead. |
| `src/input/selection-controller.test.ts` (existing if present) | Auto-prune + formation/group-recall exclusion. |

No new source files outside the above. Pose manifest is verified, not edited.

---

## Task 1 — `isDead` helper + test

- [ ] **Step 1.** Add a failing test in `src/sim/entities.test.ts`:
  - `isDead` returns `false` for every `EntityState` value except `Dying` and `Dead`.
  - `isDead` returns `true` for `Dying` and `Dead`.
- [ ] **Step 2.** Implement `export function isDead(e: Entities, id: number): boolean` in `src/sim/entities.ts` next to `isAlive`. Body:
  ```ts
  const s = e.state[id]!;
  return s === EntityState.Dying || s === EntityState.Dead;
  ```
- [ ] **Step 3.** `npx vitest run src/sim/entities.test.ts` — green.

## Task 2 — Selection hit-tests skip dying/dead

- [ ] **Step 1.** In `src/input/selection.test.ts` (create if missing), add three failing tests:
  - `hitTestPoint` returns `-1` when the only candidate at the point is `Dying`/`Dead`.
  - `hitTestRect` excludes a `Dying` unit inside the rect.
  - `findSameKindInView` excludes a `Dead` unit of the same kind.
- [ ] **Step 2.** Add `if (isDead(e, i)) continue;` after each existing `alive` guard in `selection.ts:79-93`, `selection.ts:104-112`, and `selection.ts:122-131`. Import `isDead` from `../sim/entities`.
- [ ] **Step 3.** `npx vitest run src/input/selection.test.ts` — green.

## Task 3 — Formation + group-recall exclude dying/dead

- [ ] **Step 1.** In `src/input/selection-controller.test.ts` (create if missing — there may already be one), add failing tests:
  - `liveFormationUnits` (call via the controller's test seam if exposed; otherwise copy the helper's logic and assert) skips a unit whose state is `Dying`.
  - Group recall (plain digit) does not add a `Dead` group member to selection.
  - Group merge (Shift+digit) does not add a `Dying` group member.
- [ ] **Step 2.** In `selection-controller.ts:105`, change the `e.alive[id] !== 1` continue to also skip dying/dead. Same for the two `groups[digit]` loops at `selection-controller.ts:312-314` and `319-321`.
- [ ] **Step 3.** Tests green.

## Task 4 — Auto-prune selection each frame

- [ ] **Step 1.** Failing test in `selection-controller.test.ts`: a unit selected, then state set to `Dying`, then `controller.update(0.016)` called → `selection.ids` no longer contains it.
- [ ] **Step 2.** In `selection-controller.ts`'s returned `update(dt)`, before the existing cursor-mode reset, iterate `selection.ids` and `delete` any id where `isDead(world.entities, id)` or `world.entities.alive[id] !== 1`.
- [ ] **Step 3.** Test green.

## Task 5 — Selection-pass overlays skip dying/dead

- [ ] **Step 1.** Visual / integration: there are no unit tests for the GL pass. Inspect each spot below and add an `isDead` short-circuit alongside the existing `alive` check — no test.
  - `selection-pass.ts:159` (`collectTeamRangeIds`)
  - `selection-pass.ts:186` (`computeRangeOverlay` per-id loop)
  - `selection-pass.ts:443-444` (`emit` inside `drawDiscs`)
  - `selection-pass.ts:493-498` (`drawTeamRange` selected-loop guard)
  - `selection-pass.ts:829` (`drawMovePreview` selected loop)
  - `selection-pass.ts:842` (`drawMovePreview` unselected loop)
- [ ] **Step 2.** Import `isDead` from `../../sim/entities` if not already imported.
- [ ] **Step 3.** `npx vitest run` — confirm no test regressions.

## Task 6 — Orders-system skips dying/dead

- [ ] **Step 1.** Failing test in `src/sim/systems/orders-system.test.ts` (create if missing):
  - Unit with a queued `move` order to `(50, 0)`, state set to `Dying`, run `ordersSystem(world, 1/60)` → `velX` and `velY` stay 0; queue length unchanged.
  - Same setup but state = `Dead` → same result.
- [ ] **Step 2.** In `orders-system.ts:13`, change the alive guard to also short-circuit when `isDead`. Choose: simple `continue` (don't process) — leave the queue alone (Dying never recovers; Dead stays queued harmlessly).
- [ ] **Step 3.** Test green.

## Task 7 — Movement-system skips dying/dead

- [ ] **Step 1.** Failing test in `src/sim/systems/movement-system.test.ts` (extend if present):
  - Unit at `(0, 0)` with `velX = 5`, state = `Dying`, run movement integrator with `dt = 0.1` → `posX` stays 0.
- [ ] **Step 2.** In `movement-system.ts:6`, add `|| isDead(e, i)` to the alive guard.
- [ ] **Step 3.** Test green.

## Task 8 — Verify dead pose available

- [ ] **Step 1.** `grep -r "dead" src/render/poses/ public/sprites/poses/ scripts/` to confirm the manifest knows about a `dead` pose for at least one unit kind.
- [ ] **Step 2.** If absent for a given kind, the existing pose-pass fallback handles it — no code change. If absent for ALL kinds, note in the implementation summary so the user can add art later.

## Task 9 — Full test sweep

- [ ] **Step 1.** `npx vitest run` from `.worktrees/dead-state`. All previously-passing tests still pass; the pre-existing `emitDust merging` failure is unchanged. New tests pass.
- [ ] **Step 2.** Report a one-paragraph summary: what changed, what the new test counts are, any sprite-asset gaps.

---

## Notes

- Touch nothing outside the file list above.
- Don't add comments unless the WHY is non-obvious.
- Don't refactor existing alive guards beyond adding the new predicate.
- Don't commit — leave that to the user.
