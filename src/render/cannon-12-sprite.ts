// 51x42 atlas: 3x3 cells of 17x14, covering all eight cannon facings plus a
// solid white "tint" cell. Layout matches the soldier and cuirassier atlases:
//
//   (0,0) NW back-3/4 mirrored   (1,0) WHITE TINT       (2,0) NE back-3/4
//   (0,1) W side mirrored        (1,1) S front          (2,1) E side
//   (0,2) SW front-3/4 mirrored  (1,2) N back           (2,2) SE front-3/4
//
// "Facing" means the direction the muzzle points: the side cell shows the
// barrel pointing east (right), front shows the muzzle pointed at the viewer.
//
// Color encoding follows the same convention as the soldier sheet: pixels
// marked `P` and `S` are emitted as magenta / cyan markers; the sprite shader
// replaces them per-instance with team primary / secondary colors.

export const CANNON_CELL_W = 17;
export const CANNON_CELL_H = 14;
export const CANNON_COLS = 3;
export const CANNON_ROWS = 3;
export const CANNON_SHEET_W = CANNON_CELL_W * CANNON_COLS;
export const CANNON_SHEET_H = CANNON_CELL_H * CANNON_ROWS;

export const CANNON_TINT_CELL = { col: 1, row: 0 } as const;
export const CANNON_FRONT_CELL = { col: 1, row: 1 } as const;

export const CANNON_POSE_CELLS = [
  { col: 1, row: 2 }, // N  back  — muzzle pointing away
  { col: 2, row: 0 }, // NE back-3/4
  { col: 2, row: 1 }, // E  side  — muzzle pointing right
  { col: 2, row: 2 }, // SE front-3/4
  { col: 1, row: 1 }, // S  front — muzzle pointing toward viewer
  { col: 0, row: 2 }, // SW front-3/4 mirrored
  { col: 0, row: 1 }, // W  side mirrored — muzzle left
  { col: 0, row: 0 }, // NW back-3/4 mirrored
] as const;

const PRIMARY_MARKER: readonly [number, number, number] = [255, 0, 255];
const SECONDARY_MARKER: readonly [number, number, number] = [0, 255, 255];

const PALETTE_BASE: Record<string, [number, number, number, number]> = {
  '.': [0, 0, 0, 0],
  'k': [22, 18, 28, 255],     // outline
  'g': [60, 62, 70, 255],     // gunmetal barrel base
  'G': [110, 112, 120, 255],  // gunmetal highlight
  'm': [120, 84, 50, 255],    // carriage timber
  'M': [78, 52, 30, 255],     // carriage shadow
  'w': [180, 188, 200, 255],  // iron tyre / spokes
  's': [60, 56, 52, 110],     // ground shadow
  'W': [255, 255, 255, 255],  // tint sample cell
};

// 17-wide x 14-tall pose grids. Side view: barrel right, trail left, two
// wheels stacked center. P = primary (carriage trim), S = secondary (wheel
// rims / barrel furniture).

const POSE_FRONT = [
  '.................', //  0
  '.................', //  1
  '.......ggg.......', //  2 barrel mouth (small ring)
  '......gGGGg......', //  3 barrel
  '......gGGGg......', //  4 barrel
  '......gSgSg......', //  5 barrel base + reinforce ring
  '.....mPPPPPm.....', //  6 carriage face
  '....mPPmPmPPm....', //  7 carriage shoulders w/ knee
  '...kSwSmmmSwSk...', //  8 wheel tops left + right
  '..SwwwSmkmSwwwS..', //  9 wheel hubs
  '..SwwwSmkmSwwwS..', // 10 wheel hubs
  '...kSwSmmmSwSk...', // 11 wheel bottoms
  '.................', // 12
  '....sssssssss....', // 13 ground shadow
];

const POSE_FRONT_DIAG = [
  '.................', //  0
  '.................', //  1
  '...........gg....', //  2 barrel angled toward viewer-right
  '..........gGGg...', //  3
  '.........gGGGg...', //  4
  '....mmmmgGggSg...', //  5 carriage seam + barrel
  '...mPPPPmgSg.....', //  6 carriage angled
  '..mPPPPPPmm......', //  7
  '..kSwSmkmkmm.....', //  8 left wheel + axle line
  '.SwwwSmmkmm......', //  9
  '.SwwwSmkSwSm.....', // 10 right wheel partially behind
  '..kSwSmSwwwS.....', // 11
  '.......kSwSk.....', // 12
  '...sssssssss.....', // 13 ground shadow
];

const POSE_SIDE = [
  '.................', //  0
  '.................', //  1
  '..............gG.', //  2 barrel muzzle tip
  '......PPPP...gGG.', //  3 carriage cheek + barrel
  '....PPPPPPPP.gGGg', //  4 carriage trim + barrel
  'mmmPPPPPPPPPPgGgg', //  5 trail + carriage trim + barrel + breech ring
  '.mMMMMMMMMmmmgggg', //  6 carriage shadow + barrel
  '..mmmkkkkmmm.....', //  7 axle bracket
  '..kSwSk.kSwSk....', //  8 wheel tops
  '.SwwwwS.SwwwwS...', //  9 wheel middle
  '.SwwwwS.SwwwwS...', // 10 wheel middle
  '..kSwSk.kSwSk....', // 11 wheel bottoms
  '.................', // 12
  '...sssssssssss...', // 13 ground shadow
];

