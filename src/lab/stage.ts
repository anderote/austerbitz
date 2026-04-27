import type { World } from '../sim/world';
import type { Projectiles } from '../sim/projectiles';
import type { Particles } from '../particles/particles';
import { allocEntity, freeEntity, EntityState } from '../sim/entities';
import { getUnitKindIndex, getUnitKind } from '../data/units';

export interface Stage {
  subjectId: number | null;
  subjectKind: string;
  dummyIds: number[];
}

const SUBJECT_X = 0;
const SUBJECT_Y = 0;
const DUMMY_X = 30;
const DUMMY_COUNT = 5;
const DUMMY_SPACING = 1.5;

function spawnEntity(
  world: World,
  kindId: string,
  team: number,
  x: number,
  y: number,
  facing: number,
): number {
  const id = allocEntity(world.entities);
  if (id === -1) return -1;
  const e = world.entities;
  const kind = getUnitKind(kindId);
  e.posX[id] = x;
  e.posY[id] = y;
  e.facing[id] = facing;
  e.facingIntentX[id] = Math.cos((facing * Math.PI) / 4);
  e.facingIntentY[id] = Math.sin((facing * Math.PI) / 4);
  e.kindId[id] = getUnitKindIndex(kindId);
  e.team[id] = team;
  e.hp[id] = kind.baseStats.hp;
  e.bodyRadius[id] = kind.baseStats.bodyRadius;
  e.massKg[id] = kind.baseStats.massKg;
  e.state[id] = EntityState.Idle;
  return id;
}

/**
 * Spawn one subject of `kind` at world origin facing east, plus a 5-unit
 * dummy line-infantry row 30 m to the east. The dummies are team 1; the
 * subject is team 0 so the subject's projectiles can hit them.
 */
export function setupStage(
  world: World,
  _projectiles: Projectiles,
  _particles: Particles,
  kind: string,
): Stage {
  const subjectId = spawnEntity(world, kind, 0, SUBJECT_X, SUBJECT_Y, 0);

  const dummyIds: number[] = [];
  // Centered row: y from -((n-1)/2)*spacing to +((n-1)/2)*spacing.
  const half = ((DUMMY_COUNT - 1) * DUMMY_SPACING) / 2;
  for (let i = 0; i < DUMMY_COUNT; i++) {
    const dy = -half + i * DUMMY_SPACING;
    const id = spawnEntity(world, 'line-infantry', 1, DUMMY_X, dy, 4 /* west */);
    if (id !== -1) dummyIds.push(id);
  }

  return { subjectId: subjectId === -1 ? null : subjectId, subjectKind: kind, dummyIds };
}

/** Free every alive entity, projectile, and particle, then re-spawn the stage. */
export function resetStage(
  world: World,
  projectiles: Projectiles,
  particles: Particles,
  stage: Stage,
): void {
  // Free all alive entities by walking the SoA. We don't trust `count` here
  // because slots may have been freed in arbitrary order.
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 1) freeEntity(e, i);
  }

  // Free all alive projectiles by direct field clear — bypasses freeProjectile
  // overhead and matches the spec's "bulk clear" allowance.
  const p = projectiles;
  for (let i = 0; i < p.capacity; i++) {
    p.alive[i] = 0;
  }
  p.count = 0;
  // Rebuild the free-list from scratch.
  for (let i = 0; i < p.capacity - 1; i++) p.freeListNext[i] = i + 1;
  p.freeListNext[p.capacity - 1] = -1;
  p.freeListHead = 0;

  // Bulk-clear the particle pool (allowed only here per spec). Also reset the
  // packed-list bookkeeping (aliveIdx, cursor) to keep the schema invariant.
  for (let i = 0; i < particles.capacity; i++) {
    particles.alive[i] = 0;
    particles.aliveIdx[i] = -1;
  }
  particles.count = 0;
  particles.cursor = 0;

  // Re-spawn.
  const fresh = setupStage(world, projectiles, particles, stage.subjectKind);
  stage.subjectId = fresh.subjectId;
  stage.dummyIds = fresh.dummyIds;
}

/** Replace the current subject with a fresh entity of `kind`. Dummies untouched. */
export function spawnSubject(world: World, stage: Stage, kind: string): void {
  if (stage.subjectId !== null && world.entities.alive[stage.subjectId] === 1) {
    freeEntity(world.entities, stage.subjectId);
  }
  const id = spawnEntity(world, kind, 0, SUBJECT_X, SUBJECT_Y, 0);
  stage.subjectId = id === -1 ? null : id;
  stage.subjectKind = kind;
}
