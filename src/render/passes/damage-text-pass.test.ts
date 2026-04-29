import { describe, it, expect } from 'vitest';
import {
  createDamageTexts,
  spawnDamageText,
} from '../../fx/damage-texts/damage-texts';
import {
  computeDamageTextInstances,
  createDamageTextInstances,
  DIGIT_STRIDE_WORLD,
} from './damage-text-pass';

describe('computeDamageTextInstances', () => {
  it('empty pool produces no instances', () => {
    const d = createDamageTexts(8);
    const out = createDamageTextInstances(24);
    computeDamageTextInstances(d, out);
    expect(out.count).toBe(0);
  });

  it('single-digit (value=7) produces 1 instance with digit=7 and zero x-offset', () => {
    const d = createDamageTexts(8);
    const id = spawnDamageText(d, 100, 50, 7);
    const out = createDamageTextInstances(24);
    computeDamageTextInstances(d, out);
    expect(out.count).toBe(1);
    expect(out.digit[0]).toBe(7);
    // Single digit centered: pos.x = posX (no offset).
    expect(out.pos[0]).toBeCloseTo(d.posX[id]!, 5);
    expect(out.pos[1]).toBeCloseTo(d.posY[id]!, 5);
  });

  it('two-digit (value=42) produces 2 instances with digits [4, 2] symmetric around center', () => {
    const d = createDamageTexts(8);
    const id = spawnDamageText(d, 100, 50, 42);
    const out = createDamageTextInstances(24);
    computeDamageTextInstances(d, out);
    expect(out.count).toBe(2);
    expect(out.digit[0]).toBe(4);
    expect(out.digit[1]).toBe(2);
    // Symmetric: x offsets are -0.5*stride and +0.5*stride.
    const cx = d.posX[id]!;
    expect(out.pos[0]).toBeCloseTo(cx - 0.5 * DIGIT_STRIDE_WORLD, 5);
    expect(out.pos[2]).toBeCloseTo(cx + 0.5 * DIGIT_STRIDE_WORLD, 5);
  });

  it('three-digit (value=999) produces 3 instances with digits [9, 9, 9]', () => {
    const d = createDamageTexts(8);
    const id = spawnDamageText(d, 0, 0, 999);
    const out = createDamageTextInstances(24);
    computeDamageTextInstances(d, out);
    expect(out.count).toBe(3);
    expect(out.digit[0]).toBe(9);
    expect(out.digit[1]).toBe(9);
    expect(out.digit[2]).toBe(9);
    // Symmetric around center: offsets are -stride, 0, +stride.
    const cx = d.posX[id]!;
    expect(out.pos[0]).toBeCloseTo(cx - DIGIT_STRIDE_WORLD, 5);
    expect(out.pos[2]).toBeCloseTo(cx, 5);
    expect(out.pos[4]).toBeCloseTo(cx + DIGIT_STRIDE_WORLD, 5);
  });

  it('mixed pool [7, 42, 999] yields 1+2+3 = 6 instances total', () => {
    const d = createDamageTexts(8);
    spawnDamageText(d, 0, 0, 7);
    spawnDamageText(d, 0, 0, 42);
    spawnDamageText(d, 0, 0, 999);
    const out = createDamageTextInstances(24);
    computeDamageTextInstances(d, out);
    expect(out.count).toBe(6);
  });

  it('digit extraction is left-to-right (value=305 → [3, 0, 5])', () => {
    const d = createDamageTexts(8);
    spawnDamageText(d, 0, 0, 305);
    const out = createDamageTextInstances(24);
    computeDamageTextInstances(d, out);
    expect(out.count).toBe(3);
    expect(out.digit[0]).toBe(3);
    expect(out.digit[1]).toBe(0);
    expect(out.digit[2]).toBe(5);
  });

  it('alpha is 1.0 at full life and ramps to 0 across the last 30% of life', () => {
    const d = createDamageTexts(4);
    const id = spawnDamageText(d, 0, 0, 1);
    const out = createDamageTextInstances(8);

    // Full life → alpha = 1.
    computeDamageTextInstances(d, out);
    expect(out.alpha[0]).toBeCloseTo(1.0, 5);

    // Halfway through life (50%) → still capped at 1.
    d.life[id] = d.lifeMax[id]! * 0.5;
    computeDamageTextInstances(d, out);
    expect(out.alpha[0]).toBeCloseTo(1.0, 5);

    // 15% of life remaining → alpha = 0.5.
    d.life[id] = d.lifeMax[id]! * 0.15;
    computeDamageTextInstances(d, out);
    expect(out.alpha[0]).toBeCloseTo(0.5, 5);

    // 0 life → alpha = 0.
    d.life[id] = 0;
    computeDamageTextInstances(d, out);
    expect(out.alpha[0]).toBeCloseTo(0, 5);
  });

  it('count resets across calls (no accumulation)', () => {
    const d = createDamageTexts(4);
    spawnDamageText(d, 0, 0, 5);
    const out = createDamageTextInstances(24);
    computeDamageTextInstances(d, out);
    expect(out.count).toBe(1);
    computeDamageTextInstances(d, out);
    expect(out.count).toBe(1);
  });
});
