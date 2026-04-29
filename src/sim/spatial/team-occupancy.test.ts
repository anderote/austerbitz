import { describe, it, expect } from 'vitest';
import {
  createTeamOccupancy,
  rebuildTeamOccupancy,
  hasHostileNear,
  type TeamOccupancyConfig,
} from './team-occupancy';

/** Build a TeamOccupancy and rebuild from (id, x, y, team) tuples. */
function build(
  cfg: TeamOccupancyConfig,
  rows: Array<[id: number, x: number, y: number, team: number]>,
) {
  const maxId = rows.reduce((m, [id]) => Math.max(m, id), 0);
  const cap = Math.max(rows.length, maxId + 1, 8);
  const occ = createTeamOccupancy(cfg);
  const aliveIds = new Int32Array(cap);
  const posX = new Float32Array(cap);
  const posY = new Float32Array(cap);
  const team = new Uint8Array(cap);
  for (let i = 0; i < rows.length; i++) {
    const [id, x, y, t] = rows[i]!;
    aliveIds[i] = id;
    posX[id] = x;
    posY[id] = y;
    team[id] = t;
  }
  rebuildTeamOccupancy(occ, aliveIds, rows.length, posX, posY, team);
  return occ;
}

function cellCount(occ: ReturnType<typeof createTeamOccupancy>, t: number, col: number, row: number): number {
  const stride = occ.cols * occ.rows;
  return occ.counts[t * stride + row * occ.cols + col]!;
}

describe('createTeamOccupancy', () => {
  it('produces correct dims for given bounds + cellSize', () => {
    const occ = createTeamOccupancy({
      numTeams: 4, cellSize: 32, minX: 0, minY: 0, maxX: 1024, maxY: 512,
    });
    expect(occ.cols).toBe(32);
    expect(occ.rows).toBe(16);
    expect(occ.numTeams).toBe(4);
    expect(occ.cellSize).toBe(32);
    expect(occ.counts.length).toBe(4 * 32 * 16);
  });

  it('rounds non-divisible bounds up', () => {
    const occ = createTeamOccupancy({
      numTeams: 2, cellSize: 32, minX: 0, minY: 0, maxX: 100, maxY: 33,
    });
    expect(occ.cols).toBe(Math.ceil(100 / 32)); // 4
    expect(occ.rows).toBe(Math.ceil(33 / 32));  // 2
  });

  it('produces at least 1x1 even with degenerate bounds', () => {
    const occ = createTeamOccupancy({
      numTeams: 1, cellSize: 32, minX: 0, minY: 0, maxX: 0, maxY: 0,
    });
    expect(occ.cols).toBe(1);
    expect(occ.rows).toBe(1);
  });
});

describe('rebuildTeamOccupancy', () => {
  it('accumulates counts across teams and cells', () => {
    // cellSize 10, 10x10 grid (0..100 on each axis).
    const occ = build(
      { numTeams: 3, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100 },
      [
        // Team 0: two units in cell (0,0), one in (5,5).
        [1, 1, 1, 0],
        [2, 5, 5, 0],
        [3, 55, 55, 0],
        // Team 1: one in (0,0), one in (9,9) — two different cells.
        [4, 2, 2, 1],
        [5, 95, 95, 1],
        // Team 2: one in (5,5).
        [6, 50, 50, 2],
      ],
    );

    expect(cellCount(occ, 0, 0, 0)).toBe(2);
    expect(cellCount(occ, 0, 5, 5)).toBe(1);
    expect(cellCount(occ, 1, 0, 0)).toBe(1);
    expect(cellCount(occ, 1, 9, 9)).toBe(1);
    expect(cellCount(occ, 2, 5, 5)).toBe(1);

    // No leakage into neighbouring cells.
    expect(cellCount(occ, 0, 1, 0)).toBe(0);
    expect(cellCount(occ, 0, 0, 1)).toBe(0);
    expect(cellCount(occ, 2, 0, 0)).toBe(0);
  });

  it('clears counts between rebuilds', () => {
    const occ = createTeamOccupancy({
      numTeams: 2, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100,
    });
    const aliveIds = new Int32Array(8);
    const posX = new Float32Array(8);
    const posY = new Float32Array(8);
    const team = new Uint8Array(8);
    aliveIds[0] = 1; posX[1] = 5; posY[1] = 5; team[1] = 0;
    rebuildTeamOccupancy(occ, aliveIds, 1, posX, posY, team);
    expect(cellCount(occ, 0, 0, 0)).toBe(1);

    rebuildTeamOccupancy(occ, aliveIds, 0, posX, posY, team);
    expect(cellCount(occ, 0, 0, 0)).toBe(0);
  });

  it('clamps out-of-bounds positions into edge cells', () => {
    const occ = build(
      { numTeams: 2, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100 },
      [
        [1, -50, -50, 0], // clamps to (0,0)
        [2, 500, 500, 1], // clamps to (9,9)
      ],
    );
    expect(cellCount(occ, 0, 0, 0)).toBe(1);
    expect(cellCount(occ, 1, 9, 9)).toBe(1);
  });
});

