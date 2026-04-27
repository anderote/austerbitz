import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Selection } from '../input/selection';
import { getUnitKindByIndex } from '../data/units';
import type { UnitKind } from '../data/types';

export interface StatsCard {
  update(world: World, sel: Selection): void;
}

interface KindAggregate {
  kind: UnitKind;
  count: number;
  hpCurr: number;
  hpMax: number;
  moraleSum: number;
}

export function createStatsCard(root: HTMLElement): StatsCard {
  const el = document.createElement('div');
  el.className = 'stats-card';
  el.style.display = 'none';
  root.appendChild(el);
  return {
    update(world, sel) {
      if (sel.ids.size === 0) {
        el.style.display = 'none';
        return;
      }
      const groups = new Map<number, KindAggregate>();
      for (const id of sel.ids) {
        if (world.entities.alive[id] === 0) continue;
        const kIdx = world.entities.kindId[id]!;
        let g = groups.get(kIdx);
        if (!g) {
          g = {
            kind: getUnitKindByIndex(kIdx),
            count: 0,
            hpCurr: 0,
            hpMax: 0,
            moraleSum: 0,
          };
          groups.set(kIdx, g);
        }
        g.count++;
        g.hpCurr += world.entities.hp[id]!;
        g.hpMax += g.kind.baseStats.hp;
        g.moraleSum += world.entities.morale[id]!;
      }
      if (groups.size === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.replaceChildren();
      for (const g of groups.values()) {
        el.appendChild(renderKindEntry(g));
      }
    },
  };
}

function renderKindEntry(g: KindAggregate): HTMLDivElement {
  const card = panel('stats-card-entry');

  const header = document.createElement('div');
  header.className = 'stats-card-header';
  header.textContent = g.count > 1 ? `${g.kind.name} × ${g.count}` : g.kind.name;
  card.appendChild(header);

  const hp = document.createElement('div');
  hp.className = 'stats-card-hp';
  hp.textContent = `HP  ${g.hpCurr} / ${g.hpMax}`;
  card.appendChild(hp);

  const grid = document.createElement('div');
  grid.className = 'stats-card-grid';
  const b = g.kind.baseStats;
  const moraleAvg = Math.round((g.moraleSum / g.count / 255) * 100);
  const rows: [string, string][] = [
    ['Speed', `${b.moveSpeed.toFixed(1)} m/s`],
    ['Range', `${b.weaponRange} m`],
    ['Damage', `${b.weaponDamage}`],
    ['Reload', `${b.weaponReload.toFixed(1)} s`],
    ['Accuracy', `${Math.round(b.weaponAccuracy * 100)}%`],
    ['Armor', `${b.armor}`],
    ['Sight', `${b.sightRange} m`],
    ['Morale', `${moraleAvg}%`],
  ];
  for (const [label, value] of rows) {
    const k = document.createElement('span');
    k.className = 'stats-card-key';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'stats-card-val';
    v.textContent = value;
    grid.appendChild(k);
    grid.appendChild(v);
  }
  card.appendChild(grid);
  return card;
}
