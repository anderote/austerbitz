# Projectile Range Falloff & Pierce — Implementation Plan

Spec: `docs/superpowers/specs/2026-05-02-projectile-range-falloff-and-pierce-design.md`

Sequenced phases. Each phase ends in a green test suite + typecheck.

---

## Phase 1 — Data model: extend `Projectiles` SoA

**Files:** `src/sim/projectiles.ts`

1. Add 8 new `Float32Array` fields to `Projectiles`:
   `spawnX, spawnY, falloffNearM, falloffDecayK, falloffMinMul, pierceMinDamage, piercePerTargetMul, pierceVelMul`.
2. Allocate them in `createProjectiles`.
3. Reset in `allocProjectile` (defaults: spawn = 0, falloff k = 0 ⇒ no falloff, pierce mul = 0 ⇒ free-on-first-hit, vel mul = 1).
4. Define a small interface near the spawn fns:
   ```ts
   export interface BallisticsParams {
     falloffNearM?: number;
     falloffDecayK?: number;     // 0 = disabled
     falloffMinMul?: number;     // default 0
     pierceMinDamage?: number;   // 0 = disabled (free on first hit)
     piercePerTargetMul?: number;
     pierceVelMul?: number;      // default 1
   }
   ```
5. Add an optional trailing `BallisticsParams` arg to `spawnMusketBall`,
   `spawnSolidShot`, `spawnShell`. Each spawn fn writes `spawnX/Y` from the
   `ox/oy` it already receives, and writes the six ballistics fields with
   sensible defaults when the arg is absent.

**Tests (`projectiles.test.ts`):**
- A spawned projectile with no `BallisticsParams` has `spawnX/Y` = origin,
  `falloffDecayK` = 0, `piercePerTargetMul` = 0, `pierceVelMul` = 1.
- A spawn with explicit params writes through to the SoA fields.

---

## Phase 2 — Weapon profile typing

**Files:** `src/data/weapons/types.ts`

1. Add to `WeaponProfile.projectile`:
   ```ts
   rangeFalloff?: { nearM: number; decayK: number; minMul: number };
   pierce?: { minDamageFrac: number; perTargetMul: number; velocityMul?: number };
   ```
2. **Remove** the now-obsolete fields:
   `perHitDamageFalloff`, `perHitVelocityFalloff`, `freeBelowDamage`.

(They're declared but unread today — Phase 6 wires the new `pierce` block
into the weapon files, so this rip-out is safe.)

**Tests:** typecheck only (no runtime change yet).

---

## Phase 3 — Falloff function

**Files:** `src/sim/range-falloff.ts` (new), `src/sim/range-falloff.test.ts` (new)

1. Export pure function:
   ```ts
   export function rangeFalloffMul(
     distance: number,
     nearM: number,
     decayK: number,
     minMul: number,
   ): number
   ```
2. Implementation: `if (decayK <= 0) return 1; const t = Math.max(0, distance - nearM); return Math.max(minMul, Math.exp(-decayK * t));`
3. Tests:
   - `decayK = 0` → always 1.
   - `distance <= nearM` → 1 (regardless of k).
   - Specific musket-curve sample points (8 m → 1.0; 25 m → ~0.55; 60 m → ~0.16; 100 m → 0.05 floor) within tolerance.
   - Floor: huge distance never goes below `minMul`.
   - Monotonic non-increasing in distance.

---

## Phase 4 — Wire fire-resolver

**Files:** `src/sim/fire-resolver.ts`, `src/sim/projectiles.ts` (canister)

1. In `resolveFire`, build a `BallisticsParams` object from
   `weapon.projectile.rangeFalloff` and `weapon.projectile.pierce`. For
   pierce, compute `pierceMinDamage = baseRolledDamage * minDamageFrac` (use
   the *unrolled* base `kind.baseStats.weaponDamage` so the threshold doesn't
   wobble with crit/variance — this gives a stable pierce ceiling).
