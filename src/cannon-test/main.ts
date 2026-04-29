/**
 * Cannon-test sandbox entry point.
 * 3 cannon-12 emplacements vs. a 60-man line-infantry regiment ~120 m downrange.
 * Cannons fire automatically via the standard combat-system + state-system flow.
 */
import { getGL2 } from '../gl/context';
import { createRenderer } from '../render/renderer';
import { createCamera } from '../render/camera';
import { createInputManager } from '../input/input-manager';
import { createCameraControls } from '../input/camera-controls';
import { createWorld, rebuildGrid } from '../sim/world';
import { createParticles, updateParticles } from '../particles/particles';
import { createPuffs, updatePuffs } from '../puffs/puffs';
import { createDamageTexts, updateDamageTexts } from '../fx/damage-texts/damage-texts';
import { coalesceStep } from '../puffs/coalesce';
import { getProfileByIndex } from '../puffs/profile';
import { tickAmbientClouds, type AmbientCloudConfig } from '../puffs/ambient-clouds';
import { createProjectiles } from '../sim/projectiles';
import { createSelection, createDragRect, createFormationDrag, createControlGroups } from '../input/selection';
import { createSelectionController } from '../input/selection-controller';
import { createOverlay } from '../ui/overlay';
import { createCannonAmmoPanel } from '../ui/cannon-ammo-panel';
import { movementSystem } from '../sim/systems/movement-system';
import { facingSystem } from '../sim/systems/facing-system';
import { createCombatSystem } from '../sim/systems/combat-system';
import { tickStates, type FireOrders } from '../sim/systems/state-system';
import { tickProjectiles } from '../sim/systems/projectile-system';
import { updateShockwaves } from '../sim/systems/shockwave-system';
import { tickDebris } from '../sim/systems/debris-system';
import { tickRagdoll } from '../sim/systems/ragdoll-system';
import { createDeathDropsSystem } from '../sim/systems/death-drops-system';
import { tickCrew } from '../sim/crew';
import { isDead, freeEntity } from '../sim/entities';
import { clearSfxRequests } from '../sim/sfx-requests';
import { initSfx, playSfx } from '../audio/sfx';
import { loadPoseAtlas } from '../render/poses/atlas';
import { loadDebrisAtlas } from '../render/debris-atlas';
import { loadKits } from '../render/poses/kit-loader';
import '../ui/styles.css';

import {
  spawnCannons,
  spawnRegiment,
  CANNON_X,
  REGIMENT_CENTER_X,
} from './scene';
import { createCannonTestHud } from './hud';

const CAPACITY = 4096;
const PARTICLE_CAPACITY = 80_000;
const PUFF_CAPACITY = 8192;
const PROJECTILE_CAPACITY = 4_096;
const MAP_SIZE = 300;

