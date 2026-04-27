import type { World } from '../sim/world';
import type { Vec2 } from '../util/math';
import { getUnitKindByIndex } from '../data/units';

export interface Selection {
  ids: Set<number>;
}

export interface DragRect {
  // World-anchored start point: captured once at mousedown so panning leaves it on the ground.
  startWorld: Vec2;
  // Live mouse position in screen space; converted to world at consumption time so panning
  // re-maps the cursor to whatever world cell it's currently over.
  currentScreen: Vec2;
  active: boolean;
}

// Ten control groups indexed by digit 0..9.
export interface ControlGroups {
  groups: Set<number>[];
}

export interface ViewRect {
  x0: number; y0: number;
  x1: number; y1: number;
}

export interface HitOpts {
  /** If provided, only entities with this team id are considered. */
  team?: number;
}

export function createSelection(): Selection {
  return { ids: new Set() };
}

export function createDragRect(): DragRect {
  return {
    startWorld: { x: 0, y: 0 },
    currentScreen: { x: 0, y: 0 },
    active: false,
  };
}

export interface FormationDrag {
  // World-anchored start point: stays put on the ground as the camera pans.
  startWorld: Vec2;
  // Live mouse position in screen space; converted to world at consumption time.
  currentScreen: Vec2;
  active: boolean;
}

export function createFormationDrag(): FormationDrag {
  return {
    startWorld: { x: 0, y: 0 },
    currentScreen: { x: 0, y: 0 },
    active: false,
  };
}

/** World-space preview shown during an active formation drag. */
export interface FormationPreview {
  rect: { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 };
  slots: Vec2[];
}

export function createControlGroups(): ControlGroups {
  return { groups: Array.from({ length: 10 }, () => new Set<number>()) };
}

/**
 * Returns the entity whose AABB contains `w` and whose center is closest to `w`.
 * Tie-break: lower entity id.
 */
export function hitTestPoint(world: World, w: Vec2, opts: HitOpts = {}): number {
  const e = world.entities;
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] !== 1) continue;
    if (opts.team !== undefined && e.team[i] !== opts.team) continue;
    const kind = getUnitKindByIndex(e.kindId[i]!);
    const dx = w.x - e.posX[i]!;
    const dy = w.y - e.posY[i]!;
    if (Math.abs(dx) > kind.placeholderSize.w / 2) continue;
    if (Math.abs(dy) > kind.placeholderSize.h / 2) continue;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 || (d2 === bestD2 && i < best)) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

export function hitTestRect(
  world: World,
  x0: number, y0: number, x1: number, y1: number,
  opts: HitOpts = {},
): number[] {
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  const out: number[] = [];
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] !== 1) continue;
    if (opts.team !== undefined && e.team[i] !== opts.team) continue;
    const x = e.posX[i]!;
    const y = e.posY[i]!;
    if (x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y) out.push(i);
  }
  return out;
}

export function findSameKindInView(
  world: World,
  kindId: number,
  view: ViewRect,
  opts: HitOpts = {},
): number[] {
  const out: number[] = [];
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] !== 1) continue;
    if (e.kindId[i] !== kindId) continue;
    if (opts.team !== undefined && e.team[i] !== opts.team) continue;
    const x = e.posX[i]!;
    const y = e.posY[i]!;
    if (x >= view.x0 && x <= view.x1 && y >= view.y0 && y <= view.y1) out.push(i);
  }
  return out;
}
