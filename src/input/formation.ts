import type { Vec2 } from '../util/math';
import type { World } from '../sim/world';
import { getUnitKindByIndex } from '../data/units';
import { isDead } from '../sim/entities';

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
  /** Multiplier on each unit's per-axis spacing. Default 1. */
  spacingMult?: number;
  /** When non-null, fix rank count and derive frontage from N/ranks instead of dragLen. Default null. */
  ranksOverride?: number | null;
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

  const mult = input.spacingMult ?? 1;
  spacingX *= mult;
  spacingY *= mult;

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
  let frontCount: number;
  let ranks: number;
  if (input.ranksOverride != null && N > 0) {
    ranks = Math.min(Math.max(1, input.ranksOverride), N);
    frontCount = Math.ceil(N / ranks);
  } else {
    frontCount = Math.max(1, Math.min(N, Math.floor(dragLen / spacingX) + 1));
    ranks = Math.ceil(N / frontCount);
  }

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

// Threshold under which we run the O(N³) Hungarian matcher. At N=256 the
// inner loops execute ~1.7e7 ops which still completes in well under a frame.
// Above this we fall back to lateral-sort, whose O(N log N) cost stays cheap.
const HUNGARIAN_MAX_N = 256;

// Lateral-sort assignment: sort both units and slots by lateral position along
// the formation's facing axis (drag direction), tiebreak by depth (front rank
// first), and match by index. Guarantees no left/right crossings and biases
// each unit toward marching forward into its column rather than across the
// line. Used as a fast fallback for large selections where Hungarian's O(N³)
// cost would be prohibitive.
function assignByLateralSort(
  units: FormationUnit[],
  slots: Vec2[],
  forward: Vec2,
): Vec2[] {
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

// Hungarian algorithm (Jonker–Volgenant style O(N³) shortest-augmenting-path
// with potentials). Given an NxN cost matrix flattened row-major, returns
// `assignment[i] = j` meaning unit i is matched to slot j. Squared distances
// are passed in by caller — algorithm itself is metric-agnostic.
function hungarian(cost: Float64Array, N: number): Int32Array {
  // 1-indexed internally (index 0 reserved as the sentinel "unmatched row").
  const u = new Float64Array(N + 1);
  const v = new Float64Array(N + 1);
  const p = new Int32Array(N + 1);
  const way = new Int32Array(N + 1);
  const minv = new Float64Array(N + 1);
  const used = new Uint8Array(N + 1);
  const INF = Number.POSITIVE_INFINITY;

  for (let i = 1; i <= N; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(INF);
    used.fill(0);

    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = -1;
      const rowBase = (i0 - 1) * N;
      for (let j = 1; j <= N; j++) {
        if (used[j]) continue;
        const cur = cost[rowBase + (j - 1)]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= N; j++) {
        if (used[j]) {
          u[p[j]!] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0]! !== 0);

    while (j0 !== 0) {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    }
  }

  const result = new Int32Array(N);
  for (let j = 1; j <= N; j++) {
    if (p[j] !== 0) result[p[j]! - 1] = j - 1;
  }
  return result;
}

function assignByHungarian(units: FormationUnit[], slots: Vec2[]): Vec2[] {
  const N = units.length;
  if (N === 0) return [];
  if (N === 1) return [slots[0]!];

  const cost = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    const ux = units[i]!.x;
    const uy = units[i]!.y;
    const base = i * N;
    for (let j = 0; j < N; j++) {
      const ddx = ux - slots[j]!.x;
      const ddy = uy - slots[j]!.y;
      cost[base + j] = ddx * ddx + ddy * ddy;
    }
  }

  const assignment = hungarian(cost, N);
  const out: Vec2[] = new Array(N);
  for (let i = 0; i < N; i++) out[i] = slots[assignment[i]!]!;
  return out;
}

