import { panel } from './overlay';
import type { Selection } from '../input/selection';
import {
  type FormationParams, SPACING_STEPS,
} from '../input/formation-params';

export type StanceSummary =
  | { kind: 'uniform'; stance: number }
  | { kind: 'mixed' }
  | { kind: 'none' };

export interface FormationControlsPanel {
  update(sel: Selection, params: FormationParams, stance: StanceSummary): void;
}

export function createFormationControlsPanel(root: HTMLElement): FormationControlsPanel {
  const el = panel('formation-controls');
  el.style.display = 'none';
  root.appendChild(el);

  const spacingRow = document.createElement('div');
  spacingRow.className = 'fc-row';
  const spacingKey = document.createElement('span'); spacingKey.className = 'fc-key'; spacingKey.textContent = '[ ]';
  const spacingLabel = document.createElement('span'); spacingLabel.className = 'fc-label'; spacingLabel.textContent = 'Spacing';
  const spacingVal = document.createElement('span'); spacingVal.className = 'fc-val';
  spacingRow.append(spacingKey, spacingLabel, spacingVal);

  const ranksRow = document.createElement('div');
  ranksRow.className = 'fc-row';
  const ranksKey = document.createElement('span'); ranksKey.className = 'fc-key'; ranksKey.textContent = ', .';
  const ranksLabel = document.createElement('span'); ranksLabel.className = 'fc-label'; ranksLabel.textContent = 'Ranks';
  const ranksVal = document.createElement('span'); ranksVal.className = 'fc-val';
  ranksRow.append(ranksKey, ranksLabel, ranksVal);

  const stanceRow = document.createElement('div');
  stanceRow.className = 'fc-row';
  const stanceKey = document.createElement('span'); stanceKey.className = 'fc-key'; stanceKey.textContent = 'ZXCV';
  const stanceLabel = document.createElement('span'); stanceLabel.className = 'fc-label'; stanceLabel.textContent = 'Stance';
  const stanceVal = document.createElement('span'); stanceVal.className = 'fc-val';
  stanceRow.append(stanceKey, stanceLabel, stanceVal);

  el.append(spacingRow, ranksRow, stanceRow);

  const STANCE_NAMES = ['Fire at Will', 'Volley', 'By Ranks', 'Hold'];
  let lastSpacing = -1;
  let lastRanks: number | null | undefined = undefined;
  let lastStanceText: string | undefined = undefined;

  return {
    update(sel, params, stance) {
      if (sel.ids.size === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      if (params.spacingIndex !== lastSpacing) {
        spacingVal.textContent = `${SPACING_STEPS[params.spacingIndex]!.mult.toFixed(2)}× ${SPACING_STEPS[params.spacingIndex]!.label}`;
        lastSpacing = params.spacingIndex;
      }
      if (params.ranks !== lastRanks) {
        ranksVal.textContent = params.ranks == null ? 'auto' : String(params.ranks);
        lastRanks = params.ranks;
      }
      const text = stance.kind === 'uniform'
        ? STANCE_NAMES[stance.stance] ?? '?'
        : stance.kind === 'mixed' ? 'Mixed' : '—';
      if (text !== lastStanceText) {
        stanceVal.textContent = text;
        lastStanceText = text;
      }
    },
  };
}
