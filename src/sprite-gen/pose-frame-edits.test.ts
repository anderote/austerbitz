import { describe, expect, it } from 'vitest';
import {
  lookupEdits,
  applyEdits,
} from '../../scripts/lib/pose-frame-edits.mjs';

describe('lookupEdits', () => {
  it('returns [] for missing tree', () => {
    expect(lookupEdits(null, 'cuirassier', 'idle', 'S', 0, 0)).toEqual([]);
  });

  it('returns [] for missing kind/pose/dir/clip/frame', () => {
    const tree = { cuirassier: { idle: { S: { '0': { '0': [{ x: 1, y: 1, color: '#ff0000' }] } } } } };
    expect(lookupEdits(tree, 'cuirassier', 'idle', 'S', 0, 0)).toHaveLength(1);
    expect(lookupEdits(tree, 'cuirassier', 'idle', 'N', 0, 0)).toEqual([]);
    expect(lookupEdits(tree, 'cuirassier', 'walking', 'S', 0, 0)).toEqual([]);
    expect(lookupEdits(tree, 'cuirassier', 'idle', 'S', 1, 0)).toEqual([]);
    expect(lookupEdits(tree, 'cuirassier', 'idle', 'S', 0, 5)).toEqual([]);
  });

  it('returns the edit list when all keys match', () => {
    const tree = { c: { p: { D: { '0': { '2': [{ x: 5, y: 6, color: '#ababab' }] } } } } };
    expect(lookupEdits(tree, 'c', 'p', 'D', 0, 2)).toEqual([{ x: 5, y: 6, color: '#ababab' }]);
  });
});

describe('applyEdits', () => {
  function makeBuf(w = 4, h = 4) {
    return new Uint8ClampedArray(w * h * 4);
  }

  it('writes a hex color at the correct offset', () => {
    const buf = makeBuf();
    const n = applyEdits(buf, 4, 4, [{ x: 1, y: 1, color: '#ff0000' }]);
    expect(n).toBe(1);
    const idx = (1 * 4 + 1) * 4;
    expect(Array.from(buf.slice(idx, idx + 4))).toEqual([255, 0, 0, 255]);
  });

  it('handles "clear" by zeroing all 4 bytes', () => {
    const buf = makeBuf();
    for (let i = 0; i < buf.length; i++) buf[i] = 200;
    const n = applyEdits(buf, 4, 4, [{ x: 0, y: 0, color: 'clear' }]);
    expect(n).toBe(1);
    expect(Array.from(buf.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('parses #rgb shorthand', () => {
    const buf = makeBuf();
    applyEdits(buf, 4, 4, [{ x: 0, y: 0, color: '#fa0' }]);
    expect(Array.from(buf.slice(0, 4))).toEqual([255, 170, 0, 255]);
  });

  it('skips out-of-range coordinates with a warn', () => {
    const buf = makeBuf();
    const n = applyEdits(buf, 4, 4, [
      { x: 99, y: 0, color: '#fff' },
      { x: 0, y: -1, color: '#fff' },
    ]);
    expect(n).toBe(0);
  });

  it('skips bad color strings', () => {
    const buf = makeBuf();
    const n = applyEdits(buf, 4, 4, [{ x: 0, y: 0, color: 'not-a-color' }]);
    expect(n).toBe(0);
  });

  it('throws on wrong-sized buffer', () => {
    expect(() => applyEdits(new Uint8ClampedArray(10), 4, 4, [{ x: 0, y: 0, color: '#fff' }])).toThrow(/length/);
  });

  it('returns count of applied edits', () => {
    const buf = makeBuf();
    const n = applyEdits(buf, 4, 4, [
      { x: 0, y: 0, color: '#fff' },
      { x: 1, y: 1, color: '#000' },
      { x: 99, y: 0, color: '#fff' },
    ]);
    expect(n).toBe(2);
  });
});
