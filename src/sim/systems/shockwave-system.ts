import { EntityState, type Entities } from '../entities';
import { type Grid, gridQueryRadius } from '../spatial/grid';
import type { Particles } from '../../particles/particles';
import type { Rng } from '../../util/rng';
import type { BloodSplats } from '../blood-splats';
import type { Debris } from '../debris';
import { type Shockwaves, freeShockwave, isHit, setHit } from '../../fx/shockwaves';
import { applyHit, gibCorpse } from './combat-events';
import type { DamageTexts } from '../../fx/damage-texts/damage-texts';

const SCRATCH = new Int32Array(2048);

/**
 * Per-tick: advance each active wave; deliver damage to entities crossed this tick.
 * Each entity is hit at most once per wave (tracked by the shockwave's hit bitset).
 */
export function updateShockwaves(
  sw: Shockwaves,
  entities: Entities,
  grid: Grid,
  particles: Particles,
  rng: Rng,
  splats: BloodSplats | undefined,
  debris: Debris,
  dt: number,
  damageTexts?: DamageTexts,
): void {
  for (let w = 0; w < sw.capacity; w++) {
    if (sw.alive[w] === 0) continue;
    const prevR = sw.waveSpeed[w]! * sw.age[w]!;
    sw.age[w] = sw.age[w]! + dt;
    const fullR = sw.fullRadius[w]!;
    let currR = sw.waveSpeed[w]! * sw.age[w]!;
    const done = currR >= fullR;
    if (done) currR = fullR;

    const cx = sw.x[w]!;
    const cy = sw.y[w]!;
    const damageScale = sw.damage[w]!;
    const impulseScale = sw.impulse[w]!;
    const excludeTeam = sw.excludeTeam[w]!;
    const attackerId = sw.attackerId[w]!;

    const n = gridQueryRadius(grid, cx, cy, currR, SCRATCH);
    for (let i = 0; i < n; i++) {
      const id = SCRATCH[i]!;
      if (entities.alive[id] === 0) continue;
      if (isHit(sw, w, id)) continue;
      const dx = entities.posX[id]! - cx;
      const dy = entities.posY[id]! - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < prevR || dist > currR) continue;

      const state = entities.state[id]!;
      const isCorpse =
        state === EntityState.Dying ||
        state === EntityState.Dead ||
        state === EntityState.Ragdoll;

      // Corpses get dismembered regardless of team — friendly-fire suppression
      // is a damage-time concern, and a body lying in a blast has no allegiance
      // worth honoring.
      if (!isCorpse && excludeTeam !== -1 && entities.team[id] === excludeTeam) continue;

      setHit(sw, w, id);
      const t = Math.min(1, dist / fullR);
      const falloff = 1 - Math.pow(t, 1.5);
      const inv = dist > 1e-6 ? 1 / dist : 0;
      const dirX = dx * inv;
      const dirY = dy * inv;

      if (isCorpse) {
        gibCorpse(
          entities, rng, debris, id,
          dirX * impulseScale * falloff,
          dirY * impulseScale * falloff,
        );
        continue;
      }

      applyHit(
        entities, particles, rng, id,
        damageScale * falloff,
        dirX * impulseScale * falloff,
        dirY * impulseScale * falloff,
        'explosion',
        splats,
        debris,
        attackerId,
        damageTexts,
      );
    }

    if (done) freeShockwave(sw, w);
  }
}
