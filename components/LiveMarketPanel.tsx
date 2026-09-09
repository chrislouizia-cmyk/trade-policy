'use client';

import { type ReactNode, useEffect, useState, useRef } from 'react';
import TradingViewChart from './TradingViewChart';
import TradingViewReferenceChart from './TradingViewReferenceChart';
import type { Instrument, StrategyProfile, ChartAnalysis } from '@/types/trade';
import type { PositionOverlayModel } from '@/lib/position-geometry';
import type {MarketChartSnapshot} from '@/lib/market-snapshot';

import {strategyTimeframeContext, supportedMarketTimeframesForStrategy} from '@/lib/strategy-timeframes';
import {apiErrorMessage,readApiResponse,redirectExpiredSession} from '@/lib/api-error';

const scanStages = [
  'Requesting market data',
  'Checking your required rules',
  'Preparing your Decision Report',
];

export const MINIMUM_DECISION_CHART_CANDLES=25;

export function marketAnalysisRetryDelay(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (code !== 'MARKET_DATA_RATE_LIMITED' && code !== 'MARKET_DATA_CREDIT_WINDOW') return null;
  const details = (error as { details?: unknown }).details;
  const requested = details && typeof details === 'object' ? Number((details as { retryAfterSeconds?: unknown }).retryAfterSeconds) : NaN;
  if(Number.isFinite(requested)&&requested>65)return null;
  return Number.isFinite(requested) ? Math.max(2, Math.ceil(requested)) : 61;
}

