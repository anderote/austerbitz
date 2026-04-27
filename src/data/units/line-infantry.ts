import type { UnitKind } from '../types';
import { musket } from '../weapons/musket';

export const lineInfantry: UnitKind = {
  id: 'line-infantry',
  category: 'infantry',
  name: 'British Line Infantry',
  placeholderColor: [255, 255, 255],
  placeholderSize: { w: 1.1, h: 1.8 },
  spriteCell: { col: 1, row: 1 },
  baseStats: {
    hp: 60,
    moveSpeed: 2.5,
    morale: 180,
    sightRange: 120,
    weaponRange: 80,
    weaponDamage: 12,
    weaponReload: 10,
    weaponAccuracy: 0.4,
    armor: 0,
    massKg: 80,
    formationSpacing: { x: 0.9, y: 1.6 },
    bodyRadius: 0.45,
  },
  bodyZ: { low: 0, high: 1.8 },
  barrelOffset: { forward: 0.4, side: 0.0, height: 1.4 },
  weapon: musket,
};
