import type { Puffs } from '../puffs/puffs';
import { applyWindToPuffs } from '../puffs/wind';

/** Lab-side wind: forwards horizontal acceleration to the puff system.
 *  Sparks (flash, blood, debris) are not wind-affected, matching the prior
 *  behavior. */
export function applyWind(puffs: Puffs, accelX: number, dt: number): void {
  applyWindToPuffs(puffs, accelX, 0, dt);
}
