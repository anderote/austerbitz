import type { UnitKind } from '../types';
import { musket } from '../weapons/musket';

export const lineInfantry: UnitKind = {
  id: 'line-infantry',
  category: 'infantry',
  name: 'British Line Infantry',
  placeholderColor: [255, 255, 255],
  placeholderSize: { w: 1.0, h: 2.25 },
  // Sprite cell is 32×36 (figure centered in the middle 16, side padding
  // reserved for muskets). Display width = 32 * 0.0625 = 2.0 keeps texels
  // square against the 2.25 world-unit height (36 * 0.0625).
  spriteSize: { w: 2.0, h: 2.25 },
  // Figure ends at row ~28 (shadow rows 29–30, empty padding rows 31–35).
  // Foot line ≈ (28/36 - 0.5) * 2.25 = 0.625.
  footYFromCenter: 0.625,
  spriteCell: { col: 1, row: 1 },
  baseStats: {
    hp: 10,
    moveSpeed: 2.5,
    morale: 180,
    sightRange: 120,
    weaponRange: 80,
    weaponDamage: 12,
    weaponReload: 10,
    weaponAccuracy: 0.2,
    armor: 0,
    massKg: 80,
    formationSpacing: { x: 1.0, y: 1.2 },
    bodyRadius: 0.45,
  },
  bodyZ: { low: 0, high: 1.8 },
  barrelOffset: { forward: 0.4, side: 0.0, height: 1.4 },
  weapon: musket,
};
