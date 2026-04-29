import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity, EntityState } from './entities';
import { createGrid, gridRebuild } from './spatial/grid';
import {
  inferCohesion,
  cohesionSpeedMult,
  COHESION_RADIUS_M,
  COHESION_FULL_AT,
} from './cohesion';

function makeGrid() {
  return createGrid({ minX: -100, minY: -100, maxX: 100, maxY: 100, cellSize: 2, capacity: 256 });
}

function spawnAt(e: ReturnType<typeof createEntities>, x: number, y: number, team = 0): number {
  const id = allocEntity(e);
  e.posX[id] = x;
  e.posY[id] = y;
  e.team[id] = team;
  e.state[id] = EntityState.Idle;
  return id;
}

describe('inferCohesion', () => {
  it('lone soldier → 0', () => {
    const e = createEntities(8);
    const grid = makeGrid();
    const id = spawnAt(e, 0, 0);
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferCohesion(e, grid, id)).toBe(0);
  });

  it('saturates at COHESION_FULL_AT same-team neighbors → 1', () => {
    const e = createEntities(32);
    const grid = makeGrid();
    const me = spawnAt(e, 0, 0);
    for (let k = 0; k < COHESION_FULL_AT; k++) {
      const theta = (k / COHESION_FULL_AT) * Math.PI * 2;
      spawnAt(e, Math.cos(theta) * 1.0, Math.sin(theta) * 1.0);
    }
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferCohesion(e, grid, me)).toBe(1);
  });

  it('half-saturation: 3 neighbors → 0.5', () => {
    const e = createEntities(16);
    const grid = makeGrid();
    const me = spawnAt(e, 0, 0);
    spawnAt(e, 1, 0);
    spawnAt(e, -1, 0);
    spawnAt(e, 0, 1);
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferCohesion(e, grid, me)).toBeCloseTo(0.5, 6);
  });

  it('cross-team neighbors do not count', () => {
    const e = createEntities(16);
    const grid = makeGrid();
    const me = spawnAt(e, 0, 0, 0);
    for (let k = 0; k < 6; k++) {
      const theta = (k / 6) * Math.PI * 2;
      spawnAt(e, Math.cos(theta) * 1.0, Math.sin(theta) * 1.0, 1);
    }
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferCohesion(e, grid, me)).toBe(0);
  });

  it('Dead/Dying/Ragdoll neighbors do not count', () => {
    const e = createEntities(16);
    const grid = makeGrid();
    const me = spawnAt(e, 0, 0);
    const dead = spawnAt(e, 1, 0);
    const dying = spawnAt(e, -1, 0);
    const rag = spawnAt(e, 0, 1);
    e.state[dead] = EntityState.Dead;
    e.state[dying] = EntityState.Dying;
    e.state[rag] = EntityState.Ragdoll;
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferCohesion(e, grid, me)).toBe(0);
  });

  it('neighbors outside COHESION_RADIUS_M do not count', () => {
    const e = createEntities(16);
    const grid = makeGrid();
    const me = spawnAt(e, 0, 0);
    // Just outside the radius along each cardinal axis.
    const eps = 0.01;
    spawnAt(e, COHESION_RADIUS_M + eps, 0);
    spawnAt(e, -(COHESION_RADIUS_M + eps), 0);
    spawnAt(e, 0, COHESION_RADIUS_M + eps);
    spawnAt(e, 0, -(COHESION_RADIUS_M + eps));
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferCohesion(e, grid, me)).toBe(0);
  });
});

describe('cohesionSpeedMult', () => {
  it('cohesion 0 → 1.0', () => {
    expect(cohesionSpeedMult(0)).toBe(1);
  });

  it('cohesion 1 → 1.5', () => {
    expect(cohesionSpeedMult(1)).toBe(1.5);
  });

  it('monotonic non-decreasing across [0,1]', () => {
    let prev = -Infinity;
    for (let k = 0; k <= 20; k++) {
      const v = cohesionSpeedMult(k / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
