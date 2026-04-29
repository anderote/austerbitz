/**
 * Render-only gun-crew positioning. Phase 1: four crewmen per gun at fixed
 * offsets in the gun's local frame, rotated each tick by the gun's facing.
 * No combat, no AI; the parent gun's lifetime governs theirs.
 */

import { allocEntity, freeEntity, isDead, type Entities, EntityState } from './entities';
import { getUnitKind, getUnitKindIndex } from '../data/units';

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
  /** Side offset in the gun's local frame (90 deg CCW of facing). */
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

export const ROLE_KIND_ID: Record<CrewRole, string> = {
  [CrewRole.Sponger]: 'gun-crew-sponger',
  [CrewRole.Rammer]:  'gun-crew-rammer',
  [CrewRole.Loader]:  'gun-crew-loader',
  [CrewRole.Gunner]:  'gun-crew-gunner',
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
  // Side axis = forward rotated 90 deg CCW.
  const sx = -fy;
  const sy = fx;
  const x = gunX + spec.forward * fx + spec.side * sx;
  const y = gunY + spec.forward * fy + spec.side * sy;
  const worldRad = gunRad + spec.facingOffset;
  // Round to nearest octant, normalize 0..7.
  const facing = ((Math.round(worldRad / (Math.PI / 4)) % 8) + 8) % 8;
  return { x, y, facing };
}

/**
 * Spawn the four crew entities for a freshly-allocated gun. Caller is
 * responsible for having set the gun's posX/posY/facing/team before calling
 * this. Returns the crew ids in role order (sponger, rammer, loader, gunner).
 */
export function spawnCrewForGun(entities: Entities, gunId: number): number[] {
  const team = entities.team[gunId]!;
  const gunX = entities.posX[gunId]!;
  const gunY = entities.posY[gunId]!;
  const gunFacing = entities.facing[gunId]!;

  const ids: number[] = [];
  for (const role of CREW_ROLES) {
    const kindId = ROLE_KIND_ID[role];
    const kind = getUnitKind(kindId);
    const kindIdx = getUnitKindIndex(kindId);

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
  const crewKindIdxSet = new Set<number>(
    CREW_ROLES.map((r) => getUnitKindIndex(ROLE_KIND_ID[r])),
  );

  // Pass 1: orphan cleanup. Iterate by id range (not aliveIds) so freeing
  // doesn't perturb a snapshot.
  for (let id = 0; id < entities.capacity; id++) {
    if (entities.alive[id] !== 1) continue;
    if (!crewKindIdxSet.has(entities.kindId[id]!)) continue;
    const parent = entities.parentGunId[id]!;
    if (parent < 0) continue;
    if (entities.alive[parent] !== 1 || isDead(entities, parent)) {
      freeEntity(entities, id);
    }
  }

  // Pass 2: position update for surviving crew.
  for (let id = 0; id < entities.capacity; id++) {
    if (entities.alive[id] !== 1) continue;
    if (!crewKindIdxSet.has(entities.kindId[id]!)) continue;
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