describe('hasHostileNear', () => {
  it('returns true when an enemy is in the radius', () => {
    const occ = build(
      { numTeams: 2, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100 },
      [[1, 50, 50, 1]],
    );
    expect(hasHostileNear(occ, 0, 50, 50, 5)).toBe(true);
    expect(hasHostileNear(occ, 0, 45, 45, 5)).toBe(true);
  });

  it('returns false when only same-team is in the radius', () => {
    const occ = build(
      { numTeams: 2, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100 },
      [[1, 50, 50, 0], [2, 55, 55, 0]],
    );
    expect(hasHostileNear(occ, 0, 50, 50, 20)).toBe(false);
  });

  it('returns false when nothing is in the radius', () => {
    const occ = build(
      { numTeams: 2, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100 },
      [[1, 90, 90, 1]],
    );
    expect(hasHostileNear(occ, 0, 10, 10, 15)).toBe(false);
  });

  it('returns false on an empty grid', () => {
    const occ = createTeamOccupancy({
      numTeams: 4, cellSize: 32, minX: 0, minY: 0, maxX: 1024, maxY: 1024,
    });
    expect(hasHostileNear(occ, 0, 500, 500, 64)).toBe(false);
  });

  it('clamps query AABB at the map edge', () => {
    // Enemy in the corner cell; query centred well outside the map but with a
    // radius that reaches in. Must still detect the hostile.
    const occ = build(
      { numTeams: 2, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100 },
      [[1, 5, 5, 1]],
    );
    expect(hasHostileNear(occ, 0, -50, -50, 200)).toBe(true);
    // Same query but no hostile present — must return false (not leak past clamp).
    const empty = createTeamOccupancy({
      numTeams: 2, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100,
    });
    expect(hasHostileNear(empty, 0, -50, -50, 200)).toBe(false);
  });

  it('handles a radius spanning multiple cells', () => {
    // Enemy 25 m away, cells are 10 m. Radius 30 should reach across cells.
    const occ = build(
      { numTeams: 2, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100 },
      [[1, 50, 50, 1]],
    );
    expect(hasHostileNear(occ, 0, 25, 50, 30)).toBe(true);
    // Radius 20 falls short (cell of (25,50) is col 2, enemy in col 5 — gap of 2 empty cells).
    expect(hasHostileNear(occ, 0, 25, 50, 20)).toBe(false);
  });

  it('handles a query exactly on a cell boundary', () => {
    // Boundary at x=10 between cells col 0 and col 1.
    const occ = build(
      { numTeams: 2, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100 },
      [[1, 15, 5, 1]], // enemy in col 1
    );
    // Query centred exactly on the boundary with radius 0 — floor(10/10)=1, falls into col 1.
    expect(hasHostileNear(occ, 0, 10, 5, 0)).toBe(true);
    // Friendly query a tiny bit before the boundary, radius 0 — floor(9.99/10)=0.
    expect(hasHostileNear(occ, 0, 9.99, 5, 0)).toBe(false);
  });

  it('ignores other-team-but-not-self correctly with 3+ teams', () => {
    const occ = build(
      { numTeams: 3, cellSize: 10, minX: 0, minY: 0, maxX: 100, maxY: 100 },
      [[1, 50, 50, 2]],
    );
    // selfTeam=0: team 2 is hostile.
    expect(hasHostileNear(occ, 0, 50, 50, 5)).toBe(true);
    // selfTeam=2: team 2 is self, no hostile present.
    expect(hasHostileNear(occ, 2, 50, 50, 5)).toBe(false);
  });
});
