import { describe, expect, it } from 'vitest';
import { createDebris } from '../debris';
import { spawnGibs, planGibSpawn } from './debris-emit';
import { createRng } from '../../util/rng';

describe('planGibSpawn', () => {
  it('cannon kill produces 4–8 chunks plus blood blobs', () => {
    const rng = createRng(1);
    const plan = planGibSpawn(rng, 'cannon');
    expect(plan.chunks.length).toBeGreaterThanOrEqual(4);
    expect(plan.chunks.length).toBeLessThanOrEqual(8);
    expect(plan.bloodBlobs).toBeGreaterThanOrEqual(4);
    expect(plan.bloodBlobs).toBeLessThanOrEqual(10);
  });

  it('explosion behaves like cannon', () => {
    const rng = createRng(2);
    const plan = planGibSpawn(rng, 'explosion');
    expect(plan.chunks.length).toBeGreaterThanOrEqual(4);
  });

  it('musket lethal: ~14% chance of one chunk', () => {
    let withChunks = 0;
    for (let i = 0; i < 1000; i++) {
      const rng = createRng(i + 1000);
      const plan = planGibSpawn(rng, 'musket');
      if (plan.chunks.length > 0) withChunks++;
    }
    // 14% ± 3% over 1000 trials.
    expect(withChunks).toBeGreaterThan(105);
    expect(withChunks).toBeLessThan(180);
  });

  it('musket lethal: limbs (arm or leg) are the majority outcome when a chunk spawns', () => {
    // Arm variants: 1 (existing), 6 (uniformed), 7 (bare). Leg variants: 2, 8, 9.
    const ARM_IDS = new Set([1, 6, 7]);
    const LEG_IDS = new Set([2, 8, 9]);
    let arms = 0;
    let legs = 0;
    let total = 0;
    for (let i = 0; i < 5000; i++) {
      const rng = createRng(i + 7000);
      const plan = planGibSpawn(rng, 'musket');
      if (plan.chunks.length === 0) continue;
      total++;
      const c = plan.chunks[0]!;
      if (ARM_IDS.has(c)) arms++;
      if (LEG_IDS.has(c)) legs++;
    }
    expect(total).toBeGreaterThan(0);
    // Designed split: 35% ARM + 20% LEG = 55% limb-share among non-empty plans.
    const limbShare = (arms + legs) / total;
    expect(limbShare).toBeGreaterThan(0.45);
    expect(limbShare).toBeLessThan(0.65);
    expect(legs).toBeGreaterThan(0);
  });

  it('musket non-lethal: ~4% chance of one limb chunk (arm or leg only)', () => {
    const LIMB_IDS = new Set([1, 2, 6, 7, 8, 9]);
    let withChunks = 0;
    let nonLimb = 0;
    for (let i = 0; i < 2000; i++) {
      const rng = createRng(i + 9000);
      const plan = planGibSpawn(rng, 'musket', /* lethal */ false);
      if (plan.chunks.length > 0) {
        withChunks++;
        const c = plan.chunks[0]!;
        if (!LIMB_IDS.has(c)) nonLimb++;
      }
    }
    // 4% ± 1.5% over 2000 trials.
    expect(withChunks).toBeGreaterThan(50);
    expect(withChunks).toBeLessThan(120);
    expect(nonLimb).toBe(0);
  });

  it('non-musket non-lethal: never produces gibs', () => {
    for (let i = 0; i < 200; i++) {
      const rng = createRng(i + 11000);
      expect(planGibSpawn(rng, 'cannon', false).chunks.length).toBe(0);
      expect(planGibSpawn(rng, 'melee', false).chunks.length).toBe(0);
      expect(planGibSpawn(rng, 'charge', false).chunks.length).toBe(0);
      expect(planGibSpawn(rng, 'explosion', false).chunks.length).toBe(0);
    }
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

  it('any spawned chunk references a valid chunkId 0..9', () => {
    for (let i = 0; i < 200; i++) {
      const rng = createRng(i + 5000);
      const plan = planGibSpawn(rng, 'cannon');
      for (const c of plan.chunks) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(9);
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

  it('explosion HitKind biases gib count higher and adds upward Z kick', () => {
    const d = createDebris(64);
    const rng = createRng(11);
    spawnGibs(d, rng, 'explosion', 0, 0, 1, 0, 0);

    let alive = 0;
    let totalZ = 0;
    for (let i = 0; i < d.capacity; i++) {
      if (d.alive[i]) {
        alive++;
        totalZ += d.velZ[i]!;
      }
    }
    expect(alive).toBeGreaterThanOrEqual(8);
    expect(totalZ / alive).toBeGreaterThan(6);
  });
});
