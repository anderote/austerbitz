import type { PuffProfile } from '../../puffs/profile';

export type Color3 = readonly [number, number, number];

export interface MuzzleProfile {
  flash: { size: number; life: number; color: Color3 };
  smoke: {
    profile: PuffProfile;
    profileIdx: number;
    count: number;
    coneAngle: number;          // radians
    speed: { min: number; max: number };
  };
  recoilFirer: number;        // meters of one-time positional shove backward on the shooter
  /** Visual recoil animation duration in seconds. Defaults to RECOIL_T (0.9). */
  recoilDuration?: number;
}

export interface ExplosionProfile {
  flash: { size: number; life: number; color: Color3 };
  // coneAngle is omitted — explosions are always radial (2π); hardcoded in spawnExplosion.
  smokeBillow: {
    profile: PuffProfile;
    profileIdx: number;
    count: number;
    speed: { min: number; max: number };
  };
  debris: { count: number; speedMin: number; speedMax: number; life: number; size: number };
  damage: number;
  damageRadius: number;       // m
  impulse: number;            // base N·s on a target at impact center
}

export interface CanisterProfile {
  ballCount: number;
  coneDeg: number;
  spreadSigmaDeg: number;
  muzzleSpeed: number;
  speedJitter: number;       // ±fraction of muzzleSpeed
  ballDamage: number;
  /** Per-ball ±fraction variance, uniform. Omit / 0 = deterministic. */
  ballDamageVarianceFrac?: number;
  /** Per-ball 0..1 crit chance. Omit / 0 = none. */
  ballCritChance?: number;
  /** Per-ball crit multiplier. Default 1.5. */
  ballCritMul?: number;
  ballMass: number;
  ballMaxLife: number;
  muzzleSmokeProfile: PuffProfile;
  muzzleSmokeProfileIdx: number;
  muzzleSmokeCount: number;
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
    /**
     * Per-shot damage variance, uniform ±fraction of `damage`. e.g. 0.33 →
     * roll in [0.67·damage, 1.33·damage]. Omit / 0 = deterministic.
     */
    damageVarianceFrac?: number;
    /** 0..1 chance per shot to trigger a critical hit. Omit / 0 = none. */
    critChance?: number;
    /** Damage multiplier on crit. Default 1.5. */
    critMul?: number;
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
    /**
     * Range falloff: at hit time, applied damage = damage * exp(-decayK * max(0, dist - nearM)),
     * floored at minMul. Omit ⇒ no falloff.
     */
    rangeFalloff?: { nearM: number; decayK: number; minMul: number };
    /**
     * Pierce: after each hit, carried damage *= perTargetMul (and velocity *= velocityMul);
     * the projectile is freed once damage drops below `baseDamage * minDamageFrac`.
     * Omit ⇒ free on first hit.
     */
    pierce?: { minDamageFrac: number; perTargetMul: number; velocityMul?: number };
    /** Shell only. */
    fuse?: number;              // s
    explosion?: ExplosionProfile;
  };
}
