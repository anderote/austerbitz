import { getGL2 } from './gl/context';
import { createRenderer } from './render/renderer';
import { createCamera, screenToWorld } from './render/camera';
import { createInputManager } from './input/input-manager';
import { createCameraControls } from './input/camera-controls';
import { createWorld, tickWorld } from './sim/world';
import { allocEntity } from './sim/entities';
import { getUnitKindIndex } from './data/units';
import { createDefaultMap } from './map/world-map';
import { ordersSystem } from './sim/systems/orders-system';
import { movementSystem } from './sim/systems/movement-system';
import {
  createSelection, createDragRect, hitTestPoint, hitTestRect,
} from './input/selection';
import { issueMoveOrder } from './input/commands';
import './ui/styles.css';
import { createOverlay } from './ui/overlay';
import { createHud } from './ui/hud';
import { createSelectionPanel } from './ui/selection-panel';
import { createBuildMenu } from './ui/build-menu';
import { createScaleBar } from './ui/scale-bar';
import { createMinimap } from './ui/minimap';
import { createParticles, updateParticles } from './particles/particles';
import { emitDust } from './particles/emitters';
import { POSE_CELLS } from './render/british-soldier-sprite';

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

// Pose-showcase grid: one column per soldier pose, repeated across rows.
const POSE_ROWS = 3;
const COL_GAP = 3;
const ROW_GAP = 3;
const gridW = (POSE_CELLS.length - 1) * COL_GAP;
const gridH = (POSE_ROWS - 1) * ROW_GAP;
for (let row = 0; row < POSE_ROWS; row++) {
  for (let col = 0; col < POSE_CELLS.length; col++) {
    const x = cx - gridW / 2 + col * COL_GAP;
    const y = cy - gridH / 2 + row * ROW_GAP;
    spawn('line-infantry', 0, x, y, col + 1);
  }
}

function syncViewport() {
  renderer.resize();
  camera.viewport = { w: window.innerWidth, h: window.innerHeight };
}
window.addEventListener('resize', syncViewport);
syncViewport();

// Center the view on the pose-showcase grid.
camera.center.x = cx;
camera.center.y = cy;
camera.zoom = 16;

// Selection input handlers (left mouse button)
const DRAG_THRESHOLD_PX = 4;
let pendingClickStart: { x: number; y: number } | null = null;

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  pendingClickStart = { x: e.clientX, y: e.clientY };
  drag.start = { x: e.clientX, y: e.clientY };
  drag.current = { x: e.clientX, y: e.clientY };
  drag.active = false;
});

window.addEventListener('mousemove', (e) => {
  if (!pendingClickStart) return;
  drag.current = { x: e.clientX, y: e.clientY };
  const dx = e.clientX - pendingClickStart.x;
  const dy = e.clientY - pendingClickStart.y;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.active = true;
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !pendingClickStart) return;
  const additive = e.shiftKey;
  if (drag.active) {
    const a = screenToWorld(camera, drag.start);
    const b = screenToWorld(camera, drag.current);
    const ids = hitTestRect(world, a.x, a.y, b.x, b.y);
    if (!additive) selection.ids.clear();
    for (const id of ids) selection.ids.add(id);
  } else {
    const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const id = hitTestPoint(world, w);
    if (!additive) selection.ids.clear();
    if (id !== -1) selection.ids.add(id);
  }
  drag.active = false;
  pendingClickStart = null;
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') selection.ids.clear();
});

// Right-click: issue move order to current selection
// (Default context menu is already suppressed by createInputManager.)
window.addEventListener('mouseup', (e) => {
  if (e.button !== 2) return;
  const w = screenToWorld(camera, { x: e.clientX, y: e.clientY });
  issueMoveOrder(world, selection, w);
});

const overlay = createOverlay();
const hud = createHud(overlay);
const selPanel = createSelectionPanel(overlay);
const buildMenu = createBuildMenu(overlay);
const scaleBar = createScaleBar(overlay);
const minimap = createMinimap(overlay, map.size, camera);

let lastT = performance.now();
let smoothedFps = 60;
function frame(t: number) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  smoothedFps = smoothedFps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
  input.beginFrame();
  cameraControls.update(dt);
  tickWorld(world, dt);
  emitDust(world, particles, dt);
  updateParticles(particles, dt);
  renderer.render(world, particles, camera, selection, drag);
  hud.update(smoothedFps, world);
  selPanel.update(world, selection);
  buildMenu.update();
  scaleBar.update(camera);
  minimap.update(world, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
