import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {getUserDisplayName} from '@/lib/user-display-name';
import AppHeader from '@/components/AppHeader';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import { getTradeLifecycleSimulationLabel, isTradeLifecycleSimulationRecord } from '@/lib/server/trade-lifecycle-v2';
import {getRequestLocale} from '@/lib/i18n/server';
import {getScreenCopy} from '@/lib/i18n/screen-copy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AnalyticsPage(){
 const s=await createClient();const {data:{user}}=await s.auth.getUser();if(!user)redirect('/login');
 const [displayName,locale]=await Promise.all([getUserDisplayName(s,user),getRequestLocale()]);
 const c=getScreenCopy(locale).analytics;
 const [accountResult, tradeResult]=await Promise.all([
  s.from('trading_accounts').select('name,currency,initial_balance,current_balance').eq('is_active',true).eq('is_archived',false).maybeSingle(),
  s.from('active_trades').select('id,result_r,realized_pnl,outcome,taken_against_verdict,strategy_name_at_entry,instrument,opened_at,closed_at,direction,risk_percent,initial_rr,setup_type,override_reason,strategy_snapshot,source_report_id,activation_mode,status').eq('user_id',user.id).eq('status','CLOSED').order('closed_at')
 ]);
 const account=accountResult.data;
 const data=tradeResult.data??[];
 if(tradeResult.error){
  console.error('[ANALYTICS_CLOSED_TRADES_LOAD_FAILED]',{code:tradeResult.error.code,message:tradeResult.error.message,userId:user.id});
  return <main className="container"><AppHeader eyebrow={c.eyebrow} displayName={displayName} description={c.description} userId={user.id}/><section className="card error-state"><h1>{c.failed}</h1><p>{c.failedBody}</p></section></main>;
 }
 const allTrades=(data??[]).filter((x:any)=>x.closed_at);
 const liveTrades=allTrades.filter((x:any)=>!isTradeLifecycleSimulationRecord(x)).map((x:any)=>({
  id:x.id,
  resultR: Number.isFinite(Number(x.result_r)) ? Number(x.result_r) : null,
  realizedPnl: Number.isFinite(Number(x.realized_pnl)) ? Number(x.realized_pnl) : null,
  outcome:(x.outcome ?? 'UNKNOWN'),
  tookAgainstVerdict:Boolean(x.taken_against_verdict),
  activationMode: x.activation_mode ?? (x.taken_against_verdict ? 'OVERRIDE' : 'READY'),
  sourceReportId:x.source_report_id ?? null,
  openedAt:x.opened_at ?? x.closed_at,
  closedAt:x.closed_at,
  instrument:x.instrument ?? 'Unknown',
  strategy:x.strategy_name_at_entry ?? 'Unknown',
  direction:x.direction ?? 'Unknown',
  riskPercent:Number(x.risk_percent ?? 0),
  initialRR:Number(x.initial_rr ?? 0),
  setupType:x.setup_type ?? 'Unknown',
  overrideReason:x.override_reason ?? null,
  strategySnapshot:(x.strategy_snapshot as Record<string, unknown> | null) ?? null,
  simulationMode:null,
  source:null,
 }));
 const simulationTrades=allTrades.filter((x:any)=>isTradeLifecycleSimulationRecord(x)).map((x:any)=>{
  const strategy_snapshot=(x.strategy_snapshot as Record<string, unknown> | null) ?? {};
  const simulationMode=String(strategy_snapshot.simulationMode ?? strategy_snapshot.testSource ?? strategy_snapshot.internalTestMode ?? 'INTERNAL_LIFECYCLE_SMOKE_TEST');
  return {id:x.id,label:getTradeLifecycleSimulationLabel(x),pnl:Number(x.realized_pnl??0),r:Number(x.result_r??0),instrument:x.instrument??'Unknown',strategy:x.strategy_name_at_entry??'Unknown',outcome:x.outcome??'UNKNOWN',closedAt:x.closed_at,recordType:'SIMULATION / INTERNAL TEST',simulationMode, strategy_snapshot};
 });
 return <main className="container"><AppHeader eyebrow={c.eyebrow} displayName={displayName} description={c.description} userId={user.id}/>{simulationTrades.length>0?<section className="card analytics-verification-card" style={{marginBottom:'1.5rem'}}><div className="section-title"><div><span className="eyebrow">SIMULATION / INTERNAL TEST</span><h2>{c.verificationOnly}</h2><p className="muted">{c.verificationHint}</p></div></div><div className="historical-card-list">{simulationTrades.map(trade=><article className="historical-card" key={trade.id}><div><time dateTime={trade.closedAt}>{new Date(trade.closedAt).toLocaleString(locale)}</time><strong>{trade.instrument}</strong><span>{trade.strategy}</span></div><div><span className="badge blocked">{trade.label}</span><p>{trade.outcome}</p></div><dl><div><dt>R</dt><dd>{trade.r.toFixed(2)}R</dd></div><div><dt>{c.mode}</dt><dd>{trade.simulationMode}</dd></div></dl></article>)}</div></section>:null}<AnalyticsDashboard account={{name:account?.name??c.activeAccount,currency:account?.currency??'USD',startingBalance:Number(account?.initial_balance??0),currentBalance:Number(account?.current_balance??0)}} trades={liveTrades}/></main>
}
