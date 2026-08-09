import MarketIntelligenceBetaResult from '@/components/MarketIntelligenceBetaResult';
import { buildLayerCardPresentation } from '@/lib/setup-readiness/presentation';
import type { AdminPipelineDiagnostics, BetaIntelligenceView } from '@/lib/market-intelligence/beta/beta-integration';
import type { ChartAnalysis } from '@/types/trade';

type DisplayAnalysis = ChartAnalysis & {
  intelligenceV2?: BetaIntelligenceView;
  adminDiagnostics?: AdminPipelineDiagnostics | null;
};

export default function AutomaticAnalysisEvidence({ analysis }: { analysis: DisplayAnalysis }) {
  return <details className="deep-evidence-item">
    <summary>Automatic detector evidence</summary>
    <div className="automatic-analysis-evidence">
      {analysis.intelligenceV2 ? <MarketIntelligenceBetaResult result={analysis.intelligenceV2} diagnostics={analysis.adminDiagnostics}/> : null}
      <div className="layer-analysis-grid">{analysis.layerAnalysis?.map(layer => {
        const presentation = buildLayerCardPresentation(layer);
        return <article className="card inset-card layer-analysis-card" key={`${layer.role}-${layer.timeframe}`}>
          <div className="layer-analysis-head"><strong>{presentation.category} · {presentation.timeframe}</strong><span className="layer-analysis-state">{presentation.state}</span></div>
          <div className="layer-analysis-metadata"><div><span>Confidence</span><strong>{presentation.confidencePercentage == null ? 'Context only' : `${presentation.confidencePercentage}%`}</strong></div><div><span>Mode</span><strong>{presentation.mode}</strong></div></div>
          {presentation.pendingConfirmations.length ? <div className="layer-analysis-list"><span className="layer-analysis-list-label">Pending</span><ul>{presentation.pendingConfirmations.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
          {presentation.supportingDetails.length ? <div className="layer-analysis-list"><span className="layer-analysis-list-label">Supporting details</span><ul>{presentation.supportingDetails.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
        </article>;
      })}</div>
    </div>
  </details>;
}
