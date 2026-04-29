import { describe, it, expect } from 'vitest';
import { unitKinds, getUnitKind, getUnitKindIndex } from './index';

describe('unit kind registry', () => {
  it('exposes the registered unit kinds', () => {
    expect(unitKinds.map(k => k.id).sort()).toEqual(
      ['cannon-12', 'cuirassier', 'gun-crew-gunner', 'gun-crew-loader', 'gun-crew-rammer', 'gun-crew-sponger', 'line-infantry'],
    );
  });

  it('getUnitKind by id returns the matching definition', () => {
    const k = getUnitKind('cuirassier');
    expect(k.category).toBe('cavalry');
    expect(k.baseStats.massKg).toBeGreaterThan(400); // horse + man
  });

  it('throws on unknown id', () => {
    expect(() => getUnitKind('not-a-real-id')).toThrow();
  });

  it('getUnitKindIndex provides a stable numeric id usable in Uint16Array', () => {
    const i = getUnitKindIndex('line-infantry');
    expect(Number.isInteger(i)).toBe(true);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(unitKinds.length);
  });
});
