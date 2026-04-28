import type { System } from '../world';
import { EntityState } from '../entities';
import { spawnDroppedWeapon } from '../dropped-items';
import { getUnitKindByIndex } from '../../data/units';
import { resolveWeaponPoseTransform, type Facing } from '../../render/poses/resolver';
import type { KitConfig } from '../../render/poses/kit-loader';

// Mirrors sprite-pass.ts's RUNTIME_FACING_TO_LETTER: runtime facing 0..7 =
// E, SE, S, SW, W, NW, N, NE. Used to look up the per-pose weapon offset.
const RUNTIME_FACING_TO_LETTER: Facing[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

const SPRITE_CELL_PX = 32;

export function createDeathDropsSystem(kits: ReadonlyMap<string, KitConfig>): System {
  return (world, _dt) => {
    const e = world.entities;
    const d = world.droppedItems;
    for (let n = 0; n < e.count; n++) {
      const id = e.aliveIds[n]!;
      if (e.weaponDropped[id]) continue;
      const s = e.state[id]!;
      if (s !== EntityState.Dying && s !== EntityState.Dead) continue;
      const kindIdx = e.kindId[id]!;
      const kind = getUnitKindByIndex(kindIdx);
      const kit = kits.get(kind.id);
      if (!kit || !kit.weapon) {
        // Nothing to drop; mark so we don't re-check this entity every tick.
        e.weaponDropped[id] = 1;
        continue;
      }
      const facing = e.facing[id]!;
      const facingLetter = RUNTIME_FACING_TO_LETTER[facing]!;
      const offset = resolveWeaponPoseTransform(kit.poses, 'dying', facingLetter, kit.weapon);
      const sprW = kind.spriteSize?.w ?? kind.placeholderSize.w;
      const pxToWorld = sprW / SPRITE_CELL_PX;
      const baseX = e.posX[id]! + offset.x * pxToWorld;
      const baseY = e.posY[id]! + offset.y * pxToWorld;
      const px = baseX + world.rng.range(-0.4, 0.4);
      const py = baseY + world.rng.range(-0.4, 0.4);
      const baseRot = (offset.rot * Math.PI) / 180;
      const jitter = (world.rng.range(-25, 25) * Math.PI) / 180;
      const rot = baseRot + jitter;
      const flipX = offset.flipX === true ? 1 : 0;
      spawnDroppedWeapon(d, px, py, rot, kindIdx, e.team[id]!, facing, flipX);
      e.weaponDropped[id] = 1;
    }
  };
}
