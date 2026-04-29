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
import { createCameraShake, kickShake, advanceShake, currentOffset } from './camera-shake';
import { clearShakeRequests } from '../sim/shake-requests';
import { clearCraterSplats } from '../sim/crater-splats';
import { createRng } from '../util/rng';
import { createTrajectoryPreviewPass, type TrajectoryPreviewPass } from './passes/trajectory-preview-pass';
import { cannon12Solid } from '../data/weapons/cannon-12-solid';
import { cannon12Shell } from '../data/weapons/cannon-12-shell';
import { barrelTip } from '../fx/barrel';
import { getUnitKindByIndex } from '../data/units';

const GAME_GRAVITY = 18;
const MAX_TRAJ_VERTS = 8192;
const trajectoryScratchPos = new Float32Array(MAX_TRAJ_VERTS * 2);
const trajectoryScratchCol = new Float32Array(MAX_TRAJ_VERTS * 3);

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
  trajectoryPreview: TrajectoryPreviewPass;
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
  const debrisPass = debrisAtlas ? createDebrisPass(gl, debrisCapacity) : null;
  const grassTuftsPass: GrassTuftsPass | null = map ? createGrassTuftsPass(gl, map) : null;
  const treesPass: TreesPass | null = map ? createTreesPass(gl, map) : null;
  const healthBarPass = createHealthBarPass(gl, capacity);
  const trajectoryPreviewPass = createTrajectoryPreviewPass(gl);

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
    trajectoryPreview: trajectoryPreviewPass,
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
      bloodStain.flush();

      // Bake any queued crater splats into the persistent stain texture.
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

      gl.clearColor(0, 0, 0, 1);
      gl.depthMask(true);                                       // allow depth clear
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.depthMask(false);
      terrain.draw(cam);
      if (grassTuftsPass) grassTuftsPass.draw(cam);
      if (opts.showMovePreview) {
        selectionPass.drawTeamRange(world, cam, sel, PLAYER_TEAM);
      }
      selectionPass.drawDiscs(world, cam, sel, drag);
      droppedItems.draw(world, cam);
      sprites.draw(world, cam);
      if (treesPass) treesPass.draw(cam);
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
      ringPass.draw(particlePool, cam);

      // Trajectory preview for selected cannons (white dashed arc, no canister)
      {
        const e = world.entities;
        let v = 0;
        const DASH = 0.6, GAP = 0.6, STEP = DASH + GAP;
        for (const id of sel.ids) {
          if (e.alive[id] !== 1) continue;
          const kind = getUnitKindByIndex(e.kindId[id]!);
          if (kind.category !== 'artillery') continue;
          const ammo = e.cannonAmmo[id]!;
          if (ammo === 2) continue; // canister: no preview
          const profile = ammo === 0 ? cannon12Solid : cannon12Shell;
          const tip = barrelTip(e, id);
          const launchH = profile.projectile.launchHeight ?? 0;
          const muz = profile.projectile.muzzleVelocity;
          const aim = e.cannonElevationDeg[id]!;
          const elev = aim * Math.PI / 180;
          const vh = muz * Math.cos(elev);
          const vv = muz * Math.sin(elev);
          const tof = (vv + Math.sqrt(vv * vv + 2 * GAME_GRAVITY * launchH)) / GAME_GRAVITY;
          const range = vh * tof;
          if (range <= 0) continue;
          for (let s = 0; s + DASH <= range && v + 2 <= MAX_TRAJ_VERTS; s += STEP) {
            const t1 = (s / range) * tof;
            const t2 = ((s + DASH) / range) * tof;
            const z1 = Math.max(0, launchH + vv * t1 - 0.5 * GAME_GRAVITY * t1 * t1);
            const z2 = Math.max(0, launchH + vv * t2 - 0.5 * GAME_GRAVITY * t2 * t2);
            const x1 = tip.x + tip.dirX * s;
            const y1 = tip.y + tip.dirY * s - z1;
            const x2 = tip.x + tip.dirX * (s + DASH);
            const y2 = tip.y + tip.dirY * (s + DASH) - z2;
            trajectoryScratchPos[v * 2 + 0] = x1; trajectoryScratchPos[v * 2 + 1] = y1;
            trajectoryScratchCol[v * 3 + 0] = 1; trajectoryScratchCol[v * 3 + 1] = 1; trajectoryScratchCol[v * 3 + 2] = 1;
            v++;
            trajectoryScratchPos[v * 2 + 0] = x2; trajectoryScratchPos[v * 2 + 1] = y2;
            trajectoryScratchCol[v * 3 + 0] = 1; trajectoryScratchCol[v * 3 + 1] = 1; trajectoryScratchCol[v * 3 + 2] = 1;
            v++;
          }
        }
        if (v > 0) trajectoryPreviewPass.draw(cam, trajectoryScratchPos, trajectoryScratchCol, v);
      }

      selectionPass.draw(world, cam, sel, drag, formation);
      if (opts.showMovePreview) selectionPass.drawMovePreview(world, cam, sel);
      if (opts.showHealthBars) healthBarPass.draw(world, cam);

      // Revert the per-frame jitter so the persistent camera state is unshaken.
      cam.center.x -= off.x;
      cam.center.y -= off.y;

      // Advance the shake decay timer at the end of the frame (after all draws).
      advanceShake(cameraShake, frameDt);
    },
  };
}
