import { METHODOLOGY_LIBRARY, type Capability, type RuleGroupType, type RuleRequirement, type RuleSelection } from './strategy-builder-v2.ts';

export type StrategyCopilotIntent = 'CREATE' | 'UPDATE' | 'CLARIFY' | 'NONE';
export type StrategyCopilotDraft = {
  name?: string;
  instrument?: string;
  sessions: string[];
  timeframes: string[];
  rules: RuleSelection[];
  logicTree: { logic: 'ALL' | 'ANY'; children: string[] };
  riskPercent?: number;
  minimumRR?: number;
  notes: string[];
};

export type StrategyCopilotReply = {
  message: string;
  intent: StrategyCopilotIntent;
  strategyDraft: StrategyCopilotDraft;
  changes: string[];
  unresolvedQuestions: string[];
};

export type StrategyCopilotSessionState = {
  sessionId: string;
  draft: StrategyCopilotDraft;
  messages: Array<{ role: 'user' | 'assistant'; text: string; createdAt: string }>;
  updatedAt: number;
};

const catalog = new Map(METHODOLOGY_LIBRARY.flatMap((library) => library.rules).map((rule) => [rule.key, rule]));
const methodologyCatalog = new Set(METHODOLOGY_LIBRARY.map((library) => library.id));
const sessions = new Set(['London', 'New York', 'Sydney', 'Tokyo']);
const timeframes = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1']);
const instruments = new Set(['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF', 'NAS100']);
const detectorIds = new Set([...catalog.keys()]);
const sessionStore = new Map<string, StrategyCopilotSessionState>();

export function emptyStrategyCopilotDraft(): StrategyCopilotDraft {
  return { sessions: [], timeframes: [], rules: [], logicTree: { logic: 'ALL', children: [] }, notes: [] };
}

export function hasGeneratedStrategyDraft(draft: StrategyCopilotDraft | null | undefined): boolean {
  if (!draft) return false;
  return Array.isArray(draft.rules) && draft.rules.length > 0;
}

export function canReviewStrategyDraft(draft: StrategyCopilotDraft | null | undefined): boolean {
  if (!draft) return false;
  return hasGeneratedStrategyDraft(draft) && (
    (Array.isArray(draft.sessions) && draft.sessions.length > 0) ||
    (Array.isArray(draft.timeframes) && draft.timeframes.length > 0) ||
    typeof draft.riskPercent === 'number' ||
    typeof draft.minimumRR === 'number'
  );
}

export function ensureStrategyCopilotSession(sessionId: string): StrategyCopilotSessionState {
  const existing = sessionStore.get(sessionId);
  if (existing) return existing;
  const fresh: StrategyCopilotSessionState = {
    sessionId,
    draft: emptyStrategyCopilotDraft(),
    messages: [{ role: 'assistant', text: 'Tell me how you trade. I’ll turn it into a structured strategy draft you can review and refine.', createdAt: new Date().toISOString() }],
    updatedAt: Date.now(),
  };
  sessionStore.set(sessionId, fresh);
  return fresh;
}

export function upsertStrategyCopilotSession(sessionId: string, draft: StrategyCopilotDraft, message?: { role: 'user' | 'assistant'; text: string }) {
  const session = ensureStrategyCopilotSession(sessionId);
  const next = { ...session, draft, updatedAt: Date.now() };
  if (message) {
    next.messages = [...next.messages, { ...message, createdAt: new Date().toISOString() }];
  }
  sessionStore.set(sessionId, next);
  return next;
}

export function buildLogicTreeFromRules(rules: RuleSelection[]): { logic: 'ALL' | 'ANY'; children: string[] } {
  const allRules = rules.filter((rule) => rule.group === 'ALL');
  const anyRules = rules.filter((rule) => rule.group === 'ANY');
  const children = [...allRules.map((rule) => rule.key)];
  if (anyRules.length) {
    return { logic: 'ALL', children: [...children, ...(anyRules.length ? ['ANY'] : [])] };
  }
  return { logic: allRules.length ? 'ALL' : 'ANY', children };
}

export function mergeStrategyCopilotDraft(previous: StrategyCopilotDraft, next: StrategyCopilotDraft): StrategyCopilotDraft {
  const mergedRules = new Map<string, RuleSelection>();
  for (const rule of previous.rules) mergedRules.set(rule.key, { ...rule });
  for (const rule of next.rules) mergedRules.set(rule.key, { ...rule });

  const mergedSessions = next.sessions.length ? next.sessions : previous.sessions;
  const mergedTimeframes = next.timeframes.length ? next.timeframes : previous.timeframes;
  const mergedNotes = [...new Set([...(previous.notes ?? []), ...(next.notes ?? [])])];
  const mergedRulesList = Array.from(mergedRules.values());

  return {
    name: next.name ?? previous.name,
    instrument: next.instrument ?? previous.instrument,
    sessions: mergedSessions,
    timeframes: mergedTimeframes,
    rules: mergedRulesList,
    logicTree: next.logicTree?.children?.length ? next.logicTree : buildLogicTreeFromRules(mergedRulesList),
    riskPercent: typeof next.riskPercent === 'number' ? previous.riskPercent ?? next.riskPercent : previous.riskPercent,
    minimumRR: typeof next.minimumRR === 'number' ? previous.minimumRR ?? next.minimumRR : previous.minimumRR,
    notes: mergedNotes,
  };
}

