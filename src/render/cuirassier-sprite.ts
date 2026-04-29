// 45x60 atlas: 3x3 cells of 15x20, covering all eight facings plus a solid
// white "tint" cell. Layout matches the soldier atlas:
//
//   (0,0) NW back-3/4 mirrored   (1,0) WHITE TINT       (2,0) NE back-3/4
//   (0,1) W side mirrored        (1,1) S front          (2,1) E side
//   (0,2) SW front-3/4 mirrored  (1,2) N back           (2,2) SE front-3/4
//
// Color encoding follows the same convention as the soldier sheet: pixels
// marked `P` and `S` are emitted as magenta (255,0,255) and cyan (0,255,255)
// markers; the sprite shader replaces them per-instance with team primary /
// secondary colors. Pass `resolvePrimary` / `resolveSecondary` to bake the
// markers for static previews.

export const CUIRASSIER_CELL_W = 15;
export const CUIRASSIER_CELL_H = 20;
export const CUIRASSIER_COLS = 3;
export const CUIRASSIER_ROWS = 3;
export const CUIRASSIER_SHEET_W = CUIRASSIER_CELL_W * CUIRASSIER_COLS;
export const CUIRASSIER_SHEET_H = CUIRASSIER_CELL_H * CUIRASSIER_ROWS;

export const CUIRASSIER_TINT_CELL = { col: 1, row: 0 } as const;
export const CUIRASSIER_FRONT_CELL = { col: 1, row: 1 } as const;

/** N..NW clockwise, matches the soldier ordering. */
export const CUIRASSIER_POSE_CELLS = [
  { col: 1, row: 2 }, // N  back
  { col: 2, row: 0 }, // NE back-3/4
  { col: 2, row: 1 }, // E  side
  { col: 2, row: 2 }, // SE front-3/4
  { col: 1, row: 1 }, // S  front
  { col: 0, row: 2 }, // SW front-3/4 mirrored
  { col: 0, row: 1 }, // W  side mirrored
  { col: 0, row: 0 }, // NW back-3/4 mirrored
] as const;

const PRIMARY_MARKER: readonly [number, number, number] = [255, 0, 255];
const SECONDARY_MARKER: readonly [number, number, number] = [0, 255, 255];

const PALETTE_BASE: Record<string, [number, number, number, number]> = {
  '.': [0, 0, 0, 0],
  'k': [22, 18, 28, 255],     // outline / hooves
  'h': [110, 75, 45, 255],    // horse coat
  'H': [74, 50, 30, 255],     // horse coat shadow
  'f': [228, 188, 156, 255],  // skin
  'F': [186, 142, 108, 255],  // skin shadow
  'g': [180, 188, 200, 255],  // steel: sabre, helmet
  'm': [60, 40, 26, 255],     // saddle leather
  'w': [236, 232, 222, 255],  // belts / breeches / blanket
  'W': [255, 255, 255, 255],  // tint sample cell
};

// 15-wide x 20-tall pose grids. Rider centered roughly cols 4-9; horse body
// extends below across cols 0-13.
//
//   P = primary (rider coat / sleeves)    S = secondary (cuirass / plume)

const POSE_FRONT = [
  '...............',
  '.......S.......', //  1 plume tip
  '......SSS......', //  2 plume base
  '......kkk......', //  3 helmet top
  '.....kkgkk.....', //  4 helmet brim + visor
  '......fFf......', //  5 face
  '.....SPPPS.....', //  6 collar / cuirass top
  '....SPPPPPS....', //  7 cuirass
  '....SPPSPPS....', //  8 cuirass with breastplate ridge
  '....mwwwwwm....', //  9 saddle / belt
  '...hhhhhhhhh...', // 10 horse shoulders front-on
  '..hhhhhhhhhhh..', // 11 horse chest
  '..hhhhhhhhhhh..', // 12 chest
  '..hhhhhhhhhhh..', // 13 lower chest
  '..HHHHHHHHHHH..', // 14 belly
  '..h..h.h..h....', // 15 four legs visible head-on
  '..h..h.h..h....', // 16
  '..k..k.k..k....', // 17 hooves
  '..k..k.k..k....', // 18
  '...............', // 19 (shadows drawn separately by the runtime projection pass)
];

