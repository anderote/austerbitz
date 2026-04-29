# Independent Gun Crew Sprites — Design

**Date:** 2026-04-29
**Status:** Approved (design-level), pending implementation plan

## Problem

The 12-pounder cannon's crew is currently a single baked PNG layer
(`cannon12-crew-<dir>-{idle,fire,reload}`) composited on top of trail / wheels /
barrel via the kit system. It is one static blob of four hand-drawn miniature
figures per facing per state — no per-crewman movement, no animated drill, and
the figures don't match the line-infantry body the player already recognizes.

We want gun crew that:

1. Are independent characters — each crewman is a distinct render unit, not
   pixels baked into the gun layer.
2. Look like the existing line-infantry body sprite (same procedural figure,
   regiment-recolored), with no musket.
3. Are animated doing things — at minimum, a reload cycle.

## Non-goals

- **Hittable / killable crew.** This slice does not give crew HP, collision, or
  AI. Crew are render-only and exist as long as the parent gun lives.
- **New cannon types.** 12-pounder only. Other guns will follow the same
  pattern when added.
- **Faction variants.** Crew use the same regiment recolor pipeline as their
  parent gun; no new faction-specific sprites.
- **Re-authoring line infantry.** No changes to `british-soldier-sprite.ts`
  beyond reuse.

## Phasing

We ship in two phases so we can see crew on screen quickly and iterate.

- **Phase 1 (this slice): static crew at correct positions.**
  Crew appear as line-infantry-body figures at fixed world-space offsets around
  the gun, one per role (sponger, loader, rammer, gunner). Each crewman uses an
  idle stance suited to its role (held tool sprite layered in via the kit
  system). The gun's idle / firing / reloading poses do not yet drive crew
  pose.

- **Phase 2 (follow-up): animated reload drill.**
  Crew cycle through role-specific multi-frame animations synced to the gun's
  reload timer (sponge → load → ram → prime). Falls out of the existing pose
  pipeline once the frames are authored.

This document specifies Phase 1 in full and sketches Phase 2 enough to verify
Phase 1 doesn't paint us into a corner.

## Architecture

### Crew = render-only entities, parented to the gun

Each gun spawns four crew entities at spawn time. They live in the same ECS as
infantry — they get position, facing, kind, team, sprite — but they have:

- No HP (or `hp = ∞`, never decremented)
- No targeting, no AI tick, no projectile collision
- No formation membership
- A `parentGunId` field linking them to their gun
- Position derived each tick from the parent gun's position + a per-role local
  offset rotated by the gun's facing
- Facing copied from the parent gun (or +/- 180°, see "Crew positioning")

When the parent gun is freed, all its crew are freed too.

This reuses the existing render pipeline wholesale — sprite-pass, pose-atlas,
kit-loader — so no renderer changes are needed beyond registering a new unit
kind and a new kit.

### New unit kind: `gun-crew`

A separate kind from `line-infantry`, even though they share the body sprite.
Reasons:

- A different kit (no weapon, role-specific tool layers, possibly no shako)
- Different `baseStats` semantics (sentinel HP, no real combat)
- Avoids polluting the existing `line-infantry` kit with reload-drill poses

Body sprite reuse: the kind references the same procedural body cells used by
`line-infantry` (`british-soldier-sprite.ts`). No new sprite generator.

The four roles (sponger, loader, rammer, gunner) are **not** distinct unit
kinds. They share the kind and are differentiated by:

- A `crewRole` field (0..3) on the entity
- A position offset table keyed by role
- A tool layer (sponge / cartridge / rammer / linstock) keyed by role in the
  kit

### New kit: `gun-crew`

Lives at `public/components/kits/gun-crew.json`. Reuses the line-infantry
component stack as-is, minus the weapon. Per facing, the layer order is:

- `body-<dir>-base` (anatomy)
- `trousers-<dir>`
- `coat-line-<dir>` (or a future `coat-artillery-<dir>` if/when authored — out
  of scope here; for Phase 1 we use the existing line coat)
- `shako-standard-<dir>`
- `tool-<role>-<dir>` (per-role tool — see "Phase 1 poses")

