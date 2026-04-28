import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities, type Entities } from '../entities';
import {
  createProjectiles,
  spawnMusketBall,
  spawnShell,
  spawnSolidShot,
  type Projectiles,
} from '../projectiles';
import { createGrid, gridRebuild, type Grid } from '../spatial/grid';
import { createParticles, type Particles } from '../../particles/particles';
import { createPuffs, type Puffs } from '../../puffs/puffs';
import { createRng, type Rng } from '../../util/rng';
import { getUnitKindIndex } from '../../data/units';
import { tickProjectiles } from './projectile-system';
import { createDebris } from '../debris';
import { createShockwaves } from '../../fx/shockwaves';
import { updateShockwaves } from './shockwave-system';

interface Setup {
  entities: Entities;
  projectiles: Projectiles;
  grid: Grid;
  puffs: Puffs;
  particles: Particles;
  rng: Rng;
  debris: ReturnType<typeof createDebris>;
  shockwaves: ReturnType<typeof createShockwaves>;
}

function setup(): Setup {
  return {
    entities: createEntities(16),
    projectiles: createProjectiles(64),
    grid: createGrid({ minX: -100, minY: -100, maxX: 100, maxY: 100, cellSize: 5, capacity: 16 }),
    puffs: createPuffs(512),
    particles: createParticles(512),
    rng: createRng(1),
    debris: createDebris(64),
    shockwaves: createShockwaves(8, 16),
  };
}

function placeLineInfantry(
  s: Setup,
  x: number,
  y: number,
  team: number,
  hp = 60,
): number {
  const id = allocEntity(s.entities);
  s.entities.kindId[id] = getUnitKindIndex('line-infantry');
  s.entities.posX[id] = x;
  s.entities.posY[id] = y;
  s.entities.team[id] = team;
  s.entities.hp[id] = hp;
  gridRebuild(s.grid, s.entities.aliveIds, s.entities.count, s.entities.posX, s.entities.posY);
  return id;
}

describe('tickProjectiles — integration', () => {
  it('musket integrates flat and writes prevX', () => {
    const s = setup();
    const pid = spawnMusketBall(s.projectiles, 0, 0, 1, 0, /*team*/ 1, /*dmg*/ 12, /*v*/ 100, /*mass*/ 0.03, /*life*/ 0.4, /*ownerId*/ -1);

    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 0.01);

    expect(s.projectiles.prevX[pid]).toBe(0);
    expect(s.projectiles.posX[pid]).toBeCloseTo(1.0, 5);
    expect(s.projectiles.posY[pid]).toBe(0);
    expect(s.projectiles.posZ[pid]).toBe(0);
    expect(s.projectiles.alive[pid]).toBe(1);
  });

  it('cannonball arcs: posZ rises then falls and eventually grounds', () => {
    const s = setup();
    const pid = spawnSolidShot(
      s.projectiles,
      0, 0, 0.7,
      20, 0, 10,
      /*team*/ 1, /*dmg*/ 80, /*mass*/ 6, /*life*/ 6, /*ricochets*/ 3,
      /*ownerId*/ -1,
    );

    const dt = 1 / 30;
    let maxZ = s.projectiles.posZ[pid]!;
    let groundedAt = -1;
    for (let step = 0; step < 200; step++) {
      tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, dt);
      if (s.projectiles.alive[pid] === 0) break;
      if (s.projectiles.posZ[pid]! > maxZ) maxZ = s.projectiles.posZ[pid]!;
      if (groundedAt < 0 && s.projectiles.posZ[pid]! === 0) groundedAt = step;
    }
    // Apex must be above the launch height; ball must touch the ground at some point.
    expect(maxZ).toBeGreaterThan(0.7);
    expect(groundedAt).toBeGreaterThan(0);
  });
});

describe('tickProjectiles — ricochet & rolling', () => {
  it('solid shot ricochets: velZ flips with restitution, ricochets decrement, horizontal damped', () => {
    const s = setup();
    const pid = spawnSolidShot(
      s.projectiles,
      0, 0, 0,        // already on the ground
      10, 0, -5,      // descending
      /*team*/ 1, /*dmg*/ 80, /*mass*/ 6, /*life*/ 6, /*ricochets*/ 3,
      /*ownerId*/ -1,
    );

    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 1 / 60);

    // Ricochet count should drop by exactly one.
    expect(s.projectiles.ricochets[pid]).toBe(2);
    // velZ flipped to roughly +2.5 (gravity perturbs the exact value slightly).
    expect(s.projectiles.velZ[pid]).toBeGreaterThan(2);
    expect(s.projectiles.velZ[pid]).toBeLessThan(3);
    // posZ pinned to 0 at the bounce instant.
    expect(s.projectiles.posZ[pid]).toBe(0);
    // Horizontal damped by 0.7×.
    expect(s.projectiles.velX[pid]).toBeCloseTo(10 * 0.7, 5);
    expect(s.projectiles.alive[pid]).toBe(1);
  });

  it('rolling stops below threshold and frees the projectile', () => {
    const s = setup();
    const pid = spawnSolidShot(
      s.projectiles,
      0, 0, 0,
      2, 0, 0,        // below ROLL_STOP_SPEED of 3 m/s
      /*team*/ 1, /*dmg*/ 80, /*mass*/ 6, /*life*/ 6, /*ricochets*/ 0,
      /*ownerId*/ -1,
    );

    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 1 / 60);

    expect(s.projectiles.alive[pid]).toBe(0);
    expect(s.projectiles.count).toBe(0);
  });
});

