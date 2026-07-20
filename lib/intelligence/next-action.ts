import type { DecisionReason, MissingEvidenceItem, NextAction } from '../../types/intelligence.ts';
import type { TradeResult } from '../../types/trade.ts';

export function buildNextActions(
  result: TradeResult,
  reasons: DecisionReason[],
  missingEvidence: MissingEvidenceItem[],
): NextAction[] {
  const actions: NextAction[] = [];
  const blockingIds = reasons.filter((reason) => reason.blocking).map((reason) => reason.id);

  if (result.verdict === 'REJECTED') {
    actions.push({
      id: 'action:do-not-trade',
      type: 'DO_NOT_TRADE',
      priority: 1,
      label: 'Do not enter this trade',
      rationale: 'One or more deterministic blocking conditions are active.',
      blocking: true,
      relatedEvidenceIds: blockingIds,
    });
  }

  const automatic = missingEvidence.filter((item) => item.evaluationMode === 'AUTOMATIC');
  if (automatic.length) {
    actions.push({
      id: 'action:wait-for-evidence',
      type: 'WAIT_FOR_EVIDENCE',
      priority: result.verdict === 'REJECTED' ? 2 : 1,
      label: 'Wait for automatic evidence',
      rationale: automatic.map((item) => item.label).join(', '),
      blocking: automatic.some((item) => item.mandatory),
      relatedEvidenceIds: automatic.map((item) => item.id),
    });
  }

  const manual = missingEvidence.filter((item) => item.evaluationMode === 'MANUAL');
  if (manual.length) {
    actions.push({
      id: 'action:confirm-manual-evidence',
      type: 'CONFIRM_MANUAL_EVIDENCE',
      priority: result.verdict === 'REJECTED' || automatic.length ? 3 : 1,
      label: 'Review manual evidence',
      rationale: manual.map((item) => item.label).join(', '),
      blocking: manual.some((item) => item.mandatory),
      relatedEvidenceIds: manual.map((item) => item.id),
    });
  }

  const external = missingEvidence.filter((item) => item.evaluationMode === 'EXTERNAL');
  if (external.length) {
    actions.push({
      id: 'action:review-external-evidence',
      type: 'REVIEW_EXTERNAL_EVIDENCE',
      priority: result.verdict === 'REJECTED' || automatic.length || manual.length ? 4 : 1,
      label: 'Review external evidence',
      rationale: external.map((item) => item.label).join(', '),
      blocking: external.some((item) => item.mandatory),
      relatedEvidenceIds: external.map((item) => item.id),
    });
  }

  const riskReasonIds = reasons
    .filter((reason) => ['RISK', 'DAILY_LIMIT', 'NEWS', 'SESSION'].includes(reason.category))
    .map((reason) => reason.id);
  if (riskReasonIds.length && result.verdict !== 'AUTHORIZED') {
    actions.push({
      id: 'action:review-risk',
      type: 'REVIEW_RISK',
      priority: result.verdict === 'REJECTED' ? 2 : 2,
      label: 'Review risk controls',
      rationale: 'Resolve the strategy, session, news, or daily-risk restrictions before entry.',
      blocking: reasons.some((reason) => riskReasonIds.includes(reason.id) && reason.blocking),
      relatedEvidenceIds: riskReasonIds,
    });
  }

  if (result.verdict === 'AUTHORIZED') {
    actions.push({
      id: 'action:review-entry',
      type: 'REVIEW_ENTRY',
      priority: 1,
      label: 'Review the entry before execution',
      rationale: 'The strategy conditions passed; verify price and order details before accepting risk.',
      blocking: false,
      relatedEvidenceIds: [],
    });
  }

  if (!actions.length) {
    actions.push({
      id: 'action:run-analysis',
      type: 'RUN_ANALYSIS',
      priority: 1,
      label: 'Run the analysis again',
      rationale: 'Decision context is incomplete, so no safe entry guidance can be produced.',
      blocking: true,
      relatedEvidenceIds: [],
    });
  }

  return actions.sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.priority - b.priority);
}
