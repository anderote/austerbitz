import { getGL2 } from '../gl/context';
import { createRenderer } from '../render/renderer';
import { createCamera } from '../render/camera';
import { createInputManager } from '../input/input-manager';
import { createCameraControls } from '../input/camera-controls';
import { createWorld, rebuildGrid } from '../sim/world';
import { createParticles, updateParticles } from '../particles/particles';
import { createProjectiles } from '../sim/projectiles';
import { createSelection, createDragRect } from '../input/selection';
import { movementSystem } from '../sim/systems/movement-system';
import { tickStates, type FireOrders } from '../sim/systems/state-system';
import { tickProjectiles } from '../sim/systems/projectile-system';
import { tickRagdoll } from '../sim/systems/ragdoll-system';
import '../ui/styles.css';

import { setupStage, resetStage, spawnSubject } from './stage';
import {
  actMarch, actHalt, actFaceL, actFaceR,
  actFire, actReload,
  actSolidShot, actExplosiveShell,
  actCharge,
  actTakeMusketHit, actTakeCannonHit, actDie,
} from './actions';
import { applyWind } from './wind';
import { createLabUi, type ActionHandlers, type GridToggle, type TimeScaleState, type WindState } from './lab-ui';

const CAPACITY = 256;
const PARTICLE_CAPACITY = 50_000;
const PROJECTILE_CAPACITY = 2_048;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const renderer = createRenderer(gl, canvas, CAPACITY, PARTICLE_CAPACITY, PROJECTILE_CAPACITY);
const camera = createCamera();
const input = createInputManager(canvas);
const selection = createSelection();
const drag = createDragRect();

const world = createWorld({ seed: 1, capacity: CAPACITY, mapSize: 200 });
const particles = createParticles(PARTICLE_CAPACITY);
const projectiles = createProjectiles(PROJECTILE_CAPACITY);

// Camera bounds: lab is small, anchored around origin. Map size is 200, but we
// only care about a [-100, 100] window for inspection.
const cameraControls = createCameraControls(camera, input, {
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
});

function syncViewport() {
  renderer.resize();
  camera.viewport = { w: window.innerWidth, h: window.innerHeight };
}
window.addEventListener('resize', syncViewport);
syncViewport();

camera.center.x = 15; // halfway between subject (0) and dummies (30)
camera.center.y = 0;
camera.zoom = 12;

// Stage + lab state.
let subjectKind = 'line-infantry';
const stage = setupStage(world, projectiles, particles, subjectKind);

const fireOrders: FireOrders = new Map();
const wind: WindState = { accelX: 0 };
const timeScale: TimeScaleState = { scale: 1.0 };
const gridToggle: GridToggle = { on: false };

const handlers: ActionHandlers = {
  march: () => actMarch(world, stage),
  halt: () => actHalt(world, stage),
  faceL: () => actFaceL(world, stage),
  faceR: () => actFaceR(world, stage),
  fire: () => actFire(world, fireOrders, stage),
  reload: () => actReload(world, stage),
  solidShot: () => actSolidShot(world, projectiles, particles, stage),
  explosiveShell: () => actExplosiveShell(world, projectiles, particles, stage),
  charge: () => actCharge(world, stage),
  takeMusketHit: () => actTakeMusketHit(world, particles, world.rng, stage),
  takeCannonHit: () => actTakeCannonHit(world, particles, world.rng, stage),
  die: () => actDie(world, particles, world.rng, stage),
  reset: () => {
    resetStage(world, projectiles, particles, stage);
    fireOrders.clear();
  },
};

const ui = createLabUi(
  handlers,
  () => subjectKind,
  (k) => {
    subjectKind = k;
    spawnSubject(world, stage, k);
    fireOrders.clear();
  },
  timeScale,
  wind,
  gridToggle,
);

// Auto-fire flag is hung off the handlers object by lab-ui.ts so we can poll it.
const isAutoFire = (handlers as ActionHandlers & { isAutoFire?: () => boolean }).isAutoFire
  ?? (() => false);

let lastT = performance.now();
let smoothedFps = 60;

function frame(t: number) {
  let dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  smoothedFps = smoothedFps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;

  // Time-scale applies to sim only; FPS reading stays real-time.
  dt *= timeScale.scale;

  input.beginFrame();
  cameraControls.update(dt);

  // Sim tick — manually orchestrated since the lab runs its own system order.
  rebuildGrid(world);
  movementSystem(world, dt);
  tickStates(world.entities, projectiles, particles, world.rng, fireOrders, dt);
  tickProjectiles(projectiles, world.entities, world.grid, particles, world.rng, dt);
  tickRagdoll(world.entities, dt);

  // Auto-fire: queue a fresh shot whenever the subject lapses into Idle.
  if (isAutoFire()) handlers.fire();

  applyWind(particles, wind.accelX, dt);
  updateParticles(particles, dt);

  renderer.render(world, projectiles, particles, camera, selection, drag);

  ui.update({
    fps: smoothedFps,
    entityCount: world.entities.count,
    particleCount: particles.count,
    particleCap: particles.capacity,
    projCount: projectiles.count,
    projCap: projectiles.capacity,
  });

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
