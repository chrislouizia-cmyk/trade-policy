import type {ChartAnalysis} from '@/types/trade';
import { buildSetupReadinessMetadata, formatHumanLabel } from '@/lib/setup-readiness/presentation';

function formatReadinessState(state: ChartAnalysis['setupReadiness'] extends undefined ? never : NonNullable<ChartAnalysis['setupReadiness']>['state']) {
  switch (state) {
    case 'READY':
      return 'Ready';
    case 'NOT_READY':
      return 'Not ready';
    case 'WAITING_FOR_CONFIRMATION':
      return 'Waiting for confirmation';
    case 'CONFIGURATION_REQUIRED':
      return 'Configuration required';
    default:
      return 'Unclear';
  }
}

export default function SetupReadiness({analysis}:{analysis:ChartAnalysis}){
  const readiness=analysis.setupReadiness;if(!readiness)return null;
  const state=formatReadinessState(readiness.state);
  const metadata=buildSetupReadinessMetadata({
    instrument: analysis.instrument,
    timeframe: analysis.timeframe,
    calculatedAt: analysis.calculatedAt,
    liveAnalysisConfidence: analysis.liveAnalysisConfidence,
    strategyConfidenceThreshold: analysis.strategyConfidenceThreshold,
    setupReadiness: readiness,
  });
  const failedLabels=readiness.blockers.map(item=>formatHumanLabel(item.label));
  const pendingLabels=readiness.pendingConfirmations.map(item=>formatHumanLabel(item.label));

  return <section className="setup-readiness card inset-card" aria-labelledby="setup-readiness-title">
    <header className="setup-readiness-header">
      <div>
        <p className="muted">SETUP READINESS</p>
        <h3 id="setup-readiness-title">
          <span className="setup-readiness-title-label">Overall readiness</span>
          <span className="setup-readiness-title-value">{readiness.percentage==null?'Configuration required':`${readiness.percentage}%`}</span>
        </h3>
      </div>
      <strong className="setup-readiness-status-badge">{state}</strong>
    </header>
    <div className="setup-readiness-metadata" role="list" aria-label="Setup readiness metadata">
      {metadata.map((item)=><div className="setup-readiness-metadata-item" key={item.label} role="listitem"><span>{item.label}</span><strong>{item.value}</strong></div>)}
    </div>
    <div className="setup-readiness-counters">
      <article className="setup-readiness-panel">
        <h4>Required checks</h4>
        <div className="setup-readiness-count-grid">
          <div><span>Passed</span><strong>{readiness.required.passed}</strong></div>
          <div><span>Failed</span><strong>{readiness.required.failed}</strong></div>
          <div><span>Pending</span><strong>{readiness.required.pending}</strong></div>
        </div>
      </article>
      <article className="setup-readiness-panel">
        <h4>Optional confluence</h4>
        <div className="setup-readiness-count-grid">
          <div><span>Passed</span><strong>{readiness.optional.passed}</strong></div>
          <div><span>Failed</span><strong>{readiness.optional.failed}</strong></div>
          <div><span>Pending</span><strong>{readiness.optional.pending}</strong></div>
        </div>
      </article>
    </div>
    {failedLabels.length>0&&<article className="setup-readiness-list-card"><div className="setup-readiness-list-head"><h4>Failed</h4><p className="setup-readiness-list-summary">{readiness.required.failed} failed rule{readiness.required.failed===1?'':'s'}</p></div><ul className="setup-readiness-list">{failedLabels.map(item=><li key={item}>{item}</li>)}</ul></article>}
    {pendingLabels.length>0&&<article className="setup-readiness-list-card"><div className="setup-readiness-list-head"><h4>Pending confirmations</h4><p className="setup-readiness-list-summary">{readiness.required.pending} pending confirmation{readiness.required.pending===1?'':'s'}</p></div><ul className="setup-readiness-list setup-readiness-pending">{pendingLabels.map(item=><li key={item}>{item}</li>)}</ul></article>}
  </section>
}
