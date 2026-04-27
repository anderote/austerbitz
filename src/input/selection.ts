import type { World } from '../sim/world';
import type { Vec2 } from '../util/math';
import { getUnitKindByIndex } from '../data/units';

export interface Selection {
  ids: Set<number>;
}

export interface DragRect {
  start: Vec2;       // screen
  current: Vec2;     // screen
  active: boolean;
}

export function createSelection(): Selection {
  return { ids: new Set() };
}

export function createDragRect(): DragRect {
  return {
    start: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    active: false,
  };
}

export function hitTestPoint(world: World, w: Vec2): number {
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    const kind = getUnitKindByIndex(e.kindId[i]!);
    const dx = Math.abs(w.x - e.posX[i]!);
    const dy = Math.abs(w.y - e.posY[i]!);
    if (dx <= kind.placeholderSize.w / 2 && dy <= kind.placeholderSize.h / 2) {
      return i;
    }
  }
  return -1;
}

export function hitTestRect(world: World, x0: number, y0: number, x1: number, y1: number): number[] {
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  const out: number[] = [];
  const e = world.entities;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    const x = e.posX[i]!;
    const y = e.posY[i]!;
    if (x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y) out.push(i);
  }
  return out;
}
