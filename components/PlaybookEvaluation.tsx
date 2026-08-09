import { buildMethodologyAudit, type MethodologyAuditRule } from '@/lib/methodology-audit';
import { confirmationList } from '@/lib/manual-confirmations';
import type { ChartAnalysis, ManualConfirmationState, StrategyRule } from '@/types/trade';

const groupLabels = {
  required: 'Required checks',
  optional: 'Optional confirmations',
  manual: 'Manual confirmations',
  external: 'External checks',
} as const;

function RuleRow({ rule }: { rule: MethodologyAuditRule }) {
  const status = rule.status === 'PASSED' ? 'PASS' : rule.status === 'FAILED' ? 'FAIL' : rule.evaluationMode === 'EXTERNAL' ? 'UNKNOWN' : 'PENDING';
  return <details className={`playbook-rule-row status-${status.toLowerCase()}`}>
    <summary>
      <span aria-hidden="true">{status === 'PASS' ? '✓' : status === 'FAIL' ? '!' : '○'}</span>
      <strong>{rule.label}</strong>
      {rule.timeframeRole ? <small>{rule.timeframeRole.replaceAll('_', ' ')}</small> : null}
      <b>{status}</b>
    </summary>
    <p>{rule.detail}</p>
  </details>;
}

export default function PlaybookEvaluation({ rules, analysis, manualEvidence }: { rules: StrategyRule[]; analysis: ChartAnalysis | null; manualEvidence: Record<string, ManualConfirmationState> }) {
  const input: Record<string, unknown> = { manualConfirmations: confirmationList(manualEvidence) };
  const groups = buildMethodologyAudit(rules, input, analysis);
  return <section className="card playbook-evaluation" aria-labelledby="playbook-evaluation-title">
    <header><div><p className="brand">PLAYBOOK EVALUATION</p><h2 id="playbook-evaluation-title">Your trading rules, evaluated once</h2></div><p>Expand a row for its recorded evaluation detail.</p></header>
    <div className="playbook-evaluation-groups">
      {(Object.keys(groupLabels) as Array<keyof typeof groupLabels>).map(key => <section key={key} aria-labelledby={`playbook-${key}`}>
        <h3 id={`playbook-${key}`}>{groupLabels[key]} <span>{groups[key].length}</span></h3>
        {groups[key].length ? <div>{groups[key].map(rule => <RuleRow key={rule.ruleKey} rule={rule}/>)}</div> : <p className="muted">No enabled {groupLabels[key].toLowerCase()}.</p>}
      </section>)}
    </div>
  </section>;
}
