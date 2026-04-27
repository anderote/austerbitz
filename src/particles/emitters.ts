import type { World } from '../sim/world';
import { spawnParticle, type Particles } from './particles';

const DUST_PER_SEC = 4;       // particles per moving unit per second

export function emitDust(world: World, particles: Particles, dt: number): void {
  const e = world.entities;
  const expected = DUST_PER_SEC * dt;
  for (let i = 0; i < e.capacity; i++) {
    if (e.alive[i] === 0) continue;
    const vx = e.velX[i]!;
    const vy = e.velY[i]!;
    if (vx === 0 && vy === 0) continue;
    if (world.rng.next() > expected) continue;
    const speed = Math.hypot(vx, vy);
    const jitter = () => world.rng.range(-0.4, 0.4);
    spawnParticle(particles, {
      x: e.posX[i]! + jitter(),
      y: e.posY[i]! + jitter() + 0.2,
      vx: -vx * 0.1 + jitter() * 0.5,
      vy: -vy * 0.1 + jitter() * 0.5,
      life: 0.5 + world.rng.next() * 0.5,
      size: 0.7 + Math.min(speed * 0.06, 0.5),
      r: 0.65, g: 0.55, b: 0.42,
    });
  }
}

export function emitOrderPuff(particles: Particles, x: number, y: number): void {
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    const r = 0.3;
    spawnParticle(particles, {
      x: x + Math.cos(a) * r,
      y: y + Math.sin(a) * r,
      vx: Math.cos(a) * 0.6,
      vy: Math.sin(a) * 0.6,
      life: 0.35,
      size: 0.18,
      r: 0.8, g: 0.9, b: 1.0,
    });
  }
}
