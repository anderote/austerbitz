# Independent Gun Crew Sprites — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cannon-12's baked-in crew layer with four independent render-only entities per gun, each rendered as a line-infantry body with a role-specific tool. Phase 1 ships static idle-with-tool poses; Phase 2 (animated reload drill) is a follow-up.

**Architecture:** New `gun-crew` unit kind that reuses the line-infantry component stack (body / trousers / coat / shako) without a weapon, plus per-role tool layers. Crew are spawned alongside each cannon, store a `parentGunId` link, and have their world pose derived each tick from the parent gun's pose plus a per-role local offset. No HP, no AI, no targeting — they render but do not participate in combat.

**Tech Stack:** TypeScript, Vitest, WebGL2, existing pose-atlas + kit-loader pipeline, procedural sprite system (`british-soldier-sprite.ts`).

**Spec:** [`docs/superpowers/specs/2026-04-29-gun-crew-sprites-design.md`](../specs/2026-04-29-gun-crew-sprites-design.md)

---

## File Structure

| File | Role |
|------|------|
| `src/sim/entities.ts` | Add `parentGunId: Int32Array` and `crewRole: Uint8Array` to `Entities` SoA + alloc-time defaults |
| `src/data/units/gun-crew.ts` | NEW — `gunCrew` `UnitKind` |
| `src/data/units/index.ts` | Register `gunCrew` |
| `src/sim/crew.ts` | NEW — role table, `computeCrewWorldPose`, `spawnCrewForGun`, `tickCrew` |
| `src/sim/crew.test.ts` | NEW — unit tests for all of the above |
| `src/cannon-test/scene.ts` | Call `spawnCrewForGun` after each cannon spawn |
| `src/cannon-test/main.ts` | Call `tickCrew` in the per-frame system list |
| `public/components/kits/gun-crew.json` | NEW kit |
| `public/components/kits/index.json` | Register `gun-crew` |
| `public/components/index.json` | Register new tool components (any that didn't exist) |
| `public/sprites/components/tools/<tool>-<dir>.png` | NEW PNGs for any missing tools |
| `public/sprites/poses/manifest.json` | Add `gun-crew` kind with `idle` pose |
| `public/sprites/poses/gun-crew/idle/<dir>/0/0.png` | NEW idle frames (mirror line-infantry idle, no musket — see Task 9) |
| `public/components/kits/cannon-12.json` | Strip `cannon12-crew-*` layers from all facings + poses |
| `scripts/build-cannon-12-components.mjs` | Drop crew-layer generation function |
| `public/sprites/components/crew/` | DELETE after kit no longer references it |

---

## Conventions used by this plan

- **Facing octant:** entities store `facing: 0..7`. Per `cannon-test/scene.ts:24`, `0=E, 2=N, 4=W, 6=S`. Radians = `facing * Math.PI / 4`. Rotation math in this plan uses standard math-y conventions (`+x = east, +y = north`); the codebase already uses this.
- **World coordinates:** floats, units are meters.
- **Test runner:** Vitest. Run a single file with `npx vitest run path/to/file.test.ts`. Run a single test with `npx vitest run -t "test name"`.
- **Commit messages:** terse imperative (`add gun-crew kind`, `wire crew into cannon-test`). No Co-Authored-By trailers unless the user asks.
- **No TDD ceremony for asset-only steps.** Tasks 7–10 (kits, JSON wiring, art assets) skip the failing-test step; instead the verification step is a smoke test in the running app.

---

## Task 1: Add `parentGunId` and `crewRole` to `Entities`

**Files:**
- Modify: `src/sim/entities.ts`
- Test: `src/sim/entities.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Locate the test file**

Run: `ls src/sim/entities.test.ts 2>/dev/null || echo MISSING`

If MISSING, create it with this header:

```ts
import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity } from './entities';
```

- [ ] **Step 2: Write the failing test**

Append to `src/sim/entities.test.ts`:

```ts
describe('crew fields', () => {
  it('initializes parentGunId to -1 and crewRole to 0 on alloc', () => {
    const e = createEntities(8);
    const id = allocEntity(e);
    expect(id).toBe(0);
    expect(e.parentGunId[id]).toBe(-1);
    expect(e.crewRole[id]).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npx vitest run src/sim/entities.test.ts -t "crew fields"`
Expected: FAIL — `parentGunId` / `crewRole` undefined on `Entities`.

- [ ] **Step 4: Add the SoA fields**

In `src/sim/entities.ts`, add to the `Entities` interface (place near the existing parent-style links — right after `manualControlled: Uint8Array;`):

```ts
  // Crew → parent-gun link. Set by spawnCrewForGun; -1 for non-crew entities.
  parentGunId: Int32Array;
  // Role index 0..3 (sponger / rammer / loader / gunner). Meaningful only when
  // kindId === 'gun-crew'; zero for everything else.
  crewRole: Uint8Array;
```

In `createEntities`, add to the returned object (alongside `manualControlled`):

```ts
    parentGunId: new Int32Array(capacity).fill(-1),
    crewRole: new Uint8Array(capacity),
```

In `allocEntity`, add to the per-alloc reset block (alongside `e.manualControlled[id] = 0;`):

```ts
  e.parentGunId[id] = -1;
  e.crewRole[id] = 0;
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run src/sim/entities.test.ts -t "crew fields"`
Expected: PASS.

- [ ] **Step 6: Run the full entities test file to confirm no regressions**

Run: `npx vitest run src/sim/entities.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sim/entities.ts src/sim/entities.test.ts
git commit -m "add parentGunId + crewRole fields to Entities"
```

---

## Task 2: Add `gun-crew` `UnitKind`

**Files:**
- Create: `src/data/units/gun-crew.ts`
- Modify: `src/data/units/index.ts`

- [ ] **Step 1: Create the unit kind**

Create `src/data/units/gun-crew.ts`:

```ts
import type { UnitKind } from '../types';

/**
 * Render-only crewman attached to a gun. Same body as line-infantry, no weapon,
 * differentiated by the per-entity `crewRole` field which selects a tool layer
 * in the kit. Combat fields are sentinels — crew don't fight, target, or take
 * damage in Phase 1.
 */
export const gunCrew: UnitKind = {
  id: 'gun-crew',
  category: 'infantry',
  name: 'Gun Crew',
  placeholderColor: [255, 255, 255],
  placeholderSize: { w: 1.0, h: 2.25 },
  // Match line-infantry sprite size so the body renders at consistent scale.
  spriteSize: { w: 2.0, h: 2.25 },
  footYFromCenter: 0.625,
  spriteCell: { col: 1, row: 1 },
  baseStats: {
    hp: 1,
    moveSpeed: 0,
    morale: 255,
    sightRange: 0,
    weaponRange: 0,
    weaponDamage: 0,
    weaponReload: 0,
    weaponAccuracy: 0,
    armor: 0,
    massKg: 80,
    formationSpacing: { x: 1.0, y: 1.0 },
    bodyRadius: 0.0,
  },
  bodyZ: { low: 0, high: 1.8 },
  barrelOffset: { forward: 0, side: 0, height: 0 },
  // No weapon — crew are unarmed. Field is required by UnitKind, so use a
  // null-weapon sentinel matching whatever convention exists elsewhere.
  weapon: null as unknown as UnitKind['weapon'],
};
```

If `UnitKind['weapon']` requires a non-null weapon (check `src/data/types.ts`), use a sentinel inert weapon — copy the smallest existing weapon definition and zero out damage/range. Document the choice inline.

- [ ] **Step 2: Register the kind**

Modify `src/data/units/index.ts`:

```ts
import type { UnitKind } from '../types';
import { lineInfantry } from './line-infantry';
import { cuirassier } from './cuirassier';
import { cannon12 } from './cannon-12';
import { gunCrew } from './gun-crew';

export const unitKinds: readonly UnitKind[] = [lineInfantry, cuirassier, cannon12, gunCrew];
```

- [ ] **Step 3: Verify the kind resolves**

Add to `src/sim/entities.test.ts` (or create `src/data/units/index.test.ts`):

```ts
import { getUnitKind, getUnitKindIndex } from '../data/units';

describe('gun-crew unit kind', () => {
  it('is registered and resolvable', () => {
    const k = getUnitKind('gun-crew');
    expect(k.id).toBe('gun-crew');
    expect(getUnitKindIndex('gun-crew')).toBeGreaterThanOrEqual(0);
  });
});
```

(If you placed it in `entities.test.ts`, the relative import is `'../data/units'` from `src/sim/`.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run -t "gun-crew unit kind"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/units/gun-crew.ts src/data/units/index.ts src/sim/entities.test.ts
git commit -m "add gun-crew unit kind"
```

---

## Task 3: Crew role table + `computeCrewWorldPose`

**Files:**
- Create: `src/sim/crew.ts`
- Create: `src/sim/crew.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sim/crew.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeCrewWorldPose, CrewRole, CREW_ROLES } from './crew';

describe('computeCrewWorldPose', () => {
  it('places the gunner directly behind the gun when gun faces east (facing=0)', () => {
    // Gun at (0,0) facing east. Gunner local offset is (-1.2, 0).
    const pose = computeCrewWorldPose(0, 0, 0, CrewRole.Gunner);
    expect(pose.x).toBeCloseTo(-1.2, 5);
    expect(pose.y).toBeCloseTo(0, 5);
    expect(pose.facing).toBe(0); // gunner faces same as gun
  });

  it('rotates offsets correctly when gun faces north (facing=2)', () => {
    // Gunner local offset (-1.2, 0). North means +y in this codebase, so the
    // gunner sits south of the gun (i.e. at y=-1.2).
    const pose = computeCrewWorldPose(0, 0, 2, CrewRole.Gunner);
    expect(pose.x).toBeCloseTo(0, 5);
    expect(pose.y).toBeCloseTo(-1.2, 5);
    expect(pose.facing).toBe(2);
  });

  it('returns side-offset roles on the correct side when gun faces east', () => {
    const sponger = computeCrewWorldPose(0, 0, 0, CrewRole.Sponger);
    // Sponger local offset (+0.6, -0.9). Gun faces +x, so local +side is +y.
    // Local side=-0.9 → world y = -0.9.
    expect(sponger.x).toBeCloseTo(0.6, 5);
    expect(sponger.y).toBeCloseTo(-0.9, 5);

    const rammer = computeCrewWorldPose(0, 0, 0, CrewRole.Rammer);
    expect(rammer.x).toBeCloseTo(0.6, 5);
    expect(rammer.y).toBeCloseTo(0.9, 5);
  });

  it('translates world-space offset by the gun position', () => {
    const pose = computeCrewWorldPose(10, 20, 0, CrewRole.Gunner);
    expect(pose.x).toBeCloseTo(8.8, 5);
    expect(pose.y).toBeCloseTo(20, 5);
  });

  it('produces a valid 0..7 facing for every gun facing × role combination', () => {
    for (let f = 0; f < 8; f++) {
      for (const role of CREW_ROLES) {
        const pose = computeCrewWorldPose(0, 0, f, role);
        expect(pose.facing).toBeGreaterThanOrEqual(0);
        expect(pose.facing).toBeLessThan(8);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/sim/crew.test.ts`
Expected: FAIL — `crew.ts` does not exist.

- [ ] **Step 3: Implement `crew.ts` (role table + pose helper)**

Create `src/sim/crew.ts`:

```ts
/**
 * Render-only gun-crew positioning. Phase 1: four crewmen per gun at fixed
 * offsets in the gun's local frame, rotated each tick by the gun's facing.
 * No combat, no AI; the parent gun's lifetime governs theirs.
 */

export const CrewRole = {
  Sponger: 0,
  Rammer: 1,
  Loader: 2,
  Gunner: 3,
} as const;
export type CrewRole = (typeof CrewRole)[keyof typeof CrewRole];

export const CREW_ROLES: readonly CrewRole[] = [
  CrewRole.Sponger,
  CrewRole.Rammer,
  CrewRole.Loader,
  CrewRole.Gunner,
];

interface RoleSpec {
  /** Forward offset in the gun's local frame (along the gun's facing axis). */
  forward: number;
  /** Side offset in the gun's local frame (90° CCW of facing). */
  side: number;
  /**
   * Crewman's facing relative to the gun's facing, in radians. The world
   * facing is `gunFacingRad + facingOffset`, then rounded to the nearest 0..7
   * octant.
   */
  facingOffset: number;
}

const ROLE_SPECS: Record<CrewRole, RoleSpec> = {
  [CrewRole.Sponger]: { forward: +0.6, side: -0.9, facingOffset: +Math.PI / 2 },
  [CrewRole.Rammer]:  { forward: +0.6, side: +0.9, facingOffset: -Math.PI / 2 },
  [CrewRole.Loader]:  { forward: -0.4, side: -1.1, facingOffset: +Math.PI / 2 },
  [CrewRole.Gunner]:  { forward: -1.2, side:  0.0, facingOffset:  0 },
};

export interface CrewWorldPose {
  x: number;
  y: number;
  facing: number; // 0..7
}

export function computeCrewWorldPose(
  gunX: number,
  gunY: number,
  gunFacing: number,
  role: CrewRole,
): CrewWorldPose {
  const spec = ROLE_SPECS[role];
  const gunRad = gunFacing * (Math.PI / 4);
  const fx = Math.cos(gunRad);
  const fy = Math.sin(gunRad);
  // Side axis = forward rotated 90° CCW.
  const sx = -fy;
  const sy = fx;
  const x = gunX + spec.forward * fx + spec.side * sx;
  const y = gunY + spec.forward * fy + spec.side * sy;
  const worldRad = gunRad + spec.facingOffset;
  // Round to nearest octant, normalize 0..7.
  const facing = ((Math.round(worldRad / (Math.PI / 4)) % 8) + 8) % 8;
  return { x, y, facing };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/sim/crew.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/crew.ts src/sim/crew.test.ts
git commit -m "add crew positioning helper"
```

---

## Task 4: `spawnCrewForGun`

**Files:**
- Modify: `src/sim/crew.ts`
- Modify: `src/sim/crew.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/sim/crew.test.ts`:

```ts
import { createEntities, allocEntity } from './entities';
import { getUnitKindIndex } from '../data/units';
import { spawnCrewForGun } from './crew';

describe('spawnCrewForGun', () => {
  it('spawns 4 crew entities linked to the gun', () => {
    const e = createEntities(64);
    const gunId = allocEntity(e);
    e.kindId[gunId] = getUnitKindIndex('cannon-12');
    e.posX[gunId] = 5;
    e.posY[gunId] = 7;
    e.facing[gunId] = 0;
    e.team[gunId] = 1;

    const crewIds = spawnCrewForGun(e, gunId);
    expect(crewIds.length).toBe(4);

    const crewKindIdx = getUnitKindIndex('gun-crew');
    const seenRoles = new Set<number>();
    for (const cid of crewIds) {
      expect(e.alive[cid]).toBe(1);
      expect(e.kindId[cid]).toBe(crewKindIdx);
      expect(e.parentGunId[cid]).toBe(gunId);
      expect(e.team[cid]).toBe(1);
      seenRoles.add(e.crewRole[cid]!);
    }
    expect(seenRoles.size).toBe(4); // all four roles distinct
  });

  it('positions each crewman at the role offset relative to the gun', () => {
    const e = createEntities(64);
    const gunId = allocEntity(e);
    e.kindId[gunId] = getUnitKindIndex('cannon-12');
    e.posX[gunId] = 0;
    e.posY[gunId] = 0;
    e.facing[gunId] = 0;

    const crewIds = spawnCrewForGun(e, gunId);
    // Find the gunner by role and check its position is (-1.2, 0).
    const gunnerId = crewIds.find((cid) => e.crewRole[cid] === 3 /* Gunner */)!;
    expect(e.posX[gunnerId]).toBeCloseTo(-1.2, 5);
    expect(e.posY[gunnerId]).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/sim/crew.test.ts -t "spawnCrewForGun"`
Expected: FAIL — `spawnCrewForGun` not exported.

- [ ] **Step 3: Implement `spawnCrewForGun`**

Append to `src/sim/crew.ts`:

```ts
import { allocEntity, type Entities, EntityState } from './entities';
import { getUnitKind, getUnitKindIndex } from '../data/units';

/**
 * Spawn the four crew entities for a freshly-allocated gun. Caller is
 * responsible for having set the gun's posX/posY/facing/team before calling
 * this. Returns the crew ids in role order (sponger, rammer, loader, gunner).
 */
export function spawnCrewForGun(entities: Entities, gunId: number): number[] {
  const kindIdx = getUnitKindIndex('gun-crew');
  const kind = getUnitKind('gun-crew');
  const team = entities.team[gunId]!;
  const gunX = entities.posX[gunId]!;
  const gunY = entities.posY[gunId]!;
  const gunFacing = entities.facing[gunId]!;

  const ids: number[] = [];
  for (const role of CREW_ROLES) {
    const id = allocEntity(entities);
    if (id === -1) {
      console.warn('[crew] entity allocation exhausted; skipping crew spawn');
      break;
    }
    const pose = computeCrewWorldPose(gunX, gunY, gunFacing, role);
    entities.posX[id] = pose.x;
    entities.posY[id] = pose.y;
    entities.restPosX[id] = pose.x;
    entities.restPosY[id] = pose.y;
    entities.facing[id] = pose.facing;
    entities.restFacing[id] = pose.facing;
    const theta = pose.facing * (Math.PI / 4);
    entities.facingIntentX[id] = Math.cos(theta);
    entities.facingIntentY[id] = Math.sin(theta);
    entities.kindId[id] = kindIdx;
    entities.team[id] = team;
    entities.hp[id] = kind.baseStats.hp;
    entities.bodyRadius[id] = kind.baseStats.bodyRadius;
    entities.massKg[id] = kind.baseStats.massKg;
    entities.morale[id] = kind.baseStats.morale;
    entities.state[id] = EntityState.Idle;
    entities.parentGunId[id] = gunId;
    entities.crewRole[id] = role;
    ids.push(id);
  }
  return ids;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/sim/crew.test.ts -t "spawnCrewForGun"`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/crew.ts src/sim/crew.test.ts
git commit -m "add spawnCrewForGun helper"
```

---

## Task 5: `tickCrew` — per-frame position update + orphan cleanup

**Files:**
- Modify: `src/sim/crew.ts`
- Modify: `src/sim/crew.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/sim/crew.test.ts`:

```ts
import { freeEntity, isDead } from './entities';
import { tickCrew } from './crew';

describe('tickCrew', () => {
  it('updates crew positions when the gun moves', () => {
    const e = createEntities(64);
    const gunId = allocEntity(e);
    e.kindId[gunId] = getUnitKindIndex('cannon-12');
    e.posX[gunId] = 0; e.posY[gunId] = 0; e.facing[gunId] = 0;
    const crewIds = spawnCrewForGun(e, gunId);

    e.posX[gunId] = 100;
    e.posY[gunId] = 200;
    tickCrew(e);

    const gunnerId = crewIds.find((cid) => e.crewRole[cid] === 3)!;
    expect(e.posX[gunnerId]).toBeCloseTo(98.8, 5);
    expect(e.posY[gunnerId]).toBeCloseTo(200, 5);
  });

  it('updates crew facing when the gun rotates', () => {
    const e = createEntities(64);
    const gunId = allocEntity(e);
    e.kindId[gunId] = getUnitKindIndex('cannon-12');
    e.posX[gunId] = 0; e.posY[gunId] = 0; e.facing[gunId] = 0;
    spawnCrewForGun(e, gunId);

    e.facing[gunId] = 2; // north
    tickCrew(e);

    const gunner = e.aliveIds.subarray(0, e.count).find((id) => e.crewRole[id] === 3 && e.parentGunId[id] === gunId);
    expect(gunner).toBeDefined();
    expect(e.facing[gunner!]).toBe(2);
  });

  it('frees orphaned crew when the parent gun is freed', () => {
    const e = createEntities(64);
    const gunId = allocEntity(e);
    e.kindId[gunId] = getUnitKindIndex('cannon-12');
    e.posX[gunId] = 0; e.posY[gunId] = 0; e.facing[gunId] = 0;
    const crewIds = spawnCrewForGun(e, gunId);

    freeEntity(e, gunId);
    tickCrew(e);

    for (const cid of crewIds) {
      expect(e.alive[cid]).toBe(0);
    }
  });

  it('frees crew when the parent gun is dead (state-based)', () => {
    // Some flows mark dead but don't immediately free. tickCrew should also
    // tear down crew once the parent's hp is gone, not only on outright free.
    const e = createEntities(64);
    const gunId = allocEntity(e);
    e.kindId[gunId] = getUnitKindIndex('cannon-12');
    e.posX[gunId] = 0; e.posY[gunId] = 0; e.facing[gunId] = 0;
    const crewIds = spawnCrewForGun(e, gunId);

    e.hp[gunId] = 0;
    e.state[gunId] = 8; // EntityState.Dead per entities.ts
    tickCrew(e);

    for (const cid of crewIds) {
      expect(e.alive[cid]).toBe(0);
    }
  });
});
```

Note: `isDead` from `entities.ts` covers state-based deadness; check its actual signature in the file before assuming. Adjust the import / call site if needed.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/sim/crew.test.ts -t "tickCrew"`
Expected: FAIL — `tickCrew` not exported.

- [ ] **Step 3: Implement `tickCrew`**

Append to `src/sim/crew.ts`:

```ts
import { freeEntity, isDead } from './entities';

/**
 * Per-tick crew system. Two passes:
 *  1) Free any crew whose parent gun is no longer alive (or is dead).
 *  2) Re-derive each remaining crew entity's position + facing from its
 *     parent gun.
 *
 * Cheap: O(alive count). Crew read directly from the parent gun's transform —
 * no impulse / velocity integration of their own.
 */
export function tickCrew(entities: Entities): void {
  const crewKindIdx = getUnitKindIndex('gun-crew');

  // Pass 1: orphan cleanup. Iterate by id range (not aliveIds) so freeing
  // doesn't perturb a snapshot.
  for (let id = 0; id < entities.capacity; id++) {
    if (entities.alive[id] !== 1) continue;
    if (entities.kindId[id] !== crewKindIdx) continue;
    const parent = entities.parentGunId[id]!;
    if (parent < 0) continue;
    if (entities.alive[parent] !== 1 || isDead(entities, parent)) {
      freeEntity(entities, id);
    }
  }

  // Pass 2: position update for surviving crew.
  for (let id = 0; id < entities.capacity; id++) {
    if (entities.alive[id] !== 1) continue;
    if (entities.kindId[id] !== crewKindIdx) continue;
    const parent = entities.parentGunId[id]!;
    if (parent < 0) continue;
    const role = entities.crewRole[id]! as CrewRole;
    const pose = computeCrewWorldPose(
      entities.posX[parent]!,
      entities.posY[parent]!,
      entities.facing[parent]!,
      role,
    );
    entities.posX[id] = pose.x;
    entities.posY[id] = pose.y;
    entities.restPosX[id] = pose.x;
    entities.restPosY[id] = pose.y;
    entities.facing[id] = pose.facing;
    const theta = pose.facing * (Math.PI / 4);
    entities.facingIntentX[id] = Math.cos(theta);
    entities.facingIntentY[id] = Math.sin(theta);
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/sim/crew.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/crew.ts src/sim/crew.test.ts
git commit -m "add tickCrew per-frame system"
```

---

## Task 6: Wire crew into the cannon-test scene + sim loop

**Files:**
- Modify: `src/cannon-test/scene.ts`
- Modify: `src/cannon-test/main.ts`

- [ ] **Step 1: Spawn crew alongside cannons**

In `src/cannon-test/scene.ts`, modify `spawnCannons`:

```ts
import { spawnCrewForGun } from '../sim/crew';

export function spawnCannons(entities: Entities, team: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const id = spawnEntity(
      entities,
      'cannon-12',
      team,
      CANNON_X,
      CANNON_Y_CENTER + (i - 1) * CANNON_SPACING,
      0,
    );
    if (id !== -1) {
      entities.hp[id] = 1000;
      ids.push(id);
      spawnCrewForGun(entities, id);
    }
  }
  return ids;
}
```

- [ ] **Step 2: Wire `tickCrew` into the per-frame system list**

In `src/cannon-test/main.ts`, add the import:

```ts
import { tickCrew } from '../sim/crew';
```

Then in the `frame` function's tick block, call it right after `facingSystem`:

```ts
      movementSystem(world, dt);
      facingSystem(world, dt);
      tickCrew(world.entities);
      combatSystem(world, dt);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 4: Run the full vitest suite**

Run: `npx vitest run`
Expected: all PASS (no regressions in unrelated tests).

- [ ] **Step 5: Commit**

```bash
git add src/cannon-test/scene.ts src/cannon-test/main.ts
git commit -m "wire crew spawn + tick into cannon-test"
```

---

## Task 7: Author the `gun-crew` kit

**Files:**
- Create: `public/components/kits/gun-crew.json`
- Modify: `public/components/kits/index.json`

- [ ] **Step 1: Sanity-check existing line-infantry kit**

Run: `cat public/components/kits/line-infantry.json | head -40`

Expected: confirms each facing has layers `body-<dir>-base`, `trousers-<dir>`, `coat-line-<dir>`, `shako-standard-<dir>`. The kit format and component ids you reference in `gun-crew.json` must match this convention.

- [ ] **Step 2: Inspect what `tools/` components already exist**

Run: `ls public/sprites/components/tools/`

Note which of `sponge`, `rammer`, `cartridge-bag`, `linstock` already have 8-direction PNGs and which are missing. The tool layer ids in the kit will be `tool-<role>-<dir>` (e.g. `tool-sponge-east`). If existing names differ (e.g. `cannon12-handspike-east`), use the existing names — don't rename existing components.

- [ ] **Step 3: Author `gun-crew.json`**

Create `public/components/kits/gun-crew.json`. Use this template, **substituting the actual existing tool component-id format you observed in Step 2**:

```json
{
  "id": "gun-crew",
  "label": "Gun Crew",
  "facings": {
    "N":  { "cell": [1, 2], "layers": ["body-north-base",     "trousers-north",     "coat-line-north",     "shako-standard-north"] },
    "NE": { "cell": [2, 0], "layers": ["body-northeast-base", "trousers-northeast", "coat-line-northeast", "shako-standard-northeast"] },
    "E":  { "cell": [2, 1], "layers": ["body-east-base",      "trousers-east",      "coat-line-east",      "shako-standard-east"] },
    "SE": { "cell": [2, 2], "layers": ["body-southeast-base", "trousers-southeast", "coat-line-southeast", "shako-standard-southeast"] },
    "S":  { "cell": [1, 1], "layers": ["body-south-base",     "trousers-south",     "coat-line-south",     "shako-standard-south"] },
    "SW": { "cell": [0, 2], "layers": ["body-southwest-base", "trousers-southwest", "coat-line-southwest", "shako-standard-southwest"] },
    "W":  { "cell": [0, 1], "layers": ["body-west-base",      "trousers-west",      "coat-line-west",      "shako-standard-west"] },
    "NW": { "cell": [0, 0], "layers": ["body-northwest-base", "trousers-northwest", "coat-line-northwest", "shako-standard-northwest"] }
  },
  "poses": {
    "idle": {
      "N":  { "layers": ["body-north-base",     "trousers-north",     "coat-line-north",     "shako-standard-north"] },
      "NE": { "layers": ["body-northeast-base", "trousers-northeast", "coat-line-northeast", "shako-standard-northeast"] },
      "E":  { "layers": ["body-east-base",      "trousers-east",      "coat-line-east",      "shako-standard-east"] },
      "SE": { "layers": ["body-southeast-base", "trousers-southeast", "coat-line-southeast", "shako-standard-southeast"] },
      "S":  { "layers": ["body-south-base",     "trousers-south",     "coat-line-south",     "shako-standard-south"] },
      "SW": { "layers": ["body-southwest-base", "trousers-southwest", "coat-line-southwest", "shako-standard-southwest"] },
      "W":  { "layers": ["body-west-base",      "trousers-west",      "coat-line-west",      "shako-standard-west"] },
      "NW": { "layers": ["body-northwest-base", "trousers-northwest", "coat-line-northwest", "shako-standard-northwest"] }
    }
  }
}
```

**Important:** this template intentionally **does not include tool layers**. The tool layer requires per-role differentiation, but the kit JSON is keyed by `(pose, facing)` only — there's no "per-role" axis built into the kit format. Two options:

  - **Option A (recommended for Phase 1):** Author the tool **into the body PNG variants** at draw time by adding a `--tool-<role>` variant pose folder. The pose-atlas already supports `--no-<part>` variants (see `atlas.ts:128`); the same mechanism extends to additive part variants. **Do not pursue this if it requires non-trivial atlas-loader changes** — defer the tool layer to Phase 2 instead.
  - **Option B (Phase 1 fallback):** Ship Phase 1 without per-role tools. All four crewmen render as identical unarmed line-infantry idle figures. This is acceptable as a starting point; the user explicitly framed Phase 1 as "for starters". Tool differentiation moves to Phase 2.

**Pick Option B** to keep Phase 1 small. Note this decision in the commit message. Phase 2 will introduce per-role tool components.

- [ ] **Step 4: Register the kit**

Modify `public/components/kits/index.json` to include `"gun-crew"`. Run:

```bash
cat public/components/kits/index.json
```

If it's an array `["cannon-12", "cuirassier", "line-infantry"]`, edit to `["cannon-12", "cuirassier", "line-infantry", "gun-crew"]`.

- [ ] **Step 5: Commit**

```bash
git add public/components/kits/gun-crew.json public/components/kits/index.json
git commit -m "add gun-crew kit (no per-role tool yet, Phase 1 fallback)"
```

---

## Task 8: Add `gun-crew` to the pose manifest

**Files:**
- Modify: `public/sprites/poses/manifest.json`
- Create: `public/sprites/poses/gun-crew/idle/<dir>/0/0.png` (8 files)

The pose-atlas (`src/render/poses/atlas.ts:354`) loads frame PNGs per `(kind, pose, dir, clip, frame)` from `public/sprites/poses/<kind>/<pose>/<dir>/<clip>/<frame>.png`. A `gun-crew` kind needs at least one pose folder with 8 directions for Phase 1.

- [ ] **Step 1: Decide on the source PNG**

Pick an existing line-infantry idle PNG to mirror per direction. Run:

```bash
ls public/sprites/poses/line-infantry/idle/
ls public/sprites/poses/line-infantry/idle/E/0/
```

Confirm there's an `0/0.png` per direction. The `gun-crew` idle frames should be **identical** to line-infantry idle for Phase 1 — no weapon to remove, since the line-infantry idle pose PNG appears to be a base body that the kit composites a weapon on top of (verify by opening one and looking for a musket; if it's bundled into the pose PNG, you'll need a `--no-weapon` style variant or a new authored frame — see Step 2 fallback).

- [ ] **Step 2: Copy or symlink frames into `gun-crew/idle/`**

```bash
mkdir -p public/sprites/poses/gun-crew/idle
for d in N NE E SE S SW W NW; do
  mkdir -p "public/sprites/poses/gun-crew/idle/$d/0"
  cp "public/sprites/poses/line-infantry/idle/$d/0/0.png" "public/sprites/poses/gun-crew/idle/$d/0/0.png"
done
ls public/sprites/poses/gun-crew/idle/E/0/
```

Expected: `0.png` exists for all 8 directions.

If the line-infantry idle PNG includes a baked musket (visible musket pixels above the soldier's head), you'll need to either:
- Open the PNG in an image editor and erase the musket pixels for the new gun-crew copy, OR
- Use a `line-infantry/idle--no-weapon` variant if one already exists (`ls public/sprites/poses/line-infantry/ | grep no-`).

- [ ] **Step 3: Update the manifest**

Modify `public/sprites/poses/manifest.json`. Add a new `gun-crew` entry under `kinds`:

```json
    "gun-crew": {
      "poses": {
        "idle": {
          "dirs": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
          "clips": {
            "N":  [["N/0/0.png"]],
            "NE": [["NE/0/0.png"]],
            "E":  [["E/0/0.png"]],
            "SE": [["SE/0/0.png"]],
            "S":  [["S/0/0.png"]],
            "SW": [["SW/0/0.png"]],
            "W":  [["W/0/0.png"]],
            "NW": [["NW/0/0.png"]]
          }
        }
      }
    }
```

Place it alongside the existing `cannon-12`, `line-infantry`, `cuirassier` entries. Match the surrounding JSON formatting (the file is already pretty-printed).

- [ ] **Step 4: Smoke-test the manifest is valid JSON**

Run: `python3 -m json.tool public/sprites/poses/manifest.json > /dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add public/sprites/poses/manifest.json public/sprites/poses/gun-crew
git commit -m "register gun-crew kind in pose manifest"
```

---

## Task 9: Strip the baked crew layer from cannon-12

**Files:**
- Modify: `public/components/kits/cannon-12.json`
- Modify: `scripts/build-cannon-12-components.mjs`
- Modify: `public/components/index.json`
- Delete: `public/sprites/components/crew/`

- [ ] **Step 1: Remove `cannon12-crew-*` layers from `cannon-12.json`**

Edit `public/components/kits/cannon-12.json`. For every facing under `facings` and every pose under `poses`, remove any entry of the form `"cannon12-crew-<dir>-<state>"` from the `layers` array. Keep `cannon12-trail-<dir>`, `cannon12-wheels-<dir>`, `cannon12-barrel-<dir>`, `cannon12-muzzle-flash-*`, `cannon12-smoke-*`, `cannon12-handspike-*` untouched.

After editing, run:

```bash
grep -c "cannon12-crew" public/components/kits/cannon-12.json
```

Expected: `0`.

- [ ] **Step 2: Remove crew generation from the build script**

In `scripts/build-cannon-12-components.mjs`, remove:
- The `crew` rendering function (search for it around the layer comment block at the file head).
- Any call sites that emit `cannon12-crew-<dir>-<state>.png` files into `components/crew/`.
- The header comment lines mentioning `crew` (lines 10, 14 of the file head comment) — keep the doc accurate.

After editing, search:

```bash
grep -in crew scripts/build-cannon-12-components.mjs
```

Expected: no matches (or only matches in unrelated comments — review each one).

- [ ] **Step 3: Remove crew components from the registry**

Edit `public/components/index.json`. Remove every entry whose `id` starts with `cannon12-crew-`. After editing:

```bash
grep -c "cannon12-crew" public/components/index.json
```

Expected: `0`.

- [ ] **Step 4: Delete the orphaned PNG directory**

```bash
rm -rf public/sprites/components/crew
ls public/sprites/components/ | grep -c crew
```

Expected: `0`.

- [ ] **Step 5: Type-check + run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/components/kits/cannon-12.json scripts/build-cannon-12-components.mjs public/components/index.json public/sprites/components/crew
git commit -m "strip baked crew layer from cannon-12"
```

(`git add` of the deleted directory records the deletion.)

---

## Task 10: Visual smoke test in `cannon-test.html`

**Files:** none modified — this task is observational. If issues are found, follow-up commits go in this task.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (or check `package.json` scripts for the actual command).

- [ ] **Step 2: Open the cannon-test sandbox**

Navigate to the URL the dev server prints (usually `http://localhost:5173/cannon-test.html`).

- [ ] **Step 3: Verify**

Open the browser console. Verify:
- No `[pose-atlas]` warnings about `gun-crew`.
- No `[kit-loader]` warnings about `gun-crew`.
- Three cannons render. Each cannon has **four** crewmen visible at fixed offsets around it.
- The cannons render **without** the prior baked-crew silhouettes (compare against `git stash` of the prior state if uncertain).
- Crewmen render as line-infantry-style figures (same body / coat / shako pattern, no musket).

- [ ] **Step 4: Verify multiple facings**

The `cannon-test` scene spawns cannons facing east. To test other facings, edit `src/cannon-test/scene.ts` temporarily — change the `0` in the `spawnEntity` call to `2` (north), reload, and verify crew rotate correctly. Repeat for `4` (west) and `6` (south). Revert the change before committing further work.

- [ ] **Step 5: Verify free-on-death**

Pause the sim, identify a cannon, and (if the test scene has a way to free a cannon — check `scene.ts` for `freeEntities`) free it. Confirm all four of its crewmen disappear within one tick. If no in-app way exists, this verification is covered by Task 5's unit test.

- [ ] **Step 6: Document any issues found**

If the visual is wrong (offsets, z-order, sprite mis-tinted, etc.), the most likely culprits and fixes:

| Symptom | Likely fix |
|---------|-----------|
| Crew appear in wrong place | Tune `ROLE_SPECS` offsets in `src/sim/crew.ts` |
| Crew render behind the gun when they should be in front (or vice versa) | Add a tiny y-bias to the role spec, or pre-sort by world y in the sprite-pass — check `src/render/passes/sprite-pass.ts` first |
| Crew use the wrong team color | Verify `team` is propagated in `spawnCrewForGun`; the regiment-recolor markers in the body atlas should pick this up automatically |
| Console warns `pose 'idle' for kind 'gun-crew' has no frames` | The frames in `public/sprites/poses/gun-crew/idle/` didn't make it into the atlas — re-check Task 8 |

If a fix is needed, make it in a focused commit on top of the prior tasks.

- [ ] **Step 7: Final commit (if any fixes were needed)**

```bash
git add -p
git commit -m "tune crew offsets after visual verification"
```

---

## Self-Review

This plan covers every section of the spec:

| Spec section | Plan task(s) |
|--------------|--------------|
| Crew = render-only entities, parented to the gun | 1, 4, 5 |
| New unit kind `gun-crew` | 2 |
| New kit `gun-crew` | 7 |
| Cannon kit changes (strip baked crew) | 9 |
| Crew positioning (4 roles, offsets table) | 3, 4 |
| Phase 1 idle poses with tool layer | 7 (Option B fallback — tool layer deferred to Phase 2) |
| Code changes file-by-file | All tasks |
| Asset reuse (line-infantry components verbatim) | 7 |
| Testing (positioning unit test, free-on-death, visual) | 3, 4, 5, 10 |
| Phase 2 sketch (animated reload drill) | Out of scope for this plan, called out in spec |

**Known scope deviation from spec:** the spec specified per-role tool layers (sponge / rammer / cartridge-bag / linstock) for Phase 1. The kit JSON format does not have a per-role axis, so Task 7 explicitly defers tool layers to Phase 2 and ships Phase 1 with all four crewmen rendering as identical idle figures. Crewmen still differentiate by **position** (the four role offsets) and the system is wired so adding tool variants in Phase 2 is purely additive. This is a reasonable simplification for "for starters" framing; flag to user only if they want it raised.
