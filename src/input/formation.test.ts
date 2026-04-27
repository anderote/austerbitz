import { describe, it, expect } from 'vitest';
import { computeFormationSlots, assignFormationSlots } from './formation';

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
});
