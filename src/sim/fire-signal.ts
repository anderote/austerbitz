import type { Grid } from './spatial/grid';
import { cellOf } from './spatial/grid';
import { MAX_TRACKED_RANKS } from './entities';

/**
 * Per-cell-per-team-per-rank last-fire-tick. Combat-system reads the firer's
 * 3x3 cell neighbourhood for own team to decide whether to join a volley.
 *
 * Index = (cellIndex * 2 + team) * MAX_TRACKED_RANKS + rank. Sentinel `-1`
 * = never fired. Ranks past MAX_TRACKED_RANKS-1 share the last bucket
 * (irrelevant in practice — only ranks 0/1 fire).
 */
export interface FireSignal {
  tickByCellTeamRank: Int32Array;
}

export function createFireSignal(grid: Grid): FireSignal {
  const cells = grid.cols * grid.rows;
  const arr = new Int32Array(cells * 2 * MAX_TRACKED_RANKS);
  arr.fill(-1);
  return { tickByCellTeamRank: arr };
}

function clampRank(rank: number): number {
  if (rank < 0) return 0;
  if (rank >= MAX_TRACKED_RANKS) return MAX_TRACKED_RANKS - 1;
  return rank;
}

export function writeFireSignal(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  rank: number,
  tick: number,
): void {
  const c = cellOf(grid, x, y);
  const r = clampRank(rank);
  fs.tickByCellTeamRank[(c * 2 + team) * MAX_TRACKED_RANKS + r] = tick;
}

/**
 * True iff any cell in the 3x3 neighbourhood around (x,y) has a same-team
 * same-rank fire whose age in ticks is `<= windowTicks`.
 */
export function hasRecentFire(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  rank: number,
  tick: number,
  windowTicks: number,
): boolean {
  return scan(fs, grid, x, y, team, clampRank(rank), tick, windowTicks, false);
}

/** Same as hasRecentFire but matches any rank (used by Volley stance). */
export function hasRecentFireAnyRank(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  tick: number,
  windowTicks: number,
): boolean {
  return scan(fs, grid, x, y, team, 0, tick, windowTicks, true);
}

function scan(
  fs: FireSignal,
  grid: Grid,
  x: number, y: number,
  team: number,
  rank: number,
  tick: number,
  windowTicks: number,
  anyRank: boolean,
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
  const arr = fs.tickByCellTeamRank;
  for (let yy = cy0; yy <= cy1; yy++) {
    const rowBase = yy * cols;
    for (let xx = cx0; xx <= cx1; xx++) {
      const c = rowBase + xx;
      const base = (c * 2 + team) * MAX_TRACKED_RANKS;
      if (anyRank) {
        for (let r = 0; r < MAX_TRACKED_RANKS; r++) {
          const t = arr[base + r]!;
          if (t >= 0 && tick - t <= windowTicks) return true;
        }
      } else {
        const t = arr[base + rank]!;
        if (t >= 0 && tick - t <= windowTicks) return true;
      }
    }
  }
  return false;
}
