import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {getUserDisplayName} from '@/lib/user-display-name';
import AppHeader from '@/components/AppHeader';

export default async function HistoryPage(){
  const s=await createClient();const {data:{user}}=await s.auth.getUser();if(!user)redirect('/client/login?next=/history');
  const displayName=await getUserDisplayName(s,user);
  const {data,error}=await s.from('trade_records').select('id,created_at,instrument,direction,setup_type,source,status,outcome,result_r,score,chart_analysis').order('created_at',{ascending:false}).limit(100);
  const rows=data??[];
  return <main className="container"><AppHeader eyebrow="TRADE POLICE / HISTORY" displayName={displayName} description="Review the decisions you saved." userId={user.id}/>
    <section className="card history-page"><div><p className="eyebrow">DECISION HISTORY</p><h2>Your decision record</h2><p className="muted">Readiness is shown only when a verified analysis stored it.</p></div>
    {error?<div className="error-state"><h3>History could not be loaded</h3><p>{error.message}</p></div>:rows.length===0?<div className="empty-state"><h3>You have no saved decisions yet.</h3><p>Run your first analysis to begin building your decision history.</p><a className="button-link primary" href="/validate">Open Decision</a></div>:<div className="history-table" role="table"><div className="history-row history-head" role="row"><span>Date</span><span>Instrument</span><span>Strategy / setup</span><span>Decision</span><span>Readiness</span><span>Result</span></div>{rows.map((row:any)=>{const readiness=row.chart_analysis?.liveAnalysisConfidence;const decision=row.source==='EXECUTED'?(row.chart_analysis?.decisionNarrative?.recommendation??row.status):'SAVED';return <article className="history-row" role="row" key={row.id}><span data-label="Date">{new Date(row.created_at).toLocaleString()}</span><strong data-label="Instrument">{row.instrument} {row.direction}</strong><span data-label="Strategy / setup">{row.setup_type||'Configured strategy'}</span><span data-label="Decision">{decision}</span><span data-label="Readiness">{readiness==null?'Not available':`${readiness}%`}</span><span data-label="Result">{row.outcome??(row.status==='OPEN'?'Not recorded':'—')}{row.result_r==null?'':` · ${Number(row.result_r).toFixed(2)}R`}</span></article>})}</div>}
    </section></main>;
}
