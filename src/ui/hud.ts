import { panel } from './overlay';
import type { World } from '../sim/world';

export interface Hud {
  update(fps: number, world: World, cursorMode: 'normal' | 'attack-move'): void;
}

export function createHud(root: HTMLElement): Hud {
  const el = panel('hud');
  root.appendChild(el);
  return {
    update(fps, world, cursorMode) {
      const mode = cursorMode === 'attack-move' ? '\nMODE   Attack-move' : '';
      el.textContent =
        `FPS    ${fps.toFixed(0).padStart(4)}\n` +
        `Units  ${world.entities.count.toString().padStart(4)}\n` +
        `Tick   ${world.tickCount}` +
        mode;
    },
  };
}
