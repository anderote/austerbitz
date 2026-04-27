import { type Entities, EntityState } from '../entities';
import { getUnitKindByIndex } from '../../data/units';
import type { Particles } from '../../particles/particles';
import { spawnBlood } from '../../particles/emitters';
import type { Rng } from '../../util/rng';
import { pushBloodSplat, type BloodSplats } from '../blood-splats';

/** Impulse magnitude (N·s) at or above which a kill ragdolls instead of falling in place. */
export const KILL_RAGDOLL_THRESHOLD = 8000;
/** Impulse magnitude (N·s) at or above which a non-kill ragdolls instead of flinching. */
export const KNOCKBACK_THRESHOLD = 4000;

export type HitKind = 'musket' | 'cannon' | 'melee' | 'charge' | 'explosion';

const FLINCH_DURATION = 0.3;
const RAGDOLL_DURATION = 2.0;
const DYING_DURATION = 0.5;

export function enterFlinch(e: Entities, id: number): void {
  e.state[id] = EntityState.Flinch;
  e.stateT[id] = FLINCH_DURATION;
  e.velX[id] = 0;
  e.velY[id] = 0;
}

export function enterRagdoll(e: Entities, id: number, impX: number, impY: number): void {
  e.state[id] = EntityState.Ragdoll;
  e.ragdollT[id] = RAGDOLL_DURATION;
  const mass = getUnitKindByIndex(e.kindId[id]!).baseStats.massKg;
  e.velX[id] += impX / mass;
  e.velY[id] += impY / mass;
}

export function enterDying(e: Entities, id: number): void {
  e.state[id] = EntityState.Dying;
  e.stateT[id] = DYING_DURATION;
  e.velX[id] = 0;
  e.velY[id] = 0;
}

/** Single funnel for incoming damage from any source. */
export function applyHit(
  e: Entities,
  particles: Particles,
  rng: Rng,
  id: number,
  dmg: number,
  impX: number,
  impY: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _kind: HitKind,
  splats?: BloodSplats,
): void {
  if (e.alive[id] === 0) return;

  const kind = getUnitKindByIndex(e.kindId[id]!);
  const effDmg = Math.max(1, dmg - kind.baseStats.armor);

  // hp is Uint16Array; clamp to 0 to avoid underflow.
  const hpNow = e.hp[id]!;
  if (effDmg >= hpNow) {
    e.hp[id] = 0;
  } else {
    e.hp[id] = hpNow - effDmg;
  }

  const impMag = Math.hypot(impX, impY);
  const px = e.posX[id]!;
  const py = e.posY[id]!;

  if (e.hp[id] === 0) {
    if (impMag > KILL_RAGDOLL_THRESHOLD) {
      // Ragdoll-system will transition to Dying once the body settles.
      enterRagdoll(e, id, impX, impY);
    } else {
      enterDying(e, id);
    }
    spawnBlood(particles, px, py, impMag, rng);
    if (splats) {
      // Lethal: a primary pool plus a smaller satellite spatter, jittered.
      const impScale = Math.min(1, 0.4 + impMag * 0.0002);
      pushBloodSplat(
        splats,
        px + rng.range(-0.4, 0.4),
        py + rng.range(-0.4, 0.4),
        rng.range(0.6, 1.2),
        rng.range(0.7, 1.0) * impScale,
      );
      pushBloodSplat(
        splats,
        px + rng.range(-0.6, 0.6),
        py + rng.range(-0.6, 0.6),
        rng.range(0.4, 0.8),
        rng.range(0.5, 0.8) * impScale,
      );
    }
    return;
  }

  if (impMag > KNOCKBACK_THRESHOLD) {
    enterRagdoll(e, id, impX * 0.5, impY * 0.5);
  } else {
    enterFlinch(e, id);
  }
  spawnBlood(particles, px, py, impMag * 0.4, rng);
  if (splats) {
    pushBloodSplat(
      splats,
      px + rng.range(-0.3, 0.3),
      py + rng.range(-0.3, 0.3),
      rng.range(0.3, 0.6),
      rng.range(0.3, 0.5),
    );
  }
}
