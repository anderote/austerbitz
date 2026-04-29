import { describe, it, expect } from 'vitest';
import {
  RAMROD_SHEET_W,
  RAMROD_SHEET_H,
  RAMROD_STEEL,
  generateRamrodSheet,
} from './ramrod-sprite';

describe('ramrod sprite', () => {
  it('has 1x5 dimensions', () => {
    expect(RAMROD_SHEET_W).toBe(1);
    expect(RAMROD_SHEET_H).toBe(5);
  });

  it('generates an opaque steel column', () => {
    const buf = generateRamrodSheet();
    expect(buf.length).toBe(RAMROD_SHEET_W * RAMROD_SHEET_H * 4);
    for (let i = 0; i < RAMROD_SHEET_H; i++) {
      const o = i * 4;
      expect(buf[o + 0]).toBe(RAMROD_STEEL[0]);
      expect(buf[o + 1]).toBe(RAMROD_STEEL[1]);
      expect(buf[o + 2]).toBe(RAMROD_STEEL[2]);
      expect(buf[o + 3]).toBe(255);
    }
  });
});
