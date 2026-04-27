import { describe, it, expect } from 'vitest';
import { createCamera, screenToWorld, worldToScreen } from './camera';

describe('Camera', () => {
  it('default camera centered at (0,0)', () => {
    const cam = createCamera();
    cam.center.x = 0;
    cam.center.y = 0;
    cam.zoom = 1;
    cam.viewport = { w: 800, h: 600 };
    const w = screenToWorld(cam, { x: 400, y: 300 });
    expect(w.x).toBeCloseTo(0, 5);
    expect(w.y).toBeCloseTo(0, 5);
  });

  it('screenToWorld and worldToScreen are inverses', () => {
    const cam = createCamera();
    cam.center.x = 100;
    cam.center.y = 50;
    cam.zoom = 2;
    cam.viewport = { w: 800, h: 600 };
    const screen = { x: 123, y: 456 };
    const world = screenToWorld(cam, screen);
    const back = worldToScreen(cam, world);
    expect(back.x).toBeCloseTo(123, 4);
    expect(back.y).toBeCloseTo(456, 4);
  });

  it('zoom scales screen-to-world distance', () => {
    const cam = createCamera();
    cam.center.x = 0;
    cam.center.y = 0;
    cam.zoom = 2; // 2 px per world meter
    cam.viewport = { w: 800, h: 600 };
    // 100 px to the right of center should be 50 world meters at zoom=2
    const w = screenToWorld(cam, { x: 500, y: 300 });
    expect(w.x).toBeCloseTo(50, 5);
    expect(w.y).toBeCloseTo(0, 5);
  });

  it('y axis: screen-down is world-down (y increases downward in world space)', () => {
    const cam = createCamera();
    cam.center.x = 0;
    cam.center.y = 0;
    cam.zoom = 1;
    cam.viewport = { w: 800, h: 600 };
    const w = screenToWorld(cam, { x: 400, y: 400 });
    expect(w.y).toBeCloseTo(100, 5);
  });
});
