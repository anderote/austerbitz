export type Frame = readonly string[];
export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export type SourceDirection = 'N' | 'NE' | 'E' | 'SE' | 'S';
export type PoseName = 'idle' | 'walking' | 'running';
export type RGBA = readonly [number, number, number, number];

export const CELL_W: 32;
export const CELL_H: 24;

export const SOURCE_DIRS: readonly SourceDirection[];
export const MIRROR_PAIRS: ReadonlyArray<readonly [Direction, SourceDirection]>;
export const ALL_DIRS: readonly Direction[];

export const PALETTE: Readonly<Record<string, RGBA>>;

export const FRAME_COUNTS: Readonly<{ idle: 1; walking: 4; running: 6 }>;

export function validateFrame(frame: Frame, label: string): void;
export function renderFrame(frame: Frame): Uint8Array;
export function mirrorFrame(frame: Frame): string[];

export const POSES: Readonly<{
  idle: Record<SourceDirection, Frame[]>;
  walking: Record<SourceDirection, Frame[]>;
  running: Record<SourceDirection, Frame[]>;
}>;
