// Green terminal-style readout shown above the formation preview during a
// right-click drag. Lists each selected unit kind with its count, firing range,
// and shot type. DOM overlay; positions are recomputed each frame.
import type { Camera } from '../render/camera';
import { worldToScreen } from '../render/camera';
import type { World } from '../sim/world';
import type { Selection, FormationPreview } from '../input/selection';
import { getUnitKindByIndex } from '../data/units';

export interface PlacementInfo {
  update(world: World, cam: Camera, sel: Selection, preview: FormationPreview | null): void;
}

function shotLabel(weaponKind: string | undefined): string {
  if (!weaponKind) return 'MELEE';
  if (weaponKind === 'solid-shot') return 'SOLID SHOT';
  return weaponKind.toUpperCase();
}

export function createPlacementInfo(root: HTMLElement): PlacementInfo {
  const layer = document.createElement('div');
  layer.className = 'placement-info';
  root.appendChild(layer);

  const card = document.createElement('div');
  card.className = 'placement-info-card';
  card.style.display = 'none';
  layer.appendChild(card);

  const rangeLabel = document.createElement('div');
  rangeLabel.className = 'placement-range-label';
  rangeLabel.style.display = 'none';
  layer.appendChild(rangeLabel);

  return {
    update(world, cam, sel, preview) {
      if (!preview) {
        card.style.display = 'none';
        rangeLabel.style.display = 'none';
        return;
      }
      const e = world.entities;
      const counts = new Map<number, number>();
      let maxRange = 0;
      for (const id of sel.ids) {
        if (e.alive[id] !== 1) continue;
        const k = e.kindId[id]!;
        counts.set(k, (counts.get(k) ?? 0) + 1);
        const kind = getUnitKindByIndex(k);
        if (kind.weapon && kind.baseStats.weaponRange > maxRange) {
          maxRange = kind.baseStats.weaponRange;
        }
      }
      if (counts.size === 0) {
        card.style.display = 'none';
        rangeLabel.style.display = 'none';
        return;
      }

      const lines: string[] = [];
      const ordered = [...counts.entries()].sort((a, b) => a[0] - b[0]);
      for (const [k, n] of ordered) {
        const kind = getUnitKindByIndex(k);
        const range = kind.baseStats.weaponRange;
        const shot = shotLabel(kind.weapon?.kind);
        const name = kind.name.toUpperCase();
        lines.push(`> ${name} ×${n}`);
        lines.push(`  RNG ${range}m  SHOT ${shot}`);
      }
      card.textContent = lines.join('\n');

      // Anchor at the rect corner with the smallest screen-Y (topmost on screen)
      // and offset above. Keeps the readout visible regardless of drag direction.
      const corners = [preview.rect.tl, preview.rect.tr, preview.rect.br, preview.rect.bl];
      let bestX = 0, bestY = Infinity;
      for (const c of corners) {
        const s = worldToScreen(cam, c);
        if (s.y < bestY) { bestY = s.y; bestX = s.x; }
      }
      card.style.left = `${bestX}px`;
      card.style.top = `${bestY - 12}px`;
      card.style.display = '';

      // Range label: positioned at the end of the firing-range line
      // (front-edge midpoint + forward * maxRange). Mirrors the geometry
      // computed in selection-pass.ts so the label sits at the white tick.
      if (maxRange > 0) {
        const fdx = preview.rect.tl.x - preview.rect.bl.x;
        const fdy = preview.rect.tl.y - preview.rect.bl.y;
        const depth = Math.hypot(fdx, fdy);
        if (depth > 1e-6) {
          const ux = fdx / depth;
          const uy = fdy / depth;
          const frontMidX = (preview.rect.tl.x + preview.rect.tr.x) * 0.5;
          const frontMidY = (preview.rect.tl.y + preview.rect.tr.y) * 0.5;
          const endW = { x: frontMidX + ux * maxRange, y: frontMidY + uy * maxRange };
          const s = worldToScreen(cam, endW);
          rangeLabel.textContent = `${maxRange}m`;
          rangeLabel.style.left = `${s.x}px`;
          rangeLabel.style.top = `${s.y}px`;
          rangeLabel.style.display = '';
        } else {
          rangeLabel.style.display = 'none';
        }
      } else {
        rangeLabel.style.display = 'none';
      }
    },
  };
}
