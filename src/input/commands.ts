import type { World } from '../sim/world';
import type { Selection } from './selection';
import type { Vec2 } from '../util/math';

export function issueMoveOrder(world: World, sel: Selection, target: Vec2): void {
  if (sel.ids.size === 0) return;
  // Spread the destination into a small grid so units don't all stack
  const ids = Array.from(sel.ids).filter(id => world.entities.alive[id] === 1);
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  const spacing = 1.4;
  const half = (cols - 1) * spacing * 0.5;
  ids.forEach((id, i) => {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    const tx = target.x + cx * spacing - half;
    const ty = target.y + cy * spacing - half;
    world.orders.set(id, { kind: 'move', targetX: tx, targetY: ty });
  });
}
