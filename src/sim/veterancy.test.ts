import { describe, expect, it } from 'vitest';
import {
  RANK_THRESHOLDS,
  RANK_NAMES,
  Rank,
  rankDamageMul,
  rankAccuracyAdd,
  rankReloadMul,
  rankArmorAdd,
  effectiveDamage,
  effectiveAccuracy,
  effectiveReload,
  effectiveArmor,
  cumulativeKillsForRank,
  promote,
} from './veterancy';
import { createEntities } from './entities';

describe('veterancy tables', () => {
  it('has 4 promotion thresholds and 5 rank names', () => {
    expect(RANK_THRESHOLDS).toEqual([1, 2, 4, 8]);
    expect(RANK_NAMES).toEqual(['Recruit', 'Veteran', 'Sergeant', 'Sgt. Major', 'Captain']);
  });

  it('cumulative kills match the spec table', () => {
    expect(cumulativeKillsForRank(Rank.Recruit)).toBe(0);
    expect(cumulativeKillsForRank(Rank.Veteran)).toBe(1);
    expect(cumulativeKillsForRank(Rank.Sergeant)).toBe(3);
    expect(cumulativeKillsForRank(Rank.SgtMajor)).toBe(7);
    expect(cumulativeKillsForRank(Rank.Captain)).toBe(15);
  });

  it('per-rank multipliers match the spec', () => {
    expect(rankDamageMul(Rank.Recruit)).toBeCloseTo(1.0);
    expect(rankDamageMul(Rank.Captain)).toBeCloseTo(1.25);
    expect(rankAccuracyAdd(Rank.Veteran)).toBeCloseTo(0.05);
    expect(rankAccuracyAdd(Rank.Captain)).toBeCloseTo(0.20);
    expect(rankReloadMul(Rank.Recruit)).toBeCloseTo(1.0);
    expect(rankReloadMul(Rank.Captain)).toBeCloseTo(0.75);
    expect(rankArmorAdd(Rank.Recruit)).toBe(0);
    expect(rankArmorAdd(Rank.Sergeant)).toBe(1);
    expect(rankArmorAdd(Rank.Captain)).toBe(2);
  });
});

describe('effective stat helpers', () => {
  it('returns base values at rank 0', () => {
    const e = createEntities(4);
    e.rank[0] = Rank.Recruit;
    expect(effectiveDamage(e, 0, 12)).toBeCloseTo(12);
    expect(effectiveAccuracy(e, 0, 0.4)).toBeCloseTo(0.4);
    expect(effectiveReload(e, 0, 10)).toBeCloseTo(10);
    expect(effectiveArmor(e, 0, 2)).toBe(2);
  });

  it('applies multipliers and additions at higher ranks', () => {
    const e = createEntities(4);
    e.rank[0] = Rank.Captain;
    expect(effectiveDamage(e, 0, 12)).toBeCloseTo(15.0);
    expect(effectiveAccuracy(e, 0, 0.4)).toBeCloseTo(0.6);
    expect(effectiveReload(e, 0, 10)).toBeCloseTo(7.5);
    expect(effectiveArmor(e, 0, 2)).toBe(4);
  });

  it('clamps accuracy at 0.99', () => {
    const e = createEntities(4);
    e.rank[0] = Rank.Captain;
    expect(effectiveAccuracy(e, 0, 0.95)).toBeCloseTo(0.99);
  });

  it('clamps reload at 0.05 s minimum', () => {
    const e = createEntities(4);
    e.rank[0] = Rank.Captain;
    expect(effectiveReload(e, 0, 0.03)).toBeCloseTo(0.05);
  });
});

describe('promote()', () => {
  it('increments rank and resets xp when threshold reached', () => {
    const e = createEntities(4);
    e.rank[0] = Rank.Recruit;
    e.xp[0] = 1;
    const promoted = promote(e, 0);
    expect(promoted).toBe(true);
    expect(e.rank[0]).toBe(Rank.Veteran);
    expect(e.xp[0]).toBe(0);
  });

  it('does nothing below threshold', () => {
    const e = createEntities(4);
    e.rank[0] = Rank.Veteran;
    e.xp[0] = 1;
    const promoted = promote(e, 0);
    expect(promoted).toBe(false);
    expect(e.rank[0]).toBe(Rank.Veteran);
    expect(e.xp[0]).toBe(1);
  });

  it('saturates at Captain — preserves rank and xp without consuming it', () => {
    const e = createEntities(4);
    e.rank[0] = Rank.Captain;
    e.xp[0] = 99;
    const promoted = promote(e, 0);
    expect(promoted).toBe(false);
    expect(e.rank[0]).toBe(Rank.Captain);
    expect(e.xp[0]).toBe(99);
  });
});
