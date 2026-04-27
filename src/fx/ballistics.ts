export interface LaunchVector {
  vx: number;
  vy: number;
  vz: number;
}

/** Game gravity in m/s². Exaggerated for top-down weight feel. */
export const GAME_GRAVITY = 18;

/**
 * Given a launch position and a target position (both at the same Z),
 * solve for a launch vector with the given muzzle speed using the
 * lower (flatter) ballistic trajectory under GAME_GRAVITY.
 *
 * Returns null if the target is out of range (no real solution).
 *
 * Approach: split the launch speed into horizontal and vertical components.
 * For a given horizontal range R (planar distance from origin to target),
 * the projectile motion (with launch and landing at same height) gives:
 *   R = (v0² · sin(2θ)) / g
 * Solve for θ: sin(2θ) = R · g / v0². If the absolute value is > 1, no
 * solution. Otherwise θ_low = 0.5 · asin(R · g / v0²).
 *
 * vx = v0 · cos(θ_low) · dirX
 * vy = v0 · cos(θ_low) · dirY
 * vz = v0 · sin(θ_low)
 */
export function solveCannonLaunch(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  muzzleSpeed: number,
  gravity: number = GAME_GRAVITY,
): LaunchVector | null {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const range = Math.hypot(dx, dy);

  // Self-target / zero range — no motion required.
  if (range === 0) {
    return { vx: 0, vy: 0, vz: 0 };
  }

  const v0Sq = muzzleSpeed * muzzleSpeed;
  const sin2Theta = (range * gravity) / v0Sq;

  // Out of range: no real ballistic solution at this muzzle speed/gravity.
  if (sin2Theta > 1 || sin2Theta < -1) {
    return null;
  }

  // Lower (flatter) trajectory.
  const theta = 0.5 * Math.asin(sin2Theta);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const dirX = dx / range;
  const dirY = dy / range;

  return {
    vx: muzzleSpeed * cosT * dirX,
    vy: muzzleSpeed * cosT * dirY,
    vz: muzzleSpeed * sinT,
  };
}
