import {
  createPersistedV2RuleTree,
  parseCopilotPrompt,
} from './strategy-builder-v2.ts';
import {
  assessCanonicalCreationDraft,
  createCanonicalCreationDraft,
  setCanonicalCreationUnresolvedInputs,
  updateCanonicalCreationDraft,
  type CanonicalCreationAssessment,
  type CanonicalCreationDraft,
  type CanonicalCreationField,
  type CanonicalCreationIntent,
  type CanonicalUnresolvedInput,
  type ValueProvenance,
} from './strategy-creation-contract.ts';
import type { StrategyBuilderV2State } from './strategy-builder-v2-persistence.ts';
import type { StrategyCopilotDraft, StrategyCopilotReply } from './strategy-copilot.ts';

export type CopilotCanonicalCreationResult = {
  draft: CanonicalCreationDraft;
  assessment: CanonicalCreationAssessment;
};

const SESSION_CODES: Record<string, string> = {
  London: 'LONDON',
  'New York': 'NEW_YORK',
  Sydney: 'SYDNEY',
  Tokyo: 'TOKYO',
  LONDON: 'LONDON',
  NEW_YORK: 'NEW_YORK',
  SYDNEY: 'SYDNEY',
  TOKYO: 'TOKYO',
};

const INSTRUMENT_ALIASES: Record<string, RegExp> = {
  XAUUSD: /\b(?:xauusd|gold)\b/i,
  XAGUSD: /\b(?:xagusd|silver)\b/i,
  EURUSD: /\b(?:eurusd|euro\s*(?:\/|-)?\s*usd)\b/i,
  GBPUSD: /\b(?:gbpusd|pound\s*(?:\/|-)?\s*usd)\b/i,
  USDJPY: /\b(?:usdjpy|dollar\s*(?:\/|-)?\s*jpy)\b/i,
  AUDUSD: /\baudusd\b/i,
  USDCAD: /\busdcad\b/i,
  NZDUSD: /\bnzdusd\b/i,
  USDCHF: /\busdchf\b/i,
  NAS100: /\b(?:nas100|nasdaq\s*100)\b/i,
};

const RULE_ALIASES: Record<string, RegExp> = {
  'liquidity-sweep': /\b(?:liquidity sweep|liquidity)\b/i,
  choch: /\bchoch\b/i,
  bos: /\b(?:bos|break of structure)\b/i,
  retest: /\bretest\b/i,
  'order-block': /\b(?:order block|ob)\b/i,
  'fair-value-gap': /\b(?:fair value gap|fvg)\b/i,
  'support-zone': /\bsupport(?: zone)?\b/i,
  'resistance-zone': /\bresistance(?: zone)?\b/i,
  'breakout-confirmation': /\bbreakout\b/i,
  'trend-alignment': /\btrend\b/i,
  'session-open': /\bsession(?: open)?\b/i,
};

const TIMEFRAME_RANK: Record<string, number> = {
  M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440, W1: 10080,
};

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function roleTimeframe(message: string, role: 'context' | 'execution'): string | undefined {
  const rolePattern = role === 'context'
    ? '(?:context|macro|higher(?:[- ]timeframe)?|htf)'
    : '(?:execution|entry|trigger)';
  const timeframe = '\\b(M1|M5|M15|M30|H1|H4|D1|W1)\\b';
  const beforeRole = message.match(new RegExp(`${timeframe}\\s+(?:as|for)\\s+(?:the\\s+)?${rolePattern}`, 'i'));
  if (beforeRole?.[1]) return beforeRole[1].toUpperCase();
  const afterRole = message.match(new RegExp(`${rolePattern}(?:\\s+timeframe)?\\s*(?:is|=|:|on|at|uses?|use)?\\s*${timeframe}`, 'i'));
  return afterRole?.[1]?.toUpperCase();
}

function resolveTimeframeRoles(message: string, draft: StrategyCopilotDraft, previous?: CanonicalCreationDraft) {
  const explicitContext = roleTimeframe(message, 'context');
  const explicitExecution = roleTimeframe(message, 'execution');
  const values = [...new Set(draft.timeframes.filter((value) => TIMEFRAME_RANK[value]))];
  const ordered = values.slice().sort((left, right) => TIMEFRAME_RANK[left] - TIMEFRAME_RANK[right]);
  const inferredExecution = ordered[0];
  const inferredContext = ordered.length > 1 ? ordered.at(-1) : undefined;
  return {
    contextTimeframe: explicitContext ?? inferredContext ?? previous?.values.contextTimeframe,
    executionTimeframe: explicitExecution ?? inferredExecution ?? previous?.values.executionTimeframe,
    contextExplicit: Boolean(explicitContext),
    executionExplicit: Boolean(explicitExecution),
  };
}

