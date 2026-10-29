export type StrategyDeletionState = {
  deletedStrategyId: string;
  fallbackStrategyId: string | null;
  selectedStrategyId: string | null;
  deletedWasActive: boolean;
};

export type StrategyDeletionResolution = {
  selectedWasDeleted: boolean;
  nextSelectedStrategyId: string | null;
  nextActiveStrategyId: string | null | undefined;
};

export function reconcileStrategyDeletion({
  deletedStrategyId,
  fallbackStrategyId,
  selectedStrategyId,
  deletedWasActive,
}: StrategyDeletionState): StrategyDeletionResolution {
  const selectedWasDeleted = selectedStrategyId === deletedStrategyId;
  return {
    selectedWasDeleted,
    nextSelectedStrategyId: selectedWasDeleted ? fallbackStrategyId : selectedStrategyId,
    nextActiveStrategyId: deletedWasActive ? fallbackStrategyId : undefined,
  };
}
