import { describe, expect, it } from 'vitest';
import { createWorld, type WorldConfig } from '../../sim/world';
import { allocEntity } from '../../sim/entities';
import { createRankInstances, computeRankInstances, ICON_GAP } from './rank-pass';
import { Rank } from '../../sim/veterancy';
import { lineInfantry } from '../../data/units/line-infantry';
import { getUnitKindIndex } from '../../data/units';
import { EntityState } from '../../sim/entities';

const cfg: WorldConfig = { seed: 1, capacity: 16, mapSize: 100 };

describe('computeRankInstances', () => {
  it('emits no instances for Recruits', () => {
    const w = createWorld(cfg);
    const id = allocEntity(w.entities);
    w.entities.kindId[id] = getUnitKindIndex('line-infantry');
    w.entities.posX[id] = 5; w.entities.posY[id] = 5;
    w.entities.rank[id] = Rank.Recruit;
    const out = createRankInstances(8);
    computeRankInstances(w, out);
    expect(out.count).toBe(0);
  });

  it('emits one instance per non-Recruit alive entity, anchored below feet', () => {
    const w = createWorld(cfg);
    const id = allocEntity(w.entities);
    w.entities.kindId[id] = getUnitKindIndex('line-infantry');
    w.entities.posX[id] = 5; w.entities.posY[id] = 7;
    w.entities.rank[id] = Rank.Sergeant;
    const out = createRankInstances(8);
    computeRankInstances(w, out);
    expect(out.count).toBe(1);
    expect(out.pos[0]).toBeCloseTo(5);
    const footY = 7 + (lineInfantry.footYFromCenter ?? lineInfantry.placeholderSize.h * 0.5);
    expect(out.pos[1]).toBeCloseTo(footY + ICON_GAP + 0.3);
    expect(out.rank[0]).toBe(Rank.Sergeant);
  });

  it('skips dying/dead entities', () => {
    const w = createWorld(cfg);
    const id = allocEntity(w.entities);
    w.entities.kindId[id] = getUnitKindIndex('line-infantry');
    w.entities.rank[id] = Rank.Veteran;
    w.entities.state[id] = EntityState.Dying;
    const out = createRankInstances(8);
    computeRankInstances(w, out);
    expect(out.count).toBe(0);
  });
});
