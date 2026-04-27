import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import { createSelectionPass } from './passes/selection-pass';
import { createParticlePass } from './passes/particle-pass';
import { createProjectilePass } from './passes/projectile-pass';
import { createHealthBarPass } from './passes/health-bar-pass';
import { createBloodStainPass, type BloodStainPass } from './passes/blood-stain-pass';
import type { World } from '../sim/world';
import type { Selection, DragRect, FormationPreview } from '../input/selection';
import { ParticleClass, type Particles } from '../particles/particles';
import type { Projectiles } from '../sim/projectiles';

const ABOVE_SOLDIER_MASK =
  (1 << ParticleClass.Dust) |
  (1 << ParticleClass.Smoke) |
  (1 << ParticleClass.Flash) |
  (1 << ParticleClass.Blood) |
  (1 << ParticleClass.Debris);

export interface RenderOptions {
  showHealthBars: boolean;
  showMovePreview: boolean;
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
  bloodStain: BloodStainPass;
}

export function createRenderer(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  capacity: number,
  particleCapacity: number,
  projectileCapacity: number,
  worldW: number,
  worldH: number,
): Renderer {
  const terrain = createTerrainPass(gl);
  const bloodStain = createBloodStainPass(gl, worldW, worldH);
  terrain.setBlood(bloodStain.texture, worldW, worldH);
  const sprites = createSpritePass(gl, capacity);
  const selectionPass = createSelectionPass(gl, capacity);
  const particlesPass = createParticlePass(gl, particleCapacity);
  const projectilesPass = createProjectilePass(gl, projectileCapacity * 2);
    // *2 because cannonballs contribute both a shadow AND a ball instance
  const healthBarPass = createHealthBarPass(gl, capacity);

  return {
    bloodStain,
    resize() {
      resizeToDisplay(gl, canvas);
    },
    render(world, projectiles, particlePool, cam, sel, drag, formation, opts) {
      // Bake any queued blood splats into the persistent stain texture before
      // terrain samples it.
      bloodStain.flush();

      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
      selectionPass.drawDiscs(world, cam, sel, drag);
      sprites.draw(world, cam);
      projectilesPass.draw(projectiles, cam);
      // Particle FX draw on top of sprites so dust clouds aren't hidden behind soldiers.
      particlesPass.draw(particlePool, cam, ABOVE_SOLDIER_MASK);
      selectionPass.draw(world, cam, sel, drag, formation);
      if (opts.showMovePreview) selectionPass.drawMovePreview(world, cam, sel);
      if (opts.showHealthBars) healthBarPass.draw(world, cam);
    },
  };
}
