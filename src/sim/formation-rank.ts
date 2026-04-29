import type { Entities } from './entities';
import { MAX_TRACKED_RANKS } from './entities';
import type { Grid } from './spatial/grid';
import { gridQueryRect } from './spatial/grid';
import { facingToVec } from './systems/facing-system';

const candidateBuf = new Int32Array(2048);

const LATERAL_TOL_MULT = 0.6;
const FORWARD_NEAR_MULT = 0.5;
const QUERY_RADIUS_MULT = 2.0;

/**
 * Count distinct same-team same-restFacing neighbors that sit AHEAD of `id`
 * along its formation forward axis. The result is `id`'s formation rank
 * (0 = front), clamped to MAX_TRACKED_RANKS-1.
 */
export function inferFormationRank(
  e: Entities,
  grid: Grid,
  id: number,
  spacingX: number,
  spacingY: number,
): number {
  const team = e.team[id]!;
  const facing = e.restFacing[id]!;
  const fwdVec = facingToVec(facing);
  const fx = fwdVec.x, fy = fwdVec.y;
  const myX = e.restPosX[id]!;
  const myY = e.restPosY[id]!;
  const radius = QUERY_RADIUS_MULT * spacingY;
  const lateralTol = LATERAL_TOL_MULT * spacingX;
  const forwardNear = FORWARD_NEAR_MULT * spacingY;

  const count = gridQueryRect(
    grid,
    e.posX[id]! - radius, e.posY[id]! - radius,
    e.posX[id]! + radius, e.posY[id]! + radius,
    candidateBuf,
  );

  let maxFwd = 0;
  for (let k = 0; k < count; k++) {
    const cid = candidateBuf[k]!;
    if (cid === id) continue;
    if (e.alive[cid] === 0) continue;
    if (e.team[cid] !== team) continue;
    if (e.restFacing[cid] !== facing) continue;
    const dx = e.restPosX[cid]! - myX;
    const dy = e.restPosY[cid]! - myY;
    const fwd = dx * fx + dy * fy;
    if (fwd <= forwardNear) continue;
    const lat = -dx * fy + dy * fx;
    if (lat * lat > lateralTol * lateralTol) continue;
    if (fwd > maxFwd) maxFwd = fwd;
  }

  if (maxFwd <= 0) return 0;
  const ranksAhead = Math.floor((maxFwd - forwardNear) / spacingY) + 1;
  if (ranksAhead < 0) return 0;
  return Math.min(ranksAhead, MAX_TRACKED_RANKS - 1);
}
