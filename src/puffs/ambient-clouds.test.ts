import { describe, it, expect } from 'vitest';
import { createPuffs } from './puffs';
import { tickAmbientClouds, type AmbientCloudConfig } from './ambient-clouds';
import { CLOUD_INDEX } from './profiles/cloud';
import { createRng } from '../util/rng';

const cfg: AmbientCloudConfig = {
  target: 6,
  viewport: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
  windX: 1.5, windY: 0,
};

function countClouds(p: ReturnType<typeof createPuffs>): number {
  let n = 0;
  for (let i = 0; i < p.capacity; i++) {
    if (p.alive[i] === 1 && p.profileIdx[i] === CLOUD_INDEX) n++;
  }
  return n;
}

describe('ambient clouds', () => {
  it('spawns up to target count over multiple ticks', () => {
    const p = createPuffs(64);
    const rng = createRng(1);
    for (let n = 0; n < 20; n++) tickAmbientClouds(p, cfg, 0.5, rng);
    expect(countClouds(p)).toBeGreaterThanOrEqual(cfg.target - 1);
    expect(countClouds(p)).toBeLessThanOrEqual(cfg.target + 1);
  });

  it('spawns on the upwind viewport edge', () => {
    const p = createPuffs(64);
    const rng = createRng(2);
    // wind from -X (windX > 0 means cloud drifts in +X), so spawn at minX.
    for (let n = 0; n < 20; n++) tickAmbientClouds(p, cfg, 0.5, rng);
    let upwindCount = 0, totalCount = 0;
    for (let i = 0; i < p.capacity; i++) {
      if (p.alive[i] === 1 && p.profileIdx[i] === CLOUD_INDEX) {
        totalCount++;
        if (p.posX[i]! < cfg.viewport.minX + 30) upwindCount++;
      }
    }
    expect(upwindCount).toBeGreaterThan(totalCount * 0.5);
  });
});
