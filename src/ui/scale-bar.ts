import type { Camera } from '../render/camera';

const TARGET_PX = 150;
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

export interface ScaleBar {
  update(cam: Camera): void;
}

export function createScaleBar(root: HTMLElement): ScaleBar {
  const el = document.createElement('div');
  el.className = 'scale-bar';
  const bar = document.createElement('div');
  bar.className = 'bar';
  const label = document.createElement('div');
  label.className = 'label';
  el.appendChild(bar);
  el.appendChild(label);
  root.appendChild(el);

  return {
    update(cam) {
      const targetWorld = TARGET_PX / cam.zoom;
      let len = NICE[0]!;
      for (const c of NICE) if (c <= targetWorld) len = c;
      bar.style.width = `${len * cam.zoom}px`;
      label.textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
    },
  };
}
