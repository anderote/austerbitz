import type { UnitKind } from '../types';

export const cuirassier: UnitKind = {
  id: 'cuirassier',
  category: 'cavalry',
  name: 'Cuirassier',
  placeholderColor: [60, 90, 200],
  placeholderSize: { w: 1.4, h: 2.4 },
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
  },
};
