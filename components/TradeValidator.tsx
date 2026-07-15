'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadDataUrl } from '@/lib/trade-repository';
import LiveMarketPanel from '@/components/LiveMarketPanel';
import { DEFAULT_STRATEGY_PROFILE } from '@/types/trade';
import type { ChartAnalysis, EvidenceKey, PostTradeAnalysis, StrategyProfile, TradeOutcome, TradeResult } from '@/types/trade';

const checks: [EvidenceKey | 'highImpactNews', string][] = [
  ['h4TrendAligned','H4 trend aligned'], ['h1TrendAligned','H1 aligned with H4'],
  ['structurePattern','HH/HL or LH/LL structure'], ['liquiditySweep','Liquidity sweep'],
  ['chochConfirmed','ChoCH confirmed'], ['bosConfirmed','BoS confirmed'],
  ['orderBlock','Valid order block'], ['fairValueGap','Valid FVG'],
  ['retestConfirmed','Retest / rejection confirmed'], ['highImpactNews','High-impact news conflict']
];
const evidenceKeys = checks.slice(0,9).map(c => c[0]) as EvidenceKey[];

type TradingAccount = { id:string; name:string; currency:string; currentBalance:number; isActive:boolean };

type SavedSetup = {
  id:string; createdAt:string; source:'SUGGESTED'|'EXECUTED'; instrument:string; direction:string; setupType:string;
  entry:number|null; stopLoss:number|null; takeProfit:number|null; rr:number|null; resultR?:number|null;
  status?:'OPEN'|'CLOSED'; outcome?:TradeOutcome; postTradeImage?:string; postAnalysis?:PostTradeAnalysis;
};

