import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import { createDroppedItemsPass } from './passes/dropped-items-pass';
import { createSelectionPass } from './passes/selection-pass';
import { createParticlePass } from './passes/particle-pass';
import { createProjectilePass } from './passes/projectile-pass';
import { createHealthBarPass } from './passes/health-bar-pass';
import { createBloodStainPass, type BloodStainPass } from './passes/blood-stain-pass';
import { createPuffPass } from './passes/puff-pass';
import { createDebrisPass } from './passes/debris-pass';
import type { World } from '../sim/world';
import type { Selection, DragRect, FormationPreview } from '../input/selection';
import { ParticleClass, type Particles } from '../particles/particles';
import type { Projectiles } from '../sim/projectiles';
import type { Puffs } from '../puffs/puffs';
import { PLAYER_TEAM } from '../sim/player';
import type { PoseAtlas } from './poses/atlas';
import type { KitConfig } from './poses/kit-loader';
import type { DebrisAtlas } from './debris-atlas';

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
  /**
   * Swap the sprite-pass atlas texture mid-session. Used by the dev-mode
   * live-reload watcher; production builds never call this.
   */
  replaceSpriteAtlas(image: ImageBitmap | ImageData | HTMLCanvasElement): void;
}

// Match the soldier sprite scale: line-infantry sprites are 2.0 world units
// wide for a 32-pixel cell. Gibs are 8 pixels per chunk, so the world size
// per chunk pixel equals the unit pxToWorld ratio (sprW / SPRITE_CELL_PX),
// keeping chunks consistent with the bodies they came from.
const GIB_WORLD_UNITS_PER_PIXEL = 2.0 / 32;

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
  debrisAtlas: DebrisAtlas | null = null,
  debrisCapacity = 256,
): Renderer {
  const terrain = createTerrainPass(gl);
  const bloodStain = createBloodStainPass(gl, worldW, worldH);
  terrain.setBlood(bloodStain.texture, worldW, worldH);
  const sprites = createSpritePass(gl, capacity, poseAtlas, kits);
  const droppedItems = createDroppedItemsPass(
    gl,
    capacity,
    kits,
    sprites.getAtlas(),
    sprites.getWeaponUvByPrefix(),
  );
  const selectionPass = createSelectionPass(gl, capacity);
  const particlesPass = createParticlePass(gl, particleCapacity);
  const puffsPass = createPuffPass(gl, puffCapacity);
  const projectilesPass = createProjectilePass(gl, projectileCapacity * 2);
    // *2 because cannonballs contribute both a shadow AND a ball instance
  const debrisPass = debrisAtlas ? createDebrisPass(gl, debrisCapacity) : null;
  const healthBarPass = createHealthBarPass(gl, capacity);

  return {
    bloodStain,
    resize() {
      resizeToDisplay(gl, canvas);
    },
    replaceSpriteAtlas(image) {
      sprites.replaceAtlasTexture(image);
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
      droppedItems.draw(world, cam);
      sprites.draw(world, cam);
      // Gib chunks: drawn after bodies (so they overlay the soldier they came
      // from) but before projectiles/puffs/particles (which are above-soldier
      // FX). Health bars are still on top.
      if (debrisPass && debrisAtlas) {
        debrisPass.draw(world.debris, debrisAtlas, cam, GIB_WORLD_UNITS_PER_PIXEL);
      }
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
