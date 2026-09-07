'use client';

import { useEffect, useMemo, useState } from 'react';
import type { StrategyProfile } from '@/types/trade';
import {
  METHODOLOGY_LIBRARY,
  buildDraftFromSelection,
  buildHealthSummary,
  createDefaultRuleSelection,
  createPersistedV2RuleTree,
  detectStrategyConflicts,
  formatRuleSummary,
  parseCopilotPrompt,
  reconcileRuleSelectionsWithMethodologies,
  type Capability,
  type RuleGroupType,
  type RuleSelection,
} from '@/lib/strategy-builder-v2';
import { v2StateToPersistedStrategy, type StrategyBuilderV2State, type V2Persisted } from '@/lib/strategy-builder-v2-persistence';
import { emptyStrategyCopilotDraft, type StrategyCopilotDraft } from '@/lib/strategy-copilot';
import { mapCopilotReplyToCanonicalCreation } from '@/lib/strategy-copilot-creation';
import {
  adaptCanonicalCreationDraftToV2Persistence,
  assessCanonicalCreationDraft,
  confirmCanonicalCreationDraft,
  createCanonicalCreationDraft,
  updateCanonicalCreationDraft,
  type CanonicalCreationAssessment,
  type CanonicalCreationDraft,
} from '@/lib/strategy-creation-contract';
import { SUPPORTED_INSTRUMENT_SYMBOLS } from '@/lib/instrument-registry';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { workspaceText } from '@/lib/i18n/workspace-copy';
import {
  ADVANCED_STRATEGY_CREATION_MODES,
  STRATEGY_CREATION_ENTRY_PATHS,
  type StrategyCreationEntryPath,
  type StrategyCreationMode,
} from '@/lib/strategy-creation-flow';

type CreationPath = StrategyCreationMode | 'advanced';
export type StrategyBuilderV2Mode='CREATE'|'EDIT';
type StepKey = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS: Record<StepKey, string> = {
  1: 'Your Style',
  2: 'When You Trade',
  3: 'Your Setup',
  4: 'Risk & Management',
  5: 'Review & Activate',
};

const capabilityTone: Record<Capability, string> = {
  AUTOMATIC: 'positive',
  MANUAL: 'warning',
  EXTERNAL: 'info',
  DESCRIPTIVE: 'neutral',
};

const defaultMethodologies = ['smc', 'support-resistance'];

