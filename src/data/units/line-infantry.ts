import type { UnitKind } from '../types';
import { musket } from '../weapons/musket';

export const lineInfantry: UnitKind = {
  id: 'line-infantry',
  category: 'infantry',
  name: 'British Line Infantry',
  placeholderColor: [255, 255, 255],
  placeholderSize: { w: 1.0, h: 2.25 },
  // Texture is 16×36 with the figure ending at row ~28 (shadow rows 29–30,
  // empty padding rows 31–35). Foot line ≈ (28/36 - 0.5) * 2.25 = 0.625.
  footYFromCenter: 0.625,
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
    formationSpacing: { x: 1.2, y: 1.6 },
    bodyRadius: 0.45,
  },
  bodyZ: { low: 0, high: 1.8 },
  barrelOffset: { forward: 0.4, side: 0.0, height: 1.4 },
  weapon: musket,
};
