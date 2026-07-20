import type { MissingEvidenceItem } from '../../types/intelligence.ts';
import type { EvidenceKey, StrategyProfile, TradeInput } from '../../types/trade.ts';
import { confirmationState, ruleLabel } from '../manual-confirmations.ts';

const labels: Record<EvidenceKey, string> = {
  h4TrendAligned: 'Trend timeframe aligned',
  h1TrendAligned: 'Confirmation timeframe aligned',
  structurePattern: 'Market structure confirmed',
  liquiditySweep: 'Liquidity sweep',
  chochConfirmed: 'Change of character confirmed',
  bosConfirmed: 'Break of structure confirmed',
  orderBlock: 'Valid order block',
  fairValueGap: 'Valid fair value gap',
  retestConfirmed: 'Retest or rejection confirmed',
};

const layerByRole = { MACRO: 1, TREND: 2, CONFIRMATION: 3, ENTRY: 4, TRIGGER: 5 } as const;

function timeframeForRole(strategy: StrategyProfile, role: keyof typeof layerByRole): string | undefined {
  if (role === 'MACRO') return strategy.macroTimeframe;
  if (role === 'TREND') return strategy.trendTimeframe;
  if (role === 'CONFIRMATION') return strategy.confirmationTimeframe;
  if (role === 'ENTRY') return strategy.entryTimeframe;
  return strategy.triggerTimeframe;
}

export function buildMissingEvidence(
  strategy: StrategyProfile,
  input: TradeInput,
): MissingEvidenceItem[] {
  return (strategy.rules ?? [])
    .filter((rule) => rule.enabled && !Boolean(input[rule.ruleKey as EvidenceKey]))
    .map((rule) => {
      const evidenceKey = rule.ruleKey as EvidenceKey;
      const evaluationMode = rule.evaluationMode ?? 'AUTOMATIC';
      const manualConfirmation = input.manualConfirmations?.find(
        (item) => item.evidenceKey === evidenceKey,
      );
      const detected = evaluationMode === 'MANUAL'
        ? confirmationState(manualConfirmation)==='CONFIRMED'?true:null
        : evaluationMode === 'EXTERNAL' ? null : Boolean(input[evidenceKey]);

      return {
        id: `evidence:${evidenceKey}`,
        evidenceKey,
        ruleKey: rule.ruleKey,
        label: ruleLabel(rule.ruleKey,rule.label)||labels[evidenceKey],
        layer: layerByRole[rule.timeframeRole],
        timeframe: timeframeForRole(strategy, rule.timeframeRole),
        evaluationMode,
        mandatory: rule.mandatory,
        detected,
        confidence: null,
        minimumConfidence: Number.isFinite(rule.minimumConfidence)
          ? rule.minimumConfidence
          : undefined,
        reason: evaluationMode === 'MANUAL'
          ? `${ruleLabel(rule.ruleKey,rule.label)||labels[evidenceKey]} requires trader confirmation.`
          : evaluationMode === 'EXTERNAL'
            ? `${rule.label || labels[evidenceKey]} requires evidence from the configured external source.`
            : `${rule.label || labels[evidenceKey]} has not been detected automatically.`,
        canUserConfirm: evaluationMode === 'MANUAL',
      } satisfies MissingEvidenceItem;
    });
}
