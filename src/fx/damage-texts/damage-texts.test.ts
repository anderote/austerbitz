import { describe, it, expect } from 'vitest';
import {
  createDamageTexts,
  spawnDamageText,
  updateDamageTexts,
  freeDamageText,
  DAMAGE_TEXT_LIFE,
  DAMAGE_TEXT_VEL_Y,
} from './damage-texts';

describe('damage-texts pool', () => {
  it('alloc → spawn advances cursor and allocates a slot', () => {
    const d = createDamageTexts(8);
    expect(d.count).toBe(0);
    expect(d.cursor).toBe(0);
    const id = spawnDamageText(d, 0, 0, 5);
    expect(id).toBe(0);
    expect(d.count).toBe(1);
    expect(d.cursor).toBe(1);
    expect(d.alive[id]).toBe(1);
    expect(d.aliveIds[0]).toBe(id);
    expect(d.aliveIdx[id]).toBe(0);
  });

  it('seeds initial state: velY, life, lifeMax, value', () => {
    const d = createDamageTexts(4);
    const id = spawnDamageText(d, 10, 20, 7);
    expect(d.velY[id]).toBeCloseTo(DAMAGE_TEXT_VEL_Y, 5);
    expect(d.life[id]).toBeCloseTo(DAMAGE_TEXT_LIFE, 5);
    expect(d.lifeMax[id]).toBeCloseTo(DAMAGE_TEXT_LIFE, 5);
    expect(d.value[id]).toBe(7);
    // posY is exactly the input (no vertical jitter).
    expect(d.posY[id]).toBeCloseTo(20, 5);
    // posX has horizontal jitter within ±0.15 of input.
    expect(Math.abs(d.posX[id]! - 10)).toBeLessThanOrEqual(0.15 + 1e-6);
  });

  it('updateDamageTexts integrates posY upward (decreasing world Y)', () => {
    const d = createDamageTexts(4);
    const id = spawnDamageText(d, 0, 0, 10);
    const y0 = d.posY[id]!;
    updateDamageTexts(d, 0.1);
    // World Y is screen-down; up-on-screen = decreasing Y.
    expect(d.posY[id]).toBeLessThan(y0);
  });

  it('frees slot when life expires', () => {
    const d = createDamageTexts(4);
    const id = spawnDamageText(d, 0, 0, 5);
    expect(d.count).toBe(1);
    // Tick more than one full life.
    updateDamageTexts(d, DAMAGE_TEXT_LIFE + 0.01);
    expect(d.count).toBe(0);
    expect(d.alive[id]).toBe(0);
    expect(d.aliveIdx[id]).toBe(-1);
  });

  it('returns -1 when pool is full', () => {
    const d = createDamageTexts(2);
    expect(spawnDamageText(d, 0, 0, 1)).toBeGreaterThanOrEqual(0);
    expect(spawnDamageText(d, 0, 0, 1)).toBeGreaterThanOrEqual(0);
    expect(spawnDamageText(d, 0, 0, 1)).toBe(-1);
  });

  it('reuses slots after free', () => {
    const d = createDamageTexts(2);
    const a = spawnDamageText(d, 0, 0, 1);
    spawnDamageText(d, 0, 0, 2);
    freeDamageText(d, a);
    const reused = spawnDamageText(d, 7, 7, 3);
    expect(reused).toBe(a);
    expect(d.value[reused]).toBe(3);
  });

  it('clamps value to [1, 999]', () => {
    const d = createDamageTexts(8);
    const lo = spawnDamageText(d, 0, 0, 0);
    const hi = spawnDamageText(d, 0, 0, 5000);
    const neg = spawnDamageText(d, 0, 0, -42);
    const ok = spawnDamageText(d, 0, 0, 42);
    expect(d.value[lo]).toBe(1);
    expect(d.value[hi]).toBe(999);
    expect(d.value[neg]).toBe(1);
    expect(d.value[ok]).toBe(42);
  });

  it('jitter is deterministic across runs (same call sequence → same posX)', () => {
    const a = createDamageTexts(8);
    const b = createDamageTexts(8);
    for (let i = 0; i < 5; i++) {
      spawnDamageText(a, 100, 0, 10);
      spawnDamageText(b, 100, 0, 10);
    }
    for (let i = 0; i < 5; i++) {
      expect(a.posX[i]).toBeCloseTo(b.posX[i]!, 6);
    }
  });

  it('multiple expiries in one tick compact correctly', () => {
    const d = createDamageTexts(4);
    spawnDamageText(d, 0, 0, 1);
    spawnDamageText(d, 0, 0, 2);
    spawnDamageText(d, 0, 0, 3);
    expect(d.count).toBe(3);
    updateDamageTexts(d, DAMAGE_TEXT_LIFE + 0.01);
    expect(d.count).toBe(0);
  });
});