These are the same component ids the line-infantry kit already references; no
new body / trousers / coat / shako PNGs need authoring. Only the tool PNGs
are new (and some may already exist in `components/tools/`).

No `weapon` block — the crew are unarmed. The pose-atlas weapon path is
skipped automatically when `kit.weapon` is absent.

### Cannon kit changes

`public/components/kits/cannon-12.json`:

- Remove all `cannon12-crew-<dir>-<state>` entries from `facings` and `poses`.
- Keep trail / wheels / barrel / muzzle-flash / smoke / handspike layers
  unchanged.

`scripts/build-cannon-12-components.mjs`:

- Remove the crew-rendering function and the 24 generated crew PNGs.
- Leave trail / wheels / barrel / fx / handspike generation alone.

`public/sprites/components/crew/`: delete directory after the kit no longer
references it.

## Crew positioning

Four crew per gun. Offsets are in world units, defined in the gun's local
frame (gun facing east), then rotated by the gun's actual facing at draw time.
Concrete numbers are starting points; final values get tuned in the
`cannon-test` scene.

| Role     | Local offset (forward, side) | Default facing relative to gun |
|----------|------------------------------|--------------------------------|
| Sponger  | (+0.6, -0.9)                 | toward gun (mirror)            |
| Rammer   | (+0.6, +0.9)                 | toward gun (mirror)            |
| Loader   | (-0.4, -1.1)                 | toward gun (mirror)            |
| Gunner   | (-1.2,  0.0)                 | same as gun (looking forward)  |

"Toward gun" means the crewman's facing is set to point at the muzzle from
their position; "same as gun" means matching the gun's facing.

Computation lives in a new helper `computeCrewWorldPose(gunX, gunY,
gunFacing, role)` that returns `(x, y, facing)`. Called every tick in a new
pre-render system, after the gun's own movement integration.

## Phase 1 poses

Each crewman has one pose for Phase 1: an idle stance with their tool. We
reuse the `idle` pose enum value — the kit's `poses.idle.<facing>` simply
includes the role-specific tool layer.

| Role     | Idle stance                                       |
|----------|---------------------------------------------------|
| Sponger  | Standing, sponge held vertically                  |
| Rammer   | Standing, rammer held vertically                  |
| Loader   | Standing, holding cartridge bag at hip            |
| Gunner   | Standing, linstock held vertically                |

All four use the standard line-infantry standing body (the existing `idle`
pose). Differentiation between roles is purely the tool layer. New crouch /
lean poses are explicitly out of scope for Phase 1 — Phase 2 may add them.

Tool sprites are authored as 32×36 PNGs (matching the kit canvas), one per
direction, stored at `public/sprites/components/tools/<tool>-<dir>.png`.
Several may already exist in `components/tools/` from the prior cannon work
(at minimum a `handspike` is referenced); the implementation plan inventories
existing tool PNGs and identifies which need authoring.

Some of these may already exist (the cannon kit already has a `tools/`
component category). The implementation plan will inventory existing tools and
identify which need to be authored.

## Phase 2 sketch (informational)

Phase 2 introduces a `reloading` pose for `gun-crew` with multi-frame clips.
The pose-atlas pipeline already supports this — the kit declares `reloading`
poses with `[[frame0, frame1, frame2, ...]]` clip arrays, and `pose-config.ts`
tells the runtime the fps and loop kind.

The reload cycle is split into role-specific sub-actions:

- Sponger: dip sponge → swab bore → withdraw
- Loader: hand cartridge to rammer → step back
- Rammer: receive cartridge → ram home → withdraw
- Gunner: prime vent → step clear → fire

These run in sequence (sponger first, then loader+rammer, then gunner fires).
Synchronization is the gun's reload timer driving a shared `reloadT ∈ [0,1]`
that maps each crewman's clip frame.

Phase 2 needs no new architecture — only authoring the frames and adding the
mapping from `(role, reloadT)` → `(pose, frameIdx)`.

## Code changes (Phase 1)

Files touched:

