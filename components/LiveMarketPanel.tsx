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

export function marketAnalysisRetryDelay(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (code !== 'MARKET_DATA_RATE_LIMITED' && code !== 'MARKET_DATA_CREDIT_WINDOW') return null;
  const details = (error as { details?: unknown }).details;
  const requested = details && typeof details === 'object' ? Number((details as { retryAfterSeconds?: unknown }).retryAfterSeconds) : NaN;
  return Number.isFinite(requested) ? Math.max(2, Math.min(65, Math.ceil(requested))) : 61;
}

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
  const [waitingForMarketData, setWaitingForMarketData] = useState(false);
  const [analysis, setAnalysis] = useState<ChartAnalysis|null>(null);
  const availableTimeframes = supportedMarketTimeframesForStrategy(strategy);
  const [chartTimeframe, setChartTimeframe] = useState(strategy.entryTimeframe || availableTimeframes[0] || 'H1');
  const analysisContextRef = useRef('');
  const retryTimerRef = useRef<number | null>(null);

  useEffect(()=>{
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    analysisContextRef.current = `${strategy.id ?? ''}:${strategyRevisionId ?? ''}:${selectedInstrument}`;
    setAnalysis(null);
    setError('');
    setWaitingForMarketData(false);
    setLoading(false);
    onLoadingChange?.(false);
  },[selectedInstrument,strategy.id,strategyRevisionId]);

  useEffect(() => () => {
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
  }, []);

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

  async function scan(retryAttempt = 0) {
    if (!strategy.id || !strategyRevisionId) {
      setError('The selected strategy is still loading. Please wait a moment and try again.');
      return;
    }
    setLoading(true);
    setWaitingForMarketData(false);
    onLoadingChange?.(true);
    setStageIndex(0);
    setError('');
    setAnalysis(null);
    if (retryAttempt === 0) onReset?.();

    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),25_000);
    let retryScheduled = false;
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
        const retryDelay = marketAnalysisRetryDelay(result);
        if (retryAttempt === 0 && retryDelay !== null) {
          retryScheduled = true;
          setWaitingForMarketData(true);
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            void scan(1);
          }, retryDelay * 1_000);
          return;
        }
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
      if (!retryScheduled) {
        setWaitingForMarketData(false);
        setLoading(false);
        onLoadingChange?.(false);
      }
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
          <button className="primary" data-market-check type="button" onClick={() => { void scan(); }} disabled={loading || strategyLoading || !strategy.id || !strategyRevisionId}>
            {strategyLoading ? 'Applying strategy…' : !strategy.id || !strategyRevisionId ? 'Loading strategy…' : waitingForMarketData ? 'Waiting for fresh market data…' : loading ? scanStages[stageIndex] : analysis ? 'Refresh market check' : 'Check current market'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="analysis-progress" aria-live="polite" aria-busy="true">
          <div className="analysis-progress-track">
            <span style={{ width: `${((stageIndex + 1) / scanStages.length) * 100}%` }} />
          </div>
          <div className="analysis-progress-stages" aria-hidden="true">{scanStages.map((stage,index)=><i className={index<stageIndex?'complete':index===stageIndex?'current':''} key={stage}/>)}</div>
          <small>{waitingForMarketData ? 'Market data is refreshing. Trade Police will continue automatically.' : scanStages[stageIndex]}</small>
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
      {error && <div className="error analysis-error" role="alert"><strong>Market check needs another moment.</strong><p>{error}</p><small>Nothing was changed or counted. Your selected instrument and trading rules are safe.</small><button type="button" onClick={() => { void scan(); }}>Try again</button></div>}
    </section>
  );
}
