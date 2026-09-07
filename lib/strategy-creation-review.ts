import type { StrategyProfile } from '../types/trade.ts';
import type { Capability, RuleGroupType } from './strategy-builder-v2.ts';
import {
  adaptCanonicalCreationDraftToV2Persistence,
  assessCanonicalCreationDraft,
  confirmCanonicalCreationDraft,
  createCanonicalCreationDraft,
  type CanonicalCreationDraft,
  type CanonicalCreationField,
  type ValueProvenance,
} from './strategy-creation-contract.ts';
import type { StrategyBuilderV2State, V2Persisted } from './strategy-builder-v2-persistence.ts';

export type CanonicalReviewOperation = 'CREATE' | 'UPDATE';
export type CanonicalActivationIntent = 'ACTIVATE' | 'SAVE_INACTIVE';

export type CanonicalReviewCondition = {
  key: string;
  label: string;
  requirement: 'REQUIRED' | 'OPTIONAL';
  relationship: RuleGroupType;
  capability: Capability;
  timeframe: string;
};

export type CanonicalStrategyReview = {
  fingerprint: string;
  operation: CanonicalReviewOperation;
  activationIntent: CanonicalActivationIntent;
  name: string;
  instruments: string[];
  direction: 'LONG' | 'SHORT' | 'BOTH';
  sessions: string[];
  contextTimeframe?: string;
  executionTimeframe?: string;
  conditions: CanonicalReviewCondition[];
  riskPercent: number;
  minimumRR: number;
  stopLogic?: string;
  targetLogic?: string;
};

export type CanonicalReviewConfirmation = {
  review: CanonicalStrategyReview;
  confirmedDraft: CanonicalCreationDraft;
  persisted: V2Persisted;
};

const REVIEW_FIELDS: readonly CanonicalCreationField[] = [
  'name', 'instruments', 'sessions', 'contextTimeframe', 'executionTimeframe',
  'methodologyIds', 'ruleSelections', 'ruleTree', 'riskPercent', 'minimumRR',
  'stopLogic', 'targetLogic', 'direction',
];

function stableReviewPayload(baseProfile: StrategyProfile, draft: CanonicalCreationDraft): string {
  const values = draft.values;
  return JSON.stringify({
    intent: draft.intent,
    strategyId: draft.strategyId ?? null,
    activationIntent: baseProfile.isDefault ? 'ACTIVATE' : 'SAVE_INACTIVE',
    values: {
      name: values.name,
      instruments: values.instruments,
      direction: values.direction ?? 'BOTH',
      sessions: values.sessions,
      contextTimeframe: values.contextTimeframe ?? null,
      executionTimeframe: values.executionTimeframe ?? null,
      methodologyIds: values.methodologyIds,
      ruleSelections: values.ruleSelections,
      ruleTree: values.ruleTree ?? null,
      riskPercent: values.riskPercent,
      minimumRR: values.minimumRR,
      stopLogic: values.stopLogic ?? null,
      targetLogic: values.targetLogic ?? null,
    },
  });
}

function humanLogic(value: StrategyBuilderV2State['stopLogic'] | StrategyBuilderV2State['targetLogic']): string | undefined {
  if (typeof value === 'string') return value || undefined;
  return value?.kind;
}

export function canonicalDraftForVisibleV2Review({
  intent,
  strategyId,
  values,
  provenance = 'EXPLICIT',
}: {
  intent: 'CREATE' | 'EDIT';
  strategyId?: string;
  values: StrategyBuilderV2State;
  provenance?: ValueProvenance;
}): CanonicalCreationDraft {
  const attributed = Object.fromEntries(REVIEW_FIELDS
    .filter((field) => {
      const value = values[field as keyof StrategyBuilderV2State];
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '' && value !== 0;
    })
    .map((field) => [field, provenance])) as Partial<Record<CanonicalCreationField, ValueProvenance>>;
  return createCanonicalCreationDraft({ intent, strategyId, values, provenance: attributed });
}

export function buildCanonicalStrategyReview(
  baseProfile: StrategyProfile,
  draft: CanonicalCreationDraft,
): CanonicalStrategyReview {
  const assessment = assessCanonicalCreationDraft(draft);
  if (!assessment.canReview) {
    throw new Error(assessment.clarifications[0]?.question ?? 'Resolve required strategy details before review.');
  }
  return {
    fingerprint: stableReviewPayload(baseProfile, draft),
    operation: draft.intent === 'EDIT' ? 'UPDATE' : 'CREATE',
    activationIntent: baseProfile.isDefault ? 'ACTIVATE' : 'SAVE_INACTIVE',
    name: draft.values.name,
    instruments: [...draft.values.instruments],
    direction: draft.values.direction ?? 'BOTH',
    sessions: [...draft.values.sessions],
    contextTimeframe: draft.values.contextTimeframe,
    executionTimeframe: draft.values.executionTimeframe,
    conditions: draft.values.ruleSelections.map((rule) => ({
      key: rule.key,
      label: rule.label,
      requirement: rule.requirement,
      relationship: rule.group,
      capability: rule.capability,
      timeframe: rule.timeframe,
    })),
    riskPercent: draft.values.riskPercent,
    minimumRR: draft.values.minimumRR,
    stopLogic: humanLogic(draft.values.stopLogic),
    targetLogic: humanLogic(draft.values.targetLogic),
  };
}

export function confirmCanonicalStrategyReview(
  baseProfile: StrategyProfile,
  draft: CanonicalCreationDraft,
): CanonicalReviewConfirmation {
  const review = buildCanonicalStrategyReview(baseProfile, draft);
  const confirmedDraft = confirmCanonicalCreationDraft(draft);
  const persisted = adaptCanonicalCreationDraftToV2Persistence(baseProfile, confirmedDraft).persisted;
  return { review, confirmedDraft, persisted };
}

export function persistedStrategyFromCurrentReview(
  baseProfile: StrategyProfile,
  currentDraft: CanonicalCreationDraft,
  confirmation: CanonicalReviewConfirmation | null,
): V2Persisted {
  if (!confirmation) throw new Error('Explicit strategy review confirmation is required before saving.');
  const currentReview = buildCanonicalStrategyReview(baseProfile, currentDraft);
  if (currentReview.fingerprint !== confirmation.review.fingerprint) {
    throw new Error('Strategy changed after review. Review and confirm the current strategy before saving.');
  }
  return adaptCanonicalCreationDraftToV2Persistence(baseProfile, confirmation.confirmedDraft).persisted;
}
