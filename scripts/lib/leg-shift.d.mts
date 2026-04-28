export const CELL_W: 32;
export const CELL_H: 36;
export const LEG_REGION_TOP: 24;
export const LEG_REGION_HEIGHT: 12;

export function shiftLegs(rgba: Uint8ClampedArray, dy: number): Uint8ClampedArray;
export function shiftHalfLegs(
  rgba: Uint8ClampedArray,
  side: 'left' | 'right',
  dy: number,
): Uint8ClampedArray;
export function readRgba(path: string): Promise<Uint8ClampedArray>;
export function rgbaToPng(rgba: Uint8ClampedArray): Buffer;
