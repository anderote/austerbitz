import type { UnitKind } from '../types';
import { cannon12Solid } from '../weapons/cannon-12-solid';

export const cannon12: UnitKind = {
  id: 'cannon-12',
  category: 'artillery',
  name: '12-Pounder Cannon',
  placeholderColor: [255, 255, 255],
  placeholderSize: { w: 2.2, h: 2.8 },
  spriteSize: { w: 3.6, h: 3.6 },
  footYFromCenter: 1.5,
  spriteCell: { col: 1, row: 1 },
  baseStats: {
    hp: 200,
    moveSpeed: 0.5,
    morale: 160,
    sightRange: 200,
    weaponRange: 600,
    weaponDamage: 80,
    weaponReload: 20,
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
