import type { CanisterProfile } from './types';
import { CANNON_SMOKE, CANNON_SMOKE_INDEX } from '../../puffs/profiles/cannon-smoke';

export const cannon12Canister: CanisterProfile = {
  ballCount: 24,
  coneDeg: 18,
  spreadSigmaDeg: 6,
  muzzleSpeed: 280,
  speedJitter: 0.1,
  ballDamage: 9,
  ballDamageVarianceFrac: 0.25,
  ballCritChance: 0.02,
  ballCritMul: 1.75,
  ballMass: 0.05,
  ballMaxLife: 0.4,
  muzzleSmokeProfile: CANNON_SMOKE,
  muzzleSmokeProfileIdx: CANNON_SMOKE_INDEX,
  muzzleSmokeCount: 30,
};
