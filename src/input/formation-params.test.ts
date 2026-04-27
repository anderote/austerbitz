import { describe, it, expect } from 'vitest';
import {
  createFormationParams, resetFormationParams,
  bumpSpacing, bumpRanks, spacingMultiplier,
  SPACING_STEPS, DEFAULT_SPACING_INDEX, MIN_RANKS, MAX_RANKS,
} from './formation-params';

describe('formation-params', () => {
  it('starts at default Close spacing and auto ranks', () => {
    const p = createFormationParams();
    expect(p.spacingIndex).toBe(DEFAULT_SPACING_INDEX);
    expect(p.ranks).toBe(null);
    expect(spacingMultiplier(p)).toBe(1);
  });

  it('bumpSpacing clamps at both ends', () => {
    const p = createFormationParams();
    p.spacingIndex = 0;
    bumpSpacing(p, -1);
    expect(p.spacingIndex).toBe(0);
    p.spacingIndex = SPACING_STEPS.length - 1;
    bumpSpacing(p, +1);
    expect(p.spacingIndex).toBe(SPACING_STEPS.length - 1);
  });

  it('bumpRanks cycles through null → 1 … 16 → null on +1', () => {
    const p = createFormationParams();
    bumpRanks(p, +1); expect(p.ranks).toBe(MIN_RANKS);
    p.ranks = MAX_RANKS;
    bumpRanks(p, +1); expect(p.ranks).toBe(null);
  });

  it('bumpRanks cycles in reverse on -1', () => {
    const p = createFormationParams();
    bumpRanks(p, -1); expect(p.ranks).toBe(MAX_RANKS);
    p.ranks = MIN_RANKS;
    bumpRanks(p, -1); expect(p.ranks).toBe(null);
  });

  it('resetFormationParams returns to defaults', () => {
    const p = createFormationParams();
    p.spacingIndex = 4;
    p.ranks = 3;
    resetFormationParams(p);
    expect(p.spacingIndex).toBe(DEFAULT_SPACING_INDEX);
    expect(p.ranks).toBe(null);
  });
});
