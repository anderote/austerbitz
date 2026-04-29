import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Selection } from '../input/selection';
import { firstNameOf, lastNameOf, hometownOf } from '../data/name-bank';

export interface SelectionPanel {
  update(world: World, sel: Selection): void;
}

export function createSelectionPanel(root: HTMLElement): SelectionPanel {
  const el = panel('selection-panel');
  el.style.display = 'none';
  root.appendChild(el);

  const identityEl = document.createElement('div');
  identityEl.className = 'selection-identity';
  const idHeaderEl = document.createElement('div');
  idHeaderEl.className = 'selection-identity-header';
  const idHometownEl = document.createElement('div');
  idHometownEl.className = 'selection-identity-hometown';
  const idStatsEl = document.createElement('div');
  idStatsEl.className = 'selection-identity-stats';
  identityEl.append(idHeaderEl, idHometownEl, idStatsEl);
  el.appendChild(identityEl);

  let lastIdentityKey = '';

  return {
    update(world, sel) {
      // Identity card — only for exactly one selected entity. Otherwise hide.
      if (sel.ids.size !== 1) {
        if (el.style.display !== 'none') el.style.display = 'none';
        if (lastIdentityKey !== '') lastIdentityKey = '';
        return;
      }
      const id = sel.ids.values().next().value as number;
      const e = world.entities;
      if (e.alive[id] !== 1) {
        el.style.display = 'none';
        return;
      }
      const themeId = e.themeId[id]!;
      const firstIdx = e.firstNameIdx[id]!;
      const lastIdx = e.lastNameIdx[id]!;
      const townIdx = e.hometownIdx[id]!;
      const age = e.ageYears[id]!;
      const kills = e.kills[id]!;
      const damage = e.damageDealt[id]!;

      const key = `${id}|${themeId}|${firstIdx}|${lastIdx}|${townIdx}|${age}|${kills}|${damage}`;
      if (key !== lastIdentityKey) {
        const fullName = `${firstNameOf(themeId, firstIdx)} ${lastNameOf(themeId, lastIdx)}`;
        const hometown = hometownOf(themeId, townIdx);
        idHeaderEl.textContent = `${fullName}, age ${age}`;
        idHometownEl.textContent = hometown;
        idStatsEl.textContent = `Kills: ${kills}   Damage: ${damage}`;
        lastIdentityKey = key;
      }
      el.style.display = '';
    },
  };
}
