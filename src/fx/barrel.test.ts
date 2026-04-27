import { describe, it, expect } from 'vitest';
import { createEntities, allocEntity } from '../sim/entities';
import { getUnitKindIndex } from '../data/units';
import { barrelTip } from './barrel';

const TOL = 1e-6;

describe('barrelTip', () => {
  it('east-facing line infantry: forward offset adds to x, dir is (1,0)', () => {
    const e = createEntities(4);
    const id = allocEntity(e);
    e.posX[id] = 10;
    e.posY[id] = 20;
    e.facing[id] = 0; // east
    e.kindId[id] = getUnitKindIndex('line-infantry');

    const tip = barrelTip(e, id);
    expect(tip.x).toBeCloseTo(10 + 0.4, 6);
    expect(tip.y).toBeCloseTo(20, 6);
    expect(tip.z).toBeCloseTo(1.4, 6);
    expect(tip.dirX).toBeCloseTo(1, 6);
    expect(Math.abs(tip.dirY)).toBeLessThan(TOL);
  });

  it('north-facing line infantry: forward offset adds to y, dir is (0,1)', () => {
    const e = createEntities(4);
    const id = allocEntity(e);
    e.posX[id] = 10;
    e.posY[id] = 20;
    e.facing[id] = 2; // north
    e.kindId[id] = getUnitKindIndex('line-infantry');

    const tip = barrelTip(e, id);
    expect(tip.x).toBeCloseTo(10, 6);
    expect(tip.y).toBeCloseTo(20 + 0.4, 6);
    expect(tip.z).toBeCloseTo(1.4, 6);
    expect(Math.abs(tip.dirX)).toBeLessThan(TOL);
    expect(tip.dirY).toBeCloseTo(1, 6);
  });

  it('west-facing line infantry: forward offset subtracts from x, dir is (-1,0)', () => {
    const e = createEntities(4);
    const id = allocEntity(e);
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 4; // west
    e.kindId[id] = getUnitKindIndex('line-infantry');

    const tip = barrelTip(e, id);
    expect(tip.x).toBeCloseTo(-0.4, 6);
    expect(tip.y).toBeCloseTo(0, 6);
    expect(tip.dirX).toBeCloseTo(-1, 6);
    expect(Math.abs(tip.dirY)).toBeLessThan(TOL);
  });

  it('side offset is applied perpendicular (CCW) to facing — east-facing cuirassier', () => {
    const e = createEntities(4);
    const id = allocEntity(e);
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 0; // east; side vector = (0, 1)
    e.kindId[id] = getUnitKindIndex('cuirassier');

    const tip = barrelTip(e, id);
    expect(tip.x).toBeCloseTo(0.6, 6);
    expect(tip.y).toBeCloseTo(0.1, 6);
    expect(tip.z).toBeCloseTo(1.7, 6);
    expect(tip.dirX).toBeCloseTo(1, 6);
    expect(Math.abs(tip.dirY)).toBeLessThan(TOL);
  });

  it('diagonal facing (NE, 45°) splits forward offset between x and y', () => {
    const e = createEntities(4);
    const id = allocEntity(e);
    e.posX[id] = 0;
    e.posY[id] = 0;
    e.facing[id] = 1; // NE
    e.kindId[id] = getUnitKindIndex('line-infantry');

    const tip = barrelTip(e, id);
    const expected = 0.4 * Math.cos(Math.PI / 4); // ≈ 0.2828
    expect(tip.x).toBeCloseTo(expected, 6);
    expect(tip.y).toBeCloseTo(expected, 6);
    expect(tip.dirX).toBeCloseTo(Math.SQRT1_2, 6);
    expect(tip.dirY).toBeCloseTo(Math.SQRT1_2, 6);
  });
});
