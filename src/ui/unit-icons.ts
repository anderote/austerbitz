// Draws a small per-kind icon into a caller-owned canvas. The British soldier
// sheet is rendered once into a hidden canvas, then sliced per cell. Kinds
// without a sheet cell fall back to a placeholderColor block. Owning the
// target canvas at the call site avoids reparenting a single shared node
// (which would silently move the icon between cards).
import {
  generateBritishSoldierSheet,
  SOLDIER_SHEET_W,
  SOLDIER_SHEET_H,
  SOLDIER_CELL_W,
  SOLDIER_CELL_H,
} from '../render/british-soldier-sprite';
import { getUnitKindByIndex } from '../data/units';

let sheetCanvas: HTMLCanvasElement | null = null;

function ensureSheet(): HTMLCanvasElement {
  if (sheetCanvas) return sheetCanvas;
  const c = document.createElement('canvas');
  c.width = SOLDIER_SHEET_W;
  c.height = SOLDIER_SHEET_H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(SOLDIER_SHEET_W, SOLDIER_SHEET_H);
  img.data.set(generateBritishSoldierSheet());
  ctx.putImageData(img, 0, 0);
  sheetCanvas = c;
  return c;
}

export const UNIT_ICON_W = SOLDIER_CELL_W;
export const UNIT_ICON_H = SOLDIER_CELL_H;

export function drawUnitIconTo(target: HTMLCanvasElement, kindIdx: number): void {
  target.width = SOLDIER_CELL_W;
  target.height = SOLDIER_CELL_H;
  const ctx = target.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, target.width, target.height);
  const kind = getUnitKindByIndex(kindIdx);
  if (kind.spriteCell) {
    const sheet = ensureSheet();
    ctx.drawImage(
      sheet,
      kind.spriteCell.col * SOLDIER_CELL_W,
      kind.spriteCell.row * SOLDIER_CELL_H,
      SOLDIER_CELL_W, SOLDIER_CELL_H,
      0, 0, SOLDIER_CELL_W, SOLDIER_CELL_H,
    );
    return;
  }
  const [r, g, b] = kind.placeholderColor;
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(2, 2, SOLDIER_CELL_W - 4, SOLDIER_CELL_H - 4);
}

