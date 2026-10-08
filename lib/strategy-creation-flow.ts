export const STRATEGY_CREATION_MODES = ['visual', 'copilot', 'methodology', 'blank'] as const;

export type StrategyCreationMode = (typeof STRATEGY_CREATION_MODES)[number];

export const STRATEGY_CREATION_MODE_LABELS: Record<StrategyCreationMode, string> = {
  visual: 'Build visually',
  copilot: 'Describe your strategy — Beta',
  methodology: 'Start from a methodology',
  blank: 'Start blank',
};

export const STRATEGY_CREATION_ENTRY_PATHS = ['describe', 'advanced'] as const;
export type StrategyCreationEntryPath = (typeof STRATEGY_CREATION_ENTRY_PATHS)[number];

export const STRATEGY_CREATION_ENTRY_LABELS: Record<StrategyCreationEntryPath, string> = {
  describe: 'Describe how you trade',
  advanced: 'Advanced configuration',
};

export const DEFAULT_STRATEGY_CREATION_ENTRY_PATH: StrategyCreationEntryPath = 'describe';
export const ADVANCED_STRATEGY_CREATION_MODES = ['visual', 'methodology', 'blank'] as const satisfies readonly StrategyCreationMode[];

export function getStrategyCreationEntryPaths(): StrategyCreationEntryPath[] {
  return [...STRATEGY_CREATION_ENTRY_PATHS];
}

export function getAdvancedStrategyCreationModes(): StrategyCreationMode[] {
  return [...ADVANCED_STRATEGY_CREATION_MODES];
}

export function getStrategyCreationModes(): StrategyCreationMode[] {
  return [...STRATEGY_CREATION_MODES];
}

export function canReachFinalReviewDirectlyFromSelector(mode: StrategyCreationMode | null): boolean {
  return false;
}
