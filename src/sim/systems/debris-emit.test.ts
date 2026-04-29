import { describe, expect, it } from 'vitest';
import { createDebris, DebrisKind } from '../debris';
import { spawnGibs, planGibSpawn } from './debris-emit';
import { createRng } from '../../util/rng';
import type { KitGibInfo, KitGibTable } from '../kit-gib-table';

const ARM_IDS = new Set([1, 6, 7]);
const LEG_IDS = new Set([2, 8, 9]);

const lineInfantryInfo: KitGibInfo = {
  kitIdx: 0,
  kindIdx: 0,
  hasWeapon: true,
  hasHead: true,
  legChunkId: 8,
  armChunkId: 6,
  armChunkIds: [],
  legChunkIds: [],
  miscChunkIds: [],
  gibTint: [240, 230, 210],
};

const peasantInfo: KitGibInfo = {
  kitIdx: 1,
  kindIdx: 1,
  hasWeapon: false,
  hasHead: false,
  legChunkId: 9,
  armChunkId: 7,
  armChunkIds: [],
  legChunkIds: [],
  miscChunkIds: [],
  gibTint: [255, 255, 255],
};

const lineTable: KitGibTable = {
  byKindIdx: [lineInfantryInfo],
  byKitIdx: [lineInfantryInfo],
};

const peasantTable: KitGibTable = {
  byKindIdx: [peasantInfo],
  byKitIdx: [peasantInfo],
};

function emitChunkIds(plan: ReturnType<typeof planGibSpawn>): number[] {
  return plan.emits
    .filter((e) => e.kind === DebrisKind.GenericChunk)
    .map((e) => e.chunkId);
}

