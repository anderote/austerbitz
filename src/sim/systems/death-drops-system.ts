import type { System } from '../world';
import { EntityState, PartLost } from '../entities';
import { spawnDroppedHat, spawnDroppedWeapon } from '../dropped-items';
import { getUnitKindByIndex } from '../../data/units';
import { resolvePoseWeaponEntry, type Facing } from '../../render/poses/resolver';
import type { KitConfig } from '../../render/poses/kit-loader';
import { Pose } from '../../render/poses/pose-config';

// Mirrors sprite-pass.ts's RUNTIME_FACING_TO_LETTER: runtime facing 0..7 =
// E, SE, S, SW, W, NW, N, NE. Used to look up the per-pose weapon offset.
const RUNTIME_FACING_TO_LETTER: Facing[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

const SPRITE_CELL_PX = 32;

// Live poses we freeze infantry corpses into at death. Excludes dying/dead
// (the originals we're replacing) and ragdoll (a separate cinematic state).
const INFANTRY_DEATH_POSES: ReadonlyArray<Pose> = [
  Pose.idle,
  Pose.walking,
  Pose.running,
  Pose.aiming,
  Pose.firing,
  Pose.reloading,
  Pose.flinch,
];

// xorshift-mul hash, mirrors state-system.ts's pickClip. Used here to derive
// stable per-entity choices for pose-pick / poseT-pick / clipIndex-pick that
// don't consume world.rng (so the rng stream stays parallel-safe / stable
// regardless of how many entities die in a given tick).
function hash(id: number, salt: number): number {
  let h = (Math.imul(id, 2654435761) ^ Math.imul(salt, 1597334677)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export function createDeathDropsSystem(kits: ReadonlyMap<string, KitConfig>): System {
  return (world, _dt) => {
    const e = world.entities;
    const d = world.droppedItems;
    for (let n = 0; n < e.count; n++) {
      const id = e.aliveIds[n]!;
      // weaponDropped doubles as the "death finalization already ran" flag —
      // pose freeze + bodyRot + weapon spawn all gate on it, so each happens
      // exactly once per death.
      if (e.weaponDropped[id]) continue;
      const s = e.state[id]!;
      if (s !== EntityState.Dying && s !== EntityState.Dead) continue;
      const kindIdx = e.kindId[id]!;
      const kind = getUnitKindByIndex(kindIdx);

      // Finalize corpse pose + body rotation. Infantry freeze in a random LIVE
      // pose and tilt over during the Dying state; everything else keeps the
      // existing dying-pose look (state-system no longer writes pose for
      // Dying/Dead, so we have to set it explicitly here).
      if (kind.category === 'infantry') {
        const poseHash = hash(id, 0x9e3779b1);
        const pose = INFANTRY_DEATH_POSES[poseHash % INFANTRY_DEATH_POSES.length]!;
        const tHash = hash(id, 0x85ebca77);
        const cHash = hash(id, 0xc2b2ae3d);
        e.pose[id] = pose;
        // poseT in [0, 1.0): different soldiers freeze on different animation
        // frames so a row of corpses doesn't all match exactly.
        e.poseT[id] = (tHash & 0xffff) / 0x10000;
        e.clipIndex[id] = cHash & 0xff;
        // ±(70°..110°) — final tilt magnitude + side. world.rng is fine here
        // (deterministic via seed) since we're already inside a per-entity
        // branch that depends on death events.
        const mag = world.rng.range(70, 110);
        const sign = world.rng.range(0, 1) < 0.5 ? -1 : 1;
        e.bodyRot[id] = (sign * mag * Math.PI) / 180;
      } else {
        e.pose[id] = Pose.dying;
        e.poseT[id] = 0;
        e.clipIndex[id] = 0;
        e.bodyRot[id] = 0;
      }

      const kit = kits.get(kind.id);
      if (!kit || !kit.weapon) {
        // Nothing to drop; mark so we don't re-check this entity every tick.
        e.weaponDropped[id] = 1;
        continue;
      }
      const facing = e.facing[id]!;
      const facingLetter = RUNTIME_FACING_TO_LETTER[facing]!;
      // Palette lookup: corpses spawn from the dying pose's authored weapon
      // entry. If the kit has no `dying` palette ref for this facing, we drop
      // at the body's base position with no extra offset.
      const dyingEntry = resolvePoseWeaponEntry(
        kit.poses,
        'dying',
        facingLetter,
        kit.weaponPalette,
      );
      const sprW = kind.spriteSize?.w ?? kind.placeholderSize.w;
      const pxToWorld = sprW / SPRITE_CELL_PX;
      const offX = dyingEntry?.x ?? 0;
      const offY = dyingEntry?.y ?? 0;
      const baseX = e.posX[id]! + offX * pxToWorld;
      const baseY = e.posY[id]! + offY * pxToWorld;
      const px = baseX + world.rng.range(-0.6, 0.6);
      const py = baseY + world.rng.range(-0.6, 0.6);
      // Dropped weapons want body-like variety, biased to lie E-W: pick a
      // base of ±90° (sign 50/50) and add wide jitter. Ignores the dying
      // pose's authored rot since that just locks every musket to one angle.
      const wMag = world.rng.range(70, 110);
      const wSign = world.rng.range(0, 1) < 0.5 ? -1 : 1;
      const rot = (wSign * wMag * Math.PI) / 180;
      const flipX = dyingEntry?.flipX === true ? 1 : 0;
      spawnDroppedWeapon(d, px, py, rot, kindIdx, e.team[id]!, facing, flipX);

      // ~25% chance for infantry to also drop their shako. Mark the corpse as
      // "head lost" so sprite-pass swaps to the `--no-head` body variant —
      // otherwise we'd render both the hat on the body and a duplicate one on
      // the ground. Skip for cavalry/artillery: they don't carry shakos.
      if (kind.category === 'infantry' && kit.head && world.rng.range(0, 1) < 0.25) {
        e.partLost[id] |= PartLost.Head;
        // Spawn position: small radial offset so the hat lands nearby the corpse.
        const angle = world.rng.range(0, Math.PI * 2);
        const radius = world.rng.range(0.6, 1.5);
        const hpx = e.posX[id]! + Math.cos(angle) * radius;
        const hpy = e.posY[id]! + Math.sin(angle) * radius;
        // Hats land at any orientation — no E-W bias like muskets.
        const hrot = world.rng.range(-Math.PI, Math.PI);
        spawnDroppedHat(d, hpx, hpy, hrot, kindIdx, e.team[id]!, facing, 0);
      }

      e.weaponDropped[id] = 1;
    }
  };
}
