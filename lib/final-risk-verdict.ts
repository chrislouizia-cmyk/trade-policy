import type { Verdict } from '../types/trade.ts';

export function resolveFinalRiskBaseVerdict(input: {
  hasVetoes: boolean;
  confidenceBelow: boolean;
  tradingDnaOwnsRuleGating: boolean;
  score: number;
  authorizationScore: number;
  waitScore: number;
}): Verdict {
  if (input.hasVetoes) return 'REJECTED';
  if (input.confidenceBelow) return 'WAIT';
  if (input.tradingDnaOwnsRuleGating) return 'AUTHORIZED';
  if (input.score >= input.authorizationScore) return 'AUTHORIZED';
  if (input.score >= input.waitScore) return 'WAIT';
  return 'REJECTED';
}
