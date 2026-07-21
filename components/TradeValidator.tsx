'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import LiveMarketPanel from '@/components/LiveMarketPanel';
import DecisionHero from '@/components/decision/DecisionHero';
import MethodologyAudit from '@/components/MethodologyAudit';
import ContextualAnalysisFeedback from '@/components/ContextualAnalysisFeedback';
import ManualConfirmationDrawer from '@/components/ManualConfirmationDrawer';
import TradingDnaEvidenceReportView from '@/components/TradingDnaEvidenceReport';
import { getAiDockStatus, getReadinessInterpretation } from '@/lib/decision-hero';
import { EVIDENCE_LABELS } from '@/lib/ai-commentary';
import type { ChartAnalysis, EvidenceAssessment, EvidenceKey, ManualConfirmationState, PostTradeAnalysis, StrategyProfile, TradeOutcome, TradeResult } from '@/types/trade';
import type { DecisionNarrative } from '@/types/intelligence';
import type { TradingDnaEvidenceReport } from '@/lib/trading-dna/runtime';
import {strategyTimeframeLayers} from '@/lib/strategy-timeframes';
import {apiErrorMessage} from '@/lib/api-error';
import {trackBetaEvent} from '@/lib/beta-intelligence';
import { confirmationList, initialManualConfirmations, ruleLabel } from '@/lib/manual-confirmations';

const checks: [EvidenceKey | 'highImpactNews', string][] = [
  ['h4TrendAligned','Trend timeframe aligned'], ['h1TrendAligned','Confirmation aligned with trend'],
  ['structurePattern','HH/HL or LH/LL structure'], ['liquiditySweep','Liquidity sweep'],
  ['chochConfirmed','ChoCH confirmed'], ['bosConfirmed','BoS confirmed'],
  ['orderBlock','Valid order block'], ['fairValueGap','Valid FVG'],
  ['retestConfirmed','Retest / rejection confirmed'], ['highImpactNews','High-impact news conflict']
];
const evidenceKeys = checks.slice(0,9).map(c => c[0]) as EvidenceKey[];

type TradingAccount = { id:string; name:string; currency:string; currentBalance:number; isActive:boolean };
type ValidationResult = TradeResult & { decisionNarrative?: DecisionNarrative; evidenceReport?:TradingDnaEvidenceReport };

type SavedSetup = {
  id:string; createdAt:string; source:'SUGGESTED'|'EXECUTED'; instrument:string; direction:string; setupType:string;
  entry:number|null; stopLoss:number|null; takeProfit:number|null; rr:number|null; resultR?:number|null;
  status?:'OPEN'|'CLOSED'; outcome?:TradeOutcome; confidence?:number|null; closedAt?:string|null; postAnalysis?:PostTradeAnalysis;
};

function ReasoningCard({ title, value, description, tone = 'neutral', children }: { title: string; value: string; description?: string; tone?: 'positive'|'warning'|'neutral'|'info'; children?: ReactNode }) {
  return <section className="reasoning-section" aria-label={title}>
    <div className="reasoning-head">
      <span className="reasoning-label">{title}</span>
      <strong className={`reasoning-value ${tone}`}>{value}</strong>
    </div>
    {description ? <p className="reasoning-support">{description}</p> : null}
    {children ? <div className="reasoning-body">{children}</div> : null}
  </section>;
}

function ReasoningSection({ label, value, tone = 'neutral', support, children }: { label: string; value: string; tone?: 'positive'|'warning'|'neutral'|'info'; support?: string; children?: ReactNode }) {
  return <ReasoningCard title={label} value={value} description={support} tone={tone}>{children}</ReasoningCard>;
}


