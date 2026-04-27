export const Pose = {
  idle: 0,
  walking: 1,
  running: 2,
  aiming: 3,
  firing: 4,
  reloading: 5,
  flinch: 6,
  ragdoll: 7,
  dying: 8,
  dead: 9,
} as const;
export type Pose = (typeof Pose)[keyof typeof Pose];

export const POSE_NAMES: readonly string[] = [
  'idle',
  'walking',
  'running',
  'aiming',
  'firing',
  'reloading',
  'flinch',
  'ragdoll',
  'dying',
  'dead',
];

export type PoseKind = 'static' | 'loop' | 'oneshot';

export const POSE_CONFIG: Record<Pose, { kind: PoseKind; fps: number }> = {
  [Pose.idle]: { kind: 'static', fps: 0 },
  [Pose.walking]: { kind: 'loop', fps: 8 },
  [Pose.running]: { kind: 'loop', fps: 12 },
  [Pose.aiming]: { kind: 'static', fps: 0 },
  [Pose.firing]: { kind: 'oneshot', fps: 16 },
  [Pose.reloading]: { kind: 'oneshot', fps: 6 },
  [Pose.flinch]: { kind: 'oneshot', fps: 12 },
  [Pose.ragdoll]: { kind: 'static', fps: 0 },
  [Pose.dying]: { kind: 'oneshot', fps: 8 },
  [Pose.dead]: { kind: 'static', fps: 0 },
};

export function resolveFrame(
  cfg: { kind: PoseKind; fps: number },
  t: number,
  frames: number,
): number {
  if (cfg.kind === 'static' || frames <= 1) return 0;
  const i = Math.floor(t * cfg.fps);
  return cfg.kind === 'loop' ? ((i % frames) + frames) % frames : Math.min(i, frames - 1);
}

export const RUN_THRESHOLD_PX_S = 60;

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Direction = (typeof DIRECTIONS)[number] | 'omni';
