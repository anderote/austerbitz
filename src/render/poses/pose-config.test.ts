import { describe, it, expect } from 'vitest';
import { resolveFrame, POSE_CONFIG, Pose, POSE_NAMES, DIRECTIONS } from './pose-config';

describe('resolveFrame', () => {
  it('returns 0 for static poses regardless of t and frames', () => {
    const cfg = { kind: 'static' as const, fps: 0 };
    expect(resolveFrame(cfg, 0, 1)).toBe(0);
    expect(resolveFrame(cfg, 5, 8)).toBe(0);
    expect(resolveFrame(cfg, 100, 4)).toBe(0);
  });

  it('returns 0 when frames is 1 or less', () => {
    const cfg = { kind: 'loop' as const, fps: 8 };
    expect(resolveFrame(cfg, 0, 1)).toBe(0);
    expect(resolveFrame(cfg, 5, 1)).toBe(0);
    expect(resolveFrame(cfg, 5, 0)).toBe(0);
  });

  it('returns 0 at t=0 for loops', () => {
    const cfg = { kind: 'loop' as const, fps: 8 };
    expect(resolveFrame(cfg, 0, 4)).toBe(0);
  });

  it('advances by one frame at t = 1/fps for loops', () => {
    const cfg = { kind: 'loop' as const, fps: 8 };
    expect(resolveFrame(cfg, 1 / 8, 4)).toBe(1);
    expect(resolveFrame(cfg, 2 / 8, 4)).toBe(2);
    expect(resolveFrame(cfg, 3 / 8, 4)).toBe(3);
  });

  it('wraps loops past the last frame', () => {
    const cfg = { kind: 'loop' as const, fps: 8 };
    // floor(4/8 * 8) = 4, 4 % 4 = 0
    expect(resolveFrame(cfg, 4 / 8, 4)).toBe(0);
    expect(resolveFrame(cfg, 5 / 8, 4)).toBe(1);
    expect(resolveFrame(cfg, 9 / 8, 4)).toBe(1);
  });

  it('holds the last frame for oneshots after the cycle', () => {
    const cfg = { kind: 'oneshot' as const, fps: 8 };
    expect(resolveFrame(cfg, 0, 4)).toBe(0);
    expect(resolveFrame(cfg, 1 / 8, 4)).toBe(1);
    expect(resolveFrame(cfg, 3 / 8, 4)).toBe(3);
    expect(resolveFrame(cfg, 4 / 8, 4)).toBe(3);
    expect(resolveFrame(cfg, 100, 4)).toBe(3);
  });

  it('uses POSE_CONFIG entries with the documented kinds', () => {
    expect(POSE_CONFIG[Pose.idle].kind).toBe('static');
    expect(POSE_CONFIG[Pose.walking].kind).toBe('loop');
    expect(POSE_CONFIG[Pose.running].kind).toBe('loop');
    expect(POSE_CONFIG[Pose.aiming].kind).toBe('static');
    expect(POSE_CONFIG[Pose.firing].kind).toBe('oneshot');
    expect(POSE_CONFIG[Pose.reloading].kind).toBe('oneshot');
    expect(POSE_CONFIG[Pose.flinch].kind).toBe('oneshot');
    expect(POSE_CONFIG[Pose.ragdoll].kind).toBe('static');
    expect(POSE_CONFIG[Pose.dying].kind).toBe('oneshot');
    expect(POSE_CONFIG[Pose.dead].kind).toBe('static');
  });
});

describe('POSE_NAMES', () => {
  it('matches Pose enum order and length', () => {
    expect(POSE_NAMES).toHaveLength(10);
    expect(POSE_NAMES[Pose.idle]).toBe('idle');
    expect(POSE_NAMES[Pose.walking]).toBe('walking');
    expect(POSE_NAMES[Pose.dead]).toBe('dead');
  });
});

describe('DIRECTIONS', () => {
  it('lists 8 compass directions in N→NW clockwise order', () => {
    expect(DIRECTIONS).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  });
});