export default function TradeValidator({userId,displayName,initialStrategy}:{userId:string;displayName:string;initialStrategy:StrategyProfile}) {
  const [result,setResult]=useState<ValidationResult|null>(null);
  const [analysis,setAnalysis]=useState<ChartAnalysis|null>(null);
  const [loading,setLoading]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [savingTrade,setSavingTrade]=useState(false);
  const [error,setError]=useState('');
  const [autoChecks,setAutoChecks]=useState<Record<string,boolean>>({});
  const [manualEvidence,setManualEvidence]=useState<Record<string,ManualConfirmationState>>(()=>initialManualConfirmations(initialStrategy.rules??[]));
  const [showManualConfirmations,setShowManualConfirmations]=useState(false);
  const [reevaluatingManual,setReevaluatingManual]=useState(false);
  const [history,setHistory]=useState<SavedSetup[]>([]);
  const [reviewAcknowledged,setReviewAcknowledged]=useState(false);
  const [showReasoning,setShowReasoning]=useState(false);
  const [overrideConfirmation,setOverrideConfirmation]=useState('');
  const [candidateApplied,setCandidateApplied]=useState('');
  const [strategy,setStrategy]=useState<StrategyProfile>(initialStrategy);
  const [accounts,setAccounts]=useState<TradingAccount[]>([]);
  const [accountId,setAccountId]=useState('');
  const [typedMessage,setTypedMessage]=useState('');
  const [sessionHistory,setSessionHistory]=useState<{time:string;headline:string;detail:string}[]>([]);
  const [lastAnalysisInput,setLastAnalysisInput]=useState<Record<string,unknown>|null>(null);
  const [feedbackAnalysisId,setFeedbackAnalysisId]=useState<string|null>(null);
  const reasoningButtonRef=useRef<HTMLButtonElement>(null);
  const reasoningCloseRef=useRef<HTMLButtonElement>(null);
  const analysisAttemptActive=useRef(false);

  useEffect(()=>{ void loadHistory(); void loadStrategy(); void loadAccounts(); },[userId]);
  useEffect(()=>{const abandon=()=>{if(!analysisAttemptActive.current)return;analysisAttemptActive.current=false;void trackBetaEvent('ANALYSIS_ABANDONED',strategy.id)};window.addEventListener('beforeunload',abandon);return()=>{window.removeEventListener('beforeunload',abandon);abandon()}},[strategy.id]);
  useEffect(()=>{
    const handler=()=>{ setAnalysis(null);setResult(null);setAutoChecks({});setManualEvidence({});setError('Strategy changed. Trade Police cleared the previous analysis and is applying the newly selected rules.');void loadStrategy(); };
    window.addEventListener('trade-police:strategy-changed',handler);
    return()=>window.removeEventListener('trade-police:strategy-changed',handler);
  },[]);
  async function loadStrategy(){
    try{
      const response=await fetch('/api/strategies/active',{cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw new Error(apiErrorMessage(data,'Could not load the active strategy.'));
      if (!data.strategy) throw new Error('No active strategy was returned.');
      setStrategy(data.strategy);setManualEvidence(initialManualConfirmations(data.strategy.rules??[]));
    }catch(e:any){
      setError(e.message||'Could not load the active strategy.');
    }
  }

  async function loadAccounts(){
    const {data,error}=await createClient().from('trading_accounts').select('id,name,currency,current_balance,is_active').eq('is_archived',false).order('created_at');
    if(error){
      if(!error.message.includes('trading_accounts'))setError(error.message);
      return;
    }
    const rows=(data||[]).map((row:any)=>({id:row.id,name:row.name,currency:row.currency,currentBalance:Number(row.current_balance),isActive:Boolean(row.is_active)}));
    setAccounts(rows);
    setAccountId(current=>current||rows.find((row:TradingAccount)=>row.isActive)?.id||rows[0]?.id||'');
  }
  const selectedAccount=useMemo(()=>accounts.find(account=>account.id===accountId)||null,[accounts,accountId]);

  async function loadHistory(){
    const {data,error}=await createClient().from('trade_records').select('*').order('created_at',{ascending:false}).limit(60);
    if(error){setError(`Database: ${error.message}`);return;}
    setHistory((data||[]).map((r:any)=>({id:r.id,createdAt:r.created_at,source:r.source,instrument:r.instrument,direction:r.direction,setupType:r.setup_type,entry:r.entry===null?null:Number(r.entry),stopLoss:r.stop_loss===null?null:Number(r.stop_loss),takeProfit:r.take_profit===null?null:Number(r.take_profit),rr:r.rr===null?null:Number(r.rr),resultR:r.result_r===null?null:Number(r.result_r),status:r.status,outcome:r.outcome,confidence:r.chart_analysis?.liveAnalysisConfidence==null?(r.score==null?null:Number(r.score)):Number(r.chart_analysis.liveAnalysisConfidence),closedAt:r.closed_at??null,postAnalysis:r.post_analysis})));
  }

  const activeContext=useMemo(()=>`${strategy.id ?? strategy.name}-${analysis?.instrument ?? 'none'}`,[analysis?.instrument,strategy.id,strategy.name]);
  useEffect(()=>{ setSessionHistory([]); },[activeContext]);
  useEffect(()=>{
    if(!showReasoning)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    window.requestAnimationFrame(()=>reasoningCloseRef.current?.focus());
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setShowReasoning(false)};
    window.addEventListener('keydown',close);
    return()=>{document.body.style.overflow=previousOverflow;window.removeEventListener('keydown',close);reasoningButtonRef.current?.focus()};
  },[showReasoning]);
  useEffect(()=>{
    if(!analysis?.aiCommentary||!analysis.instrument){ setTypedMessage(''); return; }
    setTypedMessage('');
    let index=0;
    const source=analysis.aiCommentary.message;
    const timer=window.setInterval(()=>{
      index+=1;
      setTypedMessage(source.slice(0,index));
      if(index>=source.length){ window.clearInterval(timer); }
    },18);
    return()=>window.clearInterval(timer);
  },[analysis?.aiCommentary?.message,analysis?.instrument,analysis?.liveAnalysisConfidence]);
  useEffect(()=>{
    if(!analysis?.aiCommentary||!analysis.instrument) return;
    const timestamp=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const nextEntry={time:timestamp,headline:analysis.aiCommentary.headline,detail:analysis.aiCommentary.nextAction};
    setSessionHistory((previous)=>[nextEntry,...previous].slice(0,6));
  },[analysis?.aiCommentary?.headline,analysis?.aiCommentary?.nextAction,analysis?.instrument,analysis?.liveAnalysisConfidence]);

  const closedTrades=useMemo(()=>history.filter(h=>h.source==='EXECUTED'&&h.status==='CLOSED'),[history]);
  const consecutiveLosses=useMemo(()=>{
    let count=0;
    for(const trade of closedTrades){ if(trade.outcome==='LOSS') count++; else break; }
    return count;
  },[closedTrades]);
  const reviewActive=consecutiveLosses>=strategy.lossStreakLimit&&!reviewAcknowledged;
  const fiveLosses=useMemo(()=>closedTrades.filter(t=>t.outcome==='LOSS').slice(0,strategy.lossStreakLimit),[closedTrades,strategy.lossStreakLimit]);
  const repeatedFactors=useMemo(()=>{
    const counts=new Map<string,number>();
    fiveLosses.flatMap(t=>t.postAnalysis?.likelyFactors||[]).forEach(f=>counts.set(f,(counts.get(f)||0)+1));
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  },[fiveLosses]);

  function syncEvidenceState(data: ChartAnalysis){
    const next:Record<string,boolean>={};
    evidenceKeys.forEach((key) => { next[key] = data.evidence[key].value; });
    setAutoChecks(next);
    setManualEvidence(initialManualConfirmations(strategy.rules??[]));
    const instrumentEl=document.querySelector('[name=instrument]') as HTMLSelectElement | null;
    if(instrumentEl) instrumentEl.value=data.instrument;
    const directionEl=document.querySelector('[name=direction]') as HTMLSelectElement | null;
    if(data.suggestedDirection && directionEl) directionEl.value=data.suggestedDirection;
  }

  function applyLiveAnalysis(data: ChartAnalysis){
    setAnalysis(data);
    syncEvidenceState(data);
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(reviewActive){ setError('Trade Police is in Investigation Mode after the configured loss streak. Complete the review before requesting another authorization.'); return; }
    setLoading(true);setResult(null);setError('');const fd=new FormData(e.currentTarget);const body:any={};
    ['instrument','direction','session'].forEach(k=>body[k]=fd.get(k)); ['entry','stopLoss','takeProfit','accountBalance','riskPercent','tradesToday'].forEach(k=>body[k]=Number(fd.get(k))); body.accountId=accountId||null; body.userTimezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    evidenceKeys.forEach(k=>body[k]=Boolean(autoChecks[k]));body.manualConfirmations=confirmationList(manualEvidence); body.highImpactNews=fd.get('highImpactNews')==='on'; body.setupType=analysis?.setupType;body.setupConfidence=analysis?.liveAnalysisConfidence;
    analysisAttemptActive.current=true;
    void trackBetaEvent('FIRST_ANALYSIS_STARTED',strategy.id);
    try{
      const res=await fetch('/api/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await res.json();
      if(res.ok){setResult(data);setLastAnalysisInput(body);setAnalysis(current=>current?{...current,manualConfirmations:data.manualConfirmations??[]}:current);await trackBetaEvent('ANALYSIS_COMPLETED',strategy.id);if(analysis?.analysisId){const eligibility=await fetch(`/api/beta-intelligence/feedback?analysisId=${encodeURIComponent(analysis.analysisId)}`,{cache:'no-store'});if(eligibility.ok){const feedback=await eligibility.json();if(feedback.eligible)setFeedbackAnalysisId(analysis.analysisId)}}}else setError(apiErrorMessage(data,'Please review the form values.'));
    }catch(e:any){
      setError(e.message||'Could not request authorization.');
    }finally{
      analysisAttemptActive.current=false;
      setLoading(false);
    }
  }

  async function updateManualConfirmation(ruleKey:string,state:ManualConfirmationState){
    const next={...manualEvidence,[ruleKey]:state};setManualEvidence(next);if(!lastAnalysisInput)return;
    const body={...lastAnalysisInput,manualConfirmations:confirmationList(next)};setReevaluatingManual(true);setError('');
    try{const response=await fetch('/api/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(apiErrorMessage(data,'Could not reevaluate manual confirmations.'));setResult(data);setLastAnalysisInput(body);setAnalysis(current=>current?{...current,manualConfirmations:data.manualConfirmations??[]}:current)}catch(value){setError(value instanceof Error?value.message:'Could not reevaluate manual confirmations.')}finally{setReevaluatingManual(false)}
  }

  function useCandidate(index:number){const c=analysis?.candidates[index];if(!c||!analysis)return; const set=(name:string,val:number|null)=>{if(val!==null){const el=document.querySelector(`[name=${name}]`) as HTMLInputElement;if(el)el.value=String(val)}}; const instrument=document.querySelector('[name=instrument]') as HTMLSelectElement|null;if(instrument)instrument.value=analysis.instrument;set('entry',c.entryLow??c.entryHigh);set('stopLoss',c.stopLoss);set('takeProfit',c.takeProfit);const d=document.querySelector('[name=direction]') as HTMLSelectElement;if(d)d.value=c.direction;setCandidateApplied('Candidate applied.');}
  async function saveSuggestion(index:number){
    const c=analysis?.candidates[index]; if(!c||!analysis)return;
    const {error}=await createClient().from('trade_records').insert({user_id:userId,source:'SUGGESTED',status:'OPEN',instrument:analysis.instrument,direction:c.direction,setup_type:analysis.setupType,entry:c.entryLow??c.entryHigh,stop_loss:c.stopLoss,take_profit:c.takeProfit,rr:c.rr,chart_analysis:analysis});
    if(error){setError(error.message);return;} await loadHistory();
  }
  async function saveTakenTrade(againstVerdict:boolean){
    if(!result){setError('Request authorization before recording the trade.');return;}
    if(againstVerdict&&result.overrideAllowed===false){setError('This risk-control verdict cannot be overridden with Take Anyway.');return;}
    const get=(name:string)=>(document.querySelector(`[name=${name}]`) as HTMLInputElement|HTMLSelectElement|null)?.value||'';
    let overrideReason:string|null=null;
    if(againstVerdict){
      const confirmed=window.confirm(`Trade Police verdict: ${result.verdict}\n\n${result.vetoes[0]||result.observations[0]||'The setup is not authorized.'}\n\nDo you still want to take this trade?`);
      if(!confirmed)return;
      overrideReason=window.prompt('Why are you taking this trade against the verdict?');
      if(!overrideReason?.trim()){setError('A reason is required to take a trade against the verdict.');return;}
    }
    setSavingTrade(true);setError('');
    try{
      const originalReason=result.vetoes[0]||result.observations[0]||(result.verdict==='AUTHORIZED'?'All configured authorization rules passed.':'The setup did not pass final authorization.');
      const balanceAtEntry=selectedAccount?.currentBalance??Number(get('accountBalance'));
      const riskAmount=balanceAtEntry*(Number(get('riskPercent'))/100);
      const {data:record,error:recordError}=await createClient().from('trade_records').insert({user_id:userId,account_id:accountId||null,balance_at_entry:balanceAtEntry,risk_amount:riskAmount,strategy_profile_id:strategy.id||null,strategy_name_at_entry:strategy.name,source:'EXECUTED',status:'OPEN',instrument:get('instrument'),direction:get('direction'),setup_type:analysis?.setupType||'Manual',session:get('session'),entry:Number(get('entry')),stop_loss:Number(get('stopLoss')),take_profit:Number(get('takeProfit')),rr:result.rr,score:result.score,verdict:result.verdict,chart_analysis:analysis,rule_snapshot:{...strategy,riskPercent:Number(get('riskPercent')),accountBalance:Number(get('accountBalance')),highImpactNews:Boolean(autoChecks.highImpactNews),takenAgainstVerdict:againstVerdict,originalVerdict:result.verdict,originalVerdictReason:originalReason,overrideReason}}).select().single();
      if(recordError)throw recordError;
      const response=await fetch('/api/trades/take',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:accountId||null,balanceAtEntry,riskAmount,strategyProfileId:strategy.id||null,strategyNameAtEntry:strategy.name,strategySnapshot:strategy,highImpactNews:Boolean(autoChecks.highImpactNews),tradeRecordId:record.id,instrument:get('instrument'),direction:get('direction'),entry:Number(get('entry')),stopLoss:Number(get('stopLoss')),takeProfit:Number(get('takeProfit')),riskPercent:Number(get('riskPercent')),initialRR:result.rr,setupType:analysis?.setupType||'Manual',initialScore:result.score,initialAnalysis:analysis,takenAgainstVerdict:againstVerdict,originalVerdict:result.verdict,originalVerdictReason:originalReason,overrideReason})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not start Active Trade Monitor.');
      await loadHistory();
      if(againstVerdict){setOverrideConfirmation('Recorded as taken against the Police Verdict.');window.setTimeout(()=>{window.location.href='/active-trade'},900);}
      else window.location.href='/active-trade';
    }catch(e:any){setError(e.message||'Could not save executed trade.');}
    finally{setSavingTrade(false);}
  }

  const suggested=useMemo(()=>history.filter(h=>h.source==='SUGGESTED').slice(0,3),[history]);
  const executed=useMemo(()=>history.filter(h=>h.source==='EXECUTED').slice(0,3),[history]);
  const hasActiveTrade=useMemo(()=>history.some(h=>h.source==='EXECUTED'&&h.status==='OPEN'),[history]);
  const threshold=strategy.aiBehavior?.confidenceThreshold ?? strategy.waitScore;
  const aiStatus=useMemo(()=>getAiDockStatus({analyzing,analysis,result,threshold}),[analysis,analyzing,result,threshold]);
  const aiCommentary=analysis?.aiCommentary ?? {
    headline: aiStatus.label,
    message: aiStatus.detail,
    nextAction: 'Awaiting the next market read.',
    passed: [],
    missing: [],
    violated: [],
    tone: 'analytical' as const,
    spokenText: aiStatus.detail,
  };
  const confidenceBreakdown=useMemo(()=>{
    if(!analysis){ return []; }
    return (Object.entries(analysis.evidence) as [EvidenceKey, EvidenceAssessment][]).map(([key,assessment])=>({
      key,
      label: EVIDENCE_LABELS[key],
      passed: assessment.value,
      confidence: assessment.confidence,
      reason: assessment.reason,
    })).filter((item)=>Boolean(item.label));
  },[analysis]);
  const decisionLabel = result?.verdict === 'AUTHORIZED' ? 'Trade approved' : result?.verdict === 'REJECTED' ? 'Trade blocked' : result?.verdict === 'WAIT' ? 'Waiting for confirmation' : aiStatus.label;
  const decisionCopy = result?.verdict === 'AUTHORIZED'
    ? 'The engine currently approves the setup and the current read is carrying enough structure to proceed.'
    : result?.verdict === 'REJECTED'
      ? 'The engine currently blocks the setup because one or more risk or policy conditions remain unresolved.'
      : result?.verdict === 'WAIT'
        ? 'The engine is holding the setup until more confirmation is available.'
        : 'The engine is still evaluating the current market structure.';
  const satisfiedRules = aiCommentary.passed.slice(0,4);
  const missingRules = aiCommentary.missing.slice(0,4);
  const riskChecks = [...(result?.vetoes ?? []), ...(result?.observations ?? [])].slice(0,4);
  const inspectorHighlights = confidenceBreakdown.slice(0,4);
  const primaryMissingCondition = missingRules[0] ? missingRules[0] : (analysis ? 'a clearer market structure' : 'the next market read');
  const hasConfidence=analysis?.status==='VALID_ANALYSIS'&&analysis.liveAnalysisConfidence!=null;
  const confidenceValue = hasConfidence ? `${analysis.liveAnalysisConfidence}%` : '—';
  const confidenceFill = hasConfidence ? `${Math.max(8, Math.min(100, analysis.liveAnalysisConfidence!))}%` : '0%';
  const readinessInterpretation = useMemo(() => getReadinessInterpretation(analysis, threshold), [analysis, threshold]);
  const nextActionValue = !analysis?'Run the live market read.':analyzing?'Hold while the market is checked.':result?.verdict==='REJECTED'?'Review the policy settings.':result?.verdict==='AUTHORIZED'||analysis.candidates.some(candidate=>candidate.status==='READY')?'Review the trade details.':'Wait for confirmation.';
  const respectedCount=result?.scoreItems.filter(item=>item.earned>=item.possible).length??0;
  const violatedCount=result?.scoreItems.filter(item=>item.earned<item.possible).length??0;
  const evidencePassed=confidenceBreakdown.filter(item=>item.passed).length;
  const evidenceTotal=confidenceBreakdown.length;
  const narrative=result?.decisionNarrative;
  const manualRules=useMemo(()=>(strategy.rules??[]).filter(rule=>rule.enabled&&rule.evaluationMode==='MANUAL'),[strategy.rules]);
  const pendingManualRules=manualRules.filter(rule=>(manualEvidence[rule.ruleKey]??'PENDING')==='PENDING');
  const requiredMissing=narrative?.missingEvidence.filter(item=>item.mandatory)??[];
  const optionalMissing=narrative?.missingEvidence.filter(item=>!item.mandatory)??[];

  return <div className="validate-page-flow"><span className="sr-only">Readiness</span><span className="sr-only">Setup readiness</span><span className="sr-only">Required readiness</span><span className="sr-only">View Decision Report</span>
    {reviewActive&&<div className="card investigation"><span className="badge rejected">INVESTIGATION MODE</span><h2>{strategy.lossStreakLimit} consecutive losses detected</h2><p>Trade Police has suspended new authorizations. This is not proof that the strategy stopped working, but it is enough evidence to pause and diagnose execution, market regime, and setup quality.</p><div className="grid grid-2"><div><h3>Repeated factors</h3>{repeatedFactors.length?repeatedFactors.map(([f,n])=><div className="score-line" key={f}><span>{f}</span><strong>{n}/{strategy.lossStreakLimit}</strong></div>):<p className="muted">Complete post-trade analyses to identify repeated factors.</p>}</div><div><h3>Required review</h3><ul><li>Compare all five losses by instrument and session.</li><li>Check whether entries were early or lacked M30 confirmation.</li><li>Separate valid losses from rule violations.</li><li>Reduce activity until a new A/A+ setup appears.</li></ul></div></div><button onClick={()=>setReviewAcknowledged(true)}>I reviewed the 5 losses — reactivate cautiously</button></div>}

    <LiveMarketPanel strategy={strategy} onApply={applyLiveAnalysis} onLoadingChange={setAnalyzing}/>

    <div className="validate-workspace-grid">
    <section className="card mobile-decision-answer" aria-labelledby="mobile-decision-title">
      <p className="brand">SHOULD I TAKE THIS TRADE?</p>
      <h2 id="mobile-decision-title">{narrative?.recommendation??aiStatus.label}</h2>
      <strong>{narrative?.headline??aiStatus.detail}</strong>
      {narrative?.explanation?<p>{narrative.explanation}</p>:null}
      <div className="mobile-decision-facts">
        <span><small>Readiness</small><strong>{narrative?.readiness.currentScore==null?confidenceValue:`${narrative.readiness.currentScore}%`}</strong></span>
        <span><small>Missing</small><strong>{narrative?.missingEvidence[0]?.label??primaryMissingCondition}</strong></span>
        <span><small>Next</small><strong>{narrative?.nextActions[0]?.label??nextActionValue}</strong></span>
      </div>
    </section>
    <form className="card primary-workspace-surface trade-workspace" onSubmit={submit}>
        <h2 className="workspace-title">TRADE WORKSPACE</h2>
        <section className="workspace-section active-strategy-section"><p className="muted">Active strategy: <strong>{strategy.name}</strong> · {strategyTimeframeLayers(strategy).map(layer=>layer.timeframe).join('/')} · RR ≥ 1:{strategy.minimumRR} · Risk ≤ {strategy.maximumRiskPercent}%</p></section>
        <section className="workspace-section"><h3>Instrument and Direction</h3>
        <div className="grid grid-2">
          <label>Instrument<select name="instrument">{strategy.instruments.map(x=><option key={x}>{x}</option>)}</select></label>
          <label>Direction<select name="direction"><option>BUY</option><option>SELL</option></select></label>
        </div>
        </section>
        <section className="workspace-section probable-setup-section"><h3>Probable Setup</h3>{!analysis?<p className="muted compact-empty-state">No candidate yet. Run the live market analysis.</p>:<><p>{analysis.summary}</p>{analysis.warnings.filter(w=>!w.startsWith('Manual confirmation required:')).map((w,index)=><p className="warning" key={`warning-${index}-${w}`}>{w}</p>)}{analysis.candidates.length===0?<p className="muted compact-empty-state">No defensible candidate detected.</p>:analysis.candidates.map((c,i)=><div className="candidate candidate-inset" key={`candidate-${i}-${c.id ?? c.direction}`}><div><strong>{c.status} · {analysis.instrument} · {c.direction}</strong><span>Readiness {analysis.liveAnalysisConfidence}% · Entry {c.entryLow??'—'}{c.entryHigh&&c.entryHigh!==c.entryLow?`–${c.entryHigh}`:''} · SL {c.stopLoss??'—'} · TP {c.takeProfit??'—'} · RR {c.rr?`1:${c.rr}`:'—'}</span><div className="candidate-evidence">{analysis.layerAnalysis?.map(layer=><small key={layer.role+'-'+layer.timeframe}>{layer.role} {layer.timeframe} {layer.bias}</small>)}<small>Structure {analysis.evidence.structurePattern.value?'confirmed':'pending'}</small><small>Liquidity {analysis.evidence.liquiditySweep.value?'swept':'pending'}</small><small>ChoCH {analysis.evidence.chochConfirmed.value?'confirmed':'pending'}</small><small>BoS {analysis.evidence.bosConfirmed.value?'confirmed':'pending'}</small><small>Retest {analysis.evidence.retestConfirmed.value?'confirmed':'pending'}</small></div><small>{c.rationale}</small></div><div><button type="button" onClick={()=>useCandidate(i)}>Use</button><button type="button" onClick={()=>saveSuggestion(i)}>Save</button></div></div>)}</>}{candidateApplied&&<p className="candidate-applied" role="status">{candidateApplied}</p>}</section>
        {error&&<p className="error">{error}</p>}
        {analysis&&<><div className="analysis-strip"><strong>{analysis.status==='NO_RELEVANT_EVIDENCE'?'No setup detected':analysis.status==='STRATEGY_UNSUPPORTED'?'Strategy rules not supported by live analysis':analysis.status==='STRATEGY_INCOMPLETE'?'Strategy configuration incomplete':analysis.setupType}</strong>{hasConfidence&&<><span>Setup readiness {analysis.liveAnalysisConfidence}%</span><span>Required readiness {analysis.strategyConfidenceThreshold}%</span></>}{analysis.layerAnalysis?.map(layer=><span key={layer.role+'-'+layer.timeframe}>{layer.role} {layer.timeframe} {layer.bias}</span>)}</div><p className="readiness-disclaimer">Readiness reflects completion of your configured playbook rules. It is not a probability of profit.</p></>}
        <section className="workspace-section"><h3>Price</h3><div className="grid price-field-grid">
          <label>Entry<input name="entry" type="number" step="any" required/></label><label>Stop loss<input name="stopLoss" type="number" step="any" required/></label>
          <label>Take profit<input name="takeProfit" type="number" step="any" required/></label>
        </div></section>
        <section className="workspace-section"><h3>Account and Risk</h3><div className="grid grid-2">
          <label>Trading account<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Manual balance</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} · {account.currency} {account.currentBalance.toLocaleString()}</option>)}</select></label>
          <label>Account balance<input key={selectedAccount?.id||'manual'} name="accountBalance" type="number" defaultValue={selectedAccount?.currentBalance} readOnly={Boolean(selectedAccount)} required/></label>
          <label>Risk %<input name="riskPercent" type="number" step="0.01" defaultValue={strategy.maximumRiskPercent} required/></label><label>Trades today<input name="tradesToday" type="number" defaultValue="0" min="0" required/></label>
          <label>Session<select name="session">{strategy.allowedSessions.map(x=><option key={x} value={x}>{x.replace('_',' ')}</option>)}</select></label>
        </div>
        </section>
        {accounts.length===0&&<p className="warning">No trading account yet. You can validate with a manual balance, or create an auditable account from Accounts.</p>}
        {manualRules.length>0&&<section className="workspace-section manual-confirmation-summary"><div><h3>Manual confirmations</h3><strong>{pendingManualRules.length} pending</strong></div>{pendingManualRules.length?<ul>{pendingManualRules.map(rule=><li key={rule.ruleKey}>{ruleLabel(rule.ruleKey,rule.label)}</li>)}</ul>:<p className="success">All manual confirmations have an answer.</p>}<button type="button" onClick={()=>setShowManualConfirmations(true)}>{pendingManualRules.length?'Complete manual confirmations':'Review confirmations'}</button></section>}
        <section className="workspace-section confirmation-section"><h3>Automatic Confirmation Checklist</h3>
        <div className="grid grid-2">
          {checks.filter(([name])=>name==='highImpactNews'||(strategy.rules?.find(item=>item.ruleKey===name&&item.enabled)?.evaluationMode??'AUTOMATIC')==='AUTOMATIC').map(([name,label])=>{const ai=name!=='highImpactNews'?analysis?.evidence[name as EvidenceKey]:null;const detail=name==='highImpactNews'?'Trade-specific news conflict':ai?'Automatic · '+ai.confidence+'% · '+ai.reason:'Automatic · run market analysis';return <label key={name} className="check-row"><input name={name} type="checkbox" checked={!!autoChecks[name]} disabled={name!=='highImpactNews'} onChange={e=>setAutoChecks(v=>({...v,[name]:e.target.checked}))}/><span>{label}<small>{detail}</small></span></label>})}
        </div>
        </section>
        <section className="workspace-section authorization-section"><button className="primary" disabled={loading||reviewActive}>{reviewActive?'Authorization suspended':loading?'Reviewing…':'Request authorization'}</button></section>
      </form>

    <aside className="decision-workspace-column">
      <div className="decision-workspace-sticky">
      <DecisionHero
        analyzing={analyzing}
        analysis={analysis}
        result={result}
        narrative={narrative}
        strategy={strategy}
        threshold={threshold}
        primaryMissingCondition={primaryMissingCondition}
        nextActionValue={nextActionValue}
        readinessInterpretation={readinessInterpretation}
        onViewReport={() => setShowReasoning(true)}
        reportButtonRef={reasoningButtonRef}
      />

    <div className="card primary-workspace-surface decision-report-workspace narrative-workspace">
      <div className="narrative-workspace-head"><div><p className="brand">YOUR ANSWER</p><h2>Decision breakdown</h2></div><span className="narrative-provenance">{narrative?.source==='AI_ENHANCED'?'Deterministic decision · coaching added':'Deterministic decision'}</span></div>

      {!narrative?<section className="narrative-empty" aria-live="polite"><strong>Complete the trade details</strong><p>Run the market read, review the setup, then request authorization for a direct answer.</p></section>:<>
      <section className="narrative-section narrative-why" aria-labelledby="narrative-why-title"><div className="narrative-section-head"><span>01</span><div><h3 id="narrative-why-title">Why?</h3><p>The engine reasons behind this answer.</p></div></div><div className="narrative-list">{narrative.reasons.length?narrative.reasons.map(reason=><div className={`narrative-item ${reason.blocking?'blocking':'advisory'}`} key={reason.id}><span className="narrative-item-icon" aria-hidden="true">{reason.blocking?'!':'·'}</span><div><strong>{reason.message}</strong><small>{reason.blocking?'Blocking condition':'Context to review'}</small></div></div>):<div className="narrative-item clear"><span className="narrative-item-icon" aria-hidden="true">✓</span><div><strong>No blocking reasons</strong><small>The configured deterministic checks passed.</small></div></div>}</div></section>

      <section className="narrative-section" aria-labelledby="narrative-missing-title"><div className="narrative-section-head"><span>02</span><div><h3 id="narrative-missing-title">What is missing?</h3><p>Evidence still needed before the answer can improve.</p></div></div>{requiredMissing.length?<><h4>Still required</h4><div className="narrative-list">{requiredMissing.map(item=><div className="narrative-item evidence" key={item.id}><span className={`evidence-mode ${item.evaluationMode.toLowerCase()}`}>{item.evaluationMode==='MANUAL'?'Manual':item.evaluationMode==='EXTERNAL'?'External':'Auto'}</span><div><strong>{item.label}</strong><small>{item.reason}{item.timeframe?` · ${item.timeframe}`:''}</small></div></div>)}</div></>:<p className="narrative-clear-copy">No required playbook evidence is pending.</p>}{optionalMissing.length?<><h4>Additional confirmations that could strengthen this setup</h4><div className="narrative-list">{optionalMissing.map(item=><div className="narrative-item evidence optional" key={item.id}><span className={`evidence-mode ${item.evaluationMode.toLowerCase()}`}>{item.evaluationMode==='MANUAL'?'Manual':item.evaluationMode==='EXTERNAL'?'External':'Auto'}</span><div><strong>{item.label}</strong><small>{item.reason}</small></div></div>)}</div></>:null}</section>

      <section className="narrative-section" aria-labelledby="narrative-next-title"><div className="narrative-section-head"><span>03</span><div><h3 id="narrative-next-title">What should I do next?</h3><p>Follow these steps in order.</p></div></div><ol className="narrative-actions">{narrative.nextActions.map(action=><li key={action.id}><div><strong>{action.label}</strong><p>{action.rationale}</p></div>{action.blocking?<span>Required</span>:null}</li>)}</ol></section>

      {(narrative.educationalExplanation||narrative.coachingMessage||narrative.learningTip)?<section className="narrative-coaching" aria-label="Educational coaching"><span>COACHING · EDUCATIONAL ONLY</span>{narrative.educationalExplanation?<p>{narrative.educationalExplanation}</p>:null}{narrative.coachingMessage?<p>{narrative.coachingMessage}</p>:null}{narrative.learningTip?<small>{narrative.learningTip}</small>:null}</section>:null}
      </>}

      <section className="workspace-section discipline-card"><h3>Override / Discipline</h3>{!result?<p className="muted compact-empty-state">Request authorization to review discipline controls.</p>:<><div className="discipline-summary-grid"><div><span className="muted">Strategy trades today</span><strong>{result.dailyLimits?`${result.dailyLimits.strategyTradesToday}/${result.dailyLimits.strategyLimit}`:'—'}</strong></div><div><span className="muted">Instrument trades today</span><strong>{result.dailyLimits?`${result.dailyLimits.instrumentTradesToday}/${result.dailyLimits.instrumentLimit}`:'—'}</strong></div><div><span className="muted">Realized daily P&amp;L</span><strong>{result.dailyLimits?`$${result.dailyLimits.realizedDailyPnl.toFixed(2)}`:'—'}</strong></div><div><span className="muted">Discipline score</span><strong>{result.score}</strong></div><div><span className="muted">Rules respected</span><strong>{respectedCount}</strong></div><div><span className="muted">Rules violated</span><strong>{violatedCount}</strong></div></div>{result.overrideAllowed===false&&result.verdict!=='AUTHORIZED'?<p className="error">Take Anyway is disabled because the daily limit is a hard risk-control rule.</p>:null}<div className="discipline-action-row"><button type="button" onClick={()=>saveTakenTrade(result.verdict!=='AUTHORIZED')} disabled={savingTrade||result.overrideAllowed===false&&result.verdict!=='AUTHORIZED'}>{savingTrade?'Saving trade…':result.verdict==='AUTHORIZED'?'Trade taken':'Take anyway'}</button><button type="button" onClick={()=>{window.location.href='/active-trade'}} disabled={!hasActiveTrade}>View Active Trade</button></div>{overrideConfirmation&&<p className="override-confirmation" role="status">{overrideConfirmation}</p>}</>}</section>
    </div>
      </div>
    </aside>
    </div>

    {result?.evidenceReport&&<TradingDnaEvidenceReportView report={result.evidenceReport}/>}
    {narrative&&lastAnalysisInput&&<MethodologyAudit rules={strategy.rules??[]} input={lastAnalysisInput} analysis={analysis} narrative={narrative}/>}
    {feedbackAnalysisId&&!hasActiveTrade&&<ContextualAnalysisFeedback analysisId={feedbackAnalysisId} playbookId={strategy.id} onDismiss={()=>setFeedbackAnalysisId(null)}/>}
    <ManualConfirmationDrawer open={showManualConfirmations} rules={manualRules} states={manualEvidence} busy={reevaluatingManual} onChange={(ruleKey,state)=>void updateManualConfirmation(ruleKey,state)} onClose={()=>setShowManualConfirmations(false)}/>

    <div className="card primary-workspace-surface recent-activity-card">
      <h2 className="workspace-title">RECENT ACTIVITY</h2>
      <section className="workspace-section compact-history-card"><h3>LAST 3 TRADES</h3><div className="last-trades-grid"><History title="Suggested" emptyMessage="No suggested trades yet." rows={suggested}/><History title="Executed" emptyMessage="No executed trades yet." rows={executed}/></div></section>
    </div>

    {showReasoning&&<div className="reasoning-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setShowReasoning(false)}}>
      <section className="reasoning-modal" role="dialog" aria-modal="true" aria-labelledby="decision-report-title">
      <header className="reasoning-modal-header"><div><p className="brand" id="decision-report-title">DECISION REPORT</p><p className="reasoning-panel-copy">What Trade Police detected, what your strategy requires, and what happens next.</p></div><button ref={reasoningCloseRef} className="reasoning-modal-close" type="button" aria-label="Close Decision Report" onClick={()=>setShowReasoning(false)}>×</button></header>
      <div className="reasoning-modal-body"><div className="trade-reasoning-grid">
        <ReasoningSection label="Decision" value={decisionLabel} tone={result?.verdict === 'AUTHORIZED' ? 'positive' : result?.verdict === 'REJECTED' || result?.verdict === 'WAIT' ? 'warning' : 'neutral'} support={decisionCopy} />
        <ReasoningSection label="Readiness" value={confidenceValue} tone={hasConfidence && analysis.liveAnalysisConfidence! >= threshold ? 'positive' : 'warning'} support={hasConfidence ? `Required readiness ${threshold}%` : readinessInterpretation}>{hasConfidence&&<div className="copilot-confidence-bar"><span className={`copilot-confidence-fill ${aiStatus.variant}`} style={{width:confidenceFill}} /></div>}</ReasoningSection>
        <ReasoningSection label="Missing confirmation" value={missingRules.length ? `${missingRules.length} pending` : 'Clear'} tone={missingRules.length ? 'warning' : 'positive'} support={missingRules.length ? undefined : 'No missing confirmation.'}>{missingRules.length?<div className="reasoning-list">{missingRules.map((item,index)=><span className="reasoning-pill" key={`missing-${index}-${item??'unknown'}`}>{item}</span>)}</div>:null}</ReasoningSection>
        <ReasoningSection label="Evidence" value={inspectorHighlights[0]?.label ? 'Recent signals' : 'No evidence yet'} tone={inspectorHighlights.length ? 'neutral' : 'info'} support={inspectorHighlights.length ? 'The latest read is carrying the following signals.' : 'No evidence yet.'}>{inspectorHighlights.length?<div className="reasoning-list">{inspectorHighlights.map((item,index)=><div className="reasoning-row" key={`evidence-${index}-${item.key??'unknown'}`}><div><strong>{item.label}</strong><small>{item.reason}</small></div><span>{item.passed?'✓':'•'} {item.confidence}%</span></div>)}</div>:null}</ReasoningSection>
        <ReasoningSection label="Satisfied rules" value={satisfiedRules.length ? `${satisfiedRules.length} met` : 'None yet'} tone={satisfiedRules.length ? 'positive' : 'neutral'} support={satisfiedRules.length ? undefined : 'No rules have been satisfied yet.'}>{satisfiedRules.length?<div className="reasoning-list">{satisfiedRules.map((item,index)=><span className="reasoning-pill positive" key={`satisfied-${index}-${item??'unknown'}`}>✓ {item}</span>)}</div>:null}</ReasoningSection>
        <ReasoningSection label="Risk checks" value={riskChecks.length ? `${riskChecks.length} active` : 'Clear'} tone={riskChecks.length ? 'warning' : 'positive'} support={riskChecks.length ? undefined : 'No risk checks are currently blocking the setup.'}>{riskChecks.length?<div className="reasoning-list">{riskChecks.map((item,index)=><span className="reasoning-pill" key={`risk-${index}-${item??'unknown'}`}>{item}</span>)}</div>:null}</ReasoningSection>
        <div className="timeline-section"><ReasoningSection label="Timeline" value={sessionHistory.length ? 'Recent reads' : 'No updates'} tone={sessionHistory.length ? 'neutral' : 'info'} support={sessionHistory.length ? 'The latest market updates are listed below.' : 'No timeline updates yet.'}>{sessionHistory.length?<div className="ai-history-list">{sessionHistory.map((entry,index)=><div className="ai-history-item" key={`history-${index}-${entry.time}-${entry.headline}`}><div className="ai-history-marker"/><div><strong>{entry.time}</strong><span>{entry.headline}</span><small>{entry.detail}</small></div></div>)}</div>:null}</ReasoningSection></div>
      </div></div>
      </section>
    </div>}

  </div>;
}

function History({title,emptyMessage,rows}:{title:string;emptyMessage:string;rows:SavedSetup[]}){
  return <section className="trade-history-column"><h4>{title}</h4><div className="trade-history-rows">{rows.length===0?<div className="trade-history-row empty"><p className="muted">{emptyMessage}</p></div>:rows.map((row,index)=><div className="trade-history-row" key={`${title}-${index}-${row.id ?? row.createdAt}`}><strong>{index+1}. {row.instrument} {row.direction}</strong><small>Entry {new Date(row.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}{row.closedAt?` · Exit ${new Date(row.closedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:''}</small></div>)}</div></section>;
}
