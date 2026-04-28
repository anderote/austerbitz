import { describe, it, expect } from 'vitest';
import {
  themeIdOf,
  themeNameOf,
  themeNames,
  firstNameOf,
  lastNameOf,
  hometownOf,
  poolSizes,
} from './name-bank';

describe('name-bank loader', () => {
  it('assigns distinct nonneg ids to english and french', () => {
    const en = themeIdOf('english');
    const fr = themeIdOf('french');
    expect(en).toBeGreaterThanOrEqual(0);
    expect(fr).toBeGreaterThanOrEqual(0);
    expect(en).not.toBe(fr);
  });

  it('orders theme ids deterministically (sorted by name)', () => {
    const sorted = [...themeNames].sort();
    expect(themeNames).toEqual(sorted);
    // Each theme name's id should match its index in the sorted list.
    for (let i = 0; i < themeNames.length; i++) {
      expect(themeIdOf(themeNames[i] as string)).toBe(i);
    }
  });

  it('round-trips theme name through id', () => {
    expect(themeNameOf(themeIdOf('english'))).toBe('english');
    expect(themeNameOf(themeIdOf('french'))).toBe('french');
  });

  it('returns -1 for unknown theme name', () => {
    expect(themeIdOf('does-not-exist')).toBe(-1);
  });

  it('returns "?" for out-of-range theme id', () => {
    expect(themeNameOf(-1)).toBe('?');
    expect(themeNameOf(999)).toBe('?');
  });

  it('firstNameOf returns a non-empty string at index 0 for both themes', () => {
    const en = themeIdOf('english');
    const fr = themeIdOf('french');
    expect(firstNameOf(en, 0)).not.toBe('?');
    expect(firstNameOf(en, 0).length).toBeGreaterThan(0);
    expect(firstNameOf(fr, 0)).not.toBe('?');
    expect(firstNameOf(fr, 0).length).toBeGreaterThan(0);
  });

  it('lastNameOf and hometownOf return non-empty strings at index 0', () => {
    const en = themeIdOf('english');
    expect(lastNameOf(en, 0)).not.toBe('?');
    expect(hometownOf(en, 0)).not.toBe('?');
  });

  it('returns "?" for huge out-of-range index without throwing', () => {
    const en = themeIdOf('english');
    expect(() => firstNameOf(en, 1_000_000)).not.toThrow();
    expect(firstNameOf(en, 1_000_000)).toBe('?');
    expect(lastNameOf(en, 1_000_000)).toBe('?');
    expect(hometownOf(en, 1_000_000)).toBe('?');
  });

  it('returns "?" for unknown theme id lookups', () => {
    expect(firstNameOf(-1, 0)).toBe('?');
    expect(firstNameOf(999, 0)).toBe('?');
    expect(lastNameOf(-1, 0)).toBe('?');
    expect(hometownOf(-1, 0)).toBe('?');
  });

  it('poolSizes returns three positive numbers for english', () => {
    const sizes = poolSizes(themeIdOf('english'));
    expect(sizes.first).toBeGreaterThan(0);
    expect(sizes.last).toBeGreaterThan(0);
    expect(sizes.town).toBeGreaterThan(0);
  });

  it('poolSizes returns zeros for unknown theme id', () => {
    expect(poolSizes(-1)).toEqual({ first: 0, last: 0, town: 0 });
    expect(poolSizes(999)).toEqual({ first: 0, last: 0, town: 0 });
  });
});
