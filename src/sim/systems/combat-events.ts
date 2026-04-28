import { type Entities, EntityState, isDead } from '../entities';
import { getUnitKindByIndex } from '../../data/units';
import type { Particles } from '../../particles/particles';
import { emitPromotionSparkle, spawnBlood } from '../../particles/emitters';
import type { Rng } from '../../util/rng';
import type { BloodSplats } from '../blood-splats';
import { effectiveArmor, promote } from '../veterancy';

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

/**
 * Single funnel for incoming damage from any source.
 *
 * Ground blood-stains are no longer pushed here at the hit location — they're
 * now stamped by individual Blood particles when they land (see
 * updateParticles in particles.ts). Direction (impX, impY) is forwarded to
 * spawnBlood so the spray cones forward along the projectile's travel.
 *
 * The trailing `splats` parameter is unused; it's retained for call-site
 * compatibility (projectile-system / explosion still pass it through).
 */
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _splats: BloodSplats | undefined,
  attackerId: number,
): void {
  if (e.alive[id] === 0) return;
  if (isDead(e, id)) return;

  const kind = getUnitKindByIndex(e.kindId[id]!);
  const effArmor = effectiveArmor(e, id, kind.baseStats.armor);
  const effDmg = Math.max(1, dmg - effArmor);

  // hp is Uint16Array; clamp to 0 to avoid underflow.
  const hpNow = e.hp[id]!;
  const lethal = effDmg >= hpNow;
  if (lethal) {
    e.hp[id] = 0;
  } else {
    e.hp[id] = hpNow - effDmg;
  }

  const impMag = Math.hypot(impX, impY);
  const px = e.posX[id]!;
  const py = e.posY[id]!;

  if (lethal) {
    if (impMag > KILL_RAGDOLL_THRESHOLD) {
      // Ragdoll-system will transition to Dying once the body settles.
      enterRagdoll(e, id, impX, impY);
    } else {
      enterDying(e, id);
    }
    spawnBlood(particles, px, py, impMag, rng, impX, impY);

    // XP credit — guarded against ownerless / friendly fire / dead attacker.
    if (
      attackerId !== -1 &&
      e.alive[attackerId] === 1 &&
      !isDead(e, attackerId) &&
      e.team[attackerId] !== e.team[id]
    ) {
      if (e.xp[attackerId]! < 0xffff) e.xp[attackerId] = e.xp[attackerId]! + 1;
      if (promote(e, attackerId)) {
        emitPromotionSparkle(particles, e.posX[attackerId]!, e.posY[attackerId]!, rng);
      }
    }
    return;
  }

  if (impMag > KNOCKBACK_THRESHOLD) {
    enterRagdoll(e, id, impX * 0.5, impY * 0.5);
  } else {
    enterFlinch(e, id);
  }
  spawnBlood(particles, px, py, impMag * 0.4, rng, impX, impY);
}
