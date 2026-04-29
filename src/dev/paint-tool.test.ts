import { describe, it, expect } from 'vitest';
import { setPixel, type PixelEditsTree } from './pixel-edits-overlay';

describe('paint pipeline', () => {
  it('a brush click writes a colored pixel into the tree', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'kit', 'idle', 'S', 'rider-torso-south', { x: 5, y: 7, color: '#abc' });
    expect(tree.kit?.idle?.S?.['rider-torso-south']).toEqual([{ x: 5, y: 7, color: '#abc' }]);
  });

  it('an erase click writes a "clear" marker', () => {
    const tree: PixelEditsTree = {};
    setPixel(tree, 'kit', 'idle', 'S', 'rider-torso-south', { x: 5, y: 7, color: 'clear' });
    expect(tree.kit?.idle?.S?.['rider-torso-south']).toEqual([{ x: 5, y: 7, color: 'clear' }]);
  });
});
