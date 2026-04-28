# Per-Unit Identity & Stats

**Date:** 2026-04-27
**Status:** Approved (inline brainstorm)

## Goal & scope

Each soldier has a name, age, and hometown drawn from a faction-appropriate language pool, plus per-unit lifetime stats (kills, damage dealt) accumulated during a battle. The unit-inspector panel surfaces this for the selected soldier.

Sits on top of the already-shipped veterancy spec (`2026-04-27-veterancy-and-stats-design.md`). The same `applyHit()` hook that credits XP also credits per-unit kills/damage; the same selection panel that shows rank also shows identity.

### In scope
- Per-entity SoA fields on `Entities`:
  - `firstNameIdx: Uint16Array` — index into the unit's faction first-name pool
  - `lastNameIdx: Uint16Array` — index into the unit's faction last-name pool
  - `hometownIdx: Uint16Array` — index into the unit's faction hometown pool
  - `themeId: Uint8Array` — which name-bank theme this unit was rolled from (decouples theme from team for future flexibility)
  - `ageYears: Uint8Array` — clamped 16..55
  - `kills: Uint16Array` — confirmed kills credited to this unit (saturates at 65535)
  - `damageDealt: Uint32Array` — accumulated effective damage dealt to enemies
- A static name bank at `src/data/name-bank.json` with **two themes**:
  - `english` — Napoleonic British/Coalition (English/Scottish/Welsh/Irish first names + surnames + UK/Ireland-era hometowns)
  - `french` — Napoleonic French (French first names + surnames + French hometowns of the era)
- An offline generator script `scripts/generate-name-bank.ts` that calls the xAI Grok API (`https://api.x.ai/v1/chat/completions`, `grok-4` model) to produce the JSON. Uses `XAI_API_KEY` from env. The script is run by hand; its output is committed.
- A small fallback bank seeded inline in the generator script (≈40 names per pool, hand-curated) used when `XAI_API_KEY` is not set, so the feature works end-to-end without an API key. Re-running with the key produces a richer bank (target: 400 first names, 400 last names, 200 hometowns per theme).
- Team→theme mapping at one config point in `main.ts` (team 0 → `english`, team 1 → `french`); easy to rename/extend.
- Spawn-time identity assignment: `spawn()` rolls indices using the world RNG and writes them to the entity. Age is sampled from a Gaussian (μ=24, σ=6) clamped to [16, 55].
- Stat accounting in `applyHit()`: increments `damageDealt` on every hit (effective dmg, post-armor) and `kills` on lethal hit. Reuses the existing attacker-validity guard.
- Inspector panel extension: when exactly one entity is selected, render an "Identity" subsection: full name, age, hometown, kills, damage dealt. Existing rank/XP display is unchanged.
- Tests: spawn fills identity fields; bank lookup resolves indices to strings; `applyHit` credits kills+damageDealt under the same guard as XP; identity panel renders.

### Out of scope
- **Persistence across battles.** No save/load. Identity is per-battle only.
- **Per-faction theming beyond two pools.** Schema supports `themes: Record<string, ...>` so adding more themes is a data change, not a code change. Ship 2 themes.
- **Themed pools per unit-kind** (e.g. cavalry vs infantry name pools). Single pool per faction in v1.
- **Nicknames, traits, family, biographical text.** Indices keep this trivially extensible later.
- **Death log / battle honors / kill feed.** Kills counter is enough for now.
- **Officer / commander special names.** Captain-rank soldiers use the same pools.
- **Localization of UI strings.** Pool data is in-language; UI labels stay English.

## Data model

### Name-bank JSON shape
File: `src/data/name-bank.json` (committed).

```json
{
  "version": 1,
  "themes": {
    "english": {
      "firstNames": ["John", "William", "James", ...],
      "lastNames":  ["Smith", "Jones", "Brown", ...],
      "hometowns":  ["London", "Bristol", "Edinburgh", ...]
    },
    "french": {
      "firstNames": ["Jean", "Pierre", "Louis", ...],
      "lastNames":  ["Martin", "Dubois", "Lefebvre", ...],
      "hometowns":  ["Paris", "Lyon", "Marseille", ...]
    }
  }
}
```

