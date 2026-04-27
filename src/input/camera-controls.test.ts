import { describe, it, expect } from 'vitest';
import { createCamera, screenToWorld } from '../render/camera';
import { createCameraControls } from './camera-controls';
import type { InputManager } from './input-manager';

function fakeInput(): InputManager {
  return {
    state: {
      mouse: { x: 0, y: 0, buttons: 0 },
      wheelDelta: 0,
      keys: new Set(),
      consumedWheel: 0,
    },
    beginFrame() {
      this.state.consumedWheel = this.state.wheelDelta;
      this.state.wheelDelta = 0;
    },
    destroy() {},
  } as unknown as InputManager;
}

describe('camera-controls zoom anchoring', () => {
  it('keeps the world point under the cursor fixed during zoom', () => {
    const cam = createCamera();
    cam.viewport = { w: 1920, h: 1080 };
    cam.center = { x: 1000, y: 970 };
    cam.zoom = 4;

    const input = fakeInput();
    const controls = createCameraControls(cam, input, {
      bounds: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
    });

    // Mouse at (500, 500); user scrolls in.
    input.state.mouse.x = 500;
    input.state.mouse.y = 500;
    const worldBefore = screenToWorld(cam, input.state.mouse);
    input.state.consumedWheel = -100;

    controls.update(0.016);

    const worldAfter = screenToWorld(cam, input.state.mouse);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 3);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 3);
    // Sanity: zoom actually changed.
    expect(cam.zoom).toBeGreaterThan(4);
  });

  it('preserves anchor when cursor is at lower-left', () => {
    const cam = createCamera();
    cam.viewport = { w: 1920, h: 1080 };
    cam.center = { x: 1000, y: 970 };
    cam.zoom = 4;

    const input = fakeInput();
    const controls = createCameraControls(cam, input, {
      bounds: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
    });

    input.state.mouse.x = 0;
    input.state.mouse.y = 1080;
    const worldBefore = screenToWorld(cam, input.state.mouse);
    input.state.consumedWheel = -100;

    controls.update(0.016);

    const worldAfter = screenToWorld(cam, input.state.mouse);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 3);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 3);
  });
});
