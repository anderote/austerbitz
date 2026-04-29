/**
 * Floating damage-number pool.
 *
 * Pure visual feedback (parallel to `Particles` / `Puffs`) — owned by the
 * scene main, not by the sim. Spawn jitter is **deterministic**: derived from
 * the rolling `cursor`, not from any RNG, so replays / tests stay reproducible
 * without consuming sim RNG state.
 */

/** Maximum displayable damage value; larger inputs clamp to 999. */
export const DAMAGE_TEXT_MAX_VALUE = 999;
/** Minimum displayable damage value; smaller inputs clamp to 1. */
export const DAMAGE_TEXT_MIN_VALUE = 1;
/**
 * Initial rise speed (m/s, magnitude). World Y is screen-down, so the
 * integrator subtracts this from `posY` each frame to move the text up
 * on screen. Stored as a positive scalar; sign is applied in the integrator.
 */
export const DAMAGE_TEXT_VEL_Y = 1.5;
/** Lifetime in seconds. */
export const DAMAGE_TEXT_LIFE = 0.7;
/** Per-second deceleration applied to velY (mild gravity, doesn't reverse). */
export const DAMAGE_TEXT_DECEL_Y = 1.0;
/** Half-range of horizontal spawn jitter, world units. */
export const DAMAGE_TEXT_JITTER = 0.15;

export interface DamageTexts {
  capacity: number;
  count: number;
  alive: Uint8Array;
  /** Packed list of alive slot ids; aliveIds[0..count) are live. */
  aliveIds: Int32Array;
  /** Inverse map: aliveIdx[slotId] = packed index, or -1 if not alive. */
  aliveIdx: Int32Array;
  /** Rolling cursor for spawnDamageText; also drives deterministic jitter. */
  cursor: number;
  posX: Float32Array;
  posY: Float32Array;
  velY: Float32Array;
  life: Float32Array;
  lifeMax: Float32Array;
  /** Damage value, clamped to [1, 999]. Uint16 leaves headroom for future tiers. */
  value: Uint16Array;
}

export function createDamageTexts(capacity: number): DamageTexts {
  const aliveIdx = new Int32Array(capacity);
  aliveIdx.fill(-1);
  return {
    capacity, count: 0, cursor: 0,
    alive: new Uint8Array(capacity),
    aliveIds: new Int32Array(capacity),
    aliveIdx,
    posX: new Float32Array(capacity),
    posY: new Float32Array(capacity),
    velY: new Float32Array(capacity),
    life: new Float32Array(capacity),
    lifeMax: new Float32Array(capacity),
    value: new Uint16Array(capacity),
  };
}

/**
 * Allocate a new damage-text slot. Returns -1 if the pool is full.
 *
 * `value` is clamped to `[1, 999]`. Horizontal jitter is computed from the
 * pre-allocation cursor (not RNG) so call order is the only source of
 * variation — deterministic across replays.
 */
export function spawnDamageText(
  d: DamageTexts,
  x: number,
  y: number,
  value: number,
): number {
  const cap = d.capacity;
  let i = d.cursor;
  for (let n = 0; n < cap; n++) {
    if (d.alive[i] === 0) {
      // Deterministic jitter: 8-step sweep from -0.15 to +0.15. Using `i`
      // (the slot we're about to occupy) keeps consecutive spawns visually
      // distinct without needing a counter that survives free/reuse.
      const jitter = ((i & 7) / 7 - 0.5) * 0.3;
      d.alive[i] = 1;
      d.aliveIdx[i] = d.count;
      d.aliveIds[d.count] = i;
      d.count++;
      d.cursor = i + 1 === cap ? 0 : i + 1;
      d.posX[i] = x + jitter;
      d.posY[i] = y;
      d.velY[i] = DAMAGE_TEXT_VEL_Y;
      d.life[i] = DAMAGE_TEXT_LIFE;
      d.lifeMax[i] = DAMAGE_TEXT_LIFE;
      const clamped = value < DAMAGE_TEXT_MIN_VALUE
        ? DAMAGE_TEXT_MIN_VALUE
        : value > DAMAGE_TEXT_MAX_VALUE
          ? DAMAGE_TEXT_MAX_VALUE
          : Math.floor(value);
      d.value[i] = clamped;
      return i;
    }
    i = i + 1 === cap ? 0 : i + 1;
  }
  return -1;
}

/**
 * Frees slot `i`. Safe to call from inside a packed-list iteration if the
 * caller iterates by index `n` and decrements on free (see updateDamageTexts).
 */
export function freeDamageText(d: DamageTexts, i: number): void {
  if (d.alive[i] === 0) return;
  d.alive[i] = 0;
  const idx = d.aliveIdx[i]!;
  const last = d.count - 1;
  if (idx !== last) {
    const lastId = d.aliveIds[last]!;
    d.aliveIds[idx] = lastId;
    d.aliveIdx[lastId] = idx;
  }
  d.aliveIdx[i] = -1;
  d.count--;
}

/**
 * Per-frame tick: decrement life, integrate posY upward (decreasing world Y,
 * which is up on screen since the camera flips Y), decay velY mildly.
 * Slots whose life drops to 0 are freed (and the packed alive-list compacts
 * via swap-with-last in freeDamageText).
 */
export function updateDamageTexts(d: DamageTexts, dt: number): void {
  for (let n = 0; n < d.count; n++) {
    const i = d.aliveIds[n]!;
    d.life[i] -= dt;
    if (d.life[i]! <= 0) {
      freeDamageText(d, i);
      n--;
      continue;
    }
    // Subtract: world Y is screen-down, so up-on-screen = decreasing Y.
    d.posY[i] -= d.velY[i]! * dt;
    // Mild deceleration; velY stays positive in practice for the full life.
    const newVel = d.velY[i]! - DAMAGE_TEXT_DECEL_Y * dt;
    d.velY[i] = newVel < 0 ? 0 : newVel;
  }
}
