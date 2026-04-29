import { describe, it, expect } from 'vitest';
import { lookupEdits, setPixel, type PixelEditsTree } from './pixel-edits-overlay';

describe('pixel-edits-overlay', () => {
  it('lookupEdits returns [] for missing path', () => {
    const tree: PixelEditsTree = {};
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toEqual([]);
  });

  it('lookupEdits returns the entry array when present', () => {
    const tree: PixelEditsTree = { k: { p: { S: { c: [{ x: 1, y: 2, color: '#fff' }] } } } };
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toEqual([{ x: 1, y: 2, color: '#fff' }]);
  });

  it('setPixel creates the path and appends', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 1, y: 2, color: '#abc' });
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toEqual([{ x: 1, y: 2, color: '#abc' }]);
  });

  it('setPixel replaces an existing pixel at the same (x, y)', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 1, y: 2, color: '#aaa' });
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 1, y: 2, color: '#bbb' });
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toEqual([{ x: 1, y: 2, color: '#bbb' }]);
  });

  it('setPixel preserves other entries', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 1, y: 2, color: '#aaa' });
    setPixel(tree, 'k', 'p', 'S', 'c', { x: 3, y: 4, color: '#bbb' });
    expect(lookupEdits(tree, 'k', 'p', 'S', 'c')).toHaveLength(2);
  });
});