const POSE_BACK = [
  '.................', //  0
  '.................', //  1
  '.......PPP.......', //  2 trail tip
  '.....SSPPPSS.....', //  3 trail spade
  '....SSPPPPPSS....', //  4 trail spade
  '....mPPPPPPPm....', //  5 carriage rear
  '...mPPmmmmmPPm...', //  6 carriage cheeks
  '...mPmmgggmmPm...', //  7 breech + carriage
  '...kSwSmmmSwSk...', //  8 wheel tops left + right
  '..SwwwSmkmSwwwS..', //  9 wheel hubs + axle bar
  '..SwwwSmkmSwwwS..', // 10 wheel hubs
  '...kSwSmmmSwSk...', // 11 wheel bottoms
  '.................', // 12
  '....sssssssss....', // 13 ground shadow
];

const POSE_BACK_DIAG = [
  '.................', //  0
  '.................', //  1
  '....PPP..........', //  2 trail tip nudged left
  '...SPPPSS........', //  3 trail spade
  '..SSPPPPPSS......', //  4
  '..mPPPPPPPmm.....', //  5 carriage rear angled
  '...mmPPmmmmmm....', //  6
  '...mPmmgggmm.....', //  7 breech visible
  '...kSwSmmm.......', //  8 left wheel
  '..SwwwSmkSwSk....', //  9 right wheel emerging
  '..SwwwSmSwwwS....', // 10
  '...kSwSmkSwSk....', // 11
  '.................', // 12
  '...sssssssss.....', // 13 ground shadow
];

const TINT_CELL = Array.from({ length: CANNON_CELL_H }, () =>
  'W'.repeat(CANNON_CELL_W),
);

for (const [name, p] of [
  ['POSE_FRONT', POSE_FRONT],
  ['POSE_FRONT_DIAG', POSE_FRONT_DIAG],
  ['POSE_SIDE', POSE_SIDE],
  ['POSE_BACK', POSE_BACK],
  ['POSE_BACK_DIAG', POSE_BACK_DIAG],
] as const) {
  if (p.length !== CANNON_CELL_H) {
    throw new Error(`${name}: expected ${CANNON_CELL_H} rows, got ${p.length}`);
  }
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.length !== CANNON_CELL_W) {
      throw new Error(
        `${name}[${i}]: expected ${CANNON_CELL_W} cols, got ${p[i]!.length} ("${p[i]}")`,
      );
    }
  }
}

function buildPalette(
  resolvePrimary?: readonly [number, number, number],
  resolveSecondary?: readonly [number, number, number],
): Record<string, [number, number, number, number]> {
  const palette: Record<string, [number, number, number, number]> = { ...PALETTE_BASE };
  palette['P'] = resolvePrimary
    ? [resolvePrimary[0], resolvePrimary[1], resolvePrimary[2], 255]
    : [PRIMARY_MARKER[0], PRIMARY_MARKER[1], PRIMARY_MARKER[2], 255];
  palette['S'] = resolveSecondary
    ? [resolveSecondary[0], resolveSecondary[1], resolveSecondary[2], 255]
    : [SECONDARY_MARKER[0], SECONDARY_MARKER[1], SECONDARY_MARKER[2], 255];
  return palette;
}

function blit(
  buf: Uint8Array,
  sheetW: number,
  cellX: number,
  cellY: number,
  pose: readonly string[],
  mirror: boolean,
  palette: Record<string, [number, number, number, number]>,
): void {
  for (let y = 0; y < CANNON_CELL_H; y++) {
    const row = pose[y]!;
    for (let x = 0; x < CANNON_CELL_W; x++) {
      const ch = mirror ? row[CANNON_CELL_W - 1 - x] : row[x];
      const rgba = palette[ch!] ?? palette['.']!;
      const i = ((cellY + y) * sheetW + (cellX + x)) * 4;
      buf[i + 0] = rgba[0]!;
      buf[i + 1] = rgba[1]!;
      buf[i + 2] = rgba[2]!;
      buf[i + 3] = rgba[3]!;
    }
  }
}

export interface CannonSheetOptions {
  resolvePrimary?: readonly [number, number, number];
  resolveSecondary?: readonly [number, number, number];
}

export function generateCannonSheet(opts: CannonSheetOptions = {}): Uint8Array {
  const buf = new Uint8Array(CANNON_SHEET_W * CANNON_SHEET_H * 4);
  const W = CANNON_CELL_W;
  const H = CANNON_CELL_H;
  const palette = buildPalette(opts.resolvePrimary, opts.resolveSecondary);
  blit(buf, CANNON_SHEET_W, 0,     0,     POSE_BACK_DIAG,  true,  palette);
  blit(buf, CANNON_SHEET_W, W,     0,     TINT_CELL,       false, palette);
  blit(buf, CANNON_SHEET_W, 2 * W, 0,     POSE_BACK_DIAG,  false, palette);
  blit(buf, CANNON_SHEET_W, 0,     H,     POSE_SIDE,       true,  palette);
  blit(buf, CANNON_SHEET_W, W,     H,     POSE_FRONT,      false, palette);
  blit(buf, CANNON_SHEET_W, 2 * W, H,     POSE_SIDE,       false, palette);
  blit(buf, CANNON_SHEET_W, 0,     2 * H, POSE_FRONT_DIAG, true,  palette);
  blit(buf, CANNON_SHEET_W, W,     2 * H, POSE_BACK,       false, palette);
  blit(buf, CANNON_SHEET_W, 2 * W, 2 * H, POSE_FRONT_DIAG, false, palette);
  return buf;
}
