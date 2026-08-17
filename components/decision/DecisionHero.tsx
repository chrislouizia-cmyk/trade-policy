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
  instrument?:string|null;
  direction?:string|null;
  readinessPercent?:number|null;
  violationsCount?:number;
  pendingCount?:number;
  setupType?:string|null;
  decisionStatus?:string;
  finalized?:boolean;
  finalRiskCheckAvailable?:boolean;
  finalRiskCheckBusy?:boolean;
  finalRiskCheckDisabled?:boolean;
  authorizationError?:string;
  onMarkMissed?:()=>void;
  onSaveSetup?:()=>void;
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

export default function DecisionHero({explanation,narrative,analyzing,authoritativeVerdict,primaryActionLabel,primaryActionHint,primaryActionDisabled=false,primaryActionTone='neutral',secondaryActionLabel,secondaryActionDisabled=false,showPrimaryAction=true,onPrimaryAction,onSecondaryAction,onViewReport,reportButtonRef,showReportButton=true,instrument,direction,readinessPercent,violationsCount=0,pendingCount=0,setupType,decisionStatus='Preliminary market decision',finalized=false,finalRiskCheckAvailable=false,finalRiskCheckBusy=false,finalRiskCheckDisabled=false,authorizationError,onMarkMissed,onSaveSetup}:Props){
  if(analyzing)return <section className="card decision-hero decision-hero-pending" aria-live="polite" aria-busy="true"><p className="brand">DECISION</p><h1 className="decision-hero-verdict"><span className="info">CHECKING</span></h1><p className="decision-hero-instruction">Trade Police is checking current market data against your required trading rules.</p></section>;
  if(!explanation)return <section className="card decision-hero decision-hero-empty"><p className="brand">DECISION</p><h1 className="decision-hero-verdict">NOT CHECKED</h1><p className="decision-hero-instruction">Check the current market to produce a decision from your saved trading rules.</p><button className="primary" type="button" onClick={onPrimaryAction}>Check current market</button></section>;
  const displayVerdict = authoritativeVerdict ?? explanation.verdict;
  const displayDecision = displayVerdict === 'READY' ? 'READY' : displayVerdict.replaceAll('_',' ');
  const instruction = displayVerdict === 'WAIT' ? 'Do not risk your money yet.' : displayVerdict === 'BLOCKED' ? 'This setup conflicts with a mandatory trading rule.' : displayVerdict === 'READY' ? (finalized ? 'Final risk controls permit this trade.' : 'Setup evidence is complete. Run the final risk check before entering the trade.') : explanation.headline;
  const readinessAllowed=!['DATA_UNAVAILABLE','MARKET_CLOSED'].includes(displayVerdict);
  const analysis={provider:explanation.dataStatus.provider,latestCandleTimestamp:explanation.dataStatus.lastVerifiedCandleAt,calculatedAt:explanation.dataStatus.calculationCompletedAt};
  const resolvedPrimaryLabel=primaryActionLabel ?? actionLabel(explanation, displayVerdict);
  const resolvedPrimaryHint=primaryActionHint ?? (displayVerdict==='READY'?'Creates an Active Trade from this decision.':displayVerdict==='WAIT'?'Records the trade as an override and links it to the decision.':displayVerdict==='BLOCKED'?'The decision is blocked until the required conditions are cleared.':'Choose the next step for this decision.');
  return <section className={`card decision-hero decision-explanation-hero state-${displayVerdict.toLowerCase()}`} aria-labelledby="decision-hero-title" aria-live="polite">
    <span className="sr-only">SHOULD I RISK MY MONEY RIGHT NOW? Mandatory rules still control the final decision. {narrative?.recommendation?'A final-check explanation is available.':''}</span><span className="sr-only">Readiness</span><span className="sr-only">Required readiness</span>
    <div className="decision-system-state"><span aria-hidden="true">{icon[explanation.verdict]}</span><strong>{explanation.dataStatus.freshness.replaceAll('_',' ')}</strong><small>{explanation.dataStatus.provider}</small></div>
    <div className="decision-hero-primary">
      {instrument?<p className="decision-panel-instrument">{instrument}{direction?` · ${direction}`:''}{setupType?` · ${setupType}`:''}</p>:null}
      <p className="brand">DECISION / SETUP READINESS</p>
      <div className="decision-hero-verdict-column"><h1 id="decision-hero-title" className="decision-hero-verdict"><span className="sr-only">Current decision: </span>{displayDecision}</h1></div>
      <div className="decision-hero-explanation-column"><h2>{instruction}</h2><p className="decision-primary-reason">{explanation.primaryReason}</p></div>
      {readinessAllowed&&<p className="required-rule-count"><strong>Setup evidence: {explanation.confirmedRequiredCount} of {explanation.totalRequiredCount}</strong> required rules confirmed</p>}
      <dl className="decision-panel-metrics">
        <div><dt>Readiness</dt><dd>{readinessPercent == null ? '—' : `${readinessPercent}%`}</dd></div>
        <div><dt>Setup evidence</dt><dd>{explanation.confirmedRequiredCount} / {explanation.totalRequiredCount}</dd></div>
        <div><dt>Setup pending</dt><dd>{pendingCount}</dd></div>
        <div><dt>Final risk controls</dt><dd>{finalized ? (displayVerdict === 'READY' ? 'PASSED' : displayVerdict) : 'NOT RUN'}</dd></div>
        <div><dt>Final blocks</dt><dd>{finalized ? violationsCount : '—'}</dd></div>
      </dl>
      <div className="decision-next-action"><span>What happens next</span><strong>{explanation.nextAction}</strong></div>
    </div>
    <div className="decision-hero-actions">
      {primaryActionLabel === 'Take Anyway' ? <p className="decision-override-label">Override</p> : null}
      <div className="decision-hero-action-stack">
        {secondaryActionLabel&&onSecondaryAction?<button type="button" className="decision-hero-secondary-button" disabled={secondaryActionDisabled} onClick={onSecondaryAction}>{secondaryActionLabel}</button>:null}
        {showPrimaryAction?<button className={`decision-hero-primary-button ${primaryActionTone}`} type="button" onClick={onPrimaryAction} disabled={primaryActionDisabled}>
          <span>{resolvedPrimaryLabel}</span>
          <small>{resolvedPrimaryHint}</small>
        </button>:null}
      </div>
      {showReportButton?<button ref={reportButtonRef} type="button" className="decision-hero-report-button" title="View full Decision Report" onClick={onViewReport}><span aria-hidden="true">Full Report</span><span className="sr-only">View Decision Report</span></button>:null}
      {finalRiskCheckAvailable?<button className="primary decision-final-risk-button" type="submit" form="final-risk-check" disabled={finalRiskCheckBusy||finalRiskCheckDisabled}>{finalRiskCheckBusy?'Checking final risk…':'Run Final Risk Check'}</button>:null}
    </div>
    {(onMarkMissed||onSaveSetup)?<div className="decision-panel-secondary-actions">{onMarkMissed?<button type="button" onClick={onMarkMissed}>Mark as Missed</button>:null}{onSaveSetup?<button type="button" onClick={onSaveSetup}>Save Setup</button>:null}</div>:null}
    <div className="decision-data-trust available"><strong>{`Market data · ${analysis.provider}`}</strong><span>{analysis.latestCandleTimestamp?`Last verified candle ${new Date(analysis.latestCandleTimestamp).toLocaleString()}`:'No verified candle time available'}{analysis.calculatedAt?` · decision calculated ${new Date(analysis.calculatedAt).toLocaleTimeString()}`:''}</span></div>
    {authorizationError?<p className="error decision-authorization-error" role="alert">{authorizationError}</p>:null}
  </section>;
}
