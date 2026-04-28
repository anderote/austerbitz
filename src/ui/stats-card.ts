import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Selection } from '../input/selection';
import { getUnitKindByIndex } from '../data/units';
import type { UnitKind } from '../data/types';
import { RANK_NAMES, RANK_THRESHOLDS, MAX_RANK } from '../sim/veterancy';

export interface StatsCard {
  update(world: World, sel: Selection): void;
}

interface KindAggregate {
  kind: UnitKind;
  count: number;
  hpCurr: number;
  hpMax: number;
  moraleSum: number;
  rankCounts: number[];
  /** Single-entity progression detail; populated only when count === 1. */
  soloRank?: number;
  soloXp?: number;
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
            rankCounts: [0, 0, 0, 0, 0],
          };
          groups.set(kIdx, g);
        }
        g.count++;
        g.hpCurr += world.entities.hp[id]!;
        g.hpMax += g.kind.baseStats.hp;
        g.moraleSum += world.entities.morale[id]!;
        g.rankCounts[world.entities.rank[id]!]!++;
        g.soloRank = world.entities.rank[id]!;
        g.soloXp = world.entities.xp[id]!;
      }
      if (groups.size === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.replaceChildren();
      const hist = renderHealthHistogram(world, sel);
      if (hist) el.appendChild(hist);
      for (const g of groups.values()) {
        el.appendChild(renderKindEntry(g));
      }
    },
  };
}

const HISTOGRAM_BINS = 10;

function renderHealthHistogram(world: World, sel: Selection): HTMLDivElement | null {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  let total = 0;
  for (const id of sel.ids) {
    if (world.entities.alive[id] === 0) continue;
    const kIdx = world.entities.kindId[id]!;
    const maxHp = getUnitKindByIndex(kIdx).baseStats.hp;
    if (maxHp <= 0) continue;
    const hp = world.entities.hp[id]!;
    const pct = Math.max(0, Math.min(1, hp / maxHp));
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(pct * HISTOGRAM_BINS));
    bins[bin]!++;
    total++;
  }
  if (total === 0) return null;
  const maxBin = Math.max(1, ...bins);
  const wrap = panel('stats-card-histogram');
  wrap.title = `Health distribution (${total})`;
  for (let i = 0; i < HISTOGRAM_BINS; i++) {
    const slot = document.createElement('div');
    slot.className = 'histogram-slot';
    const bar = document.createElement('div');
    bar.className = 'histogram-bar';
    const count = bins[i]!;
    bar.style.height = `${(count / maxBin) * 100}%`;
    const hue = Math.round((i / (HISTOGRAM_BINS - 1)) * 120);
    bar.style.background = `hsl(${hue}, 65%, 50%)`;
    slot.appendChild(bar);
    wrap.appendChild(slot);
  }
  return wrap;
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

  if (g.count === 1 && g.soloRank !== undefined && g.soloXp !== undefined) {
    card.appendChild(renderSoloRankRow(g.soloRank, g.soloXp));
  } else {
    const rankRow = renderRankMix(g.rankCounts);
    if (rankRow) card.appendChild(rankRow);
  }
  return card;
}

function renderSoloRankRow(rank: number, xp: number): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'stats-card-rankmix';
  const name = RANK_NAMES[rank]!;
  const xpLabel = rank >= MAX_RANK ? '—' : `${xp} / ${RANK_THRESHOLDS[rank]!}`;
  div.textContent = `Rank: ${name}  ·  XP ${xpLabel}`;
  return div;
}

function renderRankMix(rankCounts: number[]): HTMLDivElement | null {
  // Hide if everyone is Recruit (no advanced ranks at all).
  let advanced = 0;
  for (let r = 1; r < rankCounts.length; r++) advanced += rankCounts[r]!;
  if (advanced === 0) return null;

  const tags = ['Rec', 'Vet', 'Sgt', 'SgtMaj', 'Cpt'];
  const parts: string[] = [];
  for (let r = 0; r < rankCounts.length; r++) {
    if (rankCounts[r]! > 0) parts.push(`${rankCounts[r]} ${tags[r]}`);
  }
  const div = document.createElement('div');
  div.className = 'stats-card-rankmix';
  div.textContent = `Rank: ${parts.join(' · ')}`;
  return div;
}
