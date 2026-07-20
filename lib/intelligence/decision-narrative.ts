import type {
  CopilotRecommendation,
  DecisionNarrative,
  DecisionReason,
  DecisionReasonCategory,
} from '../../types/intelligence.ts';
import type { StrategyProfile, TradeInput, TradeResult, Verdict } from '../../types/trade.ts';
import { buildMissingEvidence } from './missing-evidence.ts';
import { buildNextActions } from './next-action.ts';
import { buildStrategyContext } from './strategy-context.ts';

const recommendationByVerdict: Record<Verdict, CopilotRecommendation> = {
  AUTHORIZED: 'ENTER',
  WAIT: 'WAIT',
  REJECTED: 'BLOCK',
};

function categoryFor(message: string): DecisionReasonCategory {
  const normalized = message.toLowerCase();
  if (normalized.includes('daily') || normalized.includes('green day') || normalized.includes('trade allowance')) return 'DAILY_LIMIT';
  if (normalized.includes('risk') || normalized.includes('rr') || normalized.includes('stop')) return 'RISK';
  if (normalized.includes('session')) return 'SESSION';
  if (normalized.includes('news')) return 'NEWS';
  if (normalized.includes('setup')) return 'SETUP';
  if (normalized.includes('confidence')) return 'EVIDENCE';
  return 'EVIDENCE';
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

export function recommendationForVerdict(verdict: Verdict): CopilotRecommendation {
  return recommendationByVerdict[verdict];
}

export function buildDecisionNarrative({
  result,
  strategy,
  input,
  now = new Date(),
}: {
  result: TradeResult;
  strategy: StrategyProfile;
  input: TradeInput;
  now?: Date;
}): DecisionNarrative {
  const strategyContext = buildStrategyContext(strategy);
  const missingEvidence = buildMissingEvidence(strategy, input);
  const blockingReasons: DecisionReason[] = result.vetoes.map((message, index) => ({
    id: `veto:${index}:${slug(message)}`,
    code: 'ENGINE_VETO',
    category: categoryFor(message),
    status: 'FAILED',
    origin: 'RISK_ENGINE',
    message,
    blocking: true,
  }));
  const advisoryReasons: DecisionReason[] = result.observations.map((message, index) => ({
    id: `observation:${index}:${slug(message)}`,
    code: 'ENGINE_OBSERVATION',
    category: categoryFor(message),
    status: 'ADVISORY',
    origin: 'RISK_ENGINE',
    message,
    blocking: false,
  }));
  const reasons = [...blockingReasons, ...advisoryReasons];
  const recommendation = recommendationForVerdict(result.verdict);
  const requiredScore = Number(strategy.aiBehavior?.confidenceThreshold);
  const currentScore = Number(input.setupConfidence);
  const readiness = {
    currentScore: Number.isFinite(currentScore) ? currentScore : null,
    requiredScore: Number.isFinite(requiredScore) ? requiredScore : null,
    label: 'Evidence readiness' as const,
    isProbability: false as const,
  };
  const nextActions = buildNextActions(result, reasons, missingEvidence);

  const headline = recommendation === 'ENTER'
    ? 'ENTER — strategy conditions passed'
    : recommendation === 'WAIT'
      ? 'WAIT — more confirmation is required'
      : 'BLOCK — do not enter this trade';
  const explanation = blockingReasons.length
    ? blockingReasons.map((reason) => reason.message).join(' ')
    : recommendation === 'WAIT'
      ? `Evidence readiness is ${readiness.currentScore ?? 'unavailable'}% against the required ${readiness.requiredScore ?? 'unavailable'}%.`
      : 'The final deterministic validation passed without a blocking reason.';

  return {
    version: '1',
    recommendation,
    engineVerdict: result.verdict,
    source: 'DETERMINISTIC',
    headline,
    explanation,
    reasons,
    missingEvidence,
    nextActions,
    strategyContext,
    readiness,
    disciplineMessage: recommendation === 'ENTER'
      ? 'Authorization is not a profit guarantee. Confirm the order details and accept only the configured risk.'
      : 'Follow the strategy conditions and do not force an entry while requirements remain unresolved.',
    generatedAt: now.toISOString(),
    fallbackUsed: false,
  };
}
