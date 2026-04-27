// 33x54 atlas: 3x3 cells of 11x18, with 5 poses arranged in a cross plus a
// solid-white "tint" cell that placeholder units sample (white * tintColor).
//
// Layout (cells):
//   (0,0) NW back-3/4 mirrored   (1,0) WHITE TINT       (2,0) NE back-3/4
//   (0,1) empty                  (1,1) FRONT            (2,1) empty
//   (0,2) SW front-3/4 mirrored  (1,2) empty            (2,2) SE front-3/4
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

/** Cell with the front-facing British line-infantry pose. */
export const SOLDIER_FRONT_CELL = { col: 1, row: 1 } as const;

const PALETTE: Record<string, [number, number, number, number]> = {
  '.': [0, 0, 0, 0],
  'k': [22, 18, 28, 255],
  'r': [196, 46, 54, 255],
  'd': [128, 28, 38, 255],
  'h': [232, 108, 100, 255],
  'w': [236, 232, 222, 255],
  'f': [228, 188, 156, 255],
  'F': [186, 142, 108, 255],
  'y': [232, 188, 72, 255],
  'b': [42, 44, 80, 255],
  's': [60, 56, 52, 110],
  'W': [255, 255, 255, 255],
};

const POSE_FRONT = [
  '....kkk....',
  '...kkkkk...',
  '...kykyk...',
  '...kkkkk...',
  '..kkkkkkk..',
  '....fFf....',
  '....fff....',
  '...yrrry...',
  '...rwrwr...',
  '...rrwrr...',
  '...rwrwr...',
  '...rrrrr...',
  '...dyryd...',
  '...drrrd...',
  '...ww.ww...',
  '...ww.ww...',
  '...kk.kk...',
  '..sssssss..',
];

const POSE_FRONT_DIAG = [
  '....kkk....',
  '...kkkkk...',
  '...kkyky...',
  '...kkkkk...',
  '..kkkkkkk..',
  '....fFFf...',
  '....ffFf...',
  '...yrrryy..',
  '...rrwrwr..',
  '...rwrwrr..',
  '...rrwrrr..',
  '...rrrrrr..',
  '...drryrd..',
  '...drrrrd..',
  '...ww.ww...',
  '...ww.ww...',
  '...kk.kk...',
  '..sssssss..',
];

const POSE_BACK_DIAG = [
  '....kkk....',
  '...kkkkk...',
  '...kkkkk...',
  '...kkkkk...',
  '..kkkkkkk..',
  '....fff....',
  '....fff....',
  '...yrrry...',
  '...rrrrr...',
  '...rbbbr...',
  '...rbwbr...',
  '...rbbbr...',
  '...rrrrr...',
  '...drrrd...',
  '...ww.ww...',
  '...ww.ww...',
  '...kk.kk...',
  '..sssssss..',
];

const TINT_CELL = Array.from({ length: SOLDIER_CELL_H }, () => 'W'.repeat(SOLDIER_CELL_W));

function blit(
  buf: Uint8Array,
  sheetW: number,
  cellX: number,
  cellY: number,
  pose: readonly string[],
  mirror: boolean,
): void {
  for (let y = 0; y < SOLDIER_CELL_H; y++) {
    const row = pose[y]!;
    for (let x = 0; x < SOLDIER_CELL_W; x++) {
      const ch = mirror ? row[SOLDIER_CELL_W - 1 - x] : row[x];
      const rgba = PALETTE[ch!] ?? PALETTE['.']!;
      const i = ((cellY + y) * sheetW + (cellX + x)) * 4;
      buf[i + 0] = rgba[0];
      buf[i + 1] = rgba[1];
      buf[i + 2] = rgba[2];
      buf[i + 3] = rgba[3];
    }
  }
}

/** Builds the 33x54 RGBA atlas as a flat Uint8Array. */
export function generateBritishSoldierSheet(): Uint8Array {
  const buf = new Uint8Array(SOLDIER_SHEET_W * SOLDIER_SHEET_H * 4);
  const W = SOLDIER_CELL_W;
  const H = SOLDIER_CELL_H;
  blit(buf, SOLDIER_SHEET_W, 0,     0,     POSE_BACK_DIAG,  true);
  blit(buf, SOLDIER_SHEET_W, W,     0,     TINT_CELL,       false);
  blit(buf, SOLDIER_SHEET_W, 2 * W, 0,     POSE_BACK_DIAG,  false);
  blit(buf, SOLDIER_SHEET_W, W,     H,     POSE_FRONT,      false);
  blit(buf, SOLDIER_SHEET_W, 0,     2 * H, POSE_FRONT_DIAG, true);
  blit(buf, SOLDIER_SHEET_W, 2 * W, 2 * H, POSE_FRONT_DIAG, false);
  return buf;
}
