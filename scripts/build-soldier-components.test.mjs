import { describe, expect, it } from 'vitest';
import {
  isMultiFrameOverride,
  frameSliceOverride,
  frameCount,
} from './build-soldier-components.mjs';

describe('build-soldier-components multi-frame helpers', () => {
  it('detects single-frame override (string[] per dir)', () => {
    const override = { S: ['layer-a', 'layer-b'] };
    expect(isMultiFrameOverride(override)).toBe(false);
  });

  it('detects multi-frame override (string[][] per dir)', () => {
    const override = { S: [['layer-a'], ['layer-b']] };
    expect(isMultiFrameOverride(override)).toBe(true);
  });

  it('frameCount returns the max length across dirs', () => {
    const override = { S: [['a'], ['b'], ['c']], N: [['x'], ['y']] };
    expect(frameCount(override)).toBe(3);
  });

  it('frameSliceOverride extracts the i-th frame per dir', () => {
    const override = { S: [['a0'], ['a1']], N: [['b0'], ['b1']] };
    expect(frameSliceOverride(override, 0)).toEqual({ S: ['a0'], N: ['b0'] });
    expect(frameSliceOverride(override, 1)).toEqual({ S: ['a1'], N: ['b1'] });
  });

  it('frameSliceOverride clamps to the last available frame for short dirs', () => {
    const override = { S: [['a0'], ['a1'], ['a2']], N: [['b0'], ['b1']] };
    expect(frameSliceOverride(override, 2)).toEqual({ S: ['a2'], N: ['b1'] });
  });

  // Per-pose weapon attachment wraps a facing's frames in `{ layers, weapon }`.
  // Multi-frame helpers must look through the wrapper or the facing silently
  // collapses to its idle layers on every frame.
  it('detects multi-frame override when frames are wrapped in {layers, weapon}', () => {
    const override = {
      S: { layers: [['a0'], ['a1']], weapon: { x: 0, y: 0, rot: 0 } },
    };
    expect(isMultiFrameOverride(override)).toBe(true);
    expect(frameCount(override)).toBe(2);
  });

  it('frameSliceOverride extracts frames from a {layers, weapon} wrapper', () => {
    const override = {
      N: [['n0'], ['n1']],
      S: { layers: [['s0'], ['s1']], weapon: { x: 0, y: 0, rot: 0 } },
    };
    expect(frameSliceOverride(override, 0)).toEqual({ N: ['n0'], S: ['s0'] });
    expect(frameSliceOverride(override, 1)).toEqual({ N: ['n1'], S: ['s1'] });
  });
});
