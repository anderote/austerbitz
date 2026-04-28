import { getGL2 } from './gl/context';
import { createRenderer } from './render/renderer';
import { createCamera } from './render/camera';
import { createInputManager } from './input/input-manager';
import { createCameraControls } from './input/camera-controls';
import { createWorld, tickWorld } from './sim/world';
import { allocEntity, EntityState, type Entities } from './sim/entities';
import { getUnitKind, getUnitKindIndex } from './data/units';
import { createDefaultMap } from './map/world-map';
import { ordersSystem } from './sim/systems/orders-system';
import { movementSystem } from './sim/systems/movement-system';
import { collisionSystem } from './sim/systems/collision-system';
import { facingSystem } from './sim/systems/facing-system';
import { tickStates, type FireOrders } from './sim/systems/state-system';
import { tickProjectiles } from './sim/systems/projectile-system';
import { updateShockwaves } from './sim/systems/shockwave-system';
import { tickDebris } from './sim/systems/debris-system';
import { tickRagdoll } from './sim/systems/ragdoll-system';
import { createCombatSystem } from './sim/systems/combat-system';
import { createDeathDropsSystem } from './sim/systems/death-drops-system';
import { marchSystem } from './sim/systems/march-system';
import { assignIdentity } from './sim/spawn-identity';
import type { System } from './sim/world';
import { createSelection, createDragRect, createFormationDrag, createControlGroups, type Selection } from './input/selection';
import { createSelectionController } from './input/selection-controller';
import './ui/styles.css';
import { createOverlay } from './ui/overlay';
import { createHud } from './ui/hud';
import { createSelectionPanel } from './ui/selection-panel';
import { createStatsCard } from './ui/stats-card';
import { createBuildMenu } from './ui/build-menu';
import { createScaleBar } from './ui/scale-bar';
import { createWindIndicator } from './ui/wind-indicator';
import { createMinimap } from './ui/minimap';
import { createControlGroupsPanel } from './ui/control-groups-panel';
import { createFormationControlsPanel, type StanceSummary } from './ui/formation-controls-panel';
import { createGroupBadges } from './ui/group-badges';
import { createPlacementInfo } from './ui/placement-info';
import { createMovePreview } from './ui/move-preview';
import { createMusicPlayer } from './ui/music-player';
import { createParticles, updateParticles } from './particles/particles';
import { createPuffs, updatePuffs } from './puffs/puffs';
import { coalesceStep } from './puffs/coalesce';
import { getProfileByIndex } from './puffs/profile';
import { applyWindToPuffs, windAt, createWindState, tickWind } from './puffs/wind';
import { emitDustForFrame } from './puffs/emit-dust';
import { tickAmbientClouds, type AmbientCloudConfig } from './puffs/ambient-clouds';
import { createProjectiles } from './sim/projectiles';
import { clearBloodSplats } from './sim/blood-splats';
import { clearSfxRequests } from './sim/sfx-requests';
import { initSfx, playSfx } from './audio/sfx';
import { loadPoseAtlas } from './render/poses/atlas';
import { loadDebrisAtlas } from './render/debris-atlas';
import { loadKits } from './render/poses/kit-loader';
import { startLiveReload } from './render/poses/live-reload';
import { composeCombinedAtlas } from './render/poses/combined-atlas';
import { generateCombinedAtlas, COMBINED_SHEET_W, COMBINED_SHEET_H } from './render/sprite-atlas';

const CAPACITY = 131072; // hard ceiling — comfortably fits 100k+ troops
const PARTICLE_CAPACITY = 50000;
const PUFF_CAPACITY = 65536;
const PROJECTILE_CAPACITY = 2048;

