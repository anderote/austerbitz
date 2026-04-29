import type { UnitKind } from '../types';

/**
 * Render-only crewman attached to a gun. Same body footprint as line-infantry,
 * no weapon, differentiated by the per-entity `crewRole` field which selects a
 * tool layer in the kit. Combat fields are sentinels — crew don't fight,
 * target, or take damage in Phase 1.
 *
 * `weapon` is optional on `UnitKind`, so we simply omit it rather than
 * carrying a sentinel. `category: 'infantry'` is the only sensible choice
 * given the union (`'infantry' | 'cavalry' | 'artillery'`); the gun itself is
 * the artillery entity.
 */
export const gunCrewLoader: UnitKind = {
  id: 'gun-crew-loader',
  category: 'infantry',
  name: 'Gun Crew (Loader)',
  placeholderColor: [255, 255, 255],
  placeholderSize: { w: 1.0, h: 2.25 },
  spriteSize: { w: 2.0, h: 2.25 },
  footYFromCenter: 0.625,
  spriteCell: { col: 1, row: 1 },
  baseStats: {
    hp: 1,
    moveSpeed: 0,
    morale: 255,
    sightRange: 0,
    weaponRange: 0,
    weaponDamage: 0,
    weaponReload: 0,
    weaponAccuracy: 0,
    armor: 0,
    massKg: 80,
    formationSpacing: { x: 1.0, y: 1.0 },
    bodyRadius: 0.0,
  },
  bodyZ: { low: 0, high: 1.8 },
  barrelOffset: { forward: 0, side: 0, height: 0 },
};
