import { normalizeActiveStrategyEvidenceKey } from './active-strategy-evidence.ts';
import {
  METHODOLOGY_LIBRARY,
  normalizePersistedV2RuleTree,
  type RuleSelection,
} from './strategy-builder-v2.ts';
import {
  V2_SUPPORTED_SESSION_CODES,
  persistedStrategyToV2State,
  v2StateToPersistedStrategy,
  type StrategyBuilderV2State,
  type V2Persisted,
} from './strategy-builder-v2-persistence.ts';
import { validateStrategyName } from './strategy-name.ts';
import { deriveRequiredEvidence } from './strategy-policy.ts';
import { normalizePersistableStrategyRules } from './strategy-rule-persistence.ts';
import type { EvidenceKey, StrategyProfile, StrategyRule, StrategySession } from '../types/trade.ts';

export const CANONICAL_CREATION_STATES = [
  'CAPTURING',
  'NEEDS_CLARIFICATION',
  'READY_FOR_REVIEW',
  'CONFIRMED',
] as const;

export type CanonicalCreationState = (typeof CANONICAL_CREATION_STATES)[number];

export const VALUE_PROVENANCE = [
  'EXPLICIT',
  'INFERRED',
  'DEFAULT_CONFIRMED',
  'LEGACY',
] as const;

export type ValueProvenance = (typeof VALUE_PROVENANCE)[number];
export type CanonicalCreationIntent = 'CREATE' | 'EDIT';

export type CanonicalUnresolvedInput = {
  kind: 'QUESTION' | 'UNSUPPORTED_CONCEPT';
  text: string;
  source: 'COPILOT';
};

export const CANONICAL_CREATION_FIELDS = [
  'name',
  'instruments',
  'sessions',
  'contextTimeframe',
  'executionTimeframe',
  'methodologyIds',
  'ruleSelections',
  'ruleTree',
  'riskPercent',
  'minimumRR',
  'stopLogic',
  'targetLogic',
  'direction',
] as const;

export type CanonicalCreationField = (typeof CANONICAL_CREATION_FIELDS)[number];

export const REQUIRED_CREATION_FIELDS = [
  'name',
  'instruments',
  'sessions',
  'contextTimeframe',
  'executionTimeframe',
  'ruleSelections',
  'riskPercent',
  'minimumRR',
] as const satisfies readonly CanonicalCreationField[];

export const CONFIRMATION_SENSITIVE_FIELDS = [
  'instruments',
  'sessions',
  'contextTimeframe',
  'executionTimeframe',
  'ruleSelections',
  'ruleTree',
  'riskPercent',
  'minimumRR',
  'stopLogic',
  'targetLogic',
  'direction',
] as const satisfies readonly CanonicalCreationField[];

export type CanonicalCreationIssueCode =
  | 'MISSING_STRATEGY_ID'
  | 'INVALID_VALUE'
  | 'UNATTRIBUTED_VALUE'
  | 'UNKNOWN_RULE'
  | 'INVALID_RULE_TREE'
  | 'UNSUPPORTED_SESSION'
  | 'UNRESOLVED_INPUT'
  | 'RULE_NORMALIZATION_FAILED'
  | 'NO_REQUIRED_EVIDENCE';

export type CanonicalCreationIssue = {
  code: CanonicalCreationIssueCode;
  field?: CanonicalCreationField;
  message: string;
};

export type ClarificationCode =
  | 'MISSING_NAME'
  | 'MISSING_INSTRUMENTS'
  | 'MISSING_SESSIONS'
  | 'MISSING_CONTEXT_TIMEFRAME'
  | 'MISSING_EXECUTION_TIMEFRAME'
  | 'MISSING_RULES'
  | 'MISSING_RISK_PERCENT'
  | 'MISSING_MINIMUM_RR'
  | 'MISSING_REQUIRED_EVIDENCE'
  | 'CONFIRM_VALUE_SOURCE'
  | 'RESOLVE_UNKNOWN_RULE'
  | 'COPILOT_UNRESOLVED_INPUT'
  | 'REVIEW_INVALID_VALUE';

export type CanonicalClarification = {
  code: ClarificationCode;
  field?: CanonicalCreationField;
  question: string;
};

