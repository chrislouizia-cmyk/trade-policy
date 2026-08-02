import 'server-only';
import type { StrategyProfile } from '@/types/trade';
import { deterministicFingerprint } from './fingerprint';

export function strategyRevisionId(strategy:StrategyProfile):string{
  return `${strategy.engineVersion??1}:${deterministicFingerprint({strategy} as Record<string,unknown>)}`;
}
