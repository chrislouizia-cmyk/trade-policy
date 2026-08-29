'use client';

import { type ReactNode, useEffect, useState, useRef } from 'react';
import TradingViewChart from './TradingViewChart';
import type { Instrument, StrategyProfile, ChartAnalysis } from '@/types/trade';
import type { PositionOverlayModel } from '@/lib/position-geometry';

import {strategyTimeframeContext, supportedMarketTimeframesForStrategy} from '@/lib/strategy-timeframes';
import {apiErrorMessage,readApiResponse,redirectExpiredSession} from '@/lib/api-error';

const scanStages = [
  'Requesting market data',
  'Checking your required rules',
  'Preparing your Decision Report',
];

export default function LiveMarketPanel({
  strategy,
  strategyRevisionId,
  onApply,
  onReset,
  onLoadingChange,
  selectedInstrument,
  onInstrumentChange,
  decisionContent,
  positionOverlay,
  strategyLoading = false,
}: {
  strategy: StrategyProfile;
  strategyRevisionId: string | null;
  strategyLoading?: boolean;
  onApply: (analysis: ChartAnalysis) => void;
  onReset?: () => void;
  onLoadingChange?: (loading: boolean) => void;
  selectedInstrument: Instrument;
  onInstrumentChange: (instrument: Instrument) => void;
  decisionContent?: ReactNode;
  positionOverlay: PositionOverlayModel | null;
}) {
  const [loading, setLoading] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<ChartAnalysis|null>(null);
  const availableTimeframes = supportedMarketTimeframesForStrategy(strategy);
  const [chartTimeframe, setChartTimeframe] = useState(strategy.entryTimeframe || availableTimeframes[0] || 'H1');
  const analysisContextRef = useRef('');

  useEffect(()=>{
    analysisContextRef.current = `${strategy.id ?? ''}:${strategyRevisionId ?? ''}:${selectedInstrument}`;
    setAnalysis(null);
    setError('');
  },[selectedInstrument,strategy.id,strategyRevisionId]);

  useEffect(() => {
    if (!availableTimeframes.includes(chartTimeframe)) setChartTimeframe(strategy.entryTimeframe || availableTimeframes[0] || 'H1');
  }, [availableTimeframes, chartTimeframe, strategy.entryTimeframe]);

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
    if (!strategy.id || !strategyRevisionId) {
      setError('The selected strategy is still loading. Please wait a moment and try again.');
      return;
    }
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
      const requestContextKey = `${strategy.id}:${strategyRevisionId}:${selectedInstrument}`;
      const response = await fetch('/api/market/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json','Idempotency-Key':requestKey },
        body: JSON.stringify({
          instrument: selectedInstrument,
          strategyId: strategy.id ?? null,
          strategyRevisionId: strategyRevisionId,
        }),
        signal:controller.signal,
      });
      const result = await readApiResponse(response);

      if(redirectExpiredSession(response,'/validate'))return;

      if (!response.ok) {
        setError(apiErrorMessage(result,'Market analysis is temporarily unavailable. Please try again shortly.'));
        return;
      }

      if(!result||typeof result!=='object')throw new Error('invalid-response');
      if (analysisContextRef.current !== requestContextKey) {
        return;
      }
      const appliedStrategyId = (result as any)?.strategyApplied?.id ?? (result as any)?.strategyId ?? null;
      if (appliedStrategyId && appliedStrategyId !== strategy.id) {
        return;
      }
      if ((result as any)?.instrument && (result as any).instrument !== selectedInstrument) {
        return;
      }

      setAnalysis(result as ChartAnalysis);
      onApply(result as ChartAnalysis);
    } catch(error) {
      setError(error instanceof Error&&error.name==='AbortError'?'Market analysis timed out. Your trade data was not changed. Please try again.':'Market analysis is temporarily unavailable. Your trade data was not changed.');
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
      onLoadingChange?.(false);
    }
  }

  const strategyContextText = strategyLoading ? '' : strategyTimeframeContext(strategy);

  return (
    <section className="card live-panel">
      <div className="live-head">
        <div>
          <p className="brand">STEP 1 · CHECK CURRENT MARKET</p>
          <h2>{strategyLoading ? 'Applying strategy…' : 'Read the evidence for this strategy'}</h2>
          {strategyContextText ? <p className="muted">{strategyContextText}</p> : strategyLoading ? <p className="muted">Loading the strategy context and clearing stale evidence.</p> : null}
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
          <button className="primary" data-market-check type="button" onClick={scan} disabled={loading || strategyLoading || !strategy.id || !strategyRevisionId}>
            {strategyLoading ? 'Applying strategy…' : !strategy.id || !strategyRevisionId ? 'Loading strategy…' : loading ? scanStages[stageIndex] : analysis ? 'Refresh market check' : 'Check current market'}
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

      <div className="market-chart-toolbar">
        <div className="market-timeframe-rail" aria-label="Market timeframe selector">
          {availableTimeframes.map((timeframe) => (
            <button key={timeframe} type="button" className={chartTimeframe === timeframe ? 'selected' : ''} onClick={() => setChartTimeframe(timeframe)}>
              {timeframe}
            </button>
          ))}
        </div>
        <strong>{selectedInstrument}</strong>
      </div>
      <TradingViewChart instrument={selectedInstrument} timeframe={chartTimeframe} overlay={positionOverlay?.currentGeometry.instrument === selectedInstrument ? positionOverlay : null} onOverlayClick={() => document.getElementById('position-geometry-fields')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
      {analysis ? decisionContent : null}
      <details className="chart-source-note"><summary>What the chart contributes</summary><p>Trade Police evaluates completed market data against your saved trading rules. It does not use the chart image as the source of the verdict.</p></details>
      {error && <div className="error analysis-error" role="alert"><strong>No decision was produced.</strong><p>{error}</p><small>Failed market-analysis attempts are released and do not consume monthly usage. Your selected instrument and trading rules are unchanged.</small><button type="button" onClick={scan}>Retry analysis</button></div>}
    </section>
  );
}
