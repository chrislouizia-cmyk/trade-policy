'use client';

import type { RefObject } from 'react';
import type { ChartAnalysis, StrategyProfile, TradeResult } from '@/types/trade';
import { getDecisionHeroState, getAiDockStatus } from '@/lib/decision-hero';

type DecisionHeroProps = {
  analyzing: boolean;
  analysis: ChartAnalysis | null;
  result: TradeResult | null;
  strategy: StrategyProfile;
  threshold: number;
  primaryMissingCondition: string;
  nextActionValue: string;
  readinessInterpretation: string;
  onViewReport: () => void;
  reportButtonRef?: RefObject<HTMLButtonElement | null>;
};

function verdictVariant(verdict: string): 'positive' | 'warning' | 'neutral' | 'info' {
  if (verdict === 'READY') return 'positive';
  if (verdict === 'BLOCKED') return 'warning';
  if (verdict === 'ANALYZING') return 'info';
  if (verdict === 'DATA UNAVAILABLE' || verdict === 'NO SETUP') return 'warning';
  return 'neutral';
}

export default function DecisionHero({
  analyzing,
  analysis,
  result,
  strategy,
  threshold,
  primaryMissingCondition,
  nextActionValue,
  readinessInterpretation,
  onViewReport,
  reportButtonRef,
}: DecisionHeroProps) {
  const heroState = getDecisionHeroState({ analyzing, analysis, result, threshold });
  const dockStatus = getAiDockStatus({ analyzing, analysis, result, threshold });
  const readinessValue = heroState.showReadiness && heroState.readinessPercent != null
    ? `${heroState.readinessPercent}%`
    : '—';
  const readinessFill = heroState.showReadiness && heroState.readinessPercent != null
    ? `${Math.max(8, Math.min(100, heroState.readinessPercent))}%`
    : '0%';
  const instrument = analysis?.instrument ?? strategy.instruments[0] ?? '—';

  return (
    <section className="card decision-hero" aria-labelledby="decision-hero-title">
      <span className="sr-only">Required readiness</span>
      <span className="sr-only">View Decision Report</span>
      <div className="decision-hero-head">
        <div className="decision-hero-primary">
          <p className="brand">DECISION</p>
          <h1 id="decision-hero-title" className="decision-hero-verdict">
            <span className="sr-only">Decision verdict: </span>
            {heroState.verdict}
          </h1>
          <p className="decision-hero-instruction" aria-live="polite">
            {heroState.instruction}
          </p>
        </div>
        <div className="decision-hero-actions">
          <button
            ref={reportButtonRef}
            type="button"
            className="decision-hero-report-button"
            onClick={onViewReport}
          >
            View Decision Report
          </button>
        </div>
      </div>

      <div className="decision-hero-metrics">
        <div className={`decision-hero-metric decision-hero-readiness ${analysis ? '' : 'idle'}`}>
          <div className="decision-hero-metric-head">
            <span className="decision-hero-metric-label">Readiness</span>
            <strong className={`decision-hero-metric-value ${heroState.showReadiness && heroState.readinessPercent! >= threshold ? 'positive' : 'warning'}`}>
              {readinessValue}
            </strong>
          </div>
          <p className="decision-hero-metric-copy">{readinessInterpretation}</p>
          {heroState.showReadiness && (
            <div className="copilot-confidence-bar" aria-hidden="true">
              <span className={`copilot-confidence-fill ${dockStatus.variant}`} style={{ width: readinessFill }} />
            </div>
          )}
          <div className="decision-hero-metric-foot">
            <span>{heroState.showReadiness ? 'Required readiness' : 'No setup score'}</span>
            <span>{heroState.showReadiness ? `${threshold}%` : '—'}</span>
          </div>
        </div>

        <div className="decision-hero-metric">
          <div className="decision-hero-metric-head">
            <span className="decision-hero-metric-label">Strategy</span>
            <strong className="decision-hero-metric-value">{strategy.name}</strong>
          </div>
        </div>

        <div className="decision-hero-metric">
          <div className="decision-hero-metric-head">
            <span className="decision-hero-metric-label">Instrument</span>
            <strong className="decision-hero-metric-value">{instrument}</strong>
          </div>
        </div>

        <div className="decision-hero-metric">
          <div className="decision-hero-metric-head">
            <span className="decision-hero-metric-label">Market / data</span>
            <strong className={`decision-hero-metric-value ${verdictVariant(heroState.verdict)}`}>
              {heroState.marketState}
            </strong>
          </div>
        </div>

        <div className="decision-hero-metric">
          <div className="decision-hero-metric-head">
            <span className="decision-hero-metric-label">Missing confirmation</span>
            <strong className="decision-hero-metric-value warning">{primaryMissingCondition}</strong>
          </div>
        </div>

        <div className="decision-hero-metric">
          <div className="decision-hero-metric-head">
            <span className="decision-hero-metric-label">Next action</span>
            <strong className="decision-hero-metric-value">{nextActionValue}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
