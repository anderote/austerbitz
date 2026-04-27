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
import { createSelection, createDragRect } from './input/selection';
import { createSelectionController } from './input/selection-controller';
import './ui/styles.css';
import { createOverlay } from './ui/overlay';
import { createHud } from './ui/hud';
import { createSelectionPanel } from './ui/selection-panel';
import { createBuildMenu } from './ui/build-menu';
import { createScaleBar } from './ui/scale-bar';
import { createMinimap } from './ui/minimap';
import { createParticles, updateParticles } from './particles/particles';
import { emitDust } from './particles/emitters';

const CAPACITY = 4096;
const PARTICLE_CAPACITY = 4096;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const renderer = createRenderer(gl, canvas, CAPACITY, PARTICLE_CAPACITY);
const camera = createCamera();
const input = createInputManager(canvas);
const selection = createSelection();
const drag = createDragRect();

const map = createDefaultMap();
const world = createWorld({ seed: 1, capacity: CAPACITY, mapSize: map.size.w });
const particles = createParticles(PARTICLE_CAPACITY);
world.systems = [ordersSystem, movementSystem];

const cameraControls = createCameraControls(camera, input, {
  bounds: { minX: 0, minY: 0, maxX: map.size.w, maxY: map.size.h },
});

function spawn(kindId: string, team: number, x: number, y: number) {
  const id = allocEntity(world.entities);
  if (id === -1) return;
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  world.entities.team[id] = team;
}

const cx = map.size.w / 2;
const cy = map.size.h / 2;
for (let i = 0; i < 16; i++) spawn('line-infantry', 0, cx - 10 + i * 1.3, cy - 30);
for (let i = 0; i < 4; i++) spawn('cuirassier', 0, cx - 6 + i * 3, cy - 50);
spawn('cannon-12', 0, cx, cy - 70);

function syncViewport() {
  renderer.resize();
  camera.viewport = { w: window.innerWidth, h: window.innerHeight };
}
window.addEventListener('resize', syncViewport);
syncViewport();

// Center the view on the front line of infantry.
camera.center.x = cx;
camera.center.y = cy - 30;
camera.zoom = 4;

const overlay = createOverlay();
const hud = createHud(overlay);
const selPanel = createSelectionPanel(overlay);
const buildMenu = createBuildMenu(overlay);
const scaleBar = createScaleBar(overlay);
const minimap = createMinimap(overlay, map.size, camera);

const controller = createSelectionController({
  canvas, overlayRoot: overlay, camera, world, selection, drag,
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
  renderer.render(world, particles, camera, selection, drag);
  hud.update(smoothedFps, world, camera, input, controller.cursorMode);
  selPanel.update(world, selection);
  buildMenu.update();
  scaleBar.update(camera);
  minimap.update(world, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
