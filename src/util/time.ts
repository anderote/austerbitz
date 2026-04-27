export interface Accumulator {
  /** Adds elapsed real-time seconds; returns whole sim ticks to run. */
  advance(dt: number): number;
  /** Interpolation factor in [0,1) between the most recent and next sim tick. */
  alpha(): number;
}

export function createAccumulator(stepSeconds: number, maxTicks = 8): Accumulator {
  let acc = 0;
  return {
    advance(dt) {
      acc += dt;
      let ticks = 0;
      while (acc >= stepSeconds && ticks < maxTicks) {
        acc -= stepSeconds;
        ticks++;
      }
      // If we hit the cap, drop excess time so we don't accumulate forever
      if (acc >= stepSeconds) acc = 0;
      return ticks;
    },
    alpha() {
      return acc / stepSeconds;
    },
  };
}
