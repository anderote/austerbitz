// Plunge curve and per-facing anchor table for the line-infantry reload ramrod.
// Kept separate from sprite-pass so the math is unit-testable.

export const RAMROD_PLUNGE_CYCLES = 4;
export const RAMROD_PLUNGE_DEPTH_PX = 5;

/**
 * Per-facing resting anchor of the ramrod relative to the soldier's body
 * sprite center, in source-cell pixels (32-px component cell). Indexed by
 * runtime facing 0..7 in the order [E, SE, S, SW, W, NW, N, NE]. Positive Y
 * is downward; positive X is right.
 *
 * Numbers are eyeball-tuned starting points — adjust by visual inspection.
 */
export const RAMROD_ANCHOR_PX_BY_FACING: ReadonlyArray<readonly [number, number]> = [
  [+5, -5], // E
  [+5, -5], // SE
  [+4, -5], // S
  [-4, -5], // SW
  [-5, -5], // W
  [-5, -7], // NW
  [+0, -7], // N
  [+5, -7], // NE
];

/**
 * Map normalized reload progress 0..1 to a downward Y offset in source pixels.
 * Output is `Math.round`ed to integer pixels for crisp pixel-art motion.
 *
 * Curve: `(1 - cos(2π * cycleFrac)) / 2` — eased dip-and-recover per cycle,
 * repeated `RAMROD_PLUNGE_CYCLES` times across the reload.
 */
export function ramrodPlungePx(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  const phase = (p * RAMROD_PLUNGE_CYCLES) % 1;
  const eased = (1 - Math.cos(phase * 2 * Math.PI)) * 0.5;
  return Math.round(eased * RAMROD_PLUNGE_DEPTH_PX);
}
