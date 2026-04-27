import { describe, it, expect } from 'vitest';
import {
  createGrid,
  gridClear,
  gridInsert,
  gridQueryRect,
  gridQueryRadius,
  gridSweptQuery,
} from './grid';

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

describe('gridSweptQuery', () => {
  it('returns nothing for an empty grid', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10 });
    gridClear(g);
    const out: number[] = [];
    gridSweptQuery(g, 5, 5, 95, 95, out);
    expect(out).toEqual([]);
  });

  it('finds an entity whose cell the segment crosses', () => {
    // cellSize 4, entity at (5,5) → cell (1,1).
    const g = createGrid({ minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 });
    gridClear(g);
    gridInsert(g, 7, 5, 5);
    const out: number[] = [];
    gridSweptQuery(g, 0, 5, 10, 5, out);
    expect(out).toContain(7);
  });

  it('returns candidates sorted by parametric t along the segment', () => {
    // cellSize 4. Place three entities in three distinct cells along a
    // shallow diagonal so the DDA visits them in an unambiguous order.
    //   id 10 at (1, 1)  → cell (0, 0)
    //   id 20 at (10, 5) → cell (2, 1)
    //   id 30 at (19, 9) → cell (4, 2)
    // Sweep (0, 0) → (20, 10): slope = 0.5, no diagonal corner ambiguity.
    const g = createGrid({ minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 });
    gridClear(g);
    gridInsert(g, 10, 1, 1);
    gridInsert(g, 20, 10, 5);
    gridInsert(g, 30, 19, 9);

    const out: number[] = [];
    gridSweptQuery(g, 0, 0, 20, 10, out);

    expect(out).toContain(10);
    expect(out).toContain(20);
    expect(out).toContain(30);

    const i10 = out.indexOf(10);
    const i20 = out.indexOf(20);
    const i30 = out.indexOf(30);
    expect(i10).toBeLessThan(i20);
    expect(i20).toBeLessThan(i30);
  });

  it('does not include entities whose cells the segment misses', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 });
    gridClear(g);
    // On the swept path:
    gridInsert(g, 1, 5, 5); // cell (1, 1)
    // Off the swept path (a horizontal sweep along y≈5 won't touch row 7):
    gridInsert(g, 99, 5, 30); // cell (1, 7)

    const out: number[] = [];
    gridSweptQuery(g, 0, 5, 40, 5, out);

    expect(out).toContain(1);
    expect(out).not.toContain(99);
  });

  it('returns nothing for a segment entirely outside the grid bounds', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10 });
    gridClear(g);
    // Insert something inside the grid so we'd notice if we erroneously
    // ran the DDA over clamped cells.
    gridInsert(g, 42, 50, 50);

    const out: number[] = [];
    // Wholly outside the [0,100]×[0,100] AABB.
    gridSweptQuery(g, -50, -50, -10, -10, out);
    expect(out).toEqual([]);

    // And a parallel-outside case (constant y below the grid).
    gridSweptQuery(g, -50, -10, 150, -10, out);
    expect(out).toEqual([]);
  });

  it('handles a zero-length segment by returning the start cell contents', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 });
    gridClear(g);
    gridInsert(g, 5, 5, 5); // cell (1, 1)
    gridInsert(g, 6, 5, 5); // cell (1, 1) — same cell

    const out: number[] = [];
    gridSweptQuery(g, 5, 5, 5, 5, out);
    expect(out.sort((a, b) => a - b)).toEqual([5, 6]);
  });

  it('clears the output array on each call', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 });
    gridClear(g);
    gridInsert(g, 1, 5, 5);

    const out: number[] = [777, 888]; // pre-populated
    gridSweptQuery(g, 0, 5, 10, 5, out);
    expect(out).not.toContain(777);
    expect(out).not.toContain(888);
    expect(out).toContain(1);
  });
});
