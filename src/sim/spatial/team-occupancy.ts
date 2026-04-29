export interface TeamOccupancy {
  readonly numTeams: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly minX: number;
  readonly minY: number;
  /** Per-team flat row-major counts. Index: team * cols * rows + row * cols + col. */
  counts: Uint16Array;
}

export interface TeamOccupancyConfig {
  numTeams: number;
  cellSize: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function createTeamOccupancy(cfg: TeamOccupancyConfig): TeamOccupancy {
  const cols = Math.max(1, Math.ceil((cfg.maxX - cfg.minX) / cfg.cellSize));
  const rows = Math.max(1, Math.ceil((cfg.maxY - cfg.minY) / cfg.cellSize));
  return {
    numTeams: cfg.numTeams,
    cellSize: cfg.cellSize,
    cols,
    rows,
    minX: cfg.minX,
    minY: cfg.minY,
    counts: new Uint16Array(cfg.numTeams * cols * rows),
  };
}

export function rebuildTeamOccupancy(
  occ: TeamOccupancy,
  aliveIds: Int32Array,
  count: number,
  posX: Float32Array,
  posY: Float32Array,
  team: Uint8Array,
): void {
  const counts = occ.counts;
  const cols = occ.cols;
  const rows = occ.rows;
  const cellSize = occ.cellSize;
  const minX = occ.minX;
  const minY = occ.minY;
  const teamStride = cols * rows;
  counts.fill(0);
  for (let n = 0; n < count; n++) {
    const id = aliveIds[n]!;
    const x = posX[id]!;
    const y = posY[id]!;
    let cx = Math.floor((x - minX) / cellSize);
    let cy = Math.floor((y - minY) / cellSize);
    if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
    if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
    const t = team[id]!;
    counts[t * teamStride + cy * cols + cx]!++;
  }
}

export function hasHostileNear(
  occ: TeamOccupancy,
  selfTeam: number,
  x: number,
  y: number,
  radius: number,
): boolean {
  const counts = occ.counts;
  const cols = occ.cols;
  const rows = occ.rows;
  const cellSize = occ.cellSize;
  const minX = occ.minX;
  const minY = occ.minY;
  const numTeams = occ.numTeams;
  const teamStride = cols * rows;

  let cx0 = Math.floor((x - radius - minX) / cellSize);
  let cx1 = Math.floor((x + radius - minX) / cellSize);
  let cy0 = Math.floor((y - radius - minY) / cellSize);
  let cy1 = Math.floor((y + radius - minY) / cellSize);
  if (cx0 < 0) cx0 = 0; else if (cx0 >= cols) cx0 = cols - 1;
  if (cx1 < 0) cx1 = 0; else if (cx1 >= cols) cx1 = cols - 1;
  if (cy0 < 0) cy0 = 0; else if (cy0 >= rows) cy0 = rows - 1;
  if (cy1 < 0) cy1 = 0; else if (cy1 >= rows) cy1 = rows - 1;

  for (let cy = cy0; cy <= cy1; cy++) {
    const rowBase = cy * cols;
    for (let cx = cx0; cx <= cx1; cx++) {
      const cellIdx = rowBase + cx;
      for (let t = 0; t < numTeams; t++) {
        if (t === selfTeam) continue;
        if (counts[t * teamStride + cellIdx]! > 0) return true;
      }
    }
  }
  return false;
}
