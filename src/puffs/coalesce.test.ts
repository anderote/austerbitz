import { describe, it, expect } from 'vitest';
import { createPuffs, allocPuff } from './puffs';
import { registerProfile, type PuffProfile } from './profile';
import { buildCoalesceGrid, tryMergeOrSpawn, gridInsert } from './coalesce';
import { createRng } from '../util/rng';

const A: PuffProfile = {
  id: 'a',
  sizeStart: { min: 1, max: 1 }, life: { min: 4, max: 4 },
  velScale: 0, velJitter: 0,
  edgeGrowth: 0, sizeMax: 4,
  drag: 1, buoyancy: 0, inertiaExp: 1, inertiaWeight: 0,
  color: [1, 1, 1], colorJitter: 0, alpha: 1, softness: 0.8,
  coalesce: { radius: 1.5, sizePerMerge: 0.1, lifePerMerge: 0.5, posBlend: 0.3, mergeChance: 1.0 },
};
const B: PuffProfile = { ...A, id: 'b', coalesce: { ...A.coalesce!, mergeChance: 1.0 } };
const aIdx = registerProfile(A);
const bIdx = registerProfile(B);

function seedPuff(p: ReturnType<typeof createPuffs>, profileIdx: number, x: number, y: number) {
  const i = allocPuff(p);
  p.profileIdx[i] = profileIdx;
  p.posX[i] = x; p.posY[i] = y;
  p.size[i] = 1; p.sizeMax[i] = 4;
  p.life[i] = 4; p.lifeMax[i] = 10;
  return i;
}

describe('coalesce', () => {
  it('merges nearby same-profile puffs (size and life accrete)', () => {
    const p = createPuffs(8);
    const i = seedPuff(p, aIdx, 10, 10);
    const grid = buildCoalesceGrid(p);
    const rng = createRng(1);
    const result = tryMergeOrSpawn(p, grid, A, aIdx, 10.5, 10.0, rng);
    expect(result.merged).toBe(true);
    expect(result.idx).toBe(i);
    expect(p.size[i]).toBeCloseTo(1.1, 5);
    expect(p.life[i]).toBeCloseTo(4.5, 5);
  });

  it('does not merge across different profiles', () => {
    const p = createPuffs(8);
    seedPuff(p, aIdx, 10, 10);
    const grid = buildCoalesceGrid(p);
    const rng = createRng(2);
    const result = tryMergeOrSpawn(p, grid, B, bIdx, 10.0, 10.0, rng);
    expect(result.merged).toBe(false);
  });

  it('mergeChance < 1 makes some emissions skip the merge', () => {
    const p = createPuffs(64);
    seedPuff(p, aIdx, 10, 10);
    // Profile with mergeChance = 0 should never merge.
    const C: PuffProfile = { ...A, id: 'c', coalesce: { ...A.coalesce!, mergeChance: 0 } };
    const cIdx = registerProfile(C);
    seedPuff(p, cIdx, 10, 10);
    const grid = buildCoalesceGrid(p);
    const rng = createRng(3);
    const result = tryMergeOrSpawn(p, grid, C, cIdx, 10.0, 10.0, rng);
    expect(result.merged).toBe(false);
  });

  it('skips puffs already saturated (size and life at max)', () => {
    const p = createPuffs(8);
    const i = seedPuff(p, aIdx, 10, 10);
    p.size[i] = 4; p.sizeMax[i] = 4; p.life[i] = 4; p.lifeMax[i] = 4;
    const grid = buildCoalesceGrid(p);
    const rng = createRng(4);
    const result = tryMergeOrSpawn(p, grid, A, aIdx, 10.0, 10.0, rng);
    expect(result.merged).toBe(false);
  });

  it('clamps size and life when merge bumps would exceed their max', () => {
    const p = createPuffs(8);
    const i = allocPuff(p);
    p.profileIdx[i] = aIdx;
    p.posX[i] = 10; p.posY[i] = 10;
    // Set just below saturation in size, AT saturation in life — saturation
    // guard skips only when BOTH are at max, so this puff is still mergeable.
    p.size[i] = 3.95; p.sizeMax[i] = 4;
    p.life[i] = 4; p.lifeMax[i] = 4;
    const grid = buildCoalesceGrid(p);
    const rng = createRng(42);
    const result = tryMergeOrSpawn(p, grid, A, aIdx, 10, 10, rng);
    expect(result.merged).toBe(true);
    // sizePerMerge = 0.1, would push to 4.05; clamped to 4.
    expect(p.size[i]).toBe(4);
    // lifePerMerge = 0.5, would push to 4.5; clamped to lifeMax (4).
    expect(p.life[i]).toBe(4);
  });

  it('gridInsert lets same-frame emissions coalesce', () => {
    const p = createPuffs(8);
    // Empty grid, no live puffs.
    const grid = buildCoalesceGrid(p);
    // Spawn a fresh puff and insert it into the grid so a subsequent emission
    // can coalesce with it within the same frame.
    const i = allocPuff(p);
    p.profileIdx[i] = aIdx;
    p.posX[i] = 50; p.posY[i] = 50;
    p.size[i] = 1; p.sizeMax[i] = 4;
    p.life[i] = 4; p.lifeMax[i] = 10;
    gridInsert(grid, p, i);
    const rng = createRng(7);
    const result = tryMergeOrSpawn(p, grid, A, aIdx, 50.2, 50.0, rng);
    expect(result.merged).toBe(true);
    expect(result.idx).toBe(i);
  });
});
