import { getGL2 } from './gl/context';
import { createRenderer } from './render/renderer';
import { createCamera } from './render/camera';
import { createInputManager } from './input/input-manager';
import { createCameraControls } from './input/camera-controls';
import { createWorld, tickWorld } from './sim/world';
import { allocEntity } from './sim/entities';
import { getUnitKind, getUnitKindIndex } from './data/units';
import { createDefaultMap } from './map/world-map';
import { ordersSystem } from './sim/systems/orders-system';
import { movementSystem } from './sim/systems/movement-system';
import { collisionSystem } from './sim/systems/collision-system';
import { createSelection, createDragRect, createFormationDrag, createControlGroups } from './input/selection';
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

const CAPACITY = 131072; // hard ceiling — comfortably fits 100k+ troops
const PARTICLE_CAPACITY = 50000;
const PROJECTILE_CAPACITY = 2048;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const renderer = createRenderer(gl, canvas, CAPACITY, PARTICLE_CAPACITY, PROJECTILE_CAPACITY);
const camera = createCamera();
const input = createInputManager(canvas);
const selection = createSelection();
const drag = createDragRect();
const formationDrag = createFormationDrag();
const controlGroups = createControlGroups();

const map = createDefaultMap();
const world = createWorld({ seed: 1, capacity: CAPACITY, mapSize: map.size.w });
const particles = createParticles(PARTICLE_CAPACITY);
const projectiles = createProjectiles(PROJECTILE_CAPACITY);
world.systems = [ordersSystem, movementSystem, collisionSystem];

const cameraControls = createCameraControls(camera, input, {
  bounds: { minX: 0, minY: 0, maxX: map.size.w, maxY: map.size.h },
});

function spawn(kindId: string, team: number, x: number, y: number, facing = 0): number {
  const id = allocEntity(world.entities);
  if (id === -1) return -1;
  const kind = getUnitKind(kindId);
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  world.entities.team[id] = team;
  world.entities.facing[id] = facing;
  world.entities.hp[id] = kind.baseStats.hp;
  return id;
}

const cx = map.size.w / 2;
const cy = map.size.h / 2;

// Two opposing armies: block regiments running N→S, 4 ranks deep × 100 across.
// Friendly (team 0) to the east facing W; enemy (team 1) to the west facing E.
const REGIMENTS = 6;
const FILES = 100;          // soldiers across the N-S frontage
const RANKS = 4;            // soldiers deep along the E-W axis
const FILE_GAP = 1.2;       // metres between files (N-S)
const RANK_GAP = 1.6;       // metres between ranks (E-W)
const REGIMENT_GAP = 8;     // metres between adjacent regiments (N-S)
const BATTLE_GAP = 200;     // metres between the two armies' front ranks
const FACING_W = 7;         // POSE_CELLS index 6 = W side mirrored
const FACING_E = 3;         // POSE_CELLS index 2 = E side
const regLenNS = (FILES - 1) * FILE_GAP;
const armyLenNS = REGIMENTS * regLenNS + (REGIMENTS - 1) * REGIMENT_GAP;
const y0 = cy - armyLenNS / 2;

const friendlyFrontX = cx + BATTLE_GAP / 2;
for (let g = 0; g < REGIMENTS; g++) {
  const regY0 = y0 + g * (regLenNS + REGIMENT_GAP);
  for (let f = 0; f < FILES; f++) {
    for (let r = 0; r < RANKS; r++) {
      const x = friendlyFrontX + r * RANK_GAP;
      const y = regY0 + f * FILE_GAP;
      spawn('line-infantry', 0, x, y, FACING_W);
    }
  }
}

const enemyFrontX = cx - BATTLE_GAP / 2;
for (let g = 0; g < REGIMENTS; g++) {
  const regY0 = y0 + g * (regLenNS + REGIMENT_GAP);
  for (let f = 0; f < FILES; f++) {
    for (let r = 0; r < RANKS; r++) {
      const x = enemyFrontX - r * RANK_GAP;
      const y = regY0 + f * FILE_GAP;
      spawn('line-infantry', 1, x, y, FACING_E);
    }
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
  canvas, overlayRoot: overlay, camera, world, selection, drag, formationDrag, controlGroups,
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
  const showHealthBars = input.state.keys.has('AltLeft') || input.state.keys.has('AltRight');
  renderer.render(world, projectiles, particles, camera, selection, drag, controller.formationPreview(), { showHealthBars });
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
