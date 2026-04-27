# Veterancy & Stats Wiring

**Date:** 2026-04-27
**Status:** Approved (inline brainstorm)

## Goal & scope

Two related pieces of work, one spec:

1. **Stats wiring fixes** — three fields on `BaseStats` are defined but not actually consumed by the sim. Make `weaponDamage` the single source of truth, wire `sightRange` to target acquisition, and explicitly mark `morale` as deferred.
2. **Per-soldier veterancy** — soldiers earn XP from confirmed kills and rank up (Recruit → Veteran → Sergeant → Sgt. Major → Captain), with stat multipliers applied on read at fire-time, and a small pixel-art rank icon rendered in the world below each soldier's feet (C&C-style).

### In scope
- `BaseStats.weaponDamage` becomes a true override read by `fire-resolver` (replacing the hard-coded `weapon.projectile.damage`); upgrades and veterancy multiply this single value.
- `BaseStats.sightRange` becomes the AABB scan radius in `combat-system`; `weaponRange` remains the gating predicate before triggering fire.
- Per-entity `rank: Uint8Array` and `xp: Uint16Array` fields on `Entities`.
- Per-projectile `ownerId: Int32Array` on `Projectiles` (-1 if no owner — explosions/world-spawned).
- `applyHit` credits XP to `ownerId` on confirmed kill (musket, solid-shot, shell, explosion).
- Effective-stat helpers (`effectiveDamage`, `effectiveAccuracy`, `effectiveReload`, `effectiveArmor`) used by `fire-resolver`, `state-system`, and `combat-events`.
- New render pass `rank-pass.ts` drawing a 16×16 pixel-art rank icon below each soldier's foot line.
- Tiny "promotion sparkle" particle emitted on rank up (cute pixel touch).
- UI: stats card shows rank distribution; unit inspector shows rank label + XP toward next promotion.
- Tests covering: XP credit through every projectile path, promotion thresholds, stat multipliers, sightRange-vs-weaponRange acquisition split, `weaponDamage` flowing through fire-resolver.

### Out of scope
- **Morale wiring.** `morale` stays defined, stored, and displayed but unconsumed by sim behavior. Routing/breaking is its own future spec.
- **Veterancy persistence across battles.** Single-battle progression only. No save/load of XP.
- **Officer entities.** "Captain" here is a per-soldier rank icon; no command radius, no aura, no separate unit kind.
- **Veterancy decay** or rank inheritance when a unit replaces another.
- **Rank-based AI behavior** beyond the stat multipliers (no "veterans hold their ground better"; that needs morale first).
- **Cavalry / artillery icons** — same rank system applies, same icon atlas, but tuned cell sizes per kind are deferred; v1 ships infantry icons sized to infantry sprites and reuses the same world size for cavalry/artillery.

## §1 · Stats wiring fixes (Part A)

### A.1 — `weaponDamage` becomes authoritative

Today `fire-resolver` reads `weapon.projectile.damage` directly. The `BaseStats.weaponDamage` field is shown in the UI but never reaches a projectile. This means upgrades or veterancy multiplying `weaponDamage` would silently do nothing.

**Change:** `fire-resolver` reads damage from `kind.baseStats.weaponDamage` and passes it into `spawnMusketBall` / `spawnSolidShot` / `spawnShell`. The weapon profile keeps `projectile.damage` as the **default** value the unit kind copies, but the unit kind's value is the source of truth at fire-time. (Concretely: existing unit kinds already declare `weaponDamage` matching their weapon's projectile damage; we just start reading the unit-kind value.)

This makes one place to apply rank multipliers and one place for upgrades to land later.

### A.2 — `sightRange` drives acquisition, `weaponRange` gates firing

Today `combat-system` does a single AABB query at `weaponRange` for both "is there a target?" and "should I shoot?". A unit can't see anything beyond the range of its own gun, which isn't what `sightRange` is for, and prevents the C&C-style "crosshair on soldier in range of an enemy" UI from working naturally.

**Change:** the AABB scan uses `sightRange`. After a candidate is selected, the existing `d² ≤ weaponRange²` check still gates the actual fire trigger. So a unit acquires/tracks a target it sees but only fires once that target is within gun range.

