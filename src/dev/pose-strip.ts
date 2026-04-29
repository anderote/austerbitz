import { renderCellInto, type ComponentEntry } from './cell-render';
import type { WeaponOrientation } from './weapon-rendering';
import type { PixelEdit } from './pixel-edits-overlay';
import type { Regiment } from './regiments';

export interface PoseStripPose {
  name: string;
  kitId: string;
  /** S-facing layer ids for this pose (frame 0 if animated). */
  sLayers: string[];
  /** Optional weapon overlay for the S-facing thumbnail. */
  weapon?: {
    layerPrefix: string;
    sOrientation?: WeaponOrientation;
  };
}

export interface PoseStripOptions {
  components: ReadonlyMap<string, ComponentEntry>;
  componentBaseUrl: string;
  getRegiment: () => Regiment | null;
  getLayerEdits: (kitId: string, pose: string, facing: string, componentId: string) => readonly PixelEdit[];
  onPick: (poseName: string) => void;
}

export function mountPoseStrip(opts: PoseStripOptions): {
  setPoses(poses: PoseStripPose[]): void;
  setActivePose(name: string): void;
  refresh(): void;
} {
  const strip = document.getElementById('pose-strip') as HTMLDivElement;

  let poses: PoseStripPose[] = [];
  let activeName = '';

  function render(): void {
    strip.innerHTML = '';
    for (const pose of poses) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'pose-strip-cell';
      if (pose.name === activeName) cell.classList.add('active');

      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 36;
      const cctx = c.getContext('2d', { alpha: true });
      if (cctx) {
        cctx.imageSmoothingEnabled = false;
        void renderCellInto(cctx, {
          layerIds: pose.sLayers,
          components: opts.components,
          componentBaseUrl: opts.componentBaseUrl,
          regiment: opts.getRegiment(),
          weapon: pose.weapon?.layerPrefix && pose.weapon.sOrientation
            ? { layerPrefix: pose.weapon.layerPrefix, orientation: pose.weapon.sOrientation }
            : undefined,
          layerEdits: (componentId) => opts.getLayerEdits(pose.kitId, pose.name, 'S', componentId),
        }).catch((err) => console.warn('[pose-strip]', err));
      }

      const label = document.createElement('span');
      label.className = 'pose-label';
      label.textContent = pose.name;

      cell.append(c, label);
      cell.addEventListener('click', () => opts.onPick(pose.name));
      strip.appendChild(cell);
    }
  }

  return {
    setPoses(list) { poses = list; render(); },
    setActivePose(name) { activeName = name; render(); },
    refresh() { render(); },
  };
}
