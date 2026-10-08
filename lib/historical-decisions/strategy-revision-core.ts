import type { StrategyProfile } from '@/types/trade';
import { deterministicFingerprint } from './fingerprint-core.ts';

export function strategyRevisionId(strategy: StrategyProfile): string {
  return `${strategy.engineVersion ?? 1}:${deterministicFingerprint({ strategy } as Record<string, unknown>)}`;
}

export function strategyRevisionCanonicalText(strategy: StrategyProfile): string {
  return JSON.stringify({ strategy });
}
