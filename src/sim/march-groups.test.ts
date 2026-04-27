import { describe, it, expect } from 'vitest';
import { createMarchGroup, removeMarchGroupMember } from './march-groups';

describe('march-groups', () => {
  it('createMarchGroup initializes phase=march and members from iterable', () => {
    const g = createMarchGroup(7, [1, 2, 3], { x: 1, y: 0 }, 12.5);
    expect(g.id).toBe(7);
    expect(g.phase).toBe('march');
    expect(g.phaseStartT).toBe(12.5);
    expect(g.forward).toEqual({ x: 1, y: 0 });
    expect([...g.members].sort()).toEqual([1, 2, 3]);
  });

  it('removeMarchGroupMember returns false while members remain, true on the last removal', () => {
    const g = createMarchGroup(1, [10, 11], { x: 0, y: 1 }, 0);
    expect(removeMarchGroupMember(g, 10)).toBe(false);
    expect(g.members.has(10)).toBe(false);
    expect(removeMarchGroupMember(g, 11)).toBe(true);
    expect(g.members.size).toBe(0);
  });

  it('removeMarchGroupMember on a missing id is a no-op and returns members.size === 0', () => {
    const g = createMarchGroup(1, [], { x: 1, y: 0 }, 0);
    expect(removeMarchGroupMember(g, 99)).toBe(true);
  });
});
