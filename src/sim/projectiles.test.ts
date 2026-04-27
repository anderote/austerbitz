import { describe, it, expect } from 'vitest';
import {
  ProjectileKind,
  createProjectiles,
  allocProjectile,
  freeProjectile,
  spawnMusketBall,
  spawnSolidShot,
  spawnShell,
} from './projectiles';

describe('Projectiles SoA', () => {
  it('createProjectiles(64) yields capacity=64, count=0, all alive=0', () => {
    const p = createProjectiles(64);
    expect(p.capacity).toBe(64);
    expect(p.count).toBe(0);
    expect(p.alive).toBeInstanceOf(Uint8Array);
    expect(p.alive.length).toBe(64);
    for (let i = 0; i < 64; i++) {
      expect(p.alive[i]).toBe(0);
    }
    // Spot-check a few other arrays.
    expect(p.posX).toBeInstanceOf(Float32Array);
    expect(p.posX.length).toBe(64);
    expect(p.kind).toBeInstanceOf(Uint8Array);
    expect(p.ricochets).toBeInstanceOf(Uint8Array);
    expect(p.fuseT).toBeInstanceOf(Float32Array);
  });

  it('allocProjectile returns sequential ids and increments count; alive[id]=1', () => {
    const p = createProjectiles(8);
    const a = allocProjectile(p);
    const b = allocProjectile(p);
    const c = allocProjectile(p);
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(c).toBe(2);
    expect(p.count).toBe(3);
    expect(p.alive[a]).toBe(1);
    expect(p.alive[b]).toBe(1);
    expect(p.alive[c]).toBe(1);
  });

  it('freeProjectile decrements count, clears alive, and reuses the id on next alloc', () => {
    const p = createProjectiles(4);
    const a = allocProjectile(p);
    const b = allocProjectile(p);
    expect(p.count).toBe(2);
    freeProjectile(p, a);
    expect(p.count).toBe(1);
    expect(p.alive[a]).toBe(0);
    expect(p.alive[b]).toBe(1);
    const reused = allocProjectile(p);
    expect(reused).toBe(a);
    expect(p.alive[reused]).toBe(1);
    expect(p.count).toBe(2);
  });

  it('exhausting the pool causes the next allocProjectile to return -1', () => {
    const p = createProjectiles(3);
    expect(allocProjectile(p)).toBe(0);
    expect(allocProjectile(p)).toBe(1);
    expect(allocProjectile(p)).toBe(2);
    expect(p.count).toBe(3);
    expect(allocProjectile(p)).toBe(-1);
    expect(p.count).toBe(3);
  });

  it('spawnMusketBall writes the right fields', () => {
    const p = createProjectiles(8);
    const dirX = 1;
    const dirY = 0;
    const muzzleSpeed = 400;
    const id = spawnMusketBall(p, 5, 7, dirX, dirY, /*team*/ 1, /*damage*/ 25, muzzleSpeed, /*mass*/ 0.03, /*maxLife*/ 0.4);
    expect(id).toBe(0);
    expect(p.alive[id]).toBe(1);
    expect(p.kind[id]).toBe(ProjectileKind.Musket);
    expect(p.posX[id]).toBe(5);
    expect(p.posY[id]).toBe(7);
    expect(p.posZ[id]).toBe(0);
    expect(p.prevX[id]).toBe(5);
    expect(p.prevY[id]).toBe(7);
    expect(p.velX[id]).toBeCloseTo(dirX * muzzleSpeed, 5);
    expect(p.velY[id]).toBeCloseTo(dirY * muzzleSpeed, 5);
    expect(p.velZ[id]).toBe(0);
    expect(p.life[id]).toBeCloseTo(0.4, 5);
    expect(p.team[id]).toBe(1);
    expect(p.damage[id]).toBeCloseTo(25, 5);
    expect(p.mass[id]).toBeCloseTo(0.03, 5);
    expect(p.ricochets[id]).toBe(0);
    expect(p.fuseT[id]).toBe(0);
  });

  it('spawnMusketBall returns -1 when the pool is full', () => {
    const p = createProjectiles(1);
    const a = spawnMusketBall(p, 0, 0, 1, 0, 0, 10, 400, 0.03, 0.4);
    expect(a).toBe(0);
    const b = spawnMusketBall(p, 0, 0, 1, 0, 0, 10, 400, 0.03, 0.4);
    expect(b).toBe(-1);
  });

  it('spawnSolidShot writes kind=SolidShot, posZ=oz, vz=vz, ricochets=N', () => {
    const p = createProjectiles(8);
    const id = spawnSolidShot(
      p,
      /*ox*/ 1, /*oy*/ 2, /*oz*/ 0.7,
      /*vx*/ 200, /*vy*/ 50, /*vz*/ 30,
      /*team*/ 0, /*damage*/ 80, /*mass*/ 6,
      /*maxLife*/ 4, /*ricochets*/ 3,
    );
    expect(id).toBe(0);
    expect(p.kind[id]).toBe(ProjectileKind.SolidShot);
    expect(p.posX[id]).toBeCloseTo(1, 5);
    expect(p.posY[id]).toBeCloseTo(2, 5);
    expect(p.posZ[id]).toBeCloseTo(0.7, 5);
    expect(p.prevX[id]).toBeCloseTo(1, 5);
    expect(p.prevY[id]).toBeCloseTo(2, 5);
    expect(p.velX[id]).toBeCloseTo(200, 5);
    expect(p.velY[id]).toBeCloseTo(50, 5);
    expect(p.velZ[id]).toBeCloseTo(30, 5);
    expect(p.life[id]).toBeCloseTo(4, 5);
    expect(p.team[id]).toBe(0);
    expect(p.damage[id]).toBeCloseTo(80, 5);
    expect(p.mass[id]).toBeCloseTo(6, 5);
    expect(p.ricochets[id]).toBe(3);
    expect(p.fuseT[id]).toBe(0);
  });

  it('spawnShell writes kind=Shell and fuseT as passed', () => {
    const p = createProjectiles(8);
    const id = spawnShell(
      p,
      /*ox*/ 0, /*oy*/ 0, /*oz*/ 0.7,
      /*vx*/ 180, /*vy*/ 0, /*vz*/ 40,
      /*team*/ 1, /*damage*/ 60, /*mass*/ 6,
      /*maxLife*/ 5, /*fuseT*/ 1.5,
    );
    expect(id).toBe(0);
    expect(p.kind[id]).toBe(ProjectileKind.Shell);
    expect(p.posZ[id]).toBeCloseTo(0.7, 5);
    expect(p.velZ[id]).toBeCloseTo(40, 5);
    expect(p.fuseT[id]).toBeCloseTo(1.5, 5);
    expect(p.ricochets[id]).toBe(0);
    expect(p.life[id]).toBeCloseTo(5, 5);
  });

  it('spawn → free → spawn reuses the id with fresh fields, no stale values from prior occupant', () => {
    const p = createProjectiles(4);

    // First occupant: a solid-shot with a lot of state set.
    const first = spawnSolidShot(p, 10, 20, 0.7, 100, 50, 25, /*team*/ 1, /*damage*/ 100, /*mass*/ 6, /*maxLife*/ 4, /*ricochets*/ 3);
    expect(first).toBe(0);
    expect(p.kind[first]).toBe(ProjectileKind.SolidShot);
    expect(p.ricochets[first]).toBe(3);

    freeProjectile(p, first);
    expect(p.alive[first]).toBe(0);

    // Second occupant in the same slot: a musket ball. None of the prior shot's
    // fields should leak through.
    const reused = spawnMusketBall(p, 1, 2, 1, 0, /*team*/ 0, /*damage*/ 10, /*muzzleSpeed*/ 400, /*mass*/ 0.03, /*maxLife*/ 0.4);
    expect(reused).toBe(first);
    expect(p.kind[reused]).toBe(ProjectileKind.Musket);
    expect(p.posX[reused]).toBeCloseTo(1, 5);
    expect(p.posY[reused]).toBeCloseTo(2, 5);
    expect(p.posZ[reused]).toBe(0);                  // not 0.7 from prior
    expect(p.velZ[reused]).toBe(0);                  // not 25 from prior
    expect(p.ricochets[reused]).toBe(0);             // not 3 from prior
    expect(p.fuseT[reused]).toBe(0);
    expect(p.team[reused]).toBe(0);                  // not 1 from prior
    expect(p.damage[reused]).toBeCloseTo(10, 5);     // not 100 from prior
    expect(p.mass[reused]).toBeCloseTo(0.03, 5);
    expect(p.life[reused]).toBeCloseTo(0.4, 5);
    expect(p.velX[reused]).toBeCloseTo(400, 5);
    expect(p.velY[reused]).toBe(0);
    expect(p.prevX[reused]).toBeCloseTo(1, 5);
    expect(p.prevY[reused]).toBeCloseTo(2, 5);
  });
});

describe('ProjectileKind enum', () => {
  it('matches the spec numbering', () => {
    expect(ProjectileKind.Musket).toBe(0);
    expect(ProjectileKind.SolidShot).toBe(1);
    expect(ProjectileKind.Shell).toBe(2);
  });
});
