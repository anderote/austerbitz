import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity } from './entities';
import { assignIdentity } from './spawn-identity';
import { createRng } from '../util/rng';
import { themeIdOf, poolSizes } from '../data/name-bank';

describe('assignIdentity', () => {
  it('writes english theme + in-range indices for team 0', () => {
    const e = createEntities(8);
    const rng = createRng(12345);
    const id = allocEntity(e);
    assignIdentity(e, id, 0, rng);

    const expectedTid = themeIdOf('english');
    expect(expectedTid).toBeGreaterThanOrEqual(0);
    expect(e.themeId[id]).toBe(expectedTid);

    const sizes = poolSizes(expectedTid);
    expect(e.firstNameIdx[id]!).toBeGreaterThanOrEqual(0);
    expect(e.firstNameIdx[id]!).toBeLessThan(sizes.first);
    expect(e.lastNameIdx[id]!).toBeGreaterThanOrEqual(0);
    expect(e.lastNameIdx[id]!).toBeLessThan(sizes.last);
    expect(e.hometownIdx[id]!).toBeGreaterThanOrEqual(0);
    expect(e.hometownIdx[id]!).toBeLessThan(sizes.town);

    expect(e.ageYears[id]!).toBeGreaterThanOrEqual(16);
    expect(e.ageYears[id]!).toBeLessThanOrEqual(55);
  });

  it('writes french theme for team 1', () => {
    const e = createEntities(8);
    const rng = createRng(99);
    const id = allocEntity(e);
    assignIdentity(e, id, 1, rng);

    const expectedTid = themeIdOf('french');
    expect(expectedTid).toBeGreaterThanOrEqual(0);
    expect(e.themeId[id]).toBe(expectedTid);

    const sizes = poolSizes(expectedTid);
    expect(e.firstNameIdx[id]!).toBeLessThan(sizes.first);
    expect(e.lastNameIdx[id]!).toBeLessThan(sizes.last);
    expect(e.hometownIdx[id]!).toBeLessThan(sizes.town);
    expect(e.ageYears[id]!).toBeGreaterThanOrEqual(16);
    expect(e.ageYears[id]!).toBeLessThanOrEqual(55);
  });

  it('falls back to english for an unknown team', () => {
    const e = createEntities(8);
    const rng = createRng(7);
    const id = allocEntity(e);
    assignIdentity(e, id, 99, rng);

    expect(e.themeId[id]).toBe(themeIdOf('english'));
    expect(e.ageYears[id]!).toBeGreaterThanOrEqual(16);
    expect(e.ageYears[id]!).toBeLessThanOrEqual(55);
  });

  it('produces a spread of ages and first names across many rolls', () => {
    const e = createEntities(256);
    const rng = createRng(0xdeadbeef);
    const ages = new Set<number>();
    const firsts = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const id = allocEntity(e);
      expect(id).toBeGreaterThanOrEqual(0);
      assignIdentity(e, id, 0, rng);
      ages.add(e.ageYears[id]!);
      firsts.add(e.firstNameIdx[id]!);
    }
    // If the RNG were stuck or we always wrote 0, these would collapse.
    expect(ages.size).toBeGreaterThanOrEqual(5);
    expect(firsts.size).toBeGreaterThanOrEqual(5);
  });
});
