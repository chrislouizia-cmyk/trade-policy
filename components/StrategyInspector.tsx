import type { StrategyProfile, StrategyRule, StrategySession } from '@/types/trade';
import type { StrategyBuilderV2State } from '@/lib/strategy-builder-v2-persistence';
import type { PersistedV2RuleTreeNode } from '@/lib/strategy-builder-v2';

function summarizeValue(input: unknown) {
  if (input === undefined || input === null || input === '') return 'Not configured';
  if (Array.isArray(input)) return input.length ? input.join(', ') : 'Not configured';
  if (typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>).filter(([, item]) => item !== undefined && item !== null && item !== '');
    if (!entries.length) return 'Not configured';
    return entries
      .map(([key, item]) => `${key}: ${typeof item === 'string' || typeof item === 'number' ? String(item) : JSON.stringify(item)}`)
      .join(' · ');
  }
  return typeof input === 'string' ? input : String(input);
}

function Tree({ node, depth = 0 }: { node: PersistedV2RuleTreeNode; depth?: number }) {
  if (node.type === 'CONDITION') {
    return (
      <li style={{ marginLeft: depth * 16 }}>
        <strong>{node.requirement}</strong>: {node.ruleKey} {node.timeframe ? `— ${node.timeframe}` : ''}
      </li>
    );
  }

  return (
    <li style={{ marginLeft: depth * 16 }}>
      <strong>{node.logic}</strong>
      <ul>
        {node.children.map((child, index) => (
          <Tree key={`${node.logic}-${index}`} node={child} depth={depth + 1} />
        ))}
      </ul>
    </li>
  );
}

export default function StrategyInspector({
  profile,
  rules,
  sessions,
  v2,
  onEdit,
  onDuplicate,
  onArchive,
  onRestore,
  onActivate,
}: {
  profile: StrategyProfile;
  rules: StrategyRule[];
  sessions: StrategySession[];
  v2: StrategyBuilderV2State;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onActivate: () => void;
}) {
  const enabled = rules.filter((rule) => rule.enabled);
  const grouped = (mode: string) => enabled.filter((rule) => (rule.evaluationMode ?? 'AUTOMATIC') === mode);
  const core = `Trade ${profile.instruments.join(', ') || 'no instruments'} during ${sessions.map((item) => item.name).join('/') || 'no sessions'}. Use ${v2.contextTimeframe ?? profile.macroTimeframe ?? 'no context timeframe'} for context and ${v2.executionTimeframe ?? profile.entryTimeframe ?? 'no execution timeframe'} for execution. Risk ${profile.maximumRiskPercent}%. Minimum RR 1:${profile.minimumRR}.`;
  const methodologyValue = Array.isArray(v2.methodologyIds) && v2.methodologyIds.length
    ? v2.methodologyIds.join(', ')
    : Array.isArray(profile.strategyMethodologies) && profile.strategyMethodologies.length
      ? profile.strategyMethodologies.join(', ')
      : 'Not configured';
  const limitValue = profile.instrumentTradeLimits && Object.keys(profile.instrumentTradeLimits).length
    ? Object.entries(profile.instrumentTradeLimits)
        .map(([symbol, value]) => `${symbol}: ${value}`)
        .join(' · ')
    : profile.maximumTradesPerDay
      ? `Daily trades ${profile.maximumTradesPerDay}`
      : 'Not configured';

  return (
    <section className="card strategy-inspector" aria-labelledby="strategy-inspector-title">
      <header>
        <div>
          <p className="muted">SELECTED PERSISTED STRATEGY</p>
          <h2 id="strategy-inspector-title">{profile.name}</h2>
          <p>{profile.isArchived ? 'Archived' : profile.isDefault ? 'Active' : 'Saved — not active'}</p>
        </div>
        <div className="button-row">
          <button onClick={onEdit}>Edit strategy</button>
          <button onClick={onDuplicate}>Duplicate</button>
          {profile.isArchived ? (
            <button onClick={onRestore}>Restore</button>
          ) : (
            <>
              <button onClick={onActivate} disabled={profile.isDefault}>Activate</button>
              <button onClick={onArchive} disabled={profile.isDefault}>Archive</button>
            </>
          )}
        </div>
      </header>

      <section>
        <h3>Strategy Core</h3>
        <p>{core}</p>
      </section>

      <div className="grid grid-3">
        <Info title="Instruments" value={profile.instruments.join(', ')} />
        <Info title="Sessions" value={sessions.map((item) => item.name).join(', ')} />
        <Info title="Timeframes" value={`Context ${v2.contextTimeframe ?? profile.macroTimeframe ?? '—'} · Confirmation ${profile.confirmationTimeframe ?? '—'} · Execution ${v2.executionTimeframe ?? profile.entryTimeframe ?? '—'} · Trigger ${profile.triggerTimeframe ?? '—'}`} />
        <Info title="Methodologies" value={methodologyValue} />
        <Info title="Risk / RR" value={`${profile.maximumRiskPercent}% · minimum 1:${profile.minimumRR} · preferred 1:${profile.preferredRR ?? '—'}`} />
        <Info title="Limits" value={limitValue} />
        <Info title="Stop logic" value={summarizeValue(v2.stopLogic ?? profile.stopLimitSettings)} />
        <Info title="Target logic" value={summarizeValue(v2.targetLogic ?? profile.exitConfig)} />
        <Info title="News / trend" value={`${profile.newsMode ?? '—'} · trend alignment ${profile.requireTrendAlignment ? 'required' : 'not required'}`} />
      </div>

      <section>
        <h3>Rule logic</h3>
        {v2.ruleTree ? (
          <ul className="strategy-rule-tree">
            <Tree node={v2.ruleTree} />
          </ul>
        ) : (
          <p className="muted">No V2 logic tree was persisted. Legacy rules are shown as saved.</p>
        )}
        <RuleList label="Enabled" rules={enabled} />
        <RuleList label="Automatic" rules={grouped('AUTOMATIC')} />
        <RuleList label="Manual" rules={grouped('MANUAL')} />
        <RuleList label="External" rules={grouped('EXTERNAL')} />
      </section>
    </section>
  );
}

function Info({ title, value: content }: { title: string; value: string }) {
  return (
    <div className="card metric">
      <span className="muted">{title}</span>
      <strong>{content || 'Not configured'}</strong>
    </div>
  );
}

function RuleList({ label, rules }: { label: string; rules: StrategyRule[] }) {
  return (
    <div>
      <strong>{label}</strong>
      <p>
        {rules.length
          ? rules.map((rule) => `${rule.label} (${rule.timeframeRole}, ${rule.evaluationMode ?? 'AUTOMATIC'})`).join(' · ')
          : 'None'}
      </p>
    </div>
  );
}
