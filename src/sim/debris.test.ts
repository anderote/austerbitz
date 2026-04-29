import { describe, expect, it } from 'vitest';
import {
  createDebris,
  allocDebris,
  freeDebris,
} from './debris';

describe('Debris', () => {
  it('createDebris initialises empty SoA at given capacity', () => {
    const d = createDebris(8);
    expect(d.capacity).toBe(8);
    expect(d.count).toBe(0);
    expect(d.alive.length).toBe(8);
    expect(d.posX.length).toBe(8);
    expect(d.aliveIds.length).toBe(8);
  });

  it('allocDebris returns a slot id and marks it alive', () => {
    const d = createDebris(4);
    const id = allocDebris(d);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThan(4);
    expect(d.alive[id]).toBe(1);
    expect(d.count).toBe(1);
    expect(d.aliveIds[0]).toBe(id);
  });

  it('allocDebris evicts the oldest settled gib when full (and reuses its slot)', () => {
    const d = createDebris(2);
    const a = allocDebris(d);
    const b = allocDebris(d);
    // Mark `a` as settled so it's the eviction target.
    d.bounces[a] = 4;
    // Stamp identifying values so we can verify the slot was overwritten.
    d.chunkId[a] = 99;
    const c = allocDebris(d);
    expect(c).not.toBe(-1);
    expect(d.count).toBe(2);
    // Settled slot `a` is the eviction target, so the rolling cursor reuses it.
    expect(c).toBe(a);
    expect(d.alive[a]).toBe(1); // freshly allocated again
    expect(d.alive[b]).toBe(1); // unsettled survivor untouched
    expect(d.bounces[a]).toBe(4); // raw fields aren't reset on alloc; spawnGibs initialises
  });

  it('allocDebris falls back to oldest packed slot if none settled', () => {
    const d = createDebris(2);
    const a = allocDebris(d);
    const b = allocDebris(d);
    const c = allocDebris(d);
    expect(c).not.toBe(-1);
    // No gibs settled → fallback evicts aliveIds[0] (which was `a`), and the
    // freed slot is reused.
    expect(c).toBe(a);
    expect(d.alive[b]).toBe(1);
    expect(d.count).toBe(2);
  });

  it('freeDebris removes from alive list and decrements count', () => {
    const d = createDebris(4);
    const a = allocDebris(d);
    const b = allocDebris(d);
    freeDebris(d, a);
    expect(d.alive[a]).toBe(0);
    expect(d.count).toBe(1);
    expect(d.aliveIdx[a]).toBe(-1);
    // Surviving slot still findable in aliveIds[0..count).
    expect(d.aliveIds[0]).toBe(b);
  });

  it('allocDebris reuses freed slots', () => {
    const d = createDebris(2);
    const a = allocDebris(d);
    allocDebris(d);
    freeDebris(d, a);
    const c = allocDebris(d);
    expect(c).toBe(a); // reused
  });
});
