import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {getUserDisplayName} from '@/lib/user-display-name';
import AppHeader from '@/components/AppHeader';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
export default async function AnalyticsPage(){
 const s=await createClient();const {data:{user}}=await s.auth.getUser();if(!user)redirect('/login');
 const displayName=await getUserDisplayName(s,user);
 const [{data:account},{data=[]}]=await Promise.all([
  s.from('trading_accounts').select('name,currency,initial_balance,current_balance').eq('is_active',true).eq('is_archived',false).maybeSingle(),
  s.from('active_trades').select('id,result_r,realized_pnl,outcome,taken_against_verdict,strategy_name_at_entry,instrument,initial_analysis,opened_at,closed_at,direction,risk_percent,initial_rr,setup_type,override_reason').eq('status','CLOSED').order('closed_at')
 ]);
 const trades=(data??[]).filter((x:any)=>x.closed_at).map((x:any)=>({id:x.id,pnl:Number(x.realized_pnl??0),r:Number(x.result_r??0),openedAt:x.opened_at??x.closed_at,closedAt:x.closed_at,instrument:x.instrument??'Unknown',strategy:x.strategy_name_at_entry??'Unknown',session:x.initial_analysis?.session??x.initial_analysis?.detectedSessionCode??'Unknown',outcome:x.outcome??'UNKNOWN',direction:x.direction??'Unknown',riskPercent:Number(x.risk_percent??0),initialRR:Number(x.initial_rr??0),setupType:x.setup_type??x.initial_analysis?.setupType??'Unknown',compliant:!x.taken_against_verdict,overrideReason:x.override_reason??null}));
 return <main className="container"><AppHeader eyebrow="TRADE POLICE / ANALYTICS" displayName={displayName} description="Turn discipline and outcomes into evidence." userId={user.id}/><AnalyticsDashboard account={{name:account?.name??'Active account',currency:account?.currency??'USD',startingBalance:Number(account?.initial_balance??0),currentBalance:Number(account?.current_balance??0)}} trades={trades}/></main>
}
