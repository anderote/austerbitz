import { describe, it, expect } from 'vitest';
import { allocEntity, createEntities, type Entities } from '../sim/entities';
import { createGrid, gridRebuild, type Grid } from '../sim/spatial/grid';
import { createParticles, ParticleClass, type Particles } from '../particles/particles';
import { createPuffs, type Puffs } from '../puffs/puffs';
import { createRng } from '../util/rng';
import { getUnitKindIndex } from '../data/units';
import { cannon12Shell } from '../data/weapons/cannon-12-shell';
import { spawnExplosion } from './explosion';

const explosionProfile = cannon12Shell.projectile.explosion!;

interface Setup {
  e: Entities;
  grid: Grid;
  puffs: Puffs;
  particles: Particles;
  rng: ReturnType<typeof createRng>;
}

function setup(): Setup {
  const e = createEntities(8);
  const grid = createGrid({ minX: -50, minY: -50, maxX: 50, maxY: 50, cellSize: 10, capacity: 8 });
  const puffs = createPuffs(256);
  const particles = createParticles(256);
  const rng = createRng(1);
  return { e, grid, puffs, particles, rng };
}

function placeEntity(
  s: Setup,
  x: number,
  y: number,
  opts: { team?: number; hp?: number; alive?: boolean } = {},
): number {
  const id = allocEntity(s.e);
  s.e.kindId[id] = getUnitKindIndex('line-infantry');
  s.e.posX[id] = x;
  s.e.posY[id] = y;
  s.e.team[id] = opts.team ?? 0;
  s.e.hp[id] = opts.hp ?? 200;
  if (opts.alive === false) s.e.alive[id] = 0;
  gridRebuild(s.grid, s.e.aliveIds, s.e.count, s.e.posX, s.e.posY);
  return id;
}

describe('spawnExplosion', () => {
  it('spawns flash + debris particles and smoke billow puffs', () => {
    const s = setup();
    spawnExplosion(s.e, s.grid, s.puffs, s.particles, s.rng, 0, 0, explosionProfile, undefined, undefined, -1);
    // Particles pool: 1 flash + debris count (smoke now goes to puff pool)
    const expectedParticles = 1 + explosionProfile.debris.count;
    expect(s.particles.count).toBeGreaterThanOrEqual(expectedParticles);
    // Puff pool: smoke billow count
    expect(s.puffs.count).toBeGreaterThanOrEqual(explosionProfile.smokeBillow.count);
  });

  it('flash particle has the configured size and color', () => {
    const s = setup();
    spawnExplosion(s.e, s.grid, s.puffs, s.particles, s.rng, 0, 0, explosionProfile, undefined, undefined, -1);

    let flashIdx = -1;
    for (let i = 0; i < s.particles.capacity; i++) {
      if (s.particles.alive[i] === 1 && s.particles.klass[i] === ParticleClass.Flash) {
        flashIdx = i;
        break;
      }
    }
    expect(flashIdx).toBeGreaterThanOrEqual(0);
    expect(s.particles.size[flashIdx]).toBeCloseTo(explosionProfile.flash.size, 5);
    expect(s.particles.r[flashIdx]).toBeCloseTo(explosionProfile.flash.color[0], 5);
    expect(s.particles.g[flashIdx]).toBeCloseTo(explosionProfile.flash.color[1], 5);
    expect(s.particles.b[flashIdx]).toBeCloseTo(explosionProfile.flash.color[2], 5);
    expect(s.particles.velX[flashIdx]).toBe(0);
    expect(s.particles.velY[flashIdx]).toBe(0);
  });

  it('damages an entity inside the damage radius', () => {
    const s = setup();
    const id = placeEntity(s, 3, 0, { hp: 200 });
    const hpBefore = s.e.hp[id]!;
    spawnExplosion(s.e, s.grid, s.puffs, s.particles, s.rng, 0, 0, explosionProfile, undefined, undefined, -1);
    expect(s.e.hp[id]!).toBeLessThan(hpBefore);
  });

  it('does not damage an entity outside the damage radius', () => {
    const s = setup();
    // 10 m > 6 m radius; AABB query may include it, but the circle test rejects.
    const id = placeEntity(s, 10, 0, { hp: 200 });
    const hpBefore = s.e.hp[id]!;
    spawnExplosion(s.e, s.grid, s.puffs, s.particles, s.rng, 0, 0, explosionProfile, undefined, undefined, -1);
    expect(s.e.hp[id]!).toBe(hpBefore);
  });

  it('damage falls off with distance', () => {
    const s = setup();
    const near = placeEntity(s, 1, 0, { hp: 200 });
    const far = placeEntity(s, 5, 0, { hp: 200 });
    const nearBefore = s.e.hp[near]!;
    const farBefore = s.e.hp[far]!;
    spawnExplosion(s.e, s.grid, s.puffs, s.particles, s.rng, 0, 0, explosionProfile, undefined, undefined, -1);
    const nearLoss = nearBefore - s.e.hp[near]!;
    const farLoss = farBefore - s.e.hp[far]!;
    expect(nearLoss).toBeGreaterThan(farLoss);
    expect(farLoss).toBeGreaterThan(0);
  });

  it('respects excludeTeam: friendly survives, enemy in same blast takes damage', () => {
    const s = setup();
    const friendly = placeEntity(s, 2, 0, { team: 0, hp: 200 });
    const enemy = placeEntity(s, 0, 2, { team: 1, hp: 200 });
    const friendlyBefore = s.e.hp[friendly]!;
    const enemyBefore = s.e.hp[enemy]!;

    spawnExplosion(s.e, s.grid, s.puffs, s.particles, s.rng, 0, 0, explosionProfile, 0, undefined, -1);

    expect(s.e.hp[friendly]!).toBe(friendlyBefore);
    expect(s.e.hp[enemy]!).toBeLessThan(enemyBefore);
  });

  it('ignores dead entities inside the radius without error', () => {
    const s = setup();
    const id = placeEntity(s, 2, 0, { hp: 200, alive: false });
    const hpBefore = s.e.hp[id]!;
    const stateBefore = s.e.state[id]!;
    expect(() =>
      spawnExplosion(s.e, s.grid, s.puffs, s.particles, s.rng, 0, 0, explosionProfile, undefined, undefined, -1),
    ).not.toThrow();
    expect(s.e.hp[id]!).toBe(hpBefore);
    expect(s.e.state[id]!).toBe(stateBefore);
  });
});
