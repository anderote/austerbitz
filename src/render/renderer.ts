import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import { createSelectionPass } from './passes/selection-pass';
import { createParticlePass } from './passes/particle-pass';
import { createProjectilePass } from './passes/projectile-pass';
import { createHealthBarPass } from './passes/health-bar-pass';
import { createBloodStainPass, type BloodStainPass } from './passes/blood-stain-pass';
import { createPuffPass } from './passes/puff-pass';
import type { World } from '../sim/world';
import type { Selection, DragRect, FormationPreview } from '../input/selection';
import { ParticleClass, type Particles } from '../particles/particles';
import type { Projectiles } from '../sim/projectiles';
import type { Puffs } from '../puffs/puffs';
import { PLAYER_TEAM } from '../sim/player';
import type { PoseAtlas } from './poses/atlas';
import type { KitConfig } from './poses/kit-loader';

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
    puffs: Puffs,
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
  puffCapacity: number,
  projectileCapacity: number,
  worldW: number,
  worldH: number,
  poseAtlas: PoseAtlas | null,
  kits: ReadonlyMap<string, KitConfig> = new Map(),
): Renderer {
  const terrain = createTerrainPass(gl);
  const bloodStain = createBloodStainPass(gl, worldW, worldH);
  terrain.setBlood(bloodStain.texture, worldW, worldH);
  const sprites = createSpritePass(gl, capacity, poseAtlas, kits);
  const selectionPass = createSelectionPass(gl, capacity);
  const particlesPass = createParticlePass(gl, particleCapacity);
  const puffsPass = createPuffPass(gl, puffCapacity);
  const projectilesPass = createProjectilePass(gl, projectileCapacity * 2);
    // *2 because cannonballs contribute both a shadow AND a ball instance
  const healthBarPass = createHealthBarPass(gl, capacity);

  return {
    bloodStain,
    resize() {
      resizeToDisplay(gl, canvas);
    },
    render(world, projectiles, puffs, particlePool, cam, sel, drag, formation, opts) {
      // Bake any queued blood splats into the persistent stain texture before
      // terrain samples it.
      bloodStain.flush();

      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      terrain.draw(cam);
      if (opts.showMovePreview) {
        selectionPass.drawTeamRange(world, cam, sel, PLAYER_TEAM);
      }
      selectionPass.drawDiscs(world, cam, sel, drag);
      sprites.draw(world, cam);
      projectilesPass.draw(projectiles, cam);
      // Puffs first (under), sparks after (over).
      puffsPass.draw(puffs, cam);
      particlesPass.draw(particlePool, cam, ABOVE_SOLDIER_MASK);
      selectionPass.draw(world, cam, sel, drag, formation);
      if (opts.showMovePreview) selectionPass.drawMovePreview(world, cam, sel);
      if (opts.showHealthBars) healthBarPass.draw(world, cam);
    },
  };
}
