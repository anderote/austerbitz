import { describe, it, expect } from 'vitest';
import { packRects, poseCellUv, pickPoseUv, type PoseAtlas } from './atlas';
import { Pose } from './pose-config';
import { buildDirLookup } from './resolver';

describe('packRects', () => {
  it('returns 1x1 dims on empty input', () => {
    const r = packRects([]);
    expect(r.rects).toHaveLength(0);
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });

  it('places rects without overlap', () => {
    const inputs = [
      { id: 0, w: 10, h: 20 },
      { id: 1, w: 30, h: 15 },
      { id: 2, w: 8, h: 8 },
      { id: 3, w: 12, h: 18 },
    ];
    const r = packRects(inputs, 64);
    expect(r.rects).toHaveLength(4);
    for (let i = 0; i < r.rects.length; i++) {
      for (let j = i + 1; j < r.rects.length; j++) {
        const a = r.rects[i]!;
        const b = r.rects[j]!;
        const overlap = !(
          a.px + a.w <= b.px ||
          b.px + b.w <= a.px ||
          a.py + a.h <= b.py ||
          b.py + b.h <= a.py
        );
        expect(overlap).toBe(false);
      }
    }
    // total dims are positive and >= largest dimensions
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it('wraps to a new shelf when row exceeds maxWidth', () => {
    const inputs = [
      { id: 0, w: 40, h: 10 },
      { id: 1, w: 40, h: 10 },
      { id: 2, w: 40, h: 10 },
    ];
    const r = packRects(inputs, 64);
    // Each rect is 40 wide, max width 64 → only one fits per row.
    const yValues = r.rects.map((rect) => rect.py).sort((a, b) => a - b);
    expect(new Set(yValues).size).toBe(3);
    expect(r.height).toBeGreaterThanOrEqual(30);
  });

  it('throws when a rect is wider than max width', () => {
    expect(() => packRects([{ id: 0, w: 2048, h: 10 }], 1024)).toThrow(
      /pose sprite too large/,
    );
  });

  it('preserves all input ids', () => {
    const inputs = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      w: 5 + (i % 3) * 2,
      h: 6 + (i % 4),
    }));
    const r = packRects(inputs, 32);
    const ids = r.rects.map((p) => p.id).sort((a, b) => a - b);
    expect(ids).toEqual(inputs.map((p) => p.id));
  });
});

describe('poseCellUv', () => {
  it('applies half-texel inset', () => {
    const rect = { px: 0, py: 0, w: 10, h: 10 };
    const [u0, v0, us, vs] = poseCellUv(rect, 0, 100, 100);
    expect(u0).toBeCloseTo(0.5 / 100, 6);
    expect(v0).toBeCloseTo(0.5 / 100, 6);
    expect(us).toBeCloseTo(10 / 100 - 1 / 100, 6);
    expect(vs).toBeCloseTo(10 / 100 - 1 / 100, 6);
  });

  it('offsets v by poseAtlasY', () => {
    const rect = { px: 5, py: 7, w: 4, h: 4 };
    const [, v0] = poseCellUv(rect, 50, 100, 100);
    expect(v0).toBeCloseTo((50 + 7) / 100 + 0.5 / 100, 6);
  });
});

describe('pickPoseUv', () => {
  function makeAtlas(): PoseAtlas {
    const cells = new Map<string, Map<number, Map<string, { px: number; py: number; w: number; h: number }[][]>>>();
    const lineMap = new Map<number, Map<string, { px: number; py: number; w: number; h: number }[][]>>();
    const idleDirs = new Map<string, { px: number; py: number; w: number; h: number }[][]>();
    idleDirs.set('S', [[{ px: 0, py: 0, w: 10, h: 10 }]]);
    idleDirs.set('N', [[{ px: 10, py: 0, w: 10, h: 10 }]]);
    lineMap.set(Pose.idle, idleDirs);
    cells.set('line-infantry', lineMap);

    const dirLookup = new Map<string, Map<number, string[]>>();
    const lineLookup = new Map<number, string[]>();
    lineLookup.set(Pose.idle, buildDirLookup(['N', 'S']) as string[]);
    dirLookup.set('line-infantry', lineLookup);

    return { pixels: new Uint8Array(4), width: 100, height: 100, cells, dirLookup };
  }

  it('returns null for unknown kind', () => {
    const a = makeAtlas();
    expect(pickPoseUv(a, 'unknown', Pose.idle, 1, 0, 0, 0, 100, 100)).toBeNull();
  });

  it('falls back from missing pose to idle', () => {
    const a = makeAtlas();
    const uv = pickPoseUv(a, 'line-infantry', Pose.walking, 5, 0, 0, 0, 100, 100);
    expect(uv).not.toBeNull();
  });

  it('returns null when missing pose AND idle is missing', () => {
    const a = makeAtlas();
    a.cells.get('line-infantry')!.delete(Pose.idle);
    expect(pickPoseUv(a, 'line-infantry', Pose.walking, 5, 0, 0, 0, 100, 100)).toBeNull();
  });

  it('uses clipIdx modulo clip count', () => {
    const a = makeAtlas();
    const uv = pickPoseUv(a, 'line-infantry', Pose.idle, 1, 999, 0, 0, 100, 100);
    expect(uv).not.toBeNull();
  });
});
