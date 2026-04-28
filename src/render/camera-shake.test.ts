import { describe, it, expect } from 'vitest';
import { createCameraShake, kickShake, advanceShake, currentOffset, MAX_SHAKE } from './camera-shake';
import { createRng } from '../util/rng';

describe('cameraShake', () => {
  it('decays magnitude to zero over duration', () => {
    const s = createCameraShake();
    const rng = createRng(7);
    kickShake(s, 1.0, 0.5);
    let any = false;
    // Run 40 frames (> 0.5 s at 60fps) to guarantee expiry past float drift.
    for (let i = 0; i < 40; i++) {
      const off = currentOffset(s, rng);
      if (Math.hypot(off.x, off.y) > 0.01) any = true;
      advanceShake(s, 1 / 60);
    }
    expect(any).toBe(true);
    const off = currentOffset(s, rng);
    expect(off.x).toBe(0);
    expect(off.y).toBe(0);
  });

  it('clamps magnitude at MAX_SHAKE', () => {
    const s = createCameraShake();
    kickShake(s, MAX_SHAKE * 5, 1);
    expect(s.magnitude).toBe(MAX_SHAKE);
  });

  it('repeated kicks do not reset duration backwards', () => {
    const s = createCameraShake();
    kickShake(s, 0.2, 1.0);
    advanceShake(s, 0.5);
    kickShake(s, 0.2, 0.3);                          // shorter than remaining
    expect(s.duration).toBeGreaterThanOrEqual(0.5);
  });

  it('returns zero offset when inactive', () => {
    const s = createCameraShake();
    const rng = createRng(42);
    const off = currentOffset(s, rng);
    expect(off.x).toBe(0);
    expect(off.y).toBe(0);
  });

  it('offset amplitude is bounded by magnitude', () => {
    const s = createCameraShake();
    const rng = createRng(99);
    const mag = 0.8;
    kickShake(s, mag, 1.0);
    for (let i = 0; i < 100; i++) {
      const off = currentOffset(s, rng);
      expect(Math.abs(off.x)).toBeLessThanOrEqual(mag + 1e-9);
      expect(Math.abs(off.y)).toBeLessThanOrEqual(mag + 1e-9);
    }
  });
});
