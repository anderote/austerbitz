// Transient yellow→white "ghost" markers shown at each unit's destination
// after a click-move. Each marker tracks its world position (so it stays
// anchored as the camera pans) and fades from yellow to white over its
// lifetime, then disappears. DOM overlay; pooled implicitly via remove().
import type { Camera } from '../render/camera';
import { worldToScreen } from '../render/camera';
import type { Vec2 } from '../util/math';

const DURATION_S = 2.0;

interface Marker {
  x: number;
  y: number;
  t0: number;
  el: HTMLElement;
}

export interface MovePreview {
  add(targets: Vec2[]): void;
  update(cam: Camera): void;
}

export function createMovePreview(root: HTMLElement): MovePreview {
  const layer = document.createElement('div');
  layer.className = 'move-preview';
  root.appendChild(layer);
  const markers: Marker[] = [];

  return {
    add(targets) {
      const t0 = performance.now() / 1000;
      for (const p of targets) {
        const el = document.createElement('div');
        el.className = 'move-preview-dot';
        layer.appendChild(el);
        markers.push({ x: p.x, y: p.y, t0, el });
      }
    },
    update(cam) {
      const now = performance.now() / 1000;
      for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i]!;
        const age = now - m.t0;
        if (age >= DURATION_S) {
          m.el.remove();
          markers.splice(i, 1);
          continue;
        }
        const u = age / DURATION_S;
        // Yellow #ffd84a → white #ffffff over the lifetime.
        const r = 255;
        const g = Math.round(216 + (255 - 216) * u);
        const b = Math.round(74 + (255 - 74) * u);
        // Hold full opacity for the first 60%, then fade out.
        const alpha = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
        const s = worldToScreen(cam, { x: m.x, y: m.y });
        m.el.style.left = `${s.x}px`;
        m.el.style.top = `${s.y}px`;
        m.el.style.background = `rgba(${r},${g},${b},${alpha})`;
        m.el.style.boxShadow = `0 0 6px rgba(${r},${g},${b},${alpha * 0.85})`;
      }
    },
  };
}
