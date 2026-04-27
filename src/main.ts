import { getGL2 } from './gl/context';
import { createRenderer } from './render/renderer';
import { createCamera } from './render/camera';
import { createInputManager } from './input/input-manager';
import { createCameraControls } from './input/camera-controls';
import { createWorld, tickWorld } from './sim/world';
import { allocEntity, EntityState } from './sim/entities';
import { getUnitKind, getUnitKindIndex } from './data/units';
import { createDefaultMap } from './map/world-map';
import { ordersSystem } from './sim/systems/orders-system';
import { movementSystem } from './sim/systems/movement-system';
import { collisionSystem } from './sim/systems/collision-system';
import { facingSystem } from './sim/systems/facing-system';
import { tickStates, type FireOrders } from './sim/systems/state-system';
import { tickProjectiles } from './sim/systems/projectile-system';
import { tickRagdoll } from './sim/systems/ragdoll-system';
import { createCombatSystem } from './sim/systems/combat-system';
import type { System } from './sim/world';
import { createSelection, createDragRect, createFormationDrag, createControlGroups } from './input/selection';
import { createSelectionController } from './input/selection-controller';
import './ui/styles.css';
import { createOverlay } from './ui/overlay';
import { createHud } from './ui/hud';
import { createSelectionPanel } from './ui/selection-panel';
import { createStatsCard } from './ui/stats-card';
import { createBuildMenu } from './ui/build-menu';
import { createScaleBar } from './ui/scale-bar';
import { createMinimap } from './ui/minimap';
import { createControlGroupsPanel } from './ui/control-groups-panel';
import { createGroupBadges } from './ui/group-badges';
import { createPlacementInfo } from './ui/placement-info';
import { createMovePreview } from './ui/move-preview';
import { createParticles, updateParticles } from './particles/particles';
import { emitDust } from './particles/emitters';
import { createProjectiles } from './sim/projectiles';
import { clearBloodSplats } from './sim/blood-splats';

const CAPACITY = 131072; // hard ceiling — comfortably fits 100k+ troops
const PARTICLE_CAPACITY = 50000;
const PROJECTILE_CAPACITY = 2048;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const map = createDefaultMap();
const renderer = createRenderer(
  gl, canvas, CAPACITY, PARTICLE_CAPACITY, PROJECTILE_CAPACITY,
  map.size.w, map.size.h,
);
const camera = createCamera();
const input = createInputManager(canvas);
const selection = createSelection();
const drag = createDragRect();
const formationDrag = createFormationDrag();
const controlGroups = createControlGroups();

const world = createWorld({ seed: 1, capacity: CAPACITY, mapSize: map.size.w });
const particles = createParticles(PARTICLE_CAPACITY);
const projectiles = createProjectiles(PROJECTILE_CAPACITY);
const fireOrders: FireOrders = new Map();
const combatSystem = createCombatSystem(fireOrders);
const stateSystem: System = (w, dt) =>
  tickStates(w.entities, projectiles, particles, w.rng, fireOrders, dt);
const projectileSystem: System = (w, dt) =>
  tickProjectiles(projectiles, w.entities, w.grid, particles, w.rng, dt, w.bloodSplats);
const ragdollSystem: System = (w, dt) => tickRagdoll(w.entities, dt);

world.systems = [
  ordersSystem,
  combatSystem,
  movementSystem,
  facingSystem,
  collisionSystem,
  stateSystem,
  projectileSystem,
  ragdollSystem,
];

const cameraControls = createCameraControls(camera, input, {
  bounds: { minX: 0, minY: 0, maxX: map.size.w, maxY: map.size.h },
});

function spawn(kindId: string, team: number, x: number, y: number, facing = 0): number {
  const id = allocEntity(world.entities);
  if (id === -1) return -1;
  const kind = getUnitKind(kindId);
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  world.entities.restPosX[id] = x;
  world.entities.restPosY[id] = y;
  world.entities.kindId[id] = getUnitKindIndex(kindId);
  world.entities.team[id] = team;
  world.entities.facing[id] = facing;
  world.entities.restFacing[id] = facing;
  world.entities.facingIntentX[id] = Math.cos((facing * Math.PI) / 4);
  world.entities.facingIntentY[id] = Math.sin((facing * Math.PI) / 4);
  world.entities.hp[id] = kind.baseStats.hp;
  world.entities.bodyRadius[id] = kind.baseStats.bodyRadius;
  world.entities.massKg[id] = kind.baseStats.massKg;
  // Stagger initial firing — each armed unit starts mid-reload at a random
  // point so the first volley spreads across one reload cycle instead of
  // landing on a single tick.
  if (kind.weapon) {
    world.entities.state[id] = EntityState.Reloading;
    world.entities.reloadT[id] = world.rng.range(0, kind.baseStats.weaponReload);
  }
  return id;
}

const cx = map.size.w / 2;
const cy = map.size.h / 2;

const BATTLE_GAP = 60;      // metres between the two armies' front ranks (within musket range, 80m)
const FACING_E = 0;         // +X
const FACING_W = 4;         // -X

interface RegimentPlan {
  kindId: string;
  files: number;
  ranks: number;
  count: number;
  gap?: number;
  backOffset?: number;
}

interface ArmyPlan {
  team: number;
  facing: number;
  frontCenter: { x: number; y: number };
  regiments: RegimentPlan[];
}

