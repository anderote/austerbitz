import { describe, it, expect } from 'vitest';
import { buildDirLookup } from './resolver';
import { DIRECTIONS, type Direction } from './pose-config';

describe('buildDirLookup', () => {
  it('maps all 8 slots to omni when omni is available', () => {
    const lookup = buildDirLookup(['omni']);
    expect(lookup).toHaveLength(8);
    for (const d of lookup) {
      expect(d).toBe('omni');
    }
  });

  it('snaps 4-way [N,E,S,W] with horizontal tie-break preference', () => {
    const lookup = buildDirLookup(['N', 'E', 'S', 'W']);
    expect(lookup[0]).toBe('N'); // N
    expect(lookup[1]).toBe('E'); // NE → E
    expect(lookup[2]).toBe('E'); // E
    expect(lookup[3]).toBe('E'); // SE → E
    expect(lookup[4]).toBe('S'); // S
    expect(lookup[5]).toBe('W'); // SW → W
    expect(lookup[6]).toBe('W'); // W
    expect(lookup[7]).toBe('W'); // NW → W
  });

  it('maps every slot to S when only S is available', () => {
    const lookup = buildDirLookup(['S']);
    expect(lookup).toHaveLength(8);
    for (const d of lookup) {
      expect(d).toBe('S');
    }
  });

  it('returns identity when all 8 directions are available', () => {
    const all: Direction[] = [...DIRECTIONS];
    const lookup = buildDirLookup(all);
    for (let i = 0; i < 8; i++) {
      expect(lookup[i]).toBe(DIRECTIONS[i]);
    }
  });

  it('throws when no compass directions and no omni are provided', () => {
    expect(() => buildDirLookup([])).toThrow('pose has no directions');
  });
});
