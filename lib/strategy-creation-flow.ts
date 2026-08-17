export const STRATEGY_CREATION_MODES = ['visual', 'copilot', 'methodology', 'blank'] as const;

export type StrategyCreationMode = (typeof STRATEGY_CREATION_MODES)[number];

export const STRATEGY_CREATION_MODE_LABELS: Record<StrategyCreationMode, string> = {
  visual: 'Build visually',
  copilot: 'Describe your strategy — Beta',
  methodology: 'Start from a methodology',
  blank: 'Start blank',
};

export function getStrategyCreationModes(): StrategyCreationMode[] {
  return [...STRATEGY_CREATION_MODES];
}

export function canReachFinalReviewDirectlyFromSelector(mode: StrategyCreationMode | null): boolean {
  return false;
}
