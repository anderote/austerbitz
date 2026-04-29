/**
 * Skirmish Defense scenario entry point.
 * Three player-controlled cannons defend a south position against a continuous
 * stream of enemy line-infantry blocks marching west across the map.
 */
import { getGL2 } from '../gl/context';
import { createRenderer } from '../render/renderer';
import { createCamera } from '../render/camera';
import { createInputManager } from '../input/input-manager';
import { createCameraControls } from '../input/camera-controls';
import { createWorld, tickWorld, type System } from '../sim/world';
import { freeEntity, type Entities } from '../sim/entities';
import { ordersSystem } from '../sim/systems/orders-system';
import { movementSystem } from '../sim/systems/movement-system';
import { collisionSystem } from '../sim/systems/collision-system';
import { facingSystem } from '../sim/systems/facing-system';
import { tickStates, type FireOrders } from '../sim/systems/state-system';
import { tickProjectiles } from '../sim/systems/projectile-system';
import { updateShockwaves } from '../sim/systems/shockwave-system';
import { tickDebris } from '../sim/systems/debris-system';
import { tickRagdoll } from '../sim/systems/ragdoll-system';
import { createCombatSystem } from '../sim/systems/combat-system';
import { createDeathDropsSystem } from '../sim/systems/death-drops-system';
import { setKitGibTable } from '../sim/systems/combat-events';
import { buildKitGibTable } from '../sim/kit-gib-table';
import { marchSystem } from '../sim/systems/march-system';
import {
  createSelection,
  createDragRect,
  createFormationDrag,
  createControlGroups,
  type Selection,
} from '../input/selection';
import { createSelectionController } from '../input/selection-controller';
import '../ui/styles.css';
import { createOverlay } from '../ui/overlay';
import { createSelectionPanel } from '../ui/selection-panel';
import { createStatsCard } from '../ui/stats-card';
import { createFormationControlsPanel, type StanceSummary } from '../ui/formation-controls-panel';
import { createGroupBadges } from '../ui/group-badges';
import { createPlacementInfo } from '../ui/placement-info';
import { createMovePreview } from '../ui/move-preview';
import { createMusicPlayer } from '../ui/music-player';
import { createPerfPanel } from '../ui/perf-panel';
import { createParticles, updateParticles } from '../particles/particles';
import { createPuffs, updatePuffs } from '../puffs/puffs';
import { coalesceStep } from '../puffs/coalesce';
import { getProfileByIndex } from '../puffs/profile';
import { applyWindToPuffs, windAt, createWindState, tickWind } from '../puffs/wind';
import { emitDustForFrame } from '../puffs/emit-dust';
import { tickAmbientClouds, type AmbientCloudConfig } from '../puffs/ambient-clouds';
import { createProjectiles } from '../sim/projectiles';
import { clearBloodSplats } from '../sim/blood-splats';
import { clearSfxRequests } from '../sim/sfx-requests';
import { initSfx, playSfx } from '../audio/sfx';
import { loadPoseAtlas } from '../render/poses/atlas';
import { loadDebrisAtlas } from '../render/debris-atlas';
import { loadKits } from '../render/poses/kit-loader';
import { profiler } from '../dev/profiler';

import {
  spawnCannons,
  MAP_W,
  MAP_H,
  CANNON_X,
  CANNON_Y,
} from './scene';
import { createSpawnerState, tickSpawner } from './spawner';
import {
  createCounters,
  tickDespawn,
  tickKillCounter,
  countLiveEnemies,
} from './despawn';
import { createSkirmishHud } from './hud';

const CAPACITY = 4096;
const PARTICLE_CAPACITY = 30_000;
const PUFF_CAPACITY = 16_384;
const PROJECTILE_CAPACITY = 1024;

