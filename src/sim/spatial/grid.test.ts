import { describe, it, expect } from 'vitest';
import { createGrid, gridClear, gridInsert, gridQueryRect, gridQueryRadius } from './grid';

describe('uniform spatial grid', () => {
  it('inserts entities and finds them within a rect', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 1000, maxY: 1000, cellSize: 10 });
    gridClear(g);
    gridInsert(g, 1, 5, 5);
    gridInsert(g, 2, 50, 50);
    gridInsert(g, 3, 500, 500);

    const out = gridQueryRect(g, -1, -1, 60, 60);
    expect(out.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('returns entities within a radius (rectangular cell prefilter, then exact)', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 1000, maxY: 1000, cellSize: 10 });
    gridClear(g);
    gridInsert(g, 1, 100, 100);
    gridInsert(g, 2, 105, 105);
    gridInsert(g, 3, 200, 200);

    const out = gridQueryRadius(g, 100, 100, 20);
    expect(out.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('clears between rebuilds', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10 });
    gridClear(g);
    gridInsert(g, 1, 5, 5);
    expect(gridQueryRect(g, 0, 0, 100, 100)).toEqual([1]);
    gridClear(g);
    expect(gridQueryRect(g, 0, 0, 100, 100)).toEqual([]);
  });

  it('handles points outside bounds gracefully (clamped)', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10 });
    gridClear(g);
    gridInsert(g, 1, -5, -5);
    gridInsert(g, 2, 200, 200);
    const out = gridQueryRect(g, -1000, -1000, 1000, 1000);
    expect(out.sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
