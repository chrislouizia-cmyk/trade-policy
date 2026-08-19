'use client';

import { type ReactNode, useEffect, useState } from 'react';
import TradingViewChart from './TradingViewChart';
import type { Instrument, StrategyProfile, ChartAnalysis } from '@/types/trade';

import {strategyTimeframeContext} from '@/lib/strategy-timeframes';
import {apiErrorMessage,readApiResponse,redirectExpiredSession} from '@/lib/api-error';

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
  decisionContent,
}: {
  strategy: StrategyProfile;
  onApply: (analysis: ChartAnalysis) => void;
  onReset?: () => void;
  onLoadingChange?: (loading: boolean) => void;
  selectedInstrument: Instrument;
  onInstrumentChange: (instrument: Instrument) => void;
  decisionContent?: ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<ChartAnalysis|null>(null);

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

  const strategyContextText = strategyTimeframeContext(strategy);

  return (
    <section className="card live-panel">
      <div className="live-head">
        <div>
          <p className="brand">STEP 1 · CHECK CURRENT MARKET</p>
          <h2>Read the evidence for this strategy</h2>
          {strategyContextText ? <p className="muted">{strategyContextText}</p> : null}
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
      {analysis ? decisionContent : null}
      <details className="chart-source-note"><summary>What the chart contributes</summary><p>Trade Police evaluates completed market data against your saved trading rules. It does not use the chart image as the source of the verdict.</p></details>
      {error && <div className="error analysis-error" role="alert"><strong>No decision was produced.</strong><p>{error}</p><small>Failed market-analysis attempts are released and do not consume monthly usage. Your selected instrument and trading rules are unchanged.</small><button type="button" onClick={scan}>Retry analysis</button></div>}
    </section>
  );
}
