export interface SpacingStep {
  readonly mult: number;
  readonly label: string;
}

export const SPACING_STEPS: readonly SpacingStep[] = [
  { mult: 0.05, label: 'Hold' },
  { mult: 0.20, label: 'Hold' },
  { mult: 0.35, label: 'Hold' },
  { mult: 0.50, label: 'Hold' },
  { mult: 0.70, label: 'Hold' },
  { mult: 0.85, label: 'Close' },
  { mult: 1.00, label: 'Close' },
  { mult: 1.15, label: 'Close' },
  { mult: 1.30, label: 'Close' },
  { mult: 1.50, label: 'Open' },
  { mult: 1.75, label: 'Open' },
  { mult: 2.00, label: 'Open' },
  { mult: 2.50, label: 'Open' },
  { mult: 3.50, label: 'Skirmish' },
  { mult: 5.00, label: 'Skirmish' },
  { mult: 8.00, label: 'Skirmish' },
] as const;

export const DEFAULT_SPACING_INDEX = 6;
export const MIN_RANKS = 1;
export const MAX_RANKS = 16;

/** Below this multiplier, the formation is in "tight stance" — units pack
 *  while idle but auto-loosen to march at this floor while moving. */
export const MARCH_FLOOR_MULT = 0.85;

export type RankOverride = number | null;

export interface FormationParams {
  spacingIndex: number;
  ranks: RankOverride;
}

export function createFormationParams(): FormationParams {
  return { spacingIndex: DEFAULT_SPACING_INDEX, ranks: null };
}

export function resetFormationParams(p: FormationParams): void {
  p.spacingIndex = DEFAULT_SPACING_INDEX;
  p.ranks = null;
}

export function bumpSpacing(p: FormationParams, dir: 1 | -1): void {
  const next = p.spacingIndex + dir;
  if (next < 0 || next >= SPACING_STEPS.length) return; // clamp at ends
  p.spacingIndex = next;
}

/**
 * Cycle: `null → MIN_RANKS → … → MAX_RANKS → null` for dir=+1; reverse for dir=-1.
 */
export function bumpRanks(p: FormationParams, dir: 1 | -1): void {
  if (p.ranks == null) {
    p.ranks = dir === 1 ? MIN_RANKS : MAX_RANKS;
    return;
  }
  const next = p.ranks + dir;
  if (next < MIN_RANKS || next > MAX_RANKS) {
    p.ranks = null;
    return;
  }
  p.ranks = next;
}

export function spacingMultiplier(p: FormationParams): number {
  return SPACING_STEPS[p.spacingIndex]!.mult;
}

export function spacingLabel(p: FormationParams): string {
  return SPACING_STEPS[p.spacingIndex]!.label;
}

export function isTightStance(p: FormationParams): boolean {
  return spacingMultiplier(p) < MARCH_FLOOR_MULT;
}