export function isKnownStrategyMethodology(methodologyId: string): boolean {
  return methodologyCatalog.has(methodologyId);
}

export function isKnownStrategyRuleKey(ruleKey: string): boolean {
  return catalog.has(ruleKey);
}

export function isKnownStrategyDetector(detectorId: string): boolean {
  return detectorIds.has(detectorId);
}

export function rejectUnsupportedStrategyCopilotFields(draft: Record<string, unknown>): string[] {
  const unsupported: string[] = [];
  if (draft.methodology && typeof draft.methodology === 'string' && !isKnownStrategyMethodology(draft.methodology)) {
    unsupported.push(`Unsupported methodology: ${draft.methodology}`);
  }
  if (Array.isArray(draft.methodologies)) {
    for (const entry of draft.methodologies) {
      if (typeof entry === 'string' && !isKnownStrategyMethodology(entry)) unsupported.push(`Unsupported methodology: ${entry}`);
    }
  }
  if (Array.isArray(draft.detectedRules)) {
    for (const entry of draft.detectedRules) {
      if (typeof entry === 'string' && !isKnownStrategyRuleKey(entry)) unsupported.push(`Unsupported rule: ${entry}`);
    }
  }
  if (Array.isArray(draft.detectorIds)) {
    for (const entry of draft.detectorIds) {
      if (typeof entry === 'string' && !isKnownStrategyDetector(entry)) unsupported.push(`Unsupported detector: ${entry}`);
    }
  }
  if (draft.instrument && typeof draft.instrument === 'string' && !instruments.has(draft.instrument)) {
    unsupported.push(`Unsupported instrument: ${draft.instrument}`);
  }
  return unsupported;
}

export function normalizeStrategyCopilotReply(value: unknown, previous: StrategyCopilotDraft = emptyStrategyCopilotDraft()): StrategyCopilotReply {
  if (!value || typeof value !== 'object') throw new Error('Copilot response is not an object.');
  const response = value as Record<string, unknown>;
  const rawDraft = response.strategyDraft;
  if (!rawDraft || typeof rawDraft !== 'object') throw new Error('Copilot response has no strategy draft.');

  const unsupported = rejectUnsupportedStrategyCopilotFields(rawDraft as Record<string, unknown>);
  if (unsupported.length) throw new Error(unsupported[0]);

  const draft = rawDraft as Record<string, unknown>;
  const rawRules = Array.isArray(draft.rules) ? draft.rules : [];
  const rules: RuleSelection[] = rawRules.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Copilot returned an invalid rule.');
    const raw = item as Record<string, unknown>;
    const key = String(raw.key ?? '').trim();
    const definition = catalog.get(key);
    if (!definition) throw new Error(`Copilot returned an unknown rule: ${key || 'missing key'}.`);

    const capability = definition.capability as Capability;
    const requirementValue = String(raw.requirement ?? 'REQUIRED');
    const requirement: RuleRequirement = capability === 'DESCRIPTIVE' || requirementValue === 'OPTIONAL' ? 'OPTIONAL' : 'REQUIRED';
    const group: RuleGroupType = raw.group === 'ANY' ? 'ANY' : 'ALL';
    const timeframe = timeframes.has(String(raw.timeframe ?? '')) ? String(raw.timeframe) : previous.rules.find((rule) => rule.key === key)?.timeframe ?? 'M15';

    return {
      key,
      label: definition.label,
      capability,
      requirement,
      timeframe,
      group,
      description: definition.description,
    };
  });

  const selectedSessions = Array.isArray(draft.sessions)
    ? draft.sessions.filter((item): item is string => typeof item === 'string' && sessions.has(item))
    : previous.sessions;
  const selectedTimeframes = Array.isArray(draft.timeframes)
    ? draft.timeframes.filter((item): item is string => typeof item === 'string' && timeframes.has(item))
    : previous.timeframes;

  const risk = typeof previous.riskPercent === 'number' ? previous.riskPercent : typeof draft.riskPercent === 'number' && Number.isFinite(draft.riskPercent) && draft.riskPercent > 0 && draft.riskPercent <= 10 ? draft.riskPercent : undefined;
  const rr = typeof previous.minimumRR === 'number' ? previous.minimumRR : typeof draft.minimumRR === 'number' && Number.isFinite(draft.minimumRR) && draft.minimumRR > 0 ? draft.minimumRR : undefined;

  const rawLogicTree = draft.logicTree && typeof draft.logicTree === 'object' ? (draft.logicTree as Record<string, unknown>) : null;
  const next: StrategyCopilotDraft = {
    name: typeof draft.name === 'string' ? draft.name : previous.name,
    instrument: typeof draft.instrument === 'string' && instruments.has(draft.instrument) ? draft.instrument : previous.instrument,
    sessions: selectedSessions,
    timeframes: selectedTimeframes,
    rules,
    logicTree: rawLogicTree ? { logic: rawLogicTree.logic === 'ANY' ? 'ANY' : 'ALL', children: Array.isArray(rawLogicTree.children) ? (rawLogicTree.children as unknown[]).filter((item): item is string => typeof item === 'string') : rules.map((rule) => rule.key) } : { logic: 'ALL', children: rules.map((rule) => rule.key) },
    riskPercent: risk,
    minimumRR: rr,
    notes: Array.isArray(draft.notes) ? draft.notes.filter((item): item is string => typeof item === 'string').slice(0, 12) : previous.notes,
  };

  return {
    message: typeof response.message === 'string' ? response.message : 'I updated the structured draft for your review.',
    intent: ['CREATE', 'UPDATE', 'CLARIFY', 'NONE'].includes(String(response.intent)) ? (String(response.intent) as StrategyCopilotIntent) : 'NONE',
    strategyDraft: next,
    changes: Array.isArray(response.changes) ? response.changes.filter((item): item is string => typeof item === 'string').slice(0, 20) : [],
    unresolvedQuestions: Array.isArray(response.unresolvedQuestions) ? response.unresolvedQuestions.filter((item): item is string => typeof item === 'string').slice(0, 8) : [],
  };
}

