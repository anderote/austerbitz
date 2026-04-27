export type Color3 = readonly [number, number, number];

export interface MuzzleProfile {
  flash: { size: number; life: number; color: Color3 };
  smoke: {
    count: number;
    coneAngle: number;        // radians
    speed: { min: number; max: number };
    life:  { min: number; max: number };
    sizeStart: number;
    sizeGrowth: number;       // size multiplier per second
    upwardDrift: number;      // m/s² upward bias
    drag: number;             // per-tick velocity multiplier
    color: Color3;
  };
  recoilFirer: number;        // meters of one-time positional shove backward on the shooter
}

export interface ExplosionProfile {
  flash: { size: number; life: number; color: Color3 };
  smokeBillow: {
    count: number;
    speedMin: number; speedMax: number;
    lifeMin: number; lifeMax: number;
    sizeStart: number; sizeGrowth: number;
    drag: number; upwardDrift: number;
  };
  debris: { count: number; speedMin: number; speedMax: number; life: number; size: number };
  damage: number;
  damageRadius: number;       // m
  impulse: number;            // base N·s on a target at impact center
}

/** A weapon profile bundles the per-shot params used by sim + FX. */
export interface WeaponProfile {
  id: string;
  kind: 'musket' | 'solid-shot' | 'shell';
  muzzle?: MuzzleProfile;       // not required for shell-only entries that piggyback another weapon
  projectile: {
    mass: number;               // kg
    muzzleVelocity: number;     // m/s
    damage: number;
    accuracySpreadRad?: number; // optional aim cone
    maxLife: number;            // s
    /** For arcing shots only. */
    launchHeight?: number;      // m, default 0
    /** Solid-shot only. */
    ricochetCount?: number;
    restitutionZ?: number;
    horizontalDampingPerRicochet?: number;
    groundFriction?: number;    // /s
    rollStopSpeed?: number;     // m/s
    perHitDamageFalloff?: number;
    perHitVelocityFalloff?: number;
    freeBelowDamage?: number;
    /** Shell only. */
    fuse?: number;              // s
    explosion?: ExplosionProfile;
  };
}
