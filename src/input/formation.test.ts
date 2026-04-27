import { describe, it, expect } from 'vitest';
import { computeFormationSlots } from './formation';

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

  it('partial last rank is centered', () => {
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

  it('depth direction points away from unit centroid', () => {
    const units = Array.from({ length: 4 }, (_, i) => ({
      id: i, x: 0, y: -10, spacingX: 1, spacingY: 1,
    }));
    const r = computeFormationSlots({
      units,
      startW: { x: -1, y: 0 },
      endW: { x: 1, y: 0 },
    });
    for (const s of r.slots) expect(s.y).toBeGreaterThanOrEqual(0);
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
