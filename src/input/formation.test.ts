import { describe, it, expect } from 'vitest';
import { computeFormationSlots, assignFormationSlots, syntheticFormationDrag, inferRanksFromPositions, computeMarchSlots, type FormationUnit } from './formation';
import type { Vec2 } from '../util/math';
import { createWorld } from '../sim/world';
import { allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { createFormationParams } from './formation-params';

describe('computeFormationSlots', () => {
  it('single unit, zero-length drag → one slot at midDrag', () => {
    const r = computeFormationSlots({
      units: [{ id: 0, x: 10, y: 10, spacingX: 1, spacingY: 1 }],
      startW: { x: 50, y: 50 },
      endW: { x: 50, y: 50 },
    });
    expect(r.slots.length).toBe(1);
    expect(r.slots[0]!.x).toBeCloseTo(50);
    expect(r.slots[0]!.y).toBeCloseTo(50);
  });

  it('drag length spans 2x spacingX with 9 units → frontCount=3, ranks=3', () => {
    const units = Array.from({ length: 9 }, (_, i) => ({
      id: i, x: 0, y: -10, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units,
      startW: { x: -1, y: 0 },
      endW: { x: 1, y: 0 }, // dragLen = 2 → frontCount = floor(2/1)+1 = 3
    });
    expect(r.slots.length).toBe(9);
    expect(r.slots[0]!.x).toBeCloseTo(-1);
    expect(r.slots[1]!.x).toBeCloseTo(0);
    expect(r.slots[2]!.x).toBeCloseTo(1);
  });

  it('partial last rank fills out from the middle (centered)', () => {
    const units = Array.from({ length: 10 }, (_, i) => ({
      id: i, x: 0, y: -10, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units,
      startW: { x: -1, y: 0 },
      endW: { x: 1, y: 0 },
    });
    expect(r.slots.length).toBe(10);
    expect(r.slots[9]!.x).toBeCloseTo(0);
  });

  it('depth direction is fixed by drag direction, not unit position', () => {
    const units = Array.from({ length: 4 }, (_, i) => ({
      id: i, x: 0, y: -10, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units,
      startW: { x: -1, y: 0 },
      endW: { x: 1, y: 0 },
    });
    for (const s of r.slots) expect(s.y).toBeGreaterThanOrEqual(0);

    const unitsOpposite = Array.from({ length: 4 }, (_, i) => ({
      id: i, x: 0, y: 10, spacingX: 1, spacingY: 1,
    }));
    const r2 = computeFormationSlots({
      units: unitsOpposite,
      startW: { x: -1, y: 0 },
      endW: { x: 1, y: 0 },
    });
    for (const s of r2.slots) expect(s.y).toBeGreaterThanOrEqual(0);
  });

  it('mixed-kind spacing uses max', () => {
    const units = [
      { id: 0, x: 0, y: -10, spacingX: 1, spacingY: 1 },
      { id: 1, x: 0, y: -10, spacingX: 3, spacingY: 1 },
    ];
    const r = computeFormationSlots({
      units,
      startW: { x: -2, y: 0 },
      endW: { x: 2, y: 0 },
    });
    expect(r.slots.length).toBe(2);
    expect(r.slots[1]!.x - r.slots[0]!.x).toBeCloseTo(3);
  });
});

describe('assignFormationSlots', () => {
  const fwdX = { x: 1, y: 0 };

  it('linear units → linear slots produces monotonic mapping', () => {
    const units = [
      { id: 10, x: 0, y: 0, spacingX: 1, spacingY: 1 },
      { id: 11, x: 1, y: 0, spacingX: 1, spacingY: 1 },
      { id: 12, x: 2, y: 0, spacingX: 1, spacingY: 1 },
      { id: 13, x: 3, y: 0, spacingX: 1, spacingY: 1 },
    ];
    const slots = [
      { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 },
    ];
    const out = assignFormationSlots(units, slots, fwdX);
    expect(out.length).toBe(4);
    expect(out[0]).toEqual({ x: 0, y: 5 });
    expect(out[1]).toEqual({ x: 1, y: 5 });
    expect(out[2]).toEqual({ x: 2, y: 5 });
    expect(out[3]).toEqual({ x: 3, y: 5 });
  });

  it('returns one slot per unit, all distinct', () => {
    const units = Array.from({ length: 5 }, (_, i) => ({
      id: i, x: i, y: i, spacingX: 1, spacingY: 1,
    }));
    const slots = Array.from({ length: 5 }, (_, i) => ({ x: i + 10, y: i + 10 }));
    const out = assignFormationSlots(units, slots, fwdX);
    expect(out.length).toBe(5);
    const seen = new Set(out.map(s => `${s.x},${s.y}`));
    expect(seen.size).toBe(5);
  });

  it('shuffled units → no left/right crossings (lateral order preserved)', () => {
    // Units scrambled along the lateral axis (drag direction = +x).
    const units = [
      { id: 0, x: 2, y: 0, spacingX: 1, spacingY: 1 },
      { id: 1, x: 0, y: 0, spacingX: 1, spacingY: 1 },
      { id: 2, x: 3, y: 0, spacingX: 1, spacingY: 1 },
      { id: 3, x: 1, y: 0, spacingX: 1, spacingY: 1 },
    ];
    const slots = [
      { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 },
    ];
    const out = assignFormationSlots(units, slots, fwdX);
    // Each unit should land at the slot with matching lateral coordinate.
    expect(out[0]).toEqual({ x: 2, y: 5 });
    expect(out[1]).toEqual({ x: 0, y: 5 });
    expect(out[2]).toEqual({ x: 3, y: 5 });
    expect(out[3]).toEqual({ x: 1, y: 5 });
  });

  it('within a column, frontmost unit takes front rank', () => {
    // Single column, two ranks. Drag along +x means depth axis = +y.
    // Smaller y = "frontmost"; front rank slot is at y=0, back rank at y=1.
    const units = [
      { id: 0, x: 0, y: 3, spacingX: 1, spacingY: 1 }, // farther back
      { id: 1, x: 0, y: 1, spacingX: 1, spacingY: 1 }, // closer to front
    ];
    const slots = [
      { x: 0, y: 0 }, // front rank
      { x: 0, y: 1 }, // back rank
    ];
    const out = assignFormationSlots(units, slots, fwdX);
    expect(out[1]).toEqual({ x: 0, y: 0 }); // closer unit → front
    expect(out[0]).toEqual({ x: 0, y: 1 }); // farther unit → back
  });

  it('flipping forward direction does not swap unit→slot sides (line pivots in place)', () => {
    // Units south of the formation line; slots on it. Lateral axis runs along
    // x. Whether the line "faces" +y (forward=+x) or −y (forward=−x), each
    // unit should walk into the slot directly above it — no mass crossover.
    const units = [
      { id: 0, x: 0, y: -5, spacingX: 1, spacingY: 1 },
      { id: 1, x: 1, y: -5, spacingX: 1, spacingY: 1 },
    ];
    const slots = [{ x: 0, y: 0 }, { x: 1, y: 0 }];

    const outForward = assignFormationSlots(units, slots, { x: 1, y: 0 });
    expect(outForward[0]).toEqual({ x: 0, y: 0 });
    expect(outForward[1]).toEqual({ x: 1, y: 0 });

    const outReversed = assignFormationSlots(units, slots, { x: -1, y: 0 });
    expect(outReversed[0]).toEqual({ x: 0, y: 0 });
    expect(outReversed[1]).toEqual({ x: 1, y: 0 });
  });

  it('already-positioned units get identity assignment (zero travel)', () => {
    // Slots laid out in a 3×3 grid; units sitting exactly on those slot
    // positions but enumerated in scrambled order. Optimal matching = each
    // unit takes the slot it's already standing on (cost 0). Lateral-sort
    // would force them into row-major order along x and shuffle them.
    const slotPositions: Vec2[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        slotPositions.push({ x: c, y: r });
      }
    }
    // Scramble unit order via a fixed permutation.
    const perm = [4, 0, 7, 2, 8, 1, 5, 3, 6];
    const units = perm.map((idx, i) => ({
      id: i,
      x: slotPositions[idx]!.x,
      y: slotPositions[idx]!.y,
      spacingX: 1,
      spacingY: 1,
    }));

    const out = assignFormationSlots(units, slotPositions, fwdX);
    let totalCost = 0;
    for (let i = 0; i < units.length; i++) {
      const dx = units[i]!.x - out[i]!.x;
      const dy = units[i]!.y - out[i]!.y;
      totalCost += dx * dx + dy * dy;
      expect(out[i]!.x).toBeCloseTo(units[i]!.x);
      expect(out[i]!.y).toBeCloseTo(units[i]!.y);
    }
    expect(totalCost).toBeCloseTo(0);

    // Sanity: every slot used exactly once.
    const seen = new Set(out.map(s => `${s.x},${s.y}`));
    expect(seen.size).toBe(slotPositions.length);
  });

  it('square → narrow column produces total cost ≤ naive lateral-sort', () => {
    // 4×4 square of units centered around the origin.
    const units: FormationUnit[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        units.push({
          id: r * 4 + c,
          x: c - 1.5,
          y: r - 1.5,
          spacingX: 1,
          spacingY: 1,
        });
      }
    }
    // 1-wide × 16-deep column of slots, far ahead along +y.
    const slots: Vec2[] = [];
    for (let r = 0; r < 16; r++) slots.push({ x: 0, y: 20 + r });

    const out = assignFormationSlots(units, slots, fwdX);

    // Total squared cost from the actual assignment.
    let hungarianCost = 0;
    for (let i = 0; i < units.length; i++) {
      const dx = units[i]!.x - out[i]!.x;
      const dy = units[i]!.y - out[i]!.y;
      hungarianCost += dx * dx + dy * dy;
    }

    // Naive lateral-sort matching: sort both by lateral coord (drag = +x, so
    // lateral = x), tiebreak by depth (= y), match by index.
    const sortKey = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    };
    const unitsSorted = units.map((u, i) => ({ i, x: u.x, y: u.y })).sort(sortKey);
    const slotsSorted = slots.map((s, i) => ({ i, x: s.x, y: s.y })).sort(sortKey);
    let lateralCost = 0;
    for (let k = 0; k < units.length; k++) {
      const u = unitsSorted[k]!;
      const s = slotsSorted[k]!;
      const dx = u.x - s.x;
      const dy = u.y - s.y;
      lateralCost += dx * dx + dy * dy;
    }

    expect(hungarianCost).toBeLessThanOrEqual(lateralCost);
    // Each slot used exactly once.
    const seen = new Set(out.map(s => `${s.x},${s.y}`));
    expect(seen.size).toBe(slots.length);
  });
});

describe('computeFormationSlots — spacingMult', () => {
  it('doubles slot spacing when spacingMult=2', () => {
    const units = Array.from({ length: 4 }, (_, i) => ({
      id: i, x: 0, y: 0, spacingX: 1, spacingY: 1,
    }));
    const a = computeFormationSlots({
      units, startW: { x: 0, y: 0 }, endW: { x: 4, y: 0 },
    });
    const b = computeFormationSlots({
      units, startW: { x: 0, y: 0 }, endW: { x: 4, y: 0 }, spacingMult: 2,
    });
    // Distance between adjacent slots in front rank doubles.
    const da = Math.hypot(a.slots[1]!.x - a.slots[0]!.x, a.slots[1]!.y - a.slots[0]!.y);
    const db = Math.hypot(b.slots[1]!.x - b.slots[0]!.x, b.slots[1]!.y - b.slots[0]!.y);
    expect(db).toBeCloseTo(da * 2);
  });
});

describe('computeFormationSlots — ranksOverride', () => {
  it('forces N=20, ranks=4 → frontCount=5', () => {
    const units = Array.from({ length: 20 }, (_, i) => ({
      id: i, x: 0, y: 0, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units, startW: { x: 0, y: 0 }, endW: { x: 0.5, y: 0 }, ranksOverride: 4,
    });
    expect(r.slots).toHaveLength(20);
    // First rank: 5 slots, all at depth 0; check depth groups.
    const fwd = r.forward;
    const px = -fwd.y, py = fwd.x;
    // Project each slot onto perp axis to get depth, group by depth bucket.
    const depths = new Set(r.slots.map(s => Math.round((s.x * px + s.y * py) * 1000) / 1000));
    expect(depths.size).toBe(4);
  });

  it('ranksOverride=1 yields a single line (depth=0 for all)', () => {
    const units = Array.from({ length: 6 }, (_, i) => ({
      id: i, x: 0, y: 0, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units, startW: { x: 0, y: 0 }, endW: { x: 1, y: 0 }, ranksOverride: 1,
    });
    const fwd = r.forward;
    const px = -fwd.y, py = fwd.x;
    const depths = new Set(r.slots.map(s => Math.round((s.x * px + s.y * py) * 1000) / 1000));
    expect(depths.size).toBe(1);
  });
});

describe('syntheticFormationDrag', () => {
  it('lays drag perpendicular to forward, with formation centroid on input centroid', () => {
    const units = Array.from({ length: 10 }, (_, i) => ({
      id: i, x: i, y: 0, spacingX: 1, spacingY: 1,
    }));
    const { startW, endW } = syntheticFormationDrag(units, { x: 1, y: 0 }, 2, 1);
    // forward = (1,0), perp = (0,1) → drag axis is along Y.
    // Centroid X = 4.5, Y = 0; with 2 ranks the drag midpoint sits forward of
    // centroid by halfDepth = 0.5 * spacingY * 1 = 0.5, so the FORMATION
    // centroid (front - halfDepth*forward) lands back on the input centroid.
    expect((startW.x + endW.x) / 2).toBeCloseTo(5.0); // 4.5 + 0.5
    expect((startW.y + endW.y) / 2).toBeCloseTo(0);
    expect(startW.x).toBeCloseTo(endW.x); // same X = no movement along forward
  });

  it('returns nonzero offset even when single-column to preserve facing', () => {
    const units = [{ id: 0, x: 0, y: 0, spacingX: 1, spacingY: 1 }];
    const { startW, endW } = syntheticFormationDrag(units, { x: 1, y: 0 }, 1, 1);
    expect(Math.hypot(endW.x - startW.x, endW.y - startW.y)).toBeGreaterThan(0);
  });

  it('centroid override: formation centroid lands at the override point', () => {
    const units = Array.from({ length: 6 }, (_, i) => ({
      id: i, x: i, y: i, spacingX: 1, spacingY: 1,
    }));
    const { startW, endW } = syntheticFormationDrag(
      units, { x: 1, y: 0 }, 2, 1, { x: 100, y: 200 },
    );
    // 2 ranks → drag midpoint shifted forward by halfDepth = 0.5.
    expect((startW.x + endW.x) / 2).toBeCloseTo(100.5);
    expect((startW.y + endW.y) / 2).toBeCloseTo(200);
  });

  it('keeps formation centroid stable when spacing changes', () => {
    // A 3-rank, 3-file grid in formation. Reform with two different spacings;
    // the centroid of the resulting slots should match the input centroid in
    // both cases (no leftward/forward drift on rebump).
    const units: FormationUnit[] = [];
    for (let r = 0; r < 3; r++)
      for (let f = 0; f < 3; f++)
        units.push({ id: r * 3 + f, x: f, y: r, spacingX: 1, spacingY: 1 });
    const cx = 1, cy = 1; // centroid of the 3x3 grid
    const forward = { x: 0, y: 1 };

    for (const mult of [1.0, 0.7, 1.5]) {
      const { startW, endW } = syntheticFormationDrag(units, forward, 3, mult);
      const { slots } = computeFormationSlots({
        units, startW, endW, spacingMult: mult, ranksOverride: 3,
      });
      const sx = slots.reduce((a, s) => a + s.x, 0) / slots.length;
      const sy = slots.reduce((a, s) => a + s.y, 0) / slots.length;
      expect(sx).toBeCloseTo(cx, 5);
      expect(sy).toBeCloseTo(cy, 5);
    }
  });
});

describe('inferRanksFromPositions', () => {
  it('groups units by depth projection at half-spacingY tolerance', () => {
    // forward = (0,1) so depth = y-projection. Spacing Y = 1.2 → tol = 0.6.
    // Three depth clusters at y = 0, 1.2, 2.4 → 3 ranks.
    const units: FormationUnit[] = [
      { id: 0, x: 0, y: 0,   spacingX: 1, spacingY: 1.2 },
      { id: 1, x: 1, y: 0,   spacingX: 1, spacingY: 1.2 },
      { id: 2, x: 0, y: 1.2, spacingX: 1, spacingY: 1.2 },
      { id: 3, x: 1, y: 1.2, spacingX: 1, spacingY: 1.2 },
      { id: 4, x: 0, y: 2.4, spacingX: 1, spacingY: 1.2 },
      { id: 5, x: 1, y: 2.4, spacingX: 1, spacingY: 1.2 },
    ];
    expect(inferRanksFromPositions(units, { x: 0, y: 1 })).toBe(3);
  });

  it('returns 1 for an empty selection', () => {
    expect(inferRanksFromPositions([], { x: 1, y: 0 })).toBe(1);
  });
});

function spawnLI(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const id = allocEntity(world.entities);
  world.entities.kindId[id] = getUnitKindIndex('line-infantry');
  world.entities.posX[id] = x;
  world.entities.posY[id] = y;
  return id;
}

describe('computeMarchSlots', () => {
  it('returns null on empty selection', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const r = computeMarchSlots(world, [], { x: 50, y: 0 }, createFormationParams());
    expect(r).toBeNull();
  });

  it('one alive unit returns one slot anchored at the target', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    const id = spawnLI(world, 0, 0);
    const r = computeMarchSlots(world, [id], { x: 50, y: 0 }, createFormationParams())!;
    expect(r).not.toBeNull();
    expect(r.units.length).toBe(1);
    expect(r.targets.length).toBe(1);
    expect(r.targets[0]!.x).toBeCloseTo(50, 3);
    expect(r.targets[0]!.y).toBeCloseTo(0, 3);
  });

  it('two-unit selection: forward points along centroid→target; slot centroid lands at target', () => {
    const world = createWorld({ seed: 1, capacity: 16, mapSize: 1000 });
    // Units side-by-side along the lateral axis (perpendicular to forward +x)
    // so inferRanksFromPositions sees 1 rank → all slots in a single rank.
    // With 1 rank, syntheticFormationDrag anchors the single front rank at target,
    // so the slot centroid equals target exactly.
    const a = spawnLI(world, 0, -2);
    const b = spawnLI(world, 0, 2);
    const r = computeMarchSlots(world, [a, b], { x: 100, y: 0 }, createFormationParams())!;
    expect(r.forward.x).toBeGreaterThan(0.99);
    expect(Math.abs(r.forward.y)).toBeLessThan(0.01);
    const cx = (r.targets[0]!.x + r.targets[1]!.x) / 2;
    const cy = (r.targets[0]!.y + r.targets[1]!.y) / 2;
    expect(cx).toBeCloseTo(100, 3);
    expect(cy).toBeCloseTo(0, 3);
  });
});
