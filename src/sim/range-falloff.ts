/**
 * Pure range-falloff multiplier for projectile damage at hit time.
 *
 * `nearM` is the muzzle-grace zone (full damage). Past it, the multiplier
 * decays exponentially with rate `decayK` (1/m), floored at `minMul`.
 * `decayK <= 0` disables falloff (always returns 1).
 */
export function rangeFalloffMul(
  distance: number,
  nearM: number,
  decayK: number,
  minMul: number,
): number {
  if (decayK <= 0) return 1;
  const t = Math.max(0, distance - nearM);
  if (t === 0) return 1;
  return Math.max(minMul, Math.exp(-decayK * t));
}
