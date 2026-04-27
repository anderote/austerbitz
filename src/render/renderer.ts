import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import { createSelectionPass } from './passes/selection-pass';
import { createParticlePass } from './passes/particle-pass';
import type { World } from '../sim/world';
import type { Selection, DragRect } from '../input/selection';
import type { Particles } from '../particles/particles';

export interface Renderer {
  render(world: World, particles: Particles, cam: Camera, sel: Selection, drag: DragRect): void;
  resize(): void;
}

export function createRenderer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  capacity: number,
  particleCapacity: number,
): Renderer {
  const terrain = createTerrainPass(gl);
  const sprites = createSpritePass(gl, capacity);
  const selectionPass = createSelectionPass(gl, capacity);
  const particles = createParticlePass(gl, particleCapacity);

  return {
    resize() {
      resizeToDisplay(gl, canvas);
    },
    render(world, particlePool, cam, sel, drag) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
      selectionPass.drawDiscs(world, cam, sel, drag);
      sprites.draw(world, cam);
      particles.draw(particlePool, cam);
      selectionPass.draw(world, cam, sel, drag);
    },
  };
}