const POSE_FRONT_DIAG = [
  '...............',
  '......S........', //  1 plume tip nudged to viewer-left
  '.....SSS.......', //  2
  '.....kkk.......', //  3 helmet
  '....kkgkk......', //  4
  '.....fF........', //  5 face 3/4 (more shadow on right)
  '.....SPPSP.....', //  6 collar + sash band
  '....SPPPPPS....', //  7 cuirass
  '....SPPSPPS....', //  8
  '....mwwwwwm....', //  9 saddle
  '...hhhhhhhhh...', // 10 horse shoulders 3/4
  '..hhhhhhhhhhh..', // 11
  '..hhhhhhhhhhhh.', // 12 head starting to appear right
  '..hhhhhhhhhhhh.', // 13
  '..HHHHHHHHHHHH.', // 14 belly
  '..h..h.h..hh...', // 15 legs offset
  '..h..h.h..hh...', // 16
  '..k..k.k..kk...', // 17 hooves
  '..k..k.k..kk...', // 18
  '...............', // 19 (shadows drawn separately by the runtime projection pass)
];

const POSE_SIDE = [
  '..............g', //  0 sabre tip
  '.............g.', //  1
  '............g..', //  2
  '......SS...g...', //  3 plume tip + sabre
  '.....SSSS.g....', //  4 plume base
  '.....kkkk.g....', //  5 helmet top
  '....kkggk.g....', //  6 helmet w/ visor
  '....kfFkk.g....', //  7 face profile + back of helmet
  '....SPPS..g....', //  8 collar + sword arm
  '...SPPPPSPS....', //  9 cuirass + sword arm extended
  '...SPPPPSP.....', // 10 cuirass + sword arm
  '...mwwwwwm.....', // 11 saddle blanket
  '..hhhhhhhhh....', // 12 horse withers
  '.hhhhhhhhhhh...', // 13 back
  'hhhhhhhhhhhhh..', // 14 body + head appearing right
  'Hhhhhhhhhhhfh..', // 15 body + horse face
  '.HHHHHHHHHH....', // 16 belly
  '.h....hh.h.h...', // 17 4 legs visible from side (front pair, rear pair)
  '.h....hh.h.h...', // 18
  '.k....kk.k.k...', // 19 hooves
];

const POSE_BACK = [
  '...............',
  '.......S.......', //  1 plume tip
  '......SSS......', //  2 plume base
  '......kkk......', //  3 helmet top
  '.....kkgkk.....', //  4 helmet brim
  '......kkk......', //  5 back of head
  '.....SPPPS.....', //  6 collar
  '....SPPPPPS....', //  7 cuirass back
  '....SPPSPPS....', //  8 spine ridge
  '....mwwwwwm....', //  9 saddle / belt
  '...hhhhhhhhh...', // 10 horse haunches (rear view)
  '..hhhhhhhhhhh..', // 11 rump
  '..hhhhhhhhhhh..', // 12 lower rump
  '..HHHHHHHHHHH..', // 13 thighs
  '..H..H.H..H....', // 14 four legs visible rear-on
  '..H..H.H..H....', // 15
  '..H..H.H..H....', // 16
  '..k..k.k..k....', // 17 hooves
  '..k..k.k..k....', // 18
  '...............', // 19 (shadows drawn separately by the runtime projection pass)
];

