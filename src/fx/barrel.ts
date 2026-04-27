import type { Entities } from '../sim/entities';
import { getUnitKindByIndex } from '../data/units';

export interface BarrelTip {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirY: number;
}

/**
 * World-space launch point and aim direction for the entity's weapon.
 * Reads pos + facing + per-kind barrelOffset and composes them.
 *
 * facing: Uint8 0..7 representing 8 compass directions starting east, going CCW
 * (0=E, 1=NE, 2=N, 3=NW, 4=W, 5=SW, 6=S, 7=SE).
 */
export function barrelTip(e: Entities, id: number): BarrelTip {
  const facing = e.facing[id]!;
  const theta = (facing * Math.PI) / 4;
  const dirX = Math.cos(theta);
  const dirY = Math.sin(theta);

  const kind = getUnitKindByIndex(e.kindId[id]!);
  const offset = kind.barrelOffset;

  // forward = (dirX, dirY); side = (-dirY, dirX) (90° CCW from forward)
  const x = e.posX[id]! + dirX * offset.forward + -dirY * offset.side;
  const y = e.posY[id]! + dirY * offset.forward + dirX * offset.side;
  const z = offset.height;

  return { x, y, z, dirX, dirY };
}
