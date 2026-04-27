import type { UnitKind } from '../types';
import { cannon12Solid } from '../weapons/cannon-12-solid';

export const cannon12: UnitKind = {
  id: 'cannon-12',
  category: 'artillery',
  name: '12-Pounder Cannon',
  placeholderColor: [110, 110, 110],
  placeholderSize: { w: 2.2, h: 2.8 },
  baseStats: {
    hp: 200,
    moveSpeed: 1.2,
    morale: 160,
    sightRange: 200,
    weaponRange: 600,
    weaponDamage: 80,
    weaponReload: 30,
    weaponAccuracy: 0.6,
    armor: 2,
    massKg: 1500,
    formationSpacing: { x: 6.0, y: 6.0 },
    bodyRadius: 1.2,
  },
  bodyZ: { low: 0, high: 1.5 },
  barrelOffset: { forward: 1.6, side: 0.0, height: 0.7 },
  weapon: cannon12Solid,
};
