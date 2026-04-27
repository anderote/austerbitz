import { describe, it, expect } from 'vitest';
import { createGrid } from './spatial/grid';
import {
  createFireSignal,
  writeFireSignal,
  hasRecentFire,
} from './fire-signal';

function makeGrid() {
  return createGrid({
    minX: 0, minY: 0, maxX: 200, maxY: 200,
    cellSize: 2, capacity: 64,
  });
}

describe('fireSignal', () => {
  it('createFireSignal initialises every entry to -1 (no fire ever)', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    expect(fs.tickByCellTeam.length).toBe(grid.cols * grid.rows * 2);
    for (let i = 0; i < fs.tickByCellTeam.length; i++) {
      expect(fs.tickByCellTeam[i]).toBe(-1);
    }
  });

  it('writeFireSignal records the tick at the firer cell + team slot', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 42);
    // Same cell, team 0 → set; team 1 in same cell → still -1.
    expect(hasRecentFire(fs, grid, 50, 50, 0, 42, 9)).toBe(true);
    expect(hasRecentFire(fs, grid, 50, 50, 1, 42, 9)).toBe(false);
  });

  it('hasRecentFire returns true within the window, false outside', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 100);
    expect(hasRecentFire(fs, grid, 50, 50, 0, 100, 9)).toBe(true);  // age 0
    expect(hasRecentFire(fs, grid, 50, 50, 0, 109, 9)).toBe(true);  // age 9 (boundary)
    expect(hasRecentFire(fs, grid, 50, 50, 0, 110, 9)).toBe(false); // age 10
  });

  it('hasRecentFire scans the 3x3 cell neighbourhood', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    writeFireSignal(fs, grid, 50, 50, 0, 100);
    // 1.5 m away — same cell.
    expect(hasRecentFire(fs, grid, 51.5, 50, 0, 100, 9)).toBe(true);
    // 3 m away — neighbour cell, still in 3x3.
    expect(hasRecentFire(fs, grid, 53, 50, 0, 100, 9)).toBe(true);
    // ~7 m away — beyond 3x3 (cells are 2 m, neighbourhood spans ±2 cells = 4 m from cell centre).
    expect(hasRecentFire(fs, grid, 57, 50, 0, 100, 9)).toBe(false);
  });

  it('hasRecentFire returns false on the never-fired sentinel even at tick 0', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    expect(hasRecentFire(fs, grid, 0, 0, 0, 0, 9)).toBe(false);
    expect(hasRecentFire(fs, grid, 0, 0, 1, 0, 9)).toBe(false);
  });

  it('writeFireSignal at the grid edge clamps into the grid', () => {
    const grid = makeGrid();
    const fs = createFireSignal(grid);
    // (0,0) sits in the corner cell.
    writeFireSignal(fs, grid, 0, 0, 1, 7);
    expect(hasRecentFire(fs, grid, 0, 0, 1, 7, 9)).toBe(true);
  });
});
