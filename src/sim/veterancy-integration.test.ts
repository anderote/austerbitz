import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { allocEntity } from './entities';
import { createParticles } from '../particles/particles';
import { applyHit } from './systems/combat-events';
import { createDebris } from './debris';
import { Rank } from './veterancy';
import { getUnitKindIndex } from '../data/units';

describe('end-to-end veterancy', () => {
  it('a soldier ranks up after a confirmed kill via applyHit', () => {
    const w = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const e = w.entities;
    const particles = createParticles(64);
    const debris = createDebris(64);

    const a = allocEntity(e);
    const v = allocEntity(e);
    e.kindId[a] = getUnitKindIndex('line-infantry');
    e.kindId[v] = getUnitKindIndex('line-infantry');
    e.team[a] = 0; e.team[v] = 1;
    e.posX[a] = 0; e.posY[a] = 0;
    e.posX[v] = 5; e.posY[v] = 0;
    e.hp[v] = 1;

    expect(e.rank[a]).toBe(Rank.Recruit);
    expect(e.xp[a]).toBe(0);

    applyHit(e, particles, w.rng, v, 100, 0, 0, 'musket', undefined, debris, a);

    expect(e.hp[v]).toBe(0);
    expect(e.rank[a]).toBe(Rank.Veteran);
    expect(e.xp[a]).toBe(0);
  });

  it('three kills promote the soldier from Recruit to Sergeant', () => {
    const w = createWorld({ seed: 1, capacity: 64, mapSize: 100 });
    const e = w.entities;
    const particles = createParticles(64);
    const debris = createDebris(64);

    const a = allocEntity(e);
    e.kindId[a] = getUnitKindIndex('line-infantry');
    e.team[a] = 0;

    for (let k = 0; k < 3; k++) {
      const v = allocEntity(e);
      e.kindId[v] = getUnitKindIndex('line-infantry');
      e.team[v] = 1;
      e.hp[v] = 1;
      applyHit(e, particles, w.rng, v, 100, 0, 0, 'musket', undefined, debris, a);
    }

    // Promotion path: 0 → Veteran (1 kill) → Sergeant (2 more, threshold 2)
    expect(e.rank[a]).toBe(Rank.Sergeant);
    expect(e.xp[a]).toBe(0);
  });

  it('rank multiplier carries through fire-resolver damage', async () => {
    // Smoke test: a Captain's projectile damage is base × 1.25.
    // Use the real spawn path (not just the helper) by going through resolveFire.
    const { resolveFire } = await import('./fire-resolver');
    const { createProjectiles } = await import('./projectiles');
    const { createPuffs } = await import('../puffs/puffs');

    const w = createWorld({ seed: 1, capacity: 8, mapSize: 100 });
    const e = w.entities;
    const projectiles = createProjectiles(8);
    const particles = createParticles(64);
    const puffs = createPuffs(64);

    const a = allocEntity(e);
    e.kindId[a] = getUnitKindIndex('line-infantry');
    e.team[a] = 0;
    e.posX[a] = 0; e.posY[a] = 0;
    e.rank[a] = Rank.Captain;

    const ok = resolveFire(e, projectiles, particles, puffs, w.rng, a, 10, 0);
    expect(ok).toBe(true);

    // First alive projectile should carry rank-multiplied damage.
    let firstId = -1;
    for (let i = 0; i < projectiles.capacity; i++) {
      if (projectiles.alive[i] === 1) { firstId = i; break; }
    }
    expect(firstId).not.toBe(-1);
    // line-infantry baseStats.weaponDamage = 12; × 1.25 = 15.
    // Musket has ±33% damage variance; assert the roll falls in range.
    expect(projectiles.damage[firstId]).toBeGreaterThanOrEqual(15 * 0.66);
    expect(projectiles.damage[firstId]).toBeLessThanOrEqual(15 * 1.34);
  });
});