// Assign each unit to a slot. For small selections (N ≤ HUNGARIAN_MAX_N) we
// run Hungarian with squared-distance cost for a globally-minimum total
// travel — important so already-positioned soldiers don't shuffle around
// during row↔column reshapes. For larger selections we fall back to the
// O(N log N) lateral-sort heuristic.
export function assignFormationSlots(
  units: FormationUnit[],
  slots: Vec2[],
  forward: Vec2,
): Vec2[] {
  if (units.length !== slots.length) {
    throw new Error(`assignFormationSlots: length mismatch (${units.length} vs ${slots.length})`);
  }
  const N = units.length;
  if (N === 0) return [];
  if (N <= HUNGARIAN_MAX_N) return assignByHungarian(units, slots);
  return assignByLateralSort(units, slots, forward);
}

/**
 * Build a synthetic (startW, endW) for re-forming a selection in place at its
 * current centroid, facing `forwardW`, with frontage chosen so all N units
 * fit in `ranks` ranks at `spacingX * spacingMult`.
 *
 * `computeFormationSlots` interprets drag direction as the front-rank axis;
 * the perpendicular is depth. So the synthetic drag lies along perp(forwardW).
 */
export function syntheticFormationDrag(
  units: FormationUnit[],
  forwardW: Vec2,
  ranks: number,
  spacingMult: number,
  centroid?: Vec2,
): { startW: Vec2; endW: Vec2 } {
  const N = units.length;
  if (N === 0) return { startW: { x: 0, y: 0 }, endW: { x: 0, y: 0 } };

  let cx: number, cy: number;
  if (centroid) {
    cx = centroid.x;
    cy = centroid.y;
  } else {
    cx = 0; cy = 0;
    for (const u of units) { cx += u.x; cy += u.y; }
    cx /= N; cy /= N;
  }

  let spacingX = 0;
  for (const u of units) if (u.spacingX > spacingX) spacingX = u.spacingX;
  if (spacingX <= 0) spacingX = 1;
  spacingX *= spacingMult;

  const r = Math.max(1, Math.min(ranks, N));
  const frontCount = Math.ceil(N / r);
  const halfFront = ((frontCount - 1) * spacingX) / 2;

  const dx = -forwardW.y;
  const dy = forwardW.x;

  // When frontCount == 1, halfFront == 0 → both endpoints collapse to the
  // centroid, and computeFormationSlots' dragLen<eps fallback would lose our
  // facing. Emit a tiny offset along dragDir to preserve `forward`.
  const eps = 1e-3;
  const off = halfFront < eps ? eps : halfFront;

  return {
    startW: { x: cx - dx * off, y: cy - dy * off },
    endW:   { x: cx + dx * off, y: cy + dy * off },
  };
}

/**
 * Estimate how many ranks the current unit positions form, by projecting onto
 * the facing direction (depth axis) and clustering at half-spacingY tolerance.
 * Used so changing spacing preserves the current rank ratio when the player
 * has not set an explicit rank count.
 */
export function inferRanksFromPositions(units: FormationUnit[], forwardW: Vec2): number {
  const N = units.length;
  if (N === 0) return 1;
  let spacingY = 0;
  for (const u of units) if (u.spacingY > spacingY) spacingY = u.spacingY;
  if (spacingY <= 0) spacingY = 1;
  const fx = forwardW.x, fy = forwardW.y;
  const depths = units.map(u => u.x * fx + u.y * fy).sort((a, b) => a - b);
  const tol = spacingY * 0.5;
  let ranks = 1;
  for (let i = 1; i < depths.length; i++) {
    if (depths[i]! - depths[i - 1]! > tol) ranks++;
  }
  return Math.max(1, Math.min(ranks, N));
}

/**
 * Materialize the alive selection into FormationUnit records, pulling per-kind
 * spacing from `data/units`. Pure read of world state.
 */
export function liveFormationUnits(world: World, ids: Iterable<number>): FormationUnit[] {
  const out: FormationUnit[] = [];
  const e = world.entities;
  for (const id of ids) {
    if (e.alive[id] !== 1) continue;
    if (isDead(e, id)) continue;
    const kind = getUnitKindByIndex(e.kindId[id]!);
    out.push({
      id,
      x: e.posX[id]!,
      y: e.posY[id]!,
      spacingX: kind.baseStats.formationSpacing.x,
      spacingY: kind.baseStats.formationSpacing.y,
    });
  }
  return out;
}
