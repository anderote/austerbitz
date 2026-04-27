import { getGL2 } from './gl/context';
import { createRenderer } from './render/renderer';
import { createCamera } from './render/camera';
import { createInputManager } from './input/input-manager';
import { createCameraControls } from './input/camera-controls';
import { createWorld, tickWorld } from './sim/world';
import { allocEntity } from './sim/entities';
import { getUnitKindIndex } from './data/units';
import { createDefaultMap } from './map/world-map';
import { ordersSystem } from './sim/systems/orders-system';
import { movementSystem } from './sim/systems/movement-system';
import { createSelection, createDragRect, createControlGroups } from './input/selection';
import { createSelectionController } from './input/selection-controller';
import './ui/styles.css';
import { createOverlay } from './ui/overlay';
import { createHud } from './ui/hud';
import { createSelectionPanel } from './ui/selection-panel';
import { createBuildMenu } from './ui/build-menu';
import { createScaleBar } from './ui/scale-bar';
import { createMinimap } from './ui/minimap';
import { createControlGroupsPanel } from './ui/control-groups-panel';
import { createGroupBadges } from './ui/group-badges';
import { createParticles, updateParticles } from './particles/particles';
import { emitDust } from './particles/emitters';
import { createProjectiles } from './sim/projectiles';

const CAPACITY = 4096;
const PARTICLE_CAPACITY = 50000;
const PROJECTILE_CAPACITY = 2048;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const renderer = createRenderer(gl, canvas, CAPACITY, PARTICLE_CAPACITY, PROJECTILE_CAPACITY);
const camera = createCamera();
const input = createInputManager(canvas);
const selection = createSelection();
const drag = createDragRect();
const controlGroups = createControlGroups();

const map = createDefaultMap();
const world = createWorld({ seed: 1, capacity: CAPACITY, mapSize: map.size.w });
const particles = createParticles(PARTICLE_CAPACITY);
const projectiles = createProjectiles(PROJECTILE_CAPACITY);
world.systems = [ordersSystem, movementSystem];

const cameraControls = createCameraControls(camera, input, {
  bounds: { minX: 0, minY: 0, maxX: map.size.w, maxY: map.size.h },
});

function spawn(kindId: string, team: number, x: number, y: number, facing = 0): number {
  const id = allocEntity(world.entities);
  if (id === -1) return -1;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  world.entities.team[id] = team;
  world.entities.facing[id] = facing;
  return id;
}

const cx = map.size.w / 2;
const cy = map.size.h / 2;

// 100 line-infantry in formation: 25 files wide × 4 ranks deep, all facing south.
const FILES = 25;
const RANKS = 4;
const FILE_GAP = 1.2;
const RANK_GAP = 1.6;
const FRONT_FACING = 2; // POSE_CELLS index 1 = S front
const formW = (FILES - 1) * FILE_GAP;
const formH = (RANKS - 1) * RANK_GAP;
for (let r = 0; r < RANKS; r++) {
  for (let f = 0; f < FILES; f++) {
    const x = cx - formW / 2 + f * FILE_GAP;
    const y = cy - formH / 2 + r * RANK_GAP;
    spawn('line-infantry', 0, x, y, FRONT_FACING);
  }
}

function syncViewport() {
  renderer.resize();
  camera.viewport = { w: window.innerWidth, h: window.innerHeight };
}
window.addEventListener('resize', syncViewport);
syncViewport();

camera.center.x = cx;
camera.center.y = cy;
camera.zoom = 16;

const overlay = createOverlay();
const hud = createHud(overlay);
const selPanel = createSelectionPanel(overlay);
const buildMenu = createBuildMenu(overlay);
const scaleBar = createScaleBar(overlay);
const minimap = createMinimap(overlay, map.size, camera);
const cgPanel = createControlGroupsPanel(overlay);
const groupBadges = createGroupBadges(overlay);

const controller = createSelectionController({
  canvas, overlayRoot: overlay, camera, world, selection, drag, controlGroups,
  particles,
});

let lastT = performance.now();
let smoothedFps = 60;
function frame(t: number) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  smoothedFps = smoothedFps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
  input.beginFrame();
  cameraControls.update(dt);
  controller.update(dt);
  tickWorld(world, dt);
  emitDust(world, particles, dt);
  updateParticles(particles, dt);
  renderer.render(world, projectiles, particles, camera, selection, drag);
  hud.update(smoothedFps, world, controller.cursorMode);
  selPanel.update(world, selection);
  buildMenu.update();
  scaleBar.update(camera);
  minimap.update(world, camera);
  cgPanel.update(world, controlGroups);
  groupBadges.update(world, camera, selection, controlGroups);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
