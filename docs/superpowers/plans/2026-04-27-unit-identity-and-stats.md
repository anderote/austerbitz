# Plan: Per-Unit Identity & Stats

**Spec:** `docs/superpowers/specs/2026-04-27-unit-identity-and-stats-design.md`
**Date:** 2026-04-27

## Phases

### Phase 1 — Name bank (data + generator)
Independent of all code changes. Can run first or in parallel with Phase 2.

1. Write `scripts/generate-name-bank.ts`:
   - Reads `XAI_API_KEY`. If missing → write inline fallback bank and exit.
   - If present → call xAI Grok API (`grok-4`) once per (theme, pool-kind), validate, dedupe, write JSON.
   - Inline fallback: ≈40 first names + 40 last names + 30 hometowns per theme, hand-curated, period-appropriate.
2. Run `npx tsx scripts/generate-name-bank.ts` once. Commit `src/data/name-bank.json`.
3. Write `src/data/name-bank.ts` loader:
   - `import bank from './name-bank.json'`
   - Build deterministic `themeIds: Record<string, number>` (sorted keys → 0,1,...).
   - Export `themeNameOf(id: number)`, `firstNameOf(themeId, idx)`, `lastNameOf(themeId, idx)`, `hometownOf(themeId, idx)`, `poolSizes(themeId): { first, last, town }`.
   - Defensive lookups return `'?'` for out-of-range / unknown.

**Files touched:**
- `scripts/generate-name-bank.ts` (new)
- `src/data/name-bank.json` (new, generated)
- `src/data/name-bank.ts` (new)

**Tests:** `src/data/name-bank.test.ts` — loader correctness, deterministic theme ids, defensive lookups.

### Phase 2 — Entity SoA fields
Foundation for Phase 3 and Phase 4.

1. In `src/sim/entities.ts`, extend `Entities` with: `firstNameIdx`, `lastNameIdx`, `hometownIdx`, `themeId` (Uint8Array), `ageYears` (Uint8Array), `kills` (Uint16Array), `damageDealt` (Uint32Array).
2. Allocate them in `createEntities`.
3. Zero them in `allocEntity` (alongside the existing field resets).

**Files touched:** `src/sim/entities.ts` only.

**Tests:** `src/sim/entities.test.ts` (or new) — `allocEntity` sets all new fields to 0.

### Phase 3 — Spawn-time identity assignment
Depends on Phase 1 (loader) + Phase 2 (fields).

1. In `src/main.ts`:
   - Add `const FACTION_THEMES: Record<number, string> = { 0: 'english', 1: 'french' };`
   - In `spawn()`, after `world.entities.team[id] = team;`:
     - Resolve `themeName = FACTION_THEMES[team] ?? 'english'`.
     - Look up `themeId` and pool sizes via the loader.
     - Roll `firstNameIdx`, `lastNameIdx`, `hometownIdx` with `world.rng.intRange(0, size)`.
     - Roll `ageYears` from a clamped Gaussian (μ=24, σ=6, clamped to [16,55]). Use existing rng helpers; if no Gaussian helper exists, build one inline as Box-Muller from two `rng.range(0,1)` draws.
     - Write all fields to the entity.
2. No change to `spawnFormationBlock` / `spawnArmy` — they already call `spawn()`.

**Files touched:** `src/main.ts` only.

**Tests:** `src/main.spawn.test.ts` (or extend an existing test) — spawn(team=0) yields a unit with `themeId === themeIds.english` and indices in pool range; spawn(team=1) yields `themeId === themeIds.french`; age is in [16,55]; many spawns produce a spread (not all the same age/name).

### Phase 4 — applyHit stats hook
Depends on Phase 2 (fields). Independent of Phase 1/3.

1. In `src/sim/systems/combat-events.ts`, restructure the attacker-credit block in `applyHit`:
   - Hoist the attacker-validity guard so it runs for every hit, not just lethal.
   - Inside the guard, always credit `damageDealt` (with 0xffffffff saturation).
   - Keep XP credit + promotion inside the existing `if (lethal)` block, and additionally credit `kills` (with 0xffff saturation) there.

2. Verify no other callers of `applyHit` are broken — the function signature is unchanged.

**Files touched:** `src/sim/systems/combat-events.ts` only.

**Tests:** extend `src/sim/systems/combat-events.test.ts` (or wherever the existing applyHit tests live; if not present, create `combat-events.stats.test.ts`):
   - Non-lethal hit by valid attacker: `damageDealt` increments, `kills` does not.
   - Lethal hit by valid attacker: both increment.
   - Friendly-fire / no attacker / dead attacker: neither increments.
   - Saturation: damageDealt at 0xfffffffe + 5 dmg saturates to 0xffffffff (not overflow); kills at 0xfffe + 1 → 0xffff, +1 again → still 0xffff.

### Phase 5 — Inspector UI
Depends on Phases 1, 2, 3 (needs fields populated). Independent of Phase 4 (works without kills/damage; they just stay 0).

1. Locate the existing single-unit selection panel (likely `src/ui/selection-panel.ts` or similar — find it by searching for the rank/XP rendering added in the veterancy spec).
2. Add an Identity subsection rendered when `selection.ids.size === 1`:
   ```
   {First} {Last}, age {N}
   {Hometown}
   Kills: {kills}   Damage: {damageDealt}
   ```
3. Use the loader functions to resolve indices → strings. Defensive: unknown theme renders `?` and does not throw.

**Files touched:** the selection-panel file + maybe a small CSS tweak.

**Tests:** none mandatory — verify by hand alongside the existing rank/XP display.

## Order of execution
- **Parallelizable:** Phase 1 ‖ Phase 2 ‖ Phase 4 (Phase 4 doesn't read names; it only writes the new stats fields, which Phase 2 declares).
  - Actually Phase 4 needs Phase 2's fields. So: (Phase 1) ‖ (Phase 2 → Phase 4).
- **Sequential after that:** Phase 3 (needs 1+2), then Phase 5 (needs 1+2+3; benefits from 4).

Recommended dispatch:
1. Round 1 (parallel): Phase 1 + Phase 2.
2. Round 2 (parallel): Phase 3 + Phase 4.
3. Round 3: Phase 5.
4. Final: full test run + manual smoke test.

## Verification (end of Phase 5)
- `npm run typecheck` clean.
- `npm test` clean (all new + existing tests pass).
- Manually start dev server, select a single soldier from each team — confirm name, age, hometown, kills, damage render and update during combat.
