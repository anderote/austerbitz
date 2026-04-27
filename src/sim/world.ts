import { createEntities, type Entities } from './entities';
import { createGrid, gridRebuild, type Grid } from './spatial/grid';
import { createRng, type Rng } from '../util/rng';
import { createBloodSplats, type BloodSplats } from './blood-splats';

export type System = (world: World, dt: number) => void;

export interface WorldConfig {
  seed: number;
  capacity: number;
  mapSize: number;       // square map, world units (meters)
  cellSize?: number;
}

export type Order =
  | { kind: 'move'; targetX: number; targetY: number }
  | { kind: 'attack'; targetId: number }
  | { kind: 'attack-move'; targetX: number; targetY: number }
  | { kind: 'stop' };

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
}

export function createWorld(cfg: WorldConfig): World {
  const cellSize = cfg.cellSize ?? 2;
  return {
    cfg,
    entities: createEntities(cfg.capacity),
    grid: createGrid({
      minX: 0, minY: 0,
      maxX: cfg.mapSize, maxY: cfg.mapSize,
      cellSize,
      capacity: cfg.capacity,
    }),
    rng: createRng(cfg.seed),
    tickCount: 0,
    simTime: 0,
    systems: [],
    orderQueue: new Map(),
    bloodSplats: createBloodSplats(4096),
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