function displayOverlayPrice(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 5 });
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
  const [chartData, setChartData] = useState<MarketChartSnapshot['chart']|null>(null);
  const [snapshotCreatedAt,setSnapshotCreatedAt]=useState<string|null>(null);
  const [analysisSource,setAnalysisSource]=useState<'LIVE'|'SNAPSHOT'|null>(null);
  const [paintedChartKey,setPaintedChartKey]=useState<string|null>(null);
  const availableTimeframes = supportedMarketTimeframesForStrategy(strategy);
  const [chartTimeframe, setChartTimeframe] = useState(strategy.entryTimeframe || availableTimeframes[0] || 'H1');
  const analysisContextRef = useRef('');
  const retryTimerRef = useRef<number | null>(null);
  const snapshotControllerRef=useRef<AbortController|null>(null);

  useEffect(()=>{
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    snapshotControllerRef.current?.abort();
    snapshotControllerRef.current=null;
    retryTimerRef.current = null;
    analysisContextRef.current = `${strategy.id ?? ''}:${strategyRevisionId ?? ''}:${selectedInstrument}`;
    setChartData(null);
    setPaintedChartKey(null);
    setSnapshotCreatedAt(null);
    setAnalysisSource(null);
    setError('');
    setWaitingForMarketData(false);
    setLoading(false);
    onLoadingChange?.(false);
  },[selectedInstrument,strategy.id,strategyRevisionId]);

  useEffect(()=>{
    if(!strategy.id||!strategyRevisionId||strategyLoading)return;
    const controller=new AbortController();
    snapshotControllerRef.current=controller;
    const requestContextKey=`${strategy.id}:${strategyRevisionId}:${selectedInstrument}`;
    const params=new URLSearchParams({strategyId:strategy.id,strategyRevisionId,instrument:selectedInstrument});
    void fetch(`/api/market/snapshot?${params.toString()}`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{
        if(response.status===204)return null;
        if(!response.ok)throw new Error('snapshot-unavailable');
        return response.json() as Promise<MarketChartSnapshot>;
      })
      .then(snapshot=>{
        if(!snapshot||analysisContextRef.current!==requestContextKey)return;
        setChartData(snapshot.chart);
        setSnapshotCreatedAt(snapshot.snapshotCreatedAt);
        setAnalysisSource('SNAPSHOT');
      })
      .catch(error=>{if(error instanceof Error&&error.name==='AbortError')return;});
    return()=>{controller.abort();if(snapshotControllerRef.current===controller)snapshotControllerRef.current=null};
  },[selectedInstrument,strategy.id,strategyRevisionId,strategyLoading]);

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
    snapshotControllerRef.current?.abort();
    snapshotControllerRef.current=null;
    setWaitingForMarketData(false);
    onLoadingChange?.(true);
    setStageIndex(0);
    setError('');
    if(chartData){setAnalysisSource('SNAPSHOT');setSnapshotCreatedAt(chartData.calculatedAt)}
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

      setChartData(result as ChartAnalysis);
      setSnapshotCreatedAt(null);
      setAnalysisSource('LIVE');
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
  const activeTradeOverlay=positionOverlay?.status==='ACTIVE'&&positionOverlay.currentGeometry.instrument===selectedInstrument?positionOverlay:null;
  const activeTradeGeometry=activeTradeOverlay?.acceptedGeometry??activeTradeOverlay?.currentGeometry??null;
  const displayedCandles=chartData?.marketSeries?.[chartTimeframe]??null;
  const chartDataKey=displayedCandles?.length
    ? `${chartData?.analysisId??chartData?.calculatedAt??'analysis'}:${selectedInstrument}:${chartTimeframe}:${displayedCandles.length}:${displayedCandles[0]?.datetime??''}:${displayedCandles.at(-1)?.datetime??''}`
    : null;
  const hasCompleteChartSeries=Boolean(displayedCandles&&displayedCandles.length>=MINIMUM_DECISION_CHART_CANDLES);
  const analyzedChartReady=hasCompleteChartSeries&&chartDataKey!==null&&paintedChartKey===chartDataKey;
  const analyzedChartVisible=hasCompleteChartSeries&&chartDataKey!==null&&paintedChartKey!==null;

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
            {strategyLoading ? 'Applying strategy…' : !strategy.id || !strategyRevisionId ? 'Loading strategy…' : waitingForMarketData ? 'Waiting for fresh market data…' : loading ? scanStages[stageIndex] : analysisSource==='LIVE' ? 'Refresh market check' : 'Check current market'}
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
      {analysisSource==='SNAPSHOT'&&snapshotCreatedAt?<div className="market-snapshot-status" role="status"><strong>Saved market data</strong><span>From {new Date(snapshotCreatedAt).toLocaleString()} · Check current market when you want a new Decision.</span></div>:null}
      <div className="market-chart-stage">
        <div className={`market-chart-layer market-chart-reference-layer ${analyzedChartVisible?'is-hidden':''}`} aria-hidden={analyzedChartVisible} inert={analyzedChartVisible?true:undefined}>
          <TradingViewReferenceChart instrument={selectedInstrument} timeframe={chartTimeframe}/>
        </div>
        {hasCompleteChartSeries&&displayedCandles&&chartDataKey?<div className={`market-chart-layer market-chart-analysis-layer ${analyzedChartVisible?'is-ready':''}`} aria-hidden={!analyzedChartVisible} inert={!analyzedChartVisible?true:undefined} data-chart-current={analyzedChartReady}>
          <TradingViewChart instrument={selectedInstrument} timeframe={chartTimeframe} seedCandles={displayedCandles} seedProvider={chartData?.provider??null} overlay={positionOverlay?.currentGeometry.instrument === selectedInstrument ? positionOverlay : null} onOverlayClick={() => document.getElementById('position-geometry-fields')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} onDataReady={(renderedCandleCount)=>{if(renderedCandleCount>=MINIMUM_DECISION_CHART_CANDLES)setPaintedChartKey(chartDataKey)}} />
        </div>:null}
        {activeTradeOverlay&&activeTradeGeometry?<aside className={`market-active-trade-overlay direction-${activeTradeGeometry.direction.toLowerCase()}`} aria-label={`Active ${activeTradeGeometry.direction} trade on ${selectedInstrument}`}>
          <div className="market-active-trade-heading"><span>Active trade</span><strong>{activeTradeGeometry.direction} · {selectedInstrument}</strong></div>
          <dl>
            <div><dt>Entry</dt><dd>{displayOverlayPrice(activeTradeGeometry.entry)}</dd></div>
            <div><dt>Stop</dt><dd>{displayOverlayPrice(activeTradeGeometry.stopLoss)}</dd></div>
            <div><dt>Target</dt><dd>{displayOverlayPrice(activeTradeGeometry.takeProfit)}</dd></div>
            <div><dt>Planned RR</dt><dd>{activeTradeOverlay.acceptedPlannedRR==null?'—':`1:${activeTradeOverlay.acceptedPlannedRR.toFixed(2)}`}</dd></div>
          </dl>
          <a href="/active-trade">View active trade</a>
        </aside>:null}
      </div>
      {analysisSource==='LIVE' ? decisionContent : null}
      <details className="chart-source-note"><summary>What the chart contributes</summary><p>Trade Police evaluates completed market data against your saved trading rules. It does not use the chart image as the source of the verdict.</p></details>
      {error && <div className="error analysis-error" role="alert"><strong>Market check needs another moment.</strong><p>{error}</p><small>Nothing was changed or counted. Your selected instrument and trading rules are safe.</small><button type="button" onClick={() => { void scan(); }}>Try again</button></div>}
    </section>
  );
}
