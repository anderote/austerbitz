import { allocEntity, EntityState } from '../sim/entities';
import { getUnitKindIndex, getUnitKind } from '../data/units';
import { createMarchGroup } from '../sim/march-groups';
import { assignIdentity } from '../sim/spawn-identity';
import type { World } from '../sim/world';

export const MAP_W = 600;
export const MAP_H = 300;

export const LANE_Y = 100;
export const CANNON_X = 300;
export const CANNON_Y = 220;
export const CANNON_SPACING = 6;

export const SPAWN_INTERVAL_S = 12;

export const BLOCK_FILES = 5;
export const BLOCK_RANKS = 4;
export const BLOCK_SPACING = 0.8;

export const SPAWN_X = 620;
export const MARCH_TARGET_X = -20;
export const DESPAWN_X = -10;

// Facing convention: facing index F → (cos(Fπ/4), sin(Fπ/4)).
// Cannons must fire toward the lane (lower Y). Facing 6 → (0, -1) → -Y → north.
const FACING_NORTH = 6;
// Enemy block faces west (toward cannons / -X). Facing 4 → (-1, 0).
const FACING_WEST = 4;

function spawnEntity(
  world: World,
  kindId: string,
  team: number,
  x: number,
  y: number,
  facing: number,
): number {
  const e = world.entities;
  const id = allocEntity(e);
  if (id === -1) return -1;
  const kind = getUnitKind(kindId);
  e.posX[id] = x;
  e.posY[id] = y;
  e.restPosX[id] = x;
  e.restPosY[id] = y;
  e.facing[id] = facing;
  e.restFacing[id] = facing;
  const theta = (facing * Math.PI) / 4;
  e.facingIntentX[id] = Math.cos(theta);
  e.facingIntentY[id] = Math.sin(theta);
  e.kindId[id] = getUnitKindIndex(kindId);
  e.team[id] = team;
  assignIdentity(e, id, team, world.rng);
  e.hp[id] = kind.baseStats.hp;
  e.bodyRadius[id] = kind.baseStats.bodyRadius;
  e.massKg[id] = kind.baseStats.massKg;
  e.morale[id] = kind.baseStats.morale;
  e.state[id] = EntityState.Idle;
  // Stagger first volley by randomizing reload progress for armed units.
  if (kind.weapon) {
    e.state[id] = EntityState.Reloading;
    e.reloadT[id] = world.rng.range(0, kind.baseStats.weaponReload);
  }
  return id;
}

export function spawnCannons(world: World, team: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const id = spawnEntity(
      world,
      'cannon-12',
      team,
      CANNON_X + (i - 1) * CANNON_SPACING,
      CANNON_Y,
      FACING_NORTH,
    );
    if (id !== -1) ids.push(id);
  }
  return ids;
}

export interface EnemyBlock {
  ids: number[];
  groupId: number;
}

export function spawnEnemyBlock(world: World, team: number): EnemyBlock {
  const e = world.entities;
  const ids: number[] = [];
  const targets: Array<{ id: number; tx: number; ty: number }> = [];
  // 5 files × 4 ranks. Files spread laterally (along Y), ranks extend backward
  // (along +X, since the block marches in -X).
  const fileStart = -((BLOCK_FILES - 1) * BLOCK_SPACING) / 2;
  for (let f = 0; f < BLOCK_FILES; f++) {
    const fileOffset = fileStart + f * BLOCK_SPACING;
    for (let r = 0; r < BLOCK_RANKS; r++) {
      const x = SPAWN_X + r * BLOCK_SPACING;
      const y = LANE_Y + fileOffset;
      const id = spawnEntity(world, 'line-infantry', team, x, y, FACING_WEST);
      if (id === -1) continue;
      ids.push(id);
      // Lane-aligned slot at the western target. Each unit keeps its file
      // offset and rank depth so the block stays a coherent rectangle.
      targets.push({
        id,
        tx: MARCH_TARGET_X + r * BLOCK_SPACING,
        ty: LANE_Y + fileOffset,
      });
    }
  }

  const groupId = world.nextMarchGroupId++;
  world.marchGroups.set(
    groupId,
    createMarchGroup(groupId, ids, { x: -1, y: 0 }, world.simTime),
  );

  for (const { id, tx, ty } of targets) {
    world.orderQueue.set(id, [
      { kind: 'march-formation', targetX: tx, targetY: ty, groupId },
    ]);
    e.isMarching[id] = 1;
  }

  return { ids, groupId };
}
