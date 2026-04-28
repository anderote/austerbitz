import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity, EntityState } from '../entities';
import { createGrid, gridRebuild } from '../spatial/grid';
import { createParticles } from '../../particles/particles';
import { createDebris } from '../debris';
import { createBloodSplats } from '../blood-splats';
import { createRng } from '../../util/rng';
import { createShockwaves, allocShockwave } from '../../fx/shockwaves';
import { updateShockwaves } from './shockwave-system';

function setupEntity(e: ReturnType<typeof createEntities>, x: number, y: number, hp: number, team = 0): number {
  const id = allocEntity(e);
  e.posX[id] = x; e.posY[id] = y;
  e.team[id] = team;
  e.hp[id] = hp;
  e.state[id] = EntityState.Idle;
  return id;
}

describe('updateShockwaves', () => {
  it('hits each entity in the radius exactly once across ticks', () => {
    const entities = createEntities(64);
    const grid = createGrid({ minX: 0, minY: 0, maxX: 200, maxY: 200, cellSize: 4, capacity: 64 });
    const particles = createParticles(1024);
    const debris = createDebris(64);
    const splats = createBloodSplats(64);
    const rng = createRng(1);
    const sw = createShockwaves(2, 64);

    // 3 entities at increasing distance from (100, 100): inside, mid, outside (r=6)
    const aId = setupEntity(entities, 102, 100, 50);   // ~2m from center
    const bId = setupEntity(entities, 104, 100, 50);   // ~4m
    const cId = setupEntity(entities, 110, 100, 50);   // ~10m (outside r=6)
    gridRebuild(grid, entities.aliveIds, entities.count, entities.posX, entities.posY);

    const id = allocShockwave(sw);
    sw.x[id] = 100; sw.y[id] = 100;
    sw.fullRadius[id] = 6;
    sw.waveSpeed[id] = 120;
    sw.damage[id] = 60;
    sw.impulse[id] = 1000;

    // Step until wave fully resolves (~50ms).
    const dt = 1 / 60;
    for (let i = 0; i < 8; i++) {
      updateShockwaves(sw, entities, grid, particles, rng, splats, debris, dt);
    }

    expect(entities.hp[aId]).toBeLessThan(50);
    expect(entities.hp[bId]).toBeLessThan(50);
    expect(entities.hp[cId]).toBe(50);                   // never hit
    expect(entities.hp[aId]).toBeLessThan(entities.hp[bId]!); // closer = more damage (falloff)
  });

  it('respects excludeTeam', () => {
    const entities = createEntities(8);
    const grid = createGrid({ minX: 0, minY: 0, maxX: 200, maxY: 200, cellSize: 4, capacity: 8 });
    const particles = createParticles(64);
    const debris = createDebris(8);
    const splats = createBloodSplats(8);
    const rng = createRng(2);
    const sw = createShockwaves(1, 8);

    const friendly = setupEntity(entities, 102, 100, 50, 1);
    const enemy = setupEntity(entities, 102, 100, 50, 0);
    gridRebuild(grid, entities.aliveIds, entities.count, entities.posX, entities.posY);

    const id = allocShockwave(sw);
    sw.x[id] = 100; sw.y[id] = 100;
    sw.fullRadius[id] = 6; sw.waveSpeed[id] = 120;
    sw.damage[id] = 60; sw.impulse[id] = 1000;
    sw.excludeTeam[id] = 1;

    for (let i = 0; i < 8; i++) {
      updateShockwaves(sw, entities, grid, particles, rng, splats, debris, 1/60);
    }

    expect(entities.hp[friendly]).toBe(50);
    expect(entities.hp[enemy]).toBeLessThan(50);
  });
});