2. Pass it to `spawnMusketBall` / `spawnSolidShot` / `spawnShell`.
3. In `spawnCanister`, build per-ball params from the canister profile. (For
   now canister muskets use a separate light-falloff config — see Phase 6
   tuning. Keep it simple: hardcode params on `CanisterProfile` for now or
   leave canister falloff-less and tune in a follow-up. Decide in Phase 6;
   for Phase 4 just plumb the arg through.)

**Tests:** existing fire-resolver tests should still pass. Add one new test:
firing a musket records `spawnX/Y` and the configured falloff/pierce on the
spawned projectile.

---

## Phase 5 — Hit-time application in `projectile-system.ts`

**Files:** `src/sim/systems/projectile-system.ts`

1. Remove the three `SOLID_SHOT_*` module constants.
2. Replace the bifurcated Musket-vs-SolidShot hit branch with a unified
   sequence:
   ```ts
   const dist = Math.hypot(p.posX[i]! - p.spawnX[i]!, p.posY[i]! - p.spawnY[i]!);
   const fmul = rangeFalloffMul(dist, p.falloffNearM[i]!, p.falloffDecayK[i]!, p.falloffMinMul[i]!);
   const dmg = p.damage[i]! * fmul;
   applyHit(..., dmg, ...);

   if (p.piercePerTargetMul[i]! > 0) {
     p.damage[i] *= p.piercePerTargetMul[i]!;
     p.velX[i] *= p.pierceVelMul[i]!;
     p.velY[i] *= p.pierceVelMul[i]!;
     if (p.damage[i]! < p.pierceMinDamage[i]!) {
       freeProjectile(p, i);
       freed = true;
       break;
     }
     // continue inspecting next candidate
   } else {
     freeProjectile(p, i);
     freed = true;
     break;
   }
   ```
3. The Shell branch is unchanged (explosion-based).

**Tests:** update / add in `projectile-system.test.ts`:
- A musket projectile with falloff hits at long range and applies reduced
  damage.
- A musket projectile with pierce hits two stacked targets at short range and
  frees on the second (or third, depending on tuning).
- A solid-shot using the new pierce block bleeds damage and velocity per hit
  identically to the prior hardcoded values (regression-pin the existing
  behavior).
- Combat-events / combat-system tests still pass (they assert on damage
  values; expect targeted updates here).

---

## Phase 6 — Tune weapon files

**Files:** `src/data/weapons/musket.ts`, `src/data/weapons/cannon-12-solid.ts`,
`src/data/weapons/cannon-12-shell.ts`, possibly canister profile.

1. **musket.ts** — add:
   ```ts
   rangeFalloff: { nearM: 8, decayK: 0.035, minMul: 0.05 },
   pierce: { minDamageFrac: 0.35, perTargetMul: 0.55 },
   ```
2. **cannon-12-solid.ts** — drop `perHitDamageFalloff/Velocity/freeBelowDamage`,
   add:
   ```ts
   rangeFalloff: { nearM: 40, decayK: 0.005, minMul: 0.5 },
   pierce: { minDamageFrac: 5 / 80, perTargetMul: 0.6, velocityMul: 0.85 },
   ```
   (5/80 reproduces the prior 5-absolute floor against the 80 base damage.)
3. **cannon-12-shell.ts** — leave both blocks absent (no falloff, no pierce).
4. **Canister profile** — for the first cut, leave canister muskets without
   a `rangeFalloff` (canister is already a short-range weapon by spread). If
   this turns out to feel weird in playtest it's a follow-up.

---

## Phase 7 — Verification

1. Run `npm test` — all suites green.
2. Run `npm run typecheck` (or equivalent).
3. Manual sanity in the lab harness: place infantry at 5 m and 80 m, eyeball
   damage callouts. Pierce should visibly chain through ranks at point-blank;
   long-range hits should land low numbers.

---

## Risks / unknowns

- **`spawnCanister` is called outside `resolveFire`** — verify exhaustively
  that canister balls still spawn correctly with the new arg.
- **Existing fire-resolver tests** may inspect spawn args by ordinal; the
  optional trailing arg should be a no-op for them, but verify.
- **`combat-events` / damage-text tests** assert applied damage values —
  expect a focused update where the test scenario is at a non-zero range.
