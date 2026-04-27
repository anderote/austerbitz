// 33x54 atlas: 3x3 cells of 11x18, covering all eight facings plus a
// solid-white "tint" cell (sample here to tint placeholders).
//
// Layout (cells):
//   (0,0) NW back-3/4 mirrored   (1,0) WHITE TINT       (2,0) NE back-3/4
//   (0,1) W side mirrored        (1,1) S front          (2,1) E side
//   (0,2) SW front-3/4 mirrored  (1,2) N back           (2,2) SE front-3/4
//
// Color encoding: pixels marked `P` and `S` are emitted as pure magenta
// (255,0,255) and pure cyan (0,255,255). The sprite fragment shader detects
// these markers via NEAREST sampling and replaces them with per-instance
// `a_primary` and `a_secondary` colors so factions can vary uniform colors
// without rebaking the atlas.
//
// Keep in sync with scripts/draw-british-soldier.mjs (preview PNG generator).

export const SOLDIER_CELL_W = 11;
export const SOLDIER_CELL_H = 18;
export const SOLDIER_COLS = 3;
export const SOLDIER_ROWS = 3;
export const SOLDIER_SHEET_W = SOLDIER_CELL_W * SOLDIER_COLS;
export const SOLDIER_SHEET_H = SOLDIER_CELL_H * SOLDIER_ROWS;

/** Cell that is solid white — sample here when you want pure tint. */
export const SOLDIER_TINT_CELL = { col: 1, row: 0 } as const;

/** Cell with the front-facing line-infantry pose. */
export const SOLDIER_FRONT_CELL = { col: 1, row: 1 } as const;

/** Compass-ordered soldier poses starting at north and proceeding clockwise. */
export const POSE_CELLS = [
  { col: 1, row: 2 }, // N  back
  { col: 2, row: 0 }, // NE back-3/4
  { col: 2, row: 1 }, // E  side
  { col: 2, row: 2 }, // SE front-3/4
  { col: 1, row: 1 }, // S  front
  { col: 0, row: 2 }, // SW front-3/4 mirrored
  { col: 0, row: 1 }, // W  side mirrored
  { col: 0, row: 0 }, // NW back-3/4 mirrored
] as const;

/** Magenta marker pixel — replaced by the per-instance primary color. */
export const PRIMARY_MARKER: readonly [number, number, number] = [255, 0, 255];
/** Cyan marker pixel — replaced by the per-instance secondary color. */
export const SECONDARY_MARKER: readonly [number, number, number] = [0, 255, 255];

const PALETTE_BASE: Record<string, [number, number, number, number]> = {
  '.': [0, 0, 0, 0],
  'k': [22, 18, 28, 255],     // black: shako, boots, dark outline
  'w': [236, 232, 222, 255],  // white: cross-belts, breeches
  'f': [228, 188, 156, 255],  // skin
  'F': [186, 142, 108, 255],  // skin shadow
  'y': [232, 188, 72, 255],   // brass: shako plate, gold accents
  'm': [86, 56, 36, 255],     // wood: musket stock
  'M': [56, 36, 22, 255],     // dark wood: musket butt
  'g': [180, 188, 200, 255],  // steel: bayonet, barrel
  's': [60, 56, 52, 110],     // ground shadow (semi-transparent)
  'W': [255, 255, 255, 255],  // tint sample cell
};

// Pose grids (11 wide x 18 tall). Rifle is held vertically alongside the
// soldier's left arm with the bayonet rising above the shako; for back-facing
// poses the rifle is mirrored to the soldier's right side from viewer POV.
//
//   P = primary  (coat)        S = secondary  (plume / collar / facings)

const POSE_FRONT = [
  '.g.........', // 0  bayonet tip
  '.g.........', // 1  bayonet
  '.g....S....', // 2  plume tip
  '.g...SSS...', // 3  plume base
  '.g...kkk...', // 4  shako top
  '.g...kyk...', // 5  shako with brass plate
  '.g...kkk...', // 6  shako body
  '.g..kkkkk..', // 7  shako brim
  '.g...fFf...', // 8  face
  '.m...SSS...', // 9  collar (secondary)
  '.m..wPPPw..', // 10 shoulders + cross-belt anchors
  '.m..PwPwP..', // 11 chest, belts crossing in
  '.m..PPwPP..', // 12 chest, belt intersection
  '.m..PwPwP..', // 13 chest, belts crossing out
  '.m..SPPPS..', // 14 turnbacks (secondary corners)
  '.M...www...', // 15 breeches
  '.M...k.k...', // 16 gaiters
  '.....sss...', // 17 shadow
];

const POSE_FRONT_DIAG = [
  '.g.........', // 0
  '.g.........', // 1
  '.g.....S...', // 2  plume tip nudged toward viewer-right
  '.g....SSS..', // 3
  '.g....kkk..', // 4
  '.g....kky..', // 5  brass plate angled to the right side
  '.g....kkk..', // 6
  '.g...kkkkk.', // 7  shako brim
  '.g....fF...', // 8  face 3/4 (more shadow on right)
  '.m...SPPS..', // 9  collar with secondary on viewer-right
  '.m..wPPPSw.', // 10 shoulders (asymmetric — facing showing)
  '.m..PwPwSP.', // 11 chest
  '.m..PPwPSP.', // 12 chest
  '.m..PSPwSP.', // 13 chest with vertical lapel band
  '.m..SPPPSP.', // 14 turnbacks
  '.M...www...', // 15 breeches
  '.M...k.k...', // 16 gaiters
  '.....sss...', // 17 shadow
];

