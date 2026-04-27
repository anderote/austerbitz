import type { Vec2 } from '../util/math';

export interface Camera {
  center: Vec2;          // world coords
  zoom: number;          // pixels per world unit
  viewport: { w: number; h: number }; // CSS pixels
}

export function createCamera(): Camera {
  return {
    center: { x: 0, y: 0 },
    zoom: 1,
    viewport: { w: 1, h: 1 },
  };
}

export function screenToWorld(cam: Camera, s: Vec2): Vec2 {
  return {
    x: cam.center.x + (s.x - cam.viewport.w / 2) / cam.zoom,
    y: cam.center.y + (s.y - cam.viewport.h / 2) / cam.zoom,
  };
}

export function worldToScreen(cam: Camera, w: Vec2): Vec2 {
  return {
    x: cam.viewport.w / 2 + (w.x - cam.center.x) * cam.zoom,
    y: cam.viewport.h / 2 + (w.y - cam.center.y) * cam.zoom,
  };
}

/**
 * Returns a 3x3 column-major matrix that maps world coordinates to clip space (-1..1).
 * Layout: [m00,m01,m02, m10,m11,m12, m20,m21,m22] passed as Float32Array(9).
 *
 * Y axis is flipped so increasing world-y maps to decreasing clip-y (i.e. screen-down).
 */
export function viewProjection(cam: Camera): Float32Array {
  const sx = (2 * cam.zoom) / cam.viewport.w;
  const sy = -(2 * cam.zoom) / cam.viewport.h;
  const tx = -cam.center.x * sx;
  const ty = -cam.center.y * sy;
  return new Float32Array([
    sx, 0,  0,
    0,  sy, 0,
    tx, ty, 1,
  ]);
}
