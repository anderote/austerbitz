import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Selection } from '../input/selection';
import { getUnitKindByIndex } from '../data/units';
import { firstNameOf, lastNameOf, hometownOf } from '../data/name-bank';

export interface SelectionPanel {
  update(world: World, sel: Selection): void;
}

export function createSelectionPanel(root: HTMLElement): SelectionPanel {
  const el = panel('selection-panel');
  el.style.display = 'none';
  root.appendChild(el);

  const summaryEl = document.createElement('div');
  summaryEl.className = 'selection-summary';
  el.appendChild(summaryEl);

  const identityEl = document.createElement('div');
  identityEl.className = 'selection-identity';
  identityEl.style.display = 'none';
  const idHeaderEl = document.createElement('div');
  idHeaderEl.className = 'selection-identity-header';
  const idHometownEl = document.createElement('div');
  idHometownEl.className = 'selection-identity-hometown';
  const idStatsEl = document.createElement('div');
  idStatsEl.className = 'selection-identity-stats';
  identityEl.append(idHeaderEl, idHometownEl, idStatsEl);
  el.appendChild(identityEl);

  // Cache to avoid touching the DOM every frame when nothing changed.
  let lastSummary = '';
  let lastIdentityKey = '';

  return {
    update(world, sel) {
      if (sel.ids.size === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';

      // Summary line — counts by unit kind across all selected (alive) entities.
      const counts = new Map<string, number>();
      for (const id of sel.ids) {
        if (world.entities.alive[id] === 0) continue;
        const kind = getUnitKindByIndex(world.entities.kindId[id]!);
        counts.set(kind.name, (counts.get(kind.name) ?? 0) + 1);
      }
      const lines: string[] = [];
      for (const [name, n] of counts) lines.push(`${name} × ${n}`);
      const summary = lines.join('  ·  ');
      if (summary !== lastSummary) {
        summaryEl.textContent = summary;
        lastSummary = summary;
      }

      // Identity subsection — only for exactly one selected entity.
      if (sel.ids.size === 1) {
        const id = sel.ids.values().next().value as number;
        const e = world.entities;
        const themeId = e.themeId[id]!;
        const firstIdx = e.firstNameIdx[id]!;
        const lastIdx = e.lastNameIdx[id]!;
        const townIdx = e.hometownIdx[id]!;
        const age = e.ageYears[id]!;
        const kills = e.kills[id]!;
        const damage = e.damageDealt[id]!;

        // Cache key — covers identity (immutable post-spawn) plus mutable stats.
        const key = `${id}|${themeId}|${firstIdx}|${lastIdx}|${townIdx}|${age}|${kills}|${damage}`;
        if (key !== lastIdentityKey) {
          const fullName = `${firstNameOf(themeId, firstIdx)} ${lastNameOf(themeId, lastIdx)}`;
          const hometown = hometownOf(themeId, townIdx);
          idHeaderEl.textContent = `${fullName}, age ${age}`;
          idHometownEl.textContent = hometown;
          idStatsEl.textContent = `Kills: ${kills}   Damage: ${damage}`;
          lastIdentityKey = key;
        }
        identityEl.style.display = '';
      } else {
        if (lastIdentityKey !== '') {
          lastIdentityKey = '';
        }
        identityEl.style.display = 'none';
      }
    },
  };
}