export default function TradeValidator({userId}:{userId:string}) {
  const [result,setResult]=useState<TradeResult|null>(null);
  const [analysis,setAnalysis]=useState<ChartAnalysis|null>(null);
  const [loading,setLoading]=useState(false);
  const [analyzing,setAnalyzing]=useState(false);
  const [savingTrade,setSavingTrade]=useState(false);
  const [error,setError]=useState('');
  const [images,setImages]=useState<{h4?:string;h1?:string;m30?:string}>({});
  const [autoChecks,setAutoChecks]=useState<Record<string,boolean>>({});
  const [history,setHistory]=useState<SavedSetup[]>([]);
  const [closingTrade,setClosingTrade]=useState<SavedSetup|null>(null);
  const [postImage,setPostImage]=useState<string>('');
  const [postOutcome,setPostOutcome]=useState<TradeOutcome>('LOSS');
  const [postResultR,setPostResultR]=useState<number>(-1);
  const [postLoading,setPostLoading]=useState(false);
  const [reviewAcknowledged,setReviewAcknowledged]=useState(false);
  const [strategy,setStrategy]=useState<StrategyProfile>(DEFAULT_STRATEGY_PROFILE);
  const [accounts,setAccounts]=useState<TradingAccount[]>([]);
  const [accountId,setAccountId]=useState('');

  useEffect(()=>{ void loadHistory(); void loadStrategy(); void loadAccounts(); },[userId]);
  useEffect(()=>{
    const handler=()=>{ void loadStrategy(); };
    window.addEventListener('trade-police:strategy-changed',handler);
    return()=>window.removeEventListener('trade-police:strategy-changed',handler);
  },[]);
  async function loadStrategy(){
    try{
      const response=await fetch('/api/strategies/active',{cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not load the active strategy.');
      setStrategy(data.strategy);
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
    setHistory((data||[]).map((r:any)=>({id:r.id,createdAt:r.created_at,source:r.source,instrument:r.instrument,direction:r.direction,setupType:r.setup_type,entry:r.entry===null?null:Number(r.entry),stopLoss:r.stop_loss===null?null:Number(r.stop_loss),takeProfit:r.take_profit===null?null:Number(r.take_profit),rr:r.rr===null?null:Number(r.rr),resultR:r.result_r===null?null:Number(r.result_r),status:r.status,outcome:r.outcome,postTradeImage:r.post_trade_image_path,postAnalysis:r.post_analysis})));
  }

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

  async function fileToDataUrl(e:ChangeEvent<HTMLInputElement>, key:'h4'|'h1'|'m30') {
    const f=e.target.files?.[0]; if(!f)return;
    if(f.size>8_000_000){setError('Each image must be under 8 MB.');return;}
    const r=new FileReader(); r.onload=()=>setImages(v=>({...v,[key]:String(r.result)})); r.readAsDataURL(f);
  }
  async function postFileToDataUrl(e:ChangeEvent<HTMLInputElement>) {
    const f=e.target.files?.[0]; if(!f)return;
    if(f.size>8_000_000){setError('Post-trade image must be under 8 MB.');return;}
    const r=new FileReader(); r.onload=()=>setPostImage(String(r.result)); r.readAsDataURL(f);
  }

  function applyLiveAnalysis(data: ChartAnalysis){
    setAnalysis(data);
    const next:Record<string,boolean>={};
    evidenceKeys.forEach(k=>next[k]=data.evidence[k].value);
    setAutoChecks(next);
    const instrumentEl=document.querySelector('[name=instrument]') as HTMLSelectElement;
    if(instrumentEl) instrumentEl.value=data.instrument;
    if(data.suggestedDirection){const directionEl=document.querySelector('[name=direction]') as HTMLSelectElement;if(directionEl)directionEl.value=data.suggestedDirection;}
  }

  async function analyzeCharts(){
    setError(''); if(!images.h4||!images.h1||!images.m30){setError('Upload H4, H1, and M30 screenshots.');return;}
    setAnalyzing(true); setAnalysis(null);
    const instrument=(document.querySelector('[name=instrument]') as HTMLSelectElement)?.value;
    const res=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instrument,h4Image:images.h4,h1Image:images.h1,m30Image:images.m30,strategyProfile:strategy})});
    const data=await res.json(); setAnalyzing(false);
    if(!res.ok){ setError(data.error||'Could not analyze charts.'); if(data.demo) setAnalysis(data.demo); return; }
    setAnalysis(data); const next:Record<string,boolean>={}; evidenceKeys.forEach(k=>next[k]=data.evidence[k].value); setAutoChecks(next);
    if(data.suggestedDirection){ const el=document.querySelector('[name=direction]') as HTMLSelectElement; if(el)el.value=data.suggestedDirection; }
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(reviewActive){ setError('Trade Police is in Investigation Mode after the configured loss streak. Complete the review before requesting another authorization.'); return; }
    setLoading(true);setResult(null);setError('');const fd=new FormData(e.currentTarget);const body:any={};
    ['instrument','direction','session'].forEach(k=>body[k]=fd.get(k)); ['entry','stopLoss','takeProfit','accountBalance','riskPercent','tradesToday'].forEach(k=>body[k]=Number(fd.get(k))); body.accountId=accountId||null; body.userTimezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    evidenceKeys.forEach(k=>body[k]=fd.get(k)==='on'); body.highImpactNews=fd.get('highImpactNews')==='on'; body.setupType=analysis?.setupType;
    try{
      const res=await fetch('/api/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await res.json();
      if(res.ok)setResult(data);else setError(data.error||'Please review the form values.');
    }catch(e:any){
      setError(e.message||'Could not request authorization.');
    }finally{
      setLoading(false);
    }
  }

  function useCandidate(index:number){const c=analysis?.candidates[index];if(!c)return; const set=(name:string,val:number|null)=>{if(val!==null){const el=document.querySelector(`[name=${name}]`) as HTMLInputElement;if(el)el.value=String(val)}}; set('entry',c.entryLow??c.entryHigh);set('stopLoss',c.stopLoss);set('takeProfit',c.takeProfit);const d=document.querySelector('[name=direction]') as HTMLSelectElement;if(d)d.value=c.direction;}
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
      const upload=async(data:string|undefined,label:string)=>data?uploadDataUrl(userId,data,label):null;
      const [h4Path,h1Path,m30Path]=await Promise.all([upload(images.h4,'h4'),upload(images.h1,'h1'),upload(images.m30,'m30')]);
      const originalReason=result.vetoes[0]||result.observations[0]||(result.verdict==='AUTHORIZED'?'All configured authorization rules passed.':'The setup did not pass final authorization.');
      const balanceAtEntry=selectedAccount?.currentBalance??Number(get('accountBalance'));
      const riskAmount=balanceAtEntry*(Number(get('riskPercent'))/100);
      const {data:record,error:recordError}=await createClient().from('trade_records').insert({user_id:userId,account_id:accountId||null,balance_at_entry:balanceAtEntry,risk_amount:riskAmount,strategy_profile_id:strategy.id||null,strategy_name_at_entry:strategy.name,source:'EXECUTED',status:'OPEN',instrument:get('instrument'),direction:get('direction'),setup_type:analysis?.setupType||'Manual',session:get('session'),entry:Number(get('entry')),stop_loss:Number(get('stopLoss')),take_profit:Number(get('takeProfit')),rr:result.rr,score:result.score,verdict:result.verdict,h4_image_path:h4Path,h1_image_path:h1Path,m30_image_path:m30Path,chart_analysis:analysis,rule_snapshot:{...strategy,riskPercent:Number(get('riskPercent')),accountBalance:Number(get('accountBalance')),takenAgainstVerdict:againstVerdict,originalVerdict:result.verdict,originalVerdictReason:originalReason,overrideReason}}).select().single();
      if(recordError)throw recordError;
      const response=await fetch('/api/trades/take',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:accountId||null,balanceAtEntry,riskAmount,strategyProfileId:strategy.id||null,strategyNameAtEntry:strategy.name,strategySnapshot:strategy,tradeRecordId:record.id,instrument:get('instrument'),direction:get('direction'),entry:Number(get('entry')),stopLoss:Number(get('stopLoss')),takeProfit:Number(get('takeProfit')),riskPercent:Number(get('riskPercent')),initialRR:result.rr,setupType:analysis?.setupType||'Manual',initialScore:result.score,initialAnalysis:analysis,takenAgainstVerdict:againstVerdict,originalVerdict:result.verdict,originalVerdictReason:originalReason,overrideReason})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not start Active Trade Monitor.');
      await loadHistory();window.location.href='/active-trade';
    }catch(e:any){setError(e.message||'Could not save executed trade.');}
    finally{setSavingTrade(false);}
  }

  async function closeAndAnalyzeTrade(){
    if(!closingTrade||!postImage){setError('A post-trade screenshot is mandatory before closing the trade.');return;}
    setPostLoading(true);setError('');
    const res=await fetch('/api/post-trade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:postImage,outcome:postOutcome,resultR:postResultR,...closingTrade})});
    const data=await res.json();setPostLoading(false);
    if(!res.ok){setError(data.error||'Could not review the closed trade.');return;}
    try{
      const postPath=await uploadDataUrl(userId,postImage,'post-trade');
      const {error:updateError}=await createClient().from('trade_records').update({status:'CLOSED',outcome:postOutcome,result_r:postResultR,post_trade_image_path:postPath,post_analysis:data,closed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',closingTrade.id);
      if(updateError)throw updateError;
      await loadHistory();setClosingTrade(null);setPostImage('');
    }catch(e:any){setError(e.message||'Could not persist post-trade review.');}
  }

  const suggested=useMemo(()=>history.filter(h=>h.source==='SUGGESTED').slice(0,3),[history]);
  const executed=useMemo(()=>history.filter(h=>h.source==='EXECUTED').slice(0,3),[history]);

  return <>
    {reviewActive&&<div className="card investigation"><span className="badge rejected">INVESTIGATION MODE</span><h2>{strategy.lossStreakLimit} consecutive losses detected</h2><p>Trade Police has suspended new authorizations. This is not proof that the strategy stopped working, but it is enough evidence to pause and diagnose execution, market regime, and setup quality.</p><div className="grid grid-2"><div><h3>Repeated factors</h3>{repeatedFactors.length?repeatedFactors.map(([f,n])=><div className="score-line" key={f}><span>{f}</span><strong>{n}/{strategy.lossStreakLimit}</strong></div>):<p className="muted">Complete post-trade analyses to identify repeated factors.</p>}</div><div><h3>Required review</h3><ul><li>Compare all five losses by instrument and session.</li><li>Check whether entries were early or lacked M30 confirmation.</li><li>Separate valid losses from rule violations.</li><li>Reduce activity until a new A/A+ setup appears.</li></ul></div></div><button onClick={()=>setReviewAcknowledged(true)}>I reviewed the 5 losses — reactivate cautiously</button></div>}

    <LiveMarketPanel strategy={strategy} onApply={applyLiveAnalysis}/>

    <div className="grid grid-2">
      <form className="card" onSubmit={submit}>
        <h2>Validate Trade</h2>{accounts.length===0&&<p className="warning">No trading account yet. You can validate with a manual balance, or create an auditable account from Accounts.</p>}<p className="muted">Active strategy: <strong>{strategy.name}</strong> · {strategy.trendTimeframe}/{strategy.confirmationTimeframe}/{strategy.entryTimeframe} · RR ≥ 1:{strategy.minimumRR} · Risk ≤ {strategy.maximumRiskPercent}%</p>
        <div className="grid grid-2">
          <label>Instrument<select name="instrument">{strategy.instruments.map(x=><option key={x}>{x}</option>)}</select></label>
          <label>Direction<select name="direction"><option>BUY</option><option>SELL</option></select></label>
          <label>{strategy.trendTimeframe} screenshot<input type="file" accept="image/*" onChange={e=>fileToDataUrl(e,'h4')}/></label>
          <label>{strategy.confirmationTimeframe} screenshot<input type="file" accept="image/*" onChange={e=>fileToDataUrl(e,'h1')}/></label><label>{strategy.entryTimeframe} screenshot<input type="file" accept="image/*" onChange={e=>fileToDataUrl(e,'m30')}/></label>
        </div>
        <button type="button" className="primary" onClick={analyzeCharts} disabled={analyzing}>{analyzing?'Reading market structure…':`Analyze ${strategy.trendTimeframe} + ${strategy.confirmationTimeframe} + ${strategy.entryTimeframe}`}</button>
        {error&&<p className="error">{error}</p>}
        {analysis&&<div className="analysis-strip"><strong>{analysis.setupType}</strong><span>Confidence {analysis.setupConfidence}%</span><span>H4 {analysis.h4Bias}</span><span>H1 {analysis.h1Bias}</span></div>}
        <hr/>
        <div className="grid grid-2">
          <label>Entry<input name="entry" type="number" step="any" required/></label><label>Stop loss<input name="stopLoss" type="number" step="any" required/></label>
          <label>Take profit<input name="takeProfit" type="number" step="any" required/></label>
          <label>Trading account<select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Manual balance</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name} · {account.currency} {account.currentBalance.toLocaleString()}</option>)}</select></label>
          <label>Account balance<input key={selectedAccount?.id||'manual'} name="accountBalance" type="number" defaultValue={selectedAccount?.currentBalance??100000} readOnly={Boolean(selectedAccount)} required/></label>
          <label>Risk %<input name="riskPercent" type="number" step="0.01" defaultValue={strategy.maximumRiskPercent} required/></label><label>Trades today<input name="tradesToday" type="number" defaultValue="0" min="0" required/></label>
          <label>Session<select name="session">{strategy.allowedSessions.map(x=><option key={x} value={x}>{x.replace('_',' ')}</option>)}</select></label>
        </div><hr/>
        <div className="grid grid-2">
          {checks.map(([name,label])=>{const ai=name!=='highImpactNews'?analysis?.evidence[name as EvidenceKey]:null;return <label key={name} className="check-row"><input name={name} type="checkbox" checked={!!autoChecks[name]} onChange={e=>setAutoChecks(v=>({...v,[name]:e.target.checked}))}/><span>{label}{ai&&<small>{ai.confidence}% · {ai.reason}</small>}</span></label>})}
        </div><hr/><button className="primary" disabled={loading||reviewActive}>{reviewActive?'Authorization suspended':loading?'Reviewing…':'Request authorization'}</button>
      </form>

      <div className="stack">
        <div className="card"><h2>Probable setups</h2>{!analysis?<p className="muted">Analyze the three configured timeframes to identify rule-based candidates.</p>:<><p>{analysis.summary}</p>{analysis.warnings.map(w=><p className="warning" key={w}>{w}</p>)}{analysis.candidates.length===0?<p className="muted">No defensible candidate detected.</p>:analysis.candidates.map((c,i)=><div className="candidate" key={c.id}><div><strong>{c.status} · {c.direction}</strong><span>{c.entryLow??'—'}{c.entryHigh&&c.entryHigh!==c.entryLow?`–${c.entryHigh}`:''} · SL {c.stopLoss??'—'} · TP {c.takeProfit??'—'} · RR {c.rr?`1:${c.rr}`:'—'}</span><small>{c.rationale}</small></div><div><button type="button" onClick={()=>useCandidate(i)}>Use</button><button type="button" onClick={()=>saveSuggestion(i)}>Save</button></div></div>)}</>}</div>
        <div className="card">{!result?<><h2>Police Verdict</h2><p className="muted">The deterministic rule engine issues the final decision.</p></>:<><span className={`badge ${result.verdict.toLowerCase()}`}>{result.verdict}</span><div className="score">{result.score}</div><h2>Grade {result.grade}</h2><p>RR <strong>1:{result.rr}</strong> · Risk <strong>${result.riskAmount}</strong></p>{result.vetoes.length>0&&<><h3>Automatic vetoes</h3><ul>{result.vetoes.map(v=><li key={v}>{v}</li>)}</ul></>}{result.observations.length>0&&<><h3>Pending evidence</h3><ul>{result.observations.map(v=><li key={v}>{v}</li>)}</ul></>}{result.dailyLimits&&<div className="card nested-card"><h3>Daily discipline</h3><div className="score-line"><span>Strategy trades today</span><strong>{result.dailyLimits.strategyTradesToday}/{result.dailyLimits.strategyLimit}</strong></div><div className="score-line"><span>Instrument trades today</span><strong>{result.dailyLimits.instrumentTradesToday}/{result.dailyLimits.instrumentLimit}</strong></div><div className="score-line"><span>Realized daily P&amp;L</span><strong>${result.dailyLimits.realizedDailyPnl.toFixed(2)}</strong></div>{result.dailyLimits.greenDayExceptionApplied&&<p className="warning">Green Day Protection approved this extra trade. Worst-case day: ${result.dailyLimits.worstCaseDailyPnl.toFixed(2)}.</p>}{result.dailyLimits.message&&<p className="muted">{result.dailyLimits.message}</p>}</div>}{result.verdict==='AUTHORIZED'?<button type="button" onClick={()=>saveTakenTrade(false)} disabled={savingTrade}>{savingTrade?'Saving trade…':'Trade taken'}</button>:result.overrideAllowed===false?<p className="error">Take Anyway is disabled because the daily limit is a hard risk-control rule.</p>:<div><button type="button" onClick={()=>saveTakenTrade(true)} disabled={savingTrade}>{savingTrade?'Saving trade…':'Take anyway'}</button><p className="muted">This trade will be recorded as taken against the police verdict.</p></div>}<hr/>{result.scoreItems.map(i=><div className="score-line" key={i.label}><span className="muted">{i.label}</span><strong>{i.earned}/{i.possible}</strong></div>)}</>}</div>
      </div>
    </div>

    <div className="card history"><h2>Last 3 suggested vs. last 3 executed</h2><div className="grid grid-2"><History title="Suggested" rows={suggested}/><History title="Executed" rows={executed} onClose={setClosingTrade}/></div></div>

    {closingTrade&&<div className="card close-trade"><h2>Close & Review Trade</h2><p><strong>{closingTrade.instrument} {closingTrade.direction}</strong> · {closingTrade.setupType}</p><p className="warning">The trade cannot be closed in Trade Police without a post-trade screenshot.</p><div className="grid grid-2"><label>Outcome<select value={postOutcome} onChange={e=>setPostOutcome(e.target.value as TradeOutcome)}><option>WIN</option><option>LOSS</option><option>BREAKEVEN</option><option>PARTIAL</option></select></label><label>Result in R<input type="number" step="0.01" value={postResultR} onChange={e=>setPostResultR(Number(e.target.value))}/></label><label>Post-trade screenshot<input type="file" accept="image/*" onChange={postFileToDataUrl}/></label></div><div className="button-row"><button className="primary" onClick={closeAndAnalyzeTrade} disabled={postLoading}>{postLoading?'Investigating what happened…':'Close trade and analyze'}</button><button onClick={()=>setClosingTrade(null)}>Cancel</button></div></div>}
  </>;
}

function History({title,rows,onClose}:{title:string;rows:SavedSetup[];onClose?:(row:SavedSetup)=>void}){
  return <div><h3>{title}</h3>{rows.length===0?<p className="muted">Nothing saved yet.</p>:rows.map(r=><div className="history-row" key={r.id}><strong>{r.instrument} {r.direction}</strong><span>{r.setupType}</span><small>{r.entry} / {r.stopLoss} / {r.takeProfit} · {r.rr?`1:${r.rr}`:'RR pending'}{r.outcome?` · ${r.outcome} ${r.resultR}R`:''}</small>{r.postAnalysis&&<small>Police lesson: {r.postAnalysis.lesson}</small>}{r.source==='EXECUTED'&&r.status!=='CLOSED'&&onClose&&<button onClick={()=>onClose(r)}>Close + upload post-trade</button>}</div>)}</div>;
}
