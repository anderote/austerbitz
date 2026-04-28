import { describe, it, expect } from 'vitest';
import { createGrid } from './spatial/grid';
import { MAX_TRACKED_RANKS } from './entities';
import {
  createFireSignal,
  writeFireSignal,
  hasRecentFire,
  hasRecentFireAnyRank,
} from './fire-signal';

function makeGrid() {
  return createGrid({
    minX: 0, minY: 0, maxX: 200, maxY: 200,
    cellSize: 2, capacity: 64,
  });
}

describe('fireSignal', () => {
  it('createFireSignal initialises every (cell,team,rank) entry to -1', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    expect(fs.tickByCellTeamRank.length).toBe(grid.cols * grid.rows * 2 * MAX_TRACKED_RANKS);
    for (let i = 0; i < fs.tickByCellTeamRank.length; i++) {
      expect(fs.tickByCellTeamRank[i]).toBe(-1);
    }
  });

  it('writeFireSignal records the tick at the firer cell + team + rank', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 0, 42);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 42, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 50, 50, 1, 0, 42, 9)).toBe(false); // wrong team
    expect(hasRecentFire(fs, grid, 50, 50, 0, 1, 42, 9)).toBe(false); // wrong rank
  });

  it('hasRecentFire returns true within the window, false outside', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 0, 100);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 100, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 109, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 110, 9)).toBe(false);
  });

  it('hasRecentFire scans the 3x3 cell neighbourhood', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 0, 100);
    expect(hasRecentFire(fs, grid, 51.5, 50, 0, 0, 100, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 53,   50, 0, 0, 100, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 57,   50, 0, 0, 100, 9)).toBe(false);
  });

  it('hasRecentFire returns false on the never-fired sentinel', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    expect(hasRecentFire(fs, grid, 0, 0, 0, 0, 0, 9)).toBe(false);
    expect(hasRecentFire(fs, grid, 0, 0, 1, 0, 0, 9)).toBe(false);
  });

  it('writeFireSignal at the grid edge clamps into the grid', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 0, 0, 1, 0, 7);
    expect(hasRecentFire(fs, grid, 0, 0, 1, 0, 7, 9)).toBe(true);
  });

  it('hasRecentFireAnyRank matches a write on any rank', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 1, 100); // rank 1 fires
    expect(hasRecentFireAnyRank(fs, grid, 50, 50, 0, 100, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 0, 100, 9)).toBe(false); // rank 0 read misses
    expect(hasRecentFire(fs, grid, 50, 50, 0, 1, 100, 9)).toBe(true);  // rank 1 read hits
  });

  it('writeFireSignal clamps rank to MAX_TRACKED_RANKS-1', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 99, 100); // out-of-range rank
    expect(hasRecentFire(fs, grid, 50, 50, 0, MAX_TRACKED_RANKS - 1, 100, 9)).toBe(true);
  });
});