const POSE_SIDE = [
  '.g.........', // 0  bayonet tip
  '.g.........', // 1  bayonet
  '.g.....S...', // 2  plume tip
  '.g....SSS..', // 3  plume base
  '.g....kkk..', // 4  shako top
  '.g....kyk..', // 5  brass plate (front-of-side facing)
  '.g....kkk..', // 6  shako body
  '.g...kkkkk.', // 7  shako brim
  '.g.....fF..', // 8  face profile (nose / brow on viewer-right)
  '.m....SPS..', // 9  collar
  '.m....wPP..', // 10 shoulder + cross-belt strap
  '.m....PwS..', // 11 chest, single belt visible from this side
  '.m....PPP..', // 12 chest
  '.m....PwS..', // 13 chest
  '.m....SPS..', // 14 coat tail
  '.M....www..', // 15 breeches
  '.M....k.k..', // 16 gaiters (one foot forward)
  '......sss..', // 17 shadow
];

const POSE_BACK = [
  '.........g.', // 0  bayonet tip (rifle on viewer-right behind soldier)
  '.........g.', // 1  bayonet
  '....S....g.', // 2  plume tip
  '...SSS...g.', // 3  plume base
  '...kkk...g.', // 4  shako top
  '...kyk...g.', // 5  shako rear (brass plate on rear seam)
  '...kkk...g.', // 6  shako body
  '..kkkkk..g.', // 7  shako brim
  '...kkk...g.', // 8  back of head
  '...SSS...m.', // 9  collar
  '..wPPPw..m.', // 10 shoulders + belt anchors
  '..PwPwP..m.', // 11 back, belts crossing in
  '..PPwPP..m.', // 12 back, belt intersection
  '..PwPwP..m.', // 13 back, belts crossing out
  '..SPPPS..M.', // 14 coat tails
  '...www.....', // 15 breeches
  '...k.k.....', // 16 gaiters
  '...sss.....', // 17 shadow
];

const POSE_BACK_DIAG = [
  '.........g.', // 0
  '.........g.', // 1
  '...S.....g.', // 2  plume tip nudged toward viewer-left (soldier turning away-right)
  '..SSS....g.', // 3
  '..kkk....g.', // 4
  '..kyk....g.', // 5  brass plate offset (rear-quarter)
  '..kkk....g.', // 6
  '.kkkkk...g.', // 7
  '..kkk....g.', // 8  back of head
  '..SSS....m.', // 9
  '.wPPPw...m.', // 10 shoulders
  '.PwPwP...m.', // 11 back, belts
  '.PPwPP...m.', // 12 back
  '.PwPwP...m.', // 13 back
  '.SPPPS...M.', // 14 coat tails
  '..www......', // 15 breeches
  '..k.k......', // 16 gaiters
  '..sss......', // 17 shadow
];

const TINT_CELL = Array.from({ length: SOLDIER_CELL_H }, () => 'W'.repeat(SOLDIER_CELL_W));

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
  for (let y = 0; y < SOLDIER_CELL_H; y++) {
    const row = pose[y]!;
    for (let x = 0; x < SOLDIER_CELL_W; x++) {
      const ch = mirror ? row[SOLDIER_CELL_W - 1 - x] : row[x];
      const rgba = palette[ch!] ?? palette['.']!;
      const i = ((cellY + y) * sheetW + (cellX + x)) * 4;
      buf[i + 0] = rgba[0]!;
      buf[i + 1] = rgba[1]!;
      buf[i + 2] = rgba[2]!;
      buf[i + 3] = rgba[3]!;
    }
  }
}

export interface SoldierSheetOptions {
  /** If set, bake this primary RGB into the atlas instead of the magenta marker. */
  resolvePrimary?: readonly [number, number, number];
  /** If set, bake this secondary RGB into the atlas instead of the cyan marker. */
  resolveSecondary?: readonly [number, number, number];
}

/**
 * Builds the 33x54 RGBA atlas as a flat Uint8Array.
 *
 * By default the primary/secondary regions are emitted as magenta/cyan
 * markers; the runtime sprite shader replaces them per-instance. Pass
 * `resolvePrimary` / `resolveSecondary` to bake a faction's colors directly
 * (useful for static previews).
 */
export function generateBritishSoldierSheet(opts: SoldierSheetOptions = {}): Uint8Array {
  const buf = new Uint8Array(SOLDIER_SHEET_W * SOLDIER_SHEET_H * 4);
  const W = SOLDIER_CELL_W;
  const H = SOLDIER_CELL_H;
  const palette = buildPalette(opts.resolvePrimary, opts.resolveSecondary);
  blit(buf, SOLDIER_SHEET_W, 0,     0,     POSE_BACK_DIAG,  true,  palette);
  blit(buf, SOLDIER_SHEET_W, W,     0,     TINT_CELL,       false, palette);
  blit(buf, SOLDIER_SHEET_W, 2 * W, 0,     POSE_BACK_DIAG,  false, palette);
  blit(buf, SOLDIER_SHEET_W, 0,     H,     POSE_SIDE,       true,  palette);
  blit(buf, SOLDIER_SHEET_W, W,     H,     POSE_FRONT,      false, palette);
  blit(buf, SOLDIER_SHEET_W, 2 * W, H,     POSE_SIDE,       false, palette);
  blit(buf, SOLDIER_SHEET_W, 0,     2 * H, POSE_FRONT_DIAG, true,  palette);
  blit(buf, SOLDIER_SHEET_W, W,     2 * H, POSE_BACK,       false, palette);
  blit(buf, SOLDIER_SHEET_W, 2 * W, 2 * H, POSE_FRONT_DIAG, false, palette);
  return buf;
}
