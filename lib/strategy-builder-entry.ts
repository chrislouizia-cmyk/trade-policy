export function resolveBuilderEntryMode({
  existingStrategyId,
  isNewStrategyRequest,
}: {
  existingStrategyId?: string | null;
  isNewStrategyRequest: boolean;
}) {
  return Boolean(isNewStrategyRequest) && !existingStrategyId;
}

export function shouldAutoOpenCreatorOnEmptyLanding({
  hasExistingProfiles,
  isUserInitiated,
}: {
  hasExistingProfiles: boolean;
  isUserInitiated: boolean;
}) {
  return isUserInitiated && !hasExistingProfiles;
}
