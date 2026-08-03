'use client';

import { useEffect, useState } from 'react';
import TradingViewChart from './TradingViewChart';
import type { Instrument, StrategyProfile, ChartAnalysis } from '@/types/trade';

function getAnalysisStatusLabel(status: ChartAnalysis['status'] | undefined) {
  switch (status) {
    case 'VALID_ANALYSIS':
      return 'Valid analysis';
    case 'NO_RELEVANT_EVIDENCE':
      return 'No setup detected';
    case 'STRATEGY_UNSUPPORTED':
      return 'Strategy rules not supported by live analysis';
    case 'STRATEGY_INCOMPLETE':
      return 'Strategy configuration incomplete';
    case 'INSUFFICIENT_DATA':
      return 'Insufficient market data';
    case 'ANALYSIS_FAILED':
      return 'Analysis unavailable';
    case 'DATA_UNAVAILABLE':
      return 'Market data unavailable';
    default:
      return 'Analysis pending';
  }
}
import {strategyTimeframeLayers} from '@/lib/strategy-timeframes';
import {apiErrorMessage,readApiResponse,redirectExpiredSession} from '@/lib/api-error';
import SetupReadiness from './SetupReadiness';
import MarketIntelligenceBetaResult from './MarketIntelligenceBetaResult';
import type {AdminPipelineDiagnostics,BetaIntelligenceView} from '@/lib/market-intelligence/beta/beta-integration';
import { buildLayerCardPresentation, buildSetupReadinessMetadata } from '@/lib/setup-readiness/presentation';

type DisplayAnalysis=ChartAnalysis&{intelligenceV2?:BetaIntelligenceView;adminDiagnostics?:AdminPipelineDiagnostics|null};

const scanStages = [
  'Requesting market data',
  'Checking your required rules',
  'Preparing your Decision Report',
];

