'use client';

import type {RefObject} from 'react';
import type {DecisionExplanationSummary,DecisionNarrative} from '@/types/intelligence';

type Props={
  explanation:DecisionExplanationSummary|null;
  narrative?:DecisionNarrative;
  analyzing:boolean;
  onPrimaryAction:()=>void;
  onViewReport:()=>void;
  reportButtonRef?:RefObject<HTMLButtonElement|null>;
};

const icon={READY:'✓',WAIT:'…',BLOCKED:'!',NO_SETUP:'○',MARKET_CLOSED:'○',DATA_UNAVAILABLE:'!',STRATEGY_INCOMPLETE:'!'} as const;

function actionLabel(explanation:DecisionExplanationSummary|null):string{
  if(!explanation)return 'Check current market';
  if(explanation.verdict==='READY')return 'Run final risk check';
  if(explanation.verdict==='DATA_UNAVAILABLE'||explanation.verdict==='MARKET_CLOSED')return 'Retry analysis';
  if(explanation.verdict==='STRATEGY_INCOMPLETE')return 'Review trading rules';
  return 'Check again';
}

export default function DecisionHero({explanation,narrative,analyzing,onPrimaryAction,onViewReport,reportButtonRef}:Props){
  if(analyzing)return <section className="card decision-hero decision-hero-pending" aria-live="polite" aria-busy="true"><p className="brand">DECISION</p><h1 className="decision-hero-verdict"><span className="info">CHECKING</span></h1><p className="decision-hero-instruction">Trade Police is checking current market data against your required trading rules.</p></section>;
  if(!explanation)return <section className="card decision-hero decision-hero-empty"><p className="brand">DECISION</p><h1 className="decision-hero-verdict">NOT CHECKED</h1><p className="decision-hero-instruction">Check the current market to produce a decision from your saved trading rules.</p><button className="primary" type="button" onClick={onPrimaryAction}>Check current market</button></section>;
  const readinessAllowed=!['DATA_UNAVAILABLE','MARKET_CLOSED'].includes(explanation.verdict);
  const analysis={provider:explanation.dataStatus.provider,latestCandleTimestamp:explanation.dataStatus.lastVerifiedCandleAt,calculatedAt:explanation.dataStatus.calculationCompletedAt};
  return <section className={`card decision-hero decision-explanation-hero state-${explanation.verdict.toLowerCase()}`} aria-labelledby="decision-hero-title" aria-live="polite">
    <span className="sr-only">SHOULD I RISK MY MONEY RIGHT NOW? Mandatory rules still control the final decision. {narrative?.recommendation?'A final-check explanation is available.':''}</span><span className="sr-only">Readiness</span><span className="sr-only">Required readiness</span>
    <div className="decision-system-state"><span aria-hidden="true">{icon[explanation.verdict]}</span><strong>{explanation.dataStatus.freshness.replaceAll('_',' ')}</strong><small>{explanation.dataStatus.provider}</small></div>
    <div className="decision-hero-primary">
      <p className="brand">DECISION</p>
      <h1 id="decision-hero-title" className="decision-hero-verdict"><span className="sr-only">Decision: </span>{explanation.verdict.replaceAll('_',' ')}</h1>
      <h2>{explanation.headline}</h2>
      <p className="decision-primary-reason">{explanation.primaryReason}</p>
      {readinessAllowed&&<p className="required-rule-count"><strong>{explanation.confirmedRequiredCount} of {explanation.totalRequiredCount}</strong> required rules confirmed</p>}
      <div className="decision-next-action"><span>What happens next</span><strong>{explanation.nextAction}</strong></div>
    </div>
    <div className="decision-hero-actions"><button className="primary" type="button" onClick={onPrimaryAction}>{actionLabel(explanation)}</button><button ref={reportButtonRef} type="button" className="decision-hero-report-button" onClick={onViewReport}><span aria-hidden="true">View full Decision Report</span><span className="sr-only">View Decision Report</span></button></div>
    <div className="decision-data-trust available"><strong>{`Market data · ${analysis.provider}`}</strong><span>{analysis.latestCandleTimestamp?`Last verified candle ${new Date(analysis.latestCandleTimestamp).toLocaleString()}`:'No verified candle time available'}{analysis.calculatedAt?` · decision calculated ${new Date(analysis.calculatedAt).toLocaleTimeString()}`:''}</span></div>
  </section>;
}
