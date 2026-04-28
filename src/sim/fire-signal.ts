import type { Grid } from './spatial/grid';
import { cellOf } from './spatial/grid';

/**
 * Per-cell-per-team last-fire-tick. Combat-system reads the firer's 3x3
 * cell neighbourhood for own team to decide whether to join a volley.
 *
 * Index = cellIndex * 2 + team. Sentinel `-1` = never fired.
 */
export interface FireSignal {
  tickByCellTeam: Int32Array;
}

export function createFireSignal(grid: Grid): FireSignal {
  const cells = grid.cols * grid.rows;
  const arr = new Int32Array(cells * 2);
  arr.fill(-1);
  return { tickByCellTeam: arr };
}

export function writeFireSignal(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  tick: number,
): void {
  const c = cellOf(grid, x, y);
  fs.tickByCellTeam[c * 2 + team] = tick;
}

/**
 * True iff any cell in the 3x3 neighbourhood around (x,y) has a same-team
 * fire whose age in ticks is `<= windowTicks`. The never-fired sentinel
 * `-1` always reports false (since `tick - (-1)` exceeds any reasonable
 * window).
 */
export function hasRecentFire(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  tick: number,
  windowTicks: number,
): boolean {
  const cellSize = grid.cfg.cellSize;
  const minX = grid.cfg.minX;
  const minY = grid.cfg.minY;
  const cols = grid.cols;
  const rows = grid.rows;
  const cx = Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cellSize)));
  const cy = Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / cellSize)));
  const cx0 = Math.max(0, cx - 1);
  const cx1 = Math.min(cols - 1, cx + 1);
  const cy0 = Math.max(0, cy - 1);
  const cy1 = Math.min(rows - 1, cy + 1);
  const arr = fs.tickByCellTeam;
  for (let yy = cy0; yy <= cy1; yy++) {
    const rowBase = yy * cols;
    for (let xx = cx0; xx <= cx1; xx++) {
      const c = rowBase + xx;
      const t = arr[c * 2 + team]!;
      if (t >= 0 && tick - t <= windowTicks) return true;
    }
  }
  return false;
}
