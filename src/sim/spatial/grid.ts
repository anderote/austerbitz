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
