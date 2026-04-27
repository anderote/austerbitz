import type { Camera } from '../render/camera';
import { screenToWorld } from '../render/camera';
import type { InputManager } from './input-manager';
import { clamp } from '../util/math';

export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CameraControlsConfig {
  zoomMin: number;
  zoomMax: number;
  panKeySpeed: number;       // world units / second at zoom = 1
  sprintMultiplier: number;  // pan speed multiplier while Shift is held
  bounds?: CameraBounds;     // if set, clamps cam.center so the viewport stays inside
}

const DEFAULTS: CameraControlsConfig = {
  zoomMin: 0.5,
  zoomMax: 256,
  panKeySpeed: 600,
  sprintMultiplier: 2.5,
};

export interface CameraControls {
  update(dt: number): void;
}

export function createCameraControls(
  cam: Camera,
  input: InputManager,
  cfg: Partial<CameraControlsConfig> = {},
): CameraControls {
  const c = { ...DEFAULTS, ...cfg };
  let dragging = false;
  let dragLastX = 0;
  let dragLastY = 0;

  function clampCenter() {
    if (!c.bounds) return;
    const halfW = (cam.viewport.w / cam.zoom) * 0.5;
    const halfH = (cam.viewport.h / cam.zoom) * 0.5;
    const minX = c.bounds.minX + halfW;
    const maxX = c.bounds.maxX - halfW;
    const minY = c.bounds.minY + halfH;
    const maxY = c.bounds.maxY - halfH;
    // If the map is smaller than the viewport on an axis, lock to the map center.
    cam.center.x = minX > maxX
      ? (c.bounds.minX + c.bounds.maxX) * 0.5
      : clamp(cam.center.x, minX, maxX);
    cam.center.y = minY > maxY
      ? (c.bounds.minY + c.bounds.maxY) * 0.5
      : clamp(cam.center.y, minY, maxY);
  }

  return {
    update(dt) {
      // Zoom — anchor at cursor
      const wheel = input.state.consumedWheel;
      if (wheel !== 0) {
        const before = screenToWorld(cam, input.state.mouse);
        const factor = Math.pow(1.0015, -wheel);
        cam.zoom = clamp(cam.zoom * factor, c.zoomMin, c.zoomMax);
        const after = screenToWorld(cam, input.state.mouse);
        cam.center.x += before.x - after.x;
        cam.center.y += before.y - after.y;
      }

      // Middle-drag pan
      const middleDown = (input.state.mouse.buttons & (1 << 1)) !== 0;
      if (middleDown && !dragging) {
        dragging = true;
        dragLastX = input.state.mouse.x;
        dragLastY = input.state.mouse.y;
      } else if (!middleDown && dragging) {
        dragging = false;
      }
      if (dragging) {
        const dx = input.state.mouse.x - dragLastX;
        const dy = input.state.mouse.y - dragLastY;
        cam.center.x -= dx / cam.zoom;
        cam.center.y -= dy / cam.zoom;
        dragLastX = input.state.mouse.x;
        dragLastY = input.state.mouse.y;
      }

      // Keyboard pan — WASD or arrows; Shift = sprint.
      const k = input.state.keys;
      let kx = 0, ky = 0;
      if (k.has('ArrowLeft') || k.has('KeyA')) kx -= 1;
      if (k.has('ArrowRight') || k.has('KeyD')) kx += 1;
      if (k.has('ArrowUp') || k.has('KeyW')) ky -= 1;
      if (k.has('ArrowDown') || k.has('KeyS')) ky += 1;
      if (kx !== 0 || ky !== 0) {
        const sprint = (k.has('ShiftLeft') || k.has('ShiftRight')) ? c.sprintMultiplier : 1;
        const len = Math.hypot(kx, ky);
        const speed = (c.panKeySpeed * sprint * dt) / cam.zoom;
        cam.center.x += (kx / len) * speed;
        cam.center.y += (ky / len) * speed;
      }

      clampCenter();
    },
  };
}
