'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import LiveMarketPanel from '@/components/LiveMarketPanel';
import DecisionHero from '@/components/decision/DecisionHero';
import DecisionReport from '@/components/decision/DecisionReport';
import MethodologyAudit from '@/components/MethodologyAudit';
import ContextualAnalysisFeedback from '@/components/ContextualAnalysisFeedback';
import ManualConfirmationDrawer from '@/components/ManualConfirmationDrawer';
import TradingDnaEvidenceReportView from '@/components/TradingDnaEvidenceReport';
import PlaybookEvaluation from '@/components/PlaybookEvaluation';
import MarketContextStrip from '@/components/MarketContextStrip';
import AutomaticAnalysisEvidence from '@/components/AutomaticAnalysisEvidence';
import { getAiDockStatus, getReadinessInterpretation } from '@/lib/decision-hero';
import { getDecisionWorkspaceLayoutState } from '@/lib/decision-workspace-layout';
import { EVIDENCE_LABELS } from '@/lib/ai-commentary';
import type { ChartAnalysis, EvidenceAssessment, EvidenceKey, Instrument, ManualConfirmation, ManualConfirmationState, PostTradeAnalysis, StrategyProfile, TradeOutcome, TradeResult } from '@/types/trade';
import type { DecisionNarrative } from '@/types/intelligence';
import type { TradingDnaEvidenceReport } from '@/lib/trading-dna/runtime';
import {strategyTimeframeLayers} from '@/lib/strategy-timeframes';
import {apiErrorMessage,readApiResponse,redirectExpiredSession} from '@/lib/api-error';
import {trackBetaEvent} from '@/lib/beta-intelligence';
import { confirmationList, initialManualConfirmations, ruleLabel } from '@/lib/manual-confirmations';
import {buildDecisionExplanation} from '@/lib/intelligence/decision-explanation';
import type { TradeAuthorizationEligibility } from '@/lib/trade-authorization';
import { resolveTradeActivationUiState } from '@/lib/trade-activation-ui';
import { getSafeTradeActivationError } from '@/lib/trade-action-errors';
import { activePositionOverlayFromTrade, activatePositionOverlay, assessPositionGeometry, positionOverlayProvenance, proposedPositionFromCandidate, updateProposedGeometry, type PositionGeometry, type PositionOverlayModel } from '@/lib/position-geometry';
import { formatTradeActivityDateTime, latestTradeActivity } from '@/lib/trade-activity';
import {useLocale} from '@/components/i18n/LocaleProvider';
import {workspaceText} from '@/lib/i18n/workspace-copy';
const checks: [EvidenceKey | 'highImpactNews', string][] = [
  ['h4TrendAligned','Trend timeframe aligned'], ['h1TrendAligned','Confirmation aligned with trend'],
  ['structurePattern','HH/HL or LH/LL structure'], ['liquiditySweep','Liquidity sweep'],
  ['chochConfirmed','ChoCH confirmed'], ['bosConfirmed','BoS confirmed'],
  ['orderBlock','Valid order block'], ['fairValueGap','Valid FVG'],
  ['retestConfirmed','Retest / rejection confirmed'], ['highImpactNews','High-impact news conflict']
];
const evidenceKeys = checks.slice(0,9).map(c => c[0]) as EvidenceKey[];

function getAnalysisStatusLabel(status: ChartAnalysis['status'] | undefined) {
  switch (status) {
    case 'VALID_ANALYSIS':
      return 'Valid analysis';
    case 'NO_RELEVANT_EVIDENCE':
      return 'No setup detected';
    case 'STRATEGY_UNSUPPORTED':
      return 'Strategy rules not supported by live analysis';
    case 'STRATEGY_INCOMPLETE':
      return 'Strategy configuration incomplete';
    case 'INSUFFICIENT_DATA':
      return 'Insufficient market data';
    case 'ANALYSIS_FAILED':
      return 'Analysis unavailable';
    case 'DATA_UNAVAILABLE':
      return 'Market data unavailable';
    default:
      return 'Analysis pending';
  }
}

type TradingAccount = { id:string; name:string; currency:string; currentBalance:number; isActive:boolean };
type ValidationResult = TradeResult & { decisionNarrative?: DecisionNarrative; evidenceReport?:TradingDnaEvidenceReport; reportSourceId?:string; reportSourceExpiresAt?:string; authorizationEligibility?: TradeAuthorizationEligibility };
type ReportSaveState={status:'idle'|'saving'|'saved'|'error';message?:string;reportId?:string;reportUrl?:string;savedAt?:string};

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

function applyDefaultTradeFormValues(
  form: HTMLFormElement | null,
  {
    analysis,
    selectedAccount,
    accountId,
    strategy,
    selectedInstrument,
  }: {
    analysis: ChartAnalysis | null;
    selectedAccount: TradingAccount | null;
    accountId: string;
    strategy: StrategyProfile;
    selectedInstrument: Instrument;
  },
) {
  if (!form) return;
  const setValue = (name: string, value: string | number | null | undefined) => {
    const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (!field) return;
    const nextValue = value == null || value === '' ? '' : String(value);
    if (field.value === nextValue) return;
    field.value = nextValue;
  };

  const existingBalance = (form.elements.namedItem('accountBalance') as HTMLInputElement | null)?.value;
  const existingRisk = (form.elements.namedItem('riskPercent') as HTMLInputElement | null)?.value;
  const existingTradesToday = (form.elements.namedItem('tradesToday') as HTMLInputElement | null)?.value;

  setValue('analysisId', analysis?.analysisId ?? '');
  setValue('accountBalance', selectedAccount?.currentBalance ?? (existingBalance ? Number(existingBalance) : accountId ? 0 : 0));
  setValue('riskPercent', existingRisk ? Number(existingRisk) : (strategy.maximumRiskPercent ?? 0.5));
  setValue('tradesToday', existingTradesToday ? Number(existingTradesToday) : 0);
  setValue('session', strategy.allowedSessions[0] ?? 'LONDON');
}

