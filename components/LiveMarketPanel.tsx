'use client';

import { useEffect, useState } from 'react';
import TradingViewChart from './TradingViewChart';
import type { Instrument, StrategyProfile, ChartAnalysis } from '@/types/trade';
import {strategyTimeframeLayers} from '@/lib/strategy-timeframes';
import {apiErrorMessage,readApiResponse,redirectExpiredSession} from '@/lib/api-error';
import SetupReadiness from './SetupReadiness';
import MarketIntelligenceBetaResult from './MarketIntelligenceBetaResult';

const scanStages = [
  'Connecting to market…',
  'Reading trend structure…',
  'Checking liquidity and confirmation…',
  'Applying strategy rules…',
  'Preparing police verdict…',
];

export default function LiveMarketPanel({
  strategy,
  onApply,
  onLoadingChange,
}: {
  strategy: StrategyProfile;
  onApply: (analysis: ChartAnalysis) => void;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const [instrument, setInstrument] = useState<Instrument>(
    strategy.instruments[0] || 'XAUUSD',
  );
  const [loading, setLoading] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);

  useEffect(()=>{setAnalysis(null);setError('');},[instrument,strategy.id]);

  useEffect(() => {
    if (!strategy.instruments.includes(instrument)) {
      setInstrument((strategy.instruments[0] || 'XAUUSD') as Instrument);
    }
  }, [strategy.instruments, instrument]);

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

    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),25_000);
    try {
      const requestKey=crypto.randomUUID();
      const response = await fetch('/api/market/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json','Idempotency-Key':requestKey },
        body: JSON.stringify({ instrument }),
        signal:controller.signal,
      });
      const result = await readApiResponse(response);

      if(redirectExpiredSession(response,'/validate'))return;

      if (!response.ok) {
        setError(apiErrorMessage(result,'Market analysis is temporarily unavailable. Please try again shortly.'));
        return;
      }

      if(!result||typeof result!=='object')throw new Error('invalid-response');
      setAnalysis(result);
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
              value={instrument}
              onChange={(event) => setInstrument(event.target.value as Instrument)}
            >
              {strategy.instruments.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <button className="primary" onClick={scan} disabled={loading}>
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

      <TradingViewChart instrument={instrument} />
      {error && <p className="error">{error}</p>}
      {analysis && (
        <>{analysis.intelligenceV2 && <MarketIntelligenceBetaResult result={analysis.intelligenceV2} diagnostics={analysis.adminDiagnostics}/>}<SetupReadiness analysis={analysis}/><div className="analysis-strip">
          <strong>{analysis.status==='NO_RELEVANT_EVIDENCE'?'No setup detected':analysis.status==='STRATEGY_UNSUPPORTED'?'Strategy rules not supported by live analysis':analysis.status==='STRATEGY_INCOMPLETE'?'Strategy configuration incomplete':analysis.status==='INSUFFICIENT_DATA'?'Insufficient market data':analysis.status==='ANALYSIS_FAILED'?'Analysis unavailable':analysis.setupType}</strong>
          {analysis.status==='VALID_ANALYSIS'&&<><span>Setup readiness {analysis.liveAnalysisConfidence}%</span><span>Required readiness {analysis.strategyConfidenceThreshold}%</span><span>{analysis.liveAnalysisConfidence>=analysis.strategyConfidenceThreshold?'Meets required readiness':'Below required readiness'}</span></>}
          <span>Checked: {new Date(analysis.calculatedAt).toLocaleTimeString()}</span>
          <span>{analysis.instrument} · {analysis.timeframe}</span>
          <span>Market data: {analysis.provider} · latest candle {analysis.latestCandleTimestamp}</span>
        </div><div className="grid grid-3 layer-analysis-grid">{analysis.layerAnalysis?.map((layer:any)=><div className="card inset-card" key={`${layer.role}-${layer.timeframe}`}><strong>{layer.role} · {layer.timeframe}</strong><span>{layer.bias}</span><small>{layer.confidence==null?'Context only':`${layer.confidence}% automatic confirmations`}</small>{layer.missingEvidence?.length>0&&<small>Pending: {layer.missingEvidence.join(', ')}</small>}</div>)}</div></>
      )}
    </section>
  );
}