function nameWasExplicit(message: string, name: string): boolean {
  const value = escaped(name.trim());
  return Boolean(value) && new RegExp(`(?:call|name)(?:\\s+the strategy)?\\s+(?:it\\s+)?["']?${value}["']?`, 'i').test(message);
}

function sessionsWereExplicit(message: string, sessions: string[]): boolean {
  return sessions.length > 0 && sessions.every((session) => {
    const display = session === 'NEW_YORK' ? 'new york' : session.toLowerCase();
    return message.toLowerCase().includes(display);
  });
}

function rulesWereExplicit(message: string, draft: StrategyCopilotDraft, previous?: CanonicalCreationDraft): boolean {
  const previousRules = new Map(previous?.values.ruleSelections.map((rule) => [rule.key, rule]) ?? []);
  return draft.rules.length > 0 && draft.rules.every((rule) => {
    const prior = previousRules.get(rule.key);
    if (prior && same(prior, rule) && previous?.provenance.ruleSelections === 'EXPLICIT') return true;
    return (RULE_ALIASES[rule.key] ?? new RegExp(`\\b${escaped(rule.label)}\\b`, 'i')).test(message);
  });
}

function fieldProvenance(
  field: CanonicalCreationField,
  message: string,
  draft: StrategyCopilotDraft,
  timeframes: ReturnType<typeof resolveTimeframeRoles>,
  previous?: CanonicalCreationDraft,
): ValueProvenance {
  if (field === 'name') return draft.name && nameWasExplicit(message, draft.name) ? 'EXPLICIT' : 'INFERRED';
  if (field === 'instruments') return draft.instrument && INSTRUMENT_ALIASES[draft.instrument]?.test(message) ? 'EXPLICIT' : 'INFERRED';
  if (field === 'sessions') return sessionsWereExplicit(message, draft.sessions.map((value) => SESSION_CODES[value] ?? value)) ? 'EXPLICIT' : 'INFERRED';
  if (field === 'contextTimeframe') return timeframes.contextExplicit ? 'EXPLICIT' : 'INFERRED';
  if (field === 'executionTimeframe') return timeframes.executionExplicit ? 'EXPLICIT' : 'INFERRED';
  if (field === 'ruleSelections' || field === 'ruleTree') return rulesWereExplicit(message, draft, previous) ? 'EXPLICIT' : 'INFERRED';
  if (field === 'riskPercent') return /(?:risk[^.\n%]{0,30}[0-9]+(?:\.[0-9]+)?\s*%|[0-9]+(?:\.[0-9]+)?\s*%[^.\n]{0,20}risk)/i.test(message) ? 'EXPLICIT' : 'INFERRED';
  if (field === 'minimumRR') return /(?:minimum\s+)?(?:rr|risk[- ]to[- ]reward|risk reward)[^.\n]{0,24}(?:1\s*:\s*)?[0-9]+(?:\.[0-9]+)?/i.test(message) ? 'EXPLICIT' : 'INFERRED';
  if (field === 'direction') return /\b(?:long|short|buy|sell|both directions?)\b/i.test(message) ? 'EXPLICIT' : 'INFERRED';
  return 'INFERRED';
}

function canonicalValues(reply: StrategyCopilotReply, message: string, previous?: CanonicalCreationDraft): Partial<StrategyBuilderV2State> {
  const draft = reply.strategyDraft;
  const timeframes = resolveTimeframeRoles(message, draft, previous);
  const rules = draft.rules.length ? structuredClone(draft.rules) : previous?.values.ruleSelections ?? [];
  const usableName = draft.name && draft.name !== 'Draft from description' ? draft.name : previous?.values.name;

  return {
    ...(usableName ? { name: usableName } : {}),
    ...(draft.instrument ? { instruments: [draft.instrument] } : previous ? { instruments: previous.values.instruments } : {}),
    ...(draft.sessions.length ? { sessions: draft.sessions.map((value) => SESSION_CODES[value] ?? value) } : previous ? { sessions: previous.values.sessions } : {}),
    ...(timeframes.contextTimeframe ? { contextTimeframe: timeframes.contextTimeframe } : {}),
    ...(timeframes.executionTimeframe ? { executionTimeframe: timeframes.executionTimeframe } : {}),
    methodologyIds: previous?.values.methodologyIds ?? [],
    ...(rules.length ? { ruleSelections: rules, ruleTree: createPersistedV2RuleTree(rules) } : {}),
    ...(typeof draft.riskPercent === 'number' ? { riskPercent: draft.riskPercent } : previous ? { riskPercent: previous.values.riskPercent } : {}),
    ...(typeof draft.minimumRR === 'number' ? { minimumRR: draft.minimumRR } : previous ? { minimumRR: previous.values.minimumRR } : {}),
    ...(draft.direction ? { direction: draft.direction } : previous?.values.direction ? { direction: previous.values.direction } : {}),
  };
}

