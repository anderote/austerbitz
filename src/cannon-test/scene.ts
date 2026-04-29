import { allocEntity, freeEntity, EntityState, type Entities } from '../sim/entities';
import { getUnitKindIndex, getUnitKind } from '../data/units';
import { spawnCrewForGun } from '../sim/crew';

export const CANNON_X = 30;
export const CANNON_Y_CENTER = 100;
export const CANNON_SPACING = 6;

const REGIMENT_X = 150;            // front rank 120 m downrange from cannons
const REGIMENT_Y_CENTER = 100;
const RANK_COUNT = 45;
const FILES_PER_RANK = 45;
const RANK_SPACING = 0.8;
const FILE_SPACING = 0.8;

export const REGIMENT_CENTER_X = REGIMENT_X + (RANK_COUNT - 1) * RANK_SPACING / 2;
export const REGIMENT_CENTER_Y = REGIMENT_Y_CENTER;

function spawnEntity(
  entities: Entities,
  kindId: string,
  team: number,
  x: number,
  y: number,
  facing: number,    // 0..7: 0=E, 2=N, 4=W, 6=S
): number {
  const id = allocEntity(entities);
  if (id === -1) return -1;
  const kind = getUnitKind(kindId);
  const e = entities;
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
  e.hp[id] = kind.baseStats.hp;
  e.bodyRadius[id] = kind.baseStats.bodyRadius;
  e.massKg[id] = kind.baseStats.massKg;
  e.morale[id] = kind.baseStats.morale;
  e.state[id] = EntityState.Idle;
  return id;
}

export function spawnCannons(entities: Entities, team: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) {
    const id = spawnEntity(
      entities,
      'cannon-12',
      team,
      CANNON_X,
      CANNON_Y_CENTER + (i - 1) * CANNON_SPACING,
      0,   // facing east (0 = east)
    );
    if (id !== -1) {
      // Cannons are effectively invulnerable in this sandbox.
      entities.hp[id] = 1000;
      ids.push(id);
      spawnCrewForGun(entities, id);
    }
  }
  return ids;
}

export function spawnRegiment(entities: Entities, team: number): number[] {
  const ids: number[] = [];
  for (let r = 0; r < RANK_COUNT; r++) {
    for (let f = 0; f < FILES_PER_RANK; f++) {
      const id = spawnEntity(
        entities,
        'line-infantry',
        team,
        REGIMENT_X + r * RANK_SPACING,
        REGIMENT_Y_CENTER + (f - (FILES_PER_RANK - 1) / 2) * FILE_SPACING,
        4,   // facing west (4 = west)
      );
      if (id !== -1) ids.push(id);
    }
  }
  return ids;
}

/** Free all entities in the given id list that are still alive. */
export function freeEntities(entities: Entities, ids: number[]): void {
  for (const id of ids) {
    if (entities.alive[id] === 1) freeEntity(entities, id);
  }
}
