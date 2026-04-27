// Combined sprite atlas: vertically stacks per-kind sub-atlases (soldier,
// cuirassier, cannon-12) into a single RGBA buffer that the sprite-pass binds
// once per frame. Each kind keeps its own 3x3 cell grid (matching the soldier
// layout); per-kind metadata (cell size, pose cells, region offset) is held
// here so the sprite-pass can pick the right cell for any entity by `kindId`
// and `facing`.
//
// Width is `max(per-kind sheet width)`; kinds with narrower regions leave
// transparent right-pad inside the combined sheet.

import {
  generateBritishSoldierSheet,
  SOLDIER_SHEET_W,
  SOLDIER_SHEET_H,
  SOLDIER_CELL_W,
  SOLDIER_CELL_H,
  SOLDIER_TINT_CELL,
  SOLDIER_FRONT_CELL,
  POSE_CELLS as SOLDIER_POSE_CELLS,
} from './british-soldier-sprite';
import {
  generateCuirassierSheet,
  CUIRASSIER_SHEET_W,
  CUIRASSIER_SHEET_H,
  CUIRASSIER_CELL_W,
  CUIRASSIER_CELL_H,
  CUIRASSIER_TINT_CELL,
  CUIRASSIER_FRONT_CELL,
  CUIRASSIER_POSE_CELLS,
} from './cuirassier-sprite';
import {
  generateCannonSheet,
  CANNON_SHEET_W,
  CANNON_SHEET_H,
  CANNON_CELL_W,
  CANNON_CELL_H,
  CANNON_TINT_CELL,
  CANNON_FRONT_CELL,
  CANNON_POSE_CELLS,
} from './cannon-12-sprite';

export interface KindAtlasMeta {
  cellW: number;
  cellH: number;
  /** N..NW clockwise; index = facing - 1 (facings are 1..8). */
  poseCells: readonly { col: number; row: number }[];
  frontCell: { col: number; row: number };
  tintCell: { col: number; row: number };
  /** Pixel offset and size of this kind's region in the combined atlas. */
  region: { x: number; y: number; w: number; h: number };
}

export const COMBINED_SHEET_W = Math.max(
  SOLDIER_SHEET_W,
  CUIRASSIER_SHEET_W,
  CANNON_SHEET_W,
);
export const COMBINED_SHEET_H =
  SOLDIER_SHEET_H + CUIRASSIER_SHEET_H + CANNON_SHEET_H;

const SOLDIER_Y = 0;
const CUIRASSIER_Y = SOLDIER_SHEET_H;
const CANNON_Y = SOLDIER_SHEET_H + CUIRASSIER_SHEET_H;

export const KIND_ATLAS: Record<string, KindAtlasMeta> = {
  'line-infantry': {
    cellW: SOLDIER_CELL_W,
    cellH: SOLDIER_CELL_H,
    poseCells: SOLDIER_POSE_CELLS,
    frontCell: SOLDIER_FRONT_CELL,
    tintCell: SOLDIER_TINT_CELL,
    region: { x: 0, y: SOLDIER_Y, w: SOLDIER_SHEET_W, h: SOLDIER_SHEET_H },
  },
  'cuirassier': {
    cellW: CUIRASSIER_CELL_W,
    cellH: CUIRASSIER_CELL_H,
    poseCells: CUIRASSIER_POSE_CELLS,
    frontCell: CUIRASSIER_FRONT_CELL,
    tintCell: CUIRASSIER_TINT_CELL,
    region: { x: 0, y: CUIRASSIER_Y, w: CUIRASSIER_SHEET_W, h: CUIRASSIER_SHEET_H },
  },
  'cannon-12': {
    cellW: CANNON_CELL_W,
    cellH: CANNON_CELL_H,
    poseCells: CANNON_POSE_CELLS,
    frontCell: CANNON_FRONT_CELL,
    tintCell: CANNON_TINT_CELL,
    region: { x: 0, y: CANNON_Y, w: CANNON_SHEET_W, h: CANNON_SHEET_H },
  },
};

export interface CombinedAtlasOptions {
  resolvePrimary?: readonly [number, number, number];
  resolveSecondary?: readonly [number, number, number];
}

function blitRegion(
  dst: Uint8Array,
  dstW: number,
  dstX: number,
  dstY: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
): void {
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const si = (y * srcW + x) * 4;
      const di = ((dstY + y) * dstW + (dstX + x)) * 4;
      dst[di + 0] = src[si + 0]!;
      dst[di + 1] = src[si + 1]!;
      dst[di + 2] = src[si + 2]!;
      dst[di + 3] = src[si + 3]!;
    }
  }
}

export function generateCombinedAtlas(opts: CombinedAtlasOptions = {}): Uint8Array {
  const buf = new Uint8Array(COMBINED_SHEET_W * COMBINED_SHEET_H * 4);
  const soldier = generateBritishSoldierSheet(opts);
  const cuirassier = generateCuirassierSheet(opts);
  const cannon = generateCannonSheet(opts);
  blitRegion(buf, COMBINED_SHEET_W, 0, SOLDIER_Y,    soldier,    SOLDIER_SHEET_W,    SOLDIER_SHEET_H);
  blitRegion(buf, COMBINED_SHEET_W, 0, CUIRASSIER_Y, cuirassier, CUIRASSIER_SHEET_W, CUIRASSIER_SHEET_H);
  blitRegion(buf, COMBINED_SHEET_W, 0, CANNON_Y,     cannon,     CANNON_SHEET_W,     CANNON_SHEET_H);
  return buf;
}
