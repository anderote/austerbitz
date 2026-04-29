import { describe, it, expect } from 'vitest';
import { computeCrewWorldPose, CrewRole, CREW_ROLES, spawnCrewForGun, tickCrew } from './crew';
import { createEntities, allocEntity, freeEntity } from './entities';
import { getUnitKindIndex } from '../data/units';

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

    const ROLE_TO_KIND: Record<number, string> = {
      0: 'gun-crew-sponger',
      1: 'gun-crew-rammer',
      2: 'gun-crew-loader',
      3: 'gun-crew-gunner',
    };
    const seenRoles = new Set<number>();
    for (const cid of crewIds) {
      expect(e.alive[cid]).toBe(1);
      const role = e.crewRole[cid]!;
      expect(e.kindId[cid]).toBe(getUnitKindIndex(ROLE_TO_KIND[role]!));
      expect(e.parentGunId[cid]).toBe(gunId);
      expect(e.team[cid]).toBe(1);
      seenRoles.add(role);
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

    // Find a still-alive crewman whose role is gunner; assert facing == 2.
    let gunner = -1;
    for (let i = 0; i < e.capacity; i++) {
      if (e.alive[i] === 1 && e.crewRole[i] === 3 && e.parentGunId[i] === gunId) {
        gunner = i;
        break;
      }
    }
    expect(gunner).toBeGreaterThanOrEqual(0);
    expect(e.facing[gunner]).toBe(2);
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