export default function TradeValidator({userId,displayName,initialStrategy}:{userId:string;displayName:string;initialStrategy:StrategyProfile}) {
  const {locale}=useLocale(); const w=(text:string)=>workspaceText(locale,text);
  const [result,setResult]=useState<ValidationResult|null>(null);
  const [analysis,setAnalysis]=useState<ChartAnalysis|null>(null);
  const [loading,setLoading]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [savingTrade,setSavingTrade]=useState(false);
  const [reportSave,setReportSave]=useState<ReportSaveState>({status:'idle'});
  const [error,setError]=useState('');
  const [autoChecks,setAutoChecks]=useState<Record<string,boolean>>({});
  const [manualEvidence,setManualEvidence]=useState<Record<string,ManualConfirmationState>>(()=>initialManualConfirmations(initialStrategy.rules??[]));
  const [showManualConfirmations,setShowManualConfirmations]=useState(false);
  const [reevaluatingManual,setReevaluatingManual]=useState(false);
  const [history,setHistory]=useState<SavedSetup[]>([]);
  const [reviewAcknowledged,setReviewAcknowledged]=useState(false);
  const [showReasoning,setShowReasoning]=useState(false);
  const [overrideConfirmation,setOverrideConfirmation]=useState('');
  const [tradeActionMode,setTradeActionMode]=useState<'SELECT'|'ACTIVATE'|'OVERRIDE'|'MISSED'|null>(null);
  const [tradeActionContext,setTradeActionContext]=useState<{againstVerdict:boolean;reason:string|null;confirmed:boolean}>({againstVerdict:false,reason:null,confirmed:false});
  const [tradeActionError,setTradeActionError]=useState('');
  const [candidateApplied,setCandidateApplied]=useState('');
  const [activationSuccess,setActivationSuccess]=useState<string| null>(null);
  const [strategy,setStrategy]=useState<StrategyProfile>(initialStrategy);
  const [activeStrategyRevisionId,setActiveStrategyRevisionId]=useState<string|null>(null);
  const [strategyApplying,setStrategyApplying]=useState(false);
  const [selectedInstrument,setSelectedInstrument]=useState<Instrument>(initialStrategy.instruments[0] || 'XAUUSD');
  const [positionOverlay,setPositionOverlay]=useState<PositionOverlayModel|null>(null);
  const [persistedActiveOverlays,setPersistedActiveOverlays]=useState<PositionOverlayModel[]>([]);
  const [accounts,setAccounts]=useState<TradingAccount[]>([]);
  const [accountId,setAccountId]=useState('');
  const [typedMessage,setTypedMessage]=useState('');
  const [sessionHistory,setSessionHistory]=useState<{time:string;headline:string;detail:string}[]>([]);
  const [lastAnalysisInput,setLastAnalysisInput]=useState<Record<string,unknown>|null>(null);
  const [feedbackAnalysisId,setFeedbackAnalysisId]=useState<string|null>(null);
  const reasoningButtonRef=useRef<HTMLButtonElement>(null);
  const reasoningCloseRef=useRef<HTMLButtonElement>(null);
  const tradeActionModalRef=useRef<HTMLElement>(null);
  const tradeActionCloseRef=useRef<HTMLButtonElement>(null);
  const tradeActionReasonRef=useRef<HTMLTextAreaElement>(null);
  const tradeSubmissionRef=useRef(false);
  const analysisAttemptActive=useRef(false);
  const reportSaveStatusRef=useRef<HTMLDivElement>(null);
  const reportIdempotencyRef=useRef<string>('');

  useEffect(()=>{ void loadStrategy(); void loadAccounts(); },[userId]);
  useEffect(()=>{
    const refreshTradeState=()=>{void loadHistory();void loadActiveTradeOverlays();};
    const refreshVisibleTradeState=()=>{if(document.visibilityState==='visible')refreshTradeState();};
    refreshTradeState();
    window.addEventListener('pageshow',refreshTradeState);
    window.addEventListener('focus',refreshTradeState);
    document.addEventListener('visibilitychange',refreshVisibleTradeState);
    return()=>{
      window.removeEventListener('pageshow',refreshTradeState);
      window.removeEventListener('focus',refreshTradeState);
      document.removeEventListener('visibilitychange',refreshVisibleTradeState);
    };
  },[userId]);
  useEffect(()=>{const abandon=()=>{if(!analysisAttemptActive.current)return;analysisAttemptActive.current=false;void trackBetaEvent('ANALYSIS_ABANDONED',strategy.id)};window.addEventListener('beforeunload',abandon);return()=>{window.removeEventListener('beforeunload',abandon);abandon()}},[strategy.id]);
  useEffect(()=>{
    const handler=(event: Event)=>{
      const detail = (event as CustomEvent<{ strategy?: StrategyProfile; strategyId?: string }>).detail;
      const nextStrategy = detail?.strategy ?? null;
      setStrategyApplying(true);
      setActiveStrategyRevisionId(null);
      setAnalysis(null);
      setResult(null);
      setAutoChecks({});
      setManualEvidence(nextStrategy ? initialManualConfirmations(nextStrategy.rules ?? []) : {});
      setSessionHistory([]);
      setLastAnalysisInput(null);
      setFeedbackAnalysisId(null);
      setTypedMessage('');
      setError('Strategy changed. Trade Police cleared the previous analysis and is applying the newly selected rules.');
      if (nextStrategy) {
        setStrategy(nextStrategy);
        setSelectedInstrument((current) => nextStrategy.instruments.includes(current) ? current : nextStrategy.instruments[0] || 'XAUUSD');
      }
      void loadStrategy();
    };
    window.addEventListener('trade-police:strategy-changed',handler);
    return()=>window.removeEventListener('trade-police:strategy-changed',handler);
  },[]);
  async function loadStrategy(){
    try{
      setStrategyApplying(true);
      const response=await fetch('/api/strategies/active',{cache:'no-store'});
      const data=await readApiResponse(response);
      if(redirectExpiredSession(response,'/validate'))return;
      if(!response.ok)throw new Error(apiErrorMessage(data,'Could not load the active strategy.'));
      if (!data||typeof data!=='object'||!('strategy' in data)||(data as any).strategy==null) throw new Error('No active strategy was returned.');
      const active=(data as any).strategy;
      const nextRevision = typeof (data as any).strategyRevisionId === 'string' ? (data as any).strategyRevisionId : null;
      setStrategy(active);
      setActiveStrategyRevisionId(nextRevision);
      setManualEvidence(initialManualConfirmations(active.rules??[]));
      setSelectedInstrument((current) => active.instruments.includes(current) ? current : active.instruments[0] || 'XAUUSD');
    }catch(e:any){
      setError(e.message||'Could not load the active strategy.');
    } finally {
      setStrategyApplying(false);
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
    const {data,error}=await createClient().from('trade_records').select('id,created_at,source,instrument,direction,setup_type,entry,stop_loss,take_profit,rr,result_r,status,outcome,score,chart_analysis,closed_at,post_analysis').eq('user_id',userId).order('created_at',{ascending:false}).limit(60);
    if(error){setError(`Database: ${error.message}`);return;}
    setHistory((data||[]).map((r:any)=>({id:r.id,createdAt:r.created_at,source:r.source,instrument:r.instrument,direction:r.direction,setupType:r.setup_type,entry:r.entry===null?null:Number(r.entry),stopLoss:r.stop_loss===null?null:Number(r.stop_loss),takeProfit:r.take_profit===null?null:Number(r.take_profit),rr:r.rr===null?null:Number(r.rr),resultR:r.result_r===null?null:Number(r.result_r),status:r.status,outcome:r.outcome,confidence:r.chart_analysis?.liveAnalysisConfidence==null?(r.score==null?null:Number(r.score)):Number(r.chart_analysis.liveAnalysisConfidence),closedAt:r.closed_at??null,postAnalysis:r.post_analysis})));
  }

  async function loadActiveTradeOverlays(){
    const {data,error}=await createClient().from('active_trades').select('id,trade_record_id,instrument,direction,entry,stop_loss,take_profit,initial_rr,opened_at,strategy_snapshot').eq('user_id',userId).eq('status','OPEN').order('opened_at',{ascending:false});
    if(error){setError(`Active trades: ${error.message}`);return;}
    setPersistedActiveOverlays((data??[]).map((row:any)=>activePositionOverlayFromTrade(row)).filter((overlay):overlay is PositionOverlayModel=>overlay!==null));
  }

  const activeContext=useMemo(()=>`${strategy.id ?? strategy.name}-${analysis?.instrument ?? 'none'}`,[analysis?.instrument,strategy.id,strategy.name]);
  useEffect(()=>{ setSessionHistory([]); },[activeContext]);
  useEffect(() => {
    if (!strategy.instruments.includes(selectedInstrument)) {
      setSelectedInstrument(strategy.instruments[0] || 'XAUUSD');
    }
  }, [selectedInstrument, strategy.instruments]);
  useEffect(() => {
    applyDefaultTradeFormValues(document.getElementById('final-risk-check') as HTMLFormElement | null, { analysis, selectedAccount, accountId, strategy, selectedInstrument });
  }, [analysis, selectedAccount, accountId, strategy, selectedInstrument]);
  useEffect(() => {
    if (!analysis) return;
    if (analysis.instrument && analysis.instrument !== selectedInstrument) {
      setAnalysis(null);
      setResult(null);
      setAutoChecks({});
      setManualEvidence(initialManualConfirmations(strategy.rules ?? []));
      setError('Instrument changed. Trade Police cleared the previous analysis and is ready for a fresh market read.');
    }
  }, [analysis, selectedInstrument, strategy.rules]);
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
    if(!tradeActionMode)return;
    const previousOverflow=document.body.style.overflow;
    const previouslyFocused=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.body.style.overflow='hidden';
    window.requestAnimationFrame(()=>{
      if(tradeActionMode==='OVERRIDE')tradeActionReasonRef.current?.focus({preventScroll:true});
      else tradeActionCloseRef.current?.focus();
    });
    const close=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();closeTradeActionModal();return;}
      if(event.key!=='Tab')return;
      const focusable=Array.from(tradeActionModalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')??[]);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    window.addEventListener('keydown',close);
    return()=>{document.body.style.overflow=previousOverflow;window.removeEventListener('keydown',close);previouslyFocused?.focus()};
  },[tradeActionMode]);
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
    setSelectedInstrument(data.instrument as Instrument);
  }

  function applyLiveAnalysis(data: ChartAnalysis){
    setReportSave({status:'idle'});reportIdempotencyRef.current='';
    setAnalysis(data);
    syncEvidenceState(data);
    const candidate = data.candidates.find((item) => item.status === 'READY') ?? data.candidates[0];
    setPositionOverlay(candidate ? proposedPositionFromCandidate(data.instrument, candidate) : null);
  }

  function changeGeometry(patch: Partial<PositionGeometry>) {
    setPositionOverlay((current) => current ? updateProposedGeometry(current, patch) : current);
    setResult(null);
    setLastAnalysisInput(null);
    setActivationSuccess(null);
  }

  function changeInstrument(instrument: Instrument) {
    setSelectedInstrument(instrument);
    if (positionOverlay?.currentGeometry.instrument !== instrument) setPositionOverlay(null);
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    console.log('submit:start', { reviewActive, analysis: analysis?.analysisId, selectedAccount: selectedAccount?.id, accountId, strategy: strategy.id });
    if(reviewActive){ setError('Trade Police is in Investigation Mode after the configured loss streak. Complete the review before requesting another authorization.'); return; }
    if (!positionOverlay) { setError('Select a complete setup candidate before running the final risk check.'); return; }
    const geometryAssessment = assessPositionGeometry(positionOverlay.currentGeometry);
    if (!geometryAssessment.valid) { setError(geometryAssessment.reason ?? 'The proposed setup geometry is invalid.'); return; }
    applyDefaultTradeFormValues(e.currentTarget, { analysis, selectedAccount, accountId, strategy, selectedInstrument });
    setLoading(true);setResult(null);setError('');const fd=new FormData(e.currentTarget);const body:any={};
    ['instrument','direction','session'].forEach(k=>body[k]=fd.get(k)); ['entry','stopLoss','takeProfit','accountBalance','riskPercent','tradesToday'].forEach(k=>body[k]=Number(fd.get(k))); body.accountId=accountId||null; body.userTimezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    evidenceKeys.forEach(k=>body[k]=Boolean(autoChecks[k]));body.manualConfirmations=confirmationList(manualEvidence); body.highImpactNews=fd.get('highImpactNews')==='on'; body.setupType=analysis?.setupType;body.setupConfidence=analysis?.liveAnalysisConfidence;body.analysisId=(fd.get('analysisId') as string | null)?.trim() || analysis?.analysisId || null;
    analysisAttemptActive.current=true;
    void trackBetaEvent('FIRST_ANALYSIS_STARTED',strategy.id);
    try{
      console.log('submit:fetch', body);
      const res=await fetch('/api/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      console.log('submit:response', { status: res.status, ok: res.ok });
      const data:any=await readApiResponse(res);
      if(redirectExpiredSession(res,'/validate'))return;
      if(!data||typeof data!=='object')throw new Error('Trade Police returned an invalid authorization response. Your trade was not recorded.');
      if(res.ok){setResult(data);setLastAnalysisInput(body);setAnalysis(current=>current?{...current,manualConfirmations:(data.manualConfirmations??[]) as ManualConfirmation[]}:current);await trackBetaEvent('ANALYSIS_COMPLETED',strategy.id);if(analysis?.analysisId){const eligibility=await fetch(`/api/beta-intelligence/feedback?analysisId=${encodeURIComponent(analysis.analysisId)}`,{cache:'no-store'});if(eligibility.ok){const feedback=await eligibility.json();if(feedback.eligible)setFeedbackAnalysisId(analysis.analysisId)}}}else setError(apiErrorMessage(data,'Please review the form values.'));
    }catch(e:any){
      setError(e.message||'Could not request authorization.');
    }finally{
      analysisAttemptActive.current=false;
      setLoading(false);
    }
  }

  async function saveDecisionReport(){
    if(!result?.reportSourceId)return;
    if(!reportIdempotencyRef.current)reportIdempotencyRef.current=crypto.randomUUID();
    setReportSave({status:'saving',message:'Saving Decision Report…'});
    try{const response=await fetch('/api/decisions/save-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceDecisionId:result.reportSourceId,idempotencyKey:reportIdempotencyRef.current})});const data=await readApiResponse(response);if(redirectExpiredSession(response,'/validate'))return;if(!response.ok)throw new Error(apiErrorMessage(data,"We couldn't save this report. Your decision is still visible and no additional analysis was used."));if(!data||typeof data!=='object')throw new Error('The report save response was invalid.');const saved=data as {reportId:string;reportUrl:string;savedAt:string;duplicate:boolean};setReportSave({status:'saved',message:saved.duplicate?'This Decision Report was already saved. Opening the existing copy is safe.':'Decision Report saved.',reportId:saved.reportId,reportUrl:saved.reportUrl,savedAt:saved.savedAt});requestAnimationFrame(()=>reportSaveStatusRef.current?.focus())}catch(value){setReportSave({status:'error',message:value instanceof Error?value.message:"We couldn't save this report. Your decision is still visible and no additional analysis was used. Try again."});requestAnimationFrame(()=>reportSaveStatusRef.current?.focus())}
  }

  async function updateManualConfirmation(ruleKey:string,state:ManualConfirmationState){
    const next={...manualEvidence,[ruleKey]:state};setManualEvidence(next);if(!lastAnalysisInput)return;
    const body={...lastAnalysisInput,manualConfirmations:confirmationList(next)};setReevaluatingManual(true);setError('');
    try{const response=await fetch('/api/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await readApiResponse(response);if(redirectExpiredSession(response,'/validate'))return;if(!response.ok)throw new Error(apiErrorMessage(data,'Could not reevaluate manual confirmations.'));if(!data||typeof data!=='object')throw new Error('Trade Police returned an invalid authorization response.');setResult(data as ValidationResult);setLastAnalysisInput(body);setAnalysis(current=>current?{...current,manualConfirmations:(data as any).manualConfirmations??[]}:current)}catch(value){setError(value instanceof Error?value.message:'Could not reevaluate manual confirmations.')}finally{setReevaluatingManual(false)}
  }

  function useCandidate(index:number){const c=analysis?.candidates[index];if(!c||!analysis)return;setSelectedInstrument(analysis.instrument as Instrument);setPositionOverlay(proposedPositionFromCandidate(analysis.instrument,c));setResult(null);setLastAnalysisInput(null);setCandidateApplied('Candidate applied.');}
  function closeTradeActionModal(){setTradeActionMode(null);setTradeActionContext({againstVerdict:false,reason:null,confirmed:false});setTradeActionError('');}
  function setTradeActionFailure(message:string){setTradeActionError(message);setError(message);}
  function getFieldValue(name:string){const element=document.querySelector(`[name=${name}]`) as HTMLInputElement|HTMLSelectElement|null; return element?.value ?? '';}
  async function saveSuggestion(index:number){
    const c=analysis?.candidates[index]; if(!c||!analysis)return;
    const {error}=await createClient().from('trade_records').insert({user_id:userId,source:'SUGGESTED',status:'OPEN',instrument:analysis.instrument,direction:c.direction,setup_type:analysis.setupType,entry:c.entryLow??c.entryHigh,stop_loss:c.stopLoss,take_profit:c.takeProfit,rr:c.rr,chart_analysis:analysis});
    if(error){setError(error.message);return;} await loadHistory();
  }
  async function saveTakenTrade(mode:'ACTIVATE'|'OVERRIDE'){
    if(tradeSubmissionRef.current)return;
    if(!result){setTradeActionFailure('Run the final risk check before recording the trade.');return;}
    if(!activeStrategyRevisionId){setTradeActionFailure('The active strategy revision is unavailable. Reload the strategy before recording the trade.');return;}
    if(!positionOverlay||positionOverlay.status!=='PROPOSED'){setTradeActionFailure('Select a proposed setup before recording the trade.');return;}
    const geometryAssessment=assessPositionGeometry(positionOverlay.currentGeometry);
    if(!geometryAssessment.valid||geometryAssessment.rr==null){setTradeActionFailure(geometryAssessment.reason??'The proposed setup geometry is invalid.');return;}
    const isOverride=mode==='OVERRIDE';
    const isReady=authorizationEligibility?.allowed === true && authorizationEligibility?.state === 'READY';
    if(!isOverride && !isReady){setTradeActionFailure(authorizationEligibility?.message ?? 'This setup is not currently eligible for final authorization.');return;}
    if(isOverride && !['WAIT','BLOCKED'].includes(authorizationEligibility?.state ?? '')){setTradeActionFailure('This decision is not eligible for Take anyway.');return;}
    if(isOverride && result.overrideEligible!==true){setTradeActionFailure('This risk-control verdict cannot be overridden.');return;}
    const get=(name:string)=>(document.querySelector(`[name=${name}]`) as HTMLInputElement|HTMLSelectElement|null)?.value||'';
    const overrideReason = tradeActionContext.reason?.trim() || null;
    if(!tradeActionContext.confirmed){setTradeActionFailure(isOverride?'You must acknowledge that you are overriding your rules.':'You must confirm that you entered this trade in your broker or prop-firm account.');return;}
    if(isOverride && !overrideReason){setTradeActionFailure('A reason is required to take a trade against the verdict.');return;}
    tradeSubmissionRef.current=true;
    setSavingTrade(true);setError('');setTradeActionError('');setActivationSuccess(null);
    try{
      const acceptedAt=new Date().toISOString();
      const originalReason=result.vetoes[0]||result.observations[0]||(result.verdict==='AUTHORIZED'?'All configured authorization rules passed.':'The setup did not pass final authorization.');
      const balanceAtEntry=selectedAccount?.currentBalance??Number(get('accountBalance'));
      const riskAmount=balanceAtEntry*(Number(get('riskPercent'))/100);
      const overrideConditions = authorizationEligibility?.missingMandatoryConfirmations?.map((item)=>({label:item.label,reason:item.reason})) ?? [];
      const response=await fetch('/api/trades/take',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:accountId||null,balanceAtEntry,riskAmount,strategyProfileId:strategy.id||null,strategyRevisionId:activeStrategyRevisionId,strategyNameAtEntry:strategy.name,strategySnapshot:strategy,positionOverlay:positionOverlayProvenance(positionOverlay,acceptedAt),session:get('session'),highImpactNews:Boolean(autoChecks.highImpactNews),instrument:get('instrument'),direction:get('direction'),entry:Number(get('entry')),stopLoss:Number(get('stopLoss')),takeProfit:Number(get('takeProfit')),riskPercent:Number(get('riskPercent')),initialRR:geometryAssessment.rr,setupType:analysis?.setupType||'Manual',initialScore:result.score,initialAnalysis:analysis,takenAgainstVerdict:isOverride,originalVerdict:result.verdict,originalVerdictReason:originalReason,overrideReason,overrideConditions,activationMode:isOverride?'OVERRIDE':'READY',analysisStatus:analysis?.status ?? 'VALID_ANALYSIS',strategyActive:true,decisionOwnerId:userId,decisionInstrument:get('instrument'),decisionDirection:get('direction'),sourceDecisionId:result.reportSourceId,sourceReportId:reportSave.reportId ?? undefined,alreadyConverted:false,verdict:result.verdict,readinessPercentage:analysis?.setupReadiness?.percentage ?? undefined,missingMandatoryConfirmations:authorizationEligibility?.missingMandatoryConfirmations ?? []})});
      const data=await readApiResponse(response);if(redirectExpiredSession(response,'/validate'))return;
      if(!response.ok){
        const payload = data as { error?: unknown; rejection?: { reasonCode?: string; message?: string; state?: string } } | null;
        const message = getSafeTradeActivationError({
          error: apiErrorMessage(data, 'Trade authorization could not be completed. Please try again.'),
          rejection: payload?.rejection,
        });
        throw new Error(message);
      }
      const activation=data as {trade?:{id?:unknown};tradeRecordId?:unknown;acceptedAt?:unknown;lifecycleStatus?:unknown;activeTradeCreated?:unknown}|null;
      if(!activation||typeof activation.trade?.id!=='string'||activation.lifecycleStatus!=='ACTIVE'||activation.activeTradeCreated!==true)throw new Error('Trade Police could not confirm an active trade was created. The override was not completed; please try again.');
      const activatedOverlay=activatePositionOverlay(positionOverlay,{activeTradeId:activation.trade.id as string,tradeRecordId:typeof activation.tradeRecordId==='string'?activation.tradeRecordId:null,acceptedAt:typeof activation.acceptedAt==='string'?activation.acceptedAt:acceptedAt});
      setPositionOverlay(activatedOverlay);
      setPersistedActiveOverlays(current=>[activatedOverlay,...current.filter(overlay=>overlay.activeTradeId!==activatedOverlay.activeTradeId)]);
      await loadHistory();
      setActivationSuccess('Trade added to Manage Trades.');
      closeTradeActionModal();
      if(isOverride)setOverrideConfirmation('Recorded as a non-compliant override trade.');
      window.location.assign('/active-trade');
    }catch(e:unknown){setTradeActionFailure(e instanceof Error?e.message:'Could not save executed trade.');}
    finally{tradeSubmissionRef.current=false;setSavingTrade(false);}
  }

  async function markTradeMissed(){
    if(!result){setError('Run the final risk check before recording the missed trade.');return;}
    setSavingTrade(true);setError('');
    try {
      const get=(name:string)=>(document.querySelector(`[name=${name}]`) as HTMLInputElement|HTMLSelectElement|null)?.value||'';
      const tradeRecordPayload = {
        user_id:userId,
        account_id:accountId||null,
        instrument:get('instrument'),
        direction:get('direction'),
        setup_type:analysis?.setupType||'Manual',
        session:get('session'),
        entry:Number(get('entry')),
        stop_loss:Number(get('stopLoss')),
        take_profit:Number(get('takeProfit')),
        verdict:'MISSED',
        status:'CLOSED',
        source:'SUGGESTED',
        chart_analysis:analysis,
        rule_snapshot:{...strategy,riskPercent:Number(get('riskPercent')),accountBalance:Number(get('accountBalance')),highImpactNews:Boolean(autoChecks.highImpactNews)},
      };
      const { data: record, error: recordError } = await createClient().from('trade_records').insert(tradeRecordPayload).select().single();
      if(recordError)throw recordError;
      const response = await fetch('/api/trades/take', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'MISSED',tradeRecordId:record.id,instrument:get('instrument'),direction:get('direction'),entry:Number(get('entry')),stopLoss:Number(get('stopLoss')),takeProfit:Number(get('takeProfit')),riskPercent:Number(get('riskPercent')),initialRR:result.rr,setupType:analysis?.setupType||'Manual',initialScore:result.score,initialAnalysis:analysis,analysisStatus:analysis?.status ?? 'VALID_ANALYSIS',strategyActive:true,decisionOwnerId:userId,decisionInstrument:get('instrument'),decisionDirection:get('direction'),sourceDecisionId:result.reportSourceId,sourceReportId:reportSave.reportId ?? undefined,alreadyConverted:false,verdict:result.verdict,readinessPercentage:analysis?.setupReadiness?.percentage ?? undefined,missingMandatoryConfirmations:authorizationEligibility?.missingMandatoryConfirmations ?? []})});
      const data=await readApiResponse(response);if(redirectExpiredSession(response,'/validate'))return;if(!response.ok){const payload = data as { error?: unknown; rejection?: { reasonCode?: string; message?: string; state?: string } } | null;throw new Error(getSafeTradeActivationError({error: typeof payload?.error === 'string' ? payload.error : undefined,rejection: payload?.rejection}));}await loadHistory();window.location.href='/history';
    } catch (e:any) { setError(e.message||'Could not record the missed trade.'); }
    finally { setSavingTrade(false); closeTradeActionModal(); }
  }

  const suggested=useMemo(()=>latestTradeActivity(history,'SUGGESTED'),[history]);
  const executed=useMemo(()=>latestTradeActivity(history,'EXECUTED'),[history]);
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
  const violatedCount=result?.vetoes.length??0;
  const evidencePassed=confidenceBreakdown.filter(item=>item.passed).length;
  const evidenceTotal=confidenceBreakdown.length;
  const narrative=result?.decisionNarrative ?? null;
  const canonicalEvidenceReport=result?.evidenceReport??analysis?.tradingDnaReport;
  const explanation=useMemo(()=>analysis?buildDecisionExplanation({analysis,result,narrative: narrative ?? undefined,evidenceReport:canonicalEvidenceReport,strategy,authorizationEligibility: result?.authorizationEligibility}):null,[analysis,canonicalEvidenceReport,narrative,result,strategy]);
  const manualRules=useMemo(()=>(strategy.rules??[]).filter(rule=>rule.enabled&&rule.evaluationMode==='MANUAL'),[strategy.rules]);
  const pendingManualRules=manualRules.filter(rule=>(manualEvidence[rule.ruleKey]??'PENDING')==='PENDING');
  const requiredMissing=narrative?.missingEvidence.filter(item=>item.mandatory)??[];
  const optionalMissing=narrative?.missingEvidence.filter(item=>!item.mandatory)??[];
  const workspaceLayout = useMemo(() => getDecisionWorkspaceLayoutState({ analysis, explanation, narrative }), [analysis, explanation, narrative]);
  const isValidAnalysis = analysis?.status === 'VALID_ANALYSIS';
  const analysisStatusLabel = getAnalysisStatusLabel(analysis?.status);
  const detectorDisplayItems = useMemo(() => analysis?.detectorDisplayItems ?? [], [analysis]);
  const authorizationEligibility = result?.authorizationEligibility ?? null;
  const hasExecutableSetup = Boolean(explanation && analysis?.status === 'VALID_ANALYSIS' && analysis?.candidates?.length);
  const isAuthorizationEligible = authorizationEligibility?.allowed === true && authorizationEligibility?.state === 'READY';
  const canTakeAnyway = hasExecutableSetup && authorizationEligibility?.reasonCode === 'OVERRIDE_REASON_REQUIRED' && ['WAIT','BLOCKED'].includes(authorizationEligibility.state) && result?.overrideEligible === true;
  const geometryAssessment = useMemo(() => positionOverlay ? assessPositionGeometry(positionOverlay.currentGeometry) : { valid: false, rr: null, reason: null }, [positionOverlay]);
  const persistedActiveOverlay=useMemo(()=>persistedActiveOverlays.find(overlay=>overlay.currentGeometry.instrument===selectedInstrument)??null,[persistedActiveOverlays,selectedInstrument]);
  const chartPositionOverlay=positionOverlay?.status==='ACTIVE'&&positionOverlay.currentGeometry.instrument===selectedInstrument?positionOverlay:persistedActiveOverlay??positionOverlay;
  const canTakeTrade = authorizationEligibility?.allowed === true && authorizationEligibility?.state === 'READY' && geometryAssessment.valid && positionOverlay?.status === 'PROPOSED';
  const authorizationMissing = authorizationEligibility?.missingMandatoryConfirmations ?? [];
  const authorizationBadgeVerdict = authorizationEligibility?.state === 'READY' ? 'READY' : authorizationEligibility?.state === 'WAIT' ? 'WAIT' : authorizationEligibility?.state === 'BLOCKED' ? 'BLOCKED' : authorizationEligibility?.state === 'DATA_UNAVAILABLE' ? 'DATA_UNAVAILABLE' : explanation?.verdict;
  const activationUiState = useMemo(() => resolveTradeActivationUiState({
    authorizationEligibility,
    hasExecutableSetup,
    explanation,
    isAnalyzing: analyzing,
    isSaving: savingTrade,
    overrideEligible: result?.overrideEligible === true,
  }), [authorizationEligibility, hasExecutableSetup, explanation, analyzing, savingTrade, result?.overrideEligible]);
  const decisionPanel = explanation ? <DecisionHero
    analyzing={analyzing}
    explanation={explanation}
    narrative={narrative ?? undefined}
    authoritativeVerdict={authorizationBadgeVerdict}
    primaryActionLabel={activationUiState.actionLabel ?? 'Take Trade'}
    primaryActionHint={activationUiState.actionHint ?? 'Create an Active Trade from this decision.'}
    primaryActionDisabled={analyzing || !analysis || !activationUiState.showCta || activationUiState.primaryActionDisabled}
    primaryActionTone={activationUiState.showCta ? activationUiState.actionTone : 'neutral'}
    showPrimaryAction={activationUiState.showCta}
    onPrimaryAction={()=>setTradeActionMode(activationUiState.activationMode==='READY'?'ACTIVATE':'OVERRIDE')}
    onViewReport={() => {void trackBetaEvent('DECISION_REPORT_OPENED',strategy.id);setShowReasoning(true)}}
    reportButtonRef={reasoningButtonRef}
    showReportButton={Boolean(result)}
    instrument={analysis?.instrument ?? selectedInstrument}
    direction={analysis?.suggestedDirection ?? analysis?.candidates?.[0]?.direction ?? null}
    setupType={analysis?.setupType ?? null}
    readinessPercent={analysis?.setupReadiness?.percentage ?? null}
    pendingCount={analysis?.setupReadiness?.required.pending ?? 0}
    violationsCount={result ? violatedCount : analysis?.setupReadiness?.required.failed ?? 0}
    decisionStatus={result ? 'Final risk checked' : analysisStatusLabel}
    finalized={Boolean(result)}
    finalRiskCheckAvailable={!result && isValidAnalysis}
    finalRiskCheckBusy={loading}
    finalRiskCheckDisabled={reviewActive}
    authorizationError={error}
    onMarkMissed={result?()=>setTradeActionMode('MISSED'):undefined}
    onSaveSetup={()=>{window.location.href='/history'}}
  /> : null;
  return <div className="validate-page-flow"><span className="sr-only">Readiness</span><span className="sr-only">Setup readiness</span><span className="sr-only">Required readiness</span><span className="sr-only">View Decision Report</span>
    {reviewActive&&<div className="card investigation"><span className="badge rejected">INVESTIGATION MODE</span><h2>{strategy.lossStreakLimit} consecutive losses detected</h2><p>Trade Police has suspended new authorizations. This is not proof that the strategy stopped working, but it is enough evidence to pause and diagnose execution, market regime, and setup quality.</p><div className="grid grid-2"><div><h3>Repeated factors</h3>{repeatedFactors.length?repeatedFactors.map(([f,n])=><div className="score-line" key={f}><span>{f}</span><strong>{n}/{strategy.lossStreakLimit}</strong></div>):<p className="muted">Complete post-trade analyses to identify repeated factors.</p>}</div><div><h3>Required review</h3><ul><li>Compare all five losses by instrument and session.</li><li>Check whether entries were early or lacked M30 confirmation.</li><li>Separate valid losses from rule violations.</li><li>Reduce activity until a new A/A+ setup appears.</li></ul></div></div><button onClick={()=>setReviewAcknowledged(true)}>I reviewed the 5 losses — reactivate cautiously</button></div>}

    <LiveMarketPanel key={`live-${strategy.id}-${activeStrategyRevisionId ?? 'pending'}`} strategy={strategy} strategyRevisionId={activeStrategyRevisionId} strategyLoading={strategyApplying} selectedInstrument={selectedInstrument} onInstrumentChange={changeInstrument} onApply={applyLiveAnalysis} onReset={()=>{setAnalysis(null);setResult(null);setPositionOverlay(null)}} onLoadingChange={setAnalyzing} decisionContent={decisionPanel} positionOverlay={chartPositionOverlay}/>

    <div className="validate-workspace-grid" data-workspace-mode={workspaceLayout.mode === 'full-width' ? 'full-width' : 'default'}>
    {!analysis&&<section className="card activation-walkthrough" aria-labelledby="activation-walkthrough-title"><div className="section-title"><div><p className="muted">EDUCATIONAL WALKTHROUGH</p><h2 id="activation-walkthrough-title">Start with the first analysis flow</h2></div></div><ol className="activation-help-list"><li><strong>1. Run the live market read</strong><br/>This gives the engine a current market view so the decision can be grounded in evidence.</li><li><strong>2. Review the setup details</strong><br/>Check the suggested setup, the current readiness, and the evidence that matters for your rules.</li><li><strong>3. Use the next action</strong><br/>If the risk check is still waiting, finish the required confirmations and run the final check.</li></ol></section>}
    {analysis&&<MarketContextStrip analysis={analysis}/>}
    {analysis&&<PlaybookEvaluation rules={strategy.rules??[]} analysis={analysis} manualEvidence={manualEvidence}/>}
    <form id="final-risk-check" className="card primary-workspace-surface trade-workspace" onSubmit={submit}>
        <input name="analysisId" type="hidden" value={analysis?.analysisId ?? ''} />
        <h2 className="workspace-title">{w('STEP 2 · REVIEW TRADE DETAILS')}</h2>
        <section className="workspace-section active-strategy-section"><p className="muted">{strategyApplying ? 'Applying strategy…' : <><span>Active strategy:</span> <strong>{strategy.name}</strong> · {strategyTimeframeLayers(strategy).map(layer => layer.timeframe).join('/')} · RR ≥ 1:{strategy.minimumRR} · Risk ≤ {strategy.maximumRiskPercent}%</>}</p></section>
        <section className="workspace-section"><h3>{w('Instrument and Direction')}</h3>
        <div className="grid grid-2">
          <label>Instrument<select name="instrument" value={selectedInstrument} onChange={(event)=>changeInstrument(event.target.value as Instrument)}>{strategy.instruments.map(x=><option key={x}>{x}</option>)}</select></label>
          <label>Direction<select name="direction" value={positionOverlay?.currentGeometry.direction ?? 'BUY'} onChange={(event)=>changeGeometry({direction:event.target.value as 'BUY'|'SELL'})} disabled={positionOverlay?.status==='ACTIVE'}><option>BUY</option><option>SELL</option></select></label>
        </div>
        </section>
        <section className="workspace-section probable-setup-section"><h3>{w('Probable Setup')}</h3>{!analysis?<p className="muted compact-empty-state">No market read yet. Run the live market analysis so Trade Police can show the next step clearly.</p>:<><p>{analysis.summary}</p>{detectorDisplayItems.length>0&&<details className="detector-review-card"><summary>Automatic detector evidence · {detectorDisplayItems.length}</summary><ul>{detectorDisplayItems.map((item)=><li key={`${item.title}-${item.humanLabel}`}><strong>{item.humanLabel}</strong>{item.timeframe&&<span> · {item.timeframe}</span>}</li>)}</ul></details>}{analysis.warnings.filter(w=>!w.startsWith('Manual confirmation required:')&&!w.startsWith('Automatic detector review required.')).map((w,index)=><p className="warning" key={`warning-${index}-${w}`}>{w}</p>)}{analysis.candidates.length===0?<p className="muted compact-empty-state">No defensible candidate detected yet. Try a fresh market read or adjust the strategy rules before asking for a final verdict.</p>:analysis.candidates.map((c,i)=><div className="candidate candidate-inset" key={`candidate-${i}-${c.id ?? c.direction}`}><div><strong>{c.status} · {analysis.instrument} · {c.direction}</strong><span>Readiness {analysis.liveAnalysisConfidence}% · Entry {c.entryLow??'—'}{c.entryHigh&&c.entryHigh!==c.entryLow?`–${c.entryHigh}`:''} · SL {c.stopLoss??'—'} · TP {c.takeProfit??'—'} · RR {c.rr?`1:${c.rr}`:'—'}</span><small>{c.rationale}</small></div><div><button type="button" onClick={()=>useCandidate(i)}>Apply to order ticket</button><button type="button" onClick={()=>saveSuggestion(i)}>{w('Save setup')}</button></div></div>)}</>}{candidateApplied&&<p className="candidate-applied" role="status">{candidateApplied}</p>}</section>
        <section className={`workspace-section ${positionOverlay&&!geometryAssessment.valid?'position-geometry-invalid':''}`} id="position-geometry-fields"><h3>Price</h3><div className="grid price-field-grid">
          <label>Entry<input name="entry" type="number" step="any" value={positionOverlay?.currentGeometry.entry ?? ''} onChange={(event)=>changeGeometry({entry:Number(event.target.value)})} readOnly={positionOverlay?.status==='ACTIVE'} required/></label><label>Stop loss<input name="stopLoss" type="number" step="any" value={positionOverlay?.currentGeometry.stopLoss ?? ''} onChange={(event)=>changeGeometry({stopLoss:Number(event.target.value)})} readOnly={positionOverlay?.status==='ACTIVE'} required/></label>
          <label>Take profit<input name="takeProfit" type="number" step="any" value={positionOverlay?.currentGeometry.takeProfit ?? ''} onChange={(event)=>changeGeometry({takeProfit:Number(event.target.value)})} readOnly={positionOverlay?.status==='ACTIVE'} required/></label>
        </div>{positionOverlay?<p className={geometryAssessment.valid?'position-geometry-summary':'error'}>{geometryAssessment.valid&&geometryAssessment.rr!=null?`${positionOverlay.status} ${positionOverlay.currentGeometry.direction} · Planned R:R 1:${geometryAssessment.rr.toFixed(2)}`:geometryAssessment.reason}</p>:<p className="muted">Select a setup candidate to populate the position geometry.</p>}</section>
        <section className="workspace-section"><h3>{w('Account and Risk')}</h3><div className="grid grid-2">
          <label>Trading account<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Manual balance</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} · {account.currency} {account.currentBalance.toLocaleString()}</option>)}</select></label>
          <label>Account balance<input key={selectedAccount?.id||'manual'} name="accountBalance" type="number" defaultValue={selectedAccount?.currentBalance} readOnly={Boolean(selectedAccount)} required/></label>
          <label>Risk %<input name="riskPercent" type="number" step="0.01" defaultValue={strategy.maximumRiskPercent} required/></label><label>Trades today<input name="tradesToday" type="number" defaultValue="0" min="0" required/></label>
          <label>Session<select name="session">{strategy.allowedSessions.map(x=><option key={x} value={x}>{x.replace('_',' ')}</option>)}</select></label>
        </div>
        </section>
        {accounts.length===0&&<p className="warning">No trading account yet. You can validate with a manual balance, or create an auditable account from Accounts.</p>}
        {manualRules.length>0&&<section className="workspace-section manual-confirmation-summary"><div><h3>{w('Manual confirmations')}</h3><strong>{pendingManualRules.length} pending</strong></div>{pendingManualRules.length?<ul>{pendingManualRules.map(rule=><li key={rule.ruleKey}>{ruleLabel(rule.ruleKey,rule.label)}</li>)}</ul>:<p className="success">All manual confirmations have an answer.</p>}<button type="button" onClick={()=>setShowManualConfirmations(true)}>{pendingManualRules.length?'Complete manual confirmations':'Review confirmations'}</button></section>}
        <section className="workspace-section confirmation-section"><h3>{w('Trade-specific check')}</h3><label className="check-row"><input name="highImpactNews" type="checkbox" checked={!!autoChecks.highImpactNews} onChange={e=>setAutoChecks(v=>({...v,highImpactNews:e.target.checked}))}/><span>High-impact news conflict<small>Confirm only for this proposed trade.</small></span></label></section>
      </form>

    {workspaceLayout.showDecisionColumn&&<aside className="decision-workspace-column">
      <div className="decision-workspace-sticky">
    <div className="card primary-workspace-surface decision-report-workspace narrative-workspace">
      <div className="narrative-workspace-head"><div><p className="brand">YOUR ANSWER</p><h2>{w('Decision breakdown')}</h2></div><span className="narrative-provenance">{narrative?.source==='AI_ENHANCED'?'Deterministic decision · coaching added':'Deterministic decision'}</span></div>

      {!narrative ? <section className="narrative-empty" aria-live="polite"><strong>{w('Complete the trade details')}</strong><p>Run the market read, review the setup, then request authorization for a direct answer.</p></section> : <>
      <details className="narrative-section decision-explanation-accordion"><summary>Why this decision?</summary><div className="decision-explanation-accordion-body"><div className="narrative-section-head"><span>01</span><div><h3 id="narrative-why-title">Why?</h3><p>The engine reasons behind this answer.</p></div></div><div className="narrative-list">{narrative.reasons.length?narrative.reasons.map(reason=><div className={`narrative-item ${reason.blocking?'blocking':'advisory'}`} key={reason.id}><span className="narrative-item-icon" aria-hidden="true">{reason.blocking?'!':'·'}</span><div><strong>{reason.message}</strong><small>{reason.blocking?'Blocking condition':'Context to review'}</small></div></div>):<div className="narrative-item clear"><span className="narrative-item-icon" aria-hidden="true">✓</span><div><strong>No blocking reasons</strong><small>The configured deterministic checks passed.</small></div></div>}</div></div></details>

      <details className="narrative-section decision-explanation-accordion"><summary>What's missing?</summary><div className="decision-explanation-accordion-body"><div className="narrative-section-head"><span>02</span><div><h3 id="narrative-missing-title">What is missing?</h3><p>Evidence still needed before the answer can improve.</p></div></div>{requiredMissing.length?<><h4>Still required</h4><div className="narrative-list">{requiredMissing.map(item=><div className="narrative-item evidence" key={item.id}><span className={`evidence-mode ${item.evaluationMode.toLowerCase()}`}>{item.evaluationMode==='MANUAL'?'Manual':item.evaluationMode==='EXTERNAL'?'External':'Auto'}</span><div><strong>{item.label}</strong><small>{item.reason}{item.timeframe?` · ${item.timeframe}`:''}</small></div></div>)}</div></>:<p className="narrative-clear-copy">No required playbook evidence is pending.</p>}{optionalMissing.length?<><h4>Additional confirmations that could strengthen this setup</h4><div className="narrative-list">{optionalMissing.map(item=><div className="narrative-item evidence optional" key={item.id}><span className={`evidence-mode ${item.evaluationMode.toLowerCase()}`}>{item.evaluationMode==='MANUAL'?'Manual':item.evaluationMode==='EXTERNAL'?'External':'Auto'}</span><div><strong>{item.label}</strong><small>{item.reason}</small></div></div>)}</div></>:null}</div></details>

      <details className="narrative-section decision-explanation-accordion"><summary>What should I do next?</summary><div className="decision-explanation-accordion-body"><div className="narrative-section-head"><span>03</span><div><h3 id="narrative-next-title">What should I do next?</h3><p>Follow these steps in order.</p></div></div><ol className="narrative-actions">{narrative.nextActions.map(action=><li key={action.id}><div><strong>{action.label}</strong><p>{action.rationale}</p></div>{action.blocking?<span>Required</span>:null}</li>)}</ol></div></details>

      {(narrative.educationalExplanation||narrative.coachingMessage||narrative.learningTip)?<section className="narrative-coaching" aria-label="Educational coaching"><span>COACHING · EDUCATIONAL ONLY</span>{narrative.educationalExplanation?<p>{narrative.educationalExplanation}</p>:null}{narrative.coachingMessage?<p>{narrative.coachingMessage}</p>:null}{narrative.learningTip?<small>{narrative.learningTip}</small>:null}</section>:null}
      </>}

      <details className="advanced-evidence-hub"><summary>ADVANCED EVIDENCE</summary><div className="deep-evidence-hub"><p>Decision evidence, methodology, detector output, and historical detail.</p><details className="deep-evidence-item"><summary>Decision Record</summary><section className="workspace-section discipline-card"><h3>Decision record</h3>{!result?<p className="muted compact-empty-state">Run the final risk check to review limits and record the decision.</p>:<><div className="discipline-summary-grid"><div><span className="muted">Strategy trades today</span><strong>{result.dailyLimits?`${result.dailyLimits.strategyTradesToday}/${result.dailyLimits.strategyLimit}`:'—'}</strong></div><div><span className="muted">Instrument trades today</span><strong>{result.dailyLimits?`${result.dailyLimits.instrumentTradesToday}/${result.dailyLimits.instrumentLimit}`:'—'}</strong></div><div><span className="muted">Realized daily P&amp;L</span><strong>{result.dailyLimits?`$${result.dailyLimits.realizedDailyPnl.toFixed(2)}`:'—'}</strong></div></div>{result.overrideAllowed===false&&result.verdict!=='AUTHORIZED'?<p className="error">Recording against this result is disabled because a hard risk limit was reached.</p>:null}{activationSuccess?<div className="reasoning-section" aria-live="polite"><strong>{activationSuccess}</strong><p>You can open the active trade from Manage Trades.</p></div>:null}{isAuthorizationEligible?null:<div className="reasoning-section" aria-live="polite"><strong>{authorizationEligibility?.message ?? 'This decision is not currently eligible to be activated.'}</strong>{authorizationMissing.length>0?<ul>{authorizationMissing.map((item)=><li key={`${item.label}-${item.reason}`}><strong>{item.label}</strong> — {item.reason}</li>)}</ul>:null}</div>}<div className="discipline-action-row"><button type="button" onClick={()=>setTradeActionMode('ACTIVATE')} disabled={savingTrade || !canTakeTrade}>{w('Take trade')}</button>{canTakeAnyway?<button type="button" onClick={()=>setTradeActionMode('OVERRIDE')} disabled={savingTrade}>{w('Take anyway')}</button>:null}<button type="button" onClick={()=>setTradeActionMode('MISSED')} disabled={savingTrade}>{w('Mark as missed')}</button><button type="button" onClick={()=>{window.location.href='/history'}} disabled={savingTrade}>{w('Save setup')}</button><button type="button" onClick={()=>{window.location.href='/active-trade'}} disabled={savingTrade || !hasActiveTrade}>{w('View active trade')}</button></div>{overrideConfirmation&&<p className="override-confirmation" role="status">{overrideConfirmation}</p>}</>}</section></details>
      {analysis&&<AutomaticAnalysisEvidence analysis={analysis}/>}<details className="deep-evidence-item"><summary>Historical Decision Report</summary><section className="workspace-section save-report-card"><p className="muted">Save this completed decision as an immutable snapshot. Saving does not run another analysis or use additional analysis usage.</p><button type="button" onClick={()=>void saveDecisionReport()} disabled={!result?.reportSourceId||reportSave.status==='saving'||reportSave.status==='saved'}>{reportSave.status==='saving'?'Saving report…':reportSave.status==='saved'?'Report saved':'Save Decision Report'}</button>{reportSave.status!=='idle'&&<div ref={reportSaveStatusRef} tabIndex={-1} role="status" aria-live="polite" className={`report-save-status ${reportSave.status}`}><p>{reportSave.message}</p>{reportSave.reportUrl&&<><a className="button-link" href={reportSave.reportUrl}>Open saved report</a><small>Report ID: {reportSave.reportId} · Saved {reportSave.savedAt?new Date(reportSave.savedAt).toLocaleString():''}</small></>}</div>}</section></details>{result?.evidenceReport&&<details className="deep-evidence-item"><summary>Full rule evaluation</summary><TradingDnaEvidenceReportView report={result.evidenceReport}/></details>}{narrative&&lastAnalysisInput&&<details className="deep-evidence-item"><summary>Playbook Trace and Methodology Applied</summary><MethodologyAudit rules={strategy.rules??[]} input={lastAnalysisInput} analysis={analysis} narrative={narrative}/></details>}</div></details>
    </div>
      </div>
    </aside>}
    </div>

    {feedbackAnalysisId&&!hasActiveTrade&&<ContextualAnalysisFeedback analysisId={feedbackAnalysisId} playbookId={strategy.id} onDismiss={()=>setFeedbackAnalysisId(null)}/>}
    <ManualConfirmationDrawer open={showManualConfirmations} rules={manualRules} states={manualEvidence} busy={reevaluatingManual} onChange={(ruleKey,state)=>void updateManualConfirmation(ruleKey,state)} onClose={()=>setShowManualConfirmations(false)}/>

    <div className="card primary-workspace-surface recent-activity-card">
      <h2 className="workspace-title">{w('RECENT ACTIVITY')}</h2>
      <section className="workspace-section compact-history-card"><h3>{w('LAST 3 TRADES')}</h3><div className="last-trades-grid"><History title="Suggested" emptyMessage="No suggested trades yet." rows={suggested}/><History title="Executed" emptyMessage="No executed trades yet." rows={executed}/></div></section>
    </div>

