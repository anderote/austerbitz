import { loadImage, getRecoloredCanvas } from './image-cache';
import { paintWeaponInto, facingToSuffix, type WeaponOrientation } from './weapon-rendering';
import { applyEditsToContext, type PixelEdit } from './pixel-edits-overlay';
import type { Regiment } from './regiments';

export interface ComponentEntry {
  id: string;
  type: string;
  category: string;
  facings: string[];
  path: string;
}

export interface CellRenderInput {
  /** Layer ids in draw order (back-to-front). */
  layerIds: string[];
  /** Lookup: layer id → component entry. */
  components: ReadonlyMap<string, ComponentEntry>;
  /** Base URL for component PNGs (`/sprites/components/`). */
  componentBaseUrl: string;
  /** Optional regiment for recolor; null = raw colors. */
  regiment: Regiment | null;
  /** Optional weapon overlay drawn after layers. */
  weapon?: {
    layerPrefix: string;
    orientation: WeaponOrientation;
  };
  /**
   * Optional per-layer edits lookup. Called once per layer with the layer's
   * componentId; should return the edits to apply post-draw (or `[]` if none).
   * Edits are applied at native canvas pixel coordinates immediately after
   * the layer's PNG is drawn, mirroring the build's `applyEdits` step.
   */
  layerEdits?: (componentId: string) => readonly PixelEdit[];
}

/**
 * Paint one composited cell (background layers + optional weapon) into
 * `target`. Caller is responsible for `clearRect` if desired and for any
 * scaling — we always draw at native size into the (0, 0) origin.
 *
 * Token / cancellation is the caller's responsibility — pass `signal` and
 * we'll bail at await points if it's aborted.
 */
export async function renderCellInto(
  target: CanvasRenderingContext2D,
  input: CellRenderInput,
  signal?: AbortSignal,
): Promise<void> {
  for (const id of input.layerIds) {
    const entry = input.components.get(id);
    if (!entry) continue;
    const url = `${input.componentBaseUrl}${entry.path}`;
    try {
      if (input.regiment) {
        const recolored = await getRecoloredCanvas(url, input.regiment);
        if (signal?.aborted) return;
        target.drawImage(recolored, 0, 0);
        const edits = input.layerEdits?.(id) ?? [];
        if (edits.length > 0) {
          applyEditsToContext(target, edits);
        }
      } else {
        const image = await loadImage(url);
        if (signal?.aborted) return;
        target.drawImage(image, 0, 0);
        const edits = input.layerEdits?.(id) ?? [];
        if (edits.length > 0) {
          applyEditsToContext(target, edits);
        }
      }
    } catch (err) {
      console.warn('[cell-render]', err);
    }
  }
  if (input.weapon) {
    const { layerPrefix, orientation } = input.weapon;
    const weaponId = `${layerPrefix}-${facingToSuffix(orientation.src)}`;
    const weaponEntry = input.components.get(weaponId);
    if (weaponEntry) {
      const weaponUrl = `${input.componentBaseUrl}${weaponEntry.path}`;
      try {
        await paintWeaponInto(target, weaponUrl, orientation, { applyOffset: true });
        if (signal?.aborted) return;
      } catch (err) {
        console.warn('[cell-render][weapon]', err);
      }
    }
  }
}
