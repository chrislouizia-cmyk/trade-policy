import {toHQStrategySummary,type HQStrategySource,type HQStrategySummary} from '@/lib/hq/strategy-summary';

type Admin={from:(table:string)=>any};
export type HQStrategyDirectoryFilters=Readonly<{q?:string;customer?:string;instrument?:string;methodology?:string;status?:string;engineVersion?:string;health?:string;timeframe?:string;strategyId?:string;ownerId?:string;sort?:string}>;

const newest=(values:(string|null|undefined)[])=>values.filter((value):value is string=>Boolean(value)).sort().at(-1)??null;
const eventCounts=(rows:readonly any[],idField:string,ids:readonly string[])=>{
  const result=new Map(ids.map(id=>[id,{count:0,lastUsedAt:null as string|null}]));
  for(const row of rows){const id=row[idField];if(!result.has(id))continue;const current=result.get(id)!;current.count++;current.lastUsedAt=newest([current.lastUsedAt,row.created_at,row.opened_at,row.updated_at,row.occurred_at]);}
  return result;
};
const matches=(value:string|null|undefined,needle:string|undefined)=>!needle||value?.toLowerCase().includes(needle.toLowerCase());

export async function loadHQStrategyDirectory(admin:Admin,filters:HQStrategyDirectoryFilters={}):Promise<HQStrategySummary[]>{
  let profileQuery=admin.from('strategy_profiles').select('id,user_id,name,is_default,is_archived,instruments,trading_style,strategy_methodologies,engine_version,macro_timeframe,trend_timeframe,confirmation_timeframe,entry_timeframe,trigger_timeframe,created_at,updated_at');
  if(filters.strategyId)profileQuery=profileQuery.eq('id',filters.strategyId);
  if(filters.ownerId)profileQuery=profileQuery.eq('user_id',filters.ownerId);
  const {data:profiles,error:profileError}=await profileQuery.order('updated_at',{ascending:false}).limit(200);
  if(profileError)throw profileError;
  const rows=(profiles??[]) as HQStrategySource[];if(!rows.length)return [];
  const ids=rows.map(row=>row.id),ownerIds=[...new Set(rows.map(row=>row.user_id))];
  const [{data:owners,error:ownerError},{data:rules,error:ruleError},{data:analyses,error:analysisError},{data:decisions,error:decisionError},{data:trades,error:tradeError},{data:events,error:eventError}]=await Promise.all([
    admin.from('profiles').select('id,display_name,email').in('id',ownerIds),
    admin.from('strategy_rules').select('strategy_id,enabled,mandatory,evaluation_mode').in('strategy_id',ids),
    admin.from('market_scans').select('strategy_profile_id,created_at').in('strategy_profile_id',ids),
    admin.from('decision_reports').select('strategy_id,created_at').in('strategy_id',ids),
    admin.from('active_trades').select('strategy_profile_id,opened_at,updated_at').in('strategy_profile_id',ids),
    admin.from('beta_intelligence_events').select('playbook_id,occurred_at').in('playbook_id',ids),
  ]);
  if(ownerError||ruleError||analysisError||decisionError||tradeError||eventError)throw ownerError??ruleError??analysisError??decisionError??tradeError??eventError;
  const ownerMap=new Map<string,string|null>((owners??[]).map((owner:any):[string,string|null]=>[String(owner.id),owner.display_name||owner.email||null]));
  const analysis=eventCounts(analyses??[],'strategy_profile_id',ids),decision=eventCounts(decisions??[],'strategy_id',ids),trade=eventCounts(trades??[],'strategy_profile_id',ids),event=eventCounts(events??[],'playbook_id',ids);
  const filtered=rows.map(row=>{
    const a=analysis.get(row.id)!,d=decision.get(row.id)!,t=trade.get(row.id)!,e=event.get(row.id)!;
    return toHQStrategySummary(row,ownerMap.get(row.user_id)??null,(rules??[]).filter((rule:any)=>rule.strategy_id===row.id),{analyses:a.count,decisions:d.count,tradesTaken:t.count,users:(a.count||d.count||t.count||e.count)?1:0,lastUsedAt:newest([a.lastUsedAt,d.lastUsedAt,t.lastUsedAt,e.lastUsedAt])});
  }).filter(summary=>{
    const q=filters.q?.trim(),timeframes=Object.values(summary.timeframeRoles).filter(Boolean) as string[];
    return matches(summary.name,q)&&matches(summary.customer.name,filters.customer)&&(!filters.instrument||summary.instruments.includes(filters.instrument.toUpperCase()))&&(!filters.methodology||matches(summary.category,filters.methodology)||summary.methodologies.some(item=>matches(item,filters.methodology)))&&(!filters.status||summary.state===filters.status.toUpperCase())&&(!filters.engineVersion||String(summary.engineVersion??'')===filters.engineVersion)&&(!filters.health||summary.health.state===filters.health.toUpperCase())&&(!filters.timeframe||timeframes.includes(filters.timeframe));
  });
  const sort=filters.sort?.toUpperCase()??'RECENTLY_ACTIVE';
  return filtered.sort((a,b)=>{
    if(sort==='MOST_USED')return b.usage.analyses+b.usage.decisions+b.usage.tradesTaken-(a.usage.analyses+a.usage.decisions+a.usage.tradesTaken);
    if(sort==='LEAST_USED')return a.usage.analyses+a.usage.decisions+a.usage.tradesTaken-(b.usage.analyses+b.usage.decisions+b.usage.tradesTaken);
    if(sort==='RECENTLY_CREATED')return String(b.createdAt??'').localeCompare(String(a.createdAt??''));
    if(sort==='HEALTH_ISSUES')return Number(a.health.state==='HEALTHY')-Number(b.health.state==='HEALTHY');
    if(sort==='INACTIVE_OR_ABANDONED')return Number(b.usage.activityState==='ACTIVE')-Number(a.usage.activityState==='ACTIVE');
    return String(b.usage.lastUsedAt??b.updatedAt??'').localeCompare(String(a.usage.lastUsedAt??a.updatedAt??''));
  });
}
