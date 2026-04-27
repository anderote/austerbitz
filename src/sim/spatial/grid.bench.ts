import { bench, describe } from 'vitest';
import { createGrid, gridRebuild, gridQueryRadius } from './grid';

/**
 * Build a `cols × rows` formation block: positions packed at 1 m spacing,
 * centred in a square map of `mapSize` metres. Returns the parallel arrays
 * the grid wants. cellSize is the design-locked 2 m default.
 */
function makeFormation(cols: number, rows: number, mapSize = 1024) {
  const n = cols * rows;
  const aliveIds = new Int32Array(n);
  const posX = new Float32Array(n);
  const posY = new Float32Array(n);
  const x0 = (mapSize - cols) / 2;
  const y0 = (mapSize - rows) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = r * cols + c;
      aliveIds[id] = id;
      posX[id] = x0 + c;
      posY[id] = y0 + r;
    }
  }
  return { aliveIds, posX, posY, n, mapSize };
}

// Each scenario allocs once outside the bench body so we measure the hot loop only.
const N10K = makeFormation(100, 100);
const G10K = createGrid({
  minX: 0, minY: 0, maxX: N10K.mapSize, maxY: N10K.mapSize,
  cellSize: 2, capacity: N10K.n,
});
const QBUF_10K = new Int32Array(1024);

const N20K = makeFormation(200, 100);
const G20K = createGrid({
  minX: 0, minY: 0, maxX: N20K.mapSize, maxY: N20K.mapSize,
  cellSize: 2, capacity: N20K.n,
});
const QBUF_20K = new Int32Array(1024);

describe('grid: rebuild + per-entity radius query (formation density)', () => {
  bench('10000 entities (100x100 block)', () => {
    gridRebuild(G10K, N10K.aliveIds, N10K.n, N10K.posX, N10K.posY);
    let acc = 0;
    for (let n = 0; n < N10K.n; n++) {
      const id = N10K.aliveIds[n]!;
      acc += gridQueryRadius(G10K, N10K.posX[id]!, N10K.posY[id]!, 1.65, QBUF_10K);
    }
    if (acc < 0) throw new Error('unreachable'); // keep result live
  });

  bench('20000 entities (200x100 block)', () => {
    gridRebuild(G20K, N20K.aliveIds, N20K.n, N20K.posX, N20K.posY);
    let acc = 0;
    for (let n = 0; n < N20K.n; n++) {
      const id = N20K.aliveIds[n]!;
      acc += gridQueryRadius(G20K, N20K.posX[id]!, N20K.posY[id]!, 1.65, QBUF_20K);
    }
    if (acc < 0) throw new Error('unreachable');
  });
});
