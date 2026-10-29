import type { HistoricalDecisionAiExplanation, HistoricalDecisionEvidenceItem, HistoricalDecisionReportSnapshot } from '@/types/historical-decision';
import DecisionTimeline from './DecisionTimeline';
import { buildDecisionTimeline } from '@/lib/intelligence/decision-timeline';

const labels = {
  CONFIRMED: 'Confirmed',
  MISSING: 'Still needed',
  BLOCKED: 'Rule violated',
  NOT_AVAILABLE: 'Could not verify',
  NOT_REQUIRED: 'Not required',
};

function Evidence({ title, items }: { title: string; items: HistoricalDecisionEvidenceItem[] }) {
  if (!items.length) return null;

  return (
    <section className="decision-report-section history-report-panel">
      <h2>{title}</h2>
      <div className="decision-report-evidence">
        {items.map((item) => (
          <details className={`decision-evidence-row state-${item.state.toLowerCase()}`} key={item.id}>
            <summary>
              <span aria-hidden="true">{item.state === 'CONFIRMED' ? '✓' : item.state === 'BLOCKED' ? '!' : '○'}</span>
              <strong>{item.title}</strong>
              <em>{item.required ? 'Required rule' : 'Helpful confirmation'}</em>
              <b>{labels[item.state]}</b>
            </summary>
            <div>
              <p>{item.description}</p>
              {item.expectedValue ? <p><strong>Expected:</strong> {item.expectedValue}</p> : null}
              {item.observedValue ? <p><strong>Observed:</strong> {item.observedValue}</p> : null}
              {item.nextAction ? <p><strong>Next:</strong> {item.nextAction}</p> : null}
              <small>{item.source ?? 'Checked by Trade Police'}{item.detectedAt ? ` · ${new Date(item.detectedAt).toLocaleString()}` : ''}</small>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function formatVerdict(value: string) {
  return value.replaceAll('_', ' ');
}

export default function HistoricalDecisionReport({ snapshot, ai }: { snapshot: HistoricalDecisionReportSnapshot; ai?: HistoricalDecisionAiExplanation | null }) {
  const evidence = [...snapshot.requiredRules, ...snapshot.helpfulConfirmations, ...snapshot.blockingConditions, ...snapshot.unavailableEvidence, ...(snapshot.notRequiredEvidence ?? [])];
  const timeline = buildDecisionTimeline({
    marketCalculationCompletedAt: snapshot.marketData.calculationCompletedAt,
    marketProvider: snapshot.marketData.provider,
    evidence,
    verdict: snapshot.verdict,
    verdictTimestamp: snapshot.createdAt,
  });

  const finalRiskCheck = snapshot.finalRiskCheck ?? null;
  const historicalChartNote = 'This saved report does not include a historical chart replay or a persisted trade outcome. The record captures the original decision, evidence, and provenance only.';

  return (
    <article className="decision-report-content historical-report">
      <header className="decision-report-summary history-report-summary">
        <p className="eyebrow">HISTORICAL SNAPSHOT</p>
        <h1>{formatVerdict(snapshot.verdict)}</h1>
        <h2>{snapshot.headline}</h2>
        <p>{snapshot.explanation}</p>
        <p className="decision-primary-reason">{snapshot.primaryReason}</p>
        <p className="snapshot-warning">This report reflects the information available when the decision was saved. It is not updated with later market data.</p>
      </header>

      <DecisionTimeline timeline={timeline} />

      <dl className="decision-report-metadata">
        <div><dt>Report ID</dt><dd>{snapshot.reportId}</dd></div>
        <div><dt>Saved at</dt><dd>{new Date(snapshot.createdAt).toLocaleString()}</dd></div>
        <div><dt>Instrument</dt><dd>{snapshot.instrument} · {snapshot.timeframe}</dd></div>
        <div><dt>Strategy</dt><dd>{snapshot.strategyName}</dd></div>
        <div><dt>Revision</dt><dd>{snapshot.strategyRevisionId ?? snapshot.strategyVersion ?? 'Not available'}</dd></div>
        <div><dt>Provider</dt><dd>{snapshot.marketData.provider}</dd></div>
        <div><dt>Original candle</dt><dd>{snapshot.marketData.lastVerifiedCandleAt ? new Date(snapshot.marketData.lastVerifiedCandleAt).toLocaleString() : 'Unavailable'}</dd></div>
        <div><dt>Freshness</dt><dd>{snapshot.marketData.freshness.replaceAll('_', ' ')}</dd></div>
        <div><dt>Required rules</dt><dd>{snapshot.confirmedRequiredCount} of {snapshot.totalRequiredCount} confirmed</dd></div>
      </dl>

      <section className="decision-report-section history-report-panel">
        <h2>Original decision</h2>
        <p><strong>Primary reason:</strong> {snapshot.primaryReason}</p>
        <p><strong>Next action:</strong> {snapshot.nextAction}</p>
        <p><strong>Readiness:</strong> {snapshot.readinessPercent != null ? `${snapshot.readinessPercent}%` : 'Not recorded'}</p>
      </section>

      <Evidence title="Required rules" items={snapshot.requiredRules} />
      <Evidence title="Helpful confirmations" items={snapshot.helpfulConfirmations} />
      <Evidence title="Blocking conditions" items={snapshot.blockingConditions} />
      <Evidence title="Unavailable evidence" items={snapshot.unavailableEvidence} />
      <Evidence title="Not required" items={snapshot.notRequiredEvidence ?? []} />

      <section className="decision-report-section history-report-panel">
        <h2>Historical context</h2>
        <p>{historicalChartNote}</p>
        <p><strong>Saved snapshot integrity:</strong> {snapshot.integrityStatement}</p>
      </section>

      {finalRiskCheck ? (
        <section className="decision-report-section history-report-panel">
          <h2>Persisted risk check</h2>
          <p><strong>Status:</strong> {finalRiskCheck.status}</p>
          <p><strong>Entry / SL / TP:</strong> {finalRiskCheck.entryPrice ?? 'Not available'} / {finalRiskCheck.stopPrice ?? 'Not available'} / {finalRiskCheck.targetPrice ?? 'Not available'}</p>
          <p><strong>Risk / R:R:</strong> {finalRiskCheck.riskPercent ?? 'Not available'} / {finalRiskCheck.riskReward ?? 'Not available'}</p>
          {finalRiskCheck.blockingReasons.length ? (
            <ul>{finalRiskCheck.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          ) : null}
        </section>
      ) : (
        <section className="decision-report-section history-report-panel">
          <h2>Outcome</h2>
          <p>No trade outcome or realized R was persisted with this report.</p>
        </section>
      )}

      {ai?.prose ? (
        <section className="decision-report-section history-report-panel">
          <h2>Plain-language explanation</h2>
          <div className="historical-ai-prose">{ai.prose}</div>
          {ai.provider ? <small>Source: {ai.provider}{ai.model ? ` · ${ai.model}` : ''}</small> : null}
        </section>
      ) : null}

      {snapshot.limitations?.length ? (
        <section className="decision-report-section history-report-panel">
          <h2>Limitations</h2>
          <ul>{snapshot.limitations.map((limit) => <li key={limit}>{limit}</li>)}</ul>
        </section>
      ) : null}

      {snapshot.deterministicFingerprint ? (
        <section className="decision-report-section history-report-panel">
          <h2>Audit ID</h2>
          <p className="report-fingerprint">{snapshot.deterministicFingerprint}</p>
        </section>
      ) : null}
    </article>
  );
}
