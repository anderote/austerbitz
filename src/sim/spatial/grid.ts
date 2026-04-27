export interface GridConfig {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cellSize: number;
}

export interface Grid {
  cfg: GridConfig;
  cols: number;
  rows: number;
  cells: number[][]; // row-major; each cell holds entity ids
}

export function createGrid(cfg: GridConfig): Grid {
  const cols = Math.max(1, Math.ceil((cfg.maxX - cfg.minX) / cfg.cellSize));
  const rows = Math.max(1, Math.ceil((cfg.maxY - cfg.minY) / cfg.cellSize));
  const cells: number[][] = new Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = [];
  return { cfg, cols, rows, cells };
}

function cellIndex(g: Grid, x: number, y: number): number {
  const cx = Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.cfg.minX) / g.cfg.cellSize)));
  const cy = Math.max(0, Math.min(g.rows - 1, Math.floor((y - g.cfg.minY) / g.cfg.cellSize)));
  return cy * g.cols + cx;
}

export function gridClear(g: Grid): void {
  for (const c of g.cells) c.length = 0;
}

export function gridInsert(g: Grid, id: number, x: number, y: number): void {
  g.cells[cellIndex(g, x, y)]!.push(id);
}

export function gridQueryRect(g: Grid, x0: number, y0: number, x1: number, y1: number): number[] {
  const cx0 = Math.max(0, Math.min(g.cols - 1, Math.floor((x0 - g.cfg.minX) / g.cfg.cellSize)));
  const cx1 = Math.max(0, Math.min(g.cols - 1, Math.floor((x1 - g.cfg.minX) / g.cfg.cellSize)));
  const cy0 = Math.max(0, Math.min(g.rows - 1, Math.floor((y0 - g.cfg.minY) / g.cfg.cellSize)));
  const cy1 = Math.max(0, Math.min(g.rows - 1, Math.floor((y1 - g.cfg.minY) / g.cfg.cellSize)));
  const out: number[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const cell = g.cells[cy * g.cols + cx]!;
      for (let i = 0; i < cell.length; i++) out.push(cell[i]!);
    }
  }
  return out;
}

export function gridQueryRadius(g: Grid, x: number, y: number, r: number): number[] {
  return gridQueryRect(g, x - r, y - r, x + r, y + r);
}

/**
 * Walks the cells crossed by the segment (ax,ay)→(bx,by) using DDA
 * (Amanatides & Woo) and writes each cell's entity ids into `out`,
 * in order of ascending parametric `t` along the segment. The caller
 * is responsible for any further per-candidate refinement (e.g. the
 * Z-range check described in §6 of the combat-effects spec).
 *
 * `out` is cleared at the start. Because `gridInsert` places each
 * entity in exactly one cell, the same entity cannot appear twice.
 */
export function gridSweptQuery(
  g: Grid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  out: number[],
): void {
  out.length = 0;
  const { minX, minY, maxX, maxY, cellSize } = g.cfg;

  const dx = bx - ax;
  const dy = by - ay;

  // Zero-length segment: visit just the start cell (if inside the grid).
  if (dx === 0 && dy === 0) {
    if (ax < minX || ax > maxX || ay < minY || ay > maxY) return;
    const cx = Math.max(0, Math.min(g.cols - 1, Math.floor((ax - minX) / cellSize)));
    const cy = Math.max(0, Math.min(g.rows - 1, Math.floor((ay - minY) / cellSize)));
    const cell = g.cells[cy * g.cols + cx]!;
    for (let i = 0; i < cell.length; i++) out.push(cell[i]!);
    return;
  }

  // Liang-Barsky clip the segment against the grid AABB. If the segment
  // does not intersect the grid at all, there is nothing to do.
  let t0 = 0;
  let t1 = 1;
  const ps = [-dx, dx, -dy, dy];
  const qs = [ax - minX, maxX - ax, ay - minY, maxY - ay];
  for (let i = 0; i < 4; i++) {
    const p = ps[i]!;
    const q = qs[i]!;
    if (p === 0) {
      if (q < 0) return; // parallel to a slab and outside it
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return;
        if (r < t1) t1 = r;
      }
    }
  }

  // Clipped segment endpoints (still on the original parametric scale of [0,1]).
  const sx = ax + t0 * dx;
  const sy = ay + t0 * dy;
  const ex = ax + t1 * dx;
  const ey = ay + t1 * dy;

  let cx = Math.max(0, Math.min(g.cols - 1, Math.floor((sx - minX) / cellSize)));
  let cy = Math.max(0, Math.min(g.rows - 1, Math.floor((sy - minY) / cellSize)));
  const ecx = Math.max(0, Math.min(g.cols - 1, Math.floor((ex - minX) / cellSize)));
  const ecy = Math.max(0, Math.min(g.rows - 1, Math.floor((ey - minY) / cellSize)));

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  // Parametric distance along the original segment to the next cell boundary,
  // and the per-cell parametric step. dx/dy of zero collapses to Infinity so
  // that axis is never chosen by the `tMaxX < tMaxY` comparison.
  let tMaxX: number;
  let tDeltaX: number;
  if (stepX !== 0) {
    const nextBoundaryX = minX + (cx + (stepX > 0 ? 1 : 0)) * cellSize;
    tMaxX = (nextBoundaryX - ax) / dx;
    tDeltaX = cellSize / Math.abs(dx);
  } else {
    tMaxX = Infinity;
    tDeltaX = Infinity;
  }

  let tMaxY: number;
  let tDeltaY: number;
  if (stepY !== 0) {
    const nextBoundaryY = minY + (cy + (stepY > 0 ? 1 : 0)) * cellSize;
    tMaxY = (nextBoundaryY - ay) / dy;
    tDeltaY = cellSize / Math.abs(dy);
  } else {
    tMaxY = Infinity;
    tDeltaY = Infinity;
  }

  // Walk cells until we pass the end cell or step out of the grid.
  for (;;) {
    const cell = g.cells[cy * g.cols + cx]!;
    for (let i = 0; i < cell.length; i++) out.push(cell[i]!);

    if (cx === ecx && cy === ecy) break;

    if (tMaxX < tMaxY) {
      cx += stepX;
      if (cx < 0 || cx >= g.cols) break;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      if (cy < 0 || cy >= g.rows) break;
      tMaxY += tDeltaY;
    }
  }
}
