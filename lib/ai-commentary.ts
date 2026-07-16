import type { AICommentary, ChartAnalysis, EvidenceKey, StrategyProfile } from '@/types/trade';

export const EVIDENCE_LABELS: Record<EvidenceKey, string> = {
  h4TrendAligned: 'higher-timeframe trend alignment',
  h1TrendAligned: 'confirmation-timeframe alignment',
  structurePattern: 'market structure',
  liquiditySweep: 'liquidity sweep',
  chochConfirmed: 'change of character',
  bosConfirmed: 'break of structure',
  orderBlock: 'order block',
  fairValueGap: 'fair value gap',
  retestConfirmed: 'retest or rejection confirmation',
};

function joinNatural(items: string[]) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function buildAICommentary(
  analysis: ChartAnalysis,
  strategy: StrategyProfile,
  displayName?: string | null,
): AICommentary {
  const ai = strategy.aiBehavior ?? {
    tone: 'analytical', strictness: 'conservative', confidenceThreshold: 80,
    explainDecisions: true, suggestAlternatives: true, useDisplayName: true,
  };
  const required = new Set(strategy.requiredEvidence ?? []);
  const enabled = (strategy.rules ?? []).filter((rule) => rule.enabled);
  const requiredFromRules = enabled.filter((rule) => rule.mandatory).map((rule) => rule.ruleKey as EvidenceKey);
  requiredFromRules.forEach((key) => required.add(key));

  const passed = [...required].filter((key) => analysis.evidence[key]?.value).map((key) => EVIDENCE_LABELS[key]);
  const missing = [...required].filter((key) => !analysis.evidence[key]?.value).map((key) => EVIDENCE_LABELS[key]);
  const violated = [...analysis.warnings];
  const threshold = ai.confidenceThreshold ?? strategy.waitScore;
  const confidenceLow = analysis.setupConfidence < threshold;
  if (confidenceLow) violated.unshift(`Confidence ${analysis.setupConfidence}% is below your ${threshold}% threshold.`);

  const hasReadyCandidate = analysis.candidates.some((candidate) => candidate.status === 'READY');
  const direction = analysis.suggestedDirection ? `${analysis.suggestedDirection.toLowerCase()} bias` : 'no clear directional bias';
  const name = ai.useDisplayName && displayName ? `${displayName}, ` : '';

  let headline = 'Watching the market';
  let nextAction = 'Wait for the next confirmation before acting.';
  let message = `${name}${analysis.instrument} still needs a cleaner structure before it becomes actionable.`;

  if (confidenceLow) {
    headline = 'Waiting for confirmation';
    message = `${name}${analysis.instrument} needs a cleaner read before the setup becomes actionable.`;
    nextAction = 'Let the market build a clearer setup before acting.';
  } else if (hasReadyCandidate) {
    headline = 'Structure is improving';
    message = `${name}${analysis.instrument} is carrying enough structure to review, but the final verdict still belongs to the engine.`;
    nextAction = 'Review the entry, stop, and target before requesting authorization.';
  } else if (missing.length) {
    headline = 'Watching the market';
    message = `${name}${analysis.instrument} remains incomplete. ${joinNatural(missing.slice(0, 2))} still needs to clear.`;
    nextAction = 'Stay flat until the next confirmation arrives.';
  }

  if (!ai.explainDecisions) {
    message = hasReadyCandidate && !confidenceLow
      ? `${name}${analysis.instrument} is carrying enough evidence to review at ${analysis.setupConfidence}% confidence.`
      : `${name}${analysis.instrument} is still incomplete at ${analysis.setupConfidence}% confidence.`;
  }
  if (!ai.suggestAlternatives && !hasReadyCandidate) nextAction = 'Do not enter until the active strategy validates the setup.';

  const spokenText = `${headline}. ${message} Next action: ${nextAction}`;
  return { headline, message, nextAction, passed, missing, violated, tone: ai.tone, spokenText };
}
