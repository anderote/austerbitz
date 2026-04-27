import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import { createSelectionPass } from './passes/selection-pass';
import { createParticlePass } from './passes/particle-pass';
import { createProjectilePass } from './passes/projectile-pass';
import { createHealthBarPass } from './passes/health-bar-pass';
import type { World } from '../sim/world';
import type { Selection, DragRect, FormationPreview } from '../input/selection';
import { ParticleClass, type Particles } from '../particles/particles';
import type { Projectiles } from '../sim/projectiles';

const DUST_MASK = 1 << ParticleClass.Dust;
const ABOVE_SOLDIER_MASK =
  (1 << ParticleClass.Smoke) |
  (1 << ParticleClass.Flash) |
  (1 << ParticleClass.Blood) |
  (1 << ParticleClass.Debris);

export interface RenderOptions {
  showHealthBars: boolean;
}

export interface Renderer {
  render(
    world: World,
    projectiles: Projectiles,
    particles: Particles,
    cam: Camera,
    sel: Selection,
    drag: DragRect,
    formation: FormationPreview | null,
    opts: RenderOptions,
  ): void;
  resize(): void;
}

export function createRenderer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  capacity: number,
  particleCapacity: number,
  projectileCapacity: number,
): Renderer {
  const terrain = createTerrainPass(gl);
  const sprites = createSpritePass(gl, capacity);
  const selectionPass = createSelectionPass(gl, capacity);
  const particlesPass = createParticlePass(gl, particleCapacity);
  const projectilesPass = createProjectilePass(gl, projectileCapacity * 2);
    // *2 because cannonballs contribute both a shadow AND a ball instance
  const healthBarPass = createHealthBarPass(gl, capacity);

  return {
    resize() {
      resizeToDisplay(gl, canvas);
    },
    render(world, projectiles, particlePool, cam, sel, drag, formation, opts) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
      selectionPass.drawDiscs(world, cam, sel, drag);
      // Ground-level dust draws before sprites so soldiers in front occlude it.
      particlesPass.draw(particlePool, cam, DUST_MASK);
      sprites.draw(world, cam);
      projectilesPass.draw(projectiles, cam);
      // Above-soldier FX (smoke, flash, blood, debris) draw on top of sprites.
      particlesPass.draw(particlePool, cam, ABOVE_SOLDIER_MASK);
      selectionPass.draw(world, cam, sel, drag, formation);
      if (opts.showHealthBars) healthBarPass.draw(world, cam);
    },
  };
}
