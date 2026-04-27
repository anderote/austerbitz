export interface Rng {
  next(): number;
  range(lo: number, hi: number): number;
  intRange(lo: number, hi: number): number;
}

// Mulberry32 — small, fast, good enough for game determinism
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    intRange: (lo, hi) => Math.floor(lo + next() * (hi - lo)),
  };
}
