import { resizeToDisplay } from '../gl/context';
import type { Camera } from './camera';
import { createTerrainPass } from './passes/terrain-pass';
import { createSpritePass } from './passes/sprite-pass';
import { createDroppedItemsPass } from './passes/dropped-items-pass';
import { createSelectionPass } from './passes/selection-pass';
import { createParticlePass } from './passes/particle-pass';
import { createRingPass, type RingPass } from './passes/ring-pass';
import { createProjectilePass } from './passes/projectile-pass';
import { createHealthBarPass } from './passes/health-bar-pass';
import { createBloodStainPass, type BloodStainPass } from './passes/blood-stain-pass';
import { createCraterStainPass, type CraterStainPass } from './passes/crater-stain-pass';
import { createPuffPass } from './passes/puff-pass';
import { createDebrisPass } from './passes/debris-pass';
import { createGrassTuftsPass, type GrassTuftsPass } from './passes/grass-tufts-pass';
import { createTreesPass, type TreesPass } from './passes/trees-pass';
import type { WorldMap } from '../map/world-map';
import type { World } from '../sim/world';
import type { Selection, DragRect, FormationPreview } from '../input/selection';
import { ParticleClass, type Particles } from '../particles/particles';
import type { Projectiles } from '../sim/projectiles';
import type { Puffs } from '../puffs/puffs';
import { PLAYER_TEAM } from '../sim/player';
import type { PoseAtlas } from './poses/atlas';
import type { KitConfig } from './poses/kit-loader';
import type { DebrisAtlas } from './debris-atlas';
import type { KitGibTable } from '../sim/kit-gib-table';
import { createCameraShake, kickShake, advanceShake, currentOffset } from './camera-shake';
import { clearShakeRequests } from '../sim/shake-requests';
import { clearCraterSplats } from '../sim/crater-splats';
import { createRng } from '../util/rng';
import { profiler } from '../dev/profiler';

