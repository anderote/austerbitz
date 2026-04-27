import { DIRECTIONS, type Direction } from './pose-config';

const HORIZONTALNESS: Record<Exclude<Direction, 'omni'>, number> = {
  N: 0,
  NE: 1,
  E: 2,
  SE: 1,
  S: 0,
  SW: 1,
  W: 2,
  NW: 1,
};

export function buildDirLookup(available: readonly Direction[]): Direction[] {
  if (available.includes('omni')) {
    return Array(8).fill('omni') as Direction[];
  }
  const compass = available.filter((d): d is Exclude<Direction, 'omni'> => d !== 'omni');
  if (compass.length === 0) throw new Error('pose has no directions');
  const result: Direction[] = new Array(8);
  for (let i = 0; i < 8; i++) {
    let best: Exclude<Direction, 'omni'> = compass[0]!;
    let bestDist = 9;
    let bestHoriz = -1;
    let bestCw = 9;
    for (const d of compass) {
      const j = DIRECTIONS.indexOf(d);
      const cw = (i - j + 8) % 8;
      const ccw = (j - i + 8) % 8;
      const dist = Math.min(cw, ccw);
      const horiz = HORIZONTALNESS[d];
      if (
        dist < bestDist ||
        (dist === bestDist && horiz > bestHoriz) ||
        (dist === bestDist && horiz === bestHoriz && cw < bestCw)
      ) {
        best = d;
        bestDist = dist;
        bestHoriz = horiz;
        bestCw = cw;
      }
    }
    result[i] = best;
  }
  return result;
}