Effect on existing behavior is small in practice — `sightRange` ≥ `weaponRange` for every existing unit kind, so today's behavior is preserved when `sightRange == weaponRange` and only widens when it's larger. No gameplay regression.

### A.3 — `morale` documented as deferred

`Entities.morale` remains a `Uint8Array` initialized to 200 at spawn, summed by stats card, displayed in unit inspector. No sim consumer is added in this spec. A `// TODO(morale): routing system` comment marks the gap. Future work: rout/break behavior in its own spec.

## §2 · Veterancy data model (Part B)

### Per-entity fields
Add to `Entities`:
- `rank: Uint8Array` — 0..4 (Recruit, Veteran, Sergeant, Sgt. Major, Captain).
- `xp: Uint16Array` — kill count toward next promotion. Saturates at 65535 (irrelevant in practice; max meaningful is ~30).

Initialized to 0 in `allocEntity`.

### Per-projectile field
Add to `Projectiles`:
- `ownerId: Int32Array` — entity id of the firer, or -1 for ownerless (explosions whose owner has died, world-spawned).

`spawnMusketBall`, `spawnSolidShot`, `spawnShell` gain an `ownerId` parameter. `fire-resolver` passes `id`. When a shell detonates and spawns secondary damage via `spawnExplosion`, the explosion carries the shell's `ownerId` so kills credit the firer.

Initialized to -1 in `allocProjectile`.

### Rank table

| Rank | Name | XP to reach | Cumulative kills | Icon |
|---|---|---|---|---|
| 0 | Recruit | — | 0 | (none) |
| 1 | Veteran | 1 | 1 | 1 chevron |
| 2 | Sergeant | 2 | 3 | 2 chevrons |
| 3 | Sgt. Major | 4 | 7 | 3 chevrons |
| 4 | Captain | 8 | 15 | gold star |

`xp` resets to 0 on each promotion and counts kills toward the next threshold. Once at rank 4, `xp` stops accumulating (or accumulates harmlessly — display caps at "Captain"; we let it saturate to avoid a branch).

Encoded as a single `RANK_THRESHOLDS = [1, 2, 4, 8]` array indexed by current rank.

### Stat multipliers

| Rank | dmg ×  | acc + | reload × | armor + |
|---|---|---|---|---|
| 0 | 1.00 | +0.00 | 1.00 | +0 |
| 1 | 1.05 | +0.05 | 0.95 | +0 |
| 2 | 1.10 | +0.10 | 0.90 | +1 |
| 3 | 1.15 | +0.15 | 0.85 | +1 |
| 4 | 1.25 | +0.20 | 0.75 | +2 |

Stored as four parallel `Float32Array`-typed constant tables in a new `src/sim/veterancy.ts`. Helpers:

```ts
function effectiveDamage(e: Entities, id: number, baseDamage: number): number;
function effectiveAccuracy(e: Entities, id: number, baseAccuracy: number): number;
function effectiveReload(e: Entities, id: number, baseReload: number): number;
function effectiveArmor(e: Entities, id: number, baseArmor: number): number;
```

Each clamps where it must (`accuracy ≤ 0.99`, `reload > 0.05 s`).

### XP credit

`applyHit(e, particles, rng, id, dmg, impX, impY, kind, splats)` gains an `attackerId` parameter (or, more cheaply, callers pass it via the `_kind` slot — but explicit is clearer). When the hit drops `hp` to 0 and `attackerId !== -1` and `attackerId` is alive and not on the same team:

1. Increment `xp[attackerId]`.
2. If `xp[attackerId] >= RANK_THRESHOLDS[rank[attackerId]]` and rank < 4, increment rank and reset xp to 0. Emit a small "promotion sparkle" particle burst at the attacker's position.

Friendly fire does **not** grant XP. Explosions credit the shell's firer for every kill in the AoE, including the original target. Solid-shot ricochet kills all credit the same firer.

Edge cases:
- Attacker dies between firing and the projectile landing: XP is dropped (alive check). This is fine and avoids zombie-credit.
- Attacker promoted/freed and the slot reused for a different unit before the projectile lands: extremely rare given combat tempo, but possible. We accept the inaccuracy — the alive check is a soft guard, not a strict identity check. (A generation counter is too much machinery for the gain.)

