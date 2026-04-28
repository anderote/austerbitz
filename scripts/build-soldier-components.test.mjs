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
});
