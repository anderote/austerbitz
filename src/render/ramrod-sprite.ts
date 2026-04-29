// 1×5 px steel column packed into the combined atlas. Sampled by the sprite
// pass during the Reloading state to draw a plunging ramrod over the soldier.
// Color matches `'g'` in british-soldier-sprite.ts so the ramrod reads as the
// same steel as the bayonet/barrel.
export const RAMROD_SHEET_W = 1;
export const RAMROD_SHEET_H = 5;
export const RAMROD_STEEL: readonly [number, number, number] = [180, 188, 200];

export function generateRamrodSheet(): Uint8Array {
  const buf = new Uint8Array(RAMROD_SHEET_W * RAMROD_SHEET_H * 4);
  for (let y = 0; y < RAMROD_SHEET_H; y++) {
    const o = y * 4;
    buf[o + 0] = RAMROD_STEEL[0];
    buf[o + 1] = RAMROD_STEEL[1];
    buf[o + 2] = RAMROD_STEEL[2];
    buf[o + 3] = 255;
  }
  return buf;
}
