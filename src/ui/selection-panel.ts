import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Selection } from '../input/selection';
import { getUnitKindByIndex } from '../data/units';

export interface SelectionPanel {
  update(world: World, sel: Selection): void;
}

export function createSelectionPanel(root: HTMLElement): SelectionPanel {
  const el = panel('selection-panel');
  el.style.display = 'none';
  root.appendChild(el);
  return {
    update(world, sel) {
      if (sel.ids.size === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      const counts = new Map<string, number>();
      for (const id of sel.ids) {
        if (world.entities.alive[id] === 0) continue;
        const kind = getUnitKindByIndex(world.entities.kindId[id]!);
        counts.set(kind.name, (counts.get(kind.name) ?? 0) + 1);
      }
      const lines: string[] = [];
      for (const [name, n] of counts) lines.push(`${name} × ${n}`);
      el.textContent = lines.join('  ·  ');
    },
  };
}
