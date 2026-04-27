import { describe, it, expect } from 'vitest';
import {
  createGrid,
  gridRebuild,
  gridQueryRect,
  gridQueryRadius,
  gridSweptQuery,
  type Grid,
} from './grid';

/** Test helper: build a grid + rebuild from id/x/y triples. */
function buildGrid(
  cfg: { minX: number; minY: number; maxX: number; maxY: number; cellSize: number },
  triples: Array<[id: number, x: number, y: number]>,
): Grid {
  const maxId = triples.reduce((m, [id]) => Math.max(m, id), 0);
  const cap = Math.max(triples.length, maxId + 1, 8);
  const g = createGrid({ ...cfg, capacity: cap });
  // Pack ids into the alive list and use parallel posX/posY arrays.
  const aliveIds = new Int32Array(cap);
  const posX = new Float32Array(cap);
  const posY = new Float32Array(cap);
  for (let i = 0; i < triples.length; i++) {
    const [id, x, y] = triples[i]!;
    aliveIds[i] = id;
    posX[id] = x;
    posY[id] = y;
  }
  gridRebuild(g, aliveIds, triples.length, posX, posY);
  return g;
}

function asArray(buf: Int32Array, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(buf[i]!);
  return out;
}

describe('uniform spatial grid', () => {
  it('rebuilds and finds entities within a rect', () => {
    const g = buildGrid(
      { minX: 0, minY: 0, maxX: 1000, maxY: 1000, cellSize: 10 },
      [[1, 5, 5], [2, 50, 50], [3, 500, 500]],
    );
    const out = new Int32Array(16);
    const n = gridQueryRect(g, -1, -1, 60, 60, out);
    expect(asArray(out, n).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('returns entities within a radius (rectangular cell prefilter, then exact)', () => {
    const g = buildGrid(
      { minX: 0, minY: 0, maxX: 1000, maxY: 1000, cellSize: 10 },
      [[1, 100, 100], [2, 105, 105], [3, 200, 200]],
    );
    const out = new Int32Array(16);
    const n = gridQueryRadius(g, 100, 100, 20, out);
    expect(asArray(out, n).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('clears between rebuilds', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10, capacity: 8 });
    const aliveIds = new Int32Array(8);
    const posX = new Float32Array(8);
    const posY = new Float32Array(8);
    aliveIds[0] = 1; posX[1] = 5; posY[1] = 5;
    gridRebuild(g, aliveIds, 1, posX, posY);
    const out = new Int32Array(16);
    expect(asArray(out, gridQueryRect(g, 0, 0, 100, 100, out))).toEqual([1]);
    gridRebuild(g, aliveIds, 0, posX, posY);
    expect(gridQueryRect(g, 0, 0, 100, 100, out)).toBe(0);
  });

  it('handles points outside bounds gracefully (clamped)', () => {
    const g = buildGrid(
      { minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10 },
      [[1, -5, -5], [2, 200, 200]],
    );
    const out = new Int32Array(16);
    const n = gridQueryRect(g, -1000, -1000, 1000, 1000, out);
    expect(asArray(out, n).sort((a, b) => a - b)).toEqual([1, 2]);
  });
});

describe('gridSweptQuery', () => {
  it('returns nothing for an empty grid', () => {
    const g = createGrid({ minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10, capacity: 8 });
    const out = new Int32Array(16);
    const n = gridSweptQuery(g, 5, 5, 95, 95, out);
    expect(n).toBe(0);
  });

  it('finds an entity whose cell the segment crosses', () => {
    // cellSize 4, entity at (5,5) → cell (1,1).
    const g = buildGrid(
      { minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 },
      [[7, 5, 5]],
    );
    const out = new Int32Array(16);
    const n = gridSweptQuery(g, 0, 5, 10, 5, out);
    expect(asArray(out, n)).toContain(7);
  });

  it('returns candidates sorted by parametric t along the segment', () => {
    // cellSize 4. Place three entities in three distinct cells along a
    // shallow diagonal so the DDA visits them in an unambiguous order.
    //   id 10 at (1, 1)  → cell (0, 0)
    //   id 20 at (10, 5) → cell (2, 1)
    //   id 30 at (19, 9) → cell (4, 2)
    // Sweep (0, 0) → (20, 10): slope = 0.5, no diagonal corner ambiguity.
    const g = buildGrid(
      { minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 },
      [[10, 1, 1], [20, 10, 5], [30, 19, 9]],
    );

    const out = new Int32Array(16);
    const n = gridSweptQuery(g, 0, 0, 20, 10, out);
    const arr = asArray(out, n);

    expect(arr).toContain(10);
    expect(arr).toContain(20);
    expect(arr).toContain(30);

    const i10 = arr.indexOf(10);
    const i20 = arr.indexOf(20);
    const i30 = arr.indexOf(30);
    expect(i10).toBeLessThan(i20);
    expect(i20).toBeLessThan(i30);
  });

  it('does not include entities whose cells the segment misses', () => {
    const g = buildGrid(
      { minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 },
      [
        [1, 5, 5], // on path: cell (1, 1)
        [99, 5, 30], // off path: cell (1, 7)
      ],
    );

    const out = new Int32Array(16);
    const n = gridSweptQuery(g, 0, 5, 40, 5, out);
    const arr = asArray(out, n);

    expect(arr).toContain(1);
    expect(arr).not.toContain(99);
  });

  it('returns nothing for a segment entirely outside the grid bounds', () => {
    const g = buildGrid(
      { minX: 0, minY: 0, maxX: 100, maxY: 100, cellSize: 10 },
      [[42, 50, 50]],
    );

    const out = new Int32Array(16);
    // Wholly outside the [0,100]×[0,100] AABB.
    expect(gridSweptQuery(g, -50, -50, -10, -10, out)).toBe(0);

    // And a parallel-outside case (constant y below the grid).
    expect(gridSweptQuery(g, -50, -10, 150, -10, out)).toBe(0);
  });

  it('handles a zero-length segment by returning the start cell contents', () => {
    const g = buildGrid(
      { minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 },
      [[5, 5, 5], [6, 5, 5]],
    );

    const out = new Int32Array(16);
    const n = gridSweptQuery(g, 5, 5, 5, 5, out);
    expect(asArray(out, n).sort((a, b) => a - b)).toEqual([5, 6]);
  });

  it('writes from index 0 on each call (no carry-over from prior runs)', () => {
    const g = buildGrid(
      { minX: 0, minY: 0, maxX: 40, maxY: 40, cellSize: 4 },
      [[1, 5, 5]],
    );

    // Pre-poison the buffer to make sure we only trust the returned count.
    const out = new Int32Array(16);
    out[0] = 777;
    out[1] = 888;
    const n = gridSweptQuery(g, 0, 5, 10, 5, out);
    expect(asArray(out, n)).toContain(1);
    expect(asArray(out, n)).not.toContain(777);
    expect(asArray(out, n)).not.toContain(888);
  });
});
