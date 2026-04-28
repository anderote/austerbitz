import { createEntities, type Entities } from './entities';
import { createGrid, gridRebuild, type Grid } from './spatial/grid';
import { createRng, type Rng } from '../util/rng';
import { createBloodSplats, type BloodSplats } from './blood-splats';
import { createDebris, type Debris } from './debris';
import { createDroppedItems, type DroppedItems } from './dropped-items';
import { createFireSignal, type FireSignal } from './fire-signal';
import type { MarchGroup } from './march-groups';

export type System = (world: World, dt: number) => void;

export interface WorldConfig {
  seed: number;
  capacity: number;
  mapSize: number;       // square map, world units (meters)
  cellSize?: number;
}

export type Order =
  | { kind: 'move'; targetX: number; targetY: number; arrived?: boolean; faceX?: number; faceY?: number }
  | { kind: 'attack'; targetId: number }
  | { kind: 'attack-move'; targetX: number; targetY: number; arrived?: boolean }
  | { kind: 'stop' }
  | { kind: 'march-formation'; targetX: number; targetY: number; groupId: number; arrived?: boolean };

export interface World {
  cfg: WorldConfig;
  entities: Entities;
  grid: Grid;
  rng: Rng;
  tickCount: number;
  simTime: number;
  systems: System[];
  /** Per-entity order queue. Front (index 0) is the active order. */
  orderQueue: Map<number, Order[]>;
  /** Per-frame blood-stain splat queue, drained by the renderer each frame. */
  bloodSplats: BloodSplats;
  /** Visual debris (gib chunks) — short-lived. */
  debris: Debris;
  /** Weapons dropped by dying units. Persists indefinitely. */
  droppedItems: DroppedItems;
  /** Per-cell-per-team most-recent-fire-tick — drives volley contagion. */
  fireSignal: FireSignal;
  /** Active march groups, keyed by groupId. Lifecycle managed by march-system. */
  marchGroups: Map<number, MarchGroup>;
  /** Monotonic counter for new march-group ids; never reused. Starts at 1 so 0 stays a sentinel. */
  nextMarchGroupId: number;
}

export function createWorld(cfg: WorldConfig): World {
  const cellSize = cfg.cellSize ?? 2;
  const grid = createGrid({
    minX: 0, minY: 0,
    maxX: cfg.mapSize, maxY: cfg.mapSize,
    cellSize,
    capacity: cfg.capacity,
  });
  return {
    cfg,
    entities: createEntities(cfg.capacity),
    grid,
    rng: createRng(cfg.seed),
    tickCount: 0,
    simTime: 0,
    systems: [],
    orderQueue: new Map(),
    bloodSplats: createBloodSplats(4096),
    debris: createDebris(256),
    droppedItems: createDroppedItems(cfg.capacity),
    marchGroups: new Map(),
    nextMarchGroupId: 1,
    fireSignal: createFireSignal(grid),
  };
}

export function rebuildGrid(world: World): void {
  const e = world.entities;
  gridRebuild(world.grid, e.aliveIds, e.count, e.posX, e.posY);
}

export function tickWorld(world: World, dt: number): void {
  rebuildGrid(world);
  for (const sys of world.systems) sys(world, dt);
  world.tickCount++;
  world.simTime += dt;
}