const ABOVE_SOLDIER_MASK =
  (1 << ParticleClass.Dust) |
  (1 << ParticleClass.Smoke) |
  (1 << ParticleClass.Flash) |
  (1 << ParticleClass.Blood) |
  (1 << ParticleClass.Debris) |
  (1 << ParticleClass.Ember);
  // Ring is intentionally excluded — the dedicated ring-pass renders it as an annulus.

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
    dt: number,
  ): void;
  resize(): void;
  bloodStain: BloodStainPass;
  craterStain: CraterStainPass;
  ringPass: RingPass;
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
  debrisCapacity = 8192,
  map: WorldMap | null = null,
  kitGibTable: KitGibTable | null = null,
): Renderer {
  const terrain = createTerrainPass(gl);
  const bloodStain = createBloodStainPass(gl, worldW, worldH);
  terrain.setBlood(bloodStain.texture, worldW, worldH);
  const craterStain = createCraterStainPass(gl, worldW, worldH);
  terrain.setCrater(craterStain.texture, worldW, worldH);
  const sprites = createSpritePass(gl, capacity, poseAtlas, kits, worldH);
  const droppedItems = createDroppedItemsPass(
    gl,
    capacity,
    kits,
    sprites.getAtlas(),
    sprites.getWeaponUvByPrefix(),
    sprites.getHeadUvByPrefix(),
  );
  const selectionPass = createSelectionPass(gl, capacity);
  const particlesPass = createParticlePass(gl, particleCapacity);
  const ringPass = createRingPass(gl, particleCapacity);
  const puffsPass = createPuffPass(gl, puffCapacity);
  const projectilesPass = createProjectilePass(gl, projectileCapacity * 2);
    // *2 because cannonballs contribute both a shadow AND a ball instance
  const debrisPass = debrisAtlas
    ? createDebrisPass(
        gl,
        debrisCapacity,
        sprites.getAtlas(),
        kits,
        kitGibTable,
        sprites.getWeaponUvByPrefix(),
        sprites.getHeadUvByPrefix(),
      )
    : null;
  const grassTuftsPass: GrassTuftsPass | null = map ? createGrassTuftsPass(gl, map) : null;
  const treesPass: TreesPass | null = map ? createTreesPass(gl, map) : null;
  const healthBarPass = createHealthBarPass(gl, capacity);

  // Camera shake state — owned by the renderer, invisible to the sim.
  const cameraShake = createCameraShake();
  // Dedicated RNG for shake jitter; seeded arbitrarily since visual noise has
  // no gameplay consequence. Kept separate from world.rng to avoid coupling
  // render timing to sim determinism.
  const shakeRng = createRng(0xdead_beef);

  // Set the depth comparison once. Individual passes flip DEPTH_TEST and the
  // depth mask on/off; default state is OFF so existing passes keep behaving
  // exactly as before.
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);

  return {
    bloodStain,
    craterStain,
    ringPass,
    resize() {
      resizeToDisplay(gl, canvas);
    },
    replaceSpriteAtlas(image) {
      sprites.replaceAtlasTexture(image);
    },
    render(world, projectiles, puffs, particlePool, cam, sel, drag, formation, opts, frameDt) {
      // Drain camera-shake requests from the sim. Attenuate by camera distance
      // (30 m reference distance) so far-away explosions cause less shake.
      const sr = world.shakeRequests;
      for (let i = 0; i < sr.count; i++) {
        const dist = Math.hypot(cam.center.x - sr.x[i]!, cam.center.y - sr.y[i]!);
        const attenuatedMag = sr.magnitude[i]! / Math.max(1, dist / 30);
        kickShake(cameraShake, attenuatedMag, sr.duration[i]!);
      }
      clearShakeRequests(sr);

      // Apply jitter to camera center for this frame only — revert after drawing.
      const off = currentOffset(cameraShake, shakeRng);
      cam.center.x += off.x;
      cam.center.y += off.y;

      // Bake any queued blood splats into the persistent stain texture before
      // terrain samples it.
      profiler.begin('render/blood-flush');
      bloodStain.flush();
      profiler.end('render/blood-flush');

      // Bake any queued crater splats into the persistent stain texture.
      profiler.begin('render/crater-flush');
      for (let i = 0; i < world.craterSplats.count; i++) {
        craterStain.splat(
          world.craterSplats.posX[i]!,
          world.craterSplats.posY[i]!,
          world.craterSplats.radius[i]!,
          world.craterSplats.intensity[i]!,
        );
      }
      clearCraterSplats(world.craterSplats);
      craterStain.flush();
      profiler.end('render/crater-flush');

      gl.clearColor(0, 0, 0, 1);
      gl.depthMask(true);                                       // allow depth clear
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.depthMask(false);
      profiler.begin('render/terrain'); terrain.draw(cam); profiler.end('render/terrain');
      if (grassTuftsPass) { profiler.begin('render/grass'); grassTuftsPass.draw(cam); profiler.end('render/grass'); }
      if (opts.showMovePreview) {
        profiler.begin('render/team-range');
        selectionPass.drawTeamRange(world, cam, sel, PLAYER_TEAM);
        profiler.end('render/team-range');
      }
      profiler.begin('render/sel-discs'); selectionPass.drawDiscs(world, cam, sel, drag); profiler.end('render/sel-discs');
      profiler.begin('render/dropped-items'); droppedItems.draw(world, cam); profiler.end('render/dropped-items');
      profiler.begin('render/sprites'); sprites.draw(world, cam); profiler.end('render/sprites');
      if (treesPass) { profiler.begin('render/trees'); treesPass.draw(cam); profiler.end('render/trees'); }
      // Gib chunks: drawn after bodies (so they overlay the soldier they came
      // from) but before projectiles/puffs/particles (which are above-soldier
      // FX). Health bars are still on top.
      if (debrisPass && debrisAtlas) {
        profiler.begin('render/debris');
        debrisPass.draw(world.debris, debrisAtlas, cam, GIB_WORLD_UNITS_PER_PIXEL);
        profiler.end('render/debris');
      }
      profiler.begin('render/projectiles'); projectilesPass.draw(projectiles, cam); profiler.end('render/projectiles');
      // Puffs first (under), sparks after (over).
      profiler.begin('render/puffs'); puffsPass.draw(puffs, cam); profiler.end('render/puffs');
      profiler.begin('render/particles'); particlesPass.draw(particlePool, cam, ABOVE_SOLDIER_MASK); profiler.end('render/particles');
      profiler.begin('render/rings'); ringPass.draw(particlePool, cam); profiler.end('render/rings');
      profiler.begin('render/selection'); selectionPass.draw(world, cam, sel, drag, formation); profiler.end('render/selection');
      if (opts.showMovePreview) {
        profiler.begin('render/move-preview');
        selectionPass.drawMovePreview(world, cam, sel);
        profiler.end('render/move-preview');
      }
      if (opts.showHealthBars) {
        profiler.begin('render/health-bars');
        healthBarPass.draw(world, cam);
        profiler.end('render/health-bars');
      }

      // Revert the per-frame jitter so the persistent camera state is unshaken.
      cam.center.x -= off.x;
      cam.center.y -= off.y;

      // Advance the shake decay timer at the end of the frame (after all draws).
      advanceShake(cameraShake, frameDt);
    },
  };
}