export default function StrategyBuilderV2({
  profile,
  initialState,
  mode,
  onApply,
  onCancel,
  onStateChange,
}: {
  profile: StrategyProfile;
  initialState?: StrategyBuilderV2State;
  mode: StrategyBuilderV2Mode;
  onApply: (persisted: V2Persisted) => Promise<boolean> | boolean;
  onCancel: () => void;
  onStateChange?: (state: StrategyBuilderV2State) => void;
}) {
  const { locale } = useLocale();
  const [copilotSessionId] = useState(() => crypto.randomUUID());
  const w = (text:string) => workspaceText(locale,text);
  const [path, setPath] = useState<CreationPath>(()=>mode==='EDIT'?'visual':'copilot');
  const [step, setStep] = useState<StepKey>(1);
  const [selectedMethodologyIds, setSelectedMethodologyIds] = useState<string[]>(initialState?.methodologyIds ?? []);
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>(initialState?.instruments ?? []);
  const [direction, setDirection] = useState<'LONG' | 'SHORT' | 'BOTH'>(initialState?.direction ?? 'BOTH');
  const [sessions, setSessions] = useState<string[]>(initialState?.sessions ?? []);
  const [contextTimeframe, setContextTimeframe] = useState<string>(initialState?.contextTimeframe ?? '');
  const [executionTimeframe, setExecutionTimeframe] = useState<string>(initialState?.executionTimeframe ?? '');
  const [selectedRuleSelections, setSelectedRuleSelections] = useState<RuleSelection[]>(() => reconcileRuleSelectionsWithMethodologies({ methodologyIds: initialState?.methodologyIds ?? [], ruleSelections: initialState?.ruleSelections ?? [] }));
  const [riskPercent, setRiskPercent] = useState<number>(initialState?.riskPercent ?? 0);
  const [minimumRR, setMinimumRR] = useState<number>(initialState?.minimumRR ?? 0);
  const [strategyName, setStrategyName] = useState<string>(initialState?.name ?? profile.name ?? '');
  const [stopLogic, setStopLogic] = useState<string>(typeof initialState?.stopLogic === 'string' ? initialState.stopLogic : '');
  const [targetLogic, setTargetLogic] = useState<string>(typeof initialState?.targetLogic === 'string' ? initialState.targetLogic : '');
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotConversation, setCopilotConversation] = useState<Array<{ heading: string; text: string }>>([
    { heading: 'Strategy Copilot', text: 'Tell me how you trade. I’ll turn it into a structured strategy draft you can review and refine.' },
  ]);
  const [copilotDraft, setCopilotDraft] = useState<StrategyCopilotDraft>(() => ({
    ...emptyStrategyCopilotDraft(),
  }));
  const [canonicalCopilotDraft, setCanonicalCopilotDraft] = useState<CanonicalCreationDraft>(() => createCanonicalCreationDraft({
    intent: mode,
    ...(mode === 'EDIT' && profile.id ? { strategyId: profile.id } : {}),
  }));
  const [copilotRefinementInput, setCopilotRefinementInput] = useState('');
  const [copilotReviewVisible, setCopilotReviewVisible] = useState(false);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotApproved, setCopilotApproved] = useState(false);
  const [copilotApplyError, setCopilotApplyError] = useState('');
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ruleMenuOpen, setRuleMenuOpen] = useState<string | null>(null);

  const allLibraries = METHODOLOGY_LIBRARY;
  const selectedLibraries = useMemo(
    () => allLibraries.filter((method) => selectedMethodologyIds.includes(method.id)),
    [allLibraries, selectedMethodologyIds],
  );

  const canonicalRuleSelections = useMemo(
    () => reconcileRuleSelectionsWithMethodologies({ methodologyIds: selectedMethodologyIds, ruleSelections: selectedRuleSelections }),
    [selectedMethodologyIds, selectedRuleSelections],
  );
  const selectedRuleKeys = canonicalRuleSelections.map((rule) => rule.key);
  const conflicts = useMemo(
    () => detectStrategyConflicts({ selectedRules: canonicalRuleSelections, riskPercent, minimumRR }),
    [canonicalRuleSelections, riskPercent, minimumRR],
  );
  const health = useMemo(
    () => buildHealthSummary({ selectedRules: canonicalRuleSelections, conflicts }),
    [canonicalRuleSelections, conflicts],
  );

  const allRulesByKey = useMemo(
    () => allLibraries.flatMap((library) => library.rules).reduce<Record<string, (typeof METHODOLOGY_LIBRARY)[number]['rules'][number]>>((acc, rule) => {
      acc[rule.key] = rule;
      return acc;
    }, {}),
    [allLibraries],
  );

  const selectedRulesText = formatRuleSummary(canonicalRuleSelections);

  function initializeVisualMode() {
    setSelectedMethodologyIds([...defaultMethodologies]); setSelectedInstruments([]); setSessions([]); setContextTimeframe('H1'); setExecutionTimeframe('M15'); setSelectedRuleSelections(createDefaultRuleSelection()); setRiskPercent(0.5); setMinimumRR(3); setStopLogic(''); setTargetLogic(''); setDirection('BOTH'); setApprovalConfirmed(false);
  }
  function initializeCopilotMode() {
    setSelectedMethodologyIds([]); setSelectedInstruments([]); setSessions([]); setContextTimeframe(''); setExecutionTimeframe(''); setSelectedRuleSelections([]); setRiskPercent(0); setMinimumRR(0); setStopLogic(''); setTargetLogic(''); setDirection('BOTH'); setStrategyName(''); setCopilotInput(''); setCopilotDraft(emptyStrategyCopilotDraft()); setCanonicalCopilotDraft(createCanonicalCreationDraft({ intent: mode, ...(mode === 'EDIT' && profile.id ? { strategyId: profile.id } : {}) })); setCopilotReviewVisible(false); setCopilotApproved(false); setCopilotRefinementInput('');
  }
  function initializeMethodologyMode() { setSelectedMethodologyIds([]); setSelectedInstruments([]); setSessions([]); setSelectedRuleSelections([]); setStopLogic(''); setTargetLogic(''); setApprovalConfirmed(false); }
  function initializeBlankMode() { initializeCopilotMode(); }
  function enterMode(mode: StrategyCreationMode) { if (mode === 'visual') initializeVisualMode(); else if (mode === 'copilot') initializeCopilotMode(); else if (mode === 'methodology') initializeMethodologyMode(); else initializeBlankMode(); setPath(mode); setStep(1); }
  function enterCreationEntry(entryPath: StrategyCreationEntryPath) {
    if (entryPath === 'describe') {
      if (path !== 'copilot') enterMode('copilot');
      return;
    }
    setPath('advanced');
  }

  function currentState(overrides: Partial<StrategyBuilderV2State> = {}): StrategyBuilderV2State {
    return { name: strategyName, instruments: selectedInstruments, sessions, contextTimeframe: contextTimeframe || undefined, executionTimeframe: executionTimeframe || undefined, methodologyIds: selectedMethodologyIds, ruleSelections: canonicalRuleSelections, riskPercent, minimumRR, stopLogic: stopLogic || undefined, targetLogic: targetLogic || undefined, direction, ...overrides };
  }

  function acceptCopilotPayload(payload: any, userMessage: string) {
    const nextDraft: StrategyCopilotDraft = payload.strategyDraft ?? copilotDraft;
    const canonical: { draft: CanonicalCreationDraft; assessment: CanonicalCreationAssessment } = payload.canonicalDraft && payload.canonicalAssessment
      ? { draft: payload.canonicalDraft, assessment: payload.canonicalAssessment }
      : mapCopilotReplyToCanonicalCreation({
          userMessage,
          reply: {
            message: payload.message ?? '', intent: payload.intent ?? 'NONE', strategyDraft: nextDraft,
            changes: Array.isArray(payload.changes) ? payload.changes : [],
            unresolvedQuestions: Array.isArray(payload.unresolvedQuestions) ? payload.unresolvedQuestions : [],
          },
          previousDraft: canonicalCopilotDraft,
        });
    const values = canonical.draft.values;
    setCopilotDraft(nextDraft);
    setCanonicalCopilotDraft(canonical.draft);
    setStrategyName(values.name);
    setSelectedInstruments(values.instruments);
    setSessions(values.sessions);
    setContextTimeframe(values.contextTimeframe ?? '');
    setExecutionTimeframe(values.executionTimeframe ?? '');
    setSelectedRuleSelections(reconcileRuleSelectionsWithMethodologies({ methodologyIds: values.methodologyIds, ruleSelections: values.ruleSelections }));
    setRiskPercent(values.riskPercent);
    setMinimumRR(values.minimumRR);
    if (values.direction) setDirection(values.direction);
    setCopilotApproved(false);
    return canonical.assessment;
  }
  useEffect(() => { onStateChange?.(currentState()); }, [strategyName, selectedInstruments, sessions, contextTimeframe, executionTimeframe, selectedMethodologyIds, canonicalRuleSelections, riskPercent, minimumRR, stopLogic, targetLogic, direction]);

  function syncSelectedRulesFromMethodologies(ids: string[], nextSelections: RuleSelection[]) {
    setSelectedRuleSelections(
      reconcileRuleSelectionsWithMethodologies({ methodologyIds: ids, ruleSelections: nextSelections }),
    );
  }

  function toggleMethodology(id: string) {
    const nextIds = selectedMethodologyIds.includes(id)
      ? selectedMethodologyIds.filter((value) => value !== id)
      : [...selectedMethodologyIds, id];

    setSelectedMethodologyIds(nextIds);
    syncSelectedRulesFromMethodologies(nextIds, selectedRuleSelections);
  }

  function toggleRuleSelection(ruleKey: string) {
    const definition = allRulesByKey[ruleKey];
    if (!definition) return;

    const existing = selectedRuleSelections.find((rule) => rule.key === ruleKey);
    if (existing) {
      setSelectedRuleSelections((current) => reconcileRuleSelectionsWithMethodologies({
      methodologyIds: selectedMethodologyIds,
      ruleSelections: current.filter((rule) => rule.key !== ruleKey),
    }));
      return;
    }

    setSelectedRuleSelections((current) => reconcileRuleSelectionsWithMethodologies({
      methodologyIds: selectedMethodologyIds,
      ruleSelections: [
        ...current,
        {
          key: definition.key,
          label: definition.label,
          capability: definition.capability,
          requirement: definition.capability === 'DESCRIPTIVE' ? 'OPTIONAL' : 'REQUIRED',
          timeframe: executionTimeframe,
          group: 'ALL',
          description: definition.description,
        },
      ],
    }));
  }

  function updateRuleSelection(ruleKey: string, patch: Partial<RuleSelection>) {
    setSelectedRuleSelections((current) => reconcileRuleSelectionsWithMethodologies({
      methodologyIds: selectedMethodologyIds,
      ruleSelections: current.map((rule) => rule.key === ruleKey ? { ...rule, ...patch } : rule),
    }));
  }

  async function buildVisualApply() {
    if (!approvalConfirmed || saving) return;
    setSaving(true);
    try {
      const persisted = v2StateToPersistedStrategy(profile, currentState());
      await onApply(persisted);
    } finally {
      setSaving(false);
    }
  }

  function buildCopilotApply() {
    const assessment = assessCanonicalCreationDraft(canonicalCopilotDraft);
    if (!assessment.canPersist) {
      setCopilotApplyError(assessment.clarifications[0]?.question ?? 'Review and confirm the canonical strategy draft before applying it.');
      return;
    }
    try {
      setCopilotApplyError('');
      void onApply(adaptCanonicalCreationDraftToV2Persistence(profile, canonicalCopilotDraft).persisted);
    } catch (error) {
      setCopilotApplyError(error instanceof Error ? error.message : 'The canonical strategy draft could not be applied.');
    }
  }

  function addCopilotTurn() {
    const parsed = parseCopilotPrompt(copilotInput);
    setCopilotConversation((current) => [
      ...current,
      { heading: 'Trader', text: copilotInput },
      {
        heading: 'Trade Police',
        text: `${parsed.note}${parsed.selectedRuleKeys.length ? ` Drafted rules: ${parsed.selectedRuleKeys.join(', ')}.` : ' No known rule matches were found in the description.'}${parsed.unknownConcepts.length ? ` Unknown concepts noted for manual review: ${parsed.unknownConcepts.join(', ')}.` : ''}`,
      },
    ]);
    if (parsed.selectedRuleKeys.length) {
      const nextRules: RuleSelection[] = parsed.selectedRuleKeys.map((key) => {
        const definition = allRulesByKey[key];
        return {
          key: definition.key,
          label: definition.label,
          capability: definition.capability,
          requirement: definition.capability === 'DESCRIPTIVE' ? 'OPTIONAL' : 'REQUIRED',
          timeframe: executionTimeframe,
          group: parsed.groupMode,
          description: definition.description,
        };
      });
      setSelectedRuleSelections(reconcileRuleSelectionsWithMethodologies({
        methodologyIds: selectedMethodologyIds,
        ruleSelections: nextRules,
      }));
    }
  }

  const stepRouter = (
    <div className="builder-step-tabs">
      {([1, 2, 3, 4, 5] as StepKey[]).map((value) => (
        <button key={value} type="button" className={step === value ? 'active' : ''} onClick={() => setStep(value)}>
          {value}. {w(STEP_LABELS[value])}
        </button>
      ))}
    </div>
  );

  const methodRow = (
    <div className="methodology-grid">
      {allLibraries.map((library) => (
        <button
          key={library.id}
          type="button"
          className={`chip ${selectedMethodologyIds.includes(library.id) ? 'selected' : ''}`}
          onClick={() => toggleMethodology(library.id)}
        >
          {w(library.label)}
        </button>
      ))}
    </div>
  );

  const draftSummary = createPersistedV2RuleTree(selectedRuleSelections);

  return (
    <div className="card strategy-builder-v2">
      <div className="conversation-prompt">
        <span aria-hidden="true">TP</span>
        <div>
          <p className="muted">{w(mode==='EDIT'?'EDIT STRATEGY':'NEW STRATEGY')}</p>
          <h2>{mode==='EDIT'?strategyName||profile.name:w('Build a strategy without learning the engine schema')}</h2>
          <p>{w(mode==='EDIT'?'Editing your existing strategy. Changes update this saved strategy only.':'Trade Police turns your trading style into a structured, reviewable playbook.')}</p>
        </div>
      </div>

      {mode==='CREATE'&&<div className="button-row" aria-label="Strategy creation entry paths">
        {STRATEGY_CREATION_ENTRY_PATHS.map((entryPath) => (
          <button key={entryPath} type="button" className={entryPath === 'describe' ? 'primary' : ''} aria-current={(entryPath === 'describe' && path === 'copilot') || (entryPath === 'advanced' && path !== 'copilot') ? 'page' : undefined} onClick={() => enterCreationEntry(entryPath)}>
            {entryPath === 'describe' && w('Describe how you trade')}
            {entryPath === 'advanced' && w('Advanced configuration')}
          </button>
        ))}
      </div>}

      {path === 'advanced' && (
        <div className="strategy-v2-panel">
          <h3>{w('Advanced configuration')}</h3>
          <p className="muted">{w('Choose a guided visual setup, begin with a methodology, or open a truly blank manual builder.')}</p>
          <div className="button-row" aria-label="Advanced strategy creation options">
            {ADVANCED_STRATEGY_CREATION_MODES.map((advancedMode) => (
              <button key={advancedMode} type="button" onClick={() => enterMode(advancedMode)}>
                {advancedMode === 'visual' && w('Build visually')}
                {advancedMode === 'methodology' && w('Start from a methodology')}
                {advancedMode === 'blank' && w('Start blank')}
              </button>
            ))}
          </div>
        </div>
      )}

      {path === 'visual' && (
        <div className="strategy-v2-panel">
          {mode==='EDIT'&&<label>{w('Strategy name')}<input value={strategyName} onChange={event=>setStrategyName(event.target.value)} placeholder={w('Name this strategy')} /></label>}
          {stepRouter}

          {step === 1 && (
            <div className="builder-step">
              <h3>{w('Step 1 — Your Style')}</h3>
              <label>{w('Direction')}<select value={direction} onChange={(event) => setDirection(event.target.value as 'LONG' | 'SHORT' | 'BOTH')}>
                <option value="BOTH">{w('Both')}</option>
                <option value="LONG">{w('Long bias')}</option>
                <option value="SHORT">{w('Short bias')}</option>
              </select></label>
              <div className="field-block">
                <p className="muted">{w('Choose one or more methodologies')}</p>
                {methodRow}
              </div>
              <div className="field-block">
                <p className="muted">{w('Markets')}</p>
                <div className="chip-list">
                  {SUPPORTED_INSTRUMENT_SYMBOLS.map((instrument) => (
                    <button
                      key={instrument}
                      type="button"
                      className={`chip ${selectedInstruments.includes(instrument) ? 'selected' : ''}`}
                      onClick={() => setSelectedInstruments((current) => current.includes(instrument) ? current.filter((value) => value !== instrument) : [...current, instrument])}
                    >
                      {instrument}
                    </button>
                  ))}
                </div>
              </div>
              <div className="button-row"><button type="button" onClick={onCancel}>{w('Back')}</button><button type="button" className="primary" onClick={() => setStep(2)}>{w('Continue')}</button></div>
            </div>
          )}

          {step === 2 && (
            <div className="builder-step">
              <h3>{w('Step 2 — When You Trade')}</h3>
              <div className="field-block">
                <p className="muted">{w('Sessions')}</p>
                <div className="chip-list">
                  {['London', 'New York', 'Sydney', 'Tokyo'].map((session) => (
                    <button
                      key={session}
                      type="button"
                      className={`chip ${sessions.includes(session) ? 'selected' : ''}`}
                      onClick={() => setSessions((current) => current.includes(session) ? current.filter((value) => value !== session) : [...current, session])}
                    >
                      {session}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-2">
                <label>{w('Execution timeframe')}<select value={executionTimeframe} onChange={(event) => setExecutionTimeframe(event.target.value)}>
                  {['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'].map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                </select></label>
                <label>{w('Context timeframe')}<select value={contextTimeframe} onChange={(event) => setContextTimeframe(event.target.value)}>
                  {['H1', 'H4', 'D1', 'W1'].map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                </select></label>
              </div>
              <div className="button-row"><button type="button" onClick={() => setStep(1)}>{w('Back')}</button><button type="button" className="primary" onClick={() => setStep(3)}>{w('Continue')}</button></div>
            </div>
          )}

          {step === 3 && (
            <div className="builder-step">
              <h3>{w('Step 3 — Your Setup')}</h3>
              <div className="field-block">
                <p className="muted">{w('Choose rule subsets from each selected methodology')}</p>
                {selectedLibraries.map((library) => (
                  <div key={library.id} className="card methodology-card">
                    <strong>{w(library.label)}</strong>
                    <div className="rule-list">
                      {library.rules.map((rule) => {
                        const selected = canonicalRuleSelections.some((item) => item.key === rule.key);
                        const currentSelection = canonicalRuleSelections.find((item) => item.key === rule.key);
                        return (
                          <div key={rule.key} className={`rule-row ${selected ? 'selected' : ''}`}>
                            <div className="rule-main">
                              <button type="button" className={`chip ${selected ? 'selected' : ''}`} onClick={() => toggleRuleSelection(rule.key)}>{w(rule.label)}</button>
                              <span className={`capability-pill ${capabilityTone[rule.capability]}`}>{rule.capability}</span>
                            </div>
                            {selected && currentSelection && (
                              <div className="rule-controls">
                                <select value={currentSelection.requirement} onChange={(event) => updateRuleSelection(rule.key, { requirement: event.target.value as 'REQUIRED' | 'OPTIONAL' })}>
                                  <option value="REQUIRED">{w('Required')}</option>
                                  <option value="OPTIONAL">{w('Optional')}</option>
                                </select>
                                <select value={currentSelection.group} onChange={(event) => updateRuleSelection(rule.key, { group: event.target.value as RuleGroupType })}>
                                  <option value="ALL">{w('All of these must be true')}</option>
                                  <option value="ANY">{w('Any of these can be true')}</option>
                                </select>
                                <select value={currentSelection.timeframe} onChange={(event) => updateRuleSelection(rule.key, { timeframe: event.target.value })}>
                                  {['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'].map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                                </select>
                                <div className="menu-wrap">
                                  <button type="button" className="menu-trigger" onClick={() => setRuleMenuOpen(rule.key === ruleMenuOpen ? null : rule.key)}>•••</button>
                                  {ruleMenuOpen === rule.key && (
                                    <div className="menu-panel">
                                      <button type="button" onClick={() => updateRuleSelection(rule.key, { requirement: 'REQUIRED' })}>{w('Set as required')}</button>
                                      <button type="button" onClick={() => updateRuleSelection(rule.key, { requirement: 'OPTIONAL' })}>{w('Set as optional')}</button>
                                      <button type="button" onClick={() => setSelectedRuleSelections((current) => reconcileRuleSelectionsWithMethodologies({
                                        methodologyIds: selectedMethodologyIds,
                                        ruleSelections: current.filter((item) => item.key !== rule.key),
                                      }))}>{w('Remove rule')}</button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="button-row"><button type="button" onClick={() => setStep(2)}>{w('Back')}</button><button type="button" className="primary" onClick={() => setStep(4)}>{w('Continue')}</button></div>
            </div>
          )}

          {step === 4 && (
            <div className="builder-step">
              <h3>{w('Step 4 — Risk & Management')}</h3>
              <div className="grid grid-2">
                <label>{w('Risk %')}<input type="number" value={riskPercent} min={0.1} max={10} step={0.1} onChange={(event) => setRiskPercent(Number(event.target.value))} /></label>
                <label>{w('Minimum RR')}<input type="number" value={minimumRR} min={1} step={0.5} onChange={(event) => setMinimumRR(Number(event.target.value))} /></label>
                <label>{w('Stop logic')}<input value={stopLogic} onChange={(event) => setStopLogic(event.target.value)} /></label>
                <label>{w('Target logic')}<input value={targetLogic} onChange={(event) => setTargetLogic(event.target.value)} /></label>
              </div>
              <div className="button-row"><button type="button" onClick={() => setStep(3)}>{w('Back')}</button><button type="button" className="primary" onClick={() => setStep(5)}>{w('Continue')}</button></div>
            </div>
          )}

          {step === 5 && (
            <div className="builder-step">
              <h3>{w('Step 5 — Review & Activate')}</h3>
              <div className="playbook-summary">
                <h4>{w('YOUR PLAYBOOK')}</h4>
                <div className="grid grid-2">
                  <div><span className="muted">{w('Markets')}</span><strong>{selectedInstruments.join(', ') || w('No instruments selected')}</strong></div>
                  <div><span className="muted">{w('Trading Window')}</span><strong>{sessions.join(' + ') || w('No sessions selected')}</strong></div>
                  <div><span className="muted">{w('Methodologies')}</span><strong>{selectedLibraries.map((library) => w(library.label)).join(' + ') || w('No methodology selected')}</strong></div>
                  <div><span className="muted">{w('Setup')}</span><strong>{selectedRulesText}</strong></div>
                  <div><span className="muted">{w('Risk')}</span><strong>{riskPercent}%</strong></div>
                  <div><span className="muted">{w('Minimum RR')}</span><strong>1:{minimumRR}</strong></div>
                </div>
                <pre>{JSON.stringify(draftSummary, null, 2)}</pre>
              </div>

              <div className="strategy-health-summary">
                <p className="eyebrow">{w('STRATEGY HEALTH')}</p>
                <h4>{health.totalRules} {w('rules configured')}</h4>
                <div className="grid grid-2">
                  {(['AUTOMATIC', 'MANUAL', 'EXTERNAL', 'DESCRIPTIVE'] as Capability[]).map((capability) => {
                    const count = canonicalRuleSelections.filter((rule) => {
                      const definition = allRulesByKey[rule.key];
                      return definition?.capability === capability;
                    }).length;
                    return (
                      <div key={capability} className={`capability-pill ${capabilityTone[capability]}`}>
                        <span>{w(capability)}</span>
                        <strong>{count}</strong>
                      </div>
                    );
                  })}
                </div>
                <p className="muted">{health.warningText}</p>
                {conflicts.length > 0 && (
                  <div className="warning-box">
                    {conflicts.map((conflict) => (
                      <p key={conflict.id}><strong>{conflict.severity}</strong> — {conflict.explanation}</p>
                    ))}
                  </div>
                )}
              </div>

              <label className="check-row">
                <input type="checkbox" checked={approvalConfirmed} onChange={(event) => setApprovalConfirmed(event.target.checked)} />
                <span>{w('I approve this strategy draft and understand the review warnings above.')}</span>
              </label>

              <div className="button-row">
                <button type="button" onClick={() => setStep(4)}>{w('Back')}</button>
                <button type="button" className="primary" onClick={() => { void buildVisualApply(); }} disabled={!approvalConfirmed || saving}>{w(saving ? 'Saving…' : 'Approve & Save')}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {path === 'copilot' && (
        <div className="strategy-v2-panel">
          <h3>{w('AI Strategy Copilot — Beta')}</h3>
          <p className="muted">{w('Describe how you trade in plain language. Trade Police turns your description into a structured draft that you can review and modify before applying.')}</p>
          <p className="muted small">{w('The deterministic trading engine remains authoritative. AI cannot activate or modify a strategy without your approval.')}</p>
          <textarea value={copilotInput} onChange={(event) => setCopilotInput(event.target.value)} rows={6} />
          <div className="button-row">
            <button type="button" onClick={() => setCopilotConversation((current) => [...current, { heading: 'You', text: copilotInput }])}>{w('Add note')}</button>
            <button type="button" className="primary" disabled={copilotBusy || !copilotInput.trim()} onClick={async () => {
              if (!copilotInput.trim()) return;
              setCopilotBusy(true);
              setCopilotConversation((current) => [...current, { heading: 'You', text: copilotInput }]);
              try {
                const response = await fetch('/api/strategy-copilot', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sessionId: copilotSessionId,
                    message: copilotInput,
                    previousDraft: copilotDraft,
                    previousCanonicalDraft: canonicalCopilotDraft,
                  }),
                });
                const payload = await response.json();
                if (!response.ok) {
                  throw new Error(payload?.error || 'AI draft unavailable');
                }
                const assessment = acceptCopilotPayload(payload, copilotInput);
                setCopilotConversation((current) => [
                  ...current,
                  { heading: 'Strategy Copilot', text: payload.message || 'Got it. I drafted the following strategy for review.' },
                  ...((Array.isArray(payload.changes) && payload.changes.length)
                    ? [{ heading: 'Changes detected', text: payload.changes.join(' • ') }]
                    : []),
                  ...(assessment.clarifications.length
                    ? [{ heading: 'Clarification needed', text: assessment.clarifications.map((item) => item.question).join(' • ') }]
                    : []),
                ]);
                setCopilotRefinementInput('');
                setCopilotReviewVisible(true);
                setCopilotApproved(false);
              } catch (error) {
                setCopilotConversation((current) => [...current, { heading: 'Strategy Copilot', text: error instanceof Error ? error.message : 'The copilot is unavailable right now.' }]);
              } finally {
                setCopilotBusy(false);
              }
            }}>{w(copilotBusy ? 'Thinking…' : 'Generate structured draft')}</button>
          </div>
          <div className="copilot-log">
            {copilotConversation.map((entry, index) => (
              <div key={`${entry.heading}-${index}`} className="copilot-message">
                <strong>{entry.heading}</strong>
                <p>{entry.text}</p>
              </div>
            ))}
          </div>

          {copilotDraft.rules.length > 0 && (
            <div className="strategy-v2-panel">
              <h4>{w('Refine your strategy')}</h4>
              <p className="muted">{w('Add more detail to adjust the draft without restarting the flow.')}</p>
              <textarea value={copilotRefinementInput} onChange={(event) => setCopilotRefinementInput(event.target.value)} rows={4} placeholder="Add XAUUSD, London and New York sessions, require a liquidity sweep, FVG minimum 8 points, and minimum risk of 0.5%." />
              <div className="button-row">
                <button type="button" onClick={() => setCopilotReviewVisible((current) => !current)}>{w(copilotReviewVisible ? 'Hide review' : 'Review draft')}</button>
                <button type="button" className="primary" disabled={copilotBusy || !copilotRefinementInput.trim()} onClick={async () => {
                  if (!copilotRefinementInput.trim()) return;
                  setCopilotBusy(true);
                  try {
                    const response = await fetch('/api/strategy-copilot', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        sessionId: copilotSessionId,
                        message: copilotRefinementInput,
                        previousDraft: copilotDraft,
                        previousCanonicalDraft: canonicalCopilotDraft,
                      }),
                    });
                    const payload = await response.json();
                    if (!response.ok) {
                      throw new Error(payload?.error || 'AI refinement unavailable');
                    }
                    const assessment = acceptCopilotPayload(payload, copilotRefinementInput);
                    setCopilotConversation((current) => [
                      ...current,
                      { heading: 'You', text: copilotRefinementInput },
                      { heading: 'Strategy Copilot', text: payload.message || 'I updated the draft to reflect your refinement.' },
                      ...(assessment.clarifications.length
                        ? [{ heading: 'Clarification needed', text: assessment.clarifications.map((item) => item.question).join(' • ') }]
                        : []),
                    ]);
                    setCopilotRefinementInput('');
                    setCopilotReviewVisible(true);
                    setCopilotApproved(false);
                  } catch (error) {
                    setCopilotConversation((current) => [...current, { heading: 'Strategy Copilot', text: error instanceof Error ? error.message : 'The draft could not be updated.' }]);
                  } finally {
                    setCopilotBusy(false);
                  }
                }}>{w('Apply / Update Draft')}</button>
              </div>
            </div>
          )}

          {copilotReviewVisible && copilotDraft.rules.length > 0 && (
            <div className="draft-review-panel">
              <h4>{w('Draft summary')}</h4>
              <div className="grid grid-2">
                <div><span className="muted">{w('Instrument')}</span><strong>{copilotDraft.instrument ?? w('Not set')}</strong></div>
                <div><span className="muted">{w('Session')}</span><strong>{copilotDraft.sessions.join(' + ') || w('Not set')}</strong></div>
                <div><span className="muted">{w('Risk')}</span><strong>{typeof copilotDraft.riskPercent === 'number' ? `${copilotDraft.riskPercent}%` : w('Not set')}</strong></div>
                <div><span className="muted">{w('Minimum RR')}</span><strong>{typeof copilotDraft.minimumRR === 'number' ? `1:${copilotDraft.minimumRR}` : w('Not set')}</strong></div>
              </div>
              <div className="rule-list">
                {copilotDraft.rules.map((rule) => (
                  <div key={rule.key} className="rule-row">
                    <div className="rule-main">
                      <strong>{w(rule.label)}</strong>
                      <span className={`capability-pill ${capabilityTone[rule.capability]}`}>{rule.requirement}</span>
                    </div>
                    <div className="rule-controls">
                      <span>{rule.group}</span>
                      <span>{rule.timeframe}</span>
                      <span>{rule.capability}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="muted">{w('Logic')}: {copilotDraft.logicTree.children.length ? copilotDraft.logicTree.logic : 'ALL'}{copilotDraft.logicTree.children.length ? ` (${copilotDraft.logicTree.children.join(', ')})` : ''}</p>
            </div>
          )}

          {copilotDraft.rules.length > 0 && (
            <div>
              <label>{w('Strategy name')}<input value={strategyName} onChange={event=>{const name=event.target.value;setStrategyName(name);setCanonicalCopilotDraft(current=>updateCanonicalCreationDraft(current,{name},{name:'EXPLICIT'}));setCopilotApproved(false);setCopilotApplyError('');}} placeholder={w('Name this strategy')} /></label>
              <div className="grid grid-2"><label>{w('Context timeframe')}<select value={contextTimeframe} onChange={event=>{const value=event.target.value;setContextTimeframe(value);setCanonicalCopilotDraft(current=>updateCanonicalCreationDraft(current,{contextTimeframe:value||undefined},{contextTimeframe:'EXPLICIT'}));setCopilotApproved(false);}}><option value="">{w('Choose context timeframe')}</option>{['H1','H4','D1','W1'].map(value=><option key={value}>{value}</option>)}</select></label><label>{w('Execution timeframe')}<select value={executionTimeframe} onChange={event=>{const value=event.target.value;setExecutionTimeframe(value);setCanonicalCopilotDraft(current=>updateCanonicalCreationDraft(current,{executionTimeframe:value||undefined},{executionTimeframe:'EXPLICIT'}));setCopilotApproved(false);}}><option value="">{w('Choose execution timeframe')}</option>{['M1','M5','M15','M30','H1','H4','D1'].map(value=><option key={value}>{value}</option>)}</select></label></div>
              {copilotApplyError && <p className="warning">{copilotApplyError}</p>}
              <div className="button-row">
                <button type="button" onClick={() => setPath('copilot')}>{w('Back')}</button>
                <button type="button" className="primary" disabled={!copilotDraft.rules.length || copilotBusy || !copilotApproved || canonicalCopilotDraft.state !== 'CONFIRMED'} onClick={() => {
                  if (!copilotApproved) return;
                  buildCopilotApply();
                }}>{w('Approve & Apply')}</button>
              </div>
              <label className="check-row">
                <input type="checkbox" checked={copilotApproved} onChange={(event) => {
                  if (!event.target.checked) {
                    setCopilotApproved(false);
                    setCanonicalCopilotDraft((current) => updateCanonicalCreationDraft(current, {}));
                    return;
                  }
                  try {
                    const confirmed = confirmCanonicalCreationDraft(canonicalCopilotDraft);
                    setCanonicalCopilotDraft(confirmed);
                    setCopilotApproved(true);
                    setCopilotApplyError('');
                  } catch (error) {
                    setCopilotApproved(false);
                    setCopilotApplyError(error instanceof Error ? error.message : 'Resolve the required clarification before approval.');
                  }
                }} />
                <span>{w('I review and explicitly approve this draft before applying it to the deterministic engine.')}</span>
              </label>
            </div>
          )}
        </div>
      )}

      {path === 'methodology' && (
        <div className="strategy-v2-panel">
          <h3>{w('Start From a Methodology')}</h3>
          <p className="muted">{w('Select a methodology library, then keep only the concepts you actually use.')}</p>
          {methodRow}
          <div className="button-row">
            <button type="button" onClick={() => setPath('advanced')}>{w('Back')}</button>
            <button type="button" className="primary" onClick={() => {
              setSelectedRuleSelections((current) => buildDraftFromSelection(selectedMethodologyIds, current.map((rule) => rule.key), current).rules);
              setPath('visual');
              setStep(1);
            }}>{w('Apply methodology set')}</button>
          </div>
        </div>
      )}

      {path === 'blank' && (
        <div className="strategy-v2-panel">
          <h3>{w('Start Blank')}</h3>
          <p className="muted">{w('Open the established builder and build the strategy from a blank configuration.')}</p>
          <div className="button-row">
            <button type="button" onClick={() => setPath('advanced')}>{w('Back')}</button>
            <button type="button" className="primary" onClick={() => {
              setPath('visual');
              setStep(1);
            }}>{w('Continue with blank builder')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
