import { confirmationState } from '../../manual-confirmations.ts';
import type { MarketContext } from '../contracts.ts';
import type { ManualConfirmation } from '../../../types/trade.ts';

export type OrderBlockShadowResult = Readonly<{
  ruleKey: 'order-block'; timeframe: string; manualState: 'PASS' | 'FAIL' | 'PENDING';
  detectorState: 'ELIGIBLE' | 'NONE' | 'UNAVAILABLE'; agreement: 'AGREE' | 'DISAGREE' | 'UNRESOLVED';
  selectedBlockId?: string; reason: string;
}>;

/** Diagnostics-only comparison. This function deliberately returns no runtime/evaluation state. */
export function compareManualOrderBlockShadow(input: { rulePresent: boolean; timeframe?: string; manualConfirmation?: ManualConfirmation; marketContext: MarketContext }): OrderBlockShadowResult | null {
  if (!input.rulePresent || !input.timeframe) return null;
  const manual = confirmationState(input.manualConfirmation);
  const manualState = manual === 'CONFIRMED' ? 'PASS' : manual === 'FAILED' ? 'FAIL' : 'PENDING';
  const byTimeframe = input.marketContext.orderBlocksByTimeframe;
  if (!byTimeframe) return Object.freeze({ ruleKey: 'order-block', timeframe: input.timeframe, manualState, detectorState: 'UNAVAILABLE', agreement: 'UNRESOLVED', reason: 'Order Block detector output is unavailable for this context.' });
  const observation = byTimeframe[input.timeframe];
  if (!observation) return Object.freeze({ ruleKey: 'order-block', timeframe: input.timeframe, manualState, detectorState: 'NONE', agreement: manualState === 'PENDING' ? 'UNRESOLVED' : 'DISAGREE', reason: 'No eligible Order Block was detected on the configured timeframe.' });
  const selected = observation.selected;
  if (!selected || !selected.eligible) return Object.freeze({ ruleKey: 'order-block', timeframe: input.timeframe, manualState, detectorState: 'NONE', agreement: manualState === 'PENDING' ? 'UNRESOLVED' : 'DISAGREE', reason: 'No eligible Order Block was detected on the configured timeframe.' });
  const agreement = manualState === 'PASS' ? 'AGREE' : manualState === 'FAIL' ? 'DISAGREE' : 'UNRESOLVED';
  return Object.freeze({ ruleKey: 'order-block', timeframe: input.timeframe, manualState, detectorState: 'ELIGIBLE', agreement, selectedBlockId: selected.id, reason: manualState === 'PASS' ? 'Manual confirmation and eligible detector observation agree.' : manualState === 'FAIL' ? 'Manual confirmation rejected an otherwise eligible detector observation.' : 'Manual confirmation is pending; detector output is informational only.' });
}