async function start(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const gl = getGL2(canvas);

  let poseAtlas = null;
  try {
    poseAtlas = await loadPoseAtlas(gl);
  } catch (err) {
    console.warn('[cannon-test] pose atlas load failed; continuing without it:', err);
  }
  const debrisAtlas = await loadDebrisAtlas(gl);
  const kits = await loadKits();

  const renderer = createRenderer(
    gl, canvas, CAPACITY, PARTICLE_CAPACITY, PUFF_CAPACITY, PROJECTILE_CAPACITY,
    MAP_SIZE, MAP_SIZE, poseAtlas, kits, debrisAtlas,
  );

  const camera = createCamera();
  const input = createInputManager(canvas);
  const selection = createSelection();
  const drag = createDragRect();
  const formationDrag = createFormationDrag();
  const controlGroups = createControlGroups();

  const world = createWorld({ seed: 42, capacity: CAPACITY, mapSize: MAP_SIZE });

  const cloudCfg: AmbientCloudConfig = {
    target: 12,
    viewport: { minX: -150, minY: -150, maxX: 150, maxY: 150 },
    windX: 0.6, windY: 0,
  };

  const particles = createParticles(PARTICLE_CAPACITY);
  const puffs = createPuffs(PUFF_CAPACITY);
  const damageTexts = createDamageTexts(256);
  const projectiles = createProjectiles(PROJECTILE_CAPACITY);

  const fireOrders: FireOrders = new Map();
  const combatSystem = createCombatSystem(fireOrders);

  const cameraControls = createCameraControls(camera, input, {
    bounds: { minX: -300, minY: -300, maxX: 300, maxY: 300 },
  });

  function syncViewport() {
    renderer.resize();
    camera.viewport = { w: window.innerWidth, h: window.innerHeight };
  }
  window.addEventListener('resize', syncViewport);
  syncViewport();

  window.addEventListener('pointerdown', initSfx, { once: true });
  window.addEventListener('keydown', initSfx, { once: true });

  // Camera centered between cannons and regiment.
  camera.center.x = (CANNON_X + REGIMENT_CENTER_X) / 2;
  camera.center.y = 100;
  camera.zoom = 5;

  const deathDropsSystem = createDeathDropsSystem(kits);

  const overlay = createOverlay();
  const controller = createSelectionController({
    canvas, overlayRoot: overlay, camera, world, selection, drag, formationDrag, controlGroups,
    particles, projectiles, puffs,
  });
  const cannonAmmoPanel = createCannonAmmoPanel(overlay);

  // Spawn the initial scene.
  spawnCannons(world.entities, 0);
  let regimentIds = spawnRegiment(world.entities, 1);

  // Simulation state.
  let paused = false;
  let stepOnce = false;
  let slowMo = false;
  let cameraShakeEnabled = false;

  function resetScene(): void {
    // Free all alive entities (cannons + regiment + ragdolls).
    const e = world.entities;
    for (let i = 0; i < e.capacity; i++) {
      if (e.alive[i] === 1) freeEntity(e, i);
    }

    // Bulk-clear projectiles.
    const p = projectiles;
    for (let i = 0; i < p.capacity; i++) p.alive[i] = 0;
    p.count = 0;
    for (let i = 0; i < p.capacity - 1; i++) p.freeListNext[i] = i + 1;
    p.freeListNext[p.capacity - 1] = -1;
    p.freeListHead = 0;

    // Bulk-clear particles.
    for (let i = 0; i < particles.capacity; i++) {
      particles.alive[i] = 0;
      particles.aliveIdx[i] = -1;
    }
    particles.count = 0;
    particles.cursor = 0;

    // Clear fire orders.
    fireOrders.clear();

    // Re-spawn.
    spawnCannons(world.entities, 0);
    regimentIds = spawnRegiment(world.entities, 1);
  }

  const hud = createCannonTestHud(
    {
      reset: resetScene,
      togglePause: () => { paused = !paused; },
      stepFrame: () => { stepOnce = true; },
      toggleSlowMo: () => { slowMo = !slowMo; },
      toggleCameraShake: () => { cameraShakeEnabled = !cameraShakeEnabled; },
    },
    {
      isPaused: () => paused,
      isSlowMo: () => slowMo,
      isCameraShake: () => cameraShakeEnabled,
    },
  );

  let lastT = performance.now();
  let smoothedFps = 60;

  function countAliveRegiment(): number {
    const e = world.entities;
    let count = 0;
    for (const id of regimentIds) {
      if (e.alive[id] === 1 && !isDead(e, id)) count++;
    }
    return count;
  }

  function frame(t: number): void {
    let dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    smoothedFps = smoothedFps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;

    const shouldTick = !paused || stepOnce;
    stepOnce = false;

    if (shouldTick) {
      if (slowMo) dt *= 0.25;

      input.beginFrame();
      cameraControls.update(dt);
      controller.update(dt);

      rebuildGrid(world);
      movementSystem(world, dt);
      facingSystem(world, dt);
      tickCrew(world.entities);
      combatSystem(world, dt);
      tickStates(world.entities, projectiles, particles, puffs, world.rng, fireOrders, dt, world.tickCount, world.fireSignal, world.grid);
      tickProjectiles(projectiles, world.entities, world.grid, puffs, particles, world.rng, world.shockwaves, world.debris, dt, world.bloodSplats, world.shakeRequests, world.craterSplats, world.sfxRequests, damageTexts);
      updateShockwaves(world.shockwaves, world.entities, world.grid, particles, world.rng, world.bloodSplats, world.debris, dt, damageTexts);
      tickRagdoll(world.entities, dt);
      tickDebris(world.debris, dt, puffs, world.rng);
      deathDropsSystem(world, dt);

      tickAmbientClouds(puffs, cloudCfg, dt, world.rng);
      updatePuffs(puffs, dt);
      coalesceStep(puffs, dt, world.rng, getProfileByIndex);
      updateParticles(particles, dt, world.bloodSplats);
      updateDamageTexts(damageTexts, dt);

      // Drain blood splats.
      const bs = world.bloodSplats;
      for (let i = 0; i < bs.count; i++) {
        renderer.bloodStain.splat(bs.posX[i]!, bs.posY[i]!, bs.radius[i]!, bs.intensity[i]!);
      }
      bs.count = 0;

      // Drain sfx requests.
      const sfx = world.sfxRequests;
      for (let i = 0; i < sfx.count; i++) {
        playSfx(sfx.name[i]!, sfx.x[i]!, sfx.y[i]!, camera);
      }
      clearSfxRequests(sfx);

      world.tickCount++;
      world.simTime += dt;
    } else {
      // Still update camera controls and controller when paused.
      input.beginFrame();
      cameraControls.update(0);
      controller.update(0);
    }

    const formationPreview = controller.formationPreview();
    renderer.render(
      world, projectiles, puffs, particles, damageTexts, camera, selection, drag, formationPreview,
      { showHealthBars: false, showMovePreview: false }, dt,
    );

    cannonAmmoPanel.update(world, selection);

    hud.setCounters({
      fps: smoothedFps,
      aliveRegiment: countAliveRegiment(),
      projectiles: projectiles.count,
      shockwaves: world.shockwaves.count,
      particles: particles.count,
      puffs: puffs.count,
      debris: world.debris.count,
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

void start();
