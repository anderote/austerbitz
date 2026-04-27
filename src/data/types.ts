export type UnitCategory = 'infantry' | 'cavalry' | 'artillery';

export interface BaseStats {
  hp: number;
  moveSpeed: number;        // m/s
  morale: number;           // 0..255 baseline
  sightRange: number;       // m
  weaponRange: number;      // m
  weaponDamage: number;
  weaponReload: number;     // s
  weaponAccuracy: number;   // 0..1
  armor: number;
  massKg: number;
  formationSpacing: { x: number; y: number };
}

export interface UnitKind {
  id: string;
  category: UnitCategory;
  name: string;
  /** Tint color (RGB 0..255). Multiplied with the sprite cell at render time;
   *  for sprite-less kinds the cell is solid white so this becomes the fill. */
  placeholderColor: [number, number, number];
  /** Sprite size in world units (≈ meters). */
  placeholderSize: { w: number; h: number };
  /** Atlas cell for this kind. If omitted, the white tint cell is used. */
  spriteCell?: { col: number; row: number };
  baseStats: BaseStats;
}

export interface UpgradeNode {
  id: string;
  appliesTo: string[] | 'all';
  modifiers: Partial<{
    [K in keyof BaseStats]: { mul?: number; add?: number };
  }>;
  prerequisites: string[];
  cost: number;
}

export interface MapFeature {
  id: number;
  kind: 'hedgerow' | 'wall' | 'building' | 'trench' | 'river';
  shape:
    | { type: 'polyline'; points: { x: number; y: number }[] }
    | { type: 'polygon'; points: { x: number; y: number }[] }
    | { type: 'rect'; x: number; y: number; w: number; h: number };
  blocksMovement: boolean;
  blocksProjectile: boolean;
  blocksSight: boolean;
  cover: number;   // 0..1
  height: number;  // negative for trenches
}
