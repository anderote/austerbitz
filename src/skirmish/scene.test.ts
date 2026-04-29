import { describe, it, expect } from 'vitest';
import { createWorld } from '../sim/world';
import { getUnitKindIndex } from '../data/units';
import {
  spawnCannons,
  spawnEnemyBlock,
  CANNON_X,
  CANNON_Y,
  CANNON_SPACING,
  BLOCK_FILES,
  BLOCK_RANKS,
  SPAWN_X,
  LANE_Y,
  MARCH_TARGET_X,
} from './scene';

describe('spawnCannons', () => {
  it('produces 3 cannon-12 entities on team 0 at the expected coords', () => {
    const world = createWorld({ seed: 1, capacity: 64, mapSize: 600 });
    const ids = spawnCannons(world, 0);
    expect(ids.length).toBe(3);
    const cannonKindId = getUnitKindIndex('cannon-12');
    for (const id of ids) {
      expect(world.entities.alive[id]).toBe(1);
      expect(world.entities.team[id]).toBe(0);
      expect(world.entities.kindId[id]).toBe(cannonKindId);
      expect(world.entities.posY[id]).toBe(CANNON_Y);
    }
    const xs = ids.map((id) => world.entities.posX[id]!).sort((a, b) => a - b);
    expect(xs).toEqual([
      CANNON_X - CANNON_SPACING,
      CANNON_X,
      CANNON_X + CANNON_SPACING,
    ]);
    // Cannons should face north (index 6) so their forward vector points -Y.
    for (const id of ids) {
      expect(world.entities.facing[id]).toBe(6);
    }
  });
});

describe('spawnEnemyBlock', () => {
  it('produces FILES * RANKS line-infantry on team 1, all in one march group', () => {
    const world = createWorld({ seed: 1, capacity: 256, mapSize: 600 });
    const block = spawnEnemyBlock(world, 1);
    const expected = BLOCK_FILES * BLOCK_RANKS;
    expect(block.ids.length).toBe(expected);

    const lineKindId = getUnitKindIndex('line-infantry');
    for (const id of block.ids) {
      expect(world.entities.alive[id]).toBe(1);
      expect(world.entities.team[id]).toBe(1);
      expect(world.entities.kindId[id]).toBe(lineKindId);
      // Facing W = index 4.
      expect(world.entities.facing[id]).toBe(4);
    }

    // All members enrolled in the same group.
    const group = world.marchGroups.get(block.groupId);
    expect(group).toBeDefined();
    expect(group!.members.size).toBe(expected);
    expect(group!.forward).toEqual({ x: -1, y: 0 });
    for (const id of block.ids) {
      expect(group!.members.has(id)).toBe(true);
    }
  });

  it('gives every unit a march-formation head order whose target is west of the spawn', () => {
    const world = createWorld({ seed: 2, capacity: 256, mapSize: 600 });
    const block = spawnEnemyBlock(world, 1);
    for (const id of block.ids) {
      const q = world.orderQueue.get(id);
      expect(q).toBeDefined();
      const head = q![0]!;
      expect(head.kind).toBe('march-formation');
      if (head.kind === 'march-formation') {
        expect(head.groupId).toBe(block.groupId);
        // Target is at MARCH_TARGET_X (plus per-rank offset) — well west of SPAWN_X.
        expect(head.targetX).toBeLessThan(SPAWN_X);
        expect(head.targetX).toBeGreaterThanOrEqual(MARCH_TARGET_X);
        // Target preserves the unit's lane file offset within ±BLOCK lateral span.
        const dy = Math.abs(head.targetY - LANE_Y);
        expect(dy).toBeLessThan(BLOCK_FILES);
      }
    }
  });

  it('marks every spawned unit as marching', () => {
    const world = createWorld({ seed: 3, capacity: 256, mapSize: 600 });
    const block = spawnEnemyBlock(world, 1);
    for (const id of block.ids) {
      expect(world.entities.isMarching[id]).toBe(1);
    }
  });
});
