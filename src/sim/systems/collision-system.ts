import type { System } from '../world';
import { gridQueryRadius } from '../spatial/grid';
import { unitKinds } from '../../data/units';
import { EntityState } from '../entities';

const PUSH_STRENGTH = 0.5;
// Seconds a unit waits after being shoved before drifting back to its parked
// position. Reset to this value any tick a meaningful collision push lands.
const PUSH_RECOVERY_DELAY = 2.5;
// Below this corrective magnitude (metres) the contact is treated as touch
// jitter, not a real shove — avoids re-arming the timer every tick on
// near-rest neighbours.
const PUSH_NUDGE_EPS = 5e-3;

let MAX_BODY_RADIUS = 0;
for (const k of unitKinds) {
  if (k.baseStats.bodyRadius > MAX_BODY_RADIUS) MAX_BODY_RADIUS = k.baseStats.bodyRadius;
}

const NEIGHBOR_BUF = new Int32Array(1024);

export const collisionSystem: System = (world, _dt) => {
  const e = world.entities;
  for (let n = 0; n < e.count; n++) {
    const i = e.aliveIds[n]!;
    // Ragdoll/Dying/Dead are corpses — they don't push or get pushed. Reloading
    // and Flinch are upright soldiers that still occupy space, so they collide
    // normally; otherwise marching reloaders walk through each other and arrive
    // overlapping their neighbours, which kicks off a drift-back/jostle loop
    // the moment they tick back into Idle.
    if (e.state[i]! >= EntityState.Ragdoll) continue;
    // Skip fully-parked units (vel=0 AND no recent push). Their pairs still get
    // resolved via active neighbours' outer iteration (see dedup below), so we
    // only lose pair resolution when BOTH endpoints are parked simultaneously —
    // which can't happen in normal play because anything that landed in an
    // overlap state was either moving or just pushed (pushedT > 0) the moment
    // it overlapped. With 40k mostly-static units this skip cuts the dominant
    // cost (gridQueryRadius per outer iteration) by ~95%.
    if (e.velX[i] === 0 && e.velY[i] === 0 && e.pushedT[i] === 0) continue;
    const ri = e.bodyRadius[i]!;
    const mi = e.massKg[i]!;
    const xi = e.posX[i]!;
    const yi = e.posY[i]!;
    const nNeighbors = gridQueryRadius(world.grid, xi, yi, ri + MAX_BODY_RADIUS, NEIGHBOR_BUF);
    for (let k = 0; k < nNeighbors; k++) {
      const j = NEIGHBOR_BUF[k]!;
      if (j === i) continue;
      if (e.alive[j] !== 1) continue;
      if (e.state[j]! >= EntityState.Ragdoll) continue;
      // Pair dedup: when both endpoints are active, only the smaller-id outer
      // processes the pair. When neighbour j is parked, j's own outer is
      // skipped — so we MUST process here regardless of id order.
      if (j < i && (e.velX[j] !== 0 || e.velY[j] !== 0 || e.pushedT[j] !== 0)) continue;
      const rj = e.bodyRadius[j]!;
      const sumR = ri + rj;
      const dx = e.posX[j]! - e.posX[i]!;
      const dy = e.posY[j]! - e.posY[i]!;
      const distSq = dx * dx + dy * dy;
      if (distSq >= sumR * sumR) continue;
      const dist = Math.sqrt(distSq);
      let nx: number, ny: number;
      if (dist < 1e-5) {
        // Coincident: pick a deterministic direction from the id pair.
        const a = ((i * 12.9898 + j * 78.233) % (Math.PI * 2));
        nx = Math.cos(a);
        ny = Math.sin(a);
      } else {
        nx = dx / dist;
        ny = dy / dist;
      }
      const penetration = sumR - dist;
      const totalM = mi + e.massKg[j]!;
      const wi = e.massKg[j]! / totalM;
      const wj = mi / totalM;
      const corr = penetration * PUSH_STRENGTH;
      e.posX[i] = e.posX[i]! - nx * corr * wi;
      e.posY[i] = e.posY[i]! - ny * corr * wi;
      e.posX[j] = e.posX[j]! + nx * corr * wj;
      e.posY[j] = e.posY[j]! + ny * corr * wj;
      if (corr * wi > PUSH_NUDGE_EPS) e.pushedT[i] = PUSH_RECOVERY_DELAY;
      if (corr * wj > PUSH_NUDGE_EPS) e.pushedT[j] = PUSH_RECOVERY_DELAY;
    }
  }
};
