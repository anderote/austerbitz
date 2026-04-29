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
  'W': [255, 255, 255, 255],  // tint sample cell
};

// 17-wide x 14-tall pose grids. Side view: barrel right, trail left, two
// wheels stacked center. P = primary (carriage trim), S = secondary (wheel
// rims / barrel furniture).

// Side view shows ONE prominent wheel centered with barrel above pointing
// right and the long trail extending left. Front and back show TWO wheels
// splayed left and right around a centered carriage / muzzle ring.

const POSE_FRONT = [
  '.................', //  0
  '.......PPP.......', //  1 spade tip pronounced
  '......mPPPm......', //  2 carriage rear
  '.....mPPPPPm.....', //  3 carriage
  '....mPPPmPPPm....', //  4 carriage with seam
  '....mPgggggPm....', //  5 carriage w/ barrel emerging
  '.....gGGGGGg.....', //  6 barrel face
  '.....gGgkgGg.....', //  7 muzzle ring + bore
  '..kkSSk...kSSkk..', //  8 wheels top
  '.kSwwwS...SwwwSk.', //  9 wheels
  '.kSwkwS...SwkwSk.', // 10 wheels + hub
  '.kSwkwS...SwkwSk.', // 11 wheels + hub thickened
  '..kkSSk...kSSkk..', // 12 wheels bottom
  '.................', // 13 (shadows drawn separately by the runtime projection pass)
];

const POSE_FRONT_DIAG = [
  '.................', //  0
  '....PPPP.........', //  1 spade tip pronounced, nudged left
  '...mPPPPm........', //  2 trail angled
  '..mPPPPPPm.......', //  3 carriage
  '..mPPmmPPPm......', //  4 carriage with seam
  '...mPgggggPm.....', //  5 carriage w/ barrel angled right
  '....gGGGGGgm.....', //  6 barrel emerging toward viewer-right
  '....gGgkgGg......', //  7 muzzle nudged right + bore
  '..kkSSk.kSSkk....', //  8 both wheels visible
  '.kSwwwS.SwwwSk...', //  9
  '.kSwkwS.SwkwSk...', // 10
  '.kSwkwS.SwkwSk...', // 11 hub thickened
  '..kkSSk.kSSkk....', // 12
  '.................', // 13 (shadows drawn separately by the runtime projection pass)
];

const POSE_SIDE = [
  '.................', //  0
  '.............ggGG', //  1 muzzle swell extends right
  '............ggGGg', //  2 muzzle tip + bore
  '.......gggggggGGg', //  3 barrel w/ reinforce ring
  'mmmmmmmgggggggGgg', //  4 long trail extending left + barrel
  'mPPPPPmgggggggGgg', //  5 trail trim + cheek + barrel + breech bulge
  'mMMMMMmmgggggggg.', //  6 trail shadow + breech
  '.....mmkkmm......', //  7 axle bracket
  '....kkSSSkk......', //  8 wheel top
  '...kSwwwwwSk.....', //  9 wheel
  '...kSwkkkwSk.....', // 10 wheel + thicker hub
  '...kSwwwwwSk.....', // 11 wheel
  '....kkSSSkk......', // 12 wheel bottom
  '.................', // 13 (shadows drawn separately by the runtime projection pass)
];

const POSE_BACK = [
  '.................', //  0
  '.......PPP.......', //  1 trail tip (red spade)
  '......PPPPP......', //  2 trail spade
  '.....PPPPPPP.....', //  3 trail spade widening
  '....mPPPPPPPm....', //  4 trail meeting carriage
  '...mPPmmmmmPPm...', //  5 carriage rear w/ breech bulge
  '...mmmgggggmmm...', //  6 breech of barrel
  '...mkmGGkGGmkm...', //  7 axle ends + cascabel knob
  '..kkSSk...kSSkk..', //  8 wheels (mirror of front)
  '.kSwwwS...SwwwSk.', //  9
  '.kSwkwS...SwkwSk.', // 10
  '.kSwkwS...SwkwSk.', // 11 hub thickened
  '..kkSSk...kSSkk..', // 12
  '.................', // 13 (shadows drawn separately by the runtime projection pass)
];

const POSE_BACK_DIAG = [
  '.................', //  0
  '....PPPP.........', //  1 spade tip pronounced
  '...PPPPPPP.......', //  2 trail spade larger
  '..PPPPPPPPP......', //  3 spade widening
  '..mPPPPPPPmm.....', //  4 trail meeting carriage
  '..mPPmmmPPmm.....', //  5 carriage rear angled
  '..mmgggggmmm.....', //  6 breech
  '..mkGGkGGmkm.....', //  7 axle / cascabel
  '..kkSSk.kSSkk....', //  8 both wheels visible
  '.kSwwwS.SwwwSk...', //  9
  '.kSwkwS.SwkwSk...', // 10
  '.kSwkwS.SwkwSk...', // 11 hub thickened
  '..kkSSk.kSSkk....', // 12
  '.................', // 13 (shadows drawn separately by the runtime projection pass)
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