async function start(): Promise<void> {
const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = getGL2(canvas);
const map = createDefaultMap();
let poseAtlas = null;
try {
  poseAtlas = await loadPoseAtlas(gl);
} catch (err) {
  console.warn('[main] pose atlas load failed; continuing without it:', err);
}
const debrisAtlas = await loadDebrisAtlas(gl);
const kits = await loadKits();
const renderer = createRenderer(
  gl, canvas, CAPACITY, PARTICLE_CAPACITY, PUFF_CAPACITY, PROJECTILE_CAPACITY,
  map.size.w, map.size.h, poseAtlas, kits,
  debrisAtlas, undefined, map,
);

// Dev-mode live-reload: poll kit JSONs for per-(pose, facing) weapon edits
// (so the running game reflects editor changes without a page reload), and
// poll the atlas mtime for sprite-PNG changes (so a rebuild swaps the GL
// texture in place). No-op in production.
startLiveReload({
  kits,
  onKitsChanged: () => {
    // Per-pose weapon transforms are read fresh each frame from `kits` —
    // the in-place mutation is enough to flow through. (Top-level weapon
    // block mirror-source changes would need a UV-cache rebuild; the
    // editor's two new buttons + drag don't touch that block, so we skip
    // the heavier work here.)
  },
  onAtlasChanged: async () => {
    try {
      const fresh = await loadPoseAtlas(gl);
      const procedural = {
        pixels: generateCombinedAtlas(),
        width: COMBINED_SHEET_W,
        height: COMBINED_SHEET_H,
      };
      const combined = composeCombinedAtlas(procedural, fresh);
      // Wrap the raw RGBA buffer as ImageData so it's a valid TexImageSource.
      // Copy the bytes into a fresh Uint8ClampedArray-backed ArrayBuffer; the
      // existing buffer may be typed as SharedArrayBuffer-compatible, which
      // ImageData's constructor doesn't accept.
      const copy = new Uint8ClampedArray(combined.pixels.byteLength);
      copy.set(combined.pixels);
      const data = new ImageData(copy, combined.width, combined.height);
      renderer.replaceSpriteAtlas(data);
    } catch (err) {
      console.warn('[main] atlas live-reload failed:', err);
    }
  },
});
const camera = createCamera();
const input = createInputManager(canvas);
const selection = createSelection();
const drag = createDragRect();
const formationDrag = createFormationDrag();
const controlGroups = createControlGroups();

const world = createWorld({ seed: 1, capacity: CAPACITY, mapSize: map.size.w });

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
  assignIdentity(world.entities, id, team, world.rng);
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

const BATTLE_GAP = 100;     // metres between the two armies' front ranks
const FACING_E = 0;         // +X
const FACING_W = 4;         // -X

interface RegimentPlan {
  kindId: string;
  files: number;
  ranks: number;
  count: number;
  gap?: number;
  backOffset?: number;
  // Metres north of the army's frontCenter (positive = north / -Y world).
  // Independent of facing so both armies share one coordinate.
  northOffset?: number;
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
    const backShift = reg.backOffset ?? 0;
    const northShift = reg.northOffset ?? 0;
    // northShift is facing-independent: +north always means -Y in world space.
    const anchorX = plan.frontCenter.x - forwardX * backShift;
    const anchorY = plan.frontCenter.y - forwardY * backShift - northShift;
    for (let i = 0; i < reg.count; i++) {
      const centerLateral = firstCenterOffset + i * (blockWidth + gap);
      const frontCenter = {
        x: anchorX + lateralX * centerLateral,
        y: anchorY + lateralY * centerLateral,
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

// Three parallel lines per side, 50m apart along the facing axis.
// Each line is 2000 line-infantry, 8 ranks deep, split into five 50-file regiments.
const lineRegiments: RegimentPlan[] = [
  { kindId: 'line-infantry', files: 50, ranks: 8, count: 5, gap: 8 },
  { kindId: 'line-infantry', files: 50, ranks: 8, count: 5, gap: 8, backOffset: 50 },
  { kindId: 'line-infantry', files: 50, ranks: 8, count: 5, gap: 8, backOffset: 100 },
];

const friendlyArmy: ArmyPlan = {
  team: 0,
  facing: FACING_E,
  frontCenter: { x: cx - BATTLE_GAP / 2, y: cy },
  regiments: lineRegiments,
};

const enemyArmy: ArmyPlan = {
  team: 1,
  facing: FACING_W,
  frontCenter: { x: cx + BATTLE_GAP / 2, y: cy },
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
window.addEventListener('pointerdown', initSfx, { once: true });
window.addEventListener('keydown', initSfx, { once: true });

camera.center.x = cx;
camera.center.y = cy;
camera.zoom = 12;

const overlay = createOverlay();
const hud = createHud(overlay);
const selPanel = createSelectionPanel(overlay);
const statsCard = createStatsCard(overlay);
const buildMenu = createBuildMenu(overlay);
const scaleBar = createScaleBar(overlay);
const windIndicator = createWindIndicator(overlay);
const minimap = createMinimap(overlay, map.size, camera);
const cgPanel = createControlGroupsPanel(overlay);
const fcPanel = createFormationControlsPanel(overlay);
const groupBadges = createGroupBadges(overlay);
const placementInfo = createPlacementInfo(overlay);
const movePreview = createMovePreview(overlay);
createMusicPlayer(overlay);

const controller = createSelectionController({
  canvas, overlayRoot: overlay, camera, world, selection, drag, formationDrag, controlGroups,
  particles, movePreview,
});

let lastT = performance.now();
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

let smoothedFps = 60;
let simElapsed = 0;
function frame(t: number) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  simElapsed += dt;
  smoothedFps = smoothedFps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
  input.beginFrame();
  cameraControls.update(dt);
  controller.update(dt);
  tickWorld(world, dt);
  emitDustForFrame(world, puffs, dt);
  tickAmbientClouds(puffs, cloudCfg, dt, world.rng);
  updatePuffs(puffs, dt);
  tickWind(windState, simElapsed, world.rng);
  const wind = windAt(windState, simElapsed);
  applyWindToPuffs(puffs, wind.x, wind.y, dt);
  windIndicator.update(wind.x, wind.y);
  coalesceStep(puffs, dt, world.rng, getProfileByIndex);
  updateParticles(particles, dt, world.bloodSplats);
  // Drain sim-queued blood splats into the GPU stain pass.
  const bs = world.bloodSplats;
  for (let i = 0; i < bs.count; i++) {
    renderer.bloodStain.splat(bs.posX[i]!, bs.posY[i]!, bs.radius[i]!, bs.intensity[i]!);
  }
  clearBloodSplats(bs);
  // Drain sim-queued sfx requests.
  const sfx = world.sfxRequests;
  for (let i = 0; i < sfx.count; i++) {
    playSfx(sfx.name[i]!, sfx.x[i]!, sfx.y[i]!, camera);
  }
  clearSfxRequests(sfx);
  const showHealthBars = input.state.keys.has('AltLeft') || input.state.keys.has('AltRight');
  const showMovePreview = input.state.keys.has('Space');
  const formationPreview = controller.formationPreview();
  renderer.render(world, projectiles, puffs, particles, camera, selection, drag, formationPreview, { showHealthBars, showMovePreview }, dt);
  hud.update(smoothedFps, world, controller.cursorMode);
  placementInfo.update(world, camera, selection, formationPreview);
  movePreview.update(camera);
  selPanel.update(world, selection);
  statsCard.update(world, selection);
  buildMenu.update();
  scaleBar.update(camera);
  minimap.update(world, camera);
  cgPanel.update(world, controlGroups);
  fcPanel.update(selection, controller.formationParams, computeStanceSummary(selection, world.entities));
  groupBadges.update(world, camera, selection, controlGroups);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
}

void start();