async function start(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const gl = getGL2(canvas);

  let poseAtlas = null;
  try {
    poseAtlas = await loadPoseAtlas(gl);
  } catch (err) {
    console.warn('[skirmish] pose atlas load failed; continuing without it:', err);
  }
  const debrisAtlas = await loadDebrisAtlas(gl);
  const kits = await loadKits();
  const chunkIdLookup = debrisAtlas
    ? new Map(debrisAtlas.chunks.map((c, i) => [c.id, i]))
    : undefined;
  const kitGibTable = buildKitGibTable(kits, chunkIdLookup);
  setKitGibTable(kitGibTable);

  const map = { size: { w: MAP_W, h: MAP_H }, features: [] as never[] };

  const renderer = createRenderer(
    gl, canvas, CAPACITY, PARTICLE_CAPACITY, PUFF_CAPACITY, PROJECTILE_CAPACITY,
    map.size.w, map.size.h, poseAtlas, kits,
    debrisAtlas, undefined, map, kitGibTable,
  );

  const camera = createCamera();
  const input = createInputManager(canvas);
  const selection = createSelection();
  const drag = createDragRect();
  const formationDrag = createFormationDrag();
  const controlGroups = createControlGroups();

  const world = createWorld({ seed: 7, capacity: CAPACITY, mapSize: Math.max(map.size.w, map.size.h) });

  const cloudCfg: AmbientCloudConfig = {
    target: 12,
    viewport: { minX: 0, minY: 0, maxX: map.size.w, maxY: map.size.h },
    windX: 0.6, windY: 0,
  };
  const particles = createParticles(PARTICLE_CAPACITY);
  const puffs = createPuffs(PUFF_CAPACITY);
  const windState = createWindState();
  const projectiles = createProjectiles(PROJECTILE_CAPACITY);
  const fireOrders: FireOrders = new Map();
  const combatSystem = createCombatSystem(fireOrders);
  const stateSystem: System = (w, dt) =>
    tickStates(w.entities, projectiles, particles, puffs, w.rng, fireOrders, dt, w.tickCount, w.fireSignal, w.grid);
  const projectileSystem: System = (w, dt) => {
    tickProjectiles(projectiles, w.entities, w.grid, puffs, particles, w.rng, w.shockwaves, w.debris, dt, w.bloodSplats, w.shakeRequests, w.craterSplats, w.sfxRequests);
    updateShockwaves(w.shockwaves, w.entities, w.grid, particles, w.rng, w.bloodSplats, w.debris, dt);
  };
  const ragdollSystem: System = (w, dt) => tickRagdoll(w.entities, dt);
  const debrisSystem: System = (w, dt) => tickDebris(w.debris, dt);
  const deathDropsSystem = createDeathDropsSystem(kits);

  world.systems = [
    marchSystem,
    ordersSystem,
    combatSystem,
    movementSystem,
    facingSystem,
    collisionSystem,
    stateSystem,
    projectileSystem,
    ragdollSystem,
    debrisSystem,
    deathDropsSystem,
  ];

  const cameraControls = createCameraControls(camera, input, {
    bounds: { minX: 0, minY: 0, maxX: map.size.w, maxY: map.size.h },
  });

  function syncViewport() {
    renderer.resize();
    camera.viewport = { w: window.innerWidth, h: window.innerHeight };
  }
  window.addEventListener('resize', syncViewport);
  syncViewport();
  window.addEventListener('pointerdown', initSfx, { once: true });
  window.addEventListener('keydown', initSfx, { once: true });

  // Camera centered between cannons and lane (lane is north of cannons).
  camera.center.x = CANNON_X;
  camera.center.y = CANNON_Y - 40;
  camera.zoom = 8;

  const overlay = createOverlay();
  const selPanel = createSelectionPanel(overlay);
  const statsCard = createStatsCard(overlay);
  const fcPanel = createFormationControlsPanel(overlay);
  const groupBadges = createGroupBadges(overlay);
  const placementInfo = createPlacementInfo(overlay);
  const movePreview = createMovePreview(overlay);
  createMusicPlayer(overlay);
  const perfPanel = createPerfPanel(overlay, input);

  const controller = createSelectionController({
    canvas, overlayRoot: overlay, camera, world, selection, drag, formationDrag, controlGroups,
    particles, movePreview, projectiles, puffs,
  });

  // Initial state.
  spawnCannons(world, 0);
  const spawnerState = createSpawnerState();
  const counters = createCounters();

  function clearProjectiles(): void {
    const p = projectiles;
    for (let i = 0; i < p.capacity; i++) p.alive[i] = 0;
    p.count = 0;
    for (let i = 0; i < p.capacity - 1; i++) p.freeListNext[i] = i + 1;
    p.freeListNext[p.capacity - 1] = -1;
    p.freeListHead = 0;
  }

  function clearParticles(): void {
    for (let i = 0; i < particles.capacity; i++) {
      particles.alive[i] = 0;
      particles.aliveIdx[i] = -1;
    }
    particles.count = 0;
    particles.cursor = 0;
  }

  function clearPuffs(): void {
    const pf = puffs;
    for (let i = 0; i < pf.capacity; i++) pf.alive[i] = 0;
    pf.count = 0;
  }

  function resetScene(): void {
    const e = world.entities;
    for (let i = 0; i < e.capacity; i++) {
      if (e.alive[i] === 1) freeEntity(e, i);
    }
    clearProjectiles();
    clearParticles();
    clearPuffs();
    fireOrders.clear();
    world.marchGroups.clear();
    world.orderQueue.clear();
    world.shockwaves.count = 0;
    world.debris.count = 0;
    world.bloodSplats.count = 0;
    world.craterSplats.count = 0;
    world.shakeRequests.count = 0;
    world.sfxRequests.count = 0;
    selection.ids.clear();
    counters.kills = 0;
    counters.escaped = 0;
    counters.seenDead.clear();
    spawnerState.accum = 0;
    // Re-spawn cannons; let the spawner tick produce the first block at the
    // usual interval rather than instantly.
    spawnCannons(world, 0);
  }

  const hud = createSkirmishHud({ reset: resetScene });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.repeat) return;
    if (e.key === 'r' || e.key === 'R') resetScene();
  });

  function computeStanceSummary(sel: Selection, e: Entities): StanceSummary {
    if (sel.ids.size === 0) return { kind: 'none' };
    let first: number | undefined;
    for (const id of sel.ids) {
      if (e.alive[id] !== 1) continue;
      if (first === undefined) { first = e.stance[id]!; continue; }
      if (e.stance[id]! !== first) return { kind: 'mixed' };
    }
    if (first === undefined) return { kind: 'none' };
    return { kind: 'uniform', stance: first };
  }

  let lastT = performance.now();
  let smoothedFps = 60;
  let simElapsed = 0;

  function frame(t: number): void {
    profiler.beginFrame();
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    simElapsed += dt;
    smoothedFps = smoothedFps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;

    input.beginFrame();
    cameraControls.update(dt);
    controller.update(dt);

    profiler.time('sim/tickWorld', () => tickWorld(world, dt));
    tickSpawner(spawnerState, world, dt);
    tickKillCounter(world, counters);
    tickDespawn(world, counters);

    profiler.time('puffs/emitDust', () => emitDustForFrame(world, puffs, dt));
    profiler.time('puffs/ambient', () => tickAmbientClouds(puffs, cloudCfg, dt, world.rng));
    profiler.time('puffs/update', () => updatePuffs(puffs, dt));
    tickWind(windState, simElapsed, world.rng);
    const wind = windAt(windState, simElapsed);
    profiler.time('puffs/wind', () => applyWindToPuffs(puffs, wind.x, wind.y, dt));
    profiler.time('puffs/coalesce', () => coalesceStep(puffs, dt, world.rng, getProfileByIndex));
    profiler.time('particles/update', () => updateParticles(particles, dt, world.bloodSplats));

    // Drain blood splats.
    profiler.begin('blood/drain');
    const bs = world.bloodSplats;
    for (let i = 0; i < bs.count; i++) {
      renderer.bloodStain.splat(bs.posX[i]!, bs.posY[i]!, bs.radius[i]!, bs.intensity[i]!);
    }
    clearBloodSplats(bs);
    profiler.end('blood/drain');

    // Drain sfx requests.
    const sfx = world.sfxRequests;
    for (let i = 0; i < sfx.count; i++) {
      playSfx(sfx.name[i]!, sfx.x[i]!, sfx.y[i]!, camera);
    }
    clearSfxRequests(sfx);

    const showHealthBars = input.state.keys.has('AltLeft') || input.state.keys.has('AltRight');
    const showMovePreview = input.state.keys.has('Space');
    const formationPreview = controller.formationPreview();
    profiler.time('render/all', () => {
      renderer.render(world, projectiles, puffs, particles, camera, selection, drag, formationPreview, { showHealthBars, showMovePreview }, dt);
    });

    placementInfo.update(world, camera, selection, formationPreview);
    movePreview.update(camera);
    selPanel.update(world, selection);
    statsCard.update(world, selection);
    fcPanel.update(selection, controller.formationParams, computeStanceSummary(selection, world.entities));
    groupBadges.update(world, camera, selection, controlGroups);

    hud.setCounters({
      fps: smoothedFps,
      kills: counters.kills,
      escaped: counters.escaped,
      inPlay: countLiveEnemies(world),
      projectiles: projectiles.count,
      particles: particles.count,
    });

    profiler.endFrame();
    perfPanel.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void start();
