import type { UnitKind } from '../types';

export const cuirassier: UnitKind = {
  id: 'cuirassier',
  category: 'cavalry',
  name: 'Cuirassier',
  placeholderColor: [255, 255, 255],
  placeholderSize: { w: 1.4, h: 2.4 },
  spriteCell: { col: 1, row: 1 },
  baseStats: {
    hp: 140,
    moveSpeed: 7.5,
    morale: 220,
    sightRange: 150,
    weaponRange: 2,
    weaponDamage: 30,
    weaponReload: 1.5,
    weaponAccuracy: 0.9,
    armor: 4,
    massKg: 600,
    formationSpacing: { x: 2.0, y: 3.0 },
    bodyRadius: 0.7,
  },
  bodyZ: { low: 0, high: 2.2 },
  barrelOffset: { forward: 0.6, side: 0.1, height: 1.7 },
};