export type CanonicalCreationDraft = {
  intent: CanonicalCreationIntent;
  strategyId?: string;
  values: StrategyBuilderV2State;
  provenance: Partial<Record<CanonicalCreationField, ValueProvenance>>;
  confirmedSensitiveFields: CanonicalCreationField[];
  reviewConfirmed: boolean;
  state: CanonicalCreationState;
  /** Non-executable Copilot questions/concepts retained for canonical clarification. */
  unresolvedInputs: CanonicalUnresolvedInput[];
  /** Exact legacy rows are retained because custom session codes are not V2 presets. */
  legacySessionRows?: StrategySession[];
  /** Exact legacy rule rows are retained until ruleSelections are explicitly edited. */
  legacyRuleRows?: StrategyRule[];
};

export type CanonicalCreationAssessment = {
  state: CanonicalCreationState;
  missingFields: CanonicalCreationField[];
  issues: CanonicalCreationIssue[];
  clarifications: CanonicalClarification[];
  confirmationSensitiveFields: CanonicalCreationField[];
  canReview: boolean;
  canPersist: boolean;
};

export type CanonicalCreationPersistence = {
  persisted: V2Persisted;
  requiredEvidence: EvidenceKey[];
};

const knownRuleKeys = new Set(METHODOLOGY_LIBRARY.flatMap((library) => library.rules.map((rule) => rule.key)));
const supportedSessionCodes = new Set<string>(V2_SUPPORTED_SESSION_CODES);

