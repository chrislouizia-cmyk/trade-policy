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
import { type StrategyBuilderV2State, type V2Persisted } from '@/lib/strategy-builder-v2-persistence';
import { emptyStrategyCopilotDraft, type StrategyCopilotDraft } from '@/lib/strategy-copilot';
import { mapCopilotReplyToCanonicalCreation } from '@/lib/strategy-copilot-creation';
import {
  assessCanonicalCreationDraft,
  createCanonicalCreationDraft,
  updateCanonicalCreationDraft,
  type CanonicalCreationAssessment,
  type CanonicalCreationDraft,
} from '@/lib/strategy-creation-contract';
import {
  buildCanonicalStrategyReview,
  canonicalDraftForVisibleV2Review,
  confirmCanonicalStrategyReview,
  persistedStrategyFromCurrentReview,
  type CanonicalReviewConfirmation,
} from '@/lib/strategy-creation-review';
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

const capabilityCopy: Record<Capability, string> = {
  AUTOMATIC: 'Checked by Trade Police',
  MANUAL: 'Confirmed by you',
  EXTERNAL: 'Checked from connected data',
  DESCRIPTIVE: 'Context only',
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
    { heading: 'Trade Police', text: 'Tell me how you trade. I’ll organize it so you can review and refine it.' },
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
  const [copilotConfirmation, setCopilotConfirmation] = useState<CanonicalReviewConfirmation | null>(null);
  const [copilotApplyError, setCopilotApplyError] = useState('');
  const [visualConfirmation, setVisualConfirmation] = useState<CanonicalReviewConfirmation | null>(null);
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
    setSelectedMethodologyIds([...defaultMethodologies]); setSelectedInstruments([]); setSessions([]); setContextTimeframe('H1'); setExecutionTimeframe('M15'); setSelectedRuleSelections(createDefaultRuleSelection()); setRiskPercent(0.5); setMinimumRR(3); setStopLogic(''); setTargetLogic(''); setDirection('BOTH'); setVisualConfirmation(null);
  }
  function initializeCopilotMode() {
    setSelectedMethodologyIds([]); setSelectedInstruments([]); setSessions([]); setContextTimeframe(''); setExecutionTimeframe(''); setSelectedRuleSelections([]); setRiskPercent(0); setMinimumRR(0); setStopLogic(''); setTargetLogic(''); setDirection('BOTH'); setStrategyName(''); setCopilotInput(''); setCopilotDraft(emptyStrategyCopilotDraft()); setCanonicalCopilotDraft(createCanonicalCreationDraft({ intent: mode, ...(mode === 'EDIT' && profile.id ? { strategyId: profile.id } : {}) })); setCopilotReviewVisible(false); setCopilotConfirmation(null); setCopilotRefinementInput('');
  }
  function initializeMethodologyMode() { setSelectedMethodologyIds([]); setSelectedInstruments([]); setSessions([]); setSelectedRuleSelections([]); setStopLogic(''); setTargetLogic(''); setVisualConfirmation(null); }
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
    setCopilotConfirmation(null);
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
    if (!visualConfirmation || saving) return;
    setSaving(true);
    try {
      const draft = canonicalDraftForVisibleV2Review({ intent: mode, ...(mode === 'EDIT' && profile.id ? { strategyId: profile.id } : {}), values: currentState() });
      await onApply(persistedStrategyFromCurrentReview(profile, draft, visualConfirmation));
    } catch (error) {
      setCopilotApplyError(error instanceof Error ? error.message : 'Review the current strategy before saving.');
      setVisualConfirmation(null);
    } finally {
      setSaving(false);
    }
  }

  async function buildCopilotApply() {
    const assessment = assessCanonicalCreationDraft(canonicalCopilotDraft);
    if (!assessment.canPersist) {
      setCopilotApplyError(assessment.clarifications[0]?.question ?? 'Review and confirm the canonical strategy draft before applying it.');
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      setCopilotApplyError('');
      await onApply(persistedStrategyFromCurrentReview(profile, canonicalCopilotDraft, copilotConfirmation));
    } catch (error) {
      setCopilotApplyError(error instanceof Error ? error.message : 'The canonical strategy draft could not be applied.');
      setCopilotConfirmation(null);
    } finally {
      setSaving(false);
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
  const visualReviewDraft = canonicalDraftForVisibleV2Review({ intent: mode, ...(mode === 'EDIT' && profile.id ? { strategyId: profile.id } : {}), values: currentState() });
  const visualReview = (() => { try { return buildCanonicalStrategyReview(profile, visualReviewDraft); } catch { return null; } })();
  const copilotReview = (() => { try { return buildCanonicalStrategyReview(profile, canonicalCopilotDraft); } catch { return null; } })();
  const copilotAssessment = assessCanonicalCreationDraft(canonicalCopilotDraft);
  const visualReviewCurrent = Boolean(visualConfirmation && visualReview?.fingerprint === visualConfirmation.review.fingerprint);
  const copilotReviewCurrent = Boolean(copilotConfirmation && copilotReview?.fingerprint === copilotConfirmation.review.fingerprint);

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
                  {[['LONDON','London'],['NEW_YORK','New York'],['SYDNEY','Sydney'],['TOKYO','Tokyo']].map(([session, label]) => (
                    <button
                      key={session}
                      type="button"
                      className={`chip ${sessions.includes(session) ? 'selected' : ''}`}
                      onClick={() => setSessions((current) => current.includes(session) ? current.filter((value) => value !== session) : [...current, session])}
                    >
                      {w(label)}
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
                <p><strong>{visualReview?.operation === 'UPDATE' ? w('Update selected strategy') : w('Create new strategy')}</strong> · {visualReview?.activationIntent === 'ACTIVATE' ? w('Save and activate') : w('Save without activation')}</p>
                <div className="grid grid-2">
                  <div><span className="muted">{w('Markets')}</span><strong>{selectedInstruments.join(', ') || w('No instruments selected')}</strong></div>
                  <div><span className="muted">{w('Trading Window')}</span><strong>{sessions.join(' + ') || w('No sessions selected')}</strong></div>
                  <div><span className="muted">{w('Methodologies')}</span><strong>{selectedLibraries.map((library) => w(library.label)).join(' + ') || w('No methodology selected')}</strong></div>
                  <div><span className="muted">{w('Setup')}</span><strong>{selectedRulesText}</strong></div>
                  <div><span className="muted">{w('Risk')}</span><strong>{riskPercent}%</strong></div>
                  <div><span className="muted">{w('Minimum RR')}</span><strong>1:{minimumRR}</strong></div>
                </div>
                <p className="muted">{w('Rule relationships')}: {draftSummary.logic} · {w('Required and optional conditions are shown below.')}</p>
                <div className="rule-list">{visualReview?.conditions.map((condition)=><div className="rule-row" key={condition.key}><div className="rule-main"><strong>{w(condition.label)}</strong><span className={`capability-pill ${capabilityTone[condition.capability]}`}>{w(condition.requirement)}</span></div><div className="rule-controls"><span>{condition.relationship}</span><span>{condition.timeframe}</span><span>{condition.capability}</span></div></div>)}</div>
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
                <input type="checkbox" checked={visualReviewCurrent} onChange={(event) => {
                  if (!event.target.checked) return setVisualConfirmation(null);
                  try { setVisualConfirmation(confirmCanonicalStrategyReview(profile, visualReviewDraft)); setCopilotApplyError(''); }
                  catch (error) { setVisualConfirmation(null); setCopilotApplyError(error instanceof Error ? error.message : 'Resolve required clarification before confirmation.'); }
                }} />
                <span>{w('I confirm this exact strategy, its rule relationships, risk, and activation intent.')}</span>
              </label>
              {copilotApplyError && <p className="warning">{copilotApplyError}</p>}

              <div className="button-row">
                <button type="button" onClick={() => setStep(4)}>{w('Back')}</button>
                <button type="button" className="primary" onClick={() => { void buildVisualApply(); }} disabled={!visualReviewCurrent || saving}>{w(saving ? 'Saving…' : visualReview?.operation === 'UPDATE' ? 'Confirm & Update' : 'Confirm & Save')}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {path === 'copilot' && (
        <div className="strategy-v2-panel">
          <p className="eyebrow">{w('DESCRIBE YOUR STRATEGY')}</p>
          <h3>{w('How do you trade?')}</h3>
          <p className="muted">{w('Explain it in your own words. Trade Police will organize it and ask only for details that are still needed.')}</p>
          <label>{w('Your trading approach')}<textarea value={copilotInput} onChange={(event) => setCopilotInput(event.target.value)} rows={6} placeholder={w('Describe what you trade, when you trade, what confirms an entry, and how you manage risk.')} /></label>
          <div className="button-row">
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
                acceptCopilotPayload(payload, copilotInput);
                setCopilotConversation((current) => [
                  ...current,
                  { heading: 'Trade Police', text: payload.message || 'Got it. I organized your strategy for review.' },
                  ...((Array.isArray(payload.changes) && payload.changes.length)
                    ? [{ heading: 'Changes detected', text: payload.changes.join(' • ') }]
                    : []),
                ]);
                setCopilotRefinementInput('');
                setCopilotReviewVisible(true);
                setCopilotConfirmation(null);
              } catch (error) {
                setCopilotConversation((current) => [...current, { heading: 'Trade Police', text: error instanceof Error ? error.message : 'I could not structure the strategy right now.' }]);
              } finally {
                setCopilotBusy(false);
              }
            }}>{w(copilotBusy ? 'Understanding your strategy…' : 'Help me structure it')}</button>
          </div>
          <div className="copilot-log">
            {copilotConversation.map((entry, index) => (
              <div key={`${entry.heading}-${index}`} className="copilot-message">
                <strong>{w(entry.heading)}</strong>
                <p>{w(entry.text)}</p>
              </div>
            ))}
          </div>

          {copilotReviewVisible && (
            <div className="strategy-v2-panel">
              <h4>{w('Anything to correct or add?')}</h4>
              <p className="muted">{w('Tell Trade Police what to change. You do not need to start over.')}</p>
              <textarea value={copilotRefinementInput} onChange={(event) => setCopilotRefinementInput(event.target.value)} rows={4} placeholder={w('Example: Add another session, change my risk, or make a condition optional.')} />
              <div className="button-row">
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
                    acceptCopilotPayload(payload, copilotRefinementInput);
                    setCopilotConversation((current) => [
                      ...current,
                      { heading: 'You', text: copilotRefinementInput },
                      { heading: 'Trade Police', text: payload.message || 'I updated what I understood from your strategy.' },
                    ]);
                    setCopilotRefinementInput('');
                    setCopilotReviewVisible(true);
                    setCopilotConfirmation(null);
                  } catch (error) {
                    setCopilotConversation((current) => [...current, { heading: 'Trade Police', text: error instanceof Error ? error.message : 'I could not update the strategy right now.' }]);
                  } finally {
                    setCopilotBusy(false);
                  }
                }}>{w('Update what Trade Police understood')}</button>
              </div>
            </div>
          )}

          {copilotReviewVisible && (
            <div className="draft-review-panel">
              <p className="eyebrow">{w('YOUR REVIEW')}</p>
              <h4>{w('Review what Trade Police understood')}</h4>
              <p className="muted">{w('Correct anything above first. Confirm only when this matches how you intend to trade.')}</p>
              <p><strong>{copilotReview?.operation === 'UPDATE' ? w('Update selected strategy') : w('Create new strategy')}</strong> · {copilotReview?.activationIntent === 'ACTIVATE' ? w('Save and activate') : w('Save without activation')}</p>
              <label>{w('Strategy name')}<input value={strategyName} onChange={event=>{const name=event.target.value;setStrategyName(name);setCanonicalCopilotDraft(current=>updateCanonicalCreationDraft(current,{name},{name:'EXPLICIT'}));setCopilotConfirmation(null);setCopilotApplyError('');}} placeholder={w('Name this strategy')} /></label>
              <div className="grid grid-2"><label>{w('Context timeframe')}<select value={contextTimeframe} onChange={event=>{const value=event.target.value;setContextTimeframe(value);setCanonicalCopilotDraft(current=>updateCanonicalCreationDraft(current,{contextTimeframe:value||undefined},{contextTimeframe:'EXPLICIT'}));setCopilotConfirmation(null);}}><option value="">{w('Choose context timeframe')}</option>{['H1','H4','D1','W1'].map(value=><option key={value}>{value}</option>)}</select></label><label>{w('Execution timeframe')}<select value={executionTimeframe} onChange={event=>{const value=event.target.value;setExecutionTimeframe(value);setCanonicalCopilotDraft(current=>updateCanonicalCreationDraft(current,{executionTimeframe:value||undefined},{executionTimeframe:'EXPLICIT'}));setCopilotConfirmation(null);}}><option value="">{w('Choose execution timeframe')}</option>{['M1','M5','M15','M30','H1','H4','D1'].map(value=><option key={value}>{value}</option>)}</select></label></div>
              <div className="grid grid-2">
                <div><span className="muted">{w('Markets')}</span><strong>{canonicalCopilotDraft.values.instruments.join(', ') || w('Not set')}</strong></div>
                <div><span className="muted">{w('Direction')}</span><strong>{canonicalCopilotDraft.values.direction ? w(canonicalCopilotDraft.values.direction) : w('Not set')}</strong></div>
                <div><span className="muted">{w('Sessions')}</span><strong>{canonicalCopilotDraft.values.sessions.join(' + ') || w('Not set')}</strong></div>
                <div><span className="muted">{w('Risk per trade')}</span><strong>{canonicalCopilotDraft.values.riskPercent ? `${canonicalCopilotDraft.values.riskPercent}%` : w('Not set')}</strong></div>
                <div><span className="muted">{w('Minimum RR')}</span><strong>{canonicalCopilotDraft.values.minimumRR ? `1:${canonicalCopilotDraft.values.minimumRR}` : w('Not set')}</strong></div>
                {copilotReview?.stopLogic ? <div><span className="muted">{w('Stop logic')}</span><strong>{copilotReview.stopLogic}</strong></div> : null}
                {copilotReview?.targetLogic ? <div><span className="muted">{w('Target logic')}</span><strong>{copilotReview.targetLogic}</strong></div> : null}
              </div>
              {copilotAssessment.clarifications.length > 0 ? <div className="warning-box" role="status"><strong>{w('A few details are still needed')}</strong>{copilotAssessment.clarifications.map((item)=><p key={`${item.code}-${item.field??'general'}`}>{w(item.question)}</p>)}</div> : null}
              <h4>{w('Trading conditions')}</h4>
              <div className="rule-list">
                {canonicalCopilotDraft.values.ruleSelections.map((rule) => (
                  <div key={rule.key} className="rule-row">
                    <div className="rule-main">
                      <strong>{w(rule.label)}</strong>
                      <span className={`capability-pill ${capabilityTone[rule.capability]}`}>{w(rule.requirement === 'REQUIRED' ? 'Required' : 'Optional')}</span>
                    </div>
                    <div className="rule-controls">
                      <span>{w(rule.group === 'ALL' ? 'All required conditions must be met' : 'One of these alternatives may be enough')}</span>
                      <span>{rule.timeframe}</span>
                      <span>{w(capabilityCopy[rule.capability])}</span>
                    </div>
                  </div>
                ))}
                {canonicalCopilotDraft.values.ruleSelections.length === 0 ? <p className="muted">{w('No trading conditions understood yet.')}</p> : null}
              </div>
              {copilotApplyError && <p className="warning">{copilotApplyError}</p>}
              {copilotAssessment.canReview ? <label className="check-row">
                <input type="checkbox" checked={copilotReviewCurrent} onChange={(event) => {
                  if (!event.target.checked) {
                    setCopilotConfirmation(null);
                    setCanonicalCopilotDraft((current) => updateCanonicalCreationDraft(current, {}));
                    return;
                  }
                  try {
                    const confirmation = confirmCanonicalStrategyReview(profile, canonicalCopilotDraft);
                    setCanonicalCopilotDraft(confirmation.confirmedDraft);
                    setCopilotConfirmation(confirmation);
                    setCopilotApplyError('');
                  } catch (error) {
                    setCopilotConfirmation(null);
                    setCopilotApplyError(error instanceof Error ? error.message : 'Resolve the required clarification before approval.');
                  }
                }} />
                <span>{w('This matches how I trade, including the risk and whether it will be active.')}</span>
              </label> : null}
              <div className="button-row">
                <button type="button" onClick={onCancel}>{w('Cancel')}</button>
                <button type="button" className="primary" disabled={copilotBusy || saving || !copilotReviewCurrent} onClick={() => {
                  if (!copilotReviewCurrent) return;
                  void buildCopilotApply();
                }}>{w(saving ? 'Saving…' : copilotReview?.operation === 'UPDATE' ? 'Save changes' : copilotReview?.activationIntent === 'ACTIVATE' ? 'Save and activate' : 'Save strategy')}</button>
              </div>
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