const CLARIFICATION_TIMEFRAME = /\b(?:M1|M5|M15|M30|H1|H4|D1|W1)\b/gi;
const REQUIRED_CHOICE = /\b(?:required|mandatory|must|structural(?:\s+filter)?|requerid[oa]|obligatori[oa])\b/i;
const INFORMATIONAL_CHOICE = /\b(?:informational(?:\s+only)?|context(?:\s+only)?|reference(?:\s+only)?|not\s+(?:required|mandatory)|no\s+(?:es\s+)?(?:requerid[oa]|obligatori[oa])|solo\s+(?:informativ[oa]|contexto|referencia))\b/i;

function timeframesIn(value: string): string[] {
  return [...new Set((value.match(CLARIFICATION_TIMEFRAME) ?? []).map((item) => item.toUpperCase()))];
}

/**
 * A repeated model question must not keep a canonical draft blocked after the
 * trader has explicitly selected one of the alternatives it presented.
 * This intentionally recognizes only the narrow required-vs-informational
 * clarification used for timeframe filters; unrelated questions fail closed.
 */
export function isCopilotClarificationAnswered(userMessage: string, question: string): boolean {
  const questionTimeframes = timeframesIn(question);
  const answerTimeframes = timeframesIn(userMessage);
  if (questionTimeframes.length === 0 || !questionTimeframes.some((item) => answerTimeframes.includes(item))) return false;

  const questionOffersRequiredChoice = REQUIRED_CHOICE.test(question) && INFORMATIONAL_CHOICE.test(question);
  if (!questionOffersRequiredChoice) return false;

  return REQUIRED_CHOICE.test(userMessage) || INFORMATIONAL_CHOICE.test(userMessage);
}

function unresolvedInputs(message: string, reply: StrategyCopilotReply): CanonicalUnresolvedInput[] {
  const parsed = parseCopilotPrompt(message);
  const canonicalFieldQuestion = /\b(?:name|call|instrument|symbol|market|session|context|macro|timeframe|entry|execution|rule|condition|confirmation|filter|informational|risk|reward|rr)\b/i;
  const values: CanonicalUnresolvedInput[] = [
    ...parsed.unknownConcepts.map((text) => ({ kind: 'UNSUPPORTED_CONCEPT' as const, text, source: 'COPILOT' as const })),
    ...reply.unresolvedQuestions.flatMap((text) => {
      if (isCopilotClarificationAnswered(message, text)) return [];
      const unsupported = /unsupported|not (?:in|part of) the (?:supported|rule) catalog/i.test(text);
      if (!unsupported && canonicalFieldQuestion.test(text)) return [];
      return [{ kind: unsupported ? 'UNSUPPORTED_CONCEPT' as const : 'QUESTION' as const, text, source: 'COPILOT' as const }];
    }),
  ];
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.kind}:${item.text.trim().toLowerCase()}`;
    if (!item.text.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mapCopilotReplyToCanonicalCreation({
  userMessage,
  reply,
  previousDraft,
  intent = previousDraft?.intent ?? 'CREATE',
  strategyId = previousDraft?.strategyId,
}: {
  userMessage: string;
  reply: StrategyCopilotReply;
  previousDraft?: CanonicalCreationDraft;
  intent?: CanonicalCreationIntent;
  strategyId?: string;
}): CopilotCanonicalCreationResult {
  const values = canonicalValues(reply, userMessage, previousDraft);
  const timeframes = resolveTimeframeRoles(userMessage, reply.strategyDraft, previousDraft);
  let draft = previousDraft ?? createCanonicalCreationDraft({ intent, strategyId });
  const patch: Partial<StrategyBuilderV2State> = {};
  const provenance: Partial<Record<CanonicalCreationField, ValueProvenance>> = {};

  for (const field of Object.keys(values) as CanonicalCreationField[]) {
    const value = values[field as keyof StrategyBuilderV2State];
    if (same(value, draft.values[field as keyof StrategyBuilderV2State])) continue;
    (patch as Record<string, unknown>)[field] = value;
    provenance[field] = fieldProvenance(field, userMessage, reply.strategyDraft, timeframes, previousDraft);
  }

  if (Object.keys(patch).length) draft = updateCanonicalCreationDraft(draft, patch, provenance);
  draft = setCanonicalCreationUnresolvedInputs(draft, unresolvedInputs(userMessage, reply));
  const assessment = assessCanonicalCreationDraft(draft);
  return { draft: { ...draft, state: assessment.state }, assessment };
}