export default function LiveMarketPanel({
  strategy,
  onApply,
  onReset,
  onLoadingChange,
  selectedInstrument,
  onInstrumentChange,
}: {
  strategy: StrategyProfile;
  onApply: (analysis: ChartAnalysis) => void;
  onReset?: () => void;
  onLoadingChange?: (loading: boolean) => void;
  selectedInstrument: Instrument;
  onInstrumentChange: (instrument: Instrument) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<DisplayAnalysis|null>(null);
  const isValidAnalysis = analysis?.status === 'VALID_ANALYSIS';
  const analysisStatusLabel = getAnalysisStatusLabel(analysis?.status);
  const readinessMetadata = analysis ? buildSetupReadinessMetadata({
    instrument: analysis.instrument,
    timeframe: analysis.timeframe,
    calculatedAt: analysis.calculatedAt,
    liveAnalysisConfidence: analysis.liveAnalysisConfidence,
    strategyConfidenceThreshold: analysis.strategyConfidenceThreshold,
    setupReadiness: analysis.setupReadiness,
  }) : [];

  useEffect(()=>{setAnalysis(null);setError('');},[selectedInstrument,strategy.id]);

  useEffect(() => {
    if (!strategy.instruments.includes(selectedInstrument)) {
      onInstrumentChange(strategy.instruments[0] || 'XAUUSD');
    }
  }, [selectedInstrument, strategy.instruments, onInstrumentChange]);

  useEffect(() => {
    if (!loading) {
      setStageIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setStageIndex((current) => Math.min(current + 1, scanStages.length - 1));
    }, 850);

    return () => window.clearInterval(timer);
  }, [loading]);

  async function scan() {
    setLoading(true);
    onLoadingChange?.(true);
    setStageIndex(0);
    setError('');
    setAnalysis(null);
    onReset?.();

    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),25_000);
    try {
      const requestKey=crypto.randomUUID();
      const response = await fetch('/api/market/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json','Idempotency-Key':requestKey },
        body: JSON.stringify({ instrument: selectedInstrument }),
        signal:controller.signal,
      });
      const result = await readApiResponse(response);

      if(redirectExpiredSession(response,'/validate'))return;

      if (!response.ok) {
        setError(apiErrorMessage(result,'Market analysis is temporarily unavailable. Please try again shortly.'));
        return;
      }

      if(!result||typeof result!=='object')throw new Error('invalid-response');
      setAnalysis(result as DisplayAnalysis);
      onApply(result as ChartAnalysis);
    } catch(error) {
      setError(error instanceof Error&&error.name==='AbortError'?'Market analysis timed out. Your trade data was not changed. Please try again.':'Market analysis is temporarily unavailable. Your trade data was not changed.');
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
      onLoadingChange?.(false);
    }
  }

  return (
    <section className="card live-panel">
      <div className="live-head">
        <div>
          <p className="brand">STEP 1 · CHECK CURRENT MARKET</p>
          <h2>Read the evidence for this strategy</h2>
          <p className="muted">Trade Police checks {strategyTimeframeLayers(strategy).map(layer=>`${layer.role.toLowerCase()} ${layer.timeframe}`).join(' · ')} against your saved rules.</p>
        </div>
        <div>
          <label>
            Instrument
            <select
              value={selectedInstrument}
              onChange={(event) => onInstrumentChange(event.target.value as Instrument)}
            >
              {strategy.instruments.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <button className="primary" data-market-check type="button" onClick={scan} disabled={loading}>
            {loading ? scanStages[stageIndex] : analysis ? 'Refresh market check' : 'Check current market'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="analysis-progress" aria-live="polite" aria-busy="true">
          <div className="analysis-progress-track">
            <span style={{ width: `${((stageIndex + 1) / scanStages.length) * 100}%` }} />
          </div>
          <div className="analysis-progress-stages" aria-hidden="true">{scanStages.map((stage,index)=><i className={index<stageIndex?'complete':index===stageIndex?'current':''} key={stage}/>)}</div>
          <small>{scanStages[stageIndex]}</small>
        </div>
      )}

      <TradingViewChart instrument={selectedInstrument} />
      <details className="chart-source-note"><summary>What the chart contributes</summary><p>Trade Police evaluates completed market data against your saved trading rules. It does not use the chart image as the source of the verdict.</p></details>
      {error && <div className="error analysis-error" role="alert"><strong>No decision was produced.</strong><p>{error}</p><small>Failed market-analysis attempts are released and do not consume monthly usage. Your selected instrument and trading rules are unchanged.</small><button type="button" onClick={scan}>Retry analysis</button></div>}
      {isValidAnalysis && (
        <>{analysis.intelligenceV2 && <MarketIntelligenceBetaResult result={analysis.intelligenceV2} diagnostics={analysis.adminDiagnostics}/>}<SetupReadiness analysis={analysis}/><div className="analysis-strip" role="list" aria-label="Setup readiness metadata">
          {readinessMetadata.map((item)=><div className="analysis-strip-item" key={item.label} role="listitem"><span>{item.label}</span><strong>{item.value}</strong></div>)}
          <div className="analysis-strip-item analysis-strip-item-wide" role="listitem"><span>Market data</span><strong>{analysis.provider} · latest candle {analysis.latestCandleTimestamp}</strong></div>
        </div><div className="layer-analysis-grid">{analysis.layerAnalysis?.map((layer:any)=>{
          const presentation=buildLayerCardPresentation(layer);
          return <article className="card inset-card layer-analysis-card" key={`${layer.role}-${layer.timeframe}`}>
            <div className="layer-analysis-head">
              <strong>{presentation.category} · {presentation.timeframe}</strong>
              <span className="layer-analysis-state">{presentation.state}</span>
            </div>
            <div className="layer-analysis-metadata">
              <div><span>Confidence</span><strong>{presentation.confidencePercentage==null?'Context only':`${presentation.confidencePercentage}%`}</strong></div>
              <div><span>Mode</span><strong>{presentation.mode}</strong></div>
            </div>
            {presentation.pendingConfirmations.length>0&&<div className="layer-analysis-list"><span className="layer-analysis-list-label">Pending</span><ul>{presentation.pendingConfirmations.map((item)=><li key={item}>{item}</li>)}</ul></div>}
            {presentation.supportingDetails.length>0&&<div className="layer-analysis-list"><span className="layer-analysis-list-label">Supporting details</span><ul>{presentation.supportingDetails.map((item)=><li key={item}>{item}</li>)}</ul></div>}
          </article>;
        })}</div></>
      )}
    </section>
  );
}
