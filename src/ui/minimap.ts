import type { Camera } from '../render/camera';
import type { World } from '../sim/world';
import { clamp } from '../util/math';

const SIZE = 180;
const TEAM_COLORS = ['#6ec1ff', '#ff6b6b', '#9bd76b', '#e8c46a'];
const NEUTRAL_COLOR = '#aaa';

export interface Minimap {
  update(world: World, cam: Camera): void;
  destroy(): void;
}

export function createMinimap(
  root: HTMLElement,
  mapSize: { w: number; h: number },
  cam: Camera,
): Minimap {
  const el = document.createElement('div');
  el.className = 'minimap';
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  el.appendChild(canvas);
  root.appendChild(el);

  const ctx = canvas.getContext('2d')!;
  let panning = false;

  function panTo(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    cam.center.x = clamp(px * mapSize.w, 0, mapSize.w);
    cam.center.y = clamp(py * mapSize.h, 0, mapSize.h);
  }

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    // Don't let world-selection see this click.
    e.stopPropagation();
    e.preventDefault();
    panning = true;
    panTo(e.clientX, e.clientY);
  };
  const onMove = (e: MouseEvent) => {
    if (panning) panTo(e.clientX, e.clientY);
  };
  const onUp = (e: MouseEvent) => {
    if (e.button === 0) panning = false;
  };

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  return {
    update(world, cam) {
      const sx = SIZE / mapSize.w;
      const sy = SIZE / mapSize.h;

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = 'rgba(40, 50, 40, 0.45)';
      ctx.fillRect(0, 0, SIZE, SIZE);

      const e = world.entities;
      const r = 1.5;
      for (let i = 0; i < e.capacity; i++) {
        if (e.alive[i] !== 1) continue;
        const team = e.team[i]!;
        ctx.fillStyle = TEAM_COLORS[team] ?? NEUTRAL_COLOR;
        const x = e.posX[i]! * sx;
        const y = e.posY[i]! * sy;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }

      // Camera viewport rectangle (clipped to the minimap).
      const halfW = (cam.viewport.w / cam.zoom) * 0.5;
      const halfH = (cam.viewport.h / cam.zoom) * 0.5;
      const x0 = clamp((cam.center.x - halfW) * sx, 0, SIZE);
      const y0 = clamp((cam.center.y - halfH) * sy, 0, SIZE);
      const x1 = clamp((cam.center.x + halfW) * sx, 0, SIZE);
      const y1 = clamp((cam.center.y + halfH) * sy, 0, SIZE);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.round(x0) + 0.5,
        Math.round(y0) + 0.5,
        Math.max(0, Math.round(x1 - x0) - 1),
        Math.max(0, Math.round(y1 - y0) - 1),
      );
    },
    destroy() {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.remove();
    },
  };
}
