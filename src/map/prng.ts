export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(r: RNG, lo: number, hi: number): number {
  return lo + r() * (hi - lo);
}

export function randInt(r: RNG, lo: number, hi: number): number {
  return Math.floor(lo + r() * (hi - lo + 1));
}

export function randInDisc(r: RNG, radius: number): { x: number; y: number } {
  for (;;) {
    const x = (r() * 2 - 1) * radius;
    const y = (r() * 2 - 1) * radius;
    if (x * x + y * y <= radius * radius) return { x, y };
  }
}
