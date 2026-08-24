import 'server-only';
import type { StrategyProfile } from '@/types/trade';
import { deterministicFingerprint } from './fingerprint.ts';

export function strategyRevisionId(strategy:StrategyProfile):string{
  return `${strategy.engineVersion??1}:${deterministicFingerprint({strategy} as Record<string,unknown>)}`;
}

export function strategyRevisionCanonicalText(strategy:StrategyProfile):string{
  return JSON.stringify({ strategy });
}
