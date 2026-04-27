import { describe, it, expect } from 'vitest';
import { createWorld } from '../world';
import { allocEntity } from '../entities';
import { facingSystem, writeFacingIntent, quantizeDirectionToFacing } from './facing-system';

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

    // Larger 30° nudge should flip to NE.
    const bigAngle = 30 * Math.PI / 180;
    writeFacingIntent(world.entities, id, Math.cos(bigAngle), Math.sin(bigAngle));
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