Each pool length must be ≤ 65535 (Uint16 index). Targets: 400/400/200 per theme when generated via Grok; minimum (fallback) ≈ 40/40/30.

### Theme registry
File: `src/data/name-bank.ts` — small loader that imports the JSON, exposes `themeIds` (numeric 0..N-1 for SoA storage), and provides `lookupName(themeId, firstNameIdx, lastNameIdx) → string` and similar for hometown. The string→numeric `themeId` map is built at startup from the JSON keys, sorted so order is deterministic.

### Team→theme mapping
File: `src/main.ts`, single const:
```ts
const FACTION_THEMES: Record<number, string> = { 0: 'english', 1: 'french' };
```
`spawn()` resolves `themeId` from the team via this map, then rolls indices against the chosen theme's pool sizes.

### Entity SoA additions
All initialized to 0 in `allocEntity`. Lookups happen at UI render-time, never per-tick.

## Generator script

`scripts/generate-name-bank.ts`, run with `npx tsx scripts/generate-name-bank.ts`.

Behavior:
1. Reads `XAI_API_KEY` from env. If missing, writes the inline fallback bank and exits 0 with a warning.
2. For each theme, makes one API call per pool kind (3 per theme, 6 total) asking Grok for a JSON array of N entries with a faction- and era-appropriate prompt:
   - English first names: "Period-appropriate masculine given names of British, Scottish, Welsh, and Irish soldiers c.1800–1815. JSON array of 400 unique strings, no diacritics."
   - English last names: similar, "common surnames in the British Isles c.1800".
   - English hometowns: "real towns and cities in England, Scotland, Wales, and Ireland that existed c.1805. JSON array of 200 unique strings."
   - French equivalents with appropriate phrasing (diacritics retained for French).
3. Validates each response is a JSON array of strings, dedupes, enforces size cap (≤65535).
4. Writes `src/data/name-bank.json` (overwrite). Pretty-printed.
5. Prints a one-line summary: `english: 400/400/200, french: 400/400/200`.

The script is offline tooling; not bundled in dist.

## applyHit hook

Inside `src/sim/systems/combat-events.ts`, in the existing attacker-validity guard (lines 97–101 today):

```ts
if (
  attackerId !== -1 &&
  e.alive[attackerId] === 1 &&
  !isDead(e, attackerId) &&
  e.team[attackerId] !== e.team[id]
) {
  // existing: damage credit happens for *every* hit, not just lethal
  if (e.damageDealt[attackerId]! < 0xffffffff) {
    e.damageDealt[attackerId] = e.damageDealt[attackerId]! + effDmg;
  }
  if (lethal) {
    if (e.kills[attackerId]! < 0xffff) e.kills[attackerId] = e.kills[attackerId]! + 1;
    // existing xp/promote stays as-is
  }
}
```

Subtle structural change: today the attacker-credit block only runs on lethal hits. We need to credit damage on every hit, so the guard moves up one level so both branches share it. The existing XP/promote logic stays inside the `if (lethal)` arm, semantics unchanged.

## UI

Selection panel (the in-game one, not `unit-inspector.html`) gains an "Identity" section when `selection.ids.size === 1`:

```
{First} {Last}, age {N}
{Hometown}
Kills: {kills}   Damage: {damageDealt}
```

Render only the new section; everything else is untouched. If the selected entity's `themeId` resolves to an unknown theme (defensive), render `Unknown ?, age ?` and continue — no throw.

## Testing

Unit tests:
- `name-bank.test.ts` — loader resolves indices to strings; out-of-range indices return placeholders; theme registry assigns stable numeric ids.
- `entities.test.ts` (extension) — `allocEntity` zeroes the new fields.
- `spawn.test.ts` (or wherever spawn is exercised) — after `spawn(kindId, team, ...)`, the entity has nonzero name indices and an age in [16, 55] for both themes.
- `combat-events.test.ts` (extension) — hit credits `damageDealt`; lethal hit credits both `damageDealt` and `kills`; friendly fire / dead attacker / no attacker each credit nothing; saturation at 0xffff and 0xffffffff.

No browser/UI tests; the inspector panel addition is small enough to verify by hand alongside the existing rank panel.
