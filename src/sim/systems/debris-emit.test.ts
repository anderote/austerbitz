import { describe, expect, it } from 'vitest';
import { createDebris } from '../debris';
import { spawnGibs, planGibSpawn } from './debris-emit';
import { createRng } from '../../util/rng';

describe('planGibSpawn', () => {
  it('cannon kill produces 4–6 chunks plus blood blobs', () => {
    const rng = createRng(1);
    const plan = planGibSpawn(rng, 'cannon');
    expect(plan.chunks.length).toBeGreaterThanOrEqual(4);
    expect(plan.chunks.length).toBeLessThanOrEqual(6);
    expect(plan.bloodBlobs).toBeGreaterThanOrEqual(4);
    expect(plan.bloodBlobs).toBeLessThanOrEqual(8);
  });

  it('explosion behaves like cannon', () => {
    const rng = createRng(2);
    const plan = planGibSpawn(rng, 'explosion');
    expect(plan.chunks.length).toBeGreaterThanOrEqual(4);
  });

  it('musket: 10% chance of one chunk', () => {
    let withChunks = 0;
    for (let i = 0; i < 1000; i++) {
      const rng = createRng(i + 1000);
      const plan = planGibSpawn(rng, 'musket');
      if (plan.chunks.length > 0) withChunks++;
    }
    // 10% ± 3% over 1000 trials.
    expect(withChunks).toBeGreaterThan(70);
    expect(withChunks).toBeLessThan(140);
  });

  it('melee: 30% chance of one chunk', () => {
    let withChunks = 0;
    for (let i = 0; i < 1000; i++) {
      const rng = createRng(i + 2000);
      const plan = planGibSpawn(rng, 'melee');
      if (plan.chunks.length > 0) withChunks++;
    }
    expect(withChunks).toBeGreaterThan(250);
    expect(withChunks).toBeLessThan(360);
  });

  it('any spawned chunk references a valid chunkId 0..5', () => {
    for (let i = 0; i < 200; i++) {
      const rng = createRng(i + 5000);
      const plan = planGibSpawn(rng, 'cannon');
      for (const c of plan.chunks) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(5);
      }
    }
  });
});

describe('spawnGibs', () => {
  it('cannon kill enqueues debris into the SoA', () => {
    const d = createDebris(64);
    const rng = createRng(42);
    spawnGibs(d, rng, 'cannon', 100, 200, 1, 0, 0);
    expect(d.count).toBeGreaterThanOrEqual(4);
    // First slot should have populated fields.
    const id = d.aliveIds[0]!;
    expect(d.posX[id]).toBe(100);
    expect(d.posY[id]).toBe(200);
    expect(d.team[id]).toBe(0);
    expect(d.ttl[id]).toBeGreaterThan(0);
  });

  it('musket kill at low roll produces zero debris', () => {
    const d = createDebris(64);
    let countBefore = d.count;
    // Drive many seeds; at least some should produce 0.
    let zeroSeen = false;
    for (let i = 0; i < 50; i++) {
      countBefore = d.count;
      const r = createRng(i);
      spawnGibs(d, r, 'musket', 0, 0, 0, 0, 0);
      if (d.count === countBefore) { zeroSeen = true; break; }
    }
    expect(zeroSeen).toBe(true);
  });

  it('does not exceed capacity', () => {
    const d = createDebris(3);
    const rng = createRng(1);
    spawnGibs(d, rng, 'cannon', 0, 0, 0, 0, 0); // wants 4-6, capacity is 3
    expect(d.count).toBeLessThanOrEqual(3);
  });
});
