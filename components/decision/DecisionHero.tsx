'use client';

import type {RefObject} from 'react';
import type {DecisionExplanationSummary,DecisionNarrative} from '@/types/intelligence';

type Props={
  explanation:DecisionExplanationSummary|null;
  narrative?:DecisionNarrative;
  analyzing:boolean;
  authoritativeVerdict?:string|null;
  primaryActionLabel?:string;
  primaryActionHint?:string;
  primaryActionDisabled?:boolean;
  primaryActionTone?:'success'|'warning'|'danger'|'neutral';
  secondaryActionLabel?:string;
  secondaryActionDisabled?:boolean;
  showPrimaryAction?:boolean;
  onPrimaryAction:()=>void;
  onSecondaryAction?:()=>void;
  onViewReport:()=>void;
  reportButtonRef?:RefObject<HTMLButtonElement|null>;
  showReportButton?:boolean;
};

const icon={READY:'✓',WAIT:'…',BLOCKED:'!',NO_SETUP:'○',MARKET_CLOSED:'○',DATA_UNAVAILABLE:'!',STRATEGY_INCOMPLETE:'!'} as const;

function actionLabel(explanation:DecisionExplanationSummary|null, authoritativeVerdict?:string|null):string{
  if(!explanation)return 'Check current market';
  const verdict = authoritativeVerdict ?? explanation.verdict;
  if(verdict==='READY')return 'Take Trade';
  if(verdict==='WAIT')return 'Take Anyway';
  if(verdict==='BLOCKED')return 'Blocked';
  if(verdict==='DATA_UNAVAILABLE'||verdict==='MARKET_CLOSED')return 'Retry analysis';
  if(verdict==='STRATEGY_INCOMPLETE')return 'Review trading rules';
  return 'Check again';
}

export default function DecisionHero({explanation,narrative,analyzing,authoritativeVerdict,primaryActionLabel,primaryActionHint,primaryActionDisabled=false,primaryActionTone='neutral',secondaryActionLabel,secondaryActionDisabled=false,showPrimaryAction=true,onPrimaryAction,onSecondaryAction,onViewReport,reportButtonRef,showReportButton=true}:Props){
  if(analyzing)return <section className="card decision-hero decision-hero-pending" aria-live="polite" aria-busy="true"><p className="brand">DECISION</p><h1 className="decision-hero-verdict"><span className="info">CHECKING</span></h1><p className="decision-hero-instruction">Trade Police is checking current market data against your required trading rules.</p></section>;
  if(!explanation)return <section className="card decision-hero decision-hero-empty"><p className="brand">DECISION</p><h1 className="decision-hero-verdict">NOT CHECKED</h1><p className="decision-hero-instruction">Check the current market to produce a decision from your saved trading rules.</p><button className="primary" type="button" onClick={onPrimaryAction}>Check current market</button></section>;
  const displayVerdict = authoritativeVerdict ?? explanation.verdict;
  const readinessAllowed=!['DATA_UNAVAILABLE','MARKET_CLOSED'].includes(displayVerdict);
  const analysis={provider:explanation.dataStatus.provider,latestCandleTimestamp:explanation.dataStatus.lastVerifiedCandleAt,calculatedAt:explanation.dataStatus.calculationCompletedAt};
  const resolvedPrimaryLabel=primaryActionLabel ?? actionLabel(explanation, displayVerdict);
  const resolvedPrimaryHint=primaryActionHint ?? (displayVerdict==='READY'?'Creates an Active Trade from this decision.':displayVerdict==='WAIT'?'Records the trade as an override and links it to the decision.':displayVerdict==='BLOCKED'?'The decision is blocked until the required conditions are cleared.':'Choose the next step for this decision.');
  return <section className={`card decision-hero decision-explanation-hero state-${displayVerdict.toLowerCase()}`} aria-labelledby="decision-hero-title" aria-live="polite">
    <span className="sr-only">SHOULD I RISK MY MONEY RIGHT NOW? Mandatory rules still control the final decision. {narrative?.recommendation?'A final-check explanation is available.':''}</span><span className="sr-only">Readiness</span><span className="sr-only">Required readiness</span>
    <div className="decision-system-state"><span aria-hidden="true">{icon[explanation.verdict]}</span><strong>{explanation.dataStatus.freshness.replaceAll('_',' ')}</strong><small>{explanation.dataStatus.provider}</small></div>
    <div className="decision-hero-primary">
      <p className="brand">DECISION</p>
      <h1 id="decision-hero-title" className="decision-hero-verdict"><span className="sr-only">Decision: </span>{displayVerdict.replaceAll('_',' ')}</h1>
      <h2>{explanation.headline}</h2>
      <p className="decision-primary-reason">{explanation.primaryReason}</p>
      {readinessAllowed&&<p className="required-rule-count"><strong>{explanation.confirmedRequiredCount} of {explanation.totalRequiredCount}</strong> required rules confirmed</p>}
      <div className="decision-next-action"><span>What happens next</span><strong>{explanation.nextAction}</strong></div>
    </div>
    <div className="decision-hero-actions">
      <div className="decision-hero-action-stack">
        {secondaryActionLabel&&onSecondaryAction?<button type="button" className="decision-hero-secondary-button" disabled={secondaryActionDisabled} onClick={onSecondaryAction}>{secondaryActionLabel}</button>:null}
        {showPrimaryAction?<button className={`decision-hero-primary-button ${primaryActionTone}`} type="button" onClick={onPrimaryAction} disabled={primaryActionDisabled}>
          <span>{resolvedPrimaryLabel}</span>
          <small>{resolvedPrimaryHint}</small>
        </button>:null}
      </div>
      {showReportButton?<button ref={reportButtonRef} type="button" className="decision-hero-report-button" onClick={onViewReport}><span aria-hidden="true">View full Decision Report</span><span className="sr-only">View Decision Report</span></button>:null}
    </div>
    <div className="decision-data-trust available"><strong>{`Market data · ${analysis.provider}`}</strong><span>{analysis.latestCandleTimestamp?`Last verified candle ${new Date(analysis.latestCandleTimestamp).toLocaleString()}`:'No verified candle time available'}{analysis.calculatedAt?` · decision calculated ${new Date(analysis.calculatedAt).toLocaleTimeString()}`:''}</span></div>
  </section>;
}