| File | Change |
|------|--------|
| `src/data/units/gun-crew.ts` | NEW — `UnitKind` definition |
| `src/data/units/index.ts` | Register `gun-crew` kind |
| `src/data/units/cannon-12.ts` | Add `crewSpec` field describing roles + offsets |
| `src/sim/entities.ts` | Add `parentGunId: Int32Array` and `crewRole: Uint8Array` to `Entities` |
| `src/sim/crew.ts` | NEW — spawn-on-cannon-spawn, free-on-cannon-free, per-tick position update |
| `src/sim/sim-loop.ts` (or equivalent integration site) | Call crew position update |
| `src/cannon-test/scene.ts` | Confirm crew spawn alongside cannons (ideally automatic via `crew.ts`) |
| `public/components/kits/gun-crew.json` | NEW kit |
| `public/components/kits/index.json` | Register `gun-crew` |
| `public/components/index.json` | Register new tool components |
| `public/sprites/components/tools/` | NEW PNGs for sponge, rammer, cartridge-bag, linstock |
| `public/components/kits/cannon-12.json` | Strip `cannon12-crew-...` layers |
| `scripts/build-cannon-12-components.mjs` | Drop crew generation |
| `public/sprites/components/crew/` | Delete (post-kit-update) |
| `public/sprites/poses/manifest.json` | Add `gun-crew` poses (just `idle` for Phase 1) |
| `public/sprites/poses/gun-crew/idle/<dir>/0/0.png` | NEW (or reuse line-infantry idle body if path resolution allows) |

The `Entities` SoA gains two arrays. They are zeroed on `allocEntity` and
ignored for entities whose kind is not `gun-crew` (so cost is one extra
per-entity write at allocation, plus storage proportional to `MAX_ENTITIES`).

## Asset reuse vs. new authoring

- **Body / trousers / coat / shako**: reuse the existing line-infantry
  components verbatim — `body-<dir>-base`, `trousers-<dir>`, `coat-line-<dir>`,
  `shako-standard-<dir>`. No new sprites authored.
- **Tools**: four tools needed — `sponge`, `rammer`, `cartridge-bag`,
  `linstock`. Inventory `public/sprites/components/tools/` first; the cannon
  kit already references a `handspike` tool, so some tooling exists.
  Author whichever of the four are missing.

## Visual / aesthetic constraints

The pixel-art aesthetic memory mandates pixelated rendering with hard edges
for in-world sprites. The line-infantry body and the cannon barrel/carriage
are already authored at this aesthetic; the new tool components must match
their pixel density. Line-infantry cells are 11×18 and the cannon kit canvas
is 32×36 — the visible difference in texels-per-world-unit between the two is
inherited from the existing system and is **not** in scope to change here.

## Testing

- **`cannon-test.html`**: spawn one cannon, verify four crew appear at
  correct local offsets across all eight gun facings. Rotate the gun (set its
  facing manually if no rotation tooling) and confirm crew rotate with it.
- **Visual regression**: load `cannon-test.html` and inspect that the gun's
  trail / wheels / barrel render unchanged after the crew layer is stripped.
- **Unit test**: `computeCrewWorldPose` — for each of the eight gun facings
  and each of the four roles, assert the returned `(x, y, facing)` matches a
  hand-computed expected value.
- **Free safety**: spawn a cannon, free it, assert all four crew entities are
  freed in the same tick.

## Risks and mitigations

- **Crew offsets look wrong at certain facings.** Mitigation: tune in
  `cannon-test`. Offsets live in `cannon-12.ts` so iteration is local.
- **Crew z-order vs. gun looks wrong** (e.g. rammer renders behind the
  carriage when they should be in front, or vice versa). Mitigation: existing
  sprite-pass sorts by world-space y; crew positioned slightly in front or
  behind the gun's center y will fall out correctly. If not, fall back to
  per-entity z-bias.
- **Kit / manifest wiring drift.** The kit JSON, component registry, and
  manifest must agree. Mitigation: smoke test in `cannon-test` that no
  console warnings fire from `[pose-atlas]` or `[kit-loader]`.

## Decisions taken without further consultation

- 4 crew per 12-pounder (sponger, rammer, loader, gunner). Reversible.
- British shako headgear default; faction variants out of scope.
- Phase 1 ships static idle-with-tool poses; Phase 2 ships animated reload
  drill.
- Crew are render-only, not killable. Hittable crew is a future expansion.
- New kind `gun-crew` rather than overloading `line-infantry`.