describe('planGibSpawn', () => {
  it('cannon kill with kit info produces 1 kit-head + 1 weapon + variable legs/arms + meat', () => {
    const rng = createRng(1);
    const plan = planGibSpawn(rng, 'cannon', true, lineInfantryInfo);
    let kitHeads = 0, weapons = 0, legs = 0, arms = 0;
    for (const e of plan.emits) {
      if (e.kind === DebrisKind.KitHead) kitHeads++;
      else if (e.kind === DebrisKind.KitWeapon) weapons++;
      else if (e.kind === DebrisKind.GenericChunk && LEG_IDS.has(e.chunkId)) legs++;
      else if (e.kind === DebrisKind.GenericChunk && ARM_IDS.has(e.chunkId)) arms++;
    }
    expect(kitHeads).toBe(1);
    expect(weapons).toBe(1);
    expect(legs).toBeGreaterThanOrEqual(1);
    expect(legs).toBeLessThanOrEqual(3);
    expect(arms).toBeGreaterThanOrEqual(1);
    expect(arms).toBeLessThanOrEqual(3);
    expect(plan.bloodBlobs).toBeGreaterThanOrEqual(2);
    expect(plan.bloodBlobs).toBeLessThanOrEqual(4);
  });

  it('cannon kill without kit info falls back to generic head only', () => {
    const rng = createRng(2);
    const plan = planGibSpawn(rng, 'cannon', true, null);
    const headEmits = plan.emits.filter((e) => e.kind === DebrisKind.KitHead);
    const genericHeads = plan.emits.filter(
      (e) => e.kind === DebrisKind.GenericChunk && e.chunkId === 0,
    );
    expect(headEmits.length).toBe(0);
    expect(genericHeads.length).toBe(1);
  });

  it('cannon kill on unarmed kit (peasant): no kit weapon emitted, single generic head', () => {
    const rng = createRng(3);
    const plan = planGibSpawn(rng, 'cannon', true, peasantInfo);
    const weapons = plan.emits.filter((e) => e.kind === DebrisKind.KitWeapon);
    expect(weapons.length).toBe(0);
    const kitHeads = plan.emits.filter((e) => e.kind === DebrisKind.KitHead);
    const generic = plan.emits.filter(
      (e) => e.kind === DebrisKind.GenericChunk && e.chunkId === 0,
    );
    expect(kitHeads.length).toBe(0);
    expect(generic.length).toBe(1);
  });

  it('shako separation: kitted unit gets BOTH a kit-head and a generic skull on full dismemberment', () => {
    const rng = createRng(31);
    const plan = planGibSpawn(rng, 'cannon', true, lineInfantryInfo);
    const kitHeads = plan.emits.filter((e) => e.kind === DebrisKind.KitHead);
    const genericHeads = plan.emits.filter(
      (e) => e.kind === DebrisKind.GenericChunk && e.chunkId === 0,
    );
    expect(kitHeads.length).toBe(1);
    expect(genericHeads.length).toBe(1);
    // Generic skull should carry the kit's gibTint so it reads as the unit's flesh.
    expect(genericHeads[0]!.tint).toEqual(lineInfantryInfo.gibTint);
  });

  it('explosion behaves like cannon (full dismemberment)', () => {
    const rng = createRng(2);
    const plan = planGibSpawn(rng, 'explosion', true, lineInfantryInfo);
    expect(plan.emits.length).toBeGreaterThanOrEqual(6);
  });

  it('spawn variance: different RNG seeds produce different limb counts', () => {
    let observedDistinct = 0;
    let lastArm = -1;
    let lastLeg = -1;
    let armsDiffer = false;
    let legsDiffer = false;
    for (let i = 0; i < 30; i++) {
      const rng = createRng(i + 12345);
      const plan = planGibSpawn(rng, 'cannon', true, lineInfantryInfo);
      let arms = 0, legs = 0;
      for (const e of plan.emits) {
        if (e.kind === DebrisKind.GenericChunk && ARM_IDS.has(e.chunkId)) arms++;
        if (e.kind === DebrisKind.GenericChunk && LEG_IDS.has(e.chunkId)) legs++;
      }
      if (i > 0) {
        if (arms !== lastArm) armsDiffer = true;
        if (legs !== lastLeg) legsDiffer = true;
      }
      lastArm = arms;
      lastLeg = legs;
      observedDistinct++;
    }
    expect(observedDistinct).toBeGreaterThan(0);
    expect(armsDiffer || legsDiffer).toBe(true);
  });

  it('legs/arms picked by kit use the kit-specified variant ids', () => {
    const rng = createRng(7);
    const plan = planGibSpawn(rng, 'cannon', true, lineInfantryInfo);
    const legs = plan.emits.filter(
      (e) => e.kind === DebrisKind.GenericChunk && LEG_IDS.has(e.chunkId),
    );
    const arms = plan.emits.filter(
      (e) => e.kind === DebrisKind.GenericChunk && ARM_IDS.has(e.chunkId),
    );
    for (const l of legs) expect(l.chunkId).toBe(lineInfantryInfo.legChunkId);
    for (const a of arms) expect(a.chunkId).toBe(lineInfantryInfo.armChunkId);
  });

  it('peasant: legs/arms use bare variants', () => {
    const rng = createRng(13);
    const plan = planGibSpawn(rng, 'cannon', true, peasantInfo);
    const legs = plan.emits.filter(
      (e) => e.kind === DebrisKind.GenericChunk && LEG_IDS.has(e.chunkId),
    );
    const arms = plan.emits.filter(
      (e) => e.kind === DebrisKind.GenericChunk && ARM_IDS.has(e.chunkId),
    );
    for (const l of legs) expect(l.chunkId).toBe(9);
    for (const a of arms) expect(a.chunkId).toBe(7);
  });

  it('limb chunks carry kit tint; non-limb generic chunks do not require tint', () => {
    const rng = createRng(11);
    const plan = planGibSpawn(rng, 'cannon', true, lineInfantryInfo);
    const limbs = plan.emits.filter(
      (e) =>
        e.kind === DebrisKind.GenericChunk &&
        (LEG_IDS.has(e.chunkId) || ARM_IDS.has(e.chunkId)),
    );
    expect(limbs.length).toBeGreaterThan(0);
    for (const l of limbs) {
      expect(l.tint).toEqual(lineInfantryInfo.gibTint);
    }
  });

  it('musket lethal: ~14% chance of one chunk', () => {
    let withChunks = 0;
    for (let i = 0; i < 1000; i++) {
      const rng = createRng(i + 1000);
      const plan = planGibSpawn(rng, 'musket', true, null);
      if (plan.emits.length > 0) withChunks++;
    }
    expect(withChunks).toBeGreaterThan(105);
    expect(withChunks).toBeLessThan(180);
  });

  it('musket lethal: limbs (arm or leg) are the majority outcome when a chunk spawns', () => {
    let arms = 0;
    let legs = 0;
    let total = 0;
    for (let i = 0; i < 5000; i++) {
      const rng = createRng(i + 7000);
      const plan = planGibSpawn(rng, 'musket', true, null);
      const ids = emitChunkIds(plan);
      if (ids.length === 0) continue;
      total++;
      const c = ids[0]!;
      if (ARM_IDS.has(c)) arms++;
      if (LEG_IDS.has(c)) legs++;
    }
    expect(total).toBeGreaterThan(0);
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
      const plan = planGibSpawn(rng, 'musket', false, null);
      if (plan.emits.length > 0) {
        withChunks++;
        const c = plan.emits[0]!;
        if (c.kind === DebrisKind.GenericChunk && !LIMB_IDS.has(c.chunkId)) nonLimb++;
      }
    }
    expect(withChunks).toBeGreaterThan(50);
    expect(withChunks).toBeLessThan(120);
    expect(nonLimb).toBe(0);
  });

  it('non-musket non-lethal: never produces gibs', () => {
    for (let i = 0; i < 200; i++) {
      const rng = createRng(i + 11000);
      expect(planGibSpawn(rng, 'cannon', false, null).emits.length).toBe(0);
      expect(planGibSpawn(rng, 'melee', false, null).emits.length).toBe(0);
      expect(planGibSpawn(rng, 'charge', false, null).emits.length).toBe(0);
      expect(planGibSpawn(rng, 'explosion', false, null).emits.length).toBe(0);
    }
  });

  it('melee: 30% chance of one chunk', () => {
    let withChunks = 0;
    for (let i = 0; i < 1000; i++) {
      const rng = createRng(i + 2000);
      const plan = planGibSpawn(rng, 'melee', true, null);
      if (plan.emits.length > 0) withChunks++;
    }
    expect(withChunks).toBeGreaterThan(250);
    expect(withChunks).toBeLessThan(360);
  });

  it('arm pool: when info has armChunkIds, picks land in that pool', () => {
    const POOL = [6, 14];
    const pooledInfo: KitGibInfo = { ...lineInfantryInfo, armChunkIds: POOL };
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const rng = createRng(i + 31337);
      const plan = planGibSpawn(rng, 'cannon', true, pooledInfo);
      for (const e of plan.emits) {
        if (e.kind !== DebrisKind.GenericChunk) continue;
        if (ARM_IDS.has(e.chunkId) || e.chunkId === 14) {
          seen.add(e.chunkId);
          expect(POOL.includes(e.chunkId)).toBe(true);
        }
      }
    }
    // Both pool entries should appear over many trials.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('leg pool: when info has legChunkIds, picks land in that pool', () => {
    const POOL = [8, 10];
    const pooledInfo: KitGibInfo = { ...lineInfantryInfo, legChunkIds: POOL };
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const rng = createRng(i + 42424);
      const plan = planGibSpawn(rng, 'cannon', true, pooledInfo);
      for (const e of plan.emits) {
        if (e.kind !== DebrisKind.GenericChunk) continue;
        if (LEG_IDS.has(e.chunkId) || e.chunkId === 10) {
          seen.add(e.chunkId);
          expect(POOL.includes(e.chunkId)).toBe(true);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('arm pool absent: picker falls back to single armChunkId', () => {
    const rng = createRng(2025);
    const plan = planGibSpawn(rng, 'cannon', true, lineInfantryInfo);
    for (const e of plan.emits) {
      if (e.kind !== DebrisKind.GenericChunk) continue;
      if (ARM_IDS.has(e.chunkId)) {
        expect(e.chunkId).toBe(lineInfantryInfo.armChunkId);
      }
    }
  });

  it('full dismemberment: misc pool produces occasional bonus chunks across trials', () => {
    const MISC = [11, 12, 13, 15];
    const pooledInfo: KitGibInfo = { ...lineInfantryInfo, miscChunkIds: MISC };
    let miscEmits = 0;
    const seen = new Set<number>();
    const TRIALS = 400;
    for (let i = 0; i < TRIALS; i++) {
      const rng = createRng(i + 55555);
      const plan = planGibSpawn(rng, 'cannon', true, pooledInfo);
      for (const e of plan.emits) {
        if (e.kind !== DebrisKind.GenericChunk) continue;
        if (MISC.includes(e.chunkId)) {
          miscEmits++;
          seen.add(e.chunkId);
        }
      }
    }
    expect(miscEmits).toBeGreaterThan(0);
    // ~30% of trials should produce a misc emit; loose bounds against drift.
    expect(miscEmits).toBeGreaterThan(TRIALS * 0.15);
    expect(miscEmits).toBeLessThan(TRIALS * 0.5);
    // Multiple distinct misc chunks should appear across trials.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('full dismemberment: kit without misc pool emits zero misc chunks', () => {
    const MISC_RANGE = new Set([11, 12, 13, 15]);
    for (let i = 0; i < 200; i++) {
      const rng = createRng(i + 66666);
      const plan = planGibSpawn(rng, 'cannon', true, lineInfantryInfo);
      for (const e of plan.emits) {
        if (e.kind !== DebrisKind.GenericChunk) continue;
        expect(MISC_RANGE.has(e.chunkId)).toBe(false);
      }
    }
  });

  it('any spawned chunk references a valid chunkId 0..9', () => {
    for (let i = 0; i < 200; i++) {
      const rng = createRng(i + 5000);
      const plan = planGibSpawn(rng, 'cannon', true, null);
      for (const e of plan.emits) {
        if (e.kind !== DebrisKind.GenericChunk) continue;
        expect(e.chunkId).toBeGreaterThanOrEqual(0);
        expect(e.chunkId).toBeLessThanOrEqual(9);
      }
    }
  });
});

describe('spawnGibs', () => {
  it('cannon kill enqueues debris into the SoA', () => {
    const d = createDebris(64);
    const rng = createRng(42);
    spawnGibs(d, rng, 'cannon', 100, 200, 1, 0, 0, true, 0, 0, lineTable);
    expect(d.count).toBeGreaterThanOrEqual(4);
    const id = d.aliveIds[0]!;
    expect(d.posX[id]).toBe(100);
    expect(d.posY[id]).toBe(200);
    expect(d.team[id]).toBe(0);
    expect(d.ttl[id]).toBeGreaterThan(0);
  });

  it('cannon kill on a kitted unit produces both kit-head and kit-weapon entries', () => {
    const d = createDebris(64);
    const rng = createRng(43);
    spawnGibs(d, rng, 'cannon', 0, 0, 1, 0, 0, true, 0, 0, lineTable);
    let head = 0, weapon = 0;
    for (let i = 0; i < d.count; i++) {
      const id = d.aliveIds[i]!;
      if (d.kind[id] === DebrisKind.KitHead) head++;
      if (d.kind[id] === DebrisKind.KitWeapon) weapon++;
    }
    expect(head).toBe(1);
    expect(weapon).toBe(1);
  });

  it('peasant: cannon kill spawns no kit-weapon entries', () => {
    const d = createDebris(64);
    const rng = createRng(44);
    spawnGibs(d, rng, 'cannon', 0, 0, 1, 0, 0, true, 0, 0, peasantTable);
    let weapon = 0;
    for (let i = 0; i < d.count; i++) {
      const id = d.aliveIds[i]!;
      if (d.kind[id] === DebrisKind.KitWeapon) weapon++;
    }
    expect(weapon).toBe(0);
  });

  it('musket kill at low roll produces zero debris', () => {
    const d = createDebris(64);
    let countBefore = d.count;
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
    spawnGibs(d, rng, 'cannon', 0, 0, 0, 0, 0, true, 0, 0, lineTable);
    expect(d.count).toBeLessThanOrEqual(3);
  });

  it('explosion HitKind biases gib count higher and adds upward Z kick', () => {
    const d = createDebris(64);
    const rng = createRng(11);
    spawnGibs(d, rng, 'explosion', 0, 0, 1, 0, 0, true, 0, 0, lineTable);

    let alive = 0;
    let totalZ = 0;
    for (let i = 0; i < d.capacity; i++) {
      if (d.alive[i]) {
        alive++;
        totalZ += d.velZ[i]!;
      }
    }
    expect(alive).toBeGreaterThanOrEqual(7);
    expect(totalZ / alive).toBeGreaterThan(5);
  });

  it('explosion darkens generic-chunk tint vs cannon (charred limbs)', () => {
    const dCannon = createDebris(64);
    const dBoom = createDebris(64);
    spawnGibs(dCannon, createRng(101), 'cannon', 0, 0, 1, 0, 0, true, 0, 0, lineTable);
    spawnGibs(dBoom, createRng(101), 'explosion', 0, 0, 1, 0, 0, true, 0, 0, lineTable);
    // Average tint across alive generic chunks.
    const avg = (d: ReturnType<typeof createDebris>) => {
      let n = 0, sum = 0;
      for (let i = 0; i < d.count; i++) {
        const id = d.aliveIds[i]!;
        if (d.kind[id] !== DebrisKind.GenericChunk) continue;
        sum += d.tintR[id]! + d.tintG[id]! + d.tintB[id]!;
        n++;
      }
      return n > 0 ? sum / (n * 3) : 0;
    };
    const cannonAvg = avg(dCannon);
    const boomAvg = avg(dBoom);
    expect(boomAvg).toBeLessThan(cannonAvg * 0.7);
  });

  it('musket non-lethal does NOT darken tint (charring is explosion-only)', () => {
    // Force a chunk to spawn — try many seeds until non-lethal musket coughs one up.
    const tint = lineInfantryInfo.gibTint;
    let saw = false;
    for (let i = 0; i < 500 && !saw; i++) {
      const d = createDebris(8);
      spawnGibs(d, createRng(i + 60000), 'musket', 0, 0, 1, 0, 0, false, 0, 0, lineTable);
      if (d.count === 0) continue;
      const id = d.aliveIds[0]!;
      if (d.kind[id] !== DebrisKind.GenericChunk) continue;
      // Tint is unchanged from the kit gib tint (no charring).
      expect(d.tintR[id]).toBe(tint[0]);
      expect(d.tintG[id]).toBe(tint[1]);
      expect(d.tintB[id]).toBe(tint[2]);
      saw = true;
    }
    expect(saw).toBe(true);
  });

  it('explosion sets fromExplosion=1 on every spawned gib', () => {
    const d = createDebris(64);
    spawnGibs(d, createRng(202), 'explosion', 0, 0, 1, 0, 0, true, 0, 0, lineTable);
    expect(d.count).toBeGreaterThan(0);
    for (let i = 0; i < d.count; i++) {
      const id = d.aliveIds[i]!;
      expect(d.fromExplosion[id]).toBe(1);
    }
  });

  it('cannon (non-explosion) leaves fromExplosion=0', () => {
    const d = createDebris(64);
    spawnGibs(d, createRng(203), 'cannon', 0, 0, 1, 0, 0, true, 0, 0, lineTable);
    expect(d.count).toBeGreaterThan(0);
    for (let i = 0; i < d.count; i++) {
      const id = d.aliveIds[i]!;
      expect(d.fromExplosion[id]).toBe(0);
    }
  });

  it('kit gibs record facing for downstream UV resolution', () => {
    const d = createDebris(64);
    const rng = createRng(99);
    spawnGibs(d, rng, 'cannon', 0, 0, 1, 0, 0, true, 0, 5, lineTable);
    let sawKit = false;
    for (let i = 0; i < d.count; i++) {
      const id = d.aliveIds[i]!;
      if (d.kind[id] === DebrisKind.KitHead || d.kind[id] === DebrisKind.KitWeapon) {
        expect(d.facing[id]).toBe(5);
        expect(d.kitIdx[id]).toBe(0);
        sawKit = true;
      }
    }
    expect(sawKit).toBe(true);
  });
});
