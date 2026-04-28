import type { Camera } from '../render/camera';
import { isDead } from '../sim/entities';
import type { World } from '../sim/world';
import { clamp } from '../util/math';

const SIZE = 180;
// Half-side of the per-unit stamp; r=1 paints a 3×3 square (matches the
// previous fillRect(x-1.5, y-1.5, 3, 3) behaviour).
const DOT_HALF = 1;
// Minimap target window is the viewport scaled by this; clamped to map bounds.
// Larger value = more context around the camera; viewport rect occupies ~1/SCALE of the minimap.
const WINDOW_SCALE = 4;

// Packed RGBA values, little-endian for Uint32 view (browsers are LE).
function packRgba(r: number, g: number, b: number, a: number): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
const TEAM_PACKED: readonly number[] = [
  packRgba(0x6e, 0xc1, 0xff, 0xff),
  packRgba(0xff, 0x6b, 0x6b, 0xff),
  packRgba(0x9b, 0xd7, 0x6b, 0xff),
  packRgba(0xe8, 0xc4, 0x6a, 0xff),
];
const NEUTRAL_PACKED = packRgba(0xaa, 0xaa, 0xaa, 0xff);
// Background tint — same translucent dark green as before (alpha 0.45).
const BG_PACKED = packRgba(40, 50, 40, 115);

interface MinimapWindow {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

function computeWindow(cam: Camera, mapSize: { w: number; h: number }): MinimapWindow {
  const viewW = cam.viewport.w / cam.zoom;
  const viewH = cam.viewport.h / cam.zoom;
  const w = Math.min(Math.max(viewW * WINDOW_SCALE, viewW), mapSize.w);
  const h = Math.min(Math.max(viewH * WINDOW_SCALE, viewH), mapSize.h);
  const minX = clamp(cam.center.x - w / 2, 0, mapSize.w - w);
  const minY = clamp(cam.center.y - h / 2, 0, mapSize.h - h);
  return { minX, minY, w, h };
}

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
  // Reused per frame: ImageData is the only fast path for 40k+ tiny rects.
  // 40k Canvas2D fillRect+fillStyle calls per frame stalls the main thread.
  const imageData = ctx.createImageData(SIZE, SIZE);
  const pixels32 = new Uint32Array(imageData.data.buffer);

  let panning = false;

  function panTo(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    const win = computeWindow(cam, mapSize);
    cam.center.x = clamp(win.minX + px * win.w, 0, mapSize.w);
    cam.center.y = clamp(win.minY + py * win.h, 0, mapSize.h);
  }

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
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
      const win = computeWindow(cam, mapSize);
      const sx = SIZE / win.w;
      const sy = SIZE / win.h;

      pixels32.fill(BG_PACKED);

      const e = world.entities;
      for (let n = 0; n < e.count; n++) {
        const id = e.aliveIds[n]!;
        if (isDead(e, id)) continue;
        const cx = ((e.posX[id]! - win.minX) * sx) | 0;
        const cy = ((e.posY[id]! - win.minY) * sy) | 0;
        if (cx + DOT_HALF < 0 || cx - DOT_HALF >= SIZE) continue;
        if (cy + DOT_HALF < 0 || cy - DOT_HALF >= SIZE) continue;
        const team = e.team[id]!;
        const packed = TEAM_PACKED[team] ?? NEUTRAL_PACKED;
        const x0 = cx - DOT_HALF < 0 ? 0 : cx - DOT_HALF;
        const x1 = cx + DOT_HALF > SIZE - 1 ? SIZE - 1 : cx + DOT_HALF;
        const y0 = cy - DOT_HALF < 0 ? 0 : cy - DOT_HALF;
        const y1 = cy + DOT_HALF > SIZE - 1 ? SIZE - 1 : cy + DOT_HALF;
        for (let y = y0; y <= y1; y++) {
          let p = y * SIZE + x0;
          for (let x = x0; x <= x1; x++) {
            pixels32[p++] = packed;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Camera viewport rectangle (clipped to the minimap).
      const halfW = (cam.viewport.w / cam.zoom) * 0.5;
      const halfH = (cam.viewport.h / cam.zoom) * 0.5;
      const x0 = clamp((cam.center.x - halfW - win.minX) * sx, 0, SIZE);
      const y0 = clamp((cam.center.y - halfH - win.minY) * sy, 0, SIZE);
      const x1 = clamp((cam.center.x + halfW - win.minX) * sx, 0, SIZE);
      const y1 = clamp((cam.center.y + halfH - win.minY) * sy, 0, SIZE);
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
