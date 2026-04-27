// Tiny "N" badges anchored at each selected unit's lower-right disc corner,
// shown when that unit belongs to a control group. Lowest group digit wins
// when a unit is in several. DOM overlay; positions are recomputed each frame.
import type { Camera } from '../render/camera';
import { worldToScreen } from '../render/camera';
import type { World } from '../sim/world';
import type { Selection, ControlGroups } from '../input/selection';
import { getUnitKindByIndex } from '../data/units';

export interface GroupBadges {
  update(world: World, cam: Camera, sel: Selection, cg: ControlGroups): void;
}

export function createGroupBadges(root: HTMLElement): GroupBadges {
  const layer = document.createElement('div');
  layer.className = 'group-badges';
  root.appendChild(layer);

  // Pool of reusable spans, grown on demand.
  const pool: HTMLSpanElement[] = [];
  function take(i: number): HTMLSpanElement {
    let el = pool[i];
    if (!el) {
      el = document.createElement('span');
      el.className = 'group-badge';
      layer.appendChild(el);
      pool[i] = el;
    }
    return el;
  }

  return {
    update(world, cam, sel, cg) {
      const e = world.entities;
      // Precompute id → lowest group digit (so we can skip non-grouped units cheaply).
      const idToDigit = new Map<number, number>();
      for (let d = 0; d < cg.groups.length; d++) {
        for (const id of cg.groups[d]!) {
          if (!idToDigit.has(id)) idToDigit.set(id, d);
        }
      }

      let n = 0;
      for (const id of sel.ids) {
        if (e.alive[id] !== 1) continue;
        const d = idToDigit.get(id);
        if (d === undefined) continue;
        const kind = getUnitKindByIndex(e.kindId[id]!);
        // Disc lower-right corner in world space (matches selection-pass.ts disc placement).
        const wx = e.posX[id]! + kind.placeholderSize.w * 0.625; // 1.25/2
        const wy = e.posY[id]! + kind.placeholderSize.h * 0.5
                 + kind.placeholderSize.w * 0.275;               // 0.55/2
        const s = worldToScreen(cam, { x: wx, y: wy });
        const el = take(n);
        el.textContent = String(d);
        el.style.left = `${s.x}px`;
        el.style.top = `${s.y}px`;
        el.style.display = '';
        n++;
      }
      // Hide the tail.
      for (let i = n; i < pool.length; i++) pool[i]!.style.display = 'none';
    },
  };
}
