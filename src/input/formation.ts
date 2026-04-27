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

  // Centroid of unit positions; flip perpendicular if it points toward units.
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  if (N > 0) { cx /= N; cy /= N; }
  const midX = (startW.x + endW.x) / 2;
  const midY = (startW.y + endW.y) / 2;
  const sideDot = (midX - cx) * px + (midY - cy) * py;
  const sign = sideDot >= 0 ? 1 : -1;
  const dpx = px * sign;
  const dpy = py * sign;

  // Slots: row-major, last rank centered if partial.
  const slots: Vec2[] = [];
  for (let r = 0; r < ranks; r++) {
    const remaining = N - r * frontCount;
    const count = Math.min(frontCount, remaining);
    for (let f = 0; f < count; f++) {
      const fileOff = (f - (count - 1) / 2) * spacingX;
      const depthOff = r * spacingY;
      slots.push({
        x: midX + fx * fileOff + dpx * depthOff,
        y: midY + fy * fileOff + dpy * depthOff,
      });
    }
  }

  // Bounding rectangle (covers full frontCount × ranks even if last rank short).
  const halfW = (frontCount - 1) * spacingX / 2 + spacingX / 2;
  const depth = (ranks - 1) * spacingY + spacingY;
  const tl = { x: midX - fx * halfW, y: midY - fy * halfW };
  const tr = { x: midX + fx * halfW, y: midY + fy * halfW };
  const br = { x: tr.x + dpx * depth, y: tr.y + dpy * depth };
  const bl = { x: tl.x + dpx * depth, y: tl.y + dpy * depth };

  return { slots, rect: { tl, tr, br, bl } };
}

export function assignFormationSlots(units: FormationUnit[], slots: Vec2[]): Vec2[] {
  if (units.length !== slots.length) {
    throw new Error(`assignFormationSlots: length mismatch (${units.length} vs ${slots.length})`);
  }
  const N = units.length;
  const taken = new Uint8Array(N);
  const out: Vec2[] = new Array(N);

  // Pre-sort indices: units farthest from slot centroid pick first.
  let cx = 0, cy = 0;
  for (const s of slots) { cx += s.x; cy += s.y; }
  if (N > 0) { cx /= N; cy /= N; }
  const order = units.map((_, i) => i).sort((a, b) => {
    const da = (units[a]!.x - cx) ** 2 + (units[a]!.y - cy) ** 2;
    const db = (units[b]!.x - cx) ** 2 + (units[b]!.y - cy) ** 2;
    return db - da;
  });

  for (const i of order) {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < N; j++) {
      if (taken[j]) continue;
      const dx = units[i]!.x - slots[j]!.x;
      const dy = units[i]!.y - slots[j]!.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = j; }
    }
    taken[best] = 1;
    out[i] = slots[best]!;
  }
  return out;
}
