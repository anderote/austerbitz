export interface GridConfig {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cellSize: number;
  /** Maximum number of items the grid will ever contain (sized for the SoA). */
  capacity: number;
}

export interface Grid {
  cfg: GridConfig;
  cols: number;
  rows: number;
  capacity: number;
  // CSR layout: cellStart[i] .. cellStart[i+1] is the slice of `items`
  // that holds the entity ids in cell i. cellStart has length numCells+1
  // so the final entry doubles as the total written count.
  cellStart: Int32Array;
  items: Int32Array;
  // Per-cell write cursor reused across rebuilds (one Int32Array alloc total).
  writeCursor: Int32Array;
}

export function createGrid(cfg: GridConfig): Grid {
  const cols = Math.max(1, Math.ceil((cfg.maxX - cfg.minX) / cfg.cellSize));
  const rows = Math.max(1, Math.ceil((cfg.maxY - cfg.minY) / cfg.cellSize));
  const numCells = cols * rows;
  return {
    cfg,
    cols,
    rows,
    capacity: cfg.capacity,
    cellStart: new Int32Array(numCells + 1),
    items: new Int32Array(cfg.capacity),
    writeCursor: new Int32Array(numCells),
  };
}

export function cellOf(g: Grid, x: number, y: number): number {
  const cx = Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.cfg.minX) / g.cfg.cellSize)));
  const cy = Math.max(0, Math.min(g.rows - 1, Math.floor((y - g.cfg.minY) / g.cfg.cellSize)));
  return cy * g.cols + cx;
}

/**
 * Rebuild the grid from a packed alive list using a CSR (compressed-sparse-row)
 * layout: a single prefix-summed `cellStart` plus a flat `items` buffer of
 * entity ids grouped by cell. Two passes: count into cellStart[cell+1] so the
 * prefix sum yields per-cell start offsets, then scatter ids via writeCursor.
 */
export function gridRebuild(
  g: Grid,
  aliveIds: Int32Array,
  aliveCount: number,
  posX: Float32Array,
  posY: Float32Array,
): void {
  const numCells = g.cols * g.rows;
  const cellStart = g.cellStart;
  const writeCursor = g.writeCursor;
  const items = g.items;
  cellStart.fill(0);
  writeCursor.fill(0);

  // Pass 1: count per cell, into cellStart[cell+1].
  for (let n = 0; n < aliveCount; n++) {
    const id = aliveIds[n]!;
    const c = cellOf(g, posX[id]!, posY[id]!);
    cellStart[c + 1]!++;
  }

  // Prefix sum -> cellStart[i] is the first write index for cell i.
  for (let i = 1; i <= numCells; i++) {
    cellStart[i] = cellStart[i]! + cellStart[i - 1]!;
  }

  // Pass 2: scatter ids using the per-cell write cursor.
  for (let n = 0; n < aliveCount; n++) {
    const id = aliveIds[n]!;
    const c = cellOf(g, posX[id]!, posY[id]!);
    items[cellStart[c]! + writeCursor[c]!++] = id;
  }
}

/**
 * Walk the cells overlapping the rectangle and append each cell's ids to `out`.
 * Returns the number of ids written. Callers own the buffer and capacity.
 */
export function gridQueryRect(
  g: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: Int32Array,
): number {
  const cx0 = Math.max(0, Math.min(g.cols - 1, Math.floor((x0 - g.cfg.minX) / g.cfg.cellSize)));
  const cx1 = Math.max(0, Math.min(g.cols - 1, Math.floor((x1 - g.cfg.minX) / g.cfg.cellSize)));
  const cy0 = Math.max(0, Math.min(g.rows - 1, Math.floor((y0 - g.cfg.minY) / g.cfg.cellSize)));
  const cy1 = Math.max(0, Math.min(g.rows - 1, Math.floor((y1 - g.cfg.minY) / g.cfg.cellSize)));
  const cellStart = g.cellStart;
  const items = g.items;
  const cap = out.length;
  let w = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    const rowBase = cy * g.cols;
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = rowBase + cx;
      const start = cellStart[c]!;
      const end = cellStart[c + 1]!;
      for (let k = start; k < end; k++) {
        if (w >= cap) return w;
        out[w++] = items[k]!;
      }
    }
  }
  return w;
}

export function gridQueryRadius(
  g: Grid,
  x: number,
  y: number,
  r: number,
  out: Int32Array,
): number {
  return gridQueryRect(g, x - r, y - r, x + r, y + r, out);
}

/**
 * Walks the cells crossed by the segment (ax,ay)→(bx,by) using DDA
 * (Amanatides & Woo) and writes each cell's entity ids into `out`,
 * in order of ascending parametric `t` along the segment. Returns the
 * count written. Because the grid places each entity in exactly one
 * cell, the same entity cannot appear twice.
 */
export function gridSweptQuery(
  g: Grid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  out: Int32Array,
): number {
  const { minX, minY, maxX, maxY, cellSize } = g.cfg;
  const cellStart = g.cellStart;
  const items = g.items;
  const cap = out.length;
  let w = 0;

  const dx = bx - ax;
  const dy = by - ay;

  // Zero-length segment: visit just the start cell (if inside the grid).
  if (dx === 0 && dy === 0) {
    if (ax < minX || ax > maxX || ay < minY || ay > maxY) return 0;
    const cx = Math.max(0, Math.min(g.cols - 1, Math.floor((ax - minX) / cellSize)));
    const cy = Math.max(0, Math.min(g.rows - 1, Math.floor((ay - minY) / cellSize)));
    const c = cy * g.cols + cx;
    const start = cellStart[c]!;
    const end = cellStart[c + 1]!;
    for (let k = start; k < end; k++) {
      if (w >= cap) return w;
      out[w++] = items[k]!;
    }
    return w;
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
      if (q < 0) return 0; // parallel to a slab and outside it
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return 0;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return 0;
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
    const c = cy * g.cols + cx;
    const start = cellStart[c]!;
    const end = cellStart[c + 1]!;
    for (let k = start; k < end; k++) {
      if (w >= cap) return w;
      out[w++] = items[k]!;
    }

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
  return w;
}
