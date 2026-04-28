import { describe, it, expect } from 'vitest';
import { createWorld } from '../world';
import { allocEntity } from '../entities';
import { facingSystem, writeFacingIntent, quantizeDirectionToFacing, facingToVec } from './facing-system';

function makeWorld() {
  return createWorld({ seed: 1, capacity: 16, mapSize: 128 });
}

describe('facingSystem', () => {
  it('aligns facing to velocity when moving', () => {
    const world = makeWorld();
    const id = allocEntity(world.entities);
    world.entities.posX[id] = 0;
    world.entities.posY[id] = 0;
    world.entities.velX[id] = 1;
    world.entities.velY[id] = 1;
    world.entities.facing[id] = 0;
    world.entities.facingIntentX[id] = 1;
    world.entities.facingIntentY[id] = 0;

    facingSystem(world, 1 / 60);
    expect(world.entities.facing[id]).toBe(1); // NE
  });

  it('uses facing intent when stationary', () => {
    const world = makeWorld();
    const id = allocEntity(world.entities);
    world.entities.velX[id] = 0;
    world.entities.velY[id] = 0;
    world.entities.facing[id] = 0;
    world.entities.facingIntentX[id] = 1;
    world.entities.facingIntentY[id] = 0;

    writeFacingIntent(world.entities, id, 0, 1);
    facingSystem(world, 1 / 60);
    expect(world.entities.facing[id]).toBe(2); // N
  });

  it('applies hysteresis to avoid flicker', () => {
    const world = makeWorld();
    const id = allocEntity(world.entities);
    world.entities.facing[id] = 0; // east
    world.entities.facingIntentX[id] = 1;
    world.entities.facingIntentY[id] = 0;

    // Small 5° nudge should keep facing east.
    const smallAngle = 5 * Math.PI / 180;
    writeFacingIntent(world.entities, id, Math.cos(smallAngle), Math.sin(smallAngle));
    facingSystem(world, 1 / 60);
    expect(world.entities.facing[id]).toBe(0);

    // 30° intent is past the 22.5° octant boundary but inside the 10°
    // hysteresis margin — facing should still hold at east.
    const justOverBoundary = 30 * Math.PI / 180;
    writeFacingIntent(world.entities, id, Math.cos(justOverBoundary), Math.sin(justOverBoundary));
    facingSystem(world, 1 / 60);
    expect(world.entities.facing[id]).toBe(0);

    // 40° clears boundary + hysteresis (22.5 + 10) — should now flip to NE.
    const wellPastBoundary = 40 * Math.PI / 180;
    writeFacingIntent(world.entities, id, Math.cos(wellPastBoundary), Math.sin(wellPastBoundary));
    facingSystem(world, 1 / 60);
    expect(world.entities.facing[id]).toBe(1);
  });
});

describe('quantizeDirectionToFacing', () => {
  it('maps cardinal and intercardinal directions to octants', () => {
    expect(quantizeDirectionToFacing(1, 0)).toBe(0);   // east
    expect(quantizeDirectionToFacing(1, 1)).toBe(1);   // northeast
    expect(quantizeDirectionToFacing(0, 1)).toBe(2);   // north
    expect(quantizeDirectionToFacing(-1, 1)).toBe(3);  // northwest
    expect(quantizeDirectionToFacing(-1, 0)).toBe(4);  // west
    expect(quantizeDirectionToFacing(-1, -1)).toBe(5); // southwest
    expect(quantizeDirectionToFacing(0, -1)).toBe(6);  // south
    expect(quantizeDirectionToFacing(1, -1)).toBe(7);  // southeast
  });
});

describe('facingToVec', () => {
  it('octant 0 = east, 2 = north, 4 = west, 6 = south', () => {
    expect(facingToVec(0).x).toBeCloseTo(1, 6);
    expect(facingToVec(0).y).toBeCloseTo(0, 6);
    expect(facingToVec(2).x).toBeCloseTo(0, 6);
    expect(facingToVec(2).y).toBeCloseTo(1, 6);
    expect(facingToVec(4).x).toBeCloseTo(-1, 6);
    expect(facingToVec(4).y).toBeCloseTo(0, 6);
    expect(facingToVec(6).x).toBeCloseTo(0, 6);
    expect(facingToVec(6).y).toBeCloseTo(-1, 6);
  });
  it('octant 1 = NE diagonal (unit length)', () => {
    const v = facingToVec(1);
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(v.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
  });
});
