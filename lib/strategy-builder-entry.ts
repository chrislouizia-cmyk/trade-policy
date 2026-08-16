export function resolveBuilderEntryMode({
  existingStrategyId,
  isNewStrategyRequest,
}: {
  existingStrategyId?: string | null;
  isNewStrategyRequest: boolean;
}) {
  return Boolean(isNewStrategyRequest) && !existingStrategyId;
}
