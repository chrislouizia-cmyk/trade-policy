'use client';

import type {RefObject} from 'react';
import type {DecisionExplanationSummary,DecisionNarrative} from '@/types/intelligence';
import {useLocale} from '@/components/i18n/LocaleProvider';
import DecisionStateGuide from '@/components/DecisionStateGuide';

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
  technicalCandidateFound?:boolean;
  manualPendingCount?:number;
  ruleBlockerCount?:number;
  setupType?:string|null;
  decisionStatus?:string;
  experienceGuidance?:string;
  experienceLevel?:string|null;
  finalized?:boolean;
  finalRiskCheckAvailable?:boolean;
  finalRiskCheckBusy?:boolean;
  finalRiskCheckDisabled?:boolean;
  authorizationError?:string;
  onMarkMissed?:()=>void;
  onViewHistory?:()=>void;
};

const icon={READY:'✓',WAIT:'…',BLOCKED:'!',NO_SETUP:'○',MARKET_CLOSED:'○',DATA_UNAVAILABLE:'!',STRATEGY_INCOMPLETE:'!'} as const;

const decisionCopy={
  en:{checking:'CHECKING',unchecked:'START HERE',setupFound:'SETUP FOUND',takeIt:'TAKE IT',wait:'WAIT',blocked:"DON'T TAKE IT",noSetup:'NO SETUP',marketClosed:'MARKET CLOSED',dataUnavailable:'TRY AGAIN',strategyIncomplete:'FINISH SETUP',details:'See decision details',systemState:'System status'},
  es:{checking:'REVISANDO',unchecked:'EMPIEZA AQUÍ',setupFound:'SETUP ENCONTRADO',takeIt:'TÓMALO',wait:'ESPERA',blocked:'NO LO TOMES',noSetup:'SIN SETUP',marketClosed:'MERCADO CERRADO',dataUnavailable:'INTENTA DE NUEVO',strategyIncomplete:'COMPLETA TU SETUP',details:'Ver detalles de la decisión',systemState:'Estado del sistema'},
  fr:{checking:'VÉRIFICATION',unchecked:'COMMENCEZ ICI',setupFound:'SETUP TROUVÉ',takeIt:'PRENEZ-LE',wait:'ATTENDEZ',blocked:'NE LE PRENEZ PAS',noSetup:'AUCUN SETUP',marketClosed:'MARCHÉ FERMÉ',dataUnavailable:'RÉESSAYER',strategyIncomplete:'TERMINER LE SETUP',details:'Voir les détails de la décision',systemState:'État du système'},
} as const;

function humanDecision(verdict:string,finalized:boolean,copy:(typeof decisionCopy)[keyof typeof decisionCopy]){
  if(verdict==='READY')return finalized?copy.takeIt:copy.setupFound;
  if(verdict==='WAIT')return copy.wait;
  if(verdict==='BLOCKED')return copy.blocked;
  if(verdict==='NO_SETUP'||verdict==='NO SETUP')return copy.noSetup;
  if(verdict==='MARKET_CLOSED')return copy.marketClosed;
  if(verdict==='DATA_UNAVAILABLE')return copy.dataUnavailable;
  if(verdict==='STRATEGY_INCOMPLETE')return copy.strategyIncomplete;
  return verdict.replaceAll('_',' ');
}

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

