export function getUserScopedStorageKey(key: string, userId: string | null | undefined) {
  return userId ? `${key}:${userId}` : key;
}

export function readUserScopedSelection(key: string, userId: string | null | undefined): string | null {
  if (typeof window === 'undefined') return null;
  const scopedKey = getUserScopedStorageKey(key, userId);
  const value = window.localStorage.getItem(scopedKey);
  return value && value.trim() ? value : null;
}

export function writeUserScopedSelection(key: string, userId: string | null | undefined, value: string | null) {
  if (typeof window === 'undefined') return;
  const scopedKey = getUserScopedStorageKey(key, userId);
  if (!value) {
    window.localStorage.removeItem(scopedKey);
    return;
  }
  window.localStorage.setItem(scopedKey, value);
}

export function clearUserScopedSessionState(
  userId: string | null | undefined,
  selection: { strategyId?: string | null; accountId?: string | null } = {},
) {
  if (typeof window === 'undefined') return { strategyId: null, accountId: null };

  const next = { strategyId: null as string | null, accountId: null as string | null };

  if (userId) {
    window.localStorage.removeItem(getUserScopedStorageKey('trade-police:active-strategy', userId));
    window.localStorage.removeItem(getUserScopedStorageKey('trade-police:active-account', userId));
  }

  if (selection.strategyId) next.strategyId = selection.strategyId;
  if (selection.accountId) next.accountId = selection.accountId;

  return next;
}

export function isStrategySelectionOwnedByUser(
  strategyId: string | null | undefined,
  userId: string | null | undefined,
  ownedStrategyIds: readonly string[],
) {
  if (!strategyId || !userId) return false;
  return ownedStrategyIds.includes(strategyId);
}
