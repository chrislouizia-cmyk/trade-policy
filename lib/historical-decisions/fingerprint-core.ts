import { createHash } from 'node:crypto';

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function canonicalStrategyRevisionPayload(strategy: Record<string, unknown>): string {
  return canonical({ strategy } as Record<string, unknown>);
}

export function deterministicFingerprint(snapshot: Record<string, unknown>): string {
  const { deterministicFingerprint: ignoredFingerprint, reportId: ignoredReportId, userId: ignoredUserId, ...meaningful } = snapshot;
  void ignoredFingerprint;
  void ignoredReportId;
  void ignoredUserId;
  return createHash('sha256').update(canonical(meaningful)).digest('hex');
}