const POSE_BACK_DIAG = [
  '...............',
  '......S........', //  1 plume tip nudged left (away+right turn)
  '.....SSS.......', //  2
  '.....kkk.......', //  3
  '....kkgkk......', //  4
  '.....kkk.......', //  5 back of head
  '....SPPSP......', //  6 collar with shoulder strap visible
  '....SPPPPPS....', //  7
  '....SPPSPPS....', //  8
  '....mwwwwwm....', //  9
  '...hhhhhhhhh...', // 10
  '..hhhhhhhhhhh..', // 11
  '..hhhhhhhhhhhh.', // 12 haunch rotated right
  '..HHHHHHHHHHHH.', // 13
  '..H..H.H..HH...', // 14
  '..H..H.H..HH...', // 15
  '..H..H.H..HH...', // 16
  '..k..k.k..kk...', // 17 hooves
  '..k..k.k..kk...', // 18
  '...............', // 19 (shadows drawn separately by the runtime projection pass)
];

const TINT_CELL = Array.from({ length: CUIRASSIER_CELL_H }, () =>
  'W'.repeat(CUIRASSIER_CELL_W),
);

for (const [name, p] of [
  ['POSE_FRONT', POSE_FRONT],
  ['POSE_FRONT_DIAG', POSE_FRONT_DIAG],
  ['POSE_SIDE', POSE_SIDE],
  ['POSE_BACK', POSE_BACK],
  ['POSE_BACK_DIAG', POSE_BACK_DIAG],
] as const) {
  if (p.length !== CUIRASSIER_CELL_H) {
    throw new Error(`${name}: expected ${CUIRASSIER_CELL_H} rows, got ${p.length}`);
  }
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.length !== CUIRASSIER_CELL_W) {
      throw new Error(
        `${name}[${i}]: expected ${CUIRASSIER_CELL_W} cols, got ${p[i]!.length} ("${p[i]}")`,
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
  for (let y = 0; y < CUIRASSIER_CELL_H; y++) {
    const row = pose[y]!;
    for (let x = 0; x < CUIRASSIER_CELL_W; x++) {
      const ch = mirror ? row[CUIRASSIER_CELL_W - 1 - x] : row[x];
      const rgba = palette[ch!] ?? palette['.']!;
      const i = ((cellY + y) * sheetW + (cellX + x)) * 4;
      buf[i + 0] = rgba[0]!;
      buf[i + 1] = rgba[1]!;
      buf[i + 2] = rgba[2]!;
      buf[i + 3] = rgba[3]!;
    }
  }
}

export interface CuirassierSheetOptions {
  resolvePrimary?: readonly [number, number, number];
  resolveSecondary?: readonly [number, number, number];
}

export function generateCuirassierSheet(opts: CuirassierSheetOptions = {}): Uint8Array {
  const buf = new Uint8Array(CUIRASSIER_SHEET_W * CUIRASSIER_SHEET_H * 4);
  const W = CUIRASSIER_CELL_W;
  const H = CUIRASSIER_CELL_H;
  const palette = buildPalette(opts.resolvePrimary, opts.resolveSecondary);
  blit(buf, CUIRASSIER_SHEET_W, 0,     0,     POSE_BACK_DIAG,  true,  palette);
  blit(buf, CUIRASSIER_SHEET_W, W,     0,     TINT_CELL,       false, palette);
  blit(buf, CUIRASSIER_SHEET_W, 2 * W, 0,     POSE_BACK_DIAG,  false, palette);
  blit(buf, CUIRASSIER_SHEET_W, 0,     H,     POSE_SIDE,       true,  palette);
  blit(buf, CUIRASSIER_SHEET_W, W,     H,     POSE_FRONT,      false, palette);
  blit(buf, CUIRASSIER_SHEET_W, 2 * W, H,     POSE_SIDE,       false, palette);
  blit(buf, CUIRASSIER_SHEET_W, 0,     2 * H, POSE_FRONT_DIAG, true,  palette);
  blit(buf, CUIRASSIER_SHEET_W, W,     2 * H, POSE_BACK,       false, palette);
  blit(buf, CUIRASSIER_SHEET_W, 2 * W, 2 * H, POSE_FRONT_DIAG, false, palette);
  return buf;
}
