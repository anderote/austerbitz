export const EDITS_PATH_REL: string;

export interface PixelEdit {
  x: number;
  y: number;
  color: string;
}
export type EditsTree = Record<string, Record<string, Record<string, Record<string, Record<string, PixelEdit[]>>>>>;

export function loadEdits(repoRoot: string): Promise<EditsTree>;
export function lookupEdits(
  tree: EditsTree | null | undefined,
  kind: string,
  pose: string,
  dir: string,
  clipIdx: number,
  frameIdx: number,
): PixelEdit[];
export function applyEdits(
  rgba: Uint8Array | Uint8ClampedArray,
  cellW: number,
  cellH: number,
  edits: PixelEdit[],
): number;
