'use client';

import { useMemo, useState } from 'react';
import type { StrategyMethodology, StrategyProfile, StrategyRule } from '@/types/trade';
import {
  METHODOLOGY_LIBRARY,
  buildDraftFromSelection,
  buildHealthSummary,
  createDefaultRuleSelection,
  createPersistedV2RuleTree,
  detectStrategyConflicts,
  formatRuleSummary,
  parseCopilotPrompt,
  safeDescriptiveState,
  toPersistedExecutionMode,
  type Capability,
  type RuleGroupType,
  type RuleSelection,
} from '@/lib/strategy-builder-v2';

type CreationPath = 'visual' | 'copilot' | 'methodology' | 'blank';
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
  onApply,
  onCancel,
}: {
  profile: StrategyProfile;
  onApply: (nextProfile: StrategyProfile, nextRules: StrategyRule[], nextMethodologies: StrategyMethodology[]) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState<CreationPath>('visual');
  const [step, setStep] = useState<StepKey>(1);
  const [selectedMethodologyIds, setSelectedMethodologyIds] = useState<string[]>(defaultMethodologies);
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>(profile.instruments?.length ? profile.instruments : ['XAUUSD']);
  const [direction, setDirection] = useState<'LONG' | 'SHORT' | 'BOTH'>('BOTH');
  const [sessions, setSessions] = useState<string[]>(['London', 'New York']);
  const [contextTimeframe, setContextTimeframe] = useState<string>('H1');
  const [executionTimeframe, setExecutionTimeframe] = useState<string>('M15');
  const [selectedRuleSelections, setSelectedRuleSelections] = useState<RuleSelection[]>(() => createDefaultRuleSelection());
  const [riskPercent, setRiskPercent] = useState<number>(Number(profile.maximumRiskPercent ?? 0.5));
  const [minimumRR, setMinimumRR] = useState<number>(Number(profile.minimumRR ?? 3));
  const [stopLogic, setStopLogic] = useState<string>('Structured stop');
  const [targetLogic, setTargetLogic] = useState<string>('RR target');
  const [copilotInput, setCopilotInput] = useState('I trade XAUUSD in London and New York. I want Liquidity Sweep and CHoCH. Either Order Block or FVG is enough. Risk 0.5% and minimum RR 1:3.');
  const [copilotConversation, setCopilotConversation] = useState<Array<{ heading: string; text: string }>>([
    { heading: 'Trade Police', text: 'Tell me how you trade. I’ll turn it into a structured strategy draft.' },
  ]);
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

  function buildVisualApply() {
    const chosenLibraries = allLibraries.filter((library) => selectedMethodologyIds.includes(library.id));
    const nextMethodologies: StrategyMethodology[] = chosenLibraries.map((library) => ({
      category: library.label,
      rules: library.rules.filter((rule) => selectedRuleSelections.some((selection) => selection.key === rule.key)).map((rule) => rule.key),
    }));

    const persistedRuleTree = createPersistedV2RuleTree(selectedRuleSelections);
    const nextRules: StrategyRule[] = selectedRuleSelections.map((rule) => {
      const definition = allRulesByKey[rule.key];
      const safeState = definition ? safeDescriptiveState(definition.key, definition.capability) : { capability: 'MANUAL', evaluationMode: 'MANUAL' as const, isDescriptive: false };
      const isDescriptive = definition?.capability === 'DESCRIPTIVE';
      const mandatory = rule.requirement === 'REQUIRED' && !isDescriptive;
      const weight = definition?.capability === 'AUTOMATIC' ? 10 : definition?.capability === 'MANUAL' ? 8 : definition?.capability === 'EXTERNAL' ? 6 : 4;
      const minimumConfidence = definition?.capability === 'AUTOMATIC' ? 72 : 60;
      const evaluationMode: StrategyRule['evaluationMode'] = safeState.evaluationMode;

      return {
        ruleKey: rule.key,
        label: rule.label,
        enabled: true,
        mandatory,
        weight,
        minimumConfidence,
        timeframeRole: rule.timeframe.includes('H') ? 'MACRO' : 'TRIGGER',
        evaluationMode,
      };
    });

    const nextProfile: StrategyProfile = {
      ...profile,
      name: profile.name || 'New Strategy',
      description: profile.description || 'Strategy created from the visual V2 flow.',
      instruments: selectedInstruments,
      marketTypes: ['FOREX'],
      maximumRiskPercent: riskPercent,
      minimumRR,
      preferredRR: Math.max(minimumRR, 1),
      strategyMethodologies: nextMethodologies,
      personalRules: [
        ...selectedMethodologyIds.map((id) => ({
          key: id,
          enabled: true,
          value: allLibraries.find((library) => library.id === id)?.label ?? id,
        })),
        {
          key: 'v2-rule-tree',
          enabled: true,
          value: JSON.stringify(persistedRuleTree),
        },
      ],
      requireTrendAlignment: true,
    };

    onApply(nextProfile, nextRules, nextMethodologies);
  }

  function buildCopilotApply() {
    const parsed = parseCopilotPrompt(copilotInput);
    const draftRules: RuleSelection[] = parsed.selectedRuleKeys.map((key) => {
      const definition = allRulesByKey[key];
      if (!definition) return null;
      return {
        key: definition.key,
        label: definition.label,
        capability: definition.capability,
        requirement: definition.capability === 'DESCRIPTIVE' ? 'OPTIONAL' : 'REQUIRED',
        timeframe: executionTimeframe,
        group: parsed.groupMode,
        description: definition.description,
      };
    }).filter(Boolean) as RuleSelection[];

    const nextMethodologies: StrategyMethodology[] = selectedLibraries.length
      ? selectedLibraries.map((library) => ({
          category: library.label,
          rules: library.rules.filter((rule) => draftRules.some((selection) => selection.key === rule.key)).map((rule) => rule.key),
        }))
      : [{ category: 'Drafted from description', rules: draftRules.map((rule) => rule.key) }];

    const nextRules: StrategyRule[] = draftRules.map((rule) => {
      const definition = allRulesByKey[rule.key];
      const state = safeDescriptiveState(rule.key, definition?.capability ?? 'MANUAL');
      return {
        ruleKey: rule.key,
        label: rule.label,
        enabled: true,
        mandatory: rule.requirement === 'REQUIRED' && state.isDescriptive === false,
        weight: definition?.capability === 'AUTOMATIC' ? 10 : definition?.capability === 'MANUAL' ? 8 : definition?.capability === 'EXTERNAL' ? 6 : 4,
        minimumConfidence: definition?.capability === 'AUTOMATIC' ? 72 : 60,
        timeframeRole: executionTimeframe.includes('H') ? 'MACRO' : 'TRIGGER',
        evaluationMode: state.evaluationMode,
      };
    });

    const nextProfile: StrategyProfile = {
      ...profile,
      name: profile.name || 'Copilot Draft Strategy',
      description: `${copilotInput}\n\nStructured interpretation: ${draftRules.map((rule) => rule.label).join(', ') || 'general directional flow'}.`,
      instruments: selectedInstruments,
      strategyMethodologies: nextMethodologies,
      maximumRiskPercent: riskPercent,
      minimumRR,
      requireTrendAlignment: true,
    };

    onApply(nextProfile, nextRules, nextMethodologies);
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

      <div className="button-row">
        <button type="button" onClick={() => setPath('visual')}>Build Visually</button>
        <button type="button" onClick={() => setPath('copilot')}>Describe Your Strategy — Beta</button>
        <button type="button" onClick={() => setPath('methodology')}>Start From a Methodology</button>
        <button type="button" onClick={() => setPath('blank')}>Start Blank</button>
      </div>

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
          <h3>Describe Your Strategy — Beta</h3>
          <p className="muted">This plain-language assistant helps draft a strategy from your notes. Review the draft before saving; this is not an AI-backed live copilot and the deterministic engine remains authoritative.</p>
          <textarea value={copilotInput} onChange={(event) => setCopilotInput(event.target.value)} rows={6} />
          <div className="button-row">
            <button type="button" onClick={() => setCopilotConversation((current) => [...current, { heading: 'Trader', text: copilotInput }])}>Add note</button>
            <button type="button" className="primary" onClick={() => {
              addCopilotTurn();
              buildCopilotApply();
            }}>Generate structured draft</button>
          </div>
          <div className="copilot-log">
            {copilotConversation.map((entry) => (
              <div key={`${entry.heading}-${entry.text}`} className="copilot-message">
                <strong>{entry.heading}</strong>
                <p>{entry.text}</p>
              </div>
            ))}
          </div>
          <div className="button-row">
            <button type="button" onClick={onCancel}>Back</button>
            <button type="button" className="primary" onClick={buildCopilotApply}>Approve strategy</button>
          </div>
        </div>
      )}

      {path === 'methodology' && (
        <div className="strategy-v2-panel">
          <h3>Start From a Methodology</h3>
          <p className="muted">Select a methodology library, then keep only the concepts you actually use.</p>
          {methodRow}
          <div className="button-row">
            <button type="button" onClick={onCancel}>Back</button>
            <button type="button" className="primary" onClick={() => {
              setSelectedRuleSelections((current) => buildDraftFromSelection(selectedMethodologyIds, current.map((rule) => rule.key), current).rules);
              setStep(3);
            }}>Apply methodology set</button>
          </div>
        </div>
      )}

      {path === 'blank' && (
        <div className="strategy-v2-panel">
          <h3>Start Blank</h3>
          <p className="muted">Open the established builder and build the strategy from a blank configuration.</p>
          <div className="button-row">
            <button type="button" onClick={onCancel}>Back</button>
            <button type="button" className="primary" onClick={() => onApply(profile, [], [])}>Continue with blank builder</button>
          </div>
        </div>
      )}
    </div>
  );
}
