'use client';

import { useEffect, useState } from 'react';
import TradingViewChart from './TradingViewChart';
import type { Instrument, StrategyProfile, ChartAnalysis } from '@/types/trade';

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

    try {
      const response = await fetch('/api/market/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Market analysis is temporarily unavailable. Please try again shortly.');
        return;
      }

      setAnalysis(result);
      onApply(result as ChartAnalysis);
    } catch {
      setError('Market analysis is temporarily unavailable. Please try again shortly.');
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  }

  return (
    <section className="card live-panel">
      <div className="live-head">
        <div>
          <p className="brand">LIVE DATA MODE</p>
          <h2>Analyze configured timeframes automatically</h2>
          <p className="muted">Trade Police reads {strategy.trendTimeframe}, {' '}{strategy.confirmationTimeframe}, and {strategy.entryTimeframe} from live market data.</p>
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
            {loading ? scanStages[stageIndex] : analysis ? 'Refresh analysis' : 'Analyze live market'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="analysis-progress" aria-live="polite">
          <div className="analysis-progress-track">
            <span style={{ width: `${((stageIndex + 1) / scanStages.length) * 100}%` }} />
          </div>
          <small>{scanStages[stageIndex]}</small>
        </div>
      )}

      <TradingViewChart instrument={instrument} />
      {error && <p className="error">{error}</p>}
      {analysis && (
        <div className="analysis-strip">
          <strong>{analysis.status==='NO_RELEVANT_EVIDENCE'?'No setup detected':analysis.status==='STRATEGY_UNSUPPORTED'?'Strategy rules not supported by live analysis':analysis.status==='STRATEGY_INCOMPLETE'?'Strategy configuration incomplete':analysis.status==='INSUFFICIENT_DATA'?'Insufficient market data':analysis.status==='ANALYSIS_FAILED'?'Analysis unavailable':analysis.setupType}</strong>
          {analysis.status==='VALID_ANALYSIS'&&<><span>Live setup confidence {analysis.liveAnalysisConfidence}%</span><span>Strategy required threshold {analysis.strategyConfidenceThreshold}%</span><span>{analysis.liveAnalysisConfidence>=analysis.strategyConfidenceThreshold?'Meets strategy threshold':'Below strategy threshold'}</span></>}
          <span>Last analyzed: {new Date(analysis.calculatedAt).toLocaleTimeString()}</span>
          <span>{analysis.instrument} · {analysis.timeframe}</span>
          <span>Market data: {analysis.provider} · latest candle {analysis.latestCandleTimestamp}</span>
        </div>
      )}
    </section>
  );
}
