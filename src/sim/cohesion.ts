import type { Entities } from './entities';
import type { Grid } from './spatial/grid';
import { gridQueryRect } from './spatial/grid';
import { EntityState } from './entities';

const candidateBuf = new Int32Array(2048);

export const COHESION_RADIUS_M = 2.5;
export const COHESION_FULL_AT = 6;
export const COHESION_BONUS = 0.5;

/** Cohesion in [0,1]: fraction of saturation neighbor count. */
export function inferCohesion(e: Entities, grid: Grid, id: number): number {
  const team = e.team[id]!;
  const px = e.posX[id]!;
  const py = e.posY[id]!;
  const r = COHESION_RADIUS_M;
  const r2 = r * r;
  const count = gridQueryRect(grid, px - r, py - r, px + r, py + r, candidateBuf);
  let n = 0;
  for (let k = 0; k < count; k++) {
    const cid = candidateBuf[k]!;
    if (cid === id) continue;
    if (e.alive[cid] === 0) continue;
    if (e.team[cid] !== team) continue;
    const cs = e.state[cid]!;
    if (cs === EntityState.Dead || cs === EntityState.Dying || cs === EntityState.Ragdoll) continue;
    const dx = e.posX[cid]! - px;
    const dy = e.posY[cid]! - py;
    if (dx * dx + dy * dy > r2) continue;
    n++;
    if (n >= COHESION_FULL_AT) break;
  }
  return n >= COHESION_FULL_AT ? 1 : n / COHESION_FULL_AT;
}

/** Fire/reload-rate multiplier from a cohesion score. */
export function cohesionSpeedMult(cohesion: number): number {
  return 1 + COHESION_BONUS * cohesion;
}
