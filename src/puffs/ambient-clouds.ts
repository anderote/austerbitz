import type { Puffs } from './puffs';
import { allocPuff } from './puffs';
import { CLOUD, CLOUD_INDEX } from './profiles/cloud';
import type { Rng } from '../util/rng';

export interface AmbientCloudConfig {
  target: number;
  viewport: { minX: number; minY: number; maxX: number; maxY: number };
  windX: number;
  windY: number;
}

export function tickAmbientClouds(
  puffs: Puffs, cfg: AmbientCloudConfig, dt: number, rng: Rng,
): void {
  let alive = 0;
  for (let i = 0; i < puffs.capacity; i++) {
    if (puffs.alive[i] === 1 && puffs.profileIdx[i] === CLOUD_INDEX) alive++;
  }
  const deficit = cfg.target - alive;
  if (deficit <= 0) return;

  // Emit at most one per tick to avoid bursty spawns; rate-limit by time.
  const probability = Math.min(1, deficit * dt * 0.5);
  if (rng.next() > probability) return;

  // Upwind edge: opposite of (windX, windY). If wind ≈ 0, pick a random edge.
  const wMag = Math.hypot(cfg.windX, cfg.windY);
  let x: number, y: number;
  const v = cfg.viewport;
  if (wMag < 1e-3) {
    const side = rng.intRange(0, 4);
    if (side === 0) { x = v.minX; y = rng.range(v.minY, v.maxY); }
    else if (side === 1) { x = v.maxX; y = rng.range(v.minY, v.maxY); }
    else if (side === 2) { x = rng.range(v.minX, v.maxX); y = v.minY; }
    else { x = rng.range(v.minX, v.maxX); y = v.maxY; }
  } else {
    const upwindX = -cfg.windX / wMag;
    const upwindY = -cfg.windY / wMag;
    const cx = (v.minX + v.maxX) * 0.5;
    const cy = (v.minY + v.maxY) * 0.5;
    const halfW = (v.maxX - v.minX) * 0.5;
    const halfH = (v.maxY - v.minY) * 0.5;
    // Walk from center along upwind direction until hitting an edge.
    const t = Math.min(
      Math.abs(upwindX) > 1e-6 ? halfW / Math.abs(upwindX) : Infinity,
      Math.abs(upwindY) > 1e-6 ? halfH / Math.abs(upwindY) : Infinity,
    );
    x = cx + upwindX * t + rng.range(-halfH, halfH) * (1 - Math.abs(upwindX));
    y = cy + upwindY * t + rng.range(-halfW, halfW) * (1 - Math.abs(upwindY));
  }

  const idx = allocPuff(puffs);
  if (idx === -1) return;
  puffs.profileIdx[idx] = CLOUD_INDEX;
  puffs.posX[idx] = x; puffs.posY[idx] = y;
  puffs.velX[idx] = cfg.windX; puffs.velY[idx] = cfg.windY;
  const life = rng.range(CLOUD.life.min, CLOUD.life.max);
  puffs.life[idx] = life; puffs.lifeMax[idx] = life;
  puffs.size[idx] = rng.range(CLOUD.sizeStart.min, CLOUD.sizeStart.max);
  puffs.sizeMax[idx] = CLOUD.sizeMax;
  puffs.edgeGrowth[idx] = CLOUD.edgeGrowth;
  puffs.drag[idx] = CLOUD.drag;
  puffs.buoyancy[idx] = CLOUD.buoyancy;
  puffs.inertiaExp[idx] = CLOUD.inertiaExp;
  puffs.inertiaWeight[idx] = CLOUD.inertiaWeight;
  puffs.r[idx] = CLOUD.color[0]; puffs.g[idx] = CLOUD.color[1]; puffs.b[idx] = CLOUD.color[2];
  puffs.alpha[idx] = CLOUD.alpha; puffs.softness[idx] = CLOUD.softness;
}
