'use client';

import { useMemo, useState } from 'react';
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
  type Capability,
  type RuleGroupType,
  type RuleSelection,
} from '@/lib/strategy-builder-v2';
import { v2StateToPersistedStrategy, type StrategyBuilderV2State, type V2Persisted } from '@/lib/strategy-builder-v2-persistence';
import { emptyStrategyCopilotDraft, type StrategyCopilotDraft } from '@/lib/strategy-copilot';

type CreationPath = 'visual' | 'copilot' | 'methodology' | 'blank';
type StepKey = 1 | 2 | 3 | 4 | 5;
const SESSION_CODES: Record<string, string> = { London: 'LONDON', 'New York': 'NEW_YORK', LONDON: 'LONDON', NEW_YORK: 'NEW_YORK' };

const CREATION_MODE_SEQUENCE: CreationPath[] = ['visual', 'copilot', 'methodology', 'blank'];

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
  onApply,
  onCancel,
}: {
  profile: StrategyProfile;
  initialState?: StrategyBuilderV2State;
  onApply: (persisted: V2Persisted) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState<CreationPath | null>(null);
  const [step, setStep] = useState<StepKey>(1);
  const [selectedMethodologyIds, setSelectedMethodologyIds] = useState<string[]>(initialState?.methodologyIds ?? []);
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>(initialState?.instruments ?? []);
  const [direction, setDirection] = useState<'LONG' | 'SHORT' | 'BOTH'>(initialState?.direction ?? 'BOTH');
  const [sessions, setSessions] = useState<string[]>(initialState?.sessions ?? []);
  const [contextTimeframe, setContextTimeframe] = useState<string>(initialState?.contextTimeframe ?? '');
  const [executionTimeframe, setExecutionTimeframe] = useState<string>(initialState?.executionTimeframe ?? '');
  const [selectedRuleSelections, setSelectedRuleSelections] = useState<RuleSelection[]>(() => initialState?.ruleSelections ?? []);
  const [riskPercent, setRiskPercent] = useState<number>(initialState?.riskPercent ?? 0);
  const [minimumRR, setMinimumRR] = useState<number>(initialState?.minimumRR ?? 0);
  const [stopLogic, setStopLogic] = useState<string>(typeof initialState?.stopLogic === 'string' ? initialState.stopLogic : '');
  const [targetLogic, setTargetLogic] = useState<string>(typeof initialState?.targetLogic === 'string' ? initialState.targetLogic : '');
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotConversation, setCopilotConversation] = useState<Array<{ heading: string; text: string }>>([
    { heading: 'Strategy Copilot', text: 'Tell me how you trade. I’ll turn it into a structured strategy draft you can review and refine.' },
  ]);
  const [copilotDraft, setCopilotDraft] = useState<StrategyCopilotDraft>(() => ({
    ...emptyStrategyCopilotDraft(),
    name: 'Draft from description',
    instrument: '',
    riskPercent: 0,
    minimumRR: 0,
  }));
  const [copilotRefinementInput, setCopilotRefinementInput] = useState('');
  const [copilotReviewVisible, setCopilotReviewVisible] = useState(false);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotApproved, setCopilotApproved] = useState(false);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [ruleMenuOpen, setRuleMenuOpen] = useState<string | null>(null);

  const allLibraries = METHODOLOGY_LIBRARY;
  const selectedLibraries = useMemo(
    () => allLibraries.filter((method) => selectedMethodologyIds.includes(method.id)),
    [allLibraries, selectedMethodologyIds],
  );

  const selectedRuleKeys = selectedRuleSelections.map((rule) => rule.key);
  const conflicts = useMemo(
    () => detectStrategyConflicts({ selectedRules: selectedRuleSelections, riskPercent, minimumRR }),
    [selectedRuleSelections, riskPercent, minimumRR],
  );
  const health = useMemo(
    () => buildHealthSummary({ selectedRules: selectedRuleSelections, conflicts }),
    [selectedRuleSelections, conflicts],
  );

  const allRulesByKey = useMemo(
    () => allLibraries.flatMap((library) => library.rules).reduce<Record<string, (typeof METHODOLOGY_LIBRARY)[number]['rules'][number]>>((acc, rule) => {
      acc[rule.key] = rule;
      return acc;
    }, {}),
    [allLibraries],
  );

  const selectedRulesText = formatRuleSummary(selectedRuleSelections);

  function initializeVisualMode() {
    setSelectedMethodologyIds([...defaultMethodologies]); setSelectedInstruments([]); setSessions([]); setContextTimeframe('H1'); setExecutionTimeframe('M15'); setSelectedRuleSelections(createDefaultRuleSelection()); setRiskPercent(0.5); setMinimumRR(3); setStopLogic(''); setTargetLogic(''); setDirection('BOTH'); setApprovalConfirmed(false);
  }
  function initializeCopilotMode() {
    setSelectedMethodologyIds([]); setSelectedInstruments([]); setSessions([]); setContextTimeframe(''); setExecutionTimeframe(''); setSelectedRuleSelections([]); setRiskPercent(0); setMinimumRR(0); setStopLogic(''); setTargetLogic(''); setDirection('BOTH'); setCopilotInput(''); setCopilotDraft({ ...emptyStrategyCopilotDraft(), name: 'Draft from description', instrument: '', riskPercent: 0, minimumRR: 0 }); setCopilotReviewVisible(false); setCopilotApproved(false);
  }
  function initializeMethodologyMode() { setSelectedMethodologyIds([]); setSelectedInstruments([]); setSessions([]); setSelectedRuleSelections([]); setStopLogic(''); setTargetLogic(''); setApprovalConfirmed(false); }
  function initializeBlankMode() { initializeCopilotMode(); }
  function enterMode(mode: CreationPath) { if (mode === 'visual') initializeVisualMode(); else if (mode === 'copilot') initializeCopilotMode(); else if (mode === 'methodology') initializeMethodologyMode(); else initializeBlankMode(); setPath(mode); setStep(1); }

  function currentState(overrides: Partial<StrategyBuilderV2State> = {}): StrategyBuilderV2State {
    return { instruments: selectedInstruments, sessions, contextTimeframe: contextTimeframe || undefined, executionTimeframe: executionTimeframe || undefined, methodologyIds: selectedMethodologyIds, ruleSelections: selectedRuleSelections, riskPercent, minimumRR, stopLogic: stopLogic || undefined, targetLogic: targetLogic || undefined, direction, ...overrides };
  }

  function syncSelectedRulesFromMethodologies(ids: string[], nextSelections: RuleSelection[]) {
    const allowedKeys = new Set(
      allLibraries
        .filter((library) => ids.includes(library.id))
        .flatMap((library) => library.rules.map((rule) => rule.key)),
    );
    setSelectedRuleSelections(nextSelections.filter((rule) => allowedKeys.has(rule.key)));
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
      setSelectedRuleSelections((current) => current.filter((rule) => rule.key !== ruleKey));
      return;
    }

    setSelectedRuleSelections((current) => [
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
    ]);
  }

  function updateRuleSelection(ruleKey: string, patch: Partial<RuleSelection>) {
    setSelectedRuleSelections((current) => current.map((rule) => rule.key === ruleKey ? { ...rule, ...patch } : rule));
  }

  function buildVisualApply() { onApply(v2StateToPersistedStrategy(profile, currentState())); }

  function buildCopilotApply() {
    const draftRules: RuleSelection[] = copilotDraft.rules.length ? copilotDraft.rules : createDefaultRuleSelection();
    const draftInstrument = copilotDraft.instrument && ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF', 'NAS100'].includes(copilotDraft.instrument)
      ? copilotDraft.instrument
      : (selectedInstruments[0] ?? 'XAUUSD');
    const draftSessions = copilotDraft.sessions.length ? copilotDraft.sessions : sessions;
    const draftRisk = typeof copilotDraft.riskPercent === 'number' ? copilotDraft.riskPercent : riskPercent;
    const draftMinimumRR = typeof copilotDraft.minimumRR === 'number' ? copilotDraft.minimumRR : minimumRR;

    setSelectedInstruments([draftInstrument]);
    setSessions(draftSessions.map((session) => session));
    setSelectedRuleSelections(draftRules);
    setRiskPercent(draftRisk);
    setMinimumRR(draftMinimumRR);

    onApply(v2StateToPersistedStrategy(profile, currentState({ instruments: [draftInstrument], sessions: draftSessions.map((value) => SESSION_CODES[value] ?? value), ruleSelections: draftRules, riskPercent: draftRisk, minimumRR: draftMinimumRR, methodologyIds: ['strategy-copilot'] })));
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
      setSelectedRuleSelections(nextRules);
    }
  }

  const stepRouter = (
    <div className="builder-step-tabs">
      {([1, 2, 3, 4, 5] as StepKey[]).map((value) => (
        <button key={value} type="button" className={step === value ? 'active' : ''} onClick={() => setStep(value)}>
          {value}. {STEP_LABELS[value]}
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
          {library.label}
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
          <p className="muted">NEW STRATEGY</p>
          <h2>Build a strategy without learning the engine schema</h2>
          <p>Trade Police turns your trading style into a structured, reviewable playbook.</p>
        </div>
      </div>

      <div className="button-row" aria-label="Create strategy modes">
        {CREATION_MODE_SEQUENCE.map((mode) => (
          <button key={mode} type="button" onClick={() => enterMode(mode)}>
            {mode === 'visual' && 'Build visually'}
            {mode === 'copilot' && 'Describe your strategy — Beta'}
            {mode === 'methodology' && 'Start from a methodology'}
            {mode === 'blank' && 'Start blank'}
          </button>
        ))}
      </div>

      {!path && (
        <div className="strategy-v2-panel">
          <h3>Create Strategy</h3>
          <p className="muted">Choose how you want to begin. No mode opens automatically.</p>
        </div>
      )}

      {path === 'visual' && (
        <div className="strategy-v2-panel">
          {stepRouter}

          {step === 1 && (
            <div className="builder-step">
              <h3>Step 1 — Your Style</h3>
              <label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value as 'LONG' | 'SHORT' | 'BOTH')}>
                <option value="BOTH">Both</option>
                <option value="LONG">Long bias</option>
                <option value="SHORT">Short bias</option>
              </select></label>
              <div className="field-block">
                <p className="muted">Choose one or more methodologies</p>
                {methodRow}
              </div>
              <div className="field-block">
                <p className="muted">Markets</p>
                <div className="chip-list">
                  {['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'NAS100'].map((instrument) => (
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
              <div className="button-row"><button type="button" onClick={onCancel}>Back</button><button type="button" className="primary" onClick={() => setStep(2)}>Continue</button></div>
            </div>
          )}

          {step === 2 && (
            <div className="builder-step">
              <h3>Step 2 — When You Trade</h3>
              <div className="field-block">
                <p className="muted">Sessions</p>
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
                <label>Execution timeframe<select value={executionTimeframe} onChange={(event) => setExecutionTimeframe(event.target.value)}>
                  {['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'].map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                </select></label>
                <label>Context timeframe<select value={contextTimeframe} onChange={(event) => setContextTimeframe(event.target.value)}>
                  {['H1', 'H4', 'D1', 'W1'].map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                </select></label>
              </div>
              <div className="button-row"><button type="button" onClick={() => setStep(1)}>Back</button><button type="button" className="primary" onClick={() => setStep(3)}>Continue</button></div>
            </div>
          )}

          {step === 3 && (
            <div className="builder-step">
              <h3>Step 3 — Your Setup</h3>
              <div className="field-block">
                <p className="muted">Choose rule subsets from each selected methodology</p>
                {selectedLibraries.map((library) => (
                  <div key={library.id} className="card methodology-card">
                    <strong>{library.label}</strong>
                    <div className="rule-list">
                      {library.rules.map((rule) => {
                        const selected = selectedRuleSelections.some((item) => item.key === rule.key);
                        const currentSelection = selectedRuleSelections.find((item) => item.key === rule.key);
                        return (
                          <div key={rule.key} className={`rule-row ${selected ? 'selected' : ''}`}>
                            <div className="rule-main">
                              <button type="button" className={`chip ${selected ? 'selected' : ''}`} onClick={() => toggleRuleSelection(rule.key)}>{rule.label}</button>
                              <span className={`capability-pill ${capabilityTone[rule.capability]}`}>{rule.capability}</span>
                            </div>
                            {selected && currentSelection && (
                              <div className="rule-controls">
                                <select value={currentSelection.requirement} onChange={(event) => updateRuleSelection(rule.key, { requirement: event.target.value as 'REQUIRED' | 'OPTIONAL' })}>
                                  <option value="REQUIRED">Required</option>
                                  <option value="OPTIONAL">Optional</option>
                                </select>
                                <select value={currentSelection.group} onChange={(event) => updateRuleSelection(rule.key, { group: event.target.value as RuleGroupType })}>
                                  <option value="ALL">All of these must be true</option>
                                  <option value="ANY">Any of these can be true</option>
                                </select>
                                <select value={currentSelection.timeframe} onChange={(event) => updateRuleSelection(rule.key, { timeframe: event.target.value })}>
                                  {['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'].map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                                </select>
                                <div className="menu-wrap">
                                  <button type="button" className="menu-trigger" onClick={() => setRuleMenuOpen(rule.key === ruleMenuOpen ? null : rule.key)}>•••</button>
                                  {ruleMenuOpen === rule.key && (
                                    <div className="menu-panel">
                                      <button type="button" onClick={() => updateRuleSelection(rule.key, { requirement: 'REQUIRED' })}>Set as required</button>
                                      <button type="button" onClick={() => updateRuleSelection(rule.key, { requirement: 'OPTIONAL' })}>Set as optional</button>
                                      <button type="button" onClick={() => setSelectedRuleSelections((current) => current.filter((item) => item.key !== rule.key))}>Remove rule</button>
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
              <div className="button-row"><button type="button" onClick={() => setStep(2)}>Back</button><button type="button" className="primary" onClick={() => setStep(4)}>Continue</button></div>
            </div>
          )}

          {step === 4 && (
            <div className="builder-step">
              <h3>Step 4 — Risk & Management</h3>
              <div className="grid grid-2">
                <label>Risk %<input type="number" value={riskPercent} min={0.1} max={10} step={0.1} onChange={(event) => setRiskPercent(Number(event.target.value))} /></label>
                <label>Minimum RR<input type="number" value={minimumRR} min={1} step={0.5} onChange={(event) => setMinimumRR(Number(event.target.value))} /></label>
                <label>Stop logic<input value={stopLogic} onChange={(event) => setStopLogic(event.target.value)} /></label>
                <label>Target logic<input value={targetLogic} onChange={(event) => setTargetLogic(event.target.value)} /></label>
              </div>
              <div className="button-row"><button type="button" onClick={() => setStep(3)}>Back</button><button type="button" className="primary" onClick={() => setStep(5)}>Continue</button></div>
            </div>
          )}

          {step === 5 && (
            <div className="builder-step">
              <h3>Step 5 — Review & Activate</h3>
              <div className="playbook-summary">
                <h4>YOUR PLAYBOOK</h4>
                <div className="grid grid-2">
                  <div><span className="muted">Markets</span><strong>{selectedInstruments.join(', ') || 'No instruments selected'}</strong></div>
                  <div><span className="muted">Trading Window</span><strong>{sessions.join(' + ') || 'No sessions selected'}</strong></div>
                  <div><span className="muted">Methodologies</span><strong>{selectedLibraries.map((library) => library.label).join(' + ') || 'No methodology selected'}</strong></div>
                  <div><span className="muted">Setup</span><strong>{selectedRulesText}</strong></div>
                  <div><span className="muted">Risk</span><strong>{riskPercent}%</strong></div>
                  <div><span className="muted">Minimum RR</span><strong>1:{minimumRR}</strong></div>
                </div>
                <pre>{JSON.stringify(draftSummary, null, 2)}</pre>
              </div>

              <div className="strategy-health-summary">
                <p className="eyebrow">STRATEGY HEALTH</p>
                <h4>{health.totalRules} rules configured</h4>
                <div className="grid grid-2">
                  {(['AUTOMATIC', 'MANUAL', 'EXTERNAL', 'DESCRIPTIVE'] as Capability[]).map((capability) => {
                    const count = selectedRuleSelections.filter((rule) => {
                      const definition = allRulesByKey[rule.key];
                      return definition?.capability === capability;
                    }).length;
                    return (
                      <div key={capability} className={`capability-pill ${capabilityTone[capability]}`}>
                        <span>{capability}</span>
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
                <span>I approve this strategy draft and understand the review warnings above.</span>
              </label>

              <div className="button-row">
                <button type="button" onClick={() => setStep(4)}>Back</button>
                <button type="button" className="primary" onClick={buildVisualApply} disabled={!approvalConfirmed}>Approve & Save</button>
              </div>
            </div>
          )}
        </div>
      )}

      {path === 'copilot' && (
        <div className="strategy-v2-panel">
          <h3>AI Strategy Copilot — Beta</h3>
          <p className="muted">Describe how you trade in plain language. Trade Police turns your description into a structured draft that you can review and modify before applying.</p>
          <p className="muted small">The deterministic trading engine remains authoritative. AI cannot activate or modify a strategy without your approval.</p>
          <textarea value={copilotInput} onChange={(event) => setCopilotInput(event.target.value)} rows={6} />
          <div className="button-row">
            <button type="button" onClick={() => setCopilotConversation((current) => [...current, { heading: 'You', text: copilotInput }])}>Add note</button>
            <button type="button" className="primary" disabled={copilotBusy || !copilotInput.trim()} onClick={async () => {
              if (!copilotInput.trim()) return;
              setCopilotBusy(true);
              setCopilotConversation((current) => [...current, { heading: 'You', text: copilotInput }]);
              try {
                const response = await fetch('/api/strategy-copilot', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sessionId: 'strategy-builder-v2',
                    message: copilotInput,
                    previousDraft: copilotDraft,
                  }),
                });
                const payload = await response.json();
                if (!response.ok) {
                  throw new Error(payload?.error || 'AI draft unavailable');
                }
                const nextDraft = payload.strategyDraft ?? copilotDraft;
                setCopilotDraft(nextDraft);
                setSelectedInstruments(nextDraft.instrument ? [nextDraft.instrument] : selectedInstruments);
                setSessions(nextDraft.sessions.length ? nextDraft.sessions : sessions);
                setSelectedRuleSelections(nextDraft.rules.length ? nextDraft.rules : selectedRuleSelections);
                setRiskPercent(typeof nextDraft.riskPercent === 'number' ? nextDraft.riskPercent : riskPercent);
                setMinimumRR(typeof nextDraft.minimumRR === 'number' ? nextDraft.minimumRR : minimumRR);
                setCopilotConversation((current) => [
                  ...current,
                  { heading: 'Strategy Copilot', text: payload.message || 'Got it. I drafted the following strategy for review.' },
                  ...((Array.isArray(payload.changes) && payload.changes.length)
                    ? [{ heading: 'Changes detected', text: payload.changes.join(' • ') }]
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
            }}>{copilotBusy ? 'Thinking…' : 'Generate structured draft'}</button>
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
              <h4>Refine your strategy</h4>
              <p className="muted">Add more detail to adjust the draft without restarting the flow.</p>
              <textarea value={copilotRefinementInput} onChange={(event) => setCopilotRefinementInput(event.target.value)} rows={4} placeholder="Add XAUUSD, London and New York sessions, require a liquidity sweep, FVG minimum 8 points, and minimum risk of 0.5%." />
              <div className="button-row">
                <button type="button" onClick={() => setCopilotReviewVisible((current) => !current)}>{copilotReviewVisible ? 'Hide review' : 'Review draft'}</button>
                <button type="button" className="primary" disabled={copilotBusy || !copilotRefinementInput.trim()} onClick={async () => {
                  if (!copilotRefinementInput.trim()) return;
                  setCopilotBusy(true);
                  try {
                    const response = await fetch('/api/strategy-copilot', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        sessionId: 'strategy-builder-v2',
                        message: copilotRefinementInput,
                        previousDraft: copilotDraft,
                      }),
                    });
                    const payload = await response.json();
                    if (!response.ok) {
                      throw new Error(payload?.error || 'AI refinement unavailable');
                    }
                    const nextDraft = payload.strategyDraft ?? copilotDraft;
                    setCopilotDraft(nextDraft);
                    setSelectedInstruments(nextDraft.instrument ? [nextDraft.instrument] : selectedInstruments);
                    setSessions(nextDraft.sessions.length ? nextDraft.sessions : sessions);
                    setSelectedRuleSelections(nextDraft.rules.length ? nextDraft.rules : selectedRuleSelections);
                    setRiskPercent(typeof nextDraft.riskPercent === 'number' ? nextDraft.riskPercent : riskPercent);
                    setMinimumRR(typeof nextDraft.minimumRR === 'number' ? nextDraft.minimumRR : minimumRR);
                    setCopilotConversation((current) => [
                      ...current,
                      { heading: 'You', text: copilotRefinementInput },
                      { heading: 'Strategy Copilot', text: payload.message || 'I updated the draft to reflect your refinement.' },
                    ]);
                    setCopilotRefinementInput('');
                    setCopilotReviewVisible(true);
                    setCopilotApproved(false);
                  } catch (error) {
                    setCopilotConversation((current) => [...current, { heading: 'Strategy Copilot', text: error instanceof Error ? error.message : 'The draft could not be updated.' }]);
                  } finally {
                    setCopilotBusy(false);
                  }
                }}>Apply / Update Draft</button>
              </div>
            </div>
          )}

          {copilotReviewVisible && copilotDraft.rules.length > 0 && (
            <div className="draft-review-panel">
              <h4>Draft summary</h4>
              <div className="grid grid-2">
                <div><span className="muted">Instrument</span><strong>{copilotDraft.instrument ?? 'Not set'}</strong></div>
                <div><span className="muted">Session</span><strong>{copilotDraft.sessions.join(' + ') || 'Not set'}</strong></div>
                <div><span className="muted">Risk</span><strong>{typeof copilotDraft.riskPercent === 'number' ? `${copilotDraft.riskPercent}%` : 'Not set'}</strong></div>
                <div><span className="muted">Minimum RR</span><strong>{typeof copilotDraft.minimumRR === 'number' ? `1:${copilotDraft.minimumRR}` : 'Not set'}</strong></div>
              </div>
              <div className="rule-list">
                {copilotDraft.rules.map((rule) => (
                  <div key={rule.key} className="rule-row">
                    <div className="rule-main">
                      <strong>{rule.label}</strong>
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
              <p className="muted">Logic: {copilotDraft.logicTree.children.length ? copilotDraft.logicTree.logic : 'ALL'}{copilotDraft.logicTree.children.length ? ` (${copilotDraft.logicTree.children.join(', ')})` : ''}</p>
            </div>
          )}

          {copilotDraft.rules.length > 0 && (
            <div>
              <div className="button-row">
                <button type="button" onClick={() => setPath('copilot')}>Back</button>
                <button type="button" className="primary" disabled={!copilotDraft.rules.length || copilotBusy || !copilotApproved} onClick={() => {
                  if (!copilotApproved) return;
                  buildCopilotApply();
                }}>Approve & Apply</button>
              </div>
              <label className="check-row">
                <input type="checkbox" checked={copilotApproved} onChange={(event) => setCopilotApproved(event.target.checked)} />
                <span>I review and explicitly approve this draft before applying it to the deterministic engine.</span>
              </label>
            </div>
          )}
        </div>
      )}

      {path === 'methodology' && (
        <div className="strategy-v2-panel">
          <h3>Start From a Methodology</h3>
          <p className="muted">Select a methodology library, then keep only the concepts you actually use.</p>
          {methodRow}
          <div className="button-row">
            <button type="button" onClick={() => setPath('methodology')}>Back</button>
            <button type="button" className="primary" onClick={() => {
              setSelectedRuleSelections((current) => buildDraftFromSelection(selectedMethodologyIds, current.map((rule) => rule.key), current).rules);
              setPath('visual');
              setStep(1);
            }}>Apply methodology set</button>
          </div>
        </div>
      )}

      {path === 'blank' && (
        <div className="strategy-v2-panel">
          <h3>Start Blank</h3>
          <p className="muted">Open the established builder and build the strategy from a blank configuration.</p>
          <div className="button-row">
            <button type="button" onClick={() => setPath('blank')}>Back</button>
            <button type="button" className="primary" onClick={() => {
              setPath('visual');
              setStep(1);
            }}>Continue with blank builder</button>
          </div>
        </div>
      )}
    </div>
  );
}
