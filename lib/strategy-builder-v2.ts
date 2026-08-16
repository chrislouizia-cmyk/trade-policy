export type Capability = 'AUTOMATIC' | 'MANUAL' | 'EXTERNAL' | 'DESCRIPTIVE';
export type RuleGroupType = 'ALL' | 'ANY';
export type RuleRequirement = 'REQUIRED' | 'OPTIONAL';

export type MethodologyLibrary = {
  id: string;
  label: string;
  summary: string;
  rules: Array<{
    key: string;
    label: string;
    capability: Capability;
    description: string;
  }>;
};

export type RuleSelection = {
  key: string;
  label: string;
  capability: Capability;
  requirement: RuleRequirement;
  timeframe: string;
  group: RuleGroupType;
  description?: string;
};

export type ConflictSeverity = 'INFO' | 'WARNING' | 'BLOCKER';

export type StrategyConflict = {
  id: string;
  severity: ConflictSeverity;
  affectedRules: string[];
  explanation: string;
  suggestedResolution: string;
};

export const METHODOLOGY_LIBRARY: MethodologyLibrary[] = [
  {
    id: 'smc',
    label: 'Smart Money Concepts',
    summary: 'Liquidity, structure, and execution context.',
    rules: [
      { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', description: 'Sweep of prior highs and lows before trend continuation or reversal.' },
      { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', description: 'Change of character after prior structure breaks.' },
      { key: 'bos', label: 'BOS', capability: 'AUTOMATIC', description: 'Break of structure confirming directional continuation.' },
      { key: 'order-block', label: 'Order Block', capability: 'MANUAL', description: 'Contextual supply or demand zone requiring confirmation.' },
      { key: 'fair-value-gap', label: 'Fair Value Gap', capability: 'AUTOMATIC', description: 'Impulse gap that later acts as a re-entry or return zone.' },
      { key: 'premium-discount', label: 'Premium / Discount', capability: 'DESCRIPTIVE', description: 'Framework context rather than a machine-checkable trigger.' },
    ],
  },
  {
    id: 'ict',
    label: 'ICT',
    summary: 'Session timing and intraday context.',
    rules: [
      { key: 'session-open', label: 'Session Open', capability: 'EXTERNAL', description: 'Session opening structure and timing context.' },
      { key: 'silver-bullet', label: 'Silver Bullet', capability: 'DESCRIPTIVE', description: 'Narrative pattern used as context rather than a direct trigger.' },
      { key: 'market-structure-shift', label: 'Market Structure Shift', capability: 'AUTOMATIC', description: 'Directional change by structure and context.' },
      { key: 'liquidity-run', label: 'Liquidity Run', capability: 'MANUAL', description: 'Requires confirmation after sweeping prior liquidity.' },
    ],
  },
  {
    id: 'support-resistance',
    label: 'Support & Resistance',
    summary: 'Key levels and reaction zones.',
    rules: [
      { key: 'support-zone', label: 'Support Zone', capability: 'MANUAL', description: 'Needs trader validation around the exact level.' },
      { key: 'resistance-zone', label: 'Resistance Zone', capability: 'MANUAL', description: 'Needs trader validation around the exact level.' },
      { key: 'pivot', label: 'Pivot', capability: 'AUTOMATIC', description: 'Directional pivot level based on recent price structure.' },
    ],
  },
  {
    id: 'supply-demand',
    label: 'Supply & Demand',
    summary: 'Demand zones and replenishment context.',
    rules: [
      { key: 'supply-zone', label: 'Supply Zone', capability: 'MANUAL', description: 'Zone requiring trader confirmation.' },
      { key: 'demand-zone', label: 'Demand Zone', capability: 'MANUAL', description: 'Zone requiring trader confirmation.' },
      { key: 'retest', label: 'Retest', capability: 'AUTOMATIC', description: 'Revisit of a prior key level after a move.' },
    ],
  },
  {
    id: 'price-action',
    label: 'Price Action',
    summary: 'Pattern and context reading without heavy automation.',
    rules: [
      { key: 'engulfing', label: 'Engulfing', capability: 'AUTOMATIC', description: 'Directional candle pattern.' },
      { key: 'doji', label: 'Doji Rejection', capability: 'AUTOMATIC', description: 'Candlestick rejection pattern.' },
      { key: 'range-break', label: 'Range Break', capability: 'AUTOMATIC', description: 'Break of an established range boundary.' },
    ],
  },
  {
    id: 'breakouts',
    label: 'Breakouts',
    summary: 'Clean break of key structure and continuation logic.',
    rules: [
      { key: 'breakout-confirmation', label: 'Breakout Confirmation', capability: 'AUTOMATIC', description: 'Break of a defined structure or range level.' },
      { key: 'retest-breakout', label: 'Breakout Retest', capability: 'MANUAL', description: 'Requires confirmation after the initial break.' },
    ],
  },
  {
    id: 'trend-following',
    label: 'Trend Following',
    summary: 'Directional participation in the current trend.',
    rules: [
      { key: 'trend-alignment', label: 'Trend Alignment', capability: 'AUTOMATIC', description: 'Higher-timeframe direction supports the trade idea.' },
      { key: 'pullback-entry', label: 'Pullback Entry', capability: 'MANUAL', description: 'Requires confirmation of trend continuation.' },
    ],
  },
  {
    id: 'momentum',
    label: 'Momentum',
    summary: 'Impulse and acceleration conditions.',
    rules: [
      { key: 'momentum-spike', label: 'Momentum Spike', capability: 'AUTOMATIC', description: 'Strong directional move with acceleration.' },
      { key: 'momentum-divergence', label: 'Momentum Divergence', capability: 'MANUAL', description: 'Needs trader interpretation and review.' },
    ],
  },
  {
    id: 'mean-reversion',
    label: 'Mean Reversion',
    summary: 'Recovery after extended move.',
    rules: [
      { key: 'reversion-zone', label: 'Mean Reversion Zone', capability: 'MANUAL', description: 'Contextual signal requiring confirmation.' },
      { key: 'oversold-overbought', label: 'Overbought / Oversold', capability: 'EXTERNAL', description: 'Depends on indicator or data source.' },
    ],
  },
  {
    id: 'volume',
    label: 'Volume',
    summary: 'Participation and confirmation by volume context.',
    rules: [
      { key: 'volume-expansion', label: 'Volume Expansion', capability: 'EXTERNAL', description: 'Requires outside or instrument-specific confirmation.' },
      { key: 'volume-climax', label: 'Volume Climax', capability: 'MANUAL', description: 'Interpretive context requiring human review.' },
    ],
  },
  {
    id: 'custom',
    label: 'Custom',
    summary: 'Add custom playbook notes and personal rules.',
    rules: [
      { key: 'custom-rule', label: 'Custom Rule', capability: 'DESCRIPTIVE', description: 'A custom trader rule to keep in the playbook.' },
      { key: 'custom-override', label: 'Custom Override', capability: 'MANUAL', description: 'Trader-approved override condition.' },
    ],
  },
];

export function toPersistedExecutionMode(capability: Capability): 'AUTOMATIC' | 'MANUAL' | 'EXTERNAL' | undefined {
  if (capability === 'DESCRIPTIVE') return 'MANUAL';
  return capability;
}

export function createDefaultRuleSelection(): RuleSelection[] {
  return [
    { key: 'liquidity-sweep', label: 'Liquidity Sweep', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'Sweep of prior highs and lows.' },
    { key: 'choch', label: 'CHoCH', capability: 'AUTOMATIC', requirement: 'REQUIRED', timeframe: 'M15', group: 'ALL', description: 'Change of character.' },
    { key: 'order-block', label: 'Order Block', capability: 'MANUAL', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'Contextual supply or demand zone.' },
    { key: 'fair-value-gap', label: 'Fair Value Gap', capability: 'AUTOMATIC', requirement: 'OPTIONAL', timeframe: 'M5', group: 'ANY', description: 'Impulse gap returning to prior value.' },
  ];
}

export function buildDraftFromSelection(methodologyIds: string[], selectedRuleKeys: string[], ruleSelections: RuleSelection[] = []): {
  methodologies: Array<{ category: string; rules: string[] }>; rules: RuleSelection[];
} {
  const selectedLibraries = METHODOLOGY_LIBRARY.filter((library) => methodologyIds.includes(library.id));
  const sourceRules: Array<{
    key: string;
    label: string;
    capability: Capability;
    description?: string;
    requirement?: RuleRequirement;
    timeframe?: string;
    group?: RuleGroupType;
  }> = [];

  if (selectedLibraries.length) {
    for (const library of selectedLibraries) {
      for (const rule of library.rules) {
        if (selectedRuleKeys.length === 0 || selectedRuleKeys.includes(rule.key)) {
          sourceRules.push({
            key: rule.key,
            label: rule.label,
            capability: rule.capability,
            description: rule.description,
          });
        }
      }
    }
  } else {
    for (const entry of ruleSelections) {
      if (selectedRuleKeys.length === 0 || selectedRuleKeys.includes(entry.key)) {
        sourceRules.push({
          key: entry.key,
          label: entry.label,
          capability: entry.capability,
          description: entry.description,
          requirement: entry.requirement,
          timeframe: entry.timeframe,
          group: entry.group,
        });
      }
    }
  }

  const selectedRules = sourceRules.map((rule) => {
    const existing = ruleSelections.find((entry) => entry.key === rule.key);
    const requirement = existing?.requirement ?? rule.requirement ?? (rule.capability === 'DESCRIPTIVE' ? 'OPTIONAL' : 'REQUIRED');
    const timeframe = existing?.timeframe ?? rule.timeframe ?? 'M15';
    const group = existing?.group ?? rule.group ?? 'ALL';
    const description = existing?.description ?? rule.description ?? rule.label;

    return {
      key: rule.key,
      label: rule.label,
      capability: rule.capability,
      requirement,
      timeframe,
      group,
      description,
    } satisfies RuleSelection;
  });

  return {
    methodologies: selectedLibraries.map((library) => ({ category: library.label, rules: library.rules.filter((rule) => selectedRuleKeys.includes(rule.key)).map((rule) => rule.key) })),
    rules: selectedRules,
  };
}

export function detectStrategyConflicts({
  selectedRules,
  riskPercent,
  minimumRR,
}: {
  selectedRules: RuleSelection[];
  riskPercent?: number;
  minimumRR?: number;
}): StrategyConflict[] {
  const conflicts: StrategyConflict[] = [];
  const seen = new Map<string, string>();

  selectedRules.forEach((rule) => {
    const duplicateKey = rule.key.toLowerCase();
    if (seen.has(duplicateKey)) {
      conflicts.push({
        id: `duplicate-${rule.key}`,
        severity: 'WARNING',
        affectedRules: [seen.get(duplicateKey) ?? rule.key, rule.key],
        explanation: `Exact duplicate detected for ${rule.label}.`,
        suggestedResolution: 'Remove one copy of the rule or keep only the intended version.',
      });
    } else {
      seen.set(duplicateKey, rule.key);
    }
  });

  const bullish = ['liquidity-sweep', 'choch', 'market-structure-shift', 'trend-alignment', 'breakout-confirmation', 'momentum-spike'];
  const bearish = ['bos', 'premium-discount', 'support-zone', 'resistance-zone'];
  const bullishSelected = selectedRules.filter((rule) => bullish.includes(rule.key));
  const bearishSelected = selectedRules.filter((rule) => bearish.includes(rule.key));
  if (bullishSelected.length && bearishSelected.length) {
    conflicts.push({
      id: 'directional-conflict',
      severity: 'BLOCKER',
      affectedRules: [...bullishSelected.map((rule) => rule.key), ...bearishSelected.map((rule) => rule.key)],
      explanation: 'The current rule selection mixes bullish and bearish directional requirements without a single clear priority.',
      suggestedResolution: 'Keep one directional frame or reduce the conflicting condition set before review.',
    });
  }

  const anyRules = selectedRules.filter((rule) => rule.group === 'ANY');
  const allRules = selectedRules.filter((rule) => rule.group === 'ALL');
  if (anyRules.length && allRules.length) {
    const conflict = anyRules.find((rule) => allRules.some((entry) => entry.key === rule.key));
    if (conflict) {
      conflicts.push({
        id: 'group-mix',
        severity: 'WARNING',
        affectedRules: [conflict.key],
        explanation: 'The same rule appears in a broader ALL group and an OR group, which creates ambiguous intent.',
        suggestedResolution: 'Move the rule into one logical group and keep the other group consistent.',
      });
    }
  }

  if (typeof riskPercent === 'number' && riskPercent > 10) {
    conflicts.push({
      id: 'risk-value',
      severity: 'BLOCKER',
      affectedRules: [],
      explanation: 'The configured risk percentage exceeds the normal trading-risk guardrail for a single strategy.',
      suggestedResolution: 'Reduce risk to a typical operational range before activation.',
    });
  }

  if (typeof minimumRR === 'number' && minimumRR <= 0) {
    conflicts.push({
      id: 'rr-value',
      severity: 'BLOCKER',
      affectedRules: [],
      explanation: 'Minimum RR must be positive to remain usable.',
      suggestedResolution: 'Set a minimum RR greater than zero.',
    });
  }

  return conflicts;
}

export function buildHealthSummary({ selectedRules, conflicts }: { selectedRules: RuleSelection[]; conflicts: StrategyConflict[] }) {
  const automatic = selectedRules.filter((rule) => rule.capability === 'AUTOMATIC').length;
  const manual = selectedRules.filter((rule) => rule.capability === 'MANUAL').length;
  const external = selectedRules.filter((rule) => rule.capability === 'EXTERNAL').length;
  const descriptive = selectedRules.filter((rule) => rule.capability === 'DESCRIPTIVE').length;
  const required = selectedRules.filter((rule) => rule.requirement === 'REQUIRED').length;
  const optional = selectedRules.filter((rule) => rule.requirement === 'OPTIONAL').length;

  return {
    totalRules: selectedRules.length,
    automatic,
    manual,
    external,
    descriptive,
    required,
    optional,
    unresolvedConflicts: conflicts.length,
    warningText: conflicts.length ? `${conflicts.length} unresolved conflict${conflicts.length > 1 ? 's' : ''}` : 'No unresolved conflicts',
  };
}

export function parseCopilotPrompt(prompt: string): {
  selectedRuleKeys: string[];
  groupMode: RuleGroupType;
  note: string;
  unknownConcepts: string[];
} {
  const lower = prompt.toLowerCase();
  const selectedRuleKeys: string[] = [];

  if (lower.includes('liquidity sweep') || lower.includes('liquidity')) selectedRuleKeys.push('liquidity-sweep');
  if (lower.includes('choch')) selectedRuleKeys.push('choch');
  if (lower.includes('order block') || lower.includes('ob')) selectedRuleKeys.push('order-block');
  if (lower.includes('fair value gap') || lower.includes('fvg')) selectedRuleKeys.push('fair-value-gap');
  if (lower.includes('support')) selectedRuleKeys.push('support-zone');
  if (lower.includes('resistance')) selectedRuleKeys.push('resistance-zone');
  if (lower.includes('trend')) selectedRuleKeys.push('trend-alignment');
  if (lower.includes('session')) selectedRuleKeys.push('session-open');

  const anyRequested = lower.includes('or ') || lower.includes('either') || lower.includes('one of');
  const groupMode: RuleGroupType = anyRequested ? 'ANY' : 'ALL';

  const unknownConcepts: string[] = [];
  if (lower.includes('weekly manipulation leg')) unknownConcepts.push('weekly manipulation leg');
  if (lower.includes('silver bullet')) unknownConcepts.push('silver bullet');

  return {
    selectedRuleKeys: [...new Set(selectedRuleKeys)],
    groupMode,
    note: anyRequested ? 'User intends an OR/alternative requirement.' : 'User intends a stacked confirmation requirement.',
    unknownConcepts,
  };
}

export function safeDescriptiveState(ruleKey: string, capability: Capability): { capability: Capability; evaluationMode: 'AUTOMATIC' | 'MANUAL' | 'EXTERNAL'; isDescriptive: boolean } {
  const isDescriptive = capability === 'DESCRIPTIVE';
  return {
    capability,
    evaluationMode: toPersistedExecutionMode(capability) ?? 'MANUAL',
    isDescriptive,
  };
}

export type PersistedV2RuleTree = {
  kind: 'GROUP';
  id: string;
  logic: RuleGroupType;
  children: Array<
    | { kind: 'CONDITION'; id: string; ruleId: string; group: RuleGroupType; requirement: RuleRequirement }
    | PersistedV2RuleTree
  >;
};

export function createPersistedV2RuleTree(selectedRules: RuleSelection[]): PersistedV2RuleTree {
  const allRules = selectedRules.filter((rule) => rule.group === 'ALL');
  const anyRules = selectedRules.filter((rule) => rule.group === 'ANY');

  const children: PersistedV2RuleTree['children'] = allRules.map((rule) => ({
    kind: 'CONDITION',
    id: `condition-${rule.key}`,
    ruleId: rule.key,
    group: rule.group,
    requirement: rule.requirement,
  }));

  if (anyRules.length) {
    children.push({
      kind: 'GROUP',
      id: 'any-conditions',
      logic: 'ANY',
      children: anyRules.map((rule) => ({
        kind: 'CONDITION',
        id: `condition-${rule.key}`,
        ruleId: rule.key,
        group: rule.group,
        requirement: rule.requirement,
      })),
    });
  }

  return {
    kind: 'GROUP',
    id: 'root',
    logic: 'ALL',
    children,
  };
}

export function formatRuleSummary(selectedRules: RuleSelection[]): string {
  if (!selectedRules.length) return 'No rules selected yet.';
  const required = selectedRules.filter((rule) => rule.requirement === 'REQUIRED');
  const optional = selectedRules.filter((rule) => rule.requirement === 'OPTIONAL');
  const segments = [
    required.length ? `Required: ${required.map((rule) => rule.label).join(', ')}` : null,
    optional.length ? `Optional: ${optional.map((rule) => rule.label).join(', ')}` : null,
  ].filter(Boolean);
  return segments.join(' • ') || 'No executable requirements selected.';
}
