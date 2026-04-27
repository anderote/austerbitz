import type { System } from '../world';

/** Multiplier on each unit's baseStats.moveSpeed during a formation march. */
export const MARCH_SPEED_FACTOR = 0.6;
/** Sim-seconds the group holds in 'volley' phase before resuming the march. */
export const VOLLEY_DURATION = 4.0;
/** Ticks between enemy-in-range scans per group, striped by gid. */
export const MARCH_SCAN_PERIOD = 8;

// Real implementation lands in Task 4; this stub keeps things compilable.
export const marchSystem: System = (_world, _dt) => {};
