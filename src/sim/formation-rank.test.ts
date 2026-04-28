import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity } from './entities';
import { createGrid, gridRebuild } from './spatial/grid';
import { inferFormationRank } from './formation-rank';

function makeGrid() {
  return createGrid({ minX: -100, minY: -100, maxX: 100, maxY: 100, cellSize: 2, capacity: 256 });
}

/** Place a 5-wide × 3-deep regiment at origin facing octant `facing`.
 *  Returns ids in row-major order: rear-rank-leftmost first, ..., front-rank-rightmost last.
 *  (i.e. rank 2 first 5 ids, rank 1 next 5, rank 0 last 5.) */
function spawnRegiment(e: ReturnType<typeof createEntities>, grid: ReturnType<typeof makeGrid>, facing: number, team = 0): number[] {
  const ids: number[] = [];
  const theta = (facing * Math.PI) / 4;
  const fx = Math.cos(theta), fy = Math.sin(theta);
  const rx = fy, ry = -fx; // perpendicular ("right")
  const SPACING_X = 1.0, SPACING_Y = 1.2;
  for (let r = 0; r < 3; r++) {       // r=0 is REAR, r=2 is FRONT
    for (let f = -2; f <= 2; f++) {
      const id = allocEntity(e);
      const rankIdxFromFront = 2 - r;            // rear-most has rankIdxFromFront=2
      const fwdOffset = (2 - rankIdxFromFront) * SPACING_Y; // front rank: 2*SY forward of rear
      e.restPosX[id] = fx * fwdOffset + rx * f * SPACING_X;
      e.restPosY[id] = fy * fwdOffset + ry * f * SPACING_X;
      e.posX[id] = e.restPosX[id]!;
      e.posY[id] = e.restPosY[id]!;
      e.restFacing[id] = facing;
      e.team[id] = team;
      ids.push(id);
    }
  }
  gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
  return ids;
}

describe('inferFormationRank', () => {
  it('axis-aligned (east-facing): front rank → 0, middle → 1, rear → 2', () => {
    const e = createEntities(64);
    const grid = makeGrid();
    const ids = spawnRegiment(e, grid, 0);
    for (let i = 0; i < 5; i++) expect(inferFormationRank(e, grid, ids[i + 10]!, 1.0, 1.2)).toBe(0);
    for (let i = 0; i < 5; i++) expect(inferFormationRank(e, grid, ids[i + 5]!, 1.0, 1.2)).toBe(1);
    for (let i = 0; i < 5; i++) expect(inferFormationRank(e, grid, ids[i]!, 1.0, 1.2)).toBe(2);
  });

  it('diagonal (NE-facing): same regiment shape, ranks still inferred correctly', () => {
    const e = createEntities(64);
    const grid = makeGrid();
    const ids = spawnRegiment(e, grid, 1);
    for (let i = 0; i < 5; i++) expect(inferFormationRank(e, grid, ids[i + 10]!, 1.0, 1.2)).toBe(0);
    for (let i = 0; i < 5; i++) expect(inferFormationRank(e, grid, ids[i + 5]!, 1.0, 1.2)).toBe(1);
    for (let i = 0; i < 5; i++) expect(inferFormationRank(e, grid, ids[i]!, 1.0, 1.2)).toBe(2);
  });

  it('all 8 facings: rear unit reports rank 2', () => {
    for (let facing = 0; facing < 8; facing++) {
      const e = createEntities(64);
      const grid = makeGrid();
      const ids = spawnRegiment(e, grid, facing);
      expect(inferFormationRank(e, grid, ids[0]!, 1.0, 1.2)).toBe(2);
    }
  });

  it('lone soldier: rank 0', () => {
    const e = createEntities(8);
    const grid = makeGrid();
    const id = allocEntity(e);
    e.restPosX[id] = 0; e.restPosY[id] = 0;
    e.posX[id] = 0; e.posY[id] = 0;
    e.restFacing[id] = 0;
    e.team[id] = 0;
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferFormationRank(e, grid, id, 1.0, 1.2)).toBe(0);
  });

  it('opposing-team neighbors do not contribute', () => {
    const e = createEntities(16);
    const grid = makeGrid();
    const me = allocEntity(e);
    e.restPosX[me] = 0; e.restPosY[me] = 0;
    e.posX[me] = 0; e.posY[me] = 0;
    e.restFacing[me] = 0; e.team[me] = 0;
    const enemy = allocEntity(e);
    e.restPosX[enemy] = 1.2; e.restPosY[enemy] = 0;
    e.posX[enemy] = 1.2; e.posY[enemy] = 0;
    e.restFacing[enemy] = 0; e.team[enemy] = 1;
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferFormationRank(e, grid, me, 1.0, 1.2)).toBe(0);
  });

  it('different restFacing neighbors do not contribute', () => {
    const e = createEntities(16);
    const grid = makeGrid();
    const me = allocEntity(e);
    e.restPosX[me] = 0; e.restPosY[me] = 0;
    e.posX[me] = 0; e.posY[me] = 0;
    e.restFacing[me] = 0; e.team[me] = 0;
    const stranger = allocEntity(e);
    e.restPosX[stranger] = 1.2; e.restPosY[stranger] = 0;
    e.posX[stranger] = 1.2; e.posY[stranger] = 0;
    e.restFacing[stranger] = 4;
    e.team[stranger] = 0;
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferFormationRank(e, grid, me, 1.0, 1.2)).toBe(0);
  });

  it('result clamps at MAX_TRACKED_RANKS-1 = 2', () => {
    const e = createEntities(64);
    const grid = makeGrid();
    const ids: number[] = [];
    for (let r = 0; r < 6; r++) {
      const id = allocEntity(e);
      e.restPosX[id] = -r * 1.2;
      e.restPosY[id] = 0;
      e.posX[id] = e.restPosX[id]!;
      e.posY[id] = e.restPosY[id]!;
      e.restFacing[id] = 0;
      e.team[id] = 0;
      ids.push(id);
    }
    gridRebuild(grid, e.aliveIds, e.count, e.posX, e.posY);
    expect(inferFormationRank(e, grid, ids[5]!, 1.0, 1.2)).toBe(2);
  });
});