export const strategyCopilotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'intent', 'strategyDraft', 'changes', 'unresolvedQuestions'],
  properties: {
    message: { type: 'string' },
    intent: { type: 'string', enum: ['CREATE', 'UPDATE', 'CLARIFY', 'NONE'] },
    strategyDraft: {
      type: 'object',
      additionalProperties: false,
      required: ['sessions', 'timeframes', 'rules', 'logicTree', 'notes'],
      properties: {
        name: { type: ['string', 'null'] },
        instrument: { type: ['string', 'null'] },
        sessions: { type: 'array', items: { type: 'string' } },
        timeframes: { type: 'array', items: { type: 'string' } },
        rules: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'requirement', 'timeframe', 'group'],
            properties: {
              key: { type: 'string', enum: [...catalog.keys()] },
              requirement: { type: 'string', enum: ['REQUIRED', 'OPTIONAL'] },
              timeframe: { type: 'string', enum: [...timeframes] },
              group: { type: 'string', enum: ['ALL', 'ANY'] },
            },
          },
        },
        logicTree: {
          type: 'object',
          additionalProperties: false,
          required: ['logic', 'children'],
          properties: {
            logic: { type: 'string', enum: ['ALL', 'ANY'] },
            children: { type: 'array', items: { type: 'string' } },
          },
        },
        riskPercent: { type: ['number', 'null'] },
        minimumRR: { type: ['number', 'null'] },
        notes: { type: 'array', items: { type: 'string' } },
      },
    },
    changes: { type: 'array', items: { type: 'string' } },
    unresolvedQuestions: { type: 'array', items: { type: 'string' } },
  },
} as const;

export function buildStrategyCopilotInstructions() {
  return `You are Strategy Copilot. Interpret user language into a structured drafting object only. Never authorize, evaluate, recommend, or execute a trade. Use only the V2 catalog rule IDs and methodology IDs supplied below. Preserve the existing draft unless the user explicitly changes it. DESCRIPTIVE rules must remain OPTIONAL and never mandatory. If a user requests something unsupported, explain that it is unsupported instead of inventing a rule or detector. Risk percentage, minimum RR, maximum drawdown, and other risk controls cannot be silently changed by AI. Catalog: ${JSON.stringify({ methodologies: [...METHODOLOGY_LIBRARY].map((library) => ({ id: library.id, label: library.label, rules: library.rules.map((rule) => ({ key: rule.key, label: rule.label, capability: rule.capability, description: rule.description })) })), supportedInstruments: [...instruments], allowedDetectors: [...detectorIds] })}.`;
}