function spawnFormationBlock(args: {
  kindId: string;
  team: number;
  facing: number;
  frontCenter: { x: number; y: number };
  files: number;
  ranks: number;
  spacingX: number;
  spacingY: number;
}): void {
  const { kindId, team, facing, frontCenter, files, ranks, spacingX, spacingY } = args;
  const theta = (facing * Math.PI) / 4;
  const forwardX = Math.cos(theta);
  const forwardY = Math.sin(theta);
  const lateralX = -forwardY;
  const lateralY = forwardX;
  const lateralStart = -((files - 1) * spacingX) / 2;
  for (let f = 0; f < files; f++) {
    const lateralOffset = lateralStart + f * spacingX;
    for (let r = 0; r < ranks; r++) {
      const depth = r * spacingY;
      const x = frontCenter.x - forwardX * depth + lateralX * lateralOffset;
      const y = frontCenter.y - forwardY * depth + lateralY * lateralOffset;
      spawn(kindId, team, x, y, facing);
    }
  }
}

function spawnArmy(plan: ArmyPlan): void {
  const theta = (plan.facing * Math.PI) / 4;
  const forwardX = Math.cos(theta);
  const forwardY = Math.sin(theta);
  const lateralX = -forwardY;
  const lateralY = forwardX;

  for (const reg of plan.regiments) {
    const kind = getUnitKind(reg.kindId);
    const spacingX = kind.baseStats.formationSpacing.x;
    const spacingY = kind.baseStats.formationSpacing.y;
    const blockWidth = spacingX * Math.max(0, reg.files - 1);
    const gap = reg.gap ?? spacingX * 6;
    const totalSpan = reg.count * blockWidth + Math.max(0, reg.count - 1) * gap;
    const firstCenterOffset = reg.count === 0 ? 0 : -totalSpan / 2 + blockWidth / 2;
    for (let i = 0; i < reg.count; i++) {
      const centerLateral = firstCenterOffset + i * (blockWidth + gap);
      const backShift = reg.backOffset ?? 0;
      const frontCenter = {
        x: plan.frontCenter.x + lateralX * centerLateral - forwardX * backShift,
        y: plan.frontCenter.y + lateralY * centerLateral - forwardY * backShift,
      };
      spawnFormationBlock({
        kindId: reg.kindId,
        team: plan.team,
        facing: plan.facing,
        frontCenter,
        files: reg.files,
        ranks: reg.ranks,
        spacingX,
        spacingY,
      });
    }
  }
}

// Three echelons of infantry, each spaced ~2.3 musket-ranges (80 m) apart. Cavalry sits
// well behind the rear echelon as a reserve; cannons are pushed deep into the back, still
// within their 600 m range to the enemy front line (60 m battle gap + 520 m = 580 m).
const INFANTRY_ECHELON_DEPTH = 30;
const CAVALRY_BACK = 420;
const CANNON_BACK = 520;

const lineRegiments: RegimentPlan[] = [
  { kindId: 'line-infantry', files: 100, ranks: 3, count: 6, gap: 8, backOffset: 0 },
  { kindId: 'line-infantry', files: 100, ranks: 3, count: 6, gap: 8, backOffset: INFANTRY_ECHELON_DEPTH },
  { kindId: 'line-infantry', files: 100, ranks: 3, count: 6, gap: 8, backOffset: INFANTRY_ECHELON_DEPTH * 2 },
  { kindId: 'cuirassier',    files: 50,  ranks: 3, count: 6, gap: 30, backOffset: CAVALRY_BACK },
  { kindId: 'cannon-12',     files: 12,  ranks: 1, count: 6, gap: 50, backOffset: CANNON_BACK },
];

const friendlyArmy: ArmyPlan = {
  team: 0,
  facing: FACING_W,
  frontCenter: { x: cx + BATTLE_GAP / 2, y: cy },
  regiments: lineRegiments,
};

const enemyArmy: ArmyPlan = {
  team: 1,
  facing: FACING_E,
  frontCenter: { x: cx - BATTLE_GAP / 2, y: cy },
  regiments: lineRegiments,
};

spawnArmy(friendlyArmy);
spawnArmy(enemyArmy);

function syncViewport() {
  renderer.resize();
  camera.viewport = { w: window.innerWidth, h: window.innerHeight };
}
window.addEventListener('resize', syncViewport);
syncViewport();

camera.center.x = cx;
camera.center.y = cy;
camera.zoom = 12;

const overlay = createOverlay();
const hud = createHud(overlay);
const selPanel = createSelectionPanel(overlay);
const statsCard = createStatsCard(overlay);
const buildMenu = createBuildMenu(overlay);
const scaleBar = createScaleBar(overlay);
const minimap = createMinimap(overlay, map.size, camera);
const cgPanel = createControlGroupsPanel(overlay);
const groupBadges = createGroupBadges(overlay);
const placementInfo = createPlacementInfo(overlay);
const movePreview = createMovePreview(overlay);

const controller = createSelectionController({
  canvas, overlayRoot: overlay, camera, world, selection, drag, formationDrag, controlGroups,
  particles, movePreview,
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
  // Drain sim-queued blood splats into the GPU stain pass.
  const bs = world.bloodSplats;
  for (let i = 0; i < bs.count; i++) {
    renderer.bloodStain.splat(bs.posX[i]!, bs.posY[i]!, bs.radius[i]!, bs.intensity[i]!);
  }
  clearBloodSplats(bs);
  const showHealthBars = input.state.keys.has('AltLeft') || input.state.keys.has('AltRight');
  const showMovePreview = input.state.keys.has('Space');
  const formationPreview = controller.formationPreview();
  renderer.render(world, projectiles, particles, camera, selection, drag, formationPreview, { showHealthBars, showMovePreview });
  hud.update(smoothedFps, world, controller.cursorMode);
  placementInfo.update(world, camera, selection, formationPreview);
  movePreview.update(camera);
  selPanel.update(world, selection);
  statsCard.update(world, selection);
  buildMenu.update();
  scaleBar.update(camera);
  minimap.update(world, camera);
  cgPanel.update(world, controlGroups);
  groupBadges.update(world, camera, selection, controlGroups);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