const missingQuestions: Record<(typeof REQUIRED_CREATION_FIELDS)[number], CanonicalClarification> = {
  name: { code: 'MISSING_NAME', field: 'name', question: 'What would you like to call this strategy?' },
  instruments: { code: 'MISSING_INSTRUMENTS', field: 'instruments', question: 'Which instrument or instruments do you trade with this strategy?' },
  sessions: { code: 'MISSING_SESSIONS', field: 'sessions', question: 'During which trading session or sessions may this strategy open trades?' },
  contextTimeframe: { code: 'MISSING_CONTEXT_TIMEFRAME', field: 'contextTimeframe', question: 'Which timeframe defines the broader market context?' },
  executionTimeframe: { code: 'MISSING_EXECUTION_TIMEFRAME', field: 'executionTimeframe', question: 'Which timeframe is used to confirm or execute the entry?' },
  ruleSelections: { code: 'MISSING_RULES', field: 'ruleSelections', question: 'What must be true before this strategy permits a trade?' },
  riskPercent: { code: 'MISSING_RISK_PERCENT', field: 'riskPercent', question: 'What is the maximum percentage risk allowed per trade?' },
  minimumRR: { code: 'MISSING_MINIMUM_RR', field: 'minimumRR', question: 'What is the minimum risk-to-reward ratio this strategy accepts?' },
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function blankValues(): StrategyBuilderV2State {
  return {
    name: '',
    instruments: [],
    sessions: [],
    methodologyIds: [],
    ruleSelections: [],
    riskPercent: 0,
    minimumRR: 0,
  };
}

function fieldValue(values: StrategyBuilderV2State, field: CanonicalCreationField): unknown {
  return values[field as keyof StrategyBuilderV2State];
}

function hasValue(values: StrategyBuilderV2State, field: CanonicalCreationField): boolean {
  const value = fieldValue(values, field);
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

function hasMeaningfulInput(values: StrategyBuilderV2State): boolean {
  return CANONICAL_CREATION_FIELDS.some((field) => hasValue(values, field));
}

function populatedFields(values: StrategyBuilderV2State): CanonicalCreationField[] {
  return CANONICAL_CREATION_FIELDS.filter((field) => hasValue(values, field));
}

function dedupeClarifications(items: CanonicalClarification[]): CanonicalClarification[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = `${item.code}:${item.field ?? ''}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function toRuleForPolicy(rule: RuleSelection): StrategyRule {
  const automatic = rule.capability === 'AUTOMATIC';
  return {
    ruleKey: rule.key,
    label: rule.label,
    enabled: true,
    mandatory: rule.requirement === 'REQUIRED' && rule.capability !== 'DESCRIPTIVE',
    weight: automatic ? 10 : rule.capability === 'MANUAL' ? 8 : rule.capability === 'EXTERNAL' ? 6 : 4,
    minimumConfidence: automatic ? 72 : 60,
    timeframeRole: rule.timeframe.includes('H') ? 'MACRO' : 'TRIGGER',
    evaluationMode: automatic ? 'AUTOMATIC' : rule.capability === 'EXTERNAL' ? 'EXTERNAL' : 'MANUAL',
  };
}

function assessIssues(draft: CanonicalCreationDraft, missingFields: CanonicalCreationField[]): CanonicalCreationIssue[] {
  const issues: CanonicalCreationIssue[] = [];
  const { values, provenance } = draft;

  if (draft.intent === 'EDIT' && !draft.strategyId) {
    issues.push({ code: 'MISSING_STRATEGY_ID', message: 'Editing requires the exact persisted Strategy identity.' });
  }

  for (const unresolved of draft.unresolvedInputs) {
    issues.push({
      code: 'UNRESOLVED_INPUT',
      message: unresolved.kind === 'UNSUPPORTED_CONCEPT'
        ? `Unsupported concept remains descriptive and unresolved: ${unresolved.text}`
        : unresolved.text,
    });
  }

  for (const field of populatedFields(values)) {
    if (!provenance[field]) {
      issues.push({ code: 'UNATTRIBUTED_VALUE', field, message: `${field} has a value without canonical provenance.` });
    }
  }

  if (values.riskPercent < 0 || !Number.isFinite(values.riskPercent)) {
    issues.push({ code: 'INVALID_VALUE', field: 'riskPercent', message: 'Risk percentage must be a finite positive number.' });
  }
  if (values.minimumRR < 0 || !Number.isFinite(values.minimumRR)) {
    issues.push({ code: 'INVALID_VALUE', field: 'minimumRR', message: 'Minimum RR must be a finite positive number.' });
  }
  if (!missingFields.includes('name')) {
    const nameError = validateStrategyName(values.name);
    if (nameError) issues.push({ code: 'INVALID_VALUE', field: 'name', message: nameError });
  }

  const acceptsLegacyRules = draft.intent === 'EDIT' && provenance.ruleSelections === 'LEGACY';
  if (!acceptsLegacyRules) {
    for (const rule of values.ruleSelections) {
      if (!knownRuleKeys.has(rule.key)) {
        issues.push({ code: 'UNKNOWN_RULE', field: 'ruleSelections', message: `Unknown rule "${rule.key}" cannot enter a new canonical strategy draft.` });
      }
    }
  }

  const acceptsLegacySessions = draft.intent === 'EDIT' && provenance.sessions === 'LEGACY' && Boolean(draft.legacySessionRows?.length);
  if (!acceptsLegacySessions) {
    for (const session of values.sessions) {
      if (!supportedSessionCodes.has(session)) {
        issues.push({ code: 'UNSUPPORTED_SESSION', field: 'sessions', message: `Unsupported session "${session}" cannot be silently mapped to a preset.` });
      }
    }
  }

  if (values.ruleTree) {
    try {
      normalizePersistedV2RuleTree(values.ruleTree);
    } catch (error) {
      issues.push({ code: 'INVALID_RULE_TREE', field: 'ruleTree', message: error instanceof Error ? error.message : 'Rule tree is invalid.' });
    }
  }

  if (values.ruleSelections.length) {
    const normalized = normalizePersistableStrategyRules(values.ruleSelections.map(toRuleForPolicy));
    if (!normalized.persistable) {
      issues.push({ code: 'RULE_NORMALIZATION_FAILED', field: 'ruleSelections', message: normalized.issues[0] ?? 'Rules cannot be normalized for persistence.' });
    } else if (!deriveRequiredEvidence(normalized.rules, {}).length) {
      issues.push({ code: 'NO_REQUIRED_EVIDENCE', field: 'ruleSelections', message: 'At least one enabled, supported, mandatory rule is required.' });
    }
  }

  return issues;
}

function clarificationForIssue(issue: CanonicalCreationIssue): CanonicalClarification | null {
  if (issue.code === 'UNATTRIBUTED_VALUE') {
    return { code: 'CONFIRM_VALUE_SOURCE', field: issue.field, question: `Was ${issue.field} provided by the trader, inferred, explicitly accepted as a default, or loaded from a legacy strategy?` };
  }
  if (issue.code === 'UNKNOWN_RULE') {
    return { code: 'RESOLVE_UNKNOWN_RULE', field: 'ruleSelections', question: 'This rule is not supported by the canonical catalog. Should it remain a non-authoritative description or be replaced with a supported rule?' };
  }
  if (issue.code === 'NO_REQUIRED_EVIDENCE') {
    return { code: 'MISSING_REQUIRED_EVIDENCE', field: 'ruleSelections', question: 'Which supported rule must be satisfied before this strategy permits a trade?' };
  }
  if (issue.code === 'UNRESOLVED_INPUT') {
    return { code: 'COPILOT_UNRESOLVED_INPUT', question: issue.message };
  }
  if (issue.code === 'INVALID_VALUE' || issue.code === 'INVALID_RULE_TREE' || issue.code === 'UNSUPPORTED_SESSION' || issue.code === 'RULE_NORMALIZATION_FAILED') {
    return { code: 'REVIEW_INVALID_VALUE', field: issue.field, question: issue.message };
  }
  return null;
}

function deriveState(
  draft: CanonicalCreationDraft,
  missingFields: CanonicalCreationField[],
  issues: CanonicalCreationIssue[],
  confirmationFields: CanonicalCreationField[],
): CanonicalCreationState {
  if (!hasMeaningfulInput(draft.values)) return 'CAPTURING';
  if (missingFields.length || issues.length) return 'NEEDS_CLARIFICATION';
  const confirmed = new Set(draft.confirmedSensitiveFields);
  if (draft.reviewConfirmed && confirmationFields.every((field) => confirmed.has(field))) return 'CONFIRMED';
  return 'READY_FOR_REVIEW';
}

export function assessCanonicalCreationDraft(draft: CanonicalCreationDraft): CanonicalCreationAssessment {
  const missingFields = REQUIRED_CREATION_FIELDS.filter((field) => !hasValue(draft.values, field));
  const issues = assessIssues(draft, missingFields);
  const confirmationSensitiveFields = CONFIRMATION_SENSITIVE_FIELDS.filter((field) => hasValue(draft.values, field));
  const state = deriveState(draft, missingFields, issues, confirmationSensitiveFields);
  const clarifications = dedupeClarifications([
    ...missingFields.map((field) => missingQuestions[field as (typeof REQUIRED_CREATION_FIELDS)[number]]),
    ...issues.map(clarificationForIssue).filter((item): item is CanonicalClarification => Boolean(item)),
  ]);

  return {
    state,
    missingFields: [...missingFields],
    issues,
    clarifications,
    confirmationSensitiveFields,
    canReview: state === 'READY_FOR_REVIEW' || state === 'CONFIRMED',
    canPersist: state === 'CONFIRMED',
  };
}

function withDerivedState(draft: Omit<CanonicalCreationDraft, 'state'> & { state?: CanonicalCreationState }): CanonicalCreationDraft {
  const provisional: CanonicalCreationDraft = { ...draft, state: draft.state ?? 'CAPTURING' };
  return { ...provisional, state: assessCanonicalCreationDraft(provisional).state };
}

export function createCanonicalCreationDraft({
  intent,
  strategyId,
  values,
  provenance = {},
}: {
  intent: CanonicalCreationIntent;
  strategyId?: string;
  values?: Partial<StrategyBuilderV2State>;
  provenance?: Partial<Record<CanonicalCreationField, ValueProvenance>>;
}): CanonicalCreationDraft {
  const blank = blankValues();
  const nextValues = { ...blank, ...clone(values ?? {}) } as StrategyBuilderV2State;
  nextValues.instruments = [...(values?.instruments ?? blank.instruments)];
  nextValues.sessions = [...(values?.sessions ?? blank.sessions)];
  nextValues.methodologyIds = [...(values?.methodologyIds ?? blank.methodologyIds)];
  nextValues.ruleSelections = clone(values?.ruleSelections ?? blank.ruleSelections);

  return withDerivedState({
    intent,
    ...(strategyId ? { strategyId } : {}),
    values: nextValues,
    provenance: { ...provenance },
    confirmedSensitiveFields: [],
    reviewConfirmed: false,
    unresolvedInputs: [],
  });
}

export function setCanonicalCreationUnresolvedInputs(
  draft: CanonicalCreationDraft,
  unresolvedInputs: readonly CanonicalUnresolvedInput[],
): CanonicalCreationDraft {
  return withDerivedState({
    ...draft,
    unresolvedInputs: clone([...unresolvedInputs]),
    reviewConfirmed: unresolvedInputs.length ? false : draft.reviewConfirmed,
  });
}

export function updateCanonicalCreationDraft(
  draft: CanonicalCreationDraft,
  patch: Partial<StrategyBuilderV2State>,
  provenancePatch: Partial<Record<CanonicalCreationField, ValueProvenance>> = {},
): CanonicalCreationDraft {
  const changedFields = CANONICAL_CREATION_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(patch, field));
  const nextProvenance = { ...draft.provenance, ...provenancePatch };
  for (const field of changedFields) {
    if (!Object.prototype.hasOwnProperty.call(provenancePatch, field)) delete nextProvenance[field];
  }
  const changed = new Set(changedFields);

  return withDerivedState({
    ...draft,
    values: { ...clone(draft.values), ...clone(patch) },
    provenance: nextProvenance,
    confirmedSensitiveFields: draft.confirmedSensitiveFields.filter((field) => !changed.has(field)),
    reviewConfirmed: false,
  });
}

export function confirmCanonicalCreationDraft(
  draft: CanonicalCreationDraft,
  fields?: readonly CanonicalCreationField[],
): CanonicalCreationDraft {
  const assessment = assessCanonicalCreationDraft(draft);
  if (!assessment.canReview) {
    throw new Error('Strategy creation draft must resolve all clarification issues before it can be confirmed.');
  }
  const confirmed = new Set(draft.confirmedSensitiveFields);
  for (const field of fields ?? assessment.confirmationSensitiveFields) {
    if (assessment.confirmationSensitiveFields.includes(field)) confirmed.add(field);
  }
  return withDerivedState({
    ...draft,
    confirmedSensitiveFields: [...confirmed],
    reviewConfirmed: true,
  });
}

export function canonicalCreationDraftFromPersistedStrategy(
  profile: StrategyProfile,
  rules: StrategyRule[],
  sessions: StrategySession[],
): CanonicalCreationDraft {
  if (!profile.id) throw new Error('A persisted Strategy identity is required for canonical edit hydration.');
  const values = persistedStrategyToV2State(profile, rules, sessions);
  const provenance = Object.fromEntries(populatedFields(values).map((field) => [field, 'LEGACY'])) as Partial<Record<CanonicalCreationField, ValueProvenance>>;
  return withDerivedState({
    intent: 'EDIT',
    strategyId: profile.id,
    values,
    provenance,
    confirmedSensitiveFields: [],
    reviewConfirmed: false,
    unresolvedInputs: [],
    legacySessionRows: clone(sessions),
    legacyRuleRows: clone(rules),
  });
}

function validateIdentity(baseProfile: StrategyProfile, draft: CanonicalCreationDraft): void {
  if (draft.intent === 'CREATE' && baseProfile.id) {
    throw new Error('Strategy identity mismatch: CREATE cannot reuse a persisted Strategy id.');
  }
  if (draft.intent === 'EDIT' && (!draft.strategyId || baseProfile.id !== draft.strategyId)) {
    throw new Error('Strategy identity mismatch: EDIT must preserve the exact selected Strategy id.');
  }
}

export function adaptCanonicalCreationDraftToV2Persistence(
  baseProfile: StrategyProfile,
  draft: CanonicalCreationDraft,
): CanonicalCreationPersistence {
  const assessment = assessCanonicalCreationDraft(draft);
  if (!assessment.canPersist) throw new Error('Strategy creation draft must be confirmed before persistence adaptation.');
  validateIdentity(baseProfile, draft);

  const legacySessionCodes = new Set(draft.legacySessionRows?.map((session) => session.sessionCode) ?? []);
  const preservesLegacySessions = draft.provenance.sessions === 'LEGACY'
    && draft.values.sessions.every((session) => legacySessionCodes.has(session));
  const stateForAdapter = preservesLegacySessions
    ? { ...clone(draft.values), sessions: draft.values.sessions.filter((session) => supportedSessionCodes.has(session)) }
    : clone(draft.values);

  const persisted = v2StateToPersistedStrategy(clone(baseProfile), stateForAdapter);
  if (preservesLegacySessions) {
    persisted.profile.allowedSessions = [...draft.values.sessions];
    persisted.sessions = clone(draft.legacySessionRows ?? []);
  }
  if (draft.provenance.ruleSelections === 'LEGACY' && draft.legacyRuleRows) {
    persisted.rules = clone(draft.legacyRuleRows);
  }

  const normalized = normalizePersistableStrategyRules(persisted.rules);
  if (!normalized.persistable) {
    throw new Error(normalized.issues[0] ?? 'Canonical strategy rules cannot be persisted.');
  }
  persisted.rules = normalized.rules;
  const requiredEvidence = deriveRequiredEvidence(persisted.rules, persisted.profile.evidenceWeights ?? {});
  if (!requiredEvidence.length) {
    throw new Error('Canonical strategy policy requires at least one enabled, supported, mandatory rule.');
  }

  return { persisted, requiredEvidence };
}

/** Returns the canonical evidence key only when the configured rule is supported by current policy. */
export function canonicalCreationEvidenceKey(rule: RuleSelection): EvidenceKey | null {
  if (rule.capability === 'DESCRIPTIVE' || rule.requirement !== 'REQUIRED') return null;
  return normalizeActiveStrategyEvidenceKey(rule.key);
}
