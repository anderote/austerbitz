import type { Vec2 } from '../util/math';

export interface FormationUnit {
  id: number;
  x: number;
  y: number;
  spacingX: number;
  spacingY: number;
}

export interface FormationInput {
  units: FormationUnit[];
  startW: Vec2;
  endW: Vec2;
}

export interface FormationSlots {
  slots: Vec2[];
  rect: { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 };
  forward: Vec2;
}

export function computeFormationSlots(input: FormationInput): FormationSlots {
  const { units, startW, endW } = input;
  const N = units.length;

  // Spacing: max across selection so mixed kinds don't overlap.
  let spacingX = 0, spacingY = 0;
  for (const u of units) {
    if (u.spacingX > spacingX) spacingX = u.spacingX;
    if (u.spacingY > spacingY) spacingY = u.spacingY;
  }
  if (spacingX <= 0) spacingX = 1;
  if (spacingY <= 0) spacingY = 1;

  // Forward = drag direction, perpA = 90° left of forward.
  const dx = endW.x - startW.x;
  const dy = endW.y - startW.y;
  const dragLen = Math.hypot(dx, dy);
  const eps = 1e-6;
  const fx = dragLen > eps ? dx / dragLen : 1;
  const fy = dragLen > eps ? dy / dragLen : 0;
  const px = -fy;
  const py = fx;

  // Front rank size and depth.
  const frontCount = Math.max(1, Math.min(N, Math.floor(dragLen / spacingX) + 1));
  const ranks = Math.ceil(N / frontCount);

  // Drag midpoint; depth direction is fixed by drag direction (TW-style).
  const midX = (startW.x + endW.x) / 2;
  const midY = (startW.y + endW.y) / 2;

  // Slots: row-major, partial last rank centered (fills out from the middle).
  const slots: Vec2[] = [];
  for (let r = 0; r < ranks; r++) {
    const remaining = N - r * frontCount;
    const count = Math.min(frontCount, remaining);
    for (let f = 0; f < count; f++) {
      const fileOff = (f - (count - 1) / 2) * spacingX;
      const depthOff = r * spacingY;
      slots.push({
        x: midX + fx * fileOff + px * depthOff,
        y: midY + fy * fileOff + py * depthOff,
      });
    }
  }

  // Bounding rectangle (covers full frontCount × ranks even if last rank short).
  const halfW = (frontCount - 1) * spacingX / 2 + spacingX / 2;
  const depth = (ranks - 1) * spacingY + spacingY;
  const tl = { x: midX - fx * halfW, y: midY - fy * halfW };
  const tr = { x: midX + fx * halfW, y: midY + fy * halfW };
  const br = { x: tr.x + px * depth, y: tr.y + py * depth };
  const bl = { x: tl.x + px * depth, y: tl.y + py * depth };

  return { slots, rect: { tl, tr, br, bl }, forward: { x: fx, y: fy } };
}

// Lateral-sort assignment: sort both units and slots by lateral position along
// the formation's facing axis (drag direction), tiebreak by depth (front rank
// first), and match by index. Guarantees no left/right crossings and biases
// each unit toward marching forward into its column rather than across the line.
export function assignFormationSlots(
  units: FormationUnit[],
  slots: Vec2[],
  forward: Vec2,
): Vec2[] {
  if (units.length !== slots.length) {
    throw new Error(`assignFormationSlots: length mismatch (${units.length} vs ${slots.length})`);
  }
  const N = units.length;

  // Lateral axis = drag direction (along front rank). Depth axis = 90° left of it.
  const lx = forward.x, ly = forward.y;
  const dx = -forward.y, dy = forward.x;

  const byLateralThenDepth = (
    arr: { x: number; y: number }[],
  ) => arr.map((_, i) => i).sort((a, b) => {
    const la = arr[a]!.x * lx + arr[a]!.y * ly;
    const lb = arr[b]!.x * lx + arr[b]!.y * ly;
    if (la !== lb) return la - lb;
    const da = arr[a]!.x * dx + arr[a]!.y * dy;
    const db = arr[b]!.x * dx + arr[b]!.y * dy;
    return da - db;
  });

  const unitOrder = byLateralThenDepth(units);
  const slotOrder = byLateralThenDepth(slots);

  const out: Vec2[] = new Array(N);
  for (let k = 0; k < N; k++) {
    out[unitOrder[k]!] = slots[slotOrder[k]!]!;
  }
  return out;
}
