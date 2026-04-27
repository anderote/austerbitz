import { panel } from './overlay';
import type { World } from '../sim/world';
import type { ControlGroups } from '../input/selection';
import { drawUnitIconTo } from './unit-icons';

export interface ControlGroupsPanel {
  update(world: World, cg: ControlGroups): void;
}

interface CardEls {
  root: HTMLDivElement;
  num: HTMLSpanElement;
  icon: HTMLCanvasElement;
  count: HTMLSpanElement;
  iconKindIdx: number;
}

export function createControlGroupsPanel(root: HTMLElement): ControlGroupsPanel {
  const el = panel('control-groups');
  el.style.display = 'none';
  root.appendChild(el);

  // Pool of card elements indexed by group digit (0..9). Only non-empty groups
  // are revealed; the rest stay hidden. Each card owns its own canvas so the
  // icon doesn't get reparented when several groups share a unit kind.
  const cards: CardEls[] = Array.from({ length: 10 }, (_, digit) => {
    const card = document.createElement('div');
    card.className = 'cg-card';
    const num = document.createElement('span');
    num.className = 'cg-num';
    num.textContent = String(digit);
    const icon = document.createElement('canvas');
    icon.className = 'cg-icon';
    const count = document.createElement('span');
    count.className = 'cg-count';
    card.appendChild(num);
    card.appendChild(icon);
    card.appendChild(count);
    el.appendChild(card);
    return { root: card, num, icon, count, iconKindIdx: -1 };
  });

  return {
    update(world, cg) {
      const e = world.entities;
      let anyVisible = false;
      // Render slots 1..9 then 0 (Red Alert ordering puts 0 last visually).
      const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
      for (const digit of order) {
        const set = cg.groups[digit]!;
        const card = cards[digit]!;
        // Live count + most-numerous kind.
        const kindCounts = new Map<number, number>();
        let total = 0;
        for (const id of set) {
          if (e.alive[id] !== 1) continue;
          total++;
          const k = e.kindId[id]!;
          kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
        }
        if (total === 0) {
          card.root.style.display = 'none';
          continue;
        }
        let bestKind = -1;
        let bestN = -1;
        for (const [k, n] of kindCounts) {
          if (n > bestN) { bestN = n; bestKind = k; }
        }
        if (bestKind !== card.iconKindIdx) {
          drawUnitIconTo(card.icon, bestKind);
          card.iconKindIdx = bestKind;
        }
        card.count.textContent = `×${total}`;
        card.root.style.display = '';
        // Force order via flex order so 0 stays at the end.
        card.root.style.order = String(order.indexOf(digit));
        anyVisible = true;
      }
      el.style.display = anyVisible ? '' : 'none';
    },
  };
}
