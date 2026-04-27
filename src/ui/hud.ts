import { panel } from './overlay';
import type { World } from '../sim/world';
import type { Camera } from '../render/camera';
import type { InputManager } from '../input/input-manager';
import { screenToWorld } from '../render/camera';

export interface Hud {
  update(fps: number, world: World, cam: Camera, input: InputManager): void;
}

export function createHud(root: HTMLElement): Hud {
  const el = panel('hud');
  root.appendChild(el);
  return {
    update(fps, world, cam, input) {
      const m = input.state.mouse;
      const w = screenToWorld(cam, m);
      el.textContent =
        `FPS    ${fps.toFixed(0).padStart(4)}\n` +
        `Units  ${world.entities.count.toString().padStart(4)}\n` +
        `Tick   ${world.tickCount}\n` +
        `Mouse  ${m.x.toFixed(0)}, ${m.y.toFixed(0)}\n` +
        `World  ${w.x.toFixed(0)}, ${w.y.toFixed(0)}\n` +
        `Zoom   ${cam.zoom.toFixed(2)}`;
    },
  };
}
