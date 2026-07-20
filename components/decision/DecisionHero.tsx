'use client';

import type { RefObject } from 'react';
import type { ChartAnalysis, StrategyProfile, TradeResult } from '@/types/trade';
import type { DecisionNarrative } from '@/types/intelligence';
import { getDecisionHeroState, getAiDockStatus } from '@/lib/decision-hero';

type DecisionHeroProps = {
  analyzing: boolean;
  analysis: ChartAnalysis | null;
  result: TradeResult | null;
  narrative?: DecisionNarrative;
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
  narrative,
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
  const answer = narrative?.recommendation ?? heroState.verdict;
  const answerVariant = narrative?.recommendation === 'ENTER'
    ? 'positive'
    : narrative?.recommendation === 'WAIT' || narrative?.recommendation === 'BLOCK'
      ? 'warning'
      : verdictVariant(heroState.verdict);
  const currentReadiness = narrative?.readiness.currentScore ?? heroState.readinessPercent;
  const requiredReadiness = narrative?.readiness.requiredScore ?? threshold;

  return (
    <section className="card decision-hero" aria-labelledby="decision-hero-title">
      <span className="sr-only">Required readiness</span>
      <span className="sr-only">View Decision Report</span>
      <div className="decision-hero-head">
        <div className="decision-hero-primary">
          <p className="brand">SHOULD I TAKE THIS TRADE?</p>
          <h1 id="decision-hero-title" className="decision-hero-verdict">
            <span className="sr-only">Decision verdict: </span>
            <span className={answerVariant}>{answer}</span>
          </h1>
          <p className="decision-hero-instruction" aria-live="polite">
            {narrative?.headline ?? heroState.instruction}
          </p>
          {narrative ? <p className="decision-hero-explanation">{narrative.explanation}</p> : null}
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
              {currentReadiness == null ? readinessValue : `${currentReadiness}%`}
            </strong>
          </div>
          <p className="decision-hero-metric-copy">{narrative?.readiness.label ?? readinessInterpretation}</p>
          {heroState.showReadiness && (
            <div className="copilot-confidence-bar" aria-hidden="true">
              <span className={`copilot-confidence-fill ${dockStatus.variant}`} style={{ width: readinessFill }} />
            </div>
          )}
          <div className="decision-hero-metric-foot">
            <span>{heroState.showReadiness ? 'Required readiness' : 'No setup score'}</span>
            <span>{requiredReadiness == null ? '—' : `${requiredReadiness}%`}</span>
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
            <span className="decision-hero-metric-label">Missing</span>
            <strong className="decision-hero-metric-value warning">{narrative?.missingEvidence[0]?.label ?? primaryMissingCondition}</strong>
          </div>
        </div>

        <div className="decision-hero-metric">
          <div className="decision-hero-metric-head">
            <span className="decision-hero-metric-label">Next action</span>
            <strong className="decision-hero-metric-value">{narrative?.nextActions[0]?.label ?? nextActionValue}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