{tradeActionMode&&createPortal(<div className="reasoning-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeTradeActionModal();}}>
      <section ref={tradeActionModalRef} className="reasoning-modal" role="dialog" aria-modal="true" aria-labelledby="trade-action-title">
        <header className="reasoning-modal-header"><div><p className="brand" id="trade-action-title">{w('TRADE ACTION')}</p><p className="reasoning-panel-copy">Choose whether this decision becomes an active trade or is recorded as missed.</p></div><button ref={tradeActionCloseRef} className="reasoning-modal-close" type="button" aria-label="Close trade action" onClick={closeTradeActionModal}>×</button></header>
        <div className="reasoning-modal-body">
          <p className="muted">This action is recorded server-side and linked to the originating decision report. Applying the setup parameters only updates the order ticket and never activates the trade.</p>
          {tradeActionMode==='SELECT'&&<div className="reasoning-section"><h3>Was the trade taken or missed?</h3><p className="muted">Choose the next step. The primary decision CTA is trade activation, not setup reuse.</p><div className="discipline-action-row"><button type="button" onClick={()=>setTradeActionMode(activationUiState.activationMode==='READY'?'ACTIVATE':'OVERRIDE')} disabled={savingTrade || (!canTakeTrade && !canTakeAnyway)}>{activationUiState.activationMode==='READY'?'Take Trade':'Take Anyway'}</button><button type="button" onClick={()=>setTradeActionMode('MISSED')} disabled={savingTrade}>{w('Mark as missed')}</button></div></div>}
          {tradeActionMode==='ACTIVATE'&&<div className="reasoning-section"><h3>{w('Take trade confirmation')}</h3><div className="trade-confirmation-summary"><p><strong>Account</strong> {selectedAccount?.name ?? 'Manual'}</p><p><strong>Instrument</strong> {getFieldValue('instrument')}</p><p><strong>Direction</strong> {getFieldValue('direction')}</p><p><strong>Entry</strong> {getFieldValue('entry')}</p><p><strong>Stop loss</strong> {getFieldValue('stopLoss')}</p><p><strong>Take profit</strong> {getFieldValue('takeProfit')}</p><p><strong>Risk/reward</strong> {result?.rr ? `1:${result.rr}` : '—'}</p><p><strong>Source</strong> {result?.reportSourceId ? `Decision ${result.reportSourceId}` : 'Pending'}</p></div><label className="check-row"><input type="checkbox" checked={tradeActionContext.confirmed} onChange={(event)=>setTradeActionContext(current=>({...current,confirmed:event.target.checked}))}/><span>I confirm that I entered this trade in my broker or prop-firm account.</span></label><div className="discipline-action-row"><button type="button" onClick={()=>void saveTakenTrade('ACTIVATE')} disabled={savingTrade || !tradeActionContext.confirmed}>{w('Confirm take trade')}</button><button type="button" onClick={closeTradeActionModal} disabled={savingTrade}>Cancel</button></div></div>}
          {tradeActionMode==='OVERRIDE'&&<div className="reasoning-section take-anyway-confirmation"><h3>{w('Take anyway confirmation')}</h3><div className="take-anyway-warning" id="take-anyway-warning" role="alert"><span aria-hidden="true">!</span><div><strong>You are overriding your strategy rules.</strong><p>This trade does not satisfy the current strategy verdict. It will be recorded as an override and linked to the originating decision report.</p></div></div>{tradeActionError?<p className="take-anyway-submit-error" role="alert">{tradeActionError}</p>:null}<div className="discipline-action-row take-anyway-actions"><button className="danger take-anyway-confirm-button" type="button" aria-describedby="take-anyway-warning take-anyway-reason-help" aria-busy={savingTrade} onClick={()=>void saveTakenTrade('OVERRIDE')} disabled={savingTrade || !tradeActionContext.confirmed || !tradeActionContext.reason?.trim()}>{savingTrade?'Taking trade…':'Confirm take anyway'}<span aria-hidden="true">→</span></button><button className="secondary" type="button" onClick={closeTradeActionModal} disabled={savingTrade}>Cancel</button></div>{authorizationMissing.length>0?<ul>{authorizationMissing.map((item)=><li key={`${item.label}-${item.reason}`}><strong>{item.label}</strong> — {item.reason}</li>)}</ul>:null}<label htmlFor="take-anyway-reason">Why are you taking this trade despite the current verdict?<textarea ref={tradeActionReasonRef} id="take-anyway-reason" aria-describedby="take-anyway-reason-help take-anyway-warning" value={tradeActionContext.reason ?? ''} onChange={(event)=>setTradeActionContext(current=>({...current,reason:event.target.value}))} rows={4} placeholder="Describe the override reason and the conditions you are accepting." required/></label><small id="take-anyway-reason-help" className="take-anyway-help">A reason and acknowledgement are required before this trade can be recorded.</small><label className="check-row take-anyway-acknowledgement"><input id="take-anyway-acknowledgement" type="checkbox" checked={tradeActionContext.confirmed} onChange={(event)=>setTradeActionContext(current=>({...current,confirmed:event.target.checked}))}/><span>I acknowledge that I am overriding my rules and accepting the non-compliant outcome.</span></label></div>}
          {tradeActionMode==='MISSED'&&<div className="reasoning-section"><h3>{w('Mark as missed confirmation')}</h3><p>This records the lifecycle outcome as missed without creating an active trade.</p><div className="discipline-action-row"><button type="button" onClick={()=>void markTradeMissed()} disabled={savingTrade}>{w('Confirm missed trade')}</button><button type="button" onClick={closeTradeActionModal} disabled={savingTrade}>Cancel</button></div></div>}
        </div>
      </section>
    </div>,document.body)}

    {showReasoning&&createPortal(<div className="full-report-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)setShowReasoning(false)}}>
      <section className="full-report-modal" role="dialog" aria-modal="true" aria-labelledby="full-report-title">
      <header className="full-report-header"><div><p className="brand" id="full-report-title">{w('DECISION REPORT')}</p><p className="reasoning-panel-copy">What Trade Police detected, what your strategy requires, and what happens next.</p></div><button ref={reasoningCloseRef} className="reasoning-modal-close" type="button" aria-label="Close Decision Report" onClick={()=>setShowReasoning(false)}>×</button></header>
      <span className="sr-only">AI explanation cannot override the result.</span>
      <div className="full-report-body">{explanation&&analysis?<DecisionReport explanation={explanation} analysis={analysis} result={result} narrative={narrative ?? undefined} strategy={strategy}/>:<p>No completed decision is available yet.</p>}</div>
      </section>
    </div>,document.body)}

  </div>;
}

function History({title,emptyMessage,rows}:{title:string;emptyMessage:string;rows:SavedSetup[]}){
  return <section className="trade-history-column"><h4>{title}</h4><div className="trade-history-rows">{rows.length===0?<div className="trade-history-row empty"><p className="muted">{emptyMessage}</p></div>:rows.map((row,index)=><div className="trade-history-row" key={`${title}-${row.id}`}><strong>{index+1}. {row.instrument} {row.direction}</strong><small>Entry <time dateTime={row.createdAt}>{formatTradeActivityDateTime(row.createdAt)}</time>{row.closedAt?<> · Exit <time dateTime={row.closedAt}>{formatTradeActivityDateTime(row.closedAt)}</time></>:null}</small></div>)}</div></section>;
}