export default function DecisionHero({explanation,narrative,analyzing,authoritativeVerdict,primaryActionLabel,primaryActionHint,primaryActionDisabled=false,primaryActionTone='neutral',secondaryActionLabel,secondaryActionDisabled=false,showPrimaryAction=true,onPrimaryAction,onSecondaryAction,onViewReport,reportButtonRef,showReportButton=true,instrument,direction,readinessPercent,violationsCount=0,pendingCount=0,technicalCandidateFound=false,manualPendingCount=0,ruleBlockerCount=0,setupType,decisionStatus='Preliminary market decision',experienceGuidance,experienceLevel,finalized=false,finalRiskCheckAvailable=false,finalRiskCheckBusy=false,finalRiskCheckDisabled=false,authorizationError,onMarkMissed,onViewHistory}:Props){
  const {locale}=useLocale();
  const c=decisionCopy[locale];
  if(analyzing)return <section className="card decision-hero decision-hero-pending" aria-live="polite" aria-busy="true"><p className="brand">TRADE POLICE</p><h1 className="decision-hero-verdict"><span className="info">{c.checking}</span></h1><p className="decision-hero-instruction">Trade Police is checking the market against the rules you saved.</p></section>;
  if(!explanation)return <section className="card decision-hero decision-hero-empty"><p className="brand">YOUR NEXT STEP</p><h1 className="decision-hero-verdict">{c.unchecked}</h1><p className="decision-hero-instruction">Check the market. Trade Police will tell you whether to continue, wait, or skip the trade.</p><button className="primary" type="button" onClick={onPrimaryAction}>Check current market</button></section>;
  const displayVerdict = authoritativeVerdict ?? explanation.verdict;
  const displayDecision = humanDecision(displayVerdict,finalized,c);
  const instruction = experienceGuidance ?? (displayVerdict === 'WAIT' ? 'Do not risk your money yet.' : displayVerdict === 'BLOCKED' ? 'This setup conflicts with a mandatory trading rule.' : displayVerdict === 'READY' ? (finalized ? 'Final risk controls permit this trade.' : 'Setup evidence is complete. Run the final risk check before entering the trade.') : explanation.headline);
  const readinessAllowed=!['DATA_UNAVAILABLE','MARKET_CLOSED'].includes(displayVerdict);
  const analysis={provider:explanation.dataStatus.provider,latestCandleTimestamp:explanation.dataStatus.lastVerifiedCandleAt,calculatedAt:explanation.dataStatus.calculationCompletedAt};
  const resolvedPrimaryLabel=primaryActionLabel ?? actionLabel(explanation, displayVerdict);
  const resolvedPrimaryHint=primaryActionHint ?? (displayVerdict==='READY'?'Creates an Active Trade from this decision.':displayVerdict==='WAIT'?'Records the trade as an override and links it to the decision.':displayVerdict==='BLOCKED'?'The decision is blocked until the required conditions are cleared.':'Choose the next step for this decision.');
  const requiredPercentage=explanation.totalRequiredCount>0?Math.round((explanation.confirmedRequiredCount/explanation.totalRequiredCount)*100):0;
  const confirmedRequired=explanation.items.filter(item=>item.required&&item.state==='CONFIRMED');
  const incompleteRequired=explanation.items.filter(item=>item.required&&item.state!=='CONFIRMED');
  const supportingRules=explanation.items.filter(item=>!item.required);
  const otherEvidencePending=Math.max(0,pendingCount-manualPendingCount);
  const advancedByDefault=experienceLevel==='Advanced'||experienceLevel==='Professional';
  return <section className={`card decision-hero decision-explanation-hero state-${displayVerdict.toLowerCase()}`} aria-labelledby="decision-hero-title" aria-live="polite">
    <span className="sr-only">SHOULD I RISK MY MONEY RIGHT NOW? Mandatory rules still control the final decision. {narrative?.recommendation?'A final-check explanation is available.':''}</span><span className="sr-only">Readiness</span><span className="sr-only">Required readiness</span>
    <div className="decision-system-state"><span aria-hidden="true">{icon[explanation.verdict]}</span><strong>{c.systemState}: {displayVerdict.replaceAll('_',' ')}</strong><small>{explanation.dataStatus.provider}</small></div>
    <div className="decision-hero-primary">
      {instrument?<p className="decision-panel-instrument">{instrument}{direction?` · ${direction}`:''}{setupType?` · ${setupType}`:''}</p>:null}
      <p className="brand" data-validate-status>NEXT STEP · {decisionStatus}</p>
      <div className="decision-hero-verdict-column"><h1 id="decision-hero-title" className="decision-hero-verdict"><span className="sr-only">Current decision: </span>{displayDecision}</h1></div>
      <div className="decision-hero-explanation-column"><h2>{instruction}</h2><p className="decision-primary-reason">{explanation.primaryReason}</p></div>
      {readinessAllowed&&<div className="decision-rule-progress" aria-label={`${explanation.confirmedRequiredCount} of ${explanation.totalRequiredCount} required rules confirmed`}>
        <div className="decision-rule-progress-copy"><strong>{explanation.confirmedRequiredCount} of {explanation.totalRequiredCount} required rules</strong><span>{requiredPercentage}% confirmed</span></div>
        <div className="decision-rule-progress-track" aria-hidden="true"><span style={{width:`${requiredPercentage}%`}} /></div>
        {incompleteRequired.length?<ul className="decision-rule-preview">{incompleteRequired.slice(0,3).map(item=><li key={item.id}><span className={`decision-rule-state state-${item.state.toLowerCase()}`}>{item.state==='BLOCKED'?'Failed':item.state==='NOT_AVAILABLE'?'Unavailable':'Waiting'}</span><strong>{item.title}</strong><small>{item.plainLanguageDescription}</small></li>)}</ul>:<p className="decision-rule-complete">All required setup rules are confirmed.</p>}
      </div>}
      <div className="decision-next-action"><span>What happens next</span><strong>{explanation.nextAction}</strong></div>
      <details className="decision-technical-details" open={advancedByDefault}>
        <summary>{c.details}</summary>
        <dl className="decision-panel-metrics">
          <div><dt>Readiness</dt><dd>{readinessPercent == null ? '—' : `${readinessPercent}%`}</dd></div>
          <div><dt>Setup evidence</dt><dd>{explanation.confirmedRequiredCount} / {explanation.totalRequiredCount}</dd></div>
          <div><dt>Technical candidate</dt><dd>{technicalCandidateFound ? 'FOUND' : 'NOT READY'}</dd></div>
          <div><dt>Manual confirmations</dt><dd>{manualPendingCount ? `${manualPendingCount} PENDING` : 'COMPLETE'}</dd></div>
          <div><dt>Rule blockers</dt><dd>{ruleBlockerCount}</dd></div>
          {pendingCount>0?<div><dt>Setup pending</dt><dd>{pendingCount}</dd></div>:null}
          {otherEvidencePending>0?<div><dt>Other evidence pending</dt><dd>{otherEvidencePending}</dd></div>:null}
          {finalRiskCheckAvailable||finalized?<div><dt>Final risk controls</dt><dd>{finalized ? (displayVerdict === 'READY' ? 'PASSED' : displayVerdict) : 'NOT RUN'}</dd></div>:null}
          {finalized?<div><dt>Final blocks</dt><dd>{violationsCount}</dd></div>:null}
        </dl>
        <div className="decision-rule-groups">
          {confirmedRequired.length?<section><h3><span>Required · confirmed</span><b>{confirmedRequired.length}</b></h3><ul>{confirmedRequired.map(item=><li className="decision-detail-rule state-confirmed" key={item.id}><div><strong>{item.title}</strong><span>Confirmed</span></div><p>{item.plainLanguageDescription}</p></li>)}</ul></section>:null}
          <section><h3><span>Required · needs attention</span><b>{incompleteRequired.length}</b></h3>{incompleteRequired.length?<ul>{incompleteRequired.map(item=><li className={`decision-detail-rule state-${item.state.toLowerCase()}`} key={item.id}><div><strong>{item.title}</strong><span>{item.state==='BLOCKED'?'Failed':item.state==='NOT_AVAILABLE'?'Unavailable':'Waiting'}</span></div><p>{item.plainLanguageDescription}</p>{item.nextAction&&!item.nextAction.includes('cannot determine')?<small>{item.nextAction}</small>:null}</li>)}</ul>:<p>No required rule is pending or failed.</p>}</section>
          <section><h3><span>Supporting evidence</span><b>{supportingRules.length}</b></h3>{supportingRules.length?<ul>{supportingRules.map(item=><li className={`decision-detail-rule state-${item.state.toLowerCase()}`} key={item.id}><div><strong>{item.title}</strong><span>{item.state.replaceAll('_',' ')}</span></div></li>)}</ul>:<p>No optional evidence is configured.</p>}</section>
        </div>
      </details>
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
    {(onMarkMissed||onViewHistory)?<div className="decision-panel-secondary-actions">{onMarkMissed?<button type="button" onClick={onMarkMissed}>Mark as Missed</button>:null}{onViewHistory?<button type="button" onClick={onViewHistory}>View History</button>:null}</div>:null}
    <div className="decision-data-trust available"><strong>{`Market data · ${analysis.provider}`}</strong><span>{analysis.latestCandleTimestamp?`Last verified candle ${new Date(analysis.latestCandleTimestamp).toLocaleString()}`:'No verified candle time available'}{analysis.calculatedAt?` · decision calculated ${new Date(analysis.calculatedAt).toLocaleTimeString()}`:''}</span></div>
    {authorizationError?<p className="error decision-authorization-error" role="alert">{authorizationError}</p>:null}
    <details className="decision-state-help"><summary>{locale==='es'?'¿Qué significa este estado?':locale==='fr'?'Que signifie cet état ?':'What does this state mean?'}</summary><DecisionStateGuide locale={locale} compact/></details>
  </section>;
}
