import type { World } from '../sim/world';
import type { Puffs } from './puffs';
import { DUST, DUST_INDEX } from './profiles/dust';
import { buildCoalesceGrid, gridInsert, tryMergeOrSpawn } from './coalesce';
import { allocPuff } from './puffs';

const DUST_PER_SEC = 0.25; // particles per moving entity per second

export function emitDustForFrame(world: World, puffs: Puffs, dt: number): void {
  const e = world.entities;
  const expected = DUST_PER_SEC * dt;
  const grid = buildCoalesceGrid(puffs);
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    const vx = e.velX[i]!;
    const vy = e.velY[i]!;
    if (vx === 0 && vy === 0) continue;
    if (world.rng.next() > expected) continue;
    const speed = Math.hypot(vx, vy);
    const inv = speed > 0 ? 1 / speed : 0;
    const dirX = vx * inv;
    const dirY = vy * inv;
    const jx = world.rng.range(-0.4, 0.4);
    const jy = world.rng.range(-0.4, 0.4);
    const fx = e.posX[i]! + jx;
    const fy = e.posY[i]! + jy + 0.5;
    // Emission velocity: drift backward and slightly upward, like the old dust.
    const vex = -dirX * 0.16 + world.rng.range(-0.18, 0.18);
    const vey = -dirY * 0.16 - world.rng.range(0.18, 0.4);

    const merged = tryMergeOrSpawn(puffs, grid, DUST, DUST_INDEX, fx, fy, world.rng);
    if (merged.merged) continue;

    const idx = allocPuff(puffs);
    if (idx === -1) continue;
    // Inline the writeProfile work — emit-dust is a hot loop and avoids the
    // double rng draw of the full emitPuff path's velocity jitter (we have
    // our own physics-aware velocity above).
    puffs.profileIdx[idx] = DUST_INDEX;
    puffs.posX[idx] = fx; puffs.posY[idx] = fy;
    puffs.velX[idx] = vex; puffs.velY[idx] = vey;
    const life = world.rng.range(DUST.life.min, DUST.life.max);
    puffs.life[idx] = life; puffs.lifeMax[idx] = life;
    puffs.size[idx] = world.rng.range(DUST.sizeStart.min, DUST.sizeStart.max);
    puffs.sizeMax[idx] = DUST.sizeMax;
    puffs.edgeGrowth[idx] = DUST.edgeGrowth;
    puffs.drag[idx] = DUST.drag;
    puffs.buoyancy[idx] = DUST.buoyancy;
    puffs.inertiaExp[idx] = DUST.inertiaExp;
    puffs.inertiaWeight[idx] = DUST.inertiaWeight;
    puffs.r[idx] = DUST.color[0]; puffs.g[idx] = DUST.color[1]; puffs.b[idx] = DUST.color[2];
    puffs.alpha[idx] = DUST.alpha; puffs.softness[idx] = DUST.softness;
    puffs.decayMul[idx] = DUST.decayMulAtMaxSize ?? 1;
    gridInsert(grid, puffs, idx);
  }
}
