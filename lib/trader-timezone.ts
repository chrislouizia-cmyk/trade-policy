export type TraderTimezoneSource = 'UNSET' | 'DEVICE' | 'USER';

export function canonicalTraderTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// Detection initializes a profile once. Later devices may suggest, not silently change it.
export function shouldCaptureTraderTimezone(source: TraderTimezoneSource): boolean {
  return source === 'UNSET';
}