describe('tickProjectiles — entity collision', () => {
  it('musket ball hits an enemy entity, drops hp, and is freed', () => {
    const s = setup();
    const target = placeLineInfantry(s, 5, 0, /*team*/ 2, /*hp*/ 60);
    const pid = spawnMusketBall(
      s.projectiles, 0, 0, 1, 0,
      /*team*/ 1, /*dmg*/ 12, /*v*/ 100, /*mass*/ 0.03, /*life*/ 0.4,
      /*ownerId*/ -1,
    );

    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 0.1);

    expect(s.entities.hp[target]).toBeLessThan(60);
    expect(s.projectiles.alive[pid]).toBe(0);
  });

  it('friendly fire is excluded — same-team entity is not hit', () => {
    const s = setup();
    const friend = placeLineInfantry(s, 5, 0, /*team*/ 1, /*hp*/ 60);
    spawnMusketBall(
      s.projectiles, 0, 0, 1, 0,
      /*team*/ 1, /*dmg*/ 12, /*v*/ 100, /*mass*/ 0.03, /*life*/ 0.4,
      /*ownerId*/ -1,
    );

    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 0.1);

    expect(s.entities.hp[friend]).toBe(60);
  });

  it('solid shot plows through two enemies, draining damage as it goes', () => {
    const s = setup();
    const a = placeLineInfantry(s, 3, 0, /*team*/ 2, /*hp*/ 60);
    const b = placeLineInfantry(s, 5, 0, /*team*/ 2, /*hp*/ 60);
    const pid = spawnSolidShot(
      s.projectiles,
      0, 0, 1.0,
      50, 0, 0,
      /*team*/ 1, /*dmg*/ 80, /*mass*/ 6, /*life*/ 6, /*ricochets*/ 3,
      /*ownerId*/ -1,
    );

    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 0.2);

    expect(s.entities.hp[a]).toBeLessThan(60);
    expect(s.entities.hp[b]).toBeLessThan(60);
    // Damage decayed strictly below the original 80 after at least one hit.
    expect(s.projectiles.damage[pid]).toBeLessThan(80);
  });

  it('Z fly-over: a high-altitude cannonball does not damage entities below', () => {
    const s = setup();
    const target = placeLineInfantry(s, 5, 0, /*team*/ 2, /*hp*/ 60);
    spawnSolidShot(
      s.projectiles,
      0, 0, 5.0,      // 5 m up — well above the 1.8 m body height
      50, 0, 0,
      /*team*/ 1, /*dmg*/ 80, /*mass*/ 6, /*life*/ 6, /*ricochets*/ 3,
      /*ownerId*/ -1,
    );

    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 0.2);

    expect(s.entities.hp[target]).toBe(60);
  });
});

describe('tickProjectiles — shell behaviour', () => {
  it('shell fuse expiry detonates and frees the projectile', () => {
    const s = setup();
    const pid = spawnShell(
      s.projectiles,
      0, 0, 1.0,
      10, 0, 0,
      /*team*/ 1, /*dmg*/ 0, /*mass*/ 6, /*life*/ 6, /*fuse*/ 0.01,
      /*ownerId*/ -1,
    );

    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 0.02);

    expect(s.projectiles.alive[pid]).toBe(0);
    // Explosion should have spawned at least the flash + smoke billow + debris.
    expect(s.particles.count).toBeGreaterThan(0);
  });

  it('shell direct hit detonates: target takes splash damage, projectile is freed', () => {
    const s = setup();
    const target = placeLineInfantry(s, 3, 0, /*team*/ 2, /*hp*/ 60);
    const pid = spawnShell(
      s.projectiles,
      0, 0, 1.0,
      30, 0, 0,
      /*team*/ 1, /*dmg*/ 0, /*mass*/ 6, /*life*/ 6, /*fuse*/ 1.5,
      /*ownerId*/ -1,
    );

    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 0.2);
    // Drive the shockwave system to deliver splash damage (damage now arrives over ~3 ticks).
    for (let i = 0; i < 10; i++) {
      updateShockwaves(s.shockwaves, s.entities, s.grid, s.particles, s.rng, undefined, s.debris, 1 / 60);
    }

    expect(s.projectiles.alive[pid]).toBe(0);
    // Splash damage from the explosion radius (target is at the centre).
    expect(s.entities.hp[target]).toBeLessThan(60);
  });
});

describe('tickProjectiles — trail emission', () => {
  it('cannonball emits a trail puff each tick', () => {
    const s = setup();
    spawnSolidShot(
      s.projectiles,
      0, 0, 1.5,
      20, 0, 0,
      /*team*/ 1, /*dmg*/ 80, /*mass*/ 6, /*life*/ 6, /*ricochets*/ 3,
      /*ownerId*/ -1,
    );

    expect(s.puffs.count).toBe(0);
    tickProjectiles(s.projectiles, s.entities, s.grid, s.puffs, s.particles, s.rng, s.shockwaves, s.debris, 1 / 60);
    expect(s.puffs.count).toBeGreaterThanOrEqual(1);
  });
});
