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
}: {
  strategy: StrategyProfile;
  onApply: (analysis: ChartAnalysis) => void;
}) {
  const [instrument, setInstrument] = useState<Instrument>(
    strategy.instruments[0] || 'XAUUSD',
  );
  const [loading, setLoading] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);

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
    }
  }

  return (
    <section className="card live-panel">
      <div className="live-head">
        <div>
          <p className="brand">LIVE DATA MODE</p>
          <h2>Analyze configured timeframes automatically</h2>
          <p className="muted">
            No screenshots required. Trade Police reads {strategy.trendTimeframe}, {' '}
            {strategy.confirmationTimeframe}, and {strategy.entryTimeframe}.
          </p>
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
            {loading ? scanStages[stageIndex] : 'Analyze live market'}
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
          <strong>{analysis.setupType}</strong>
          <span>Confidence {analysis.setupConfidence}%</span>
          <span>{analysis.suggestedDirection || 'NO BIAS'}</span>
          <span>Market data connected</span>
        </div>
      )}
    </section>
  );
}