## §3 · Rank icon rendering (Part B continued)

### Atlas

A new 64×16 pixel atlas `public/sprites/rank-icons.png`:

| Cell | Rank | Sprite |
|---|---|---|
| 0 (0..15) | Veteran | 1 chevron, gold (#f6d35a) with 1px dark outline (#3a2a18) |
| 1 (16..31) | Sergeant | 2 chevrons stacked |
| 2 (32..47) | Sgt. Major | 3 chevrons stacked |
| 3 (48..63) | Captain | small 5×5 gold star with 1px dark outline + tiny laurel dots |

Each chevron is ~3px tall, ~10px wide, V-shape pointing down (military convention is points-up but down reads better below the feet). Spacing 1px between stacked chevrons. Cell vertical center is the icon center; cell width is the full 16px so even the 1-chevron Veteran has the same horizontal footprint as Captain — keeps the on-screen position stable across promotions.

Recruit (rank 0) is **not in the atlas** — no icon drawn at all.

### Pass

New `src/render/passes/rank-pass.ts` mirroring `health-bar-pass.ts`:

- One quad instance per non-Recruit alive entity.
- Position: `(posX, posY + footYFromCenter + h/2 + ICON_GAP)` — i.e., directly below the foot line, where `footYFromCenter` already accounts for sprite padding. `ICON_GAP = 0.05 m`.
- World size: `0.6 m × 0.15 m` (Veteran) up to `0.6 m × 0.55 m` for Captain — the cell-height grows with rank so 3-chevron Sgt. Major reads as taller than 1-chevron Veteran. Concretely: width is fixed 0.6 m; height is `cell-pixels / 16 * 0.6 * (16/16) = cell-pixels / 16 * 0.6 m` per chevron-row, stacking from the foot line upward — wait no, *downward* (below feet). See "Layout" below.
- Texture: the rank-icon atlas, sampled by rank index.
- Hard pixel edges (`gl.NEAREST` min+mag filter) per the global pixel-art rule.
- Culling: skip entities at `cam.zoomPxPerWorld < 6` (icon would be sub-pixel anyway).

### Layout precision

Foot line on a soldier sprite sits at `entity.posY + footYFromCenter` (note: existing `footYFromCenter` is *from* the sprite center — for line-infantry, +0.625 m below center). The icon is placed:

```
iconCenterY = posY + footYFromCenter + ICON_GAP + iconHalfHeight
```

So the icon sits flush below the feet, centered on `posX`. Width 0.6 m, height per rank:
- Veteran (1 chevron): 0.15 m tall.
- Sergeant (2 chevrons): 0.25 m tall.
- Sgt. Major (3 chevrons): 0.35 m tall.
- Captain (star): 0.25 m tall.

These heights are tuned so the icon doesn't crowd the next rank below in dense formations (formation y-spacing for line-infantry is 1.2 m; max icon height 0.35 m + gap 0.05 m fits comfortably).

Atlas cell selection in the shader: a uniform `u_iconCellHeight` per draw is overkill. Simpler: pack each rank's variable-height image into the **bottom** of its 16-px-tall cell, sample by rank, and let the unused top rows be transparent. Then a fixed 0.6 × 0.6 m world quad per icon works for every rank and the visual heights above are achieved purely by the transparent padding in the texture. Way fewer moving parts.

So: **all icons are drawn at fixed 0.6 m × 0.6 m world quads, anchored so the cell bottom is at the foot line + ICON_GAP**. The atlas itself encodes the apparent height.

### Promotion sparkle

When `applyHit` credits a kill that triggers promotion, emit ~6 tiny gold particles at the attacker's position, slow upward drift, ~0.4 s life. Reuse `Particles` (the same buffer used for blood/dust). Add a new emitter `emitPromotionSparkle(particles, x, y, rng)`. Cute, minimal, drops out of the hot path if no promotion occurred.

## §4 · UI surfaces

### Stats card (`src/ui/stats-card.ts`)

Add a "Rank mix" row when ≥1 selected unit has rank > 0:

```
Rank: 12 Rec · 5 Vet · 2 Sgt
```

Use short tags. Hide the row entirely if every selected soldier is Recruit (no signal yet).

### Unit inspector (`src/dev/unit-inspector.ts`)

Show:
- `Rank: Sergeant`
- `XP: 1 / 4` (i.e., kills toward next promotion; "—" at Captain).

## §5 · Test coverage

New / updated tests:

1. **`veterancy.test.ts`** — `effectiveDamage`/`Accuracy`/`Reload`/`Armor` produce correct values for each rank; clamps work; rank 0 returns base values unchanged.
2. **`combat-events.test.ts` additions** — XP credit on confirmed kill via musket; no XP on flinch-only hit; no XP on friendly fire; promotion at threshold resets `xp` and emits sparkle.
3. **`fire-resolver.test.ts` additions** — projectile spawned with correct `ownerId`; veteran-rank firer launches projectile with rank-multiplied damage.
4. **`projectile-system.test.ts` additions** — solid-shot kills credit the firer for each plowed-through entity; explosion kills credit the shell's owner.
5. **`combat-system.test.ts` additions** — sightRange-driven acquisition: target outside `weaponRange` but inside `sightRange` is acquired (`targetId` set) but no fire triggered; once in `weaponRange`, fire triggers.
6. **`stats-card.test.ts`** (if it exists; otherwise add a minimal one) — rank-mix row formatting.

## §6 · File touch-list

**New files:**
- `src/sim/veterancy.ts` — rank table, thresholds, effective-stat helpers.
- `src/sim/veterancy.test.ts`.
- `src/render/passes/rank-pass.ts` + `.test.ts`.
- `src/render/shaders/rank.glsl.ts` (mirroring existing shader-string modules).
- `public/sprites/rank-icons.png` — the 4-cell atlas (drawn pixel-by-pixel; 64×16 PNG, will commit alongside).

**Modified:**
- `src/sim/entities.ts` — add `rank`, `xp` fields + reset.
- `src/sim/projectiles.ts` — add `ownerId` field + `spawnMusketBall/SolidShot/Shell` signatures.
- `src/sim/fire-resolver.ts` — pass `ownerId`, read `kind.baseStats.weaponDamage`, apply rank multipliers via helpers.
- `src/sim/systems/combat-events.ts` — `applyHit` gains `attackerId`, credits XP on kill, emits sparkle on promotion. Apply `effectiveArmor`.
- `src/sim/systems/combat-system.ts` — switch AABB scan to `sightRange`, keep `weaponRange²` predicate before triggering fire.
- `src/sim/systems/state-system.ts` — `effectiveReload` when restarting reload.
- `src/sim/systems/projectile-system.ts` — pass `ownerId` from projectile into `applyHit`; same for explosion-spawned damage.
- `src/fx/explosion.ts` — accept `ownerId`, forward to `applyHit`.
- `src/particles/emitters.ts` — `emitPromotionSparkle`.
- `src/ui/stats-card.ts` — rank-mix row.
- `src/dev/unit-inspector.ts` — rank + XP rows.
- `src/render/world.ts` (or wherever passes register) — wire up `rank-pass` after `health-bar-pass`.

## §7 · Risk & open questions

- **Performance:** another world-space instanced pass at up to 4000 entities. Health-bar pass already does this and is fine; rank-pass is the same shape. Texture atlas is tiny (a 64×16 PNG). Negligible.
- **`weaponDamage` migration:** every existing unit kind already has `weaponDamage` set to match its weapon's `projectile.damage`. Switching `fire-resolver` to read from `BaseStats` should be a no-op for current behavior. A test asserts post-migration musket damage is unchanged at base rank.
- **XP credit on shell explosions** that kill the firer's own teammates: friendly fire is filtered (different-team check), so collateral kills among allies don't grant XP. Multi-kill explosions credit one XP per enemy killed.
- **Rank icon legibility on snow:** gold + 1px dark outline reads well on grass and snow. Tested by eye against existing terrain palette. If issues arise, a darker outline ring (2px) is a one-line tune.
- **Cute factor:** the sparkle on promotion is the main "cute" beat. If it gets noisy in big battles (likely promotions cluster after a volley), we cap to ~2 sparkles/frame total or skip the FX above N concurrent — defer the cap until observed.