export function buildCanonicalRuleSelectionListFromText(rawMessage: string, currentDraft: StrategyCopilotDraft = emptyStrategyCopilotDraft()): RuleSelection[] {
  const lower = rawMessage.toLowerCase();
  const rules: RuleSelection[] = [];
  const seen = new Set<string>();

  const addRule = (ruleKey: string, group: RuleGroupType = 'ALL', requirement: RuleRequirement = 'REQUIRED', timeframe: string = 'M5') => {
    if (!catalog.has(ruleKey) || seen.has(ruleKey)) return;
    const definition = catalog.get(ruleKey)!;
    seen.add(ruleKey);
    rules.push({
      key: ruleKey,
      label: definition.label,
      capability: definition.capability,
      requirement: definition.capability === 'DESCRIPTIVE' ? 'OPTIONAL' : requirement,
      timeframe,
      group,
      description: definition.description,
    });
  };

  if (lower.includes('liquidity sweep') || lower.includes('liquidity')) addRule('liquidity-sweep', 'ALL', 'REQUIRED');
  if (lower.includes('choch')) addRule('choch', 'ALL', 'REQUIRED');
  if (lower.includes('order block') || lower.includes('ob')) addRule('order-block', 'ANY', 'OPTIONAL');
  if (lower.includes('fair value gap') || lower.includes('fvg')) addRule('fair-value-gap', 'ANY', 'OPTIONAL');
  if (lower.includes('support')) addRule('support-zone', 'ANY', 'OPTIONAL');
  if (lower.includes('resistance')) addRule('resistance-zone', 'ANY', 'OPTIONAL');
  if (lower.includes('breakout')) addRule('breakout-confirmation', 'ALL', 'REQUIRED');
  if (lower.includes('trend')) addRule('trend-alignment', 'ALL', 'REQUIRED');

  const existing = new Map(currentDraft.rules.map((rule) => [rule.key, rule]));
  for (const rule of rules) {
    const previous = existing.get(rule.key);
    if (previous) {
      rule.requirement = previous.requirement === 'OPTIONAL' || rule.capability === 'DESCRIPTIVE' ? 'OPTIONAL' : 'REQUIRED';
      rule.timeframe = previous.timeframe ?? rule.timeframe;
      rule.group = previous.group ?? rule.group;
    }
  }

  return rules.length ? rules : currentDraft.rules;
}

export function extractStructuredDraftFromText(rawMessage: string, currentDraft: StrategyCopilotDraft = emptyStrategyCopilotDraft()): StrategyCopilotDraft {
  const lower = rawMessage.toLowerCase();
  const nextDraft = { ...currentDraft, notes: [...currentDraft.notes, rawMessage] };
  const sessions = new Set<string>(currentDraft.sessions);
  const mentionedSessions = ['london', 'new york', 'sydney', 'tokyo'];
  for (const session of mentionedSessions) {
    if (lower.includes(session)) {
      const canonical = session.split(' ').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      if (lower.includes('only') && !lower.includes('and')) {
        sessions.clear();
      }
      sessions.add(canonical === 'New York' ? 'New York' : canonical === 'New' ? 'New York' : canonical);
    }
  }

  const explicitOnly = /only\s+london|london\s+only|only\s+new york|new york\s+only/i.test(rawMessage);
  if (explicitOnly) {
    const onlySession = /only\s+london/i.test(rawMessage) ? 'London' : 'New York';
    nextDraft.sessions = [onlySession];
  } else {
    nextDraft.sessions = [...sessions];
  }

  const instrumentGuess = /gold|xauusd/i.test(rawMessage) ? 'XAUUSD' : /silver|xagusd/i.test(rawMessage) ? 'XAGUSD' : currentDraft.instrument;
  if (instrumentGuess) nextDraft.instrument = instrumentGuess;

  const rules = buildCanonicalRuleSelectionListFromText(rawMessage, currentDraft);
  const anyRequested = /either|or\s+one|one of|either one|or\s+fvg|or\s+order block|don'?t\s+need\s+both|not\s+both|only\s+one/i.test(rawMessage);

  for (const rule of rules) {
    if (lower.includes('fvg is optional') || lower.includes('fair value gap is optional')) {
      rule.requirement = 'OPTIONAL';
      rule.group = 'ANY';
    }
    if (lower.includes('choch is m5') || lower.includes('choch is m15')) {
      const tf = /choch is m5/i.test(rawMessage) ? 'M5' : 'M15';
      rule.timeframe = tf;
    }
    if (lower.includes('i don\'t need both order block and fvg') || lower.includes('i do not need both order block and fvg') || lower.includes('don\'t need both')) {
      if (rule.key === 'order-block' || rule.key === 'fair-value-gap') rule.group = 'ANY';
    }
  }

  nextDraft.rules = rules;
  nextDraft.timeframes = currentDraft.timeframes.length ? currentDraft.timeframes : ['M5'];
  nextDraft.logicTree = {
    logic: anyRequested ? 'ALL' : 'ALL',
    children: rules.map((rule) => rule.key),
  };
  nextDraft.riskPercent = currentDraft.riskPercent;
  nextDraft.minimumRR = currentDraft.minimumRR;

  return nextDraft;
}
